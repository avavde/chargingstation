const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");
const { ChargePointClient } = require("@lhci/node-ocpp"); // Новый OCPP клиент

// Путь к файлу конфигурации
const configPath = './config/config.json';

// Проверяем наличие файла конфигурации
if (!fs.existsSync(configPath)) {
  console.error(`Файл config.json не найден по пути: ${configPath}. Создаем файл с дефолтной конфигурацией.`);

  // Создаем дефолтную конфигурацию, если файл не существует
  const defaultConfig = {
    "ocpp": {
      "centralSystemUrl": "ws://www.ecarup.com/api/Ocpp16/110D687EEDFDAE52"
    },
    "stations": [
      {
        "name": "Station1",
        "ports": [
          {
            "number": 1,
            "relayPath": "/sys/class/gpio/gpio121/value",
            "meterAddress": 1,
            "meterRegister": 5218,
            "currentRegister": 5220
          },
          {
            "number": 2,
            "relayPath": "/sys/class/gpio/gpio122/value",
            "meterAddress": 2,
            "meterRegister": 5218,
            "currentRegister": 5220
          }
        ]
      }
    ],
    "modbusPort": "/dev/ttymxc4",
    "modbusBaudRate": 9600
  };

  // Создаем директорию, если она не существует
  const configDir = './config';
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
  }

  // Записываем дефолтный конфиг в файл
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log("Файл config.json создан с дефолтной конфигурацией.");
}

// Загружаем конфигурацию
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (error) {
  console.error("Ошибка при чтении конфигурационного файла:", error.message);
  process.exit(1);
}

// Проверяем наличие необходимых параметров в конфигурации
if (!config.ocpp || !config.ocpp.centralSystemUrl) {
  console.error("Отсутствуют необходимые параметры в конфигурации.");
  process.exit(1);
}

const transactionsFile = "./transactions.json";

// Инициализируем переменные
const dev = {};
const chargePoints = {};

// Конфигурация Modbus клиента
const modbusClient = new ModbusRTU();
modbusClient.connectRTUBuffered(config.modbusPort, {
  baudRate: config.modbusBaudRate,
  dataBits: 8,
  stopBits: 2,
  parity: "none",
}, (err) => {
  if (err) {
    console.error("Ошибка подключения к Modbus:", err.message);
    process.exit(1);
  } else {
    console.log("Подключение к Modbus установлено.");
  }
});

// Инициализация OPC UA сервера
const server = new opcua.OPCUAServer({
  port: 4840,
  resourcePath: "/opcua/server",
  buildInfo: {
    productName: "ChargingStationServer",
    buildNumber: "1",
    buildDate: new Date(),
  },
});

// Функция для инициализации OPC UA сервера
async function initializeOPCUAServer() {
  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();

  const stationNode = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "ChargingStations",
  });

  config.stations.forEach(station => {
    station.ports.forEach(port => {
      const portKey = `${station.name}_port${port.number}`;

      dev[portKey] = { Stat: 0, Finish: false, Kwt: 0, Summ: 0, Current: 0, transactionId: null };

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Stat`,
        dataType: "Int32",
        accessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        userAccessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Int32, value: dev[portKey].Stat }),
          set: (variant) => {
            dev[portKey].Stat = variant.value;
            handleStatChange(station.name, port.number);
            return opcua.StatusCodes.Good;
          },
        },
        minimumSamplingInterval: 1000,
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Finish`,
        dataType: "Boolean",
        accessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        userAccessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Boolean, value: Boolean(dev[portKey].Finish) }),
          set: (variant) => {
            dev[portKey].Finish = !!variant.value;
            if (dev[portKey].Finish) handleFinish(station.name, port.number);
            return opcua.StatusCodes.Good;
          },
        },
        minimumSamplingInterval: 1000,
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Kwt`,
        dataType: "Double",
        accessLevel: opcua.AccessLevelFlag.CurrentRead,
        userAccessLevel: opcua.AccessLevelFlag.CurrentRead,
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: dev[portKey].Kwt }),
        },
        minimumSamplingInterval: 1000,
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Current`,
        dataType: "Double",
        accessLevel: opcua.AccessLevelFlag.CurrentRead,
        userAccessLevel: opcua.AccessLevelFlag.CurrentRead,
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: dev[portKey].Current }),
        },
        minimumSamplingInterval: 1000,
      });
    });
  });

  await server.start();
  console.log(`OPC UA сервер запущен по адресу: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

// OCPP: Функция подключения и обработки логики OCPP
function setupOCPP(stationName, port) {
  const client = new ChargePointClient({
    endpoint: config.ocpp.centralSystemUrl,
    chargePointId: `${stationName}_port${port.number}`,
  });

  client.on("connect", () => {
    console.log(`OCPP: Подключен зарядный порт ${stationName}_port${port.number}`);
    client.sendBootNotification({
      chargePointVendor: "ExampleVendor",
      chargePointModel: "ExampleModel",
    });
  });

  client.on("message", (message) => {
    console.log(`OCPP: Сообщение для ${stationName}_port${port.number}`, message);
  });

  client.on("disconnect", () => {
    console.log(`OCPP: Соединение с портом ${stationName}_port${port.number} закрыто`);
  });

  client.connect();
}

// Запуск программы
(async () => {
  console.log("Инициализация программы...");

  // Инициализация OPC UA сервера
  await initializeOPCUAServer();
  console.log("OPC UA сервер запущен.");

  // Настройка OCPP
  config.stations.forEach((station) => {
    station.ports.forEach((port) => {
      setupOCPP(station.name, port);
    });
  });

  // Запуск цикла обновления данных Modbus
  startOPCUAUpdateLoop();
})();

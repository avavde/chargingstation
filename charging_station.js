const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const { RPCClient } = require("ocpp-rpc");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Путь к файлу конфигурации
const configPath = "./config/config.json";

// Проверяем наличие файла конфигурации
if (!fs.existsSync(configPath)) {
  console.error(`Файл config.json не найден по пути: ${configPath}. Создаем файл с дефолтной конфигурацией.`);

  const defaultConfig = {
    ocpp: {
      centralSystemUrl: "ws://www.ecarup.com/api/Ocpp16/110D687EEDFDAE52",
    },
    stations: [
      {
        name: "Station1",
        ports: [
          {
            number: 1,
            relayPath: "/sys/class/gpio/gpio121/value",
            meterAddress: 1,
            meterRegister: 5218,
            currentRegister: 5220,
          },
          {
            number: 2,
            relayPath: "/sys/class/gpio/gpio122/value",
            meterAddress: 2,
            meterRegister: 5218,
            currentRegister: 5220,
          },
        ],
      },
    ],
    modbusPort: "/dev/ttymxc4",
    modbusBaudRate: 9600,
  };

  const configDir = "./config";
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
  }

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log("Файл config.json создан с дефолтной конфигурацией.");
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (error) {
  console.error("Ошибка при чтении конфигурационного файла:", error.message);
  process.exit(1);
}

if (!config.ocpp || !config.ocpp.centralSystemUrl) {
  console.error("Отсутствуют необходимые параметры в конфигурации.");
  process.exit(1);
}

const dev = {};
const chargePoints = {};

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

const server = new opcua.OPCUAServer({
  port: 4840,
  resourcePath: "/opcua/server",
  buildInfo: {
    productName: "ChargingStationServer",
    buildNumber: "1",
    buildDate: new Date(),
  },
});

async function initializeOPCUAServer() {
  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();

  const stationNode = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "ChargingStations",
  });

  config.stations.forEach((station) => {
    station.ports.forEach((port) => {
      const portKey = `${station.name}_port${port.number}`;
      dev[portKey] = { Stat: 0, Finish: 0, Kwt: 0, Summ: 0, Current: 0, transactionId: null };

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
            return opcua.StatusCodes.Good;
          },
        },
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Finish`,
        dataType: "Boolean",
        accessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        userAccessLevel: opcua.AccessLevelFlag.CurrentRead | opcua.AccessLevelFlag.CurrentWrite,
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Boolean, value: dev[portKey].Finish }),
          set: (variant) => {
            dev[portKey].Finish = !!variant.value;
            return opcua.StatusCodes.Good;
          },
        },
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
      });
    });
  });

  await server.start();
  console.log(`OPC UA сервер запущен по адресу: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

function setupOCPPClient(chargePointId) {
  const client = new RPCClient(config.ocpp.centralSystemUrl, chargePointId, { protocols: ["ocpp1.6"] });

  client.on("connect", () => {
    console.log(`${chargePointId} подключен к центральной системе.`);
    client.call("BootNotification", {
      chargePointVendor: "Vendor1",
      chargePointModel: "Model1",
    }).then((response) => {
      console.log(`BootNotification ответ:`, response);
    }).catch((err) => {
      console.error("Ошибка BootNotification:", err);
    });
  });

  client.on("error", (error) => {
    console.error(`Ошибка OCPP клиента: ${error}`);
  });

  client.connect();
  return client;
}

(async () => {
  console.log("Инициализация программы...");

  await initializeOPCUAServer();
  console.log("OPC UA сервер запущен.");

  config.stations.forEach((station) => {
    station.ports.forEach((port) => {
      const chargePointId = `Station_${station.name}_Port_${port.number}`;
      chargePoints[chargePointId] = setupOCPPClient(chargePointId);
    });
  });
})();

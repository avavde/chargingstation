const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const fs = require("fs");

// Путь к файлу конфигурации
const configPath = './config/config.json';

// Проверяем наличие файла конфигурации
if (!fs.existsSync(configPath)) {
  console.error(`Файл config.json не найден по пути: ${configPath}.`);
  process.exit(1);
}

// Загружаем конфигурацию
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (error) {
  console.error("Ошибка при чтении конфигурационного файла:", error.message);
  process.exit(1);
}

// Переменные
const dev = {};

// Инициализация Modbus клиента
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

// Настраиваем OPC UA сервер
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

  // Узел для станций
  const stationNode = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "ChargingStations",
  });

  // Создаем переменные OPC UA для каждой станции
  config.stations.forEach(station => {
    station.ports.forEach(port => {
      const portKey = `${station.name}_Port${port.number}`;
      dev[portKey] = { Stat: 0, Finish: false, Kwt: 0, Current: 0 };

      // Переменные OPC UA
      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Stat`,
        dataType: "Int32",
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
        browseName: `${portKey}_Kwt`,
        dataType: "Double",
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: dev[portKey].Kwt }),
        },
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Current`,
        dataType: "Double",
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: dev[portKey].Current }),
        },
      });
    });
  });

  await server.start();
  console.log(`OPC UA сервер запущен по адресу: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

// Функция для обновления данных из Modbus
async function updateModbusData() {
  while (true) {
    for (const station of config.stations) {
      for (const port of station.ports) {
        const portKey = `${station.name}_port${port.number}`;
        try {
          modbusClient.setID(port.meterAddress);
          const data = await modbusClient.readHoldingRegisters(port.meterRegister, 2);
          const high = data.data[0];
          const low = data.data[1];
          dev[portKey].Kwt = (high << 16) | low;

          const currentData = await modbusClient.readHoldingRegisters(port.currentRegister, 1);
          dev[portKey].Current = currentData.data[0];
        } catch (err) {
          console.error(`Ошибка Modbus для ${portKey}: ${err.message}`);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Запуск OPC UA и Modbus
(async () => {
  await initializeOPCUAServer();
  updateModbusData();
})();

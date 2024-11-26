const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const fs = require("fs");

// Загрузка конфигурационного файла
const configPath = './config/config.json';
if (!fs.existsSync(configPath)) {
  console.error("Файл config.json не найден. Убедитесь, что файл существует.");
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Переменные для хранения данных портов
const dev = {};

// Конфигурация Modbus
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

// Создание OPC UA сервера
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
    browseName: config.stationName,
  });

  // Создание переменных для каждого порта
  config.ports.forEach((port) => {
    const portKey = `${config.stationName}_port${port.number}`;
    dev[portKey] = { Stat: 0, Finish: false, Kwt: 0, Summ: 0, Current: 0 };

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
          handleStatChange(portKey, port);
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
          dev[portKey].Finish = variant.value;
          if (dev[portKey].Finish) stopCharging(portKey, port);
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
      browseName: `${portKey}_Summ`,
      dataType: "Double",
      accessLevel: opcua.AccessLevelFlag.CurrentRead,
      userAccessLevel: opcua.AccessLevelFlag.CurrentRead,
      value: {
        get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: dev[portKey].Summ }),
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

  await server.start();
  console.log(`OPC UA сервер запущен по адресу: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

function handleStatChange(portKey, configPort) {
  switch (dev[portKey].Stat) {
    case 2: // Зарядка началась
      console.log(`Начало зарядки на ${portKey}`);
      controlRelay(configPort.relayPath, true);
      monitorCurrent(portKey, configPort);
      break;

    case 3: // Зарядка завершена
      console.log(`Зарядка завершена на ${portKey}`);
      controlRelay(configPort.relayPath, false);
      break;

    case 4: // Подтверждение завершения
      console.log(`Подтверждение завершения зарядки для ${portKey}`);
      resetPort(portKey);
      break;
  }
}

function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? "1" : "0");
    console.log(`Реле ${path} установлено в состояние ${state ? "включено" : "выключено"}`);
  } catch (err) {
    console.error(`Ошибка управления реле ${path}: ${err.message}`);
  }
}

function resetPort(portKey) {
  dev[portKey] = { Stat: 0, Finish: false, Kwt: 0, Summ: 0, Current: 0 };
  console.log(`Порт ${portKey} сброшен.`);
}

async function monitorCurrent(portKey, configPort) {
  const MIN_CURRENT = 1; // Минимальный ток
  const MAX_CURRENT = 17; // Максимальный ток
  const FALL_TIME = 60000; // Время (мс), в течение которого ток должен оставаться ниже MIN_CURRENT
  const OVERLOAD_TIME = 10000; // Время (мс), в течение которого ток может быть выше MAX_CURRENT

  let startTime = Date.now();
  let highCurrentTime = 0;

  while (dev[portKey].Stat === 2) {
    const current = dev[portKey].Current;

    if (current < MIN_CURRENT) {
      if (Date.now() - startTime > FALL_TIME) {
        console.log(`Ток на ${portKey} ниже ${MIN_CURRENT} А в течение ${FALL_TIME / 1000} секунд. Остановка зарядки.`);
        stopCharging(portKey, configPort);
        return;
      }
    } else {
      startTime = Date.now();
    }

    if (current > MAX_CURRENT) {
      if (highCurrentTime === 0) {
        highCurrentTime = Date.now();
      } else if (Date.now() - highCurrentTime > OVERLOAD_TIME) {
        console.log(`Ток на ${portKey} выше ${MAX_CURRENT} А в течение ${OVERLOAD_TIME / 1000} секунд. Остановка зарядки.`);
        stopCharging(portKey, configPort);
        return;
      }
    } else {
      highCurrentTime = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function stopCharging(portKey, configPort) {
  controlRelay(configPort.relayPath, false);
  dev[portKey].Stat = 3;
  handleStatChange(portKey, configPort);
}

async function startOPCUAUpdateLoop() {
  while (true) {
    for (const port of config.ports) {
      const portKey = `${config.stationName}_port${port.number}`;
      try {
        modbusClient.setID(port.meterAddress);
        const data = await modbusClient.readHoldingRegisters(port.meterRegister, 2);
        const high = data.data[0];
        const low = data.data[1];
        dev[portKey].Kwt = (high << 16) | low;

        const currentData = await modbusClient.readHoldingRegisters(port.currentRegister, 1);
        dev[portKey].Current = currentData.data[0];

        dev[portKey].Summ = dev[portKey].Kwt * config.pricePerKWh;
        console.log(`Обновление данных для ${portKey}: Энергия ${dev[portKey].Kwt} кВт·ч, Ток ${dev[portKey].Current} А`);
      } catch (err) {
        console.error(`Ошибка обновления данных для ${portKey}: ${err.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

(async () => {
  console.log("Инициализация программы...");
  await initializeOPCUAServer();
  console.log("OPC UA сервер запущен.");
  startOPCUAUpdateLoop();
})();

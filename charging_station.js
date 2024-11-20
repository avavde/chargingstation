const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const { ChargePoint } = require("ocpp-js");
const fs = require("fs");

// Загружаем конфигурацию
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const transactionsFile = "./transactions.json";

// Реестр переменных
const dev = {};
config.stations.forEach(station => {
  station.ports.forEach(port => {
    const key = `${station.name}_port${port.number}`;
    dev[key] = { Stat: 0, Finish: 0, Kwt: 0, Summ: 0, Current: 0, transactionId: null };
  });
});

// Конфигурация Modbus
const modbusClient = new ModbusRTU();
modbusClient.connectRTUBuffered(config.modbusPort, {
  baudRate: config.modbusBaudRate,
  dataBits: 8,
  stopBits: 2,
  parity: "none",
});

// Настройка OCPP-сервера
const chargePoints = {};
config.stations.forEach(station => {
  station.ports.forEach(port => {
    const portKey = `${station.name}_port${port.number}`;
    chargePoints[portKey] = new ChargePoint(`Connector${port.number}`, {
      centralSystemUrl: "ws://127.0.0.1:9000",
    });

    setupOCPPHandlers(chargePoints[portKey], station.name, port.number);
  });
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

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Stat`,
        dataType: "Int32",
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Int32, value: dev[portKey].Stat }),
          set: (variant) => {
            dev[portKey].Stat = variant.value;
            handleStatChange(station.name, port.number);
            return opcua.StatusCodes.Good;
          },
        },
      });

      namespace.addVariable({
        componentOf: stationNode,
        browseName: `${portKey}_Finish`,
        dataType: "Boolean",
        value: {
          get: () => new opcua.Variant({ dataType: opcua.DataType.Boolean, value: dev[portKey].Finish }),
          set: (variant) => {
            dev[portKey].Finish = variant.value;
            if (dev[portKey].Finish) handleFinish(station.name, port.number);
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
  console.log(`OPC UA сервер запущен: ${server.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

// Функция цикла обновления OPC UA
function startOPCUAUpdateLoop() {
  setInterval(async () => {
    for (const station of config.stations) {
      for (const port of station.ports) {
        const portKey = `${station.name}_port${port.number}`;
        try {
          const data = await modbusClient.setID(port.meterAddress).readHoldingRegisters(port.meterRegister, 2);
          const high = data.data[0];
          const low = data.data[1];
          dev[portKey].Kwt = (high << 16) | low;

          const currentData = await modbusClient.readHoldingRegisters(port.currentRegister, 1);
          dev[portKey].Current = currentData.data[0];

          console.log(`Обновление OPC UA: ${portKey} - Энергия: ${dev[portKey].Kwt} кВт·ч, Текущий ток: ${dev[portKey].Current} А`);
        } catch (err) {
          console.error(`Ошибка обновления данных для ${portKey}: ${err.message}`);
        }
      }
    }
  }, 1000);
}

// Обработчики OCPP
function setupOCPPHandlers(chargePoint, stationName, portNumber) {
  const portKey = `${stationName}_port${portNumber}`;
  chargePoint.on("BootNotification", (payload, callback) => {
    console.log(`BootNotification получен от ${portKey}`);
    callback({ status: "Accepted", currentTime: new Date().toISOString(), interval: 60 });
  });

  chargePoint.on("Authorize", (payload, callback) => {
    console.log(`Authorize получен от ${portKey}`);
    callback({ idTagInfo: { status: "Accepted" } });
  });

  chargePoint.on("StartTransaction", (payload, callback) => {
    console.log(`Начало транзакции на ${portKey}`);
    const transactionId = Date.now();
    dev[portKey].transactionId = transactionId;
    dev[portKey].Stat = 2;
    handleStatChange(stationName, portNumber);
    callback({ transactionId, idTagInfo: { status: "Accepted" } });
  });

  chargePoint.on("StopTransaction", (payload, callback) => {
    console.log(`Завершение транзакции на ${portKey}`);
    saveTransaction(dev[portKey].transactionId, portKey, {
      energy: dev[portKey].Kwt,
      cost: dev[portKey].Summ,
      timestamp: new Date().toISOString(),
    });
    dev[portKey].Stat = 3;
    handleStatChange(stationName, portNumber);
    callback({ idTagInfo: { status: "Accepted" } });
  });

  chargePoint.on("Heartbeat", (_, callback) => {
    console.log(`Heartbeat получен от ${portKey}`);
    callback({});
  });
}

// Функции управления портами
function handleStatChange(stationName, portNumber) {
  const portKey = `${stationName}_port${portNumber}`;
  const port = dev[portKey];
  const configPort = getConfigPort(stationName, portNumber);

  if (port.Stat === 2) {
    console.log(`Начало зарядки на ${portKey}`);
    controlRelay(configPort.relayPath, true);
    sendStatusNotification(portKey, "Charging");
  } else if (port.Stat === 3) {
    console.log(`Остановка зарядки на ${portKey}`);
    controlRelay(configPort.relayPath, false);
    sendStatusNotification(portKey, "Available");
  } else if (port.Stat === 4) {
    console.log(`Сброс параметров для ${portKey}`);
    resetPort(portKey);
    sendStatusNotification(portKey, "Available");
  }
}

function controlRelay(path, state) {
  fs.writeFileSync(path, state ? "1" : "0");
}

function resetPort(portKey) {
  dev[portKey] = { Stat: 0, Finish: 0, Kwt: 0, Summ: 0, Current: 0, transactionId: null };
  console.log(`${portKey} сброшен.`);
}

// Сохранение транзакции
function saveTransaction(transactionId, portKey, data) {
  const transactions = fs.existsSync(transactionsFile)
    ? JSON.parse(fs.readFileSync(transactionsFile, "utf-8"))
    : [];
  transactions.push({ transactionId, portKey, ...data });
  fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  console.log(`Транзакция ${transactionId} сохранена для ${portKey}`);
}

// Получение конфигурации порта
function getConfigPort(stationName, portNumber) {
  const stationConfig = config.stations.find(station => station.name === stationName);
  return stationConfig.ports.find(port => port.number === portNumber);
}

// Отправка StatusNotification
function sendStatusNotification(portKey, status, errorCode = "NoError") {
  const chargePoint = chargePoints[portKey];
  if (chargePoint) {
    chargePoint.send("StatusNotification", {
      connectorId: parseInt(portKey.split("_port")[1]),
      errorCode,
      status,
      timestamp: new Date().toISOString(),
    });
  }
}

// Запуск программы
(async () => {
  console.log("Инициализация программы...");
  
  // Инициализация OPC UA сервера
  await initializeOPCUAServer();
  console.log("OPC UA сервер запущен.");

  // Подключение к OCPP серверам
  Object.keys(chargePoints).forEach(portKey => {
    const chargePoint = chargePoints[portKey];
    chargePoint.connect().then(() => {
      console.log(`${portKey} подключен к CSMS.`);
      chargePoint.send("BootNotification", {
        chargePointModel: "Model1",
        chargePointVendor: "Vendor1",
      });
    }).catch(err => {
      console.error(`Ошибка подключения OCPP для ${portKey}: ${err.message}`);
    });
  });

  // Запуск цикла обновления данных OPC UA
  startOPCUAUpdateLoop();

  // Запуск отправки MeterValues
  setInterval(() => {
    Object.keys(dev).forEach(portKey => {
      sendMeterValues(portKey);
    });
  }, 5000);
})();

// Отправка MeterValues
function sendMeterValues(portKey) {
  const chargePoint = chargePoints[portKey];
  const port = dev[portKey];
  
  if (chargePoint && port.transactionId) {
    chargePoint.send("MeterValues", {
      connectorId: parseInt(portKey.split("_port")[1]),
      transactionId: port.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            { value: port.Kwt.toString(), context: "Sample.Periodic", measurand: "Energy.Active.Import.Register", unit: "Wh" },
            { value: port.Current.toString(), context: "Sample.Periodic", measurand: "Current.Import", unit: "A" }
          ]
        }
      ]
    });
    console.log(`MeterValues отправлены для ${portKey}: Энергия ${port.Kwt} кВт·ч, Ток ${port.Current} А.`);
  }
}

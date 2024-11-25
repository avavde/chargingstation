const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const { ChargePoint } = require("ocpp");
const fs = require("fs");
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

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
            dev[portKey].Finish = !!variant.value; // Преобразование в boolean
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


// Функция для обновления данных OPC UA
async function startOPCUAUpdateLoop() {
  while (true) {
    if (!modbusClient.isOpen) {
      console.error("Modbus клиент отключен. Пропуск обновления.");
    } else {
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

            console.log(`Обновление OPC UA: ${portKey} - Энергия: ${dev[portKey].Kwt} кВт·ч, Текущий ток: ${dev[portKey].Current} А`);
          } catch (err) {
            console.error(`Ошибка при обновлении данных для ${portKey}: ${err.message}`);
          }
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Обработчики OCPP
function setupOCPPHandlers(chargePoint, stationName, portNumber) {
  const portKey = `${stationName}_port${portNumber}`;

  chargePoint.onRequest = async (command, payload) => {
    console.log(`Получена команда OCPP ${command} для ${portKey}`, payload);
    switch (command) {
      case 'Authorize': {
        return { idTagInfo: { status: 'Accepted' } };
      }

      case 'StartTransaction': {
        console.log(`Начало транзакции на ${portKey}`);
        const transactionId = uuidv4();
        dev[portKey].transactionId = transactionId;
        dev[portKey].Stat = 2;
        handleStatChange(stationName, portNumber);
        return { transactionId, idTagInfo: { status: 'Accepted' } };
      }

      case 'StopTransaction': {
        console.log(`Завершение транзакции на ${portKey}`);
        await saveTransaction(dev[portKey].transactionId, portKey, {
          energy: dev[portKey].Kwt,
          cost: dev[portKey].Summ,
          timestamp: new Date().toISOString(),
        });
        dev[portKey].Stat = 3;
        handleStatChange(stationName, portNumber);
        return { idTagInfo: { status: 'Accepted' } };
      }

      case 'RemoteStartTransaction': {
        const { connectorId } = payload;
        const remotePortKey = `${stationName}_port${connectorId}`;
        if (dev[remotePortKey]) {
          dev[remotePortKey].Stat = 2;
          handleStatChange(stationName, connectorId);
          console.log(`Удаленный запуск транзакции для ${remotePortKey}`);
          return { status: 'Accepted' };
        } else {
          console.error(`Ошибка: Порт ${connectorId} не найден.`);
          return { status: 'Rejected' };
        }
      }

      case 'RemoteStopTransaction': {
        const { transactionId } = payload;
        const remotePortKeyStop = Object.keys(dev).find(
          key => dev[key].transactionId === transactionId
        );
        if (remotePortKeyStop) {
          dev[remotePortKeyStop].Stat = 3;
          handleStatChange(
            stationName,
            remotePortKeyStop.split('_port')[1]
          );
          console.log(`Удаленная остановка транзакции для ${remotePortKeyStop}`);
          return { status: 'Accepted' };
        } else {
          console.error(`Ошибка: Транзакция ${transactionId} не найдена.`);
          return { status: 'Rejected' };
        }
      }

      case 'Heartbeat': {
        console.log(`Heartbeat получен от ${portKey}`);
        return { currentTime: new Date().toISOString() };
      }

      default: {
        console.log(`Необработанная команда OCPP ${command} для ${portKey}`);
        return { status: 'NotSupported' };
      }
    }
  };
}

// Управление реле и состояниями
function handleStatChange(stationName, portNumber) {
  const portKey = `${stationName}_port${portNumber}`;
  const port = dev[portKey];
  const configPort = getConfigPort(stationName, portNumber);

  if (port.Stat === 2) {
    console.log(`Начало зарядки на ${portKey}`);
    controlRelay(configPort.relayPath, true);
    sendStatusNotification(portKey, 'Charging');
  } else if (port.Stat === 3) {
    console.log(`Остановка зарядки на ${portKey}`);
    controlRelay(configPort.relayPath, false);
    sendStatusNotification(portKey, 'Available');
  } else if (port.Stat === 4) {
    console.log(`Сброс параметров для ${portKey}`);
    resetPort(portKey);
    sendStatusNotification(portKey, 'Available');
  }
}

function handleFinish(stationName, portNumber) {
  const portKey = `${stationName}_port${portNumber}`;
  console.log(`Завершение зарядки на ${portKey}`);
  saveTransaction(dev[portKey].transactionId, portKey, {
    energy: dev[portKey].Kwt,
    cost: dev[portKey].Summ,
    timestamp: new Date().toISOString(),
  });
  dev[portKey].Stat = 3;
  handleStatChange(stationName, portNumber);
}

function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? '1' : '0');
    console.log(`Реле ${path} установлено в состояние ${state ? 'включено' : 'выключено'}`);
  } catch (err) {
    console.error(`Ошибка управления реле ${path}: ${err.message}`);
  }
}

function resetPort(portKey) {
  dev[portKey] = { Stat: 0, Finish: false, Kwt: 0, Summ: 0, Current: 0, transactionId: null };
  console.log(`${portKey} сброшен.`);
}

// Сохранение транзакции
const fsPromises = fs.promises;

async function saveTransaction(transactionId, portKey, data) {
  try {
    let transactions = [];
    if (fs.existsSync(transactionsFile)) {
      const fileData = await fsPromises.readFile(transactionsFile, 'utf-8');
      transactions = JSON.parse(fileData);
    }
    transactions.push({ transactionId, portKey, ...data });
    await fsPromises.writeFile(transactionsFile, JSON.stringify(transactions, null, 2));
    console.log(`Транзакция ${transactionId} сохранена для ${portKey}`);
  } catch (err) {
    console.error(`Ошибка сохранения транзакции для ${portKey}: ${err.message}`);
  }
}

// Получение конфигурации порта
function getConfigPort(stationName, portNumber) {
  const stationConfig = config.stations.find(station => station.name === stationName);
  return stationConfig.ports.find(port => port.number === portNumber);
}

// Отправка StatusNotification
function sendStatusNotification(portKey, status, errorCode = 'NoError') {
  const chargePoint = chargePoints[portKey];
  if (chargePoint) {
    chargePoint.sendStatusNotification({
      connectorId: parseInt(portKey.split('_port')[1]),
      status,
      errorCode,
      timestamp: new Date().toISOString(),
    });
    console.log(`StatusNotification отправлен для ${portKey}: Статус ${status}, Ошибка ${errorCode}`);
  } else {
    console.error(`Ошибка отправки StatusNotification для ${portKey}: CSMS не подключен.`);
  }
}

// Отправка MeterValues
function sendMeterValues(portKey) {
  const chargePoint = chargePoints[portKey];
  const port = dev[portKey];

  if (chargePoint && port.transactionId) {
    chargePoint.sendMeterValues({
      connectorId: parseInt(portKey.split('_port')[1]),
      transactionId: port.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            { value: port.Kwt.toString(), context: 'Sample.Periodic', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
            { value: port.Current.toString(), context: 'Sample.Periodic', measurand: 'Current.Import', unit: 'A' }
          ]
        }
      ]
    });
    console.log(`MeterValues отправлены для ${portKey}: Энергия ${port.Kwt} кВт·ч, Ток ${port.Current} А`);
  } else {
    console.error(`Ошибка отправки MeterValues для ${portKey}: CSMS не подключен или транзакция не активна.`);
  }
}

// Запуск программы
(async () => {
  console.log('Инициализация программы...');

  // Инициализация OPC UA сервера
  await initializeOPCUAServer();
  console.log('OPC UA сервер запущен.');

  // Настройка OCPP ChargePoints
  config.stations.forEach(station => {
    station.ports.forEach(port => {
      const portKey = `${station.name}_port${port.number}`;

      // Создаем экземпляр ChargePoint
      const chargePoint = new ChargePoint(`Connector${port.number}`);
      chargePoints[portKey] = chargePoint;

      setupOCPPHandlers(chargePoint, station.name, port.number);

      // Подключаемся к центральной системе
      const csUrl = config.ocpp.centralSystemUrl;
      const ws = new WebSocket(csUrl, {
        perMessageDeflate: false,
        protocol: 'ocpp1.6',
        headers: {
          'Sec-WebSocket-Protocol': 'ocpp1.6'
        }
      });

      chargePoint.connection = ws;

      ws.on('open', () => {
        console.log(`${portKey} подключен к CSMS.`);
        chargePoint.connectionOpened();

        // Отправляем BootNotification
        chargePoint.sendBootNotification({
          chargePointVendor: 'Vendor1',
          chargePointModel: 'Model1'
        });
      });

      ws.on('message', (message) => {
        chargePoint.handleMessage(message);
      });

      ws.on('close', () => {
        console.log(`Соединение для ${portKey} закрыто.`);
        // Здесь можно добавить логику переподключения
      });

      ws.on('error', (error) => {
        console.error(`Ошибка WebSocket для ${portKey}:`, error);
      });
    });
  });

  // Запускаем цикл обновления данных OPC UA
  startOPCUAUpdateLoop();

  // Запускаем отправку MeterValues каждые 5 секунд
  setInterval(() => {
    Object.keys(dev).forEach(portKey => {
      sendMeterValues(portKey);
    });
  }, 5000);
})();

const fs = require("fs");
const ModbusRTU = require("modbus-serial");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { RPCClient } = require("ocpp-rpc");

// Глобальные обработчики необработанных исключений
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    `[${new Date().toISOString()}] Необработанный отказ в промисе:`,
    promise,
    "Причина:",
    reason
  );
});

process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] Необработанное исключение:`, err);
});

// Путь к конфигурационному файлу
const configPath = "./config/ocpp_config.json";

// Проверка существования конфигурационного файла
if (!fs.existsSync(configPath)) {
  console.error(`[${new Date().toISOString()}] Файл конфигурации не найден: ${configPath}`);
  process.exit(1);
}

// Загрузка конфигурации
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(
    `[${new Date().toISOString()}] Конфигурация успешно загружена:`,
    JSON.stringify(config, null, 2)
  );
} catch (error) {
  console.error(`[${new Date().toISOString()}] Ошибка при чтении конфигурации: ${error.message}`);
  process.exit(1);
}

// Инициализация переменных
const dev = {};

// Создание OCPP-клиента
let client;
try {
  client = new RPCClient({
    endpoint: config.centralSystemUrl,
    identity: config.stationName,
    protocols: ["ocpp1.6"],
  });
  console.log(`[${new Date().toISOString()}] OCPP-клиент создан с настройками:`, {
    endpoint: config.centralSystemUrl,
    identity: config.stationName,
    protocols: ["ocpp1.6"],
  });
} catch (error) {
  console.error(`[${new Date().toISOString()}] Ошибка создания OCPP-клиента: ${error.message}`);
  process.exit(1);
}

// Логирование всех событий клиента
client.on("open", () => {
  console.log(`[${new Date().toISOString()}] Соединение с центральной системой установлено.`);
});

client.on("close", () => {
  console.log(`[${new Date().toISOString()}] Соединение с центральной системой закрыто.`);
});

client.on("error", (error) => {
  console.error(`[${new Date().toISOString()}] Ошибка OCPP-клиента: ${error.message}`);
});

// Логирование всех входящих и исходящих сообщений
client.on("request", (request) => {
  console.log(`[${new Date().toISOString()}] [REQUEST]:`, JSON.stringify(request, null, 2));
});

client.on("response", (response) => {
  console.log(`[${new Date().toISOString()}] [RESPONSE]:`, JSON.stringify(response, null, 2));
});

client.on("call", (call) => {
  console.log(`[${new Date().toISOString()}] [CALL]:`, JSON.stringify(call, null, 2));
});

client.on("result", (result) => {
  console.log(`[${new Date().toISOString()}] [RESULT]:`, JSON.stringify(result, null, 2));
});

// Добавляем обработчик для всех сообщений
client.on("message", (message) => {
  console.log(`[${new Date().toISOString()}] [MESSAGE]:`, message);
});

// Функция управления реле
function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? "1" : "0");
    console.log(
      `[${new Date().toISOString()}] Реле ${path} установлено в состояние ${
        state ? "включено" : "выключено"
      }`
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Ошибка управления реле ${path}: ${error.message}`
    );
  }
}

// Подключение к Modbus и инициализация разъёмов
const modbusClient = new ModbusRTU();

modbusClient.connectRTUBuffered(
  config.modbusPort,
  {
    baudRate: config.modbusBaudRate,
    dataBits: 8,
    stopBits: 2,
    parity: "none",
  },
  async (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Ошибка подключения к Modbus: ${err.message}`);
      process.exit(1);
    } else {
      console.log(`[${new Date().toISOString()}] Modbus успешно подключен.`);

      // Инициализация состояния разъемов после подключения к Modbus
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        dev[connectorKey] = {
          Stat: 0,
          Finish: false,
          Kwt: 0,
          Summ: 0,
          Current: 0,
          transactionId: null,
          status: "Available",
          availability: "Operative", // Добавлено свойство availability
          meterSerialNumber: null,
        };
        try {
          dev[connectorKey].meterSerialNumber = await readMeterSerialNumber(connector);
          console.log(
            `[${new Date().toISOString()}] Разъем ${connector.id} успешно инициализирован:`,
            dev[connectorKey]
          );
        } catch (readError) {
          console.error(
            `[${new Date().toISOString()}] Ошибка чтения серийного номера для разъема ${connector.id}: ${readError.message}`
          );
          // Серийный номер останется null
        }
      }

      // Теперь можем подключиться к OCPP и запустить основной цикл
      await startOCPPClient();
    }
  }
);

// Функция чтения серийного номера счётчика
async function readMeterSerialNumber(connector) {
  try {
    modbusClient.setID(connector.meterAddress);
    const serialNumberData = await modbusClient.readHoldingRegisters(
      connector.serialNumberRegister,
      4
    ); // Предполагаем, что серийный номер занимает 4 регистра
    const buffer = Buffer.alloc(8);
    for (let i = 0; i < 4; i++) {
      buffer.writeUInt16BE(serialNumberData.data[i], i * 2);
    }
    const serialNumber = buffer.toString("ascii").trim();
    return serialNumber;
  } catch (error) {
    throw new Error(`Ошибка чтения серийного номера: ${error.message}`);
  }
}

// Функция чтения информации о модеме (ICCID и IMSI)
async function getModemInfo() {
  return new Promise((resolve) => {
    const port = new SerialPort({ path: config.modemPort, baudRate: 115200 });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
    let iccid = null;
    let imsi = null;

    parser.on("data", (line) => {
      line = line.trim();
      if (line.includes("CCID")) {
        iccid = line.split(":")[1].trim();
      }
      if (/^\d{15}$/.test(line)) {
        imsi = line;
      }
      if (iccid && imsi) {
        port.close();
        resolve({ iccid, imsi });
      }
    });

    port.on("open", () => {
      port.write("AT+CCID\r");
      setTimeout(() => {
        port.write("AT+CIMI\r");
      }, 500);
    });

    port.on("error", (err) => {
      console.error(`[${new Date().toISOString()}] Ошибка чтения данных модема: ${err.message}`);
      resolve({ iccid: null, imsi: null });
    });
  });
}

// Функция запуска OCPP-клиента и основного цикла
async function startOCPPClient() {
  console.log(`[${new Date().toISOString()}] Функция startOCPPClient() вызвана.`);
  try {
    console.log(`[${new Date().toISOString()}] Попытка подключения к центральной системе OCPP...`);
    await client.connect();
    console.log(`[${new Date().toISOString()}] OCPP-клиент успешно запущен.`);
    // Запускаем функцию обновления Modbus
    updateModbusData();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка запуска OCPP-клиента: ${error.message}`);
  }
}

// Отправка BootNotification
client.on("open", async () => {
  console.log(`[${new Date().toISOString()}] Отправка BootNotification...`);
  try {
    // Получение информации о модеме
    let modemInfo = { iccid: null, imsi: null };
    try {
      modemInfo = await getModemInfo();
      console.log(`[${new Date().toISOString()}] Информация о модеме:`, modemInfo);
    } catch (modemError) {
      console.error(
        `[${new Date().toISOString()}] Не удалось получить информацию о модеме: ${modemError.message}`
      );
    }

    // Собираем серийные номера счетчиков
    const meterSerialNumbers = config.connectors.map((connector) => {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      return dev[connectorKey]?.meterSerialNumber || "Unknown";
    });

    const bootPayload = {
      chargePointVendor: config.vendor,
      chargePointModel: config.model,
      chargePointSerialNumber: config.stationName,
      firmwareVersion: "1.0",
      meterSerialNumber: meterSerialNumbers.join(","),
    };

    // Добавляем информацию о модеме, если она доступна
    if (modemInfo.iccid) {
      bootPayload.iccid = modemInfo.iccid;
    }
    if (modemInfo.imsi) {
      bootPayload.imsi = modemInfo.imsi;
    }

    const bootResponse = await client.call("BootNotification", bootPayload);
    console.log(
      `[${new Date().toISOString()}] BootNotification отправлен. Ответ:`,
      JSON.stringify(bootResponse, null, 2)
    );

    if (bootResponse.status === "Accepted") {
      console.log(`[${new Date().toISOString()}] BootNotification принят.`);
      // Отправка StatusNotification для каждого коннектора
      await sendInitialStatusNotifications();
      setInterval(() => sendHeartbeat(), bootResponse.interval * 1000 || 60000);
    } else {
      console.error(`[${new Date().toISOString()}] BootNotification отклонен.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки BootNotification: ${error.message}`);
  }
});

// Функция отправки начальных StatusNotification
async function sendInitialStatusNotifications() {
  // Отправка StatusNotification для ConnectorId 0 (общий статус станции)
  await sendStatusNotification(0, "Available", "NoError");
  // Отправка StatusNotification для каждого коннектора
  for (const connector of config.connectors) {
    const connectorKey = `${config.stationName}_connector${connector.id}`;
    const status = dev[connectorKey].status;
    await sendStatusNotification(connector.id, status, "NoError");
  }
}

// Функция отправки StatusNotification
async function sendStatusNotification(connectorId, status, errorCode) {
  try {
    const connectorKey = `${config.stationName}_connector${connectorId}`;
    const response = await client.call("StatusNotification", {
      connectorId,
      status,
      errorCode,
      timestamp: new Date().toISOString(),
      info: dev[connectorKey]?.meterSerialNumber || "Unknown",
    });
    console.log(
      `[${new Date().toISOString()}] StatusNotification отправлен для коннектора ${connectorId}. Ответ:`,
      JSON.stringify(response, null, 2)
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Ошибка отправки StatusNotification для коннектора ${connectorId}: ${error.message}`
    );
  }
}

// Отправка Heartbeat
async function sendHeartbeat() {
  try {
    const response = await client.call("Heartbeat", {});
    console.log(
      `[${new Date().toISOString()}] Heartbeat отправлен. Ответ:`,
      JSON.stringify(response, null, 2)
    );
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки Heartbeat: ${error.message}`);
  }
}

// Обработчики сообщений OCPP
// Добавьте здесь все обработчики, которые были описаны ранее
// Например, обработчик GetConfiguration
client.handle("GetConfiguration", async (payload) => {
  console.log(`[${new Date().toISOString()}] GetConfiguration получен:`, payload);

  const { key } = payload;
  const configurationKey = [];
  const unknownKey = [];

  // Если ключи не указаны, возвращаем все возможные настройки
  if (!key || key.length === 0) {
    // Здесь мы можем добавить все доступные настройки станции
    configurationKey.push(
      {
        key: "AllowOfflineTxForUnknownId",
        readonly: false,
        value: "false",
      },
      {
        key: "AuthorizationCacheEnabled",
        readonly: false,
        value: "true",
      }
      // Добавьте другие настройки по необходимости
    );
  } else {
    // Возвращаем только запрошенные ключи
    for (const k of key) {
      // Предположим, что у нас есть только два ключа
      if (k === "AllowOfflineTxForUnknownId") {
        configurationKey.push({
          key: "AllowOfflineTxForUnknownId",
          readonly: false,
          value: "false",
        });
      } else if (k === "AuthorizationCacheEnabled") {
        configurationKey.push({
          key: "AuthorizationCacheEnabled",
          readonly: false,
          value: "true",
        });
      } else {
        unknownKey.push(k);
      }
    }
  }

  return { configurationKey, unknownKey };
});

// Добавьте остальные обработчики, как было описано в предыдущих сообщениях
// Например, обработчики ChangeAvailability, ChangeConfiguration, RemoteStartTransaction и т.д.

// Функция для начала транзакции
async function startTransaction(connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  dev[connectorKey].transactionId = Date.now();
  dev[connectorKey].status = "Charging";
  dev[connectorKey].idTag = idTag;

  // Управляем реле для начала зарядки
  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, true);

  // Отправляем StartTransaction
  const response = await client.call("StartTransaction", {
    connectorId,
    idTag,
    meterStart: Math.round(dev[connectorKey].Kwt * 1000), // Предполагаем, что значение в ватт-часах
    timestamp: new Date().toISOString(),
  });

  dev[connectorKey].transactionId = response.transactionId;

  // Отправляем StatusNotification
  await sendStatusNotification(connectorId, "Charging", "NoError");
}

// Функция для остановки транзакции
async function stopTransaction(connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const transactionId = dev[connectorKey].transactionId;
  const idTag = dev[connectorKey].idTag;

  if (!transactionId) {
    console.error(`[${new Date().toISOString()}] Нет активной транзакции на разъеме ${connectorId}`);
    return;
  }

  // Управляем реле для остановки зарядки
  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, false);

  // Отправляем StopTransaction
  await client.call("StopTransaction", {
    transactionId,
    idTag,
    meterStop: Math.round(dev[connectorKey].Kwt * 1000),
    timestamp: new Date().toISOString(),
  });

  // Обновляем статус
  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = "Available";

  // Отправляем StatusNotification
  await sendStatusNotification(connectorId, "Available", "NoError");
}

// обработчик RemoteStartTransaction
client.handle("RemoteStartTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] RemoteStartTransaction получен:`, payload);

  const connectorId = payload.connectorId || 1; // Если connectorId не указан, используем 1
  const idTag = payload.idTag || "Unknown";

  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connector = config.connectors.find((c) => c.id === connectorId);

  if (!connector) {
    console.error(`[${new Date().toISOString()}] Разъем с ID ${connectorId} не найден.`);
    return { status: "Rejected" };
  }

  // Проверяем, доступен ли разъем
  if (dev[connectorKey].status !== "Available") {
    console.error(`[${new Date().toISOString()}] Разъем ${connectorId} недоступен для зарядки.`);
    return { status: "Rejected" };
  }

  // Начинаем транзакцию
  await startTransaction(connectorId, idTag);

  return { status: "Accepted" };
});

// обработчик RemoteStopTransaction
client.handle("RemoteStopTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] RemoteStopTransaction получен:`, payload);

  const { transactionId } = payload;
  const connector = config.connectors.find(
    (c) => dev[`${config.stationName}_connector${c.id}`].transactionId === transactionId
  );

  if (!connector) {
    console.error(`[${new Date().toISOString()}] Транзакция с ID ${transactionId} не найдена.`);
    return { status: "Rejected" };
  }

  await stopTransaction(connector.id);

  return { status: "Accepted" };
});


// Функция отправки MeterValues
async function sendMeterValues(connectorId) {
  try {
    const connectorKey = `${config.stationName}_connector${connectorId}`;
    if (!dev[connectorKey].transactionId) {
      return; // Если транзакция не запущена, не отправляем MeterValues
    }
    const response = await client.call("MeterValues", {
      connectorId,
      transactionId: dev[connectorKey].transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            {
              value: dev[connectorKey].Kwt.toString(),
              context: "Sample.Periodic",
              format: "Raw",
              measurand: "Energy.Active.Import.Register",
              unit: "kWh",
            },
          ],
        },
      ],
    });
    console.log(
      `[${new Date().toISOString()}] MeterValues отправлен для коннектора ${connectorId}. Ответ:`,
      JSON.stringify(response, null, 2)
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Ошибка отправки MeterValues для коннектора ${connectorId}: ${error.message}`
    );
  }
}



// Обработчик данных Modbus
async function updateModbusData() {
  console.log(`[${new Date().toISOString()}] Запуск функции updateModbusData()`);
  while (true) {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        modbusClient.setID(connector.meterAddress);

        const energyData = await modbusClient.readHoldingRegisters(connector.meterRegister, 2);
        dev[connectorKey].Kwt = ((energyData.data[0] << 16) | energyData.data[1]) / 1000;

        const currentData = await modbusClient.readHoldingRegisters(connector.currentRegister, 1);
        dev[connectorKey].Current = currentData.data[0];

        dev[connectorKey].Summ = dev[connectorKey].Kwt * config.pricePerKwh;

        console.log(
          `[${new Date().toISOString()}] Разъем: ${connector.id}, Энергия: ${
            dev[connectorKey].Kwt
          } кВт·ч, Ток: ${dev[connectorKey].Current} А, Сумма: ${dev[connectorKey].Summ} руб.`
        );

        // Отправка MeterValues
        await sendMeterValues(connector.id);
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Ошибка обновления данных разъема ${connector.id}: ${error.message}`
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Обработчик FirmwareStatusNotification
async function sendFirmwareStatusNotification(status) {
  try {
    const response = await client.call("FirmwareStatusNotification", {
      status,
      timestamp: new Date().toISOString(),
    });
    console.log(
      `[${new Date().toISOString()}] FirmwareStatusNotification отправлен со статусом ${status}. Ответ:`,
      JSON.stringify(response, null, 2)
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Ошибка отправки FirmwareStatusNotification: ${error.message}`
    );
  }
}


// Запуск обновления Modbus и подключение к OCPP
(async () => {
  try {
    await client.connect();
    console.log(`[${new Date().toISOString()}] OCPP-клиент успешно запущен.`);
    updateModbusData();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка запуска OCPP-клиента: ${error.message}`);
  }
})();


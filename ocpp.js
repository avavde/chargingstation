const fs = require("fs");
const ModbusRTU = require("modbus-serial");
const SerialPort = require("serialport");
const Readline = require("@serialport/parser-readline");
const { RPCClient } = require("ocpp-rpc");

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
  console.log(`[${new Date().toISOString()}] Конфигурация успешно загружена:`, JSON.stringify(config, null, 2));
} catch (error) {
  console.error(`[${new Date().toISOString()}] Ошибка при чтении конфигурации: ${error.message}`);
  process.exit(1);
}

// Инициализация переменных
const dev = {};

// Подключение к Modbus
const modbusClient = new ModbusRTU();
modbusClient.connectRTUBuffered(
  config.modbusPort,
  {
    baudRate: config.modbusBaudRate,
    dataBits: 8,
    stopBits: 2,
    parity: "none",
  },
  (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Ошибка подключения к Modbus: ${err.message}`);
      process.exit(1);
    } else {
      console.log(`[${new Date().toISOString()}] Modbus успешно подключен.`);
    }
  }
);

// Функция чтения серийного номера счётчика
async function readMeterSerialNumber(connector) {
  try {
    modbusClient.setID(connector.meterAddress);
    const serialNumberData = await modbusClient.readHoldingRegisters(connector.serialNumberRegister, 4); // Предполагаем, что серийный номер занимает 4 регистра
    const buffer = Buffer.alloc(8);
    for (let i = 0; i < 4; i++) {
      buffer.writeUInt16BE(serialNumberData.data[i], i * 2);
    }
    const serialNumber = buffer.toString("ascii").trim();
    return serialNumber;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка чтения серийного номера счётчика для разъема ${connector.id}: ${error.message}`);
    return null;
  }
}

// Инициализация состояния разъемов
(async () => {
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
      meterSerialNumber: null,
    };
    dev[connectorKey].meterSerialNumber = await readMeterSerialNumber(connector);
    console.log(`[${new Date().toISOString()}] Разъем ${connector.id} успешно инициализирован:`, dev[connectorKey]);
  }
})();

// Функция чтения информации о модеме (ICCID и IMSI)
async function getModemInfo() {
  return new Promise((resolve, reject) => {
    const port = new SerialPort(config.modemPort, { baudRate: 115200 });
    const parser = port.pipe(new Readline({ delimiter: "\r\n" }));
    let iccid = null;
    let imsi = null;

    parser.on("data", (line) => {
      if (line.includes("CCID")) {
        iccid = line.split(":")[1].trim();
      }
      if (/^\d{15}$/.test(line.trim())) {
        imsi = line.trim();
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
      reject(err);
    });
  });
}

// Создание OCPP-клиента
const client = new RPCClient({
  endpoint: config.centralSystemUrl,
  identity: config.stationName,
  protocols: ["ocpp1.6"],
});

console.log(`[${new Date().toISOString()}] OCPP-клиент создан с настройками:`, {
  endpoint: config.centralSystemUrl,
  identity: config.stationName,
  protocols: ["ocpp1.6"],
});

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
    console.log(`[${new Date().toISOString()}] Реле ${path} установлено в состояние ${state ? "включено" : "выключено"}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка управления реле ${path}: ${error.message}`);
  }
}

// Отправка BootNotification
client.on("open", async () => {
  console.log(`[${new Date().toISOString()}] Отправка BootNotification...`);
  try {
    // Получение информации о модеме
    const modemInfo = await getModemInfo();
    console.log(`[${new Date().toISOString()}] Информация о модеме:`, modemInfo);

    // Собираем серийные номера счетчиков
    const meterSerialNumbers = config.connectors.map((connector) => {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      return dev[connectorKey].meterSerialNumber || "Unknown";
    });

    const bootResponse = await client.call("BootNotification", {
      chargePointVendor: config.vendor,
      chargePointModel: config.model,
      chargePointSerialNumber: config.stationName,
      firmwareVersion: "1.0",
      iccid: modemInfo.iccid,
      imsi: modemInfo.imsi,
      meterSerialNumber: meterSerialNumbers.join(","),
    });
    console.log(`[${new Date().toISOString()}] BootNotification отправлен. Ответ:`, JSON.stringify(bootResponse, null, 2));

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
    await sendStatusNotification(connector.id, "Available", "NoError");
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
    console.log(`[${new Date().toISOString()}] StatusNotification отправлен для коннектора ${connectorId}. Ответ:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки StatusNotification для коннектора ${connectorId}: ${error.message}`);
  }
}

// Отправка Heartbeat
async function sendHeartbeat() {
  try {
    const response = await client.call("Heartbeat", {});
    console.log(`[${new Date().toISOString()}] Heartbeat отправлен. Ответ:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки Heartbeat: ${error.message}`);
  }
}

// Обработчики OCPP-сообщений от центральной системы
client.handle("RemoteStartTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] RemoteStartTransaction получен:`, payload);

  const connectorId = payload.connectorId || 1; // Если connectorId не указан, используем 1
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connector = config.connectors.find((c) => c.id === connectorId);

  if (!connector) {
    console.error(`[${new Date().toISOString()}] Разъем с ID ${connectorId} не найден.`);
    return { status: "Rejected" };
  }

  // Проверка, доступен ли разъем
  if (dev[connectorKey].status !== "Available") {
    console.error(`[${new Date().toISOString()}] Разъем ${connectorId} недоступен.`);
    return { status: "Rejected" };
  }

  // Запуск транзакции
  dev[connectorKey].Stat = 2;
  dev[connectorKey].transactionId = Date.now();
  dev[connectorKey].status = "Charging";
  controlRelay(connector.relayPath, true);

  // Отправка StatusNotification с обновленным статусом
  await sendStatusNotification(connectorId, "Occupied", "NoError");

  // Отправка ответа центральной системе
  return { status: "Accepted" };
});

client.handle("RemoteStopTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] RemoteStopTransaction получен:`, payload);

  const transactionId = payload.transactionId;
  const connector = config.connectors.find((c) => dev[`${config.stationName}_connector${c.id}`].transactionId === transactionId);

  if (!connector) {
    console.error(`[${new Date().toISOString()}] Транзакция с ID ${transactionId} не найдена.`);
    return { status: "Rejected" };
  }

  const connectorKey = `${config.stationName}_connector${connector.id}`;

  // Остановка транзакции
  dev[connectorKey].Stat = 3;
  dev[connectorKey].status = "Available";
  controlRelay(connector.relayPath, false);

  // Отправка StatusNotification с обновленным статусом
  await sendStatusNotification(connector.id, "Available", "NoError");

  // Отправка ответа центральной системе
  return { status: "Accepted" };
});

client.handle("UnlockConnector", async (payload) => {
  console.log(`[${new Date().toISOString()}] UnlockConnector получен:`, payload);

  const connectorId = payload.connectorId;
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connector = config.connectors.find((c) => c.id === connectorId);

  if (!connector) {
    console.error(`[${new Date().toISOString()}] Разъем с ID ${connectorId} не найден.`);
    return { status: "Unlocked" };
  }

  // Здесь можно добавить логику разблокировки разъема
  console.log(`[${new Date().toISOString()}] Разъем ${connectorId} разблокирован.`);

  return { status: "Unlocked" };
});

client.handle("Reset", async (payload) => {
  console.log(`[${new Date().toISOString()}] Reset получен:`, payload);

  const type = payload.type; // "Hard" или "Soft"

  // Отправка подтверждения
  setTimeout(() => {
    process.exit(0); // Перезапуск приложения
  }, 1000);

  return { status: "Accepted" };
});

client.handle("ChangeConfiguration", async (payload) => {
  console.log(`[${new Date().toISOString()}] ChangeConfiguration получен:`, payload);

  const { key, value } = payload;

  // Здесь вы можете реализовать изменение конфигурации
  // Например, обновить конфигурационный файл и перезагрузить приложение

  console.log(`[${new Date().toISOString()}] Параметр ${key} изменен на ${value}.`);

  return { status: "Accepted" };
});

// Обработчик данных Modbus
async function updateModbusData() {
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
          `[${new Date().toISOString()}] Разъем: ${connector.id}, Энергия: ${dev[connectorKey].Kwt} кВт·ч, Ток: ${dev[connectorKey].Current} А, Сумма: ${dev[connectorKey].Summ} руб.`
        );

        // Отправка MeterValues
        await sendMeterValues(connector.id);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Ошибка обновления данных разъема ${connector.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

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
    console.log(`[${new Date().toISOString()}] MeterValues отправлен для коннектора ${connectorId}. Ответ:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки MeterValues для коннектора ${connectorId}: ${error.message}`);
  }
}

// Обработка команды UpdateFirmware
client.handle("UpdateFirmware", async (payload) => {
  console.log(`[${new Date().toISOString()}] UpdateFirmware получен:`, payload);

  // Здесь вы можете реализовать логику загрузки и обновления ПО
  // Например, загрузить файл по URL и запустить процесс обновления

  // Для простоты, мы имитируем успешное начало обновления
  setTimeout(async () => {
    // Отправляем FirmwareStatusNotification со статусом "Downloading"
    await sendFirmwareStatusNotification("Downloading");

    // Имитация загрузки и обновления
    setTimeout(async () => {
      // Отправляем FirmwareStatusNotification со статусом "Installing"
      await sendFirmwareStatusNotification("Installing");

      // Имитация завершения обновления
      setTimeout(async () => {
        // Отправляем FirmwareStatusNotification со статусом "Installed"
        await sendFirmwareStatusNotification("Installed");
      }, 5000);
    }, 5000);
  }, 1000);

  return {};
});

// Функция отправки FirmwareStatusNotification
async function sendFirmwareStatusNotification(status) {
  try {
    const response = await client.call("FirmwareStatusNotification", {
      status,
      timestamp: new Date().toISOString(),
    });
    console.log(`[${new Date().toISOString()}] FirmwareStatusNotification отправлен со статусом ${status}. Ответ:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки FirmwareStatusNotification: ${error.message}`);
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

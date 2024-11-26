const fs = require("fs");
const ModbusRTU = require("modbus-serial");
const { RPCClient } = require("ocpp-rpc");

// Путь к конфигурационному файлу
const configPath = "./config/ocpp_config.json";

// Проверка наличия файла конфигурации
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
  console.error(`[${new Date().toISOString()}] Ошибка чтения конфигурации: ${error.message}`);
  process.exit(1);
}

// Инициализация состояния разъемов
const dev = {};
config.connectors.forEach((connector) => {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  dev[connectorKey] = {
    Stat: 0,
    Finish: false,
    Kwt: 0,
    Summ: 0,
    Current: 0,
    transactionId: null,
  };
  console.log(`[${new Date().toISOString()}] Разъем ${connector.id} успешно инициализирован:`, dev[connectorKey]);
});

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

// Создание клиента OCPP
const client = new RPCClient({
  endpoint: config.centralSystemUrl,
  identity: config.stationName,
  protocols: ["ocpp1.6"],
  strictMode: true,
});

console.log(`[${new Date().toISOString()}] OCPP-клиент создан с настройками:`, {
  endpoint: config.centralSystemUrl,
  identity: config.stationName,
  protocols: ["ocpp1.6"],
});

// Обработчик события подключения
client.on("open", async () => {
  console.log(`[${new Date().toISOString()}] Соединение с центральной системой установлено.`);

  // Отправка BootNotification
  try {
    const bootResponse = await client.call("BootNotification", {
      chargePointVendor: "MyVendor",
      chargePointModel: "MyModel",
      chargePointSerialNumber: config.stationName,
      firmwareVersion: "1.0",
    });
    console.log(`[${new Date().toISOString()}] BootNotification отправлен. Ответ:`, JSON.stringify(bootResponse, null, 2));

    if (bootResponse.status === "Accepted") {
      // Отправка начальных StatusNotification
      await sendInitialStatusNotifications();

      // Запуск отправки Heartbeat
      const heartbeatInterval = bootResponse.interval * 1000 || 60000; // По умолчанию 60 секунд
      setInterval(sendHeartbeat, heartbeatInterval);
    } else {
      console.error(`[${new Date().toISOString()}] BootNotification отклонен центральной системой.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка при отправке BootNotification: ${error.message}`);
  }
});

client.on("close", () => {
  console.log(`[${new Date().toISOString()}] Соединение с центральной системой закрыто.`);
});

client.on("error", (error) => {
  console.error(`[${new Date().toISOString()}] Ошибка OCPP-клиента: ${error.message}`);
});

// Логирование всех сообщений
client.on("message", (direction, message) => {
  console.log(`[${new Date().toISOString()}] [${direction.toUpperCase()}]:`, JSON.stringify(message, null, 2));
});

// Отправка начальных сообщений StatusNotification
async function sendInitialStatusNotifications() {
  for (const connector of config.connectors) {
    try {
      const statusResponse = await client.call("StatusNotification", {
        connectorId: connector.id,
        status: "Available",
        errorCode: "NoError",
        timestamp: new Date().toISOString(),
      });
      console.log(`[${new Date().toISOString()}] StatusNotification отправлен для разъема ${connector.id}. Ответ:`, JSON.stringify(statusResponse, null, 2));
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Ошибка при отправке StatusNotification для разъема ${connector.id}: ${error.message}`);
    }
  }
}

// Отправка сообщения Heartbeat
async function sendHeartbeat() {
  try {
    const heartbeatResponse = await client.call("Heartbeat", {});
    console.log(`[${new Date().toISOString()}] Heartbeat отправлен. Ответ:`, JSON.stringify(heartbeatResponse, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка при отправке Heartbeat: ${error.message}`);
  }
}

// Управление реле
function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? "1" : "0");
    console.log(`[${new Date().toISOString()}] Реле ${path} установлено в состояние ${state ? "включено" : "выключено"}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка управления реле ${path}: ${error.message}`);
  }
}

// Обработчик Heartbeat
client.handle("Heartbeat", async () => {
  console.log(`[${new Date().toISOString()}] Heartbeat получен.`);
  return { currentTime: new Date().toISOString() };
});

// Цикл обновления данных Modbus
async function startDataUpdateLoop() {
  while (true) {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        modbusClient.setID(connector.meterAddress);

        // Чтение энергии
        const energyData = await modbusClient.readHoldingRegisters(connector.meterRegister, 2);
        dev[connectorKey].Kwt = ((energyData.data[0] << 16) | energyData.data[1]) / 1000;

        // Чтение тока
        const currentData = await modbusClient.readHoldingRegisters(connector.currentRegister, 1);
        dev[connectorKey].Current = currentData.data[0];

        // Обновление суммы
        dev[connectorKey].Summ = dev[connectorKey].Kwt * config.pricePerKwh;

        console.log(
          `[${new Date().toISOString()}] Разъем: ${connector.id}, Энергия: ${dev[connectorKey].Kwt} кВт·ч, Ток: ${dev[connectorKey].Current} А, Сумма: ${dev[connectorKey].Summ} руб.`
        );
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Ошибка обновления данных разъема ${connector.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Запуск OCPP-клиента и цикла обновления
(async () => {
  try {
    console.log(`[${new Date().toISOString()}] Подключение к центральной системе...`);
    await client.connect();
    console.log(`[${new Date().toISOString()}] OCPP-клиент успешно запущен.`);
    startDataUpdateLoop();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка при запуске OCPP-клиента: ${error.message}`);
  }
})();

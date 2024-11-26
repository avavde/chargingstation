const fs = require("fs");
const ModbusRTU = require("modbus-serial");
const { RPCClient } = require("ocpp-rpc");

// Путь к конфигурационному файлу
const configPath = "./config/ocpp_config.json";

// Проверка конфигурационного файла
if (!fs.existsSync(configPath)) {
  console.error(`Файл конфигурации не найден: ${configPath}`);
  process.exit(1);
}

// Загрузка конфигурации
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (error) {
  console.error("Ошибка чтения конфигурации:", error.message);
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
      console.error(`[${new Date().toISOString()}] Ошибка подключения к Modbus:`, err.message);
      process.exit(1);
    } else {
      console.log(`[${new Date().toISOString()}] Modbus подключен.`);
    }
  }
);

// Инициализация состояния разъемов
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
});

// Создание OCPP-клиента
const client = new RPCClient({
  endpoint: config.centralSystemUrl,
  identity: config.stationName,
  protocols: ["ocpp1.6"],
  strictMode: true,
});

// Добавление PIN-кода и информации о разъемах в BootNotification
client.handle("BootNotification", async () => {
  console.log(`[${new Date().toISOString()}] BootNotification отправлен.`);
  return {
    status: "Accepted",
    currentTime: new Date().toISOString(),
    interval: 300,
    additionalInfo: {
      pinCode: config.pinCode,
      connectors: config.connectors.map((connector) => ({
        id: connector.id,
        type: connector.typeNumber,
      })),
    },
  };
});

// Управление реле
function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? "1" : "0");
    console.log(`[${new Date().toISOString()}] Реле ${path} установлено в состояние ${state ? "включено" : "выключено"}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка управления реле ${path}: ${error.message}`);
  }
}

// Логирование сообщений
client.on("message", (direction, message) => {
  console.log(`[${new Date().toISOString()}] [${direction.toUpperCase()}]:`, JSON.stringify(message, null, 2));
});

// Обработчик Authorize
client.handle("Authorize", async (payload) => {
  console.log(`[${new Date().toISOString()}] Authorize получен с ID: ${payload.idTag}`);
  return { idTagInfo: { status: "Accepted" } };
});

// Обработчик StartTransaction
client.handle("StartTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] StartTransaction получен:`, payload);
  const connectorKey = `${config.stationName}_connector${payload.connectorId}`;
  const connector = config.connectors.find((c) => c.id === payload.connectorId);
  if (!connector) {
    console.error(`[${new Date().toISOString()}] Разъем с ID ${payload.connectorId} не найден.`);
    return { idTagInfo: { status: "Rejected" } };
  }

  dev[connectorKey].Stat = 2;
  dev[connectorKey].transactionId = payload.meterStart || Date.now();
  controlRelay(connector.relayPath, true);

  console.log(`[${new Date().toISOString()}] Зарядка начата на разъеме ${payload.connectorId}`);
  return {
    transactionId: dev[connectorKey].transactionId,
    idTagInfo: { status: "Accepted" },
  };
});

// Обработчик StopTransaction
client.handle("StopTransaction", async (payload) => {
  console.log(`[${new Date().toISOString()}] StopTransaction получен:`, payload);
  const connectorKey = `${config.stationName}_connector${payload.connectorId}`;
  const connector = config.connectors.find((c) => c.id === payload.connectorId);
  if (!connector) {
    console.error(`[${new Date().toISOString()}] Разъем с ID ${payload.connectorId} не найден.`);
    return { idTagInfo: { status: "Rejected" } };
  }

  dev[connectorKey].Stat = 3;
  controlRelay(connector.relayPath, false);

  console.log(`[${new Date().toISOString()}] Зарядка остановлена на разъеме ${payload.connectorId}`);
  return {
    idTagInfo: { status: "Accepted" },
  };
});

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
    await client.connect();
    console.log(`[${new Date().toISOString()}] OCPP-клиент запущен.`);
    startDataUpdateLoop();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка запуска OCPP-клиента: ${error.message}`);
  }
})();

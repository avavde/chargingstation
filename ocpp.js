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
const chargePoints = {};
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
      console.error("Ошибка подключения к Modbus:", err.message);
      process.exit(1);
    } else {
      console.log("Modbus подключен.");
    }
  }
);

// Инициализация состояния портов
config.ports.forEach((port) => {
  const portKey = `${config.stationName}_port${port.number}`;
  dev[portKey] = {
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

// Управление реле
function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? "1" : "0");
    console.log(`Реле ${path} установлено в состояние ${state ? "включено" : "выключено"}`);
  } catch (error) {
    console.error(`Ошибка управления реле ${path}: ${error.message}`);
  }
}

// Логирование событий клиента
client.on("open", () => {
  console.log("Соединение с центральной системой установлено.");
});

client.on("close", () => {
  console.log("Соединение с центральной системой закрыто.");
});

client.on("error", (error) => {
  console.error("Ошибка OCPP-клиента:", error.message);
});

// Обработчик BootNotification
client.handle("BootNotification", async () => {
  console.log("BootNotification отправлен.");
  return {
    status: "Accepted",
    currentTime: new Date().toISOString(),
    interval: 300, // Интервал пинга
  };
});

// Обработчик Authorize
client.handle("Authorize", async (payload) => {
  console.log(`Authorize получен с ID: ${payload.idTag}`);
  return { idTagInfo: { status: "Accepted" } };
});

// Обработчик StartTransaction
client.handle("StartTransaction", async (payload) => {
  console.log("StartTransaction получен:", payload);
  const portKey = `${config.stationName}_port${payload.connectorId}`;
  const port = config.ports.find((p) => p.number === payload.connectorId);
  if (!port) {
    console.error(`Порт с ID ${payload.connectorId} не найден.`);
    return { idTagInfo: { status: "Rejected" } };
  }

  dev[portKey].Stat = 2;
  dev[portKey].transactionId = payload.meterStart || Date.now();
  controlRelay(port.relayPath, true); // Включение реле

  return {
    transactionId: dev[portKey].transactionId,
    idTagInfo: { status: "Accepted" },
  };
});

// Обработчик StopTransaction
client.handle("StopTransaction", async (payload) => {
  console.log("StopTransaction получен:", payload);
  const portKey = `${config.stationName}_port${payload.connectorId}`;
  const port = config.ports.find((p) => p.number === payload.connectorId);
  if (!port) {
    console.error(`Порт с ID ${payload.connectorId} не найден.`);
    return { idTagInfo: { status: "Rejected" } };
  }

  dev[portKey].Stat = 3;
  controlRelay(port.relayPath, false); // Выключение реле

  return {
    idTagInfo: { status: "Accepted" },
  };
});

// Обработчик Heartbeat
client.handle("Heartbeat", async () => {
  console.log("Heartbeat получен.");
  return { currentTime: new Date().toISOString() };
});

// Цикл обновления данных Modbus
async function startDataUpdateLoop() {
  while (true) {
    for (const port of config.ports) {
      const portKey = `${config.stationName}_port${port.number}`;
      try {
        modbusClient.setID(port.meterAddress);

        // Чтение энергии
        const energyData = await modbusClient.readHoldingRegisters(port.meterRegister, 2);
        dev[portKey].Kwt = ((energyData.data[0] << 16) | energyData.data[1]) / 1000;

        // Чтение тока
        const currentData = await modbusClient.readHoldingRegisters(port.currentRegister, 1);
        dev[portKey].Current = currentData.data[0];

        // Обновление суммы
        dev[portKey].Summ = dev[portKey].Kwt * config.pricePerKwh;

        console.log(
          `Порт: ${port.number}, Энергия: ${dev[portKey].Kwt} кВт·ч, Ток: ${dev[portKey].Current} А, Сумма: ${dev[portKey].Summ} руб.`
        );
      } catch (error) {
        console.error(`Ошибка обновления данных порта ${port.number}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Запуск OCPP-клиента и цикла обновления
(async () => {
  try {
    await client.connect();
    console.log("OCPP-клиент запущен.");
    startDataUpdateLoop();
  } catch (error) {
    console.error("Ошибка запуска OCPP-клиента:", error.message);
  }
})();

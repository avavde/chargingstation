const fs = require("fs");
const ModbusRTU = require("modbus-serial");
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
  console.log(`[${new Date().toISOString()}] Разъем ${connector.id} успешно инициализирован:`, dev[connectorKey]);
});

// Создание OCPP-клиента
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
    const bootResponse = await client.call("BootNotification", {
      chargePointVendor: "MyVendor",
      chargePointModel: "MyModel",
      chargePointSerialNumber: config.stationName,
      firmwareVersion: "1.0",
    });
    console.log(`[${new Date().toISOString()}] BootNotification отправлен. Ответ:`, JSON.stringify(bootResponse, null, 2));

    if (bootResponse.status === "Accepted") {
      console.log(`[${new Date().toISOString()}] BootNotification принят.`);
      setInterval(() => sendHeartbeat(), bootResponse.interval * 1000 || 60000);
    } else {
      console.error(`[${new Date().toISOString()}] BootNotification отклонен.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки BootNotification: ${error.message}`);
  }
});

// Отправка Heartbeat
async function sendHeartbeat() {
  try {
    const response = await client.call("Heartbeat", {});
    console.log(`[${new Date().toISOString()}] Heartbeat отправлен. Ответ:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка отправки Heartbeat: ${error.message}`);
  }
}

// Обработчики OCPP-сообщений
client.handle("Authorize", async (payload) => {
  console.log(`[${new Date().toISOString()}] Authorize получен с ID: ${payload.idTag}`);
  return { idTagInfo: { status: "Accepted" } };
});

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

  return {
    transactionId: dev[connectorKey].transactionId,
    idTagInfo: { status: "Accepted" },
  };
});

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

  return { idTagInfo: { status: "Accepted" } };
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
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Ошибка обновления данных разъема ${connector.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Запуск обновления Modbus
(async () => {
  try {
    await client.connect();
    console.log(`[${new Date().toISOString()}] OCPP-клиент успешно запущен.`);
    updateModbusData();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка запуска OCPP-клиента: ${error.message}`);
  }
})();

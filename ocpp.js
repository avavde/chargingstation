const { ChargePointClient } = require('@lhci/node-ocpp');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Путь к файлу конфигурации
const configPath = './config/config.json';

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

// Управление зарядной станцией через OCPP
const chargePoints = {};

function setupChargePoint(station, port) {
  const portKey = `${station.name}_port${port.number}`;
  const chargePoint = new ChargePointClient(`Connector${port.number}`);
  chargePoints[portKey] = chargePoint;

  const csUrl = config.ocpp.centralSystemUrl;
  const ws = new WebSocket(csUrl, {
    protocol: 'ocpp1.6',
    headers: {
      'Sec-WebSocket-Protocol': 'ocpp1.6',
    },
  });

  ws.on('open', () => {
    console.log(`Соединение с CSMS установлено для ${portKey}`);
    chargePoint.sendBootNotification({
      chargePointVendor: 'Vendor1',
      chargePointModel: 'Model1',
    });
  });

  ws.on('message', (message) => {
    chargePoint.handleMessage(message);
  });

  ws.on('close', () => {
    console.log(`Соединение для ${portKey} закрыто.`);
  });

  ws.on('error', (error) => {
    console.error(`Ошибка WebSocket для ${portKey}: ${error.message}`);
  });

  chargePoint.onRequest('Authorize', async () => {
    return { idTagInfo: { status: 'Accepted' } };
  });

  chargePoint.onRequest('StartTransaction', async () => {
    const transactionId = uuidv4();
    console.log(`Транзакция ${transactionId} начата.`);
    return { transactionId, idTagInfo: { status: 'Accepted' } };
  });

  chargePoint.onRequest('StopTransaction', async () => {
    console.log('Транзакция завершена.');
    return { idTagInfo: { status: 'Accepted' } };
  });
}

// Настройка всех станций
config.stations.forEach(station => {
  station.ports.forEach(port => {
    setupChargePoint(station, port);
  });
});

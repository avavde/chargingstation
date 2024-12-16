const fs = require('fs');
const path = require('path');
const config = require('./config');
const { initializeOCPPClient, getClient } = require('./clients/ocppClient');
const { initializeModbusClient, modbusClient } = require('./clients/modbusClient');
const { getModemInfo } = require('./clients/modemClient');
const { setupOCPPHandlers } = require('./handlers/ocppHandlers');
const { setupErrorHandlers } = require('./handlers/errorHandlers');
const { updateModbusData } = require('./utils/meterUtils');
const { checkReservations } = require('./utils/reservationManager');
const {
  sendBootNotification,
  sendInitialStatusNotifications,
  sendStatusNotification,
} = require('./utils/ocppUtils');
const logger = require('./utils/logger');
const { dev, saveDevToFile } = require('./dev');

setupErrorHandlers();

// Пути к лог-файлам сообщений
const logDir = path.join(__dirname, './logs');
const inMessagesLog = path.join(logDir, 'in-messages.log');
const outMessagesLog = path.join(logDir, 'out-messages.log');

// Создание директории для логов, если она отсутствует
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Создание файлов логов, если они отсутствуют
if (!fs.existsSync(inMessagesLog)) fs.writeFileSync(inMessagesLog, '');
if (!fs.existsSync(outMessagesLog)) fs.writeFileSync(outMessagesLog, '');

// Функция для логирования сообщений
function logMessage(message, type) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${type}: ${JSON.stringify(message)}\n`;
  const filePath = type === 'IN' ? inMessagesLog : outMessagesLog;

  fs.appendFile(filePath, logLine, (err) => {
    if (err) {
      console.error(`Ошибка записи в лог-файл (${filePath}): ${err.message}`);
    }
  });
}

(async () => {
  try {
    // Инициализация Modbus-клиента
    await initializeModbusClient();

    const modbusConnected = modbusClient.isOpen;
    if (!modbusConnected) {
      logger.warn('Modbus-клиент не инициализирован. Все коннекторы будут установлены в статус Inoperative.');
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        dev[connectorKey].status = 'Unavailable';
        dev[connectorKey].availability = 'Inoperative';
      }
      saveDevToFile(dev);
    } else {
      logger.info('Modbus-клиент успешно подключен.');
    }

    const modemInfo = await getModemInfo();
    logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);\
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Инициализация OCPP-клиента
    await initializeOCPPClient();
    const client = getClient();

    // Логирование всех сообщений
    client.on('message', (rawMsg) => {
      const parsedMessage = JSON.parse(rawMsg.message || '{}');
      const direction = rawMsg.outbound ? 'OUT' : 'IN';
      logMessage(parsedMessage, direction);
    });

    setupOCPPHandlers(client);

    await sendBootNotification(client, modemInfo);
    await sendInitialStatusNotifications(client);
    saveDevToFile(dev);

    if (!modbusConnected) {
      for (const connector of config.connectors) {
        await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
      }
      saveDevToFile(dev);
    } else {
      updateModbusData(client);
    }

    setInterval(() => {
      checkReservations(client);
      saveDevToFile(dev);
    }, 60000);

    logger.info('Приложение успешно запущено.');
  } catch (error) {
    logger.error(`Ошибка при запуске приложения: ${error.message}`);
  }
})();

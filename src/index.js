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
const inMessagesLog = path.join(__dirname, './logs/in-messages.log');
const outMessagesLog = path.join(__dirname, './logs/out-messages.log');

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
      saveDevToFile(dev); // Сохраняем обновленное состояние dev
    } else {
      logger.info('Modbus-клиент успешно подключен.');
    }

    // Получаем информацию о модеме
    const modemInfo = await getModemInfo();
    logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

    // Инициализация OCPP-клиента
    await initializeOCPPClient();
    const client = getClient();

    // Обработчики для логирования сообщений
    client.on('message', (rawMsg) => {
      const parsedMessage = JSON.parse(rawMsg.message || '{}');
      const direction = rawMsg.outbound ? 'OUT' : 'IN';
      logMessage(parsedMessage, direction);
    });

    // Устанавливаем OCPP-обработчики
    setupOCPPHandlers(client);

    // Отправка BootNotification и StatusNotification
    await sendBootNotification(client, modemInfo);
    await sendInitialStatusNotifications(client);
    saveDevToFile(dev); // Сохраняем состояние после отправки уведомлений

    // Статусы коннекторов при отсутствии Modbus
    if (!modbusConnected) {
      for (const connector of config.connectors) {
        await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
      }
      saveDevToFile(dev);
    } else {
      updateModbusData(client);
    }

    // Проверка бронирований каждые 60 секунд
    setInterval(() => {
      checkReservations(client);
      saveDevToFile(dev); // Сохраняем состояние после проверки бронирований
    }, 60000);

    logger.info('Приложение успешно запущено.');
  } catch (error) {
    logger.error(`Ошибка при запуске приложения: ${error.message}`);
  }
})();

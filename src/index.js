// src/index.js

const config = require('./config');
const { initializeOCPPClient } = require('./clients/ocppClient');
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
const dev = require('./dev');

setupErrorHandlers();

(async () => {
  try {
    await initializeModbusClient();

    // Проверяем, удалось ли подключиться к Modbus
    const modbusConnected = modbusClient.isOpen;
    if (!modbusConnected) {
      logger.warn('Modbus-клиент не инициализирован. Все коннекторы будут установлены в статус Inoperative.');
      // Устанавливаем статус Inoperative для всех коннекторов
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        dev[connectorKey].status = 'Unavailable';
        dev[connectorKey].availability = 'Inoperative';
        // Отправляем StatusNotification
        await sendStatusNotification(connector.id, 'Unavailable', 'NoError');
      }
    } else {
      logger.info('Modbus-клиент успешно подключен.');
    }

    const modemInfo = await getModemInfo();
    logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

    await initializeOCPPClient();

    setupOCPPHandlers();

    await sendBootNotification(modemInfo);

    await sendInitialStatusNotifications();

    // Запускаем обновление данных Modbus только если подключение успешно
    if (modbusConnected) {
      updateModbusData();
    } else {
      logger.warn('Данные Modbus не будут обновляться из-за отсутствия подключения.');
    }

    // Установка периодической проверки истечения бронирований
    setInterval(checkReservations, 60000);

    logger.info('Приложение успешно запущено.');
  } catch (error) {
    logger.error(`Ошибка при запуске приложения: ${error.message}`);
    // Не завершаем процесс, продолжаем работу
  }
})();

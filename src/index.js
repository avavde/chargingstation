// src/index.js

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
const dev = require('./dev');

setupErrorHandlers();

(async () => {
  try {
    await initializeModbusClient();

    const modbusConnected = modbusClient.isOpen;
    if (!modbusConnected) {
      logger.warn('Modbus-клиент не инициализирован. Все коннекторы будут установлены в статус Inoperative.');
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        dev[connectorKey].status = 'Unavailable';
        dev[connectorKey].availability = 'Inoperative';
        // Теперь передаем client, но у нас его еще нет! Нужно сначала инициализировать OCPP-клиент и получить client.
        // Поэтому пока не вызываем sendStatusNotification здесь. Запомним изменение статуса, а StatusNotification отправим позже.
      }
    } else {
      logger.info('Modbus-клиент успешно подключен.');
    }

    const modemInfo = await getModemInfo();
    logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

    await initializeOCPPClient();
    const client = getClient(); // Получаем OCPP-клиент после инициализации

    setupOCPPHandlers(client);

    await sendBootNotification(client, modemInfo);

    await sendInitialStatusNotifications(client);

    // Теперь, если Modbus не был инициализирован, мы можем отправить StatusNotification для коннекторов Unavailable
    if (!modbusConnected) {
      logger.warn('Modbus-клиент не инициализирован, отправляем StatusNotification Unavailable для всех коннекторов...');
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        // Статус уже установлен в Unavailable, теперь отправим StatusNotification с client
        await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
      }
    }

    // Запускаем обновление данных Modbus только если подключение успешно
    if (modbusConnected) {
      updateModbusData(client); // Передаем client первым аргументом
    } else {
      logger.warn('Данные Modbus не будут обновляться из-за отсутствия подключения.');
    }

    // Установка периодической проверки истечения бронирований
    setInterval(() => checkReservations(client), 60000); // Передаем client

    logger.info('Приложение успешно запущено.');
  } catch (error) {
    logger.error(`Ошибка при запуске приложения: ${error.message}`);
    // Не завершаем процесс, продолжаем работу
  }
})();

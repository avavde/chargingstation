const config = require('./config');
const { initializeOCPPClient } = require('./clients/ocppClient');
const { initializeModbusClient } = require('./clients/modbusClient');
const { getModemInfo } = require('./clients/modemClient');
const { setupOCPPHandlers } = require('./handlers/ocppHandlers');
const { setupErrorHandlers } = require('./handlers/errorHandlers');
const { updateModbusData } = require('./utils/meterUtils');
const { checkReservations } = require('./utils/reservationManager');
const { sendBootNotification, sendInitialStatusNotifications } = require('./utils/ocppUtils');
const logger = require('./utils/logger');

setupErrorHandlers();

(async () => {
  try {
    await initializeModbusClient();
    const modemInfo = await getModemInfo();
    logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

    await initializeOCPPClient();

    setupOCPPHandlers();

    await sendBootNotification(modemInfo);

    await sendInitialStatusNotifications();

    updateModbusData();

    // Установка периодической проверки истечения бронирований
    setInterval(checkReservations, 60000);

    logger.info('Приложение успешно запущено.');
  } catch (error) {
    logger.error(`Ошибка при запуске приложения: ${error.message}`);
    process.exit(1);
  }
})();

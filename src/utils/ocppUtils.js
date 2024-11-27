const { client } = require('../clients/ocppClient');
const logger = require('./logger');

async function sendFirmwareStatusNotification(status) {
  try {
    const response = await client.call('FirmwareStatusNotification', {
      status,
      timestamp: new Date().toISOString(),
    });
    logger.info(
      `FirmwareStatusNotification отправлен со статусом ${status}. Ответ: ${JSON.stringify(
        response,
        null,
        2
      )}`
    );
  } catch (error) {
    logger.error(`Ошибка отправки FirmwareStatusNotification: ${error.message}`);
  }
}

module.exports = {
  sendFirmwareStatusNotification,
};

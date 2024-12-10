// src/utils/ocppUtils.js

const logger = require('./logger');
const dev = require('../dev');
const config = require('../config');

async function sendBootNotification(client, modemInfo) {
  try {
    const payload = {
      chargePointVendor: config.vendor,
      chargePointModel: config.model,
      chargePointSerialNumber: config.stationName,
      firmwareVersion: '1.0',
      meterSerialNumber: 'Unknown', // Обновите при необходимости
    };

    if (modemInfo) {
      payload.iccid = modemInfo.iccid || 'Unknown';
      payload.imsi = modemInfo.imsi || 'Unknown';
    }

    const response = await client.call('BootNotification', payload);
    logger.info(`BootNotification отправлен. Ответ: ${JSON.stringify(response, null, 2)}`);

    if (response.status === 'Accepted') {
      logger.info('BootNotification принят.');
    } else {
      logger.error('BootNotification отклонен.');
    }

    // Установка интервала для Heartbeat на основе ответа
    const heartbeatInterval = response.interval || 60;
    setInterval(() => sendHeartbeat(client), heartbeatInterval * 1000);
  } catch (error) {
    logger.error(`Ошибка при отправке BootNotification: ${error.message}`);
  }
}

async function sendStatusNotification(client, connectorId, status, errorCode) {
  try {
    const payload = {
      connectorId,
      status,
      errorCode,
      timestamp: new Date().toISOString(),
    };

    const response = await client.call('StatusNotification', payload);
    logger.info(`StatusNotification отправлен для коннектора ${connectorId}. Ответ: ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    logger.error(`Ошибка при отправке StatusNotification для коннектора ${connectorId}: ${error.message}`);
  }
}

async function sendHeartbeat(client) {
  try {
    const response = await client.call('Heartbeat', {});
    logger.info('Heartbeat отправлен.');
  } catch (error) {
    logger.error(`Ошибка при отправке Heartbeat: ${error.message}`);
  }
}

module.exports = {
  sendBootNotification,
  sendStatusNotification,
  sendHeartbeat,
};

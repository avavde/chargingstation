// src/utils/ocppUtils.js

const { client } = require('../clients/ocppClient');
const logger = require('./logger');
const config = require('../config');
const dev = require('../dev');

// Функция для отправки FirmwareStatusNotification
async function sendFirmwareStatusNotification(status) {
  try {
    await client.call('FirmwareStatusNotification', {
      status,
    });
    logger.info(`FirmwareStatusNotification отправлен со статусом: ${status}`);
  } catch (error) {
    logger.error(`Ошибка отправки FirmwareStatusNotification: ${error.message}`);
  }
}

// Функция для отправки DiagnosticsStatusNotification
async function sendDiagnosticsStatusNotification(status) {
  try {
    await client.call('DiagnosticsStatusNotification', {
      status,
    });
    logger.info(`DiagnosticsStatusNotification отправлен со статусом: ${status}`);
  } catch (error) {
    logger.error(`Ошибка отправки DiagnosticsStatusNotification: ${error.message}`);
  }
}

// Функция для отправки StatusNotification
async function sendStatusNotification(connectorId, status, errorCode) {
  try {
    await client.call('StatusNotification', {
      connectorId,
      status,
      errorCode,
      timestamp: new Date().toISOString(),
    });
    logger.info(
      `StatusNotification отправлен для коннектора ${connectorId} со статусом ${status} и кодом ошибки ${errorCode}`
    );
  } catch (error) {
    logger.error(`Ошибка отправки StatusNotification: ${error.message}`);
  }
}

// Функция для отправки MeterValues
async function sendMeterValues(connectorId) {
  try {
    const connectorKey = `${config.stationName}_connector${connectorId}`;
    const meterValue = {
      timestamp: new Date().toISOString(),
      sampledValue: [
        {
          value: dev[connectorKey].Kwt.toString(),
          context: 'Sample.Periodic',
          format: 'Raw',
          measurand: 'Energy.Active.Import.Register',
          unit: 'kWh',
        },
        {
          value: dev[connectorKey].Current.toString(),
          context: 'Sample.Periodic',
          format: 'Raw',
          measurand: 'Current.Import',
          unit: 'A',
        },
      ],
    };

    await client.call('MeterValues', {
      connectorId,
      transactionId: dev[connectorKey].transactionId,
      meterValue: [meterValue],
    });

    logger.info(`MeterValues отправлен для коннектора ${connectorId}`);
  } catch (error) {
    logger.error(`Ошибка отправки MeterValues: ${error.message}`);
  }
}

// Функция для отправки BootNotification
async function sendBootNotification(modemInfo) {
  try {
    const payload = {
      chargePointVendor: config.vendor,
      chargePointModel: config.model,
      chargePointSerialNumber: config.stationName,
      firmwareVersion: '1.0',
      iccid: modemInfo.iccid || 'Unknown',
      imsi: modemInfo.imsi || 'Unknown',
    };

    const response = await client.call('BootNotification', payload);
    logger.info(`BootNotification отправлен. Ответ: ${JSON.stringify(response, null, 2)}`);

    // Устанавливаем интервал Heartbeat на основании ответа центральной системы
    const heartbeatInterval = response.heartbeatInterval || 60;
    setInterval(sendHeartbeat, heartbeatInterval * 1000);
  } catch (error) {
    logger.error(`Ошибка отправки BootNotification: ${error.message}`);
  }
}

// Функция для отправки Heartbeat
async function sendHeartbeat() {
  try {
    await client.call('Heartbeat', {});
    logger.info('Heartbeat отправлен.');
  } catch (error) {
    logger.error(`Ошибка отправки Heartbeat: ${error.message}`);
  }
}

// Функция для отправки начальных StatusNotification для всех коннекторов
async function sendInitialStatusNotifications() {
  try {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      const status = dev[connectorKey].status || 'Available';
      await sendStatusNotification(connector.id, status, 'NoError');
    }
    logger.info('Начальные StatusNotification отправлены для всех коннекторов.');
  } catch (error) {
    logger.error(`Ошибка отправки начальных StatusNotification: ${error.message}`);
  }
}

// Экспортируем все функции
module.exports = {
  sendFirmwareStatusNotification,
  sendDiagnosticsStatusNotification,
  sendStatusNotification,
  sendMeterValues,
  sendBootNotification,
  sendHeartbeat,
  sendInitialStatusNotifications,
};

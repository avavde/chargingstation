// src/utils/ocppUtils.js

const logger = require('./logger');
const dev = require('../dev');
const config = require('../config');

async function sendBootNotification(client, modemInfo) {
  if (!client) {
    logger.warn('Попытка отправить BootNotification без инициализированного клиента.');
    return;
  }

  try {
    const payload = {
      chargePointVendor: config.vendor,
      chargePointModel: config.model,
      chargePointSerialNumber: config.stationName,
      firmwareVersion: '1.0',
      meterSerialNumber: 'Unknown', // При необходимости обновите это значение
    };

    if (modemInfo) {
      payload.iccid = modemInfo.iccid || 'Unknown';
      payload.imsi = modemInfo.imsi || 'Unknown';
    }

    const response = await client.call('BootNotification', payload);
    logger.info(`BootNotification отправлен. Ответ: ${JSON.stringify(response, null, 2)}`);

    if (response.status === 'Accepted') {
      logger.info('BootNotification принят.');
      // Установка интервала для Heartbeat на основе ответа, если требуется
      const heartbeatInterval = response.interval || 60;
      setInterval(() => sendHeartbeat(client), heartbeatInterval * 1000);
    } else {
      logger.error('BootNotification отклонен.');
    }
  } catch (error) {
    logger.error(`Ошибка при отправке BootNotification: ${error.message}`);
  }
}

async function sendStatusNotification(client, connectorId, status, errorCode) {
  if (!client) {
    logger.warn(`Попытка отправить StatusNotification без клиента. Статус: ${status} для коннектора ${connectorId}`);
    return;
  }

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
  if (!client) {
    logger.warn('Попытка отправить Heartbeat без клиента.');
    return;
  }

  try {
    const response = await client.call('Heartbeat', {});
    logger.info('Heartbeat отправлен.');
  } catch (error) {
    logger.error(`Ошибка при отправке Heartbeat: ${error.message}`);
  }
}

async function sendFirmwareStatusNotification(client, status) {
  if (!client) {
    logger.warn(`Попытка отправить FirmwareStatusNotification без клиента. Статус: ${status}`);
    return;
  }

  try {
    const payload = {
      status,
      timestamp: new Date().toISOString(),
    };
    const response = await client.call('FirmwareStatusNotification', payload);
    logger.info(`FirmwareStatusNotification отправлен со статусом ${status}. Ответ: ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    logger.error(`Ошибка отправки FirmwareStatusNotification: ${error.message}`);
  }
}

async function sendDiagnosticsStatusNotification(client, status) {
  if (!client) {
    logger.warn(`Попытка отправить DiagnosticsStatusNotification без клиента. Статус: ${status}`);
    return;
  }

  try {
    const payload = {
      status,
      timestamp: new Date().toISOString(),
    };
    const response = await client.call('DiagnosticsStatusNotification', payload);
    logger.info(`DiagnosticsStatusNotification отправлен со статусом ${status}. Ответ: ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    logger.error(`Ошибка отправки DiagnosticsStatusNotification: ${error.message}`);
  }
}

async function sendMeterValues(client, connectorId) {
  if (!client) {
    logger.warn(`Попытка отправить MeterValues без клиента для коннектора ${connectorId}.`);
    return;
  }

  const connectorKey = `${config.stationName}_connector${connectorId}`;
  if (!dev[connectorKey].transactionId) {
    // Если транзакция не запущена, MeterValues не отправляем
    return;
  }

  try {
    const response = await client.call('MeterValues', {
      connectorId,
      transactionId: dev[connectorKey].transactionId,
      meterValue: [
        {
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
            }
          ],
        },
      ],
    });
    logger.info(`MeterValues отправлен для коннектора ${connectorId}. Ответ: ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    logger.error(`Ошибка отправки MeterValues для коннектора ${connectorId}: ${error.message}`);
  }
}

async function sendInitialStatusNotifications(client) {
  if (!client) {
    logger.warn('Попытка отправить начальные StatusNotification без клиента.');
    return;
  }

  try {
    // Отправка StatusNotification для ConnectorId 0 (общий статус станции)
    await sendStatusNotification(client, 0, 'Available', 'NoError');
    // Отправка StatusNotification для каждого коннектора
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      const status = dev[connectorKey].status || 'Available';
      await sendStatusNotification(client, connector.id, status, 'NoError');
    }

    logger.info('Начальные StatusNotification отправлены для всех коннекторов.');
  } catch (error) {
    logger.error(`Ошибка отправки начальных StatusNotification: ${error.message}`);
  }
}

module.exports = {
  sendBootNotification,
  sendStatusNotification,
  sendHeartbeat,
  sendFirmwareStatusNotification,
  sendDiagnosticsStatusNotification,
  sendMeterValues,
  sendInitialStatusNotifications,
};

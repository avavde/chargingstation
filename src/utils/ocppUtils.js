// utils/ocppUtils.js
const logger = require('./logger');
const { dev, saveDevToFile } = require('../dev');
const config = require('../config');
const { readWithTimeout } = require('../clients/modbusClient'); // Импортируем необходимые функции
const { modbusClient } = require('../clients/modbusClient'); // Импортируем modbusClient, если требуется

/**
 * Отправляет BootNotification.
 * Если сервер принимает (status === 'Accepted'), запускаем периодический Heartbeat.
 */
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
      meterSerialNumber: 'Unknown',
    };

    if (modemInfo) {
      payload.iccid = modemInfo.iccid || 'Unknown';
      payload.imsi = modemInfo.imsi || 'Unknown';
    }

    const response = await client.call('BootNotification', payload);
    logger.info(`BootNotification отправлен. Ответ: ${JSON.stringify(response, null, 2)}`);

    // Ответ формата: { currentTime, interval, status }, где status может быть 'Accepted' или 'Rejected'
    if (response && response.status === 'Accepted') {
      logger.info('BootNotification принят.');
      // Настраиваем периодический Heartbeat, если OCPP-сервер вернул интервал
      const heartbeatInterval = response.interval || 60;
      setInterval(() => sendHeartbeat(client), heartbeatInterval * 1000);
    } else {
      logger.error(`BootNotification отклонен или ответ пустой. Ответ сервера: ${JSON.stringify(response)}`);
    }
  } catch (error) {
    logger.error(`Ошибка при отправке BootNotification: ${error.message}`);
  }
}

/**
 * Отправляет StatusNotification.
 * Сервер OCPP часто возвращает пустой объект {} в качестве ответа, поэтому не должно быть ошибок при обработке.
 */
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

    // OCPP-сервер по спецификации может вернуть пустой объект ({}) в ответе на StatusNotification
    // Для надёжности проверим, что ответ пришёл в ожидаемом формате
    if (!response || typeof response !== 'object') {
      logger.warn('Ответ на StatusNotification пришел пустым или в неизвестном формате.');
    } else {
      // Если вдруг в ответе когда-либо появятся поля, можно обрабатывать их здесь
      logger.debug('StatusNotification ответ успешно обработан.');
    }
  } catch (error) {
    logger.error(`Ошибка при отправке StatusNotification для коннектора ${connectorId}: ${error.message}`);
    throw error; // Пробрасываем ошибку, чтобы sendInitialStatusNotifications мог её поймать
  }
}

/**
 * Отправляет Heartbeat.
 */
async function sendHeartbeat(client) {
  if (!client) {
    logger.warn('Попытка отправить Heartbeat без клиента.');
    return;
  }

  try {
    const response = await client.call('Heartbeat', {});
    logger.info('Heartbeat отправлен.');

    // При желании можно логировать ответ от сервера, если он что-то вернёт
    // logger.info(`Heartbeat ответ: ${JSON.stringify(response, null, 2)}`);

    // Сохраняем состояние dev при успешном отправлении Heartbeat
    saveDevToFile(dev);
  } catch (error) {
    logger.error(`Ошибка при отправке Heartbeat: ${error.message}`);
  }
}

/**
 * Отправляет FirmwareStatusNotification (например, при обновлении прошивки).
 */
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

/**
 * Отправляет DiagnosticsStatusNotification (например, при выгрузке логов диагностики).
 */
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

/**
 * Отправляет MeterValues (показания счётчиков). 
 * Например, может вызываться раз в N секунд или при изменении измерений.
 */
async function sendMeterValues(client, connectorId, transactionId, energy, power) {
  const meterValuesPayload = {
    connectorId,
    transactionId,
    meterValue: [
      {
        timestamp: new Date().toISOString(),
        sampledValue: [
          {
            value: energy.toFixed(2),
            context: "Sample.Periodic",
            format: "Raw",
            measurand: "Energy.Active.Import.Register",
            unit: "kWh"
          },
          {
            value: power.toFixed(2),
            context: "Sample.Periodic",
            format: "Raw",
            measurand: "Power.Active.Import",
            unit: "kW"
          }
        ]
      }
    ]
  };

  logger.debug(`Формируем MeterValues: ${JSON.stringify(meterValuesPayload, null, 2)}`);

  if (!client) {
    logger.warn('Попытка отправить MeterValues без инициализированного клиента.');
    return;
  }

  try {
    const response = await client.call('MeterValues', meterValuesPayload);
    logger.info(`MeterValues отправлены: ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    logger.error(`Ошибка отправки MeterValues: ${error.message}`);
  }
}

/**
 * Отправляет начальные StatusNotification для всех коннекторов (включая connectorId=0).
 * Если ответ от сервера пустой, код не должен падать.
 */
async function sendInitialStatusNotifications(client) {
  if (!client) {
    logger.warn('Попытка отправить начальные StatusNotification без клиента.');
    return;
  }

  try {
    // Сначала StatusNotification для ConnectorId 0 (общий статус станции)
    await sendStatusNotification(client, 0, 'Available', 'NoError');

    // Затем StatusNotification для каждого коннектора согласно состоянию в dev
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      const currentStatus = dev[connectorKey]?.status || 'Available';
      await sendStatusNotification(client, connector.id, currentStatus, 'NoError');
    }

    logger.info('Начальные StatusNotification отправлены для всех коннекторов.');
  } catch (error) {
    logger.error(`Ошибка отправки начальных StatusNotification: ${error.message}`);
    // При желании можно не пробрасывать ошибку дальше, но логировать важно
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

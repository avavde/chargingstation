const { controlRelay } = require('./relayControl');
const dev = require('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification } = require('./ocppUtils');

async function startTransaction(client, connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  
  // Инициализация структуры для хранения данных о транзакции, если ее нет
  if (!dev[connectorKey]) {
    dev[connectorKey] = {
      Kwt: dev[connectorKey]?.Kwt || 0, // Убедиться что Kwt определен, или задать 0 если нет
      status: 'Available'
    };
  }

  dev[connectorKey].transactionId = Date.now();
  dev[connectorKey].status = 'Charging';
  dev[connectorKey].idTag = idTag;

  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, true);

  // Отправка StartTransaction
  const response = await client.call('StartTransaction', {
    connectorId,
    idTag,
    meterStart: Math.round((dev[connectorKey].Kwt || 0) * 1000),
    timestamp: new Date().toISOString(),
  });

  // Сохранение полученного transactionId от центральной системы
  dev[connectorKey].transactionId = response.transactionId;

  // Отправка StatusNotification (Charging)
  await sendStatusNotification(client, connectorId, 'Charging', 'NoError');

  // Возвращаем объект response, чтобы вызывающий код мог проверить transactionId
  return response;
}

async function stopTransaction(client, connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const transactionId = dev[connectorKey]?.transactionId;
  const idTag = dev[connectorKey]?.idTag;

  if (!transactionId) {
    logger.error(`Нет активной транзакции на разъеме ${connectorId}`);
    return;
  }

  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, false);

  // Отправка StopTransaction
  await client.call('StopTransaction', {
    transactionId,
    idTag,
    meterStop: Math.round((dev[connectorKey].Kwt || 0) * 1000),
    timestamp: new Date().toISOString(),
  });

  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = 'Available';

  // Отправка StatusNotification (Available)
  await sendStatusNotification(client, connectorId, 'Available', 'NoError');
}

module.exports = {
  startTransaction,
  stopTransaction,
};

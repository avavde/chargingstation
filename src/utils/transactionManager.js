// src/utils/transactionManager.js

const { controlRelay } = require('./relayControl');
const dev = require('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification } = require('./ocppUtils');

// startTransaction и stopTransaction принимают client первым аргументом
async function startTransaction(client, connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  dev[connectorKey].transactionId = Date.now();
  dev[connectorKey].status = 'Charging';
  dev[connectorKey].idTag = idTag;

  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, true);

  // Отправка StartTransaction
  const response = await client.call('StartTransaction', {
    connectorId,
    idTag,
    meterStart: Math.round(dev[connectorKey].Kwt * 1000),
    timestamp: new Date().toISOString(),
  });

  dev[connectorKey].transactionId = response.transactionId;

  // Отправка StatusNotification
  await sendStatusNotification(client, connectorId, 'Charging', 'NoError');
}

async function stopTransaction(client, connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const transactionId = dev[connectorKey].transactionId;
  const idTag = dev[connectorKey].idTag;

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
    meterStop: Math.round(dev[connectorKey].Kwt * 1000),
    timestamp: new Date().toISOString(),
  });

  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = 'Available';

  // Отправка StatusNotification
  await sendStatusNotification(client, connectorId, 'Available', 'NoError');
}

module.exports = {
  startTransaction,
  stopTransaction,
};

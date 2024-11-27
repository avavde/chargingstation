const { controlRelay } = require('./relayControl');
const { client } = require('../clients/ocppClient');
const dev = require('../dev'); // Модуль для хранения состояния коннекторов
const logger = require('./logger');
const config = require('../config');

async function startTransaction(connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  dev[connectorKey].transactionId = Date.now();
  dev[connectorKey].status = 'Charging';
  dev[connectorKey].idTag = idTag;

  // Управление реле
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
  await sendStatusNotification(connectorId, 'Charging', 'NoError');
}

async function stopTransaction(connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const transactionId = dev[connectorKey].transactionId;
  const idTag = dev[connectorKey].idTag;

  if (!transactionId) {
    logger.error(`Нет активной транзакции на разъеме ${connectorId}`);
    return;
  }

  // Управление реле
  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, false);

  // Отправка StopTransaction
  await client.call('StopTransaction', {
    transactionId,
    idTag,
    meterStop: Math.round(dev[connectorKey].Kwt * 1000),
    timestamp: new Date().toISOString(),
  });

  // Обновление статуса
  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = 'Available';

  // Отправка StatusNotification
  await sendStatusNotification(connectorId, 'Available', 'NoError');
}

module.exports = {
  startTransaction,
  stopTransaction,
};

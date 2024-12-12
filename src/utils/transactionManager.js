const { controlRelay } = require('./relayControl');
const dev = require('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification } = require('./ocppUtils');
const { getMeterReading } = require('../clients/modbusClient');

async function startTransaction(client, connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;

  if (!dev[connectorKey]) {
    logger.error(`Коннектор ${connectorId} не найден в конфигурации.`);
    return { idTagInfo: { status: 'Rejected' } };
  }

  // Считываем начальные показания
  const meterStart = await getMeterReading(connectorId);

  dev[connectorKey].status = 'Preparing';
  dev[connectorKey].idTag = idTag;

  const response = await client.call('StartTransaction', {
    connectorId,
    idTag,
    meterStart: Math.round(meterStart * 1000),
    timestamp: new Date().toISOString(),
  });

  if (!response.idTagInfo || response.idTagInfo.status !== 'Accepted') {
    logger.error(`StartTransaction отклонен для idTag=${idTag}.`);
    controlRelay(config.connectors.find(c => c.id === connectorId).relayPath, false);
    dev[connectorKey].status = 'Available';
    dev[connectorKey].idTag = null;
    return response;
  }

  // Сохраняем transactionId и статус Charging
  dev[connectorKey].transactionId = response.transactionId;
  dev[connectorKey].status = 'Charging';
  dev[connectorKey].meterStart = meterStart;

  await sendStatusNotification(client, connectorId, 'Charging', 'NoError');

  return response;
}

async function stopTransaction(client, connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const { transactionId, idTag } = dev[connectorKey];

  if (!transactionId) {
    logger.warn(`Нет активной транзакции для connectorId=${connectorId}`);
    return;
  }

  const meterStop = await getMeterReading(connectorId);
  await client.call('StopTransaction', {
    transactionId,
    idTag,
    meterStop: Math.round(meterStop * 1000),
    timestamp: new Date().toISOString(),
  });

  // Сброс состояния коннектора
  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = 'Available';
  dev[connectorKey].idTag = null;

  await sendStatusNotification(client, connectorId, 'Available', 'NoError');
}

module.exports = {
  startTransaction,
  stopTransaction,
};

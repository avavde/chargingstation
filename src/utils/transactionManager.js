const { controlRelay } = require('./relayControl');
const dev = require('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification } = require('./ocppUtils');
const { getMeterReading } = require('../clients/modbusClient'); // Предполагается, что эта функция существует

async function startTransaction(client, connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  
  if (!dev[connectorKey]) {
    dev[connectorKey] = {
      status: 'Available',
      meterStart: 0,
      transactionId: null,
      idTag: null,
      active: false,
      meterInterval: null
    };
  }

  // Считаем текущее показание счётчика в кВт·ч для начала транзакции
  const currentMeterValue = await getMeterReading();

  dev[connectorKey].status = 'Preparing'; 
  dev[connectorKey].idTag = idTag;
  dev[connectorKey].meterStart = currentMeterValue; 
  dev[connectorKey].transactionId = null;
  dev[connectorKey].active = false;

  const connector = config.connectors.find((c) => c.id === connectorId);
  controlRelay(connector.relayPath, true); // Включаем реле для подачи напряжения

  // Отправка StartTransaction
  const response = await client.call('StartTransaction', {
    connectorId,
    idTag,
    meterStart: Math.round(currentMeterValue * 1000), 
    timestamp: new Date().toISOString(),
  });

  // Проверяем статус idTagInfo
  if (!response.idTagInfo || response.idTagInfo.status !== 'Accepted') {
    logger.error(`StartTransaction не принят для idTag=${idTag}, статус=${response.idTagInfo?.status || 'Unknown'}. Отключаем реле.`);
    controlRelay(connector.relayPath, false);
    dev[connectorKey].status = 'Available';
    dev[connectorKey].transactionId = null;
    dev[connectorKey].idTag = null;
    return null;
  }

  // Если Accepted, сохраняем transactionId
  dev[connectorKey].transactionId = response.transactionId;
  dev[connectorKey].status = 'Charging';
  dev[connectorKey].active = true;

  // Отправляем StatusNotification (Charging)
  await sendStatusNotification(client, connectorId, 'Charging', 'NoError');

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
  controlRelay(connector.relayPath, false); // Выключаем реле, прекращаем зарядку

  // Считываем текущее показание счётчика для завершения транзакции
  const currentMeterValue = await getMeterReading();

  // Отправка StopTransaction
  await client.call('StopTransaction', {
    transactionId,
    idTag,
    meterStop: Math.round(currentMeterValue * 1000),
    timestamp: new Date().toISOString(),
  });

  dev[connectorKey].transactionId = null;
  dev[connectorKey].status = 'Available';
  dev[connectorKey].active = false;
  dev[connectorKey].meterStart = 0;
  dev[connectorKey].idTag = null;

  // Отправка StatusNotification (Available)
  await sendStatusNotification(client, connectorId, 'Available', 'NoError');
}

module.exports = {
  startTransaction,
  stopTransaction,
};

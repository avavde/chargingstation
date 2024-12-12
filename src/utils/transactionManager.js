const { controlRelay } = require('./relayControl');
const dev = require('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification } = require('./ocppUtils');
const { getMeterReading } = require('../clients/modbusClient');

async function startTransaction(client, connectorId, idTag) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connectorConfig = config.connectors.find(c => c.id === connectorId);

  if (!connectorConfig) {
    logger.error(`Конфигурация для connectorId=${connectorId} не найдена.`);
    return { idTagInfo: { status: 'Rejected' } };
  }

  if (!dev[connectorKey]) {
    logger.error(`Коннектор ${connectorId} отсутствует в текущем состоянии.`);
    return { idTagInfo: { status: 'Rejected' } };
  }

  try {
    // Считываем начальные показания счетчика
    const meterStart = await getMeterReading(connectorId);
    logger.info(`Начальные показания счетчика для connectorId=${connectorId}: ${meterStart} kWh`);

    // Обновляем состояние коннектора
    dev[connectorKey].status = 'Preparing';
    dev[connectorKey].idTag = idTag;

    // Включаем реле
    controlRelay(connectorConfig.relayPath, true);

    // Отправляем запрос StartTransaction на сервер
    const response = await client.call('StartTransaction', {
      connectorId,
      idTag,
      meterStart: Math.round(meterStart * 1000), // В OCPP единицах (Вт·ч)
      timestamp: new Date().toISOString(),
    });

    // Проверяем статус ответа от сервера
    if (!response.idTagInfo || response.idTagInfo.status !== 'Accepted') {
      logger.error(`StartTransaction отклонен для idTag=${idTag}. Статус: ${response.idTagInfo?.status}`);
      controlRelay(connectorConfig.relayPath, false); // Выключаем реле
      dev[connectorKey].status = 'Available';
      dev[connectorKey].idTag = null;
      return response;
    }

    // Сохраняем transactionId и статус Charging
    dev[connectorKey].transactionId = response.transactionId;
    dev[connectorKey].status = 'Charging';
    dev[connectorKey].meterStart = meterStart;

    await sendStatusNotification(client, connectorId, 'Charging', 'NoError');
    logger.info(`Транзакция успешно начата для connectorId=${connectorId}, transactionId=${response.transactionId}`);

    return response;
  } catch (error) {
    logger.error(`Ошибка при запуске транзакции для connectorId=${connectorId}: ${error.message}`);
    controlRelay(connectorConfig.relayPath, false); // Безопасно выключаем реле при ошибке
    dev[connectorKey].status = 'Available';
    dev[connectorKey].idTag = null;
    return { idTagInfo: { status: 'Rejected' } };
  }
}

async function stopTransaction(client, connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connectorConfig = config.connectors.find(c => c.id === connectorId);

  if (!connectorConfig) {
    logger.error(`Конфигурация для connectorId=${connectorId} не найдена.`);
    return;
  }

  if (!dev[connectorKey]?.transactionId) {
    logger.warn(`Нет активной транзакции для connectorId=${connectorId}`);
    return;
  }

  try {
    // Считываем финальные показания счетчика
    const meterStop = await getMeterReading(connectorId);
    logger.info(`Финальные показания счетчика для connectorId=${connectorId}: ${meterStop} kWh`);

    const { transactionId, idTag } = dev[connectorKey];

    // Отправляем StopTransaction
    await client.call('StopTransaction', {
      transactionId,
      idTag,
      meterStop: Math.round(meterStop * 1000), // В OCPP единицах (Вт·ч)
      timestamp: new Date().toISOString(),
    });

    // Выключаем реле и сбрасываем состояние коннектора
    controlRelay(connectorConfig.relayPath, false);
    dev[connectorKey].transactionId = null;
    dev[connectorKey].status = 'Available';
    dev[connectorKey].idTag = null;

    await sendStatusNotification(client, connectorId, 'Available', 'NoError');
    logger.info(`Транзакция завершена для connectorId=${connectorId}`);
  } catch (error) {
    logger.error(`Ошибка при завершении транзакции для connectorId=${connectorId}: ${error.message}`);
  }
}

module.exports = {
  startTransaction,
  stopTransaction,
};

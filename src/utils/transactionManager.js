const { controlRelay } = require('./relayControl');
const { dev } =quire('../dev');
const logger = require('./logger');
const config = require('../config');
const { sendStatusNotification, sendMeterValues } = require('./ocppUtils');
const { getCachedModbusData } = require('../clients/modbusClient');

/**
 * Старт транзакции для коннектора.
 * @param {Object} client - OCPP клиент.
 * @param {number} connectorId - ID коннектора.
 * @param {string} idTag - Идентификатор пользователя.
 */
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
    // Получаем начальные показания из кэша
    const { energy } = getCachedModbusData(connectorId);
    logger.info(`Начальные показания счетчика для connectorId=${connectorId}: ${energy} kWh`);

    // Обновляем состояние коннектора
    dev[connectorKey].status = 'Preparing';
    dev[connectorKey].idTag = idTag;

    // Включаем реле
    controlRelay(connectorConfig.relayPath, true);

    // Отправляем StartTransaction на сервер
    const response = await client.call('StartTransaction', {
      connectorId,
      idTag,
      meterStart: Math.round(energy * 1000), // В OCPP единицах (Вт·ч)
      timestamp: new Date().toISOString(),
    });

    if (!response.idTagInfo || response.idTagInfo.status !== 'Accepted') {
      logger.error(`StartTransaction отклонен для idTag=${idTag}. Статус: ${response.idTagInfo?.status}`);
      controlRelay(connectorConfig.relayPath, false);
      dev[connectorKey].status = 'Available';
      dev[connectorKey].idTag = null;
      return response;
    }

    // Сохраняем transactionId и статус Charging
    dev[connectorKey].transactionId = response.transactionId;
    dev[connectorKey].status = 'Charging';
    dev[connectorKey].meterStart = energy;

    await sendStatusNotification(client, connectorId, 'Charging', 'NoError');
    logger.info(`Транзакция успешно начата для connectorId=${connectorId}, transactionId=${response.transactionId}`);

    return response;
  } catch (error) {
    logger.error(`Ошибка при запуске транзакции для connectorId=${connectorId}: ${error.message}`);
    controlRelay(connectorConfig.relayPath, false);
    dev[connectorKey].status = 'Available';
    dev[connectorKey].idTag = null;
    return { idTagInfo: { status: 'Rejected' } };
  }
}



/**
 * Завершение транзакции для коннектора.
 * @param {Object} client - OCPP клиент.
 * @param {number} connectorId - ID коннектора.
 */
async function stopTransaction(client, connectorId) {
  const connectorKey = `${config.stationName}_connector${connectorId}`;
  const connectorConfig = config.connectors.find(c => c.id === connectorId);

  if (!connectorConfig) {
    logger.error(`Конфигурация для connectorId=${connectorId} не найдена.`);
    return;
  }

  const transactionId = dev[connectorKey]?.transactionId;

  if (!transactionId) {
    logger.warn(`Нет активной транзакции для connectorId=${connectorId}`);
    return;
  }

  try {
    // Получаем финальные данные из Modbus кэша
    const cachedData = getCachedModbusData(connectorId);
    const finalEnergy = cachedData?.Energy || 0; // Используем 0 по умолчанию
    logger.info(`Финальные показания для connectorId=${connectorId}: ${finalEnergy} kWh`);

    // Отправляем StopTransaction
    const payload = {
      transactionId,
      idTag: dev[connectorKey]?.idTag,
      meterStop: Math.round(finalEnergy * 1000), // Переводим в Wh
      timestamp: new Date().toISOString(),
    };

    logger.debug(`Отправляем StopTransaction: ${JSON.stringify(payload)}`);
    await client.call('StopTransaction', payload);

    // Обновляем состояние коннектора
    controlRelay(connectorConfig.relayPath, false); // Выключаем реле
    dev[connectorKey].transactionId = null;
    dev[connectorKey].status = 'Available';
    dev[connectorKey].idTag = null;
    dev[connectorKey].Energy = 0; // Сбрасываем показания энергии

    // Отправляем статус "Available"
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

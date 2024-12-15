const { modbusClient, initializeModbusClient, readEnergyAndPower } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
const { sendStatusNotification, sendMeterValues } = require('./ocppUtils');

/**
 * Опрос данных с коннектора
 * @param {Object} client - OCPP клиент
 * @param {Object} connector - Конфигурация коннектора
 */
async function pollConnectorData(client, connector) {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  try {
    logger.debug(`Опрос данных для коннектора ${connector.id}...`);

    // Чтение данных Modbus с использованием мьютекса
    const { energy, power } = await readEnergyAndPower(connector);

    // Обновляем данные состояния
    dev[connectorKey].Energy = energy;
    dev[connectorKey].Power = power;

    logger.info(`Коннектор ${connector.id}: Энергия=${energy} kWh, Мощность=${power} kW`);

    // Отправка MeterValues, если транзакция активна
    if (dev[connectorKey].transactionId) {
      await sendMeterValues(client, connector.id, dev[connectorKey].transactionId, energy, power);
    }
  } catch (error) {
    logger.error(`Ошибка при опросе коннектора ${connector.id}: ${error.message}`);
    dev[connectorKey].status = 'Unavailable';
    await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
  }
}
/**
 * Циклический опрос данных Modbus
 * @param {Object} client - OCPP клиент
 */
async function updateModbusData(client) {
  logger.info('Запуск обновления данных Modbus...');

  // Функция опроса
  async function pollLoop() {
    for (const connector of config.connectors) {
      await pollConnectorData(client, connector);
      await new Promise((resolve) => setImmediate(resolve)); // Освобождаем главный поток
    }
    setTimeout(pollLoop, 2000); // Запуск следующего цикла
  }

  pollLoop();
}

module.exports = {
  updateModbusData,
};

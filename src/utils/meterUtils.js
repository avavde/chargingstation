const { modbusClient, readWithTimeout, initializeModbusClient } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
const { sendStatusNotification, sendMeterValues } = require('./ocppUtils');

/**
 * Чтение данных Modbus: Энергия и Мощность
 * @param {Object} connector - Конфигурация коннектора
 * @returns {Object} { energy, power }
 */
async function readEnergyAndPower(connector) {
  try {
    modbusClient.setID(connector.meterAddress);

    // Чтение энергии (4 байта, s32 big-endian)
    const energyData = await readWithTimeout(connector.energyRegister, 2, 1000); // 2 регистра = 4 байта
    const energy = energyData.buffer.readInt32BE(0) * 0.01; // Масштабирование 0.01 для kWh

    // Чтение мощности (4 байта, s32 big-endian)
    const powerData = await readWithTimeout(connector.powerRegister, 2, 1000);
    const power = powerData.buffer.readInt32BE(0) * 0.001; // Масштабирование 0.001 для kW

    logger.debug(`Modbus данные (Коннектор ${connector.id}): Энергия=${energy} kWh, Мощность=${power} kW`);
    return { energy, power };
  } catch (error) {
    throw new Error(`Ошибка чтения Modbus (Коннектор ${connector.id}): ${error.message}`);
  }
}

/**
 * Опрос данных с коннектора
 * @param {Object} client - OCPP клиент
 * @param {Object} connector - Конфигурация коннектора
 */
async function pollConnectorData(client, connector) {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  try {
    logger.debug(`Опрос данных для коннектора ${connector.id}...`);

    // Чтение данных Modbus
    const { energy, power } = await readEnergyAndPower(connector);

    // Обновление состояния
    dev[connectorKey].Energy = energy;
    dev[connectorKey].Power = power;

    logger.info(`Коннектор ${connector.id}: Энергия=${energy} kWh, Мощность=${power} kW`);

    // Отправка MeterValues, если транзакция активна
    if (dev[connectorKey].transactionId) {
      await sendMeterValues(client, connector.id, dev[connectorKey].transactionId, energy, power);
    }

    // Проверка статуса и отправка StatusNotification
    if (dev[connectorKey].status === 'Unavailable') {
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(client, connector.id, 'Available', 'NoError');
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

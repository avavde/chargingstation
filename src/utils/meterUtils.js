const { modbusClient, readWithTimeout, initializeModbusClient, getMeterReading } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
const { sendStatusNotification, sendMeterValues } = require('./ocppUtils');

async function pollConnectorData(client, connector) {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  try {
    logger.debug(`Опрос Modbus для коннектора ${connector.id}...`);
    modbusClient.setID(connector.meterAddress);

    // Чтение энергии
    const startEnergy = Date.now();
    const energy = await getMeterReading(connector.id); // Используем функцию getMeterReading
    const durationEnergy = Date.now() - startEnergy;

    logger.debug(`Энергия: ${energy} kWh (Время: ${durationEnergy} мс)`);

    // Чтение тока
    const startCurrent = Date.now();
    const currentData = await readWithTimeout(connector.currentRegister, 2, 1000);
    const current = currentData.buffer.readFloatBE(0);
    const durationCurrent = Date.now() - startCurrent;

    logger.debug(`Ток: ${current} A (Время: ${durationCurrent} мс)`);

    // Обновляем данные
    dev[connectorKey].Kwt = energy;
    dev[connectorKey].Current = current;

    // Отправка MeterValues, если транзакция активна
    if (dev[connectorKey].transactionId) {
      await sendMeterValues(client, connector.id);
    }

    if (dev[connectorKey].status === 'Unavailable') {
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(client, connector.id, 'Available', 'NoError');
    }
  } catch (error) {
    logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);
    dev[connectorKey].status = 'Unavailable';
    await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');

    if (!modbusClient.isOpen) {
      logger.warn('Modbus клиент не подключен. Переинициализация...');
      await initializeModbusClient();
    }
  }
}

async function updateModbusData(client) {
  logger.info('Запуск обновления данных Modbus...');

  async function pollLoop() {
    for (const connector of config.connectors) {
      await pollConnectorData(client, connector);
      await new Promise((resolve) => setImmediate(resolve)); // Освобождаем главный поток
    }
    setTimeout(pollLoop, 2000); // Следующий цикл
  }

  pollLoop();
}

module.exports = {
  updateModbusData,
};

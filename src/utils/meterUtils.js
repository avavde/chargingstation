const { modbusClient, readWithTimeout, initializeModbusClient } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
const { sendStatusNotification, sendMeterValues } = require('./ocppUtils');

// Чтение энергии и мощности из Modbus
async function readEnergyAndPower(connector) {
  const energyRegister = connector.energyRegister;
  const powerRegister = connector.powerRegister;

  try {
    // Установка Modbus адреса устройства
    modbusClient.setID(connector.meterAddress);

    // Чтение энергии
    const energyData = await readWithTimeout(energyRegister, 2, 1000);
    const energy = energyData.buffer.readUInt32BE(0) * 0.01; // kWh, коэффициент 0.01 для конверсии

    // Чтение мощности
    const powerData = await readWithTimeout(powerRegister, 2, 1000);
    const power = powerData.buffer.readUInt16BE(0) * 0.1; // kW, коэффициент 0.1 для конверсии

    return { energy, power };
  } catch (error) {
    throw new Error(`Ошибка чтения Modbus: ${error.message}`);
  }
}

async function pollConnectorData(client, connector) {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  try {
    logger.debug(`Опрос данных для коннектора ${connector.id}...`);

    // Чтение энергии и мощности
    const { energy, power } = await readEnergyAndPower(connector);
    logger.debug(`Энергия: ${energy} kWh, Мощность: ${power} kW`);

    // Обновляем данные в dev
    dev[connectorKey].Kwt = energy;
    dev[connectorKey].Power = power;

    // Отправка MeterValues, если транзакция активна
    if (dev[connectorKey].transactionId) {
      await sendMeterValues(client, connector.id, dev[connectorKey].transactionId, energy, power);
    }

    // Проверка статуса
    if (dev[connectorKey].status === 'Unavailable') {
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(client, connector.id, 'Available', 'NoError');
    }
  } catch (error) {
    logger.error(`Ошибка при опросе коннектора ${connector.id}: ${error.message}`);
    dev[connectorKey].status = 'Unavailable';
    await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');

    // Переинициализация Modbus при ошибке
    if (!modbusClient.isOpen) {
      logger.warn('Modbus-клиент не подключен. Переинициализация...');
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
    setTimeout(pollLoop, 2000); // Следующий цикл опроса
  }

  pollLoop();
}

module.exports = {
  updateModbusData,
};

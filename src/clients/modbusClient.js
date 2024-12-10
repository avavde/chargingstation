const ModbusRTU = require('modbus-serial');
const logger = require('../utils/logger');
const { sendStatusNotification } = require('../utils/ocppUtils');
const config = require('../config');
const dev = require('../dev');

const modbusClient = new ModbusRTU();

// Таймаут для чтения регистров
async function readWithTimeout(register, length = 2, timeout = 1000) {
  return Promise.race([
    modbusClient.readHoldingRegisters(register, length),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Modbus таймаут')), timeout)),
  ]);
}

// Инициализация Modbus клиента
async function initializeModbusClient() {
  try {
    logger.info('Инициализация Modbus-клиента...');
    await modbusClient.connectRTUBuffered(config.modbusPort, {
      baudRate: config.modbusBaudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    });
    modbusClient.setTimeout(1000); // 1 секунда таймаут
    logger.info('Modbus-клиент успешно инициализирован.');
  } catch (error) {
    logger.error(`Ошибка при инициализации Modbus-клиента: ${error.message}`);
  }
}

// Функция для опроса данных Modbus
async function pollModbusData(client) {
  logger.info('Запуск опроса данных Modbus...');
  setInterval(async () => {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        console.log(`Опрос Modbus для коннектора ${connector.id}...`);

        // Чтение энергии
        const energy = await readWithTimeout(connector.meterRegister, 2, 1000);
        const current = await readWithTimeout(connector.currentRegister, 2, 1000);

        dev[connectorKey].Kwt = energy;
        dev[connectorKey].Current = current;

        if (dev[connectorKey].status === 'Unavailable') {
          dev[connectorKey].status = 'Available';
          await sendStatusNotification(client, connector.id, 'Available', 'NoError');
        }
      } catch (error) {
        logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);
        if (dev[connectorKey].status !== 'Unavailable') {
          dev[connectorKey].status = 'Unavailable';
          await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
        }
      }
    }
  }, config.modbusPollInterval || 5000);
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  pollModbusData,
  readWithTimeout, // Обязательно экспортируем readWithTimeout
};

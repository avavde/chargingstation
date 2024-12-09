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

const errorCounters = {}; // Счетчик таймаутов для коннекторов

async function pollModbusData(client) {
  logger.info('Запуск опроса данных Modbus...');
  setInterval(async () => {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      errorCounters[connectorKey] = errorCounters[connectorKey] || { count: 0, disabledUntil: 0 };

      const now = Date.now();
      if (now < errorCounters[connectorKey].disabledUntil) {
        console.log(`Опрос для коннектора ${connector.id} временно отключен.`);
        continue; // Пропускаем коннектор на время отключения
      }

      try {
        console.log(`Опрос Modbus для коннектора ${connector.id}...`);
        const energy = await readWithTimeout(connector.meterRegister, 2, 1000);
        const current = await readWithTimeout(connector.currentRegister, 2, 1000);

        dev[connectorKey].Kwt = energy;
        dev[connectorKey].Current = current;

        if (dev[connectorKey].status === 'Unavailable') {
          dev[connectorKey].status = 'Available';
          await sendStatusNotification(client, connector.id, 'Available', 'NoError');
        }

        errorCounters[connectorKey].count = 0; // Сбрасываем счетчик ошибок
      } catch (error) {
        errorCounters[connectorKey].count += 1;
        logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);

        if (errorCounters[connectorKey].count >= 3) {
          logger.warn(`Коннектор ${connector.id} отключен на 30 секунд из-за повторных ошибок.`);
          errorCounters[connectorKey].disabledUntil = now + 30000; // Отключаем на 30 секунд
        }

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

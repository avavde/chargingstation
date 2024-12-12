const ModbusRTU = require('modbus-serial');
const logger = require('../utils/logger');
const config = require('../config');

const modbusClient = new ModbusRTU();

// Таймаут для чтения регистров
async function readWithTimeout(register, length = 2, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Modbus таймаут'));
    }, timeout);

    setTimeout(() => {
      modbusClient.readInputRegisters(register, length)
        .then((data) => {
          clearTimeout(timer);
          resolve(data);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(new Error(`Ошибка Modbus: ${error.message}`));
        });
    }, 100);
  });
}

// Инициализация Modbus клиента
async function initializeModbusClient() {
  try {
    logger.info('Инициализация Modbus-клиента...');
    await modbusClient.connectRTUBuffered(config.modbusPort, {
      baudRate: config.modbusBaudRate,
      dataBits: config.modbusDataBits,
      parity: config.modbusParity,
      stopBits: config.modbusStopBits,
    });
    modbusClient.setTimeout(2000);
    logger.info('Modbus-клиент успешно инициализирован.');
  } catch (error) {
    logger.error(`Ошибка при инициализации Modbus-клиента: ${error.message}`);
  }
}

// Получение текущего показания счётчика
async function getMeterReading(connectorId) {
  const connector = config.connectors.find(c => c.id === connectorId);
  if (!connector) {
    throw new Error(`Коннектор с ID ${connectorId} не найден.`);
  }

  try {
    modbusClient.setID(connector.meterAddress);
    const data = await readWithTimeout(connector.meterRegister, 2, 2000);
    const meterReading = data.buffer.readFloatBE(0); // Предполагаем показания в kWh
    logger.info(`Текущие показания счётчика для коннектора ${connectorId}: ${meterReading} kWh`);
    return meterReading;
  } catch (error) {
    logger.error(`Ошибка при считывании показаний счётчика: ${error.message}`);
    throw error;
  }
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  readWithTimeout,
  getMeterReading,
};

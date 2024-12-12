// src/clients/modbusClient.js

const ModbusRTU = require('modbus-serial');
const logger = require('../utils/logger');
const config = require('../config');
const dev = require('../dev');

const modbusClient = new ModbusRTU();

// Таймаут для чтения регистров
async function readWithTimeout(register, length = 2, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Modbus таймаут'));
    }, timeout);

    setTimeout(() => {
      modbusClient.readInputRegisters(register, length) // Используем Input Registers
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
      baudRate: config.modbusBaudRate, // 9600
      dataBits: config.modbusDataBits, // 8
      parity: config.modbusParity,     // 'none'
      stopBits: config.modbusStopBits, // 2
    });
    modbusClient.setTimeout(2000); // Увеличенный таймаут 2 сек
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
      try {
        logger.debug(`Настройка Modbus ID: ${connector.meterAddress}`);
        modbusClient.setID(connector.meterAddress);

        logger.debug(`Чтение данных с регистра ${connector.meterRegister}...`);
        const energyData = await readWithTimeout(connector.meterRegister, 2, 2000);
        logger.debug(`Полученные данные: ${JSON.stringify(energyData.data)}`);

        // Обновляем состояние коннектора
        dev[connectorKey].Kwt = energyData.data[0]; // пример

      } catch (error) {
        logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);
      }
    }
  }, 5000); // Интервал 5 секунд
}

// Функция для получения текущего показания счётчика
async function getMeterReading(connectorId) {
  const connector = config.connectors.find(c => c.id === connectorId);
  if (!connector) {
    throw new Error(`Коннектор с ID ${connectorId} не найден в конфигурации.`);
  }

  try {
    modbusClient.setID(connector.meterAddress);
    const data = await readWithTimeout(connector.meterRegister, 2, 2000);
    const meterReading = data.data[0]; // Предполагается, что это kWh
    logger.info(`Текущие показания счётчика для коннектора ${connectorId}: ${meterReading} kWh`);
    return meterReading;
  } catch (error) {
    logger.error(`Ошибка при считывании показаний счётчика для коннектора ${connectorId}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  pollModbusData,
  readWithTimeout, // Обязательно экспортируем readWithTimeout
  getMeterReading, // Экспортируем getMeterReading
};

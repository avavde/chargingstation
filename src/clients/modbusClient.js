const ModbusRTU = require('modbus-serial');
const logger = require('../utils/logger');
const { sendStatusNotification } = require('../utils/ocppUtils');
const config = require('../config');
const dev = require('../dev');

const modbusClient = new ModbusRTU();

// Таймаут для чтения регистров
async function readWithTimeout(register, length = 2, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Modbus таймаут'));
    }, timeout);

    modbusClient.readHoldingRegisters(register, length)
      .then((data) => {
        clearTimeout(timer);
        resolve(data);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
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
      try {
        console.log(`Настройка Modbus ID: ${connector.meterAddress}`);
        modbusClient.setID(connector.meterAddress);

        console.log(`Чтение данных с регистра ${connector.meterRegister}...`);
        const energyData = await readWithTimeout(connector.meterRegister, 2, 2000);
        console.log(`Полученные данные: ${JSON.stringify(energyData.data)}`);

        // Обновляем состояние коннектора
        dev[connectorKey].Kwt = energyData.data[0]; // пример

      } catch (error) {
        logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);
      }
    }
  }, 5000); // Интервал 5 секунд
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  pollModbusData,
  readWithTimeout, // Обязательно экспортируем readWithTimeout
};

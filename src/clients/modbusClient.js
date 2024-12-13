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

    modbusClient.readInputRegisters(register, length) // Используем Input Registers (0x04)
      .then((data) => {
        clearTimeout(timer);
        resolve(data);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(new Error(`Ошибка Modbus: ${error.message}`));
      });
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

// Чтение накопленной энергии и мощности
async function readEnergyAndPower(connector) {
  try {
    modbusClient.setID(connector.meterAddress);

    // Чтение накопленной энергии (2 регистра = 4 байта, signed 32-bit, Big Endian)
    const energyData = await readWithTimeout(connector.energyRegister, 2, 2000); 
    const energy = energyData.buffer.readInt32BE(0) * 0.001; // Масштабирование 0.001 для kWh

    // Чтение мгновенной мощности (2 регистра = 4 байта, signed 32-bit, Big Endian)
    const powerData = await readWithTimeout(connector.powerRegister, 2, 2000); 
    const power = powerData.buffer.readInt32BE(0) * 0.001; // Масштабирование 0.001 для kW

    logger.debug(`Modbus данные (Коннектор ${connector.id}): Энергия=${energy} kWh, Мощность=${power} kW`);
    return { energy, power };
  } catch (error) {
    throw new Error(`Ошибка Modbus чтения: ${error.message}`);
  }
}


module.exports = {
  modbusClient,
  initializeModbusClient,
  readWithTimeout,
  readEnergyAndPower,
};

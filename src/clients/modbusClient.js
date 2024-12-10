// src/clients/modbusClient.js

const ModbusRTU = require('modbus-serial');
const config = require('../config');
const logger = require('../utils/logger');

const modbusClient = new ModbusRTU();

async function initializeModbusClient() {
  try {
    await modbusClient.connectRTUBuffered(config.modbusPort, {
      baudRate: config.modbusBaudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    });
    // Установка таймаута для операций modbus:
    modbusClient.setTimeout(500); // например, 500 мс = o,5 секунды

    logger.info('Modbus-клиент успешно инициализирован.');
  } catch (error) {
    logger.error(`Ошибка подключения к Modbus: ${error.message}`);
    // Не выбрасываем исключение, чтобы приложение продолжило работу
  }
}

async function readMeterSerialNumber(connector) {
  try {
    logger.info(`Чтение серийного номера для коннектора ${connector.id}...`);
    modbusClient.setID(connector.meterAddress);
    logger.info(`Адрес Modbus устройства: ${connector.meterAddress}, регистр: ${connector.serialNumberRegister}`);
    const serialNumberData = await modbusClient.readHoldingRegisters(connector.serialNumberRegister, 4);
    logger.info(`Данные серийного номера для коннектора ${connector.id} получены: ${JSON.stringify(serialNumberData)}`);

    const buffer = Buffer.alloc(8);
    for (let i = 0; i < 4; i++) {
      buffer.writeUInt16BE(serialNumberData.data[i], i * 2);
    }
    const serialNumber = buffer.toString('ascii').trim();
    return serialNumber;
  } catch (error) {
    throw new Error(`Ошибка чтения серийного номера: ${error.message}`);
  }
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  readMeterSerialNumber,
};

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
    logger.info('Modbus-клиент успешно инициализирован.');
  } catch (error) {
    logger.error(`Ошибка подключения к Modbus: ${error.message}`);
    // Не выбрасываем исключение, чтобы приложение продолжило работу
    // Клиент остается в неинициализированном состоянии
  }
}

async function readMeterSerialNumber(connector) {
  try {
    modbusClient.setID(connector.meterAddress);
    const serialNumberData = await modbusClient.readHoldingRegisters(
      connector.serialNumberRegister,
      4
    );
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

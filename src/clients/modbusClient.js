const ModbusRTU = require('modbus-serial');
const config = require('../config');
const logger = require('../utils/logger');

const modbusClient = new ModbusRTU();

async function initializeModbusClient() {
  return new Promise((resolve, reject) => {
    modbusClient.connectRTUBuffered(
      config.modbusPort,
      {
        baudRate: config.modbusBaudRate,
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
      },
      (err) => {
        if (err) {
          logger.error(`Ошибка подключения к Modbus: ${err.message}`);
          reject(err);
        } else {
          logger.info('Modbus успешно подключен.');
          resolve();
        }
      }
    );
  });
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

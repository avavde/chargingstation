const ModbusRTU = require('modbus-serial');
const { Mutex } = require('async-mutex');
const logger = require('../utils/logger');
const config = require('../config');

const modbusClient = new ModbusRTU();
const modbusMutex = new Mutex();
const modbusDataCache = {}; // Глобальный кэш данных Modbus

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

async function pollAndCacheConnectorData(connector) {
  return await modbusMutex.runExclusive(async () => {
    try {
      modbusClient.setID(connector.meterAddress);
      const energyData = await modbusClient.readInputRegisters(connector.energyRegister, 2);
      const powerData = await modbusClient.readInputRegisters(connector.powerRegister, 2);

      const energy = Math.abs(energyData.buffer.readInt32BE(0)) / connector.energyScale;
      const power = Math.abs(powerData.buffer.readInt32BE(0)) / connector.powerScale;

      modbusDataCache[connector.id] = { energy, power, timestamp: Date.now() };
      logger.debug(`Modbus данные обновлены для коннектора ${connector.id}: ${energy} kWh, ${power} kW`);
    } catch (error) {
      logger.error(`Ошибка Modbus при опросе коннектора ${connector.id}: ${error.message}`);
    }
  });
}

function getCachedModbusData(connectorId) {
  return modbusDataCache[connectorId] || { energy: 0, power: 0 };
}

module.exports = {
  modbusClient,
  initializeModbusClient,
  pollAndCacheConnectorData,
  getCachedModbusData,
};

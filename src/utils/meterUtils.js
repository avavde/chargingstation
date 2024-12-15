
const logger = require('./logger');
const { pollAndCacheConnectorData, getCachedModbusData } = require('../clients/modbusClient');

async function updateModbusData(client) {
  logger.info('Запуск обновления данных Modbus...');
  async function pollLoop() {
    for (const connector of config.connectors) {
      await pollAndCacheConnectorData(connector);
    }
    setTimeout(pollLoop, 2000);
  }
  pollLoop();
}

async function pollConnectorData(client, connector) {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  const { energy, power } = getCachedModbusData(connector.id);
  dev[connectorKey].Energy = energy;
  dev[connectorKey].Power = power;

  logger.info(`Коннектор ${connector.id}: Энергия=${energy} kWh, Мощность=${power} kW`);

  if (dev[connectorKey].transactionId) {
    await sendMeterValues(client, connector.id, dev[connectorKey].transactionId, energy, power);
  }
}

module.exports = { updateModbusData };

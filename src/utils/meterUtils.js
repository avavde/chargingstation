const { modbusClient } = require('../clients/modbusClient');
const { startTransaction, stopTransaction } = require('./transactionManager');
const dev = require('../dev');
const config = require('../config');
const logger = require('./logger');

async function updateModbusData() {
  logger.info('Запуск функции updateModbusData()');
  while (true) {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        modbusClient.setID(connector.meterAddress);

        const energyData = await modbusClient.readHoldingRegisters(connector.meterRegister, 2);
        dev[connectorKey].Kwt = ((energyData.data[0] << 16) | energyData.data[1]) / 1000;

        const currentData = await modbusClient.readHoldingRegisters(connector.currentRegister, 1);
        dev[connectorKey].Current = currentData.data[0];

        dev[connectorKey].Summ = dev[connectorKey].Kwt * config.pricePerKwh;

        logger.info(
          `Разъем: ${connector.id}, Энергия: ${dev[connectorKey].Kwt} кВт·ч, Ток: ${dev[connectorKey].Current} А, Сумма: ${dev[connectorKey].Summ} руб.`
        );

        // Проверка подключения автомобиля
        const vehicleConnected = dev[connectorKey].Current > 0;

        if (vehicleConnected && dev[connectorKey].status === 'Available') {
          await startTransaction(connector.id, 'LocalStart');
        } else if (!vehicleConnected && dev[connectorKey].status === 'Charging') {
          await stopTransaction(connector.id);
        }

        // Отправка MeterValues
        await sendMeterValues(connector.id);
      } catch (error) {
        logger.error(`Ошибка обновления данных разъема ${connector.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

module.exports = {
  updateModbusData,
};

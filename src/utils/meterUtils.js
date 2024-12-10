// src/utils/meterUtils.js

const { modbusClient } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
const { sendStatusNotification } = require('./ocppUtils');

function updateModbusData(client) {
  setInterval(async () => {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        // Устанавливаем адрес счетчика
        modbusClient.setID(connector.meterAddress);

        // Читаем показания энергии (2 регистра)
        const energyData = await modbusClient.readHoldingRegisters(connector.meterRegister, 2);
        // Предполагая что данные нужно преобразовать, если это float, убедитесь что это корректно
        // Здесь используем readFloatBE только если это действительно float в Big-Endian.
        // Если данные — это raw uint32, возможно нужно другое преобразование.
        // Предположим, что счетчик возвращает float 32-bit Big-Endian.
        const energy = energyData.buffer.readFloatBE(0);

        // Читаем показания тока (2 регистра)
        const currentData = await modbusClient.readHoldingRegisters(connector.currentRegister, 2);
        const current = currentData.buffer.readFloatBE(0);

        // Обновляем данные в dev
        dev[connectorKey].Kwt = energy;
        dev[connectorKey].Current = current;

        // Если коннектор был недоступен ранее, устанавливаем его в доступный статус
        if (dev[connectorKey].status === 'Unavailable') {
          dev[connectorKey].status = 'Available';
          dev[connectorKey].availability = 'Operative';
          await sendStatusNotification(client, connector.id, 'Available', 'NoError');
        }
      } catch (error) {
        logger.error(`Ошибка при обновлении данных для коннектора ${connector.id}: ${error.message}`);

        // Устанавливаем статус Inoperative для недоступного коннектора
        dev[connectorKey].status = 'Unavailable';
        dev[connectorKey].availability = 'Inoperative';
        await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
      }
    }
  }, 5000); // Интервал обновления данных, например, каждые 5 секунд
}

module.exports = {
  updateModbusData,
};

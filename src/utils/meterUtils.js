const { modbusClient, readWithTimeout } = require('../clients/modbusClient');
const config = require('../config');
const dev = require('../dev');
const logger = require('./logger');
console.log('Logger загружен:', logger);
const { sendStatusNotification } = require('./ocppUtils');

function updateModbusData(client) {
  console.log('Запуск обновления данных Modbus...');
  logger.info('Запуск обновления данных Modbus...');

  setInterval(async () => {
    for (const connector of config.connectors) {
      const connectorKey = `${config.stationName}_connector${connector.id}`;
      try {
        console.log(`Опрос Modbus для коннектора ${connector.id}...`);
        logger.debug(`Опрос Modbus для коннектора ${connector.id}...`);

        // Устанавливаем ID устройства
        modbusClient.setID(connector.meterAddress);

        // Чтение энергии
        const startEnergy = Date.now();
        const energyData = await readWithTimeout(connector.meterRegister, 2, 1000);
        const energy = energyData.buffer.readFloatBE(0);
        const durationEnergy = Date.now() - startEnergy;

        console.log(`Показания энергии: ${energy} kWh (Время чтения: ${durationEnergy} мс)`);
        logger.debug(`Показания энергии: ${energy} kWh`);

        // Чтение тока
        const startCurrent = Date.now();
        const currentData = await readWithTimeout(connector.currentRegister, 2, 1000);
        const current = currentData.buffer.readFloatBE(0);
        const durationCurrent = Date.now() - startCurrent;

        console.log(`Показания тока: ${current} A (Время чтения: ${durationCurrent} мс)`);
        logger.debug(`Показания тока: ${current} A`);

        // Обновляем данные
        dev[connectorKey].Kwt = energy;
        dev[connectorKey].Current = current;

        // Если статус был недоступен, обновляем статус
        if (dev[connectorKey].status === 'Unavailable') {
          console.log(`Статус коннектора ${connector.id} изменен на Available.`);
          dev[connectorKey].status = 'Available';
          dev[connectorKey].availability = 'Operative';
          await sendStatusNotification(client, connector.id, 'Available', 'NoError');
        }
      } catch (error) {
        console.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);
        logger.error(`Ошибка Modbus для коннектора ${connector.id}: ${error.message}`);

        // Устанавливаем статус Unavailable
        dev[connectorKey].status = 'Unavailable';
        dev[connectorKey].availability = 'Inoperative';
        await sendStatusNotification(client, connector.id, 'Unavailable', 'NoError');
      }
    }
  }, 2000); // Интервал увеличен для уменьшения нагрузки
}

module.exports = {
  updateModbusData,
};

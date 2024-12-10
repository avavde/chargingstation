// src/clients/ocppClient.js

const { RPCClient } = require('ocpp-rpc');
const logger = require('../utils/logger');
const config = require('../config');

let client;

async function initializeOCPPClient() {
  return new Promise((resolve, reject) => {
    try {
      client = new RPCClient({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6'],
      });

      logger.info(`OCPP-клиент создан с настройками: ${JSON.stringify({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6'],
      })}`);

      // Подписываемся на события клиента
      client.on('open', () => {
        logger.info('Соединение с центральной системой установлено.');
        resolve();
      });

      client.on('close', () => {
        logger.warn('Соединение с центральной системой закрыто.');
        // Здесь можно реализовать повторное подключение
      });

      client.on('error', (error) => {
        logger.error(`Ошибка OCPP-клиента: ${error.message}`);
        // Можно реализовать повторное подключение или другую обработку ошибки
        reject(error);
      });

      // Дополнительные события (если необходимо)
      client.on('request', (request) => {
        logger.debug(`[REQUEST]: ${JSON.stringify(request, null, 2)}`);
      });

      client.on('response', (response) => {
        logger.debug(`[RESPONSE]: ${JSON.stringify(response, null, 2)}`);
      });

      client.on('call', (call) => {
        logger.debug(`[CALL]: ${JSON.stringify(call, null, 2)}`);
      });

      client.on('result', (result) => {
        logger.debug(`[RESULT]: ${JSON.stringify(result, null, 2)}`);
      });

      client.on('message', (message) => {
        logger.debug(`[MESSAGE]: ${message}`);
      });

      // Начинаем соединение
      client.connect().catch((error) => {
        logger.error(`Ошибка подключения OCPP-клиента: ${error.message}`);
        reject(error);
      });
    } catch (error) {
      logger.error(`Ошибка создания OCPP-клиента: ${error.message}`);
      reject(error);
    }
  });
}

function getClient() {
  if (!client) {
    throw new Error('OCPP-клиент еще не инициализирован.');
  }
  return client;
}

module.exports = {
  initializeOCPPClient,
  getClient,
};

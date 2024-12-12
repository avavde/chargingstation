// src/clients/ocppClient.js

const { RPCClient } = require('ocpp-rpc');
const logger = require('../utils/logger');
const config = require('../config');
const dev = require('../dev');
const { controlRelay } = require('../utils/relayControl');
const { readMeterSerialNumber } = require('../clients/modbusClient');
const { getModemInfo } = require('../clients/modemClient');
const { startTransaction, stopTransaction } = require('../utils/transactionManager');
const {
  sendBootNotification,
  sendStatusNotification,
  sendHeartbeat,
  sendFirmwareStatusNotification,
  sendDiagnosticsStatusNotification,
  sendMeterValues,
  sendInitialStatusNotifications,
} = require('../utils/ocppUtils');
const { updateModbusData } = require('../utils/meterUtils');
const { checkReservations, reservations } = require('../utils/reservationManager');
const { setupOCPPHandlers } = require('../handlers/ocppHandlers');

let client;
async function initializeOCPPClient() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('Создаем OCPP-клиент...');

      client = new RPCClient({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6'],
      });

      logger.info(`OCPP-клиент инициализирован с endpoint: ${config.centralSystemUrl}`);

      // Логирование событий подключения
      client.on('open', async () => {
        logger.info('WebSocket-соединение с центральной системой установлено.');
        try {
          const modemInfo = await getModemInfo();
          logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

          await sendBootNotification(client, modemInfo);
          logger.info('BootNotification успешно отправлен.');

          await sendInitialStatusNotifications(client);
          logger.info('StatusNotification успешно отправлены.');

          // Запуск Heartbeat
          setInterval(() => {
            logger.info('Отправка Heartbeat...');
            sendHeartbeat(client);
          }, 60000);

          resolve();
        } catch (error) {
          logger.error(`Ошибка при инициализации OCPP-клиента: ${error.message}`);
          reject(error);
        }
      });

      client.on('error', (error) => {
        logger.error(`WebSocket ошибка: ${error.message}`);
      });

      client.on('close', () => {
        logger.warn('WebSocket-соединение закрыто.');
      });

      // Полное логирование входящих и исходящих сообщений
      client.on('message', (message) => {
        logger.info(`Входящее сообщение: ${message}`);
      });

      client.on('request', (request) => {
        logger.info(`Входящий запрос OCPP: ${JSON.stringify(request)}`);
      });

      client.on('response', (response) => {
        logger.info(`Исходящий ответ OCPP: ${JSON.stringify(response)}`);
      });

      client.on('call', (call) => {
        logger.info(`Исходящий вызов: ${JSON.stringify(call)}`);
      });

      logger.info('Подключаемся к OCPP-серверу...');
      client.connect().catch((error) => {
        logger.error(`Ошибка подключения к OCPP-серверу: ${error.message}`);
        reject(error);
      });
    } catch (error) {
      logger.error(`Ошибка при создании OCPP-клиента: ${error.message}`);
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

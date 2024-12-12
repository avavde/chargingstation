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
        try {
          let parsedMessage;
      
          // Полное логирование входящего сообщения
          logger.info(`Входящее сообщение (сырой формат): ${JSON.stringify(message, null, 2)}`);
      
          if (message && message.message) {
            parsedMessage = JSON.parse(message.message);
          } else if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          } else {
            parsedMessage = message;
          }
      
          if (!Array.isArray(parsedMessage)) {
            throw new Error('Входящее сообщение имеет неверный формат');
          }
      
          const [messageType, messageId, actionOrPayload, payload] = parsedMessage;
      
          let logDetails = {};
          if (messageType === 2) { // Запрос
            logDetails = {
              type: 'Request',
              messageId,
              method: actionOrPayload,
              payload: payload || {},
            };
          } else if (messageType === 3) { // Ответ
            logDetails = {
              type: 'Response',
              messageId,
              payload: actionOrPayload,
            };
          } else if (messageType === 4) { // Ошибка
            logDetails = {
              type: 'Error',
              messageId,
              errorDetails: actionOrPayload,
              payload: parsedMessage[4] || {},
            };
          }
      
          logger.info(`Полное входящее сообщение OCPP:\n${JSON.stringify(logDetails, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке входящего сообщения: ${error.message}`);
          logger.error(
            `Содержимое сообщения: ${typeof message === 'string' ? message : JSON.stringify(message, null, 2)}`
          );
        }
      });
      
      client.on('request', (request) => {
        try {
          const [messageType, messageId, method, payload] = request;
      
          logger.info(
            `Входящий запрос OCPP:\n${JSON.stringify(
              {
                type: 'Request',
                messageId: messageId || 'N/A',
                method: method || 'Unknown',
                payload: payload || {},
              },
              null,
              2
            )}`
          );
        } catch (error) {
          logger.error(`Ошибка при обработке входящего запроса: ${error.message}`);
          logger.error(`Содержимое запроса: ${JSON.stringify(request, null, 2)}`);
        }
      });
      
      client.on('response', (response) => {
        try {
          const [messageType, messageId, payload] = response;
      
          logger.info(
            `Исходящий ответ OCPP:\n${JSON.stringify(
              {
                type: 'Response',
                messageId: messageId || 'N/A',
                payload: payload || {},
              },
              null,
              2
            )}`
          );
        } catch (error) {
          logger.error(`Ошибка при обработке ответа: ${error.message}`);
          logger.error(`Содержимое ответа: ${JSON.stringify(response, null, 2)}`);
        }
      });
      
      client.on('call', (call) => {
        try {
          logger.info(`Исходящий вызов OCPP:\n${JSON.stringify(call, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке исходящего вызова: ${error.message}`);
          logger.error(`Содержимое вызова: ${JSON.stringify(call, null, 2)}`);
        }
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

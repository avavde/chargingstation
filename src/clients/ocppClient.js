const { RPCClient } = require('ocpp-rpc');
const logger = require('../utils/logger');
const config = require('../config');
const { getModemInfo } = require('../clients/modemClient');
const { sendBootNotification, sendHeartbeat, sendInitialStatusNotifications } = require('../utils/ocppUtils');

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

      // Обработчик открытия WebSocket-соединения
      client.on('open', async () => {
        logger.info('WebSocket-соединение с центральной системой установлено.');
        try {
          const modemInfo = await getModemInfo();
          logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

          await sendBootNotification(client, modemInfo);
          logger.info('BootNotification успешно отправлен.');

          await sendInitialStatusNotifications(client);
          logger.info('StatusNotification успешно отправлены.');

          // Периодическая отправка Heartbeat
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

      // Обработчик ошибок WebSocket
      client.on('error', (error) => {
        logger.error(`WebSocket ошибка: ${error.message}`);
      });

      // Обработчик закрытия WebSocket
      client.on('close', () => {
        logger.warn('WebSocket-соединение закрыто.');
      });

      // Логирование всех входящих и исходящих сообщений
      client.on('message', (message) => {
        try {
          logger.info(`Входящее сообщение (сырой формат): ${JSON.stringify(message, null, 2)}`);

          const parsedMessage = JSON.parse(
            message.message || (typeof message === 'string' ? message : JSON.stringify(message))
          );

          if (!Array.isArray(parsedMessage)) {
            throw new Error('Сообщение имеет неверный формат OCPP.');
          }

          const [messageType, messageId, methodOrPayload, payload] = parsedMessage;

          let logDetails = {};
          if (messageType === 2) { // Запрос
            logDetails = {
              type: 'Request',
              messageId,
              method: methodOrPayload,
              payload: payload || {},
            };
          } else if (messageType === 3) { // Ответ
            logDetails = {
              type: 'Response',
              messageId,
              payload: methodOrPayload,
            };
          } else if (messageType === 4) { // Ошибка
            logDetails = {
              type: 'Error',
              messageId,
              errorDetails: methodOrPayload,
              payload: parsedMessage[4] || {},
            };
          }

          logger.info(`Полное входящее сообщение OCPP:\n${JSON.stringify(logDetails, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке входящего сообщения: ${error.message}`);
          logger.error(`Содержимое сообщения: ${JSON.stringify(message, null, 2)}`);
        }
      });

      // Обработчик входящих запросов
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

      // Обработчик входящих ответов
      client.on('response', (response) => {
        try {
          const [messageType, messageId, payload] = response;

          logger.info(
            `Входящий ответ OCPP:\n${JSON.stringify(
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

      // Обработчик исходящих вызовов
      client.on('call', (call) => {
        try {
          logger.info(`Исходящий вызов OCPP:\n${JSON.stringify(call, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке исходящего вызова: ${error.message}`);
          logger.error(`Содержимое вызова: ${JSON.stringify(call, null, 2)}`);
        }
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
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
      
          let parsedMessage = Array.isArray(message) ? message : JSON.parse(message);
      
          if (!Array.isArray(parsedMessage)) {
            throw new Error('Входящее сообщение имеет неверный формат.');
          }
      
          const [messageType, messageId, payload] = parsedMessage;
      
          if (messageType === 2) {
            logger.info(`Полное входящее сообщение OCPP: ${JSON.stringify({
              type: 'Request',
              messageId,
              method: payload,
              payload: parsedMessage[3] || {}
            }, null, 2)}`);
          } else if (messageType === 3) {
            logger.info(`Полное входящее сообщение OCPP: ${JSON.stringify({
              type: 'Response',
              messageId,
              payload
            }, null, 2)}`);
          } else if (messageType === 4) {
            logger.error(`Ошибка в сообщении OCPP: ${JSON.stringify({
              type: 'Error',
              messageId,
              details: payload
            }, null, 2)}`);
          } else {
            throw new Error(`Неизвестный тип сообщения: ${messageType}`);
          }
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
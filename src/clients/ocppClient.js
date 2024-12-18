const { RPCClient } = require('ocpp-rpc');
const logger = require('../utils/logger');
const config = require('../config');
const { getModemInfo } = require('../clients/modemClient');
const { sendBootNotification, sendHeartbeat, sendInitialStatusNotifications } = require('../utils/ocppUtils');
const { sendDataTransfer } = require('../utils/ocppUtils');

let client;

/**
 * Инициализация OCPP-клиента и подключение к центральной системе.
 * После установления соединения отправляет BootNotification, начальные StatusNotification
 * и запускает периодическую отправку Heartbeat.
 */
async function initializeOCPPClient() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('Создаем OCPP-клиент...');

      client = new RPCClient({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6']
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

              // Синхронизация времени с сервером
    const timeSyncResponse = await sendDataTransfer(client, {
      vendorId: "YourVendorId", // Уникальный идентификатор для вашего приложения
      messageId: "TimeSyncRequest",
    });

    if (timeSyncResponse && timeSyncResponse.data) {
      const serverTime = timeSyncResponse.data.serverTime;
      if (serverTime) {
        const systemTime = new Date(serverTime);
        logger.info(`Синхронизация времени: ${systemTime.toISOString()}`);
        setSystemTime(systemTime); // Функция для установки системного времени
      } else {
        logger.warn('Сервер не вернул время в ответ на TimeSyncRequest.');
      }
    }

          await sendInitialStatusNotifications(client);
          logger.info('StatusNotification успешно отправлены.');

          // Периодическая отправка Heartbeat с использованием конфигурации
          const heartbeatInterval = config.heartbeatInterval || 60000; // Используем значение из конфигурации или по умолчанию 60000 мс

          setInterval(() => {
            logger.info('Отправка Heartbeat...');
            sendHeartbeat(client);
          }, heartbeatInterval);

          logger.info(`Heartbeat будет отправляться каждые ${heartbeatInterval / 1000} секунд.`);

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

      // Обработчик всех входящих/исходящих сообщений (сырые данные - строка)
      client.on('message', (rawMsg) => {
        // rawMsg: { message: '["..."]', outbound: boolean }
        logger.info(`Входящее сообщение (сырой формат): ${JSON.stringify(rawMsg, null, 2)}`);
        try {
          const rawMessageStr = rawMsg.message;
          if (typeof rawMessageStr !== 'string') {
            throw new Error('Отсутствует корректная строка для парсинга.');
          }

          const parsedMessage = JSON.parse(rawMessageStr);
          if (!Array.isArray(parsedMessage)) {
            throw new Error('Входящее сообщение имеет неверный формат. Ожидался массив.');
          }

          const [messageType, messageId, ...rest] = parsedMessage;

          if (messageType === 2) {
            // OCPP Call (Request)
            const [action, payload = {}] = rest;
            logger.info(`Полное входящее сообщение OCPP: ${JSON.stringify({
              type: 'Request',
              messageId,
              method: action,
              payload
            }, null, 2)}`);
          } else if (messageType === 3) {
            // OCPP CallResult (Response)
            const [payload = {}] = rest;
            logger.info(`Полное входящее сообщение OCPP: ${JSON.stringify({
              type: 'Response',
              messageId,
              payload
            }, null, 2)}`);
          } else if (messageType === 4) {
            // OCPP CallError
            const [errorDetails] = rest;
            logger.error(`Ошибка в сообщении OCPP: ${JSON.stringify({
              type: 'Error',
              messageId,
              details: errorDetails
            }, null, 2)}`);
          } else {
            throw new Error(`Неизвестный тип сообщения: ${messageType}`);
          }
        } catch (error) {
          logger.error(`Ошибка при обработке входящего сообщения: ${error.message}`);
          logger.error(`Содержимое сообщения: ${JSON.stringify(rawMsg, null, 2)}`);
        }
      });

      // Обработчик входящих запросов (уже распарсенные данные в payload)
      client.on('request', (rawReq) => {
        try {
          // rawReq: { outbound: boolean, payload: [...] }
          // payload - массив вида [2, messageId, action, payloadObj]
          const { payload } = rawReq;
          if (!Array.isArray(payload)) {
            throw new Error('Некорректный формат запроса OCPP.');
          }

          const [messageType, messageId, method, reqPayload] = payload;

          logger.info(`Входящий запрос OCPP:\n${JSON.stringify({
            type: 'Request',
            messageId: messageId || 'N/A',
            method: method || 'Unknown',
            payload: reqPayload || {}
          }, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке входящего запроса: ${error.message}`);
          logger.error(`Содержимое запроса: ${JSON.stringify(rawReq, null, 2)}`);
        }
      });

      // Обработчик входящих ответов (уже распарсенные данные в payload)
      client.on('response', (rawRes) => {
        try {
          // rawRes: { outbound: boolean, payload: [...] }
          // payload - массив вида [3, messageId, payloadObj]
          const { payload } = rawRes;
          if (!Array.isArray(payload)) {
            throw new Error('Некорректный формат ответа OCPP.');
          }

          const [messageType, messageId, resPayload] = payload;

          logger.info(`Входящий ответ OCPP:\n${JSON.stringify({
            type: 'Response',
            messageId: messageId || 'N/A',
            payload: resPayload || {}
          }, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке ответа: ${error.message}`);
          logger.error(`Содержимое ответа: ${JSON.stringify(rawRes, null, 2)}`);
        }
      });

      // Обработчик исходящих вызовов (уже распарсенные данные в payload)
      client.on('call', (rawCall) => {
        try {
          // rawCall: { outbound: boolean, payload: [...] }
          // payload - массив вида [2, messageId, action, payloadObj] для запросов
          // или [3, messageId, payloadObj] для ответов
          const { payload } = rawCall;
          if (!Array.isArray(payload)) {
            throw new Error('Некорректный формат исходящего вызова OCPP.');
          }

          logger.info(`Исходящий вызов OCPP:\n${JSON.stringify(payload, null, 2)}`);
        } catch (error) {
          logger.error(`Ошибка при обработке исходящего вызова: ${error.message}`);
          logger.error(`Содержимое вызова: ${JSON.stringify(rawCall, null, 2)}`);
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



/**
 * Возвращает экземпляр OCPP-клиента.
 * Если клиент еще не инициализирован, генерируется ошибка.
 */
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

const { RPCClient } = require('ocpp-rpc');
const logger = require('../utils/logger');
const config = require('../config');
const { getModemInfo } = require('../clients/modemClient');
const { sendBootNotification, sendHeartbeat, sendInitialStatusNotifications, sendDataTransfer } = require('../utils/ocppUtils');
const { exec } = require('child_process');

let client;

/**
 * Установка системного времени на основе переданной даты.
 * @param {string} dateTime - Строка с датой и временем в ISO формате.
 */
function setSystemTime(dateTime) {
  const command = `date -s "${dateTime}"`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      logger.error(`Ошибка установки системного времени: ${error.message}`);
    } else {
      logger.info(`Системное время успешно установлено: ${dateTime}`);
    }
  });
}

/**
 * Универсальный обработчик сообщений OCPP.
 * @param {Object} rawData - Сырой формат данных сообщения.
 * @param {string} type - Тип события: message, request, response, call.
 */
function handleRawMessage(rawData, type) {
  try {
    logger.info(`Входящее событие (${type}): ${JSON.stringify(rawData, null, 2)}`);

    const message = rawData.message || rawData.payload;

    if (!message) {
      throw new Error('Пустое сообщение или payload.');
    }

    const parsedMessage = Array.isArray(message) ? message : JSON.parse(message);

    if (!Array.isArray(parsedMessage)) {
      throw new Error('Некорректный формат OCPP-сообщения.');
    }

    const [messageType, messageId, ...rest] = parsedMessage;

    if (messageType === 2) {
      // OCPP Call (Request)
      const [action, payload = {}] = rest;
      logger.info(`Запрос: ${action}, Параметры: ${JSON.stringify(payload)}`);

      if (payload?.currentTime || payload?.expiryDate) {
        const timeToSet = payload.currentTime || payload.expiryDate;
        setSystemTime(timeToSet);
      }
    } else if (messageType === 3) {
      // OCPP CallResult (Response)
      const [payload = {}] = rest;
      logger.info(`Ответ: ${JSON.stringify(payload)}`);

      if (payload?.currentTime || payload?.expiryDate) {
        const timeToSet = payload.currentTime || payload.expiryDate;
        setSystemTime(timeToSet);
      }
    } else if (messageType === 4) {
      // OCPP CallError
      const [errorCode, errorDescription, details] = rest;
      logger.error(`Ошибка: ${errorCode}, Описание: ${errorDescription}, Детали: ${JSON.stringify(details)}`);
    } else {
      throw new Error(`Неизвестный тип сообщения: ${messageType}`);
    }
  } catch (error) {
    logger.error(`Ошибка при обработке события (${type}): ${error.message}`);
  }
}

/**
 * Инициализация OCPP-клиента и подключение к центральной системе.
 */
async function initializeOCPPClient() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('Создаем OCPP-клиент...');

      client = new RPCClient({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6'],
      });

      client.on('open', async () => {
        logger.info('WebSocket-соединение установлено.');

        try {
          const modemInfo = await getModemInfo();
          logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

          await sendBootNotification(client, modemInfo);
          logger.info('BootNotification успешно отправлен.');

          const timeSyncResponse = await sendDataTransfer(client, {
            vendorId: "YourVendorId",
            messageId: "TimeSyncRequest",
          });

          if (timeSyncResponse?.data?.serverTime) {
            setSystemTime(timeSyncResponse.data.serverTime);
          }

          await sendInitialStatusNotifications(client);
          logger.info('StatusNotification успешно отправлены.');

          const heartbeatInterval = config.heartbeatInterval || 60000;
          setInterval(() => sendHeartbeat(client), heartbeatInterval);

          resolve();
        } catch (error) {
          logger.error(`Ошибка при инициализации: ${error.message}`);
          reject(error);
        }
      });

      // Обработчики событий
      client.on('error', (error) => logger.error(`WebSocket ошибка: ${error.message}`));
      client.on('close', () => logger.warn('WebSocket-соединение закрыто.'));
      client.on('message', (rawMsg) => handleRawMessage(rawMsg, 'message'));
      client.on('request', (rawReq) => handleRawMessage(rawReq, 'request'));
      client.on('response', (rawRes) => handleRawMessage(rawRes, 'response'));
      client.on('call', (rawCall) => handleRawMessage(rawCall, 'call'));

      client.connect().catch((error) => {
        logger.error(`Ошибка подключения: ${error.message}`);
        reject(error);
      });
    } catch (error) {
      logger.error(`Ошибка создания OCPP-клиента: ${error.message}`);
      reject(error);
    }
  });
}

function getClient() {
  if (!client) throw new Error('OCPP-клиент еще не инициализирован.');
  return client;
}

module.exports = {
  initializeOCPPClient,
  getClient,
};

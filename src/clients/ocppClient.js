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
 * Инициализация OCPP-клиента и подключение к центральной системе.
 * После установления соединения отправляет BootNotification, начальные StatusNotification,
 * синхронизирует время и запускает периодическую отправку Heartbeat.
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

      logger.info(`OCPP-клиент инициализирован с endpoint: ${config.centralSystemUrl}`);

      client.on('open', async () => {
        logger.info('WebSocket-соединение установлено.');

        try {
          const modemInfo = await getModemInfo();
          logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

          await sendBootNotification(client, modemInfo);
          logger.info('BootNotification успешно отправлен.');

          // Синхронизация времени
          const timeSyncResponse = await sendDataTransfer(client, {
            vendorId: "YourVendorId",
            messageId: "TimeSyncRequest",
          });

          if (timeSyncResponse && timeSyncResponse.data?.serverTime) {
            setSystemTime(timeSyncResponse.data.serverTime);
          } else {
            logger.warn('Время для синхронизации не получено.');
          }

          await sendInitialStatusNotifications(client);
          logger.info('StatusNotification успешно отправлены.');

          const heartbeatInterval = config.heartbeatInterval || 60000;
          setInterval(() => sendHeartbeat(client), heartbeatInterval);

          logger.info(`Heartbeat будет отправляться каждые ${heartbeatInterval / 1000} секунд.`);
          resolve();
        } catch (error) {
          logger.error(`Ошибка инициализации: ${error.message}`);
          reject(error);
        }
      });

      // Обработка ошибок
      client.on('error', (error) => logger.error(`WebSocket ошибка: ${error.message}`));
      client.on('close', () => logger.warn('WebSocket-соединение закрыто.'));

      // Универсальная обработка сообщений
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

/**
 * Универсальный обработчик сообщений OCPP.
 * @param {Object} rawData - Сырой формат данных сообщения.
 * @param {string} type - Тип события: message, request, response, call.
 */
function handleRawMessage(rawData, type) {
  try {
    logger.info(`Входящее событие (${type}): ${JSON.stringify(rawData, null, 2)}`);
    const { message } = rawData;
    const parsedMessage = JSON.parse(message);

    if (!Array.isArray(parsedMessage)) {
      throw new Error('Некорректный формат OCPP-сообщения.');
    }

    const [messageType, messageId, ...rest] = parsedMessage;

    if (type === 'request' || type === 'message') {
      const [action, payload] = rest;
      logger.info(`Запрос: ${action}, Параметры: ${JSON.stringify(payload)}`);

      if (payload?.timestamp || payload?.expiryDate) {
        const timeToSet = payload.timestamp || payload.expiryDate;
        setSystemTime(timeToSet);
      }
    } else if (type === 'response') {
      const [payload] = rest;
      logger.info(`Ответ: ${JSON.stringify(payload)}`);

      if (payload?.timestamp || payload?.expiryDate) {
        const timeToSet = payload.timestamp || payload.expiryDate;
        setSystemTime(timeToSet);
      }
    } else if (type === 'call') {
      logger.info(`Исходящий вызов: ${JSON.stringify(rest, null, 2)}`);
    }
  } catch (error) {
    logger.error(`Ошибка при обработке события (${type}): ${error.message}`);
  }
}

/**
 * Возвращает экземпляр OCPP-клиента.
 */
function getClient() {
  if (!client) throw new Error('OCPP-клиент еще не инициализирован.');
  return client;
}

module.exports = {
  initializeOCPPClient,
  getClient,
};

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
      client = new RPCClient({
        endpoint: config.centralSystemUrl,
        identity: config.stationName,
        protocols: ['ocpp1.6'],
      });

      logger.info(
        `OCPP-клиент создан с настройками: ${JSON.stringify(
          {
            endpoint: config.centralSystemUrl,
            identity: config.stationName,
            protocols: ['ocpp1.6'],
          },
          null,
          2
        )}`
      );

      // Подписываемся на события клиента
      client.on('open', async () => {
        logger.info('Соединение с центральной системой установлено.');
        try {
          // Получение информации о модеме
          const modemInfo = await getModemInfo();
          logger.info(`Информация о модеме: ${JSON.stringify(modemInfo)}`);

          // Отправляем BootNotification
          await sendBootNotification(client, modemInfo);

          // Отправляем начальные StatusNotification
          await sendInitialStatusNotifications(client);

          // Запуск Heartbeat
          setInterval(() => sendHeartbeat(client), 60000);

          // Запуск обновления данных Modbus
          updateModbusData(client);

          // Запуск проверки бронирований
          setInterval(() => checkReservations(client), 60000);

          // Успешное подключение
          resolve();
        } catch (error) {
          logger.error(`Ошибка при обработке события 'open': ${error.message}`);
          reject(error);
        }
      });

      client.on('close', () => {
        logger.warn('Соединение с центральной системой закрыто.');
        // Можно реализовать логику повторного подключения, если нужно
      });

      client.on('error', (error) => {
        logger.error(`Ошибка OCPP-клиента: ${error.message}`);
        // Если ошибка произошла до 'open', это означает проблемы с подключением
        // Если 'open' еще не вызывался, вызываем reject(error)
        if (!client.isOpen) {
          reject(error);
        }
        // Если ошибка произошла после 'open', промис уже зарезолвен, просто логируем.
      });

      // Логирование всех входящих и исходящих сообщений
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

      // Регистрация обработчиков сообщений
      setupOCPPHandlers(client);

      // Подключение к центральной системе
      logger.info('Попытка подключения к OCPP-серверу...');
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

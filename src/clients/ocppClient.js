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
} = require('../utils/ocppUtils');
const { updateModbusData } = require('../utils/meterUtils');
const { checkReservations, reservations } = require('../utils/reservationManager');

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

          // Отправка BootNotification
          await sendBootNotification(client, modemInfo);

          // Отправка начальных StatusNotification
          await sendInitialStatusNotifications(client);

          // Запуск Heartbeat
          setInterval(() => sendHeartbeat(client), 60000);

          // Запуск обновления данных Modbus
          updateModbusData();

          // Запуск проверки бронирований
          setInterval(() => checkReservations(client), 60000);

          resolve();
        } catch (error) {
          logger.error(`Ошибка при обработке события 'open': ${error.message}`);
          reject(error);
        }
      });

      client.on('close', () => {
        logger.warn('Соединение с центральной системой закрыто.');
        // Можно реализовать логику повторного подключения
      });

      client.on('error', (error) => {
        logger.error(`Ошибка OCPP-клиента: ${error.message}`);
        // Можно реализовать повторное подключение или другую обработку ошибки
        // reject(error);
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

// Функция для регистрации обработчиков OCPP
function setupOCPPHandlers(client) {
  // Обработчик Authorize
  client.handle('Authorize', async (payload) => {
    logger.info(`Authorize получен: ${JSON.stringify(payload)}`);
    // Реализуйте логику авторизации, если требуется
    return { idTagInfo: { status: 'Accepted' } };
  });

  // Обработчик BootNotification обрабатывается в client.on('open')

  // Обработчик StartTransaction и StopTransaction вызываются из функций startTransaction и stopTransaction

  // Обработчик DataTransfer
  client.handle('DataTransfer', async (payload) => {
    logger.info(`DataTransfer получен: ${JSON.stringify(payload)}`);
    const { vendorId, messageId, data } = payload;
    // Обработка пользовательских данных
    logger.info(`DataTransfer от ${vendorId}: ${messageId}, данные: ${data}`);
    return { status: 'Accepted', data: 'Response data' };
  });

  // Обработчик RemoteStartTransaction
  client.handle('RemoteStartTransaction', async (payload) => {
    logger.info(`RemoteStartTransaction получен: ${JSON.stringify(payload)}`);
    try {
      const connectorId = payload.connectorId || 1;
      const idTag = payload.idTag || 'Unknown';

      const connectorKey = `${config.stationName}_connector${connectorId}`;
      const connector = config.connectors.find((c) => c.id === connectorId);

      if (!connector) {
        logger.error(`Разъем с ID ${connectorId} не найден.`);
        return { status: 'Rejected' };
      }

      if (dev[connectorKey].status !== 'Available') {
        logger.error(`Разъем ${connectorId} недоступен для зарядки.`);
        return { status: 'Rejected' };
      }

      // Начинаем транзакцию
      await startTransaction(connectorId, idTag, client);

      return { status: 'Accepted' };
    } catch (error) {
      logger.error(`Ошибка в обработчике RemoteStartTransaction: ${error.message}`);
      return { status: 'Rejected' };
    }
  });

  // Обработчик RemoteStopTransaction
  client.handle('RemoteStopTransaction', async (payload) => {
    logger.info(`RemoteStopTransaction получен: ${JSON.stringify(payload)}`);
    try {
      const { transactionId } = payload;
      const connector = config.connectors.find(
        (c) => dev[`${config.stationName}_connector${c.id}`].transactionId === transactionId
      );

      if (!connector) {
        logger.error(`Транзакция с ID ${transactionId} не найдена.`);
        return { status: 'Rejected' };
      }

      await stopTransaction(connector.id, client);

      return { status: 'Accepted' };
    } catch (error) {
      logger.error(`Ошибка в обработчике RemoteStopTransaction: ${error.message}`);
      return { status: 'Rejected' };
    }
  });

  // Обработчик ChangeAvailability
  client.handle('ChangeAvailability', async (payload) => {
    logger.info(`ChangeAvailability получен: ${JSON.stringify(payload)}`);
    const { connectorId, type } = payload;
    let status = 'Accepted';

    try {
      if (connectorId === 0) {
        // Изменение доступности всей станции
        for (const connector of config.connectors) {
          const connectorKey = `${config.stationName}_connector${connector.id}`;
          dev[connectorKey].availability = type;
          const newStatus = type === 'Operative' ? 'Available' : 'Unavailable';
          dev[connectorKey].status = newStatus;
          await sendStatusNotification(client, connector.id, newStatus, 'NoError');
        }
      } else {
        // Изменение доступности конкретного коннектора
        const connector = config.connectors.find((c) => c.id === connectorId);
        if (!connector) {
          logger.error(`Разъем с ID ${connectorId} не найден.`);
          status = 'Rejected';
        } else {
          const connectorKey = `${config.stationName}_connector${connector.id}`;
          dev[connectorKey].availability = type;
          const newStatus = type === 'Operative' ? 'Available' : 'Unavailable';
          dev[connectorKey].status = newStatus;
          await sendStatusNotification(client, connectorId, newStatus, 'NoError');
        }
      }
    } catch (error) {
      logger.error(`Ошибка в обработчике ChangeAvailability: ${error.message}`);
      status = 'Rejected';
    }

    return { status };
  });

  // Обработчик ChangeConfiguration
  client.handle('ChangeConfiguration', async (payload) => {
    logger.info(`ChangeConfiguration получен: ${JSON.stringify(payload)}`);
    const { key, value } = payload;
    let status = 'Accepted';

    try {
      // Реализуйте изменение конфигурации, если требуется
      logger.info(`Параметр ${key} изменен на ${value}.`);
    } catch (error) {
      logger.error(`Ошибка в обработчике ChangeConfiguration: ${error.message}`);
      status = 'Rejected';
    }

    return { status };
  });

  // Обработчик GetConfiguration
  client.handle('GetConfiguration', async (payload) => {
    logger.info(`GetConfiguration получен: ${JSON.stringify(payload)}`);
    const { key } = payload;
    const configurationKey = [];
    const unknownKey = [];

    // Реализуйте получение конфигурации
    // Например:
    if (!key || key.length === 0) {
      // Возвращаем все возможные настройки
      configurationKey.push(
        {
          key: 'AllowOfflineTxForUnknownId',
          readonly: false,
          value: 'false',
        },
        {
          key: 'AuthorizationCacheEnabled',
          readonly: false,
          value: 'true',
        }
        // Добавьте другие настройки по необходимости
      );
    } else {
      // Возвращаем только запрошенные ключи
      for (const k of key) {
        if (k === 'AllowOfflineTxForUnknownId') {
          configurationKey.push({
            key: 'AllowOfflineTxForUnknownId',
            readonly: false,
            value: 'false',
          });
        } else if (k === 'AuthorizationCacheEnabled') {
          configurationKey.push({
            key: 'AuthorizationCacheEnabled',
            readonly: false,
            value: 'true',
          });
        } else {
          unknownKey.push(k);
        }
      }
    }

    return { configurationKey, unknownKey };
  });

  // Обработчик UnlockConnector
  client.handle('UnlockConnector', async (payload) => {
    logger.info(`UnlockConnector получен: ${JSON.stringify(payload)}`);
    const { connectorId } = payload;
    let status = 'Unlocked';

    try {
      const connector = config.connectors.find((c) => c.id === connectorId);
      if (!connector) {
        logger.error(`Разъем с ID ${connectorId} не найден.`);
        status = 'NotSupported';
      } else {
        // Реализуйте логику разблокировки коннектора, если требуется
        logger.info(`Разъем ${connectorId} разблокирован.`);
      }
    } catch (error) {
      logger.error(`Ошибка в обработчике UnlockConnector: ${error.message}`);
      status = 'UnlockFailed';
    }

    return { status };
  });

  // Обработчик Reset
  client.handle('Reset', async (payload) => {
    logger.info(`Reset получен: ${JSON.stringify(payload)}`);
    const { type } = payload; // 'Hard' или 'Soft'
    let status = 'Accepted';

    try {
      // Реализуйте логику перезагрузки станции
      logger.info(`Выполняется ${type} reset станции.`);
      // Например, вызвать process.exit(0) для перезагрузки приложения
    } catch (error) {
      logger.error(`Ошибка в обработчике Reset: ${error.message}`);
      status = 'Rejected';
    }

    return { status };
  });

  // Обработчики бронирования ReserveNow и CancelReservation
  client.handle('ReserveNow', async (payload) => {
    logger.info(`ReserveNow получен: ${JSON.stringify(payload)}`);
    const { connectorId, expiryDate, idTag, reservationId } = payload;
    const connector = config.connectors.find((c) => c.id === connectorId);

    if (!connector) {
      logger.error(`Разъем с ID ${connectorId} не найден.`);
      return { status: 'Rejected' };
    }

    const connectorKey = `${config.stationName}_connector${connectorId}`;

    if (dev[connectorKey].status !== 'Available') {
      logger.error(`Разъем ${connectorId} недоступен для бронирования.`);
      return { status: 'Occupied' };
    }

    // Создаем бронирование
    reservations[reservationId] = {
      connectorId,
      expiryDate: new Date(expiryDate),
      idTag,
    };

    // Обновляем статус разъема
    dev[connectorKey].status = 'Reserved';
    await sendStatusNotification(client, connectorId, 'Reserved', 'NoError');

    return { status: 'Accepted' };
  });

  client.handle('CancelReservation', async (payload) => {
    logger.info(`CancelReservation получен: ${JSON.stringify(payload)}`);
    const { reservationId } = payload;

    if (reservations[reservationId]) {
      const connectorId = reservations[reservationId].connectorId;
      delete reservations[reservationId];

      const connectorKey = `${config.stationName}_connector${connectorId}`;
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(client, connectorId, 'Available', 'NoError');

      return { status: 'Accepted' };
    } else {
      logger.error(`Бронирование с ID ${reservationId} не найдено.`);
      return { status: 'Rejected' };
    }
  });

  // Обработчик UpdateFirmware
  client.handle('UpdateFirmware', async (payload) => {
    logger.info(`UpdateFirmware получен: ${JSON.stringify(payload)}`);
    const { location, retrieveDate, retries, retryInterval } = payload;

    try {
      // Реализуйте логику загрузки и обновления ПО
      // Например, загрузить файл по URL и запустить процесс обновления

      // Имитируем успешное начало обновления
      setTimeout(async () => {
        // Отправляем FirmwareStatusNotification со статусом 'Downloading'
        await sendFirmwareStatusNotification(client, 'Downloading');

        // Имитация загрузки и обновления
        setTimeout(async () => {
          // Отправляем FirmwareStatusNotification со статусом 'Installing'
          await sendFirmwareStatusNotification(client, 'Installing');

          // Имитация завершения обновления
          setTimeout(async () => {
            // Отправляем FirmwareStatusNotification со статусом 'Installed'
            await sendFirmwareStatusNotification(client, 'Installed');
          }, 5000);
        }, 5000);
      }, 1000);

      return {};
    } catch (error) {
      logger.error(`Ошибка в обработчике UpdateFirmware: ${error.message}`);
      return {};
    }
  });

  // Обработчик GetDiagnostics
  client.handle('GetDiagnostics', async (payload) => {
    logger.info(`GetDiagnostics получен: ${JSON.stringify(payload)}`);
    const { location, retries, retryInterval, startTime, stopTime } = payload;

    try {
      // Реализуйте логику сбора и отправки диагностической информации

      // Отправляем DiagnosticsStatusNotification со статусом 'Uploading'
      await sendDiagnosticsStatusNotification(client, 'Uploading');

      // Имитируем загрузку диагностики
      setTimeout(async () => {
        // Отправляем DiagnosticsStatusNotification со статусом 'Uploaded'
        await sendDiagnosticsStatusNotification(client, 'Uploaded');
      }, 5000);

      return { fileName: 'diagnostics.log' };
    } catch (error) {
      logger.error(`Ошибка в обработчике GetDiagnostics: ${error.message}`);
      return {};
    }
  });

  // Обработчики локального списка авторизации
  client.handle('GetLocalListVersion', async (payload) => {
    logger.info(`GetLocalListVersion получен: ${JSON.stringify(payload)}`);
    // Реализуйте получение версии локального списка
    const listVersion = 1; // Пример
    return { listVersion };
  });

  client.handle('SendLocalList', async (payload) => {
    logger.info(`SendLocalList получен: ${JSON.stringify(payload)}`);
    const { listVersion, localAuthorizationList, updateType } = payload;

    try {
      // Реализуйте обновление локального списка авторизации
      logger.info(`Локальный список авторизации обновлен до версии ${listVersion}`);
      return { status: 'Accepted' };
    } catch (error) {
      logger.error(`Ошибка в обработчике SendLocalList: ${error.message}`);
      return { status: 'Failed' };
    }
  });


}

module.exports = {
  initializeOCPPClient,
  getClient,
};

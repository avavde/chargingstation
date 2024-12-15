// src/handlers/ocppHandlers.js

const { startTransaction, stopTransaction } = require('../utils/transactionManager');
const {
  sendFirmwareStatusNotification,
  sendDiagnosticsStatusNotification,
  sendStatusNotification,
  sendMeterValues,
} = require('../utils/ocppUtils');
const { addReservation, removeReservation, reservations } = require('../utils/reservationManager');
const logger = require('../utils/logger');
const config = require('../config');
const { dev } = require('../dev');
const { controlRelay } = require('../utils/relayControl');
const { modbusClient } = require('../clients/modbusClient');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');

const configDir = path.join(__dirname, '../../config');
const localAuthListPath = path.join(configDir, 'local_authorization_list.json');

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

if (!fs.existsSync(localAuthListPath)) {
  fs.writeFileSync(localAuthListPath, JSON.stringify({ listVersion: 0, idTagList: [] }, null, 2));
}

let localAuthList = JSON.parse(fs.readFileSync(localAuthListPath, 'utf-8'));

function setupOCPPHandlers(client) {
  // Обработчик Authorize
  client.handle('Authorize', async (payload) => {
    logger.info(`Authorize получен: ${JSON.stringify(payload)}`);
    const { idTag } = payload;

    const isAuthorized = localAuthList.idTagList.some(
      (item) => item.idTag === idTag && item.idTagInfo.status === 'Accepted'
    );

    if (isAuthorized) {
      return { idTagInfo: { status: 'Accepted' } };
    } else {
      return { idTagInfo: { status: 'Invalid' } };
    }
  });

 


  // DataTransfer
  client.handle('DataTransfer', async (payload) => {
    logger.info(`DataTransfer получен: ${JSON.stringify(payload)}`);

    const { vendorId, messageId, data } = payload;
    if (vendorId === 'YourVendorId') {
      if (messageId === 'UpdateSetting') {
        const { key, value } = data;
        config[key] = value;
        fs.writeFileSync(path.join(__dirname, '../../config/ocpp_config.json'), JSON.stringify(config, null, 2));
        logger.info(`Настройка ${key} обновлена на ${value}`);
        return { status: 'Accepted', data: 'Setting updated' };
      }
    }

    return { status: 'Accepted', data: 'Data processed' };
  });

// RemoteStartTransaction
client.handle('RemoteStartTransaction', async (payload) => {
  logger.info(`RemoteStartTransaction получен: ${JSON.stringify(payload)}`);

  try {
    // Сначала определяем, где действительно лежит полезная нагрузка.
    // Иногда сервер отправляет payload.params, иногда сам payload.
    // Далее извлекаем нужные поля.
    const realPayload = payload.params ?? payload; 
    const { idTag, connectorId, chargingProfile } = realPayload;

    if (!idTag) {
      logger.error('idTag отсутствует в запросе RemoteStartTransaction.');
      return { status: 'Rejected' };
    }

    // Преобразуем connectorId к числу, если он пришёл строкой ("1" -> 1).
    // Если connectorId не задан или некорректен, используем 1 по умолчанию.
    let connectorIdToUse = parseInt(connectorId, 10);
    if (isNaN(connectorIdToUse) || connectorIdToUse < 1) {
      connectorIdToUse = 1;
      logger.warn(`Некорректный connectorId (${connectorId}), будет использоваться коннектор 1 по умолчанию.`);
    }

  const connectorExists = config.connectors.some(c => c.id === connectorIdToUse);
if (!connectorExists) {
 logger.error(`Коннектор с ID=${connectorIdToUse} не найден в конфигурации.`);
 return { status: 'Rejected' };
 }

    logger.info(`Инициируем StartTransaction для connectorId=${connectorIdToUse} с idTag=${idTag}${chargingProfile ? `, chargingProfile=${chargingProfile}` : ''}`);

    // Вызываем startTransaction из вашего transactionManager
    const response = await startTransaction(client, connectorIdToUse, idTag, chargingProfile);

    if (response && response.transactionId) {
      logger.info(`StartTransaction успешно: transactionId=${response.transactionId}`);
      return { status: 'Accepted' };
    } else {
      logger.error('StartTransaction не принят сервером.');
      return { status: 'Rejected' };
    }
  } catch (error) {
    logger.error(`Ошибка RemoteStartTransaction: ${error.message}`);
    return { status: 'Rejected' };
  }
});


// RemoteStopTransaction
client.handle('RemoteStopTransaction', async (payload) => {
  logger.info(`RemoteStopTransaction получен: ${JSON.stringify(payload)}`);

  try {
    const realPayload = payload.params ?? payload; 
    let { transactionId } = realPayload;

    if (!transactionId) {
      logger.error('transactionId отсутствует в запросе RemoteStopTransaction.');
      return { status: 'Rejected' };
    }

    // Если в dev.transactionId хранится как число - приводим к числу:
    // (если dev.transactionId тоже строка, то можно оставить без parseInt и сравнивать строку со строкой)
    const transactionIdNum = parseInt(transactionId, 10);
    if (isNaN(transactionIdNum)) {
      logger.error(`Некорректный формат transactionId: ${transactionId}`);
      return { status: 'Rejected' };
    }

    logger.debug(`Поиск транзакции с ID=${transactionIdNum} в dev...`);

    // Поиск активного коннектора
    const activeConnector = Object.entries(dev).find(
      ([, data]) => data.transactionId === transactionIdNum  // сравнение как число
    );

    if (!activeConnector) {
      logger.error(`Транзакция с ID ${transactionIdNum} не найдена среди активных.`);
      logger.debug(`Текущее состояние dev: ${JSON.stringify(dev, null, 2)}`);
      return { status: 'Rejected' };
    }

    const connectorId = parseInt(activeConnector[0].split('_')[1], 10);
    logger.debug(`Найден коннектор: connectorId=${connectorId} для транзакции ${transactionIdNum}`);

    // Используем stopTransaction из transactionManager
    await stopTransaction(client, connectorId);

    logger.info(`Транзакция ${transactionIdNum} успешно завершена.`);
    return { status: 'Accepted' };
  } catch (error) {
    logger.error(`Ошибка RemoteStopTransaction: ${error.message}`);
    return { status: 'Rejected' };
  }
});


 
  client.handle('ChangeAvailability', async (payload) => {
    logger.info(`ChangeAvailability получен: ${JSON.stringify(payload)}`);

    const { connectorId, type } = payload;
    let status = 'Accepted';

    try {
      if (connectorId === 0) {
        for (const connector of config.connectors) {
          const connectorKey = `${config.stationName}_connector${connector.id}`;
          dev[connectorKey].availability = type;
          const newStatus = type === 'Operative' ? 'Available' : 'Unavailable';
          dev[connectorKey].status = newStatus;
          await sendStatusNotification(client, connector.id, newStatus, 'NoError');
        }
      } else {
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

  client.handle('ChangeConfiguration', async (payload) => {
    logger.info(`ChangeConfiguration получен: ${JSON.stringify(payload)}`);
  
    const { key, value } = payload;
    let status = 'Accepted';
  
    const allowedKeys = ['AllowOfflineTxForUnknownId', 'AuthorizationCacheEnabled', 'pricePerKwh', 'connectors'];
    const readOnlyKeys = ['stationName', 'vendor'];
  
    try {
      if (readOnlyKeys.includes(key)) {
        status = 'Rejected';
        logger.error(`Ключ ${key} является только для чтения.`);
      } else if (!allowedKeys.includes(key)) {
        status = 'Rejected';
        logger.error(`Ключ ${key} не поддерживается для изменения.`);
      } else if (key === 'connectors') {
        try {
          const parsedValue = JSON.parse(value);
          if (Array.isArray(parsedValue)) {
            config.connectors = parsedValue; 
            fs.writeFileSync(
              path.join(__dirname, '../../config/ocpp_config.json'),
              JSON.stringify(config, null, 2)
            );
            logger.info(`Ключ ${key} успешно обновлен: ${JSON.stringify(parsedValue)}`);
          } else {
            throw new Error('Значение ключа connectors должно быть массивом объектов.');
          }
        } catch (error) {
          logger.error(`Ошибка при обработке ключа connectors: ${error.message}`);
          status = 'Rejected';
        }
      } else {
        config[key] = value;
        fs.writeFileSync(
          path.join(__dirname, '../../config/ocpp_config.json'),
          JSON.stringify(config, null, 2)
        );
        logger.info(`Параметр ${key} изменен на ${value}.`);
      }
    } catch (error) {
      logger.error(`Ошибка в обработчике ChangeConfiguration: ${error.message}`);
      status = 'Rejected';
    }
  
    return { status };
  });

  client.handle('GetConfiguration', async (payload) => {
    logger.info(`GetConfiguration получен: ${JSON.stringify(payload)}`);

    const { key } = payload;
    const configurationKey = [];
    const unknownKey = [];

    if (!key || key.length === 0) {
      for (const [k, v] of Object.entries(config)) {
        configurationKey.push({
          key: k,
          readonly: false,
          value: k === 'connectors' ? JSON.stringify(v) : v.toString(),
        });
      }
    } else {
      for (const k of key) {
        if (config.hasOwnProperty(k)) {
          configurationKey.push({
            key: k,
            readonly: false,
            value: config[k].toString(),
          });
        } else {
          unknownKey.push(k);
        }
      }
    }

    return { configurationKey, unknownKey };
  });

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

    addReservation(reservationId, {
      connectorId,
      expiryDate: new Date(expiryDate),
      idTag,
      stationName: config.stationName,
    });

    dev[connectorKey].status = 'Reserved';
    await sendStatusNotification(client, connectorId, 'Reserved', 'NoError');

    return { status: 'Accepted' };
  });

  client.handle('CancelReservation', async (payload) => {
    logger.info(`CancelReservation получен: ${JSON.stringify(payload)}`);

    const { reservationId } = payload;

    if (reservations[reservationId]) {
      const connectorId = reservations[reservationId].connectorId;
      removeReservation(reservationId);

      const connectorKey = `${config.stationName}_connector${connectorId}`;
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(client, connectorId, 'Available', 'NoError');

      return { status: 'Accepted' };
    } else {
      logger.error(`Бронирование с ID ${reservationId} не найдено.`);
      return { status: 'Rejected' };
    }
  });

  client.handle('UpdateFirmware', async (payload) => {
    logger.info(`UpdateFirmware получен: ${JSON.stringify(payload)}`);

    const { location, retrieveDate } = payload;
    const now = new Date();
    const startDownloadDate = retrieveDate ? new Date(retrieveDate) : now;

    const downloadFirmware = async () => {
      try {
        await sendFirmwareStatusNotification(client, 'Downloading');
        const firmwarePath = path.join(__dirname, '../firmware/update.zip');
        const file = fs.createWriteStream(firmwarePath);
        const protocol = location.startsWith('https') ? require('https') : require('http');

        protocol
          .get(location, (response) => {
            response.pipe(file);
            file.on('finish', async () => {
              file.close(async () => {
                await sendFirmwareStatusNotification(client, 'Downloaded');
                await sendFirmwareStatusNotification(client, 'Installing');

                try {
                  await extract(firmwarePath, {
                    dir: path.resolve('/'),
                    onEntry: (entry, zipfile) => {
                      if (entry.fileName.includes('config/ocpp_config.json')) {
                        zipfile.ignoreEntry();
                      }
                    },
                  });
                  await sendFirmwareStatusNotification(client, 'Installed');
                  logger.info('Прошивка успешно обновлена.');
                } catch (extractError) {
                  logger.error(`Ошибка распаковки прошивки: ${extractError.message}`);
                  await sendFirmwareStatusNotification(client, 'InstallationFailed');
                }
              });
            });
          })
          .on('error', async (err) => {
            logger.error(`Ошибка загрузки прошивки: ${err.message}`);
            await sendFirmwareStatusNotification(client, 'DownloadFailed');
          });
      } catch (error) {
        logger.error(`Ошибка при обновлении прошивки: ${error.message}`);
        await sendFirmwareStatusNotification(client, 'InstallationFailed');
      }
    };

    const delay = startDownloadDate - now;
    if (delay > 0) {
      setTimeout(downloadFirmware, delay);
    } else {
      downloadFirmware();
    }

    return {};
  });

  client.handle('GetDiagnostics', async (payload) => {
    logger.info(`GetDiagnostics получен: ${JSON.stringify(payload)}`);

    const { location } = payload;
    const diagnosticsFilePath = path.join(__dirname, '../diagnostics/diagnostics.log');

    if (!fs.existsSync(path.dirname(diagnosticsFilePath))) {
      fs.mkdirSync(path.dirname(diagnosticsFilePath), { recursive: true });
    }

    fs.writeFileSync(diagnosticsFilePath, 'Diagnostics information');

    await sendDiagnosticsStatusNotification(client, 'Uploading');

    const uploadDiagnostics = () => {
      const fileStream = fs.createReadStream(diagnosticsFilePath);
      const protocol = location.startsWith('https') ? require('https') : require('http');

      const options = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      };

      const req = protocol.request(location, options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          logger.info('Диагностика успешно загружена.');
          sendDiagnosticsStatusNotification(client, 'Uploaded');
        } else {
          logger.error(`Ошибка загрузки диагностики. Код ответа: ${res.statusCode}`);
          sendDiagnosticsStatusNotification(client, 'UploadFailed');
        }
      });

      req.on('error', (err) => {
        logger.error(`Ошибка загрузки диагностики: ${err.message}`);
        sendDiagnosticsStatusNotification(client, 'UploadFailed');
      });

      fileStream.pipe(req);
    };

    uploadDiagnostics();

    return { fileName: path.basename(diagnosticsFilePath) };
  });

  client.handle('Reset', async (payload) => {
    logger.info(`Reset получен: ${JSON.stringify(payload)}`);

    const { type } = payload;
    let status = 'Accepted';

    setTimeout(async () => {
      logger.info(`Станция перезагружается (${type} reset).`);

      if (type === 'Soft') {
        exec('systemctl restart charge', (error) => {
          if (error) {
            logger.error(`Ошибка при перезапуске сервиса: ${error.message}`);
          } else {
            logger.info('Сервис успешно перезапущен.');
          }
        });
      } else if (type === 'Hard') {
        exec('systemctl reboot', (error) => {
          if (error) {
            logger.error(`Ошибка при перезагрузке контроллера: ${error.message}`);
          } else {
            logger.info('Контроллер успешно перезагружен.');
          }
        });
      }
    }, 1000);

    return { status };
  });

  client.handle('UnlockConnector', async (payload) => {
    logger.info(`UnlockConnector получен: ${JSON.stringify(payload)}`);

    const { connectorId } = payload;
    const connector = config.connectors.find((c) => c.id === connectorId);

    if (!connector) {
      logger.error(`Разъем с ID ${connectorId} не найден.`);
      return { status: 'UnlockFailed' };
    }

    logger.info(`Коннектор ${connectorId} успешно разблокирован.`);

    return { status: 'Unlocked' };
  });

  client.handle('ClearCache', async (payload) => {
    logger.info(`ClearCache получен: ${JSON.stringify(payload)}`);

    localAuthList = { listVersion: 0, idTagList: [] };
    fs.writeFileSync(localAuthListPath, JSON.stringify(localAuthList, null, 2));

    logger.info('Локальный кэш авторизации успешно очищен.');

    return { status: 'Accepted' };
  });

  client.handle('TriggerMessage', async (payload) => {
    logger.info(`TriggerMessage получен: ${JSON.stringify(payload)}`);
  
    const { requestedMessage, connectorId } = payload;
    let status = 'Accepted';
  
    switch (requestedMessage) {
      case 'BootNotification':
        await client.call('BootNotification', {
          chargePointVendor: config.vendor,
          chargePointModel: config.model,
          chargePointSerialNumber: config.stationName,
          firmwareVersion: '1.0',
          meterSerialNumber: 'Unknown'
        });
        break;
  
      case 'StatusNotification':
        // При желании подтягиваем текущий статус из dev
        const connectorKey = `${config.stationName}_connector${connectorId}`;
        const currentStatus = dev[connectorKey]?.status || 'Unavailable';
        await sendStatusNotification(client, connectorId, currentStatus, 'NoError');
        break;
  
      case 'MeterValues':
        await sendMeterValues(client, connectorId, /* transactionId */, /* energy */, /* power */);
        break;
  
      case 'DiagnosticsStatusNotification':
        // Допустим, шлём 'Idle' или 'Uploading' по желанию
        await sendDiagnosticsStatusNotification(client, 'Idle');
        break;
  
      case 'FirmwareStatusNotification':
        // Допустим, шлём 'Idle' или 'Downloading' или 'Installed'
        await sendFirmwareStatusNotification(client, 'Idle');
        break;
  
      default:
        status = 'NotImplemented';
        logger.warn(`Запрошенное сообщение ${requestedMessage} не поддерживается.`);
        break;
    }
  
    return { status };
  });
  

  client.handle('SetChargingProfile', async (payload) => {
    logger.info(`SetChargingProfile получен: ${JSON.stringify(payload)}`);

    const { connectorId, csChargingProfiles } = payload;
    let status = 'Accepted';

    logger.info(`Профиль зарядки для коннектора ${connectorId} успешно применен.`);

    return { status };
  });

  client.handle('GetCompositeSchedule', async (payload) => {
    logger.info(`GetCompositeSchedule получен: ${JSON.stringify(payload)}`);

    return { status: 'Rejected' };
  });

  client.handle('SendLocalList', async (payload) => {
    logger.info(`SendLocalList получен: ${JSON.stringify(payload)}`);

    const { listVersion, localAuthorizationList, updateType } = payload;

    if (updateType === 'Full') {
      localAuthList.idTagList = localAuthorizationList || [];
    } else if (updateType === 'Differential') {
      localAuthorizationList.forEach((item) => {
        const index = localAuthList.idTagList.findIndex((i) => i.idTag === item.idTag);
        if (index !== -1) {
          localAuthList.idTagList[index] = item;
        } else {
          localAuthList.idTagList.push(item);
        }
      });
    }

    localAuthList.listVersion = listVersion;
    fs.writeFileSync(localAuthListPath, JSON.stringify(localAuthList, null, 2));
    logger.info('Локальный список авторизации успешно обновлен.');

    return { status: 'Accepted' };
  });

  client.handle('GetLocalListVersion', async (payload) => {
    logger.info(`GetLocalListVersion получен: ${JSON.stringify(payload)}`);
    return { listVersion: localAuthList.listVersion };
  });
}

module.exports = {
  setupOCPPHandlers,
};

// src/handlers/ocppHandlers.js

const { client } = require('../clients/ocppClient');
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
const dev = require('../dev');
const { controlRelay } = require('../utils/relayControl');
const { modbusClient } = require('../clients/modbusClient');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip'); // Пакет для распаковки ZIP-архивов

const configDir = path.join(__dirname, '../../config');
const localAuthListPath = path.join(configDir, 'local_authorization_list.json');

// Убедимся, что директория существует
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Проверяем наличие файла локального списка авторизации, если нет - создаем
if (!fs.existsSync(localAuthListPath)) {
  fs.writeFileSync(localAuthListPath, JSON.stringify({ listVersion: 0, idTagList: [] }, null, 2));
}

let localAuthList = JSON.parse(fs.readFileSync(localAuthListPath, 'utf-8'));

function setupOCPPHandlers() {
  // Обработчик Authorize
  client.handle('Authorize', async (payload) => {
    logger.info(`Authorize получен: ${JSON.stringify(payload)}`);
    const { idTag } = payload;

    // Проверяем наличие idTag в локальном списке авторизации
    const isAuthorized = localAuthList.idTagList.some(
      (item) => item.idTag === idTag && item.idTagInfo.status === 'Accepted'
    );

    if (isAuthorized) {
      return { idTagInfo: { status: 'Accepted' } };
    } else {
      return { idTagInfo: { status: 'Invalid' } };
    }
  });

  // Обработчик StartTransaction
  client.handle('StartTransaction', async (payload) => {
    logger.info(`StartTransaction получен: ${JSON.stringify(payload)}`);
    // Здесь мы можем обработать сообщение StartTransaction, если это необходимо
    // Обычно станция сама инициирует StartTransaction
    return {};
  });

  // Обработчик StopTransaction
  client.handle('StopTransaction', async (payload) => {
    logger.info(`StopTransaction получен: ${JSON.stringify(payload)}`);
    // Здесь мы можем обработать сообщение StopTransaction, если это необходимо
    // Обычно станция сама инициирует StopTransaction
    return {};
  });

  // Обработчик DataTransfer
  client.handle('DataTransfer', async (payload) => {
    logger.info(`DataTransfer получен: ${JSON.stringify(payload)}`);

    const { vendorId, messageId, data } = payload;

    // заготовкаобработки пользовательских данных
    if (vendorId === 'YourVendorId') {
      if (messageId === 'UpdateSetting') {
        // Обновление настройки
        const { key, value } = data;
        config[key] = value;
        // Сохраняем обновленную конфигурацию
        fs.writeFileSync(path.join(__dirname, '../config/ocpp_config.json'), JSON.stringify(config, null, 2));
        logger.info(`Настройка ${key} обновлена на ${value}`);
        return { status: 'Accepted', data: 'Setting updated' };
      }
    }

    return { status: 'Accepted', data: 'Data processed' };
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
  
      await startTransaction(connectorId, idTag);
  
      return { status: 'Accepted' };
    } catch (error) {
      logger.error(`Ошибка в обработчике RemoteStartTransaction: ${error.stack || error}`);
      return { status: 'Rejected' };
    }
  });
  

  // Обработчик RemoteStopTransaction
  client.handle('RemoteStopTransaction', async (payload) => {
    logger.info(`RemoteStopTransaction получен: ${JSON.stringify(payload)}`);

    const { transactionId } = payload;
    const connector = config.connectors.find(
      (c) => dev[`${config.stationName}_connector${c.id}`].transactionId === transactionId
    );

    if (!connector) {
      logger.error(`Транзакция с ID ${transactionId} не найдена.`);
      return { status: 'Rejected' };
    }

    await stopTransaction(connector.id);

    return { status: 'Accepted' };
  });

  // Обработчик ChangeAvailability
  client.handle('ChangeAvailability', async (payload) => {
    logger.info(`ChangeAvailability получен: ${JSON.stringify(payload)}`);

    const { connectorId, type } = payload; // type может быть 'Inoperative' или 'Operative'
    let status = 'Accepted';

    if (connectorId === 0) {
      // Изменение доступности всей станции
      for (const connector of config.connectors) {
        const connectorKey = `${config.stationName}_connector${connector.id}`;
        dev[connectorKey].availability = type;
        // Обновляем статус коннектора
        const newStatus = type === 'Operative' ? 'Available' : 'Unavailable';
        dev[connectorKey].status = newStatus;
        // Отправляем StatusNotification
        await sendStatusNotification(connector.id, newStatus, 'NoError');
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
        // Обновляем статус коннектора
        const newStatus = type === 'Operative' ? 'Available' : 'Unavailable';
        dev[connectorKey].status = newStatus;
        // Отправляем StatusNotification
        await sendStatusNotification(connectorId, newStatus, 'NoError');
      }
    }

    return { status };
  });

  // Обработчик ChangeConfiguration
  client.handle('ChangeConfiguration', async (payload) => {
    logger.info(`ChangeConfiguration получен: ${JSON.stringify(payload)}`);

    const { key, value } = payload;
    let status = 'Accepted';

    // Проверяем, что ключ существует и не является только для чтения
    const allowedKeys = ['AllowOfflineTxForUnknownId', 'AuthorizationCacheEnabled', 'pricePerKwh'];
    const readOnlyKeys = ['stationName', 'vendor'];

    if (!allowedKeys.includes(key)) {
      status = 'Rejected';
      logger.error(`Ключ ${key} не поддерживается для изменения.`);
    } else if (readOnlyKeys.includes(key)) {
      status = 'Rejected';
      logger.error(`Ключ ${key} является только для чтения.`);
    } else {
      // Обновляем конфигурацию
      config[key] = value;
      // Сохраняем конфигурацию в файл
      fs.writeFileSync(path.join(__dirname, '../config/ocpp_config.json'), JSON.stringify(config, null, 2));
      logger.info(`Параметр ${key} изменен на ${value}.`);
    }

    return { status };
  });

  // Обработчик GetConfiguration
  client.handle('GetConfiguration', async (payload) => {
    logger.info(`GetConfiguration получен: ${JSON.stringify(payload)}`);

    const { key } = payload;
    const configurationKey = [];
    const unknownKey = [];

    // Если ключи не указаны, возвращаем все возможные настройки
    if (!key || key.length === 0) {
      // Добавляем все настройки
      for (const [k, v] of Object.entries(config)) {
        configurationKey.push({
          key: k,
          readonly: false,
          value: v.toString(),
        });
      }
    } else {
      // Возвращаем только запрошенные ключи
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

  // Обработчик ReserveNow
  client.handle('ReserveNow', async (payload) => {
    logger.info(`ReserveNow получен: ${JSON.stringify(payload)}`);

    const { connectorId, expiryDate, idTag, reservationId } = payload;
    const connector = config.connectors.find((c) => c.id === connectorId);

    if (!connector) {
      logger.error(`Разъем с ID ${connectorId} не найден.`);
      return { status: 'Rejected' };
    }

    const connectorKey = `${config.stationName}_connector${connectorId}`;

    // Проверяем, доступен ли разъем
    if (dev[connectorKey].status !== 'Available') {
      logger.error(`Разъем ${connectorId} недоступен для бронирования.`);
      return { status: 'Occupied' };
    }

    // Создаем бронирование
    addReservation(reservationId, {
      connectorId,
      expiryDate: new Date(expiryDate),
      idTag,
      stationName: config.stationName,
    });

    // Обновляем статус разъема
    dev[connectorKey].status = 'Reserved';
    await sendStatusNotification(connectorId, 'Reserved', 'NoError');

    return { status: 'Accepted' };
  });

  // Обработчик CancelReservation
  client.handle('CancelReservation', async (payload) => {
    logger.info(`CancelReservation получен: ${JSON.stringify(payload)}`);

    const { reservationId } = payload;

    const reservation = reservations[reservationId];
    if (reservation) {
      const connectorId = reservation.connectorId;
      removeReservation(reservationId);

      const connectorKey = `${config.stationName}_connector${connectorId}`;
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(connectorId, 'Available', 'NoError');

      return { status: 'Accepted' };
    } else {
      logger.error(`Бронирование с ID ${reservationId} не найдено.`);
      return { status: 'Rejected' };
    }
  });

  // Обработчик UpdateFirmware
  client.handle('UpdateFirmware', async (payload) => {
    logger.info(`UpdateFirmware получен: ${JSON.stringify(payload)}`);

    const { location, retrieveDate } = payload;

    // Проверяем дату начала загрузки
    const now = new Date();
    const startDownloadDate = retrieveDate ? new Date(retrieveDate) : now;

    const downloadFirmware = async () => {
      try {
        // Отправляем FirmwareStatusNotification со статусом 'Downloading'
        await sendFirmwareStatusNotification('Downloading');

        // Загрузка файла прошивки
        const firmwarePath = path.join(__dirname, '../firmware/update.zip');
        const file = fs.createWriteStream(firmwarePath);
        const protocol = location.startsWith('https') ? require('https') : require('http');

        protocol
          .get(location, (response) => {
            response.pipe(file);
            file.on('finish', async () => {
              file.close(async () => {
                // Отправляем FirmwareStatusNotification со статусом 'Downloaded'
                await sendFirmwareStatusNotification('Downloaded');

                // Распаковка прошивки
                await sendFirmwareStatusNotification('Installing');
                try {
                  // Распаковываем архив в корневой каталог, исключая config/ocpp_config.json
                  await extract(firmwarePath, {
                    dir: path.resolve('/'), // Корневой каталог
                    onEntry: (entry, zipfile) => {
                      if (entry.fileName.includes('config/ocpp_config.json')) {
                        // Пропускаем файл конфигурации
                        zipfile.ignoreEntry();
                      }
                    },
                  });
                  await sendFirmwareStatusNotification('Installed');
                  logger.info('Прошивка успешно обновлена.');
                } catch (extractError) {
                  logger.error(`Ошибка распаковки прошивки: ${extractError.message}`);
                  await sendFirmwareStatusNotification('InstallationFailed');
                }
              });
            });
          })
          .on('error', async (err) => {
            logger.error(`Ошибка загрузки прошивки: ${err.message}`);
            await sendFirmwareStatusNotification('DownloadFailed');
          });
      } catch (error) {
        logger.error(`Ошибка при обновлении прошивки: ${error.message}`);
        await sendFirmwareStatusNotification('InstallationFailed');
      }
    };

    // Планируем загрузку прошивки в указанное время
    const delay = startDownloadDate - now;
    if (delay > 0) {
      setTimeout(downloadFirmware, delay);
    } else {
      downloadFirmware();
    }

    return {};
  });

  // Обработчик GetDiagnostics
  client.handle('GetDiagnostics', async (payload) => {
    logger.info(`GetDiagnostics получен: ${JSON.stringify(payload)}`);

    const { location } = payload;

    // Собираем диагностическую информацию
    const diagnosticsFilePath = path.join(__dirname, '../diagnostics/diagnostics.log');

    // Убедимся, что директория существует
    if (!fs.existsSync(path.dirname(diagnosticsFilePath))) {
      fs.mkdirSync(path.dirname(diagnosticsFilePath), { recursive: true });
    }

    // Записываем диагностическую информацию
    fs.writeFileSync(diagnosticsFilePath, 'Diagnostics information');

    // Отправляем DiagnosticsStatusNotification со статусом 'Uploading'
    await sendDiagnosticsStatusNotification('Uploading');

    // Загружаем файл на указанный сервер
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
          sendDiagnosticsStatusNotification('Uploaded');
        } else {
          logger.error(`Ошибка загрузки диагностики. Код ответа: ${res.statusCode}`);
          sendDiagnosticsStatusNotification('UploadFailed');
        }
      });

      req.on('error', (err) => {
        logger.error(`Ошибка загрузки диагностики: ${err.message}`);
        sendDiagnosticsStatusNotification('UploadFailed');
      });

      fileStream.pipe(req);
    };

    // Запускаем загрузку диагностики
    uploadDiagnostics();

    // Возвращаем имя файла диагностики
    return { fileName: path.basename(diagnosticsFilePath) };
  });

  // Обработчик Reset
  client.handle('Reset', async (payload) => {
    logger.info(`Reset получен: ${JSON.stringify(payload)}`);

    const { type } = payload; // 'Soft' или 'Hard'
    let status = 'Accepted';

    // Выполняем Reset после проверки
    setTimeout(async () => {
      // Отправляем сообщение об успешной перезагрузке
      logger.info(`Станция перезагружается (${type} reset).`);

      if (type === 'Soft') {
        // Перезапускаем сервис
        exec('systemctl restart charge', (error, stdout, stderr) => {
          if (error) {
            logger.error(`Ошибка при перезапуске сервиса: ${error.message}`);
          } else {
            logger.info('Сервис успешно перезапущен.');
          }
        });
      } else if (type === 'Hard') {
        // Перезагружаем контроллер
        exec('systemctl reboot', (error, stdout, stderr) => {
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

  // Обработчик UnlockConnector
  client.handle('UnlockConnector', async (payload) => {
    logger.info(`UnlockConnector получен: ${JSON.stringify(payload)}`);

    const { connectorId } = payload;
    const connector = config.connectors.find((c) => c.id === connectorId);

    if (!connector) {
      logger.error(`Разъем с ID ${connectorId} не найден.`);
      return { status: 'UnlockFailed' };
    }

    // Здесь мы можем реализовать логику разблокировки коннектора
    // Например, отправить команду на разблокировку механизма

    logger.info(`Коннектор ${connectorId} успешно разблокирован.`);

    return { status: 'Unlocked' };
  });

  // Обработчик ClearCache
  client.handle('ClearCache', async (payload) => {
    logger.info(`ClearCache получен: ${JSON.stringify(payload)}`);

    // Очищаем локальный кэш авторизации
    localAuthList = { listVersion: 0, idTagList: [] };
    fs.writeFileSync(localAuthListPath, JSON.stringify(localAuthList, null, 2));

    logger.info('Локальный кэш авторизации успешно очищен.');

    return { status: 'Accepted' };
  });

  // Обработчик TriggerMessage
  client.handle('TriggerMessage', async (payload) => {
    logger.info(`TriggerMessage получен: ${JSON.stringify(payload)}`);

    const { requestedMessage, connectorId } = payload;
    let status = 'Accepted';

    // Обрабатываем запрошенное сообщение
    switch (requestedMessage) {
      case 'BootNotification':
        await client.call('BootNotification', {
          chargePointVendor: config.vendor,
          chargePointModel: config.model,
          chargePointSerialNumber: config.stationName,
          firmwareVersion: '1.0',
          meterSerialNumber: 'Unknown',
        });
        break;
      case 'StatusNotification':
        const connectorKey = `${config.stationName}_connector${connectorId}`;
        const connStatus = dev[connectorKey]?.status || 'Unavailable';
        await sendStatusNotification(connectorId, connStatus, 'NoError');
        break;
      case 'MeterValues':
        await sendMeterValues(connectorId);
        break;
      default:
        status = 'NotImplemented';
        logger.warn(`Запрошенное сообщение ${requestedMessage} не поддерживается.`);
        break;
    }

    return { status };
  });

  // Обработчик SetChargingProfile
  client.handle('SetChargingProfile', async (payload) => {
    logger.info(`SetChargingProfile получен: ${JSON.stringify(payload)}`);

    const { connectorId, csChargingProfiles } = payload;
    let status = 'Accepted';

    // Здесь мы можем реализовать применение профиля зарядки
    // Например, изменить настройки зарядки на основании профиля

    logger.info(`Профиль зарядки для коннектора ${connectorId} успешно применен.`);

    return { status };
  });

  // Обработчик GetCompositeSchedule
  client.handle('GetCompositeSchedule', async (payload) => {
    logger.info(`GetCompositeSchedule получен: ${JSON.stringify(payload)}`);

    const { connectorId, duration, chargingRateUnit } = payload;

    // Здесь мы можем реализовать предоставление расписания зарядки
    // Для простоты, мы возвращаем статус Rejected

    return { status: 'Rejected' };
  });

  // Обработчик SendLocalList
  client.handle('SendLocalList', async (payload) => {
    logger.info(`SendLocalList получен: ${JSON.stringify(payload)}`);

    const { listVersion, localAuthorizationList, updateType } = payload;

    // Обновляем локальный список авторизации
    if (updateType === 'Full') {
      localAuthList.idTagList = localAuthorizationList || [];
    } else if (updateType === 'Differential') {
      // Применяем изменения
      localAuthorizationList.forEach((item) => {
        const index = localAuthList.idTagList.findIndex((i) => i.idTag === item.idTag);
        if (index !== -1) {
          localAuthList.idTagList[index] = item;
        } else {
          localAuthList.idTagList.push(item);
        }
      });
    }

    // Обновляем версию списка
    localAuthList.listVersion = listVersion;

    // Сохраняем локальный список авторизации
    fs.writeFileSync(localAuthListPath, JSON.stringify(localAuthList, null, 2));

    logger.info('Локальный список авторизации успешно обновлен.');

    return { status: 'Accepted' };
  });

  // Обработчик GetLocalListVersion
  client.handle('GetLocalListVersion', async (payload) => {
    logger.info(`GetLocalListVersion получен: ${JSON.stringify(payload)}`);

    // Возвращаем текущую версию локального списка
    return { listVersion: localAuthList.listVersion };
  });
}

module.exports = {
  setupOCPPHandlers,
};

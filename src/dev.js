const fs = require('fs');
const path = require('path');
const config = require('../config/ocpp_config.json'); // Подключаем конфигурацию

const dataDir = path.join(__dirname, '../data');
const devFilePath = path.join(dataDir, 'dev_state.json');

// Создание директории для данных, если она отсутствует
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Создание файла состояния dev, если он отсутствует
function ensureDevFile() {
  if (!fs.existsSync(devFilePath)) {
    try {
      fs.writeFileSync(devFilePath, '{}');
      console.log('Файл состояния dev успешно создан.');
    } catch (error) {
      console.error(`Ошибка создания файла состояния dev: ${error.message}`);
    }
  }
}

ensureDevFile();

// Функция для сохранения состояния dev в JSON файл
function saveDevToFile(dev) {
  try {
    fs.writeFileSync(devFilePath, JSON.stringify(dev, null, 2));
  } catch (error) {
    console.error(`Ошибка сохранения состояния dev: ${error.message}`);
  }
}

// Функция для загрузки состояния dev из JSON файла
function loadDevFromFile() {
  try {
    const data = fs.readFileSync(devFilePath, 'utf-8');
    const parsedData = JSON.parse(data);
    if (typeof parsedData === 'object') {
      return parsedData;
    }
  } catch (error) {
    console.error(`Ошибка загрузки состояния dev: ${error.message}`);
  }
  return {};
}

// Инициализация состояния dev
const dev = {};
const savedState = loadDevFromFile();

if (Object.keys(savedState).length > 0) {
  console.log('Состояние dev загружено из файла.');
  Object.assign(dev, savedState);
} else {
  console.log('Инициализация состояния dev на основе конфигурации.');
  config.connectors.forEach((connector) => {
    const connectorKey = `${config.stationName}_connector${connector.id}`;
    dev[connectorKey] = {
      status: 'Available',
      availability: 'Operative',
      transactionId: null,
      idTag: null,
      Energy: 0,
      Power: 0,
      Summ: 0,
      meterSerialNumber: null,
    };
  });
  saveDevToFile(dev);
}

// Обновление состояния dev с автоматическим сохранением
function updateDevState(key, updates) {
  if (!dev[key]) {
    console.warn(`Ключ ${key} отсутствует в dev.`);
    return;
  }
  Object.assign(dev[key], updates);
  saveDevToFile(dev);
}

module.exports = {
  dev,
  updateDevState,
  saveDevToFile,
};

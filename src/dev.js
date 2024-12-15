const fs = require('fs');
const path = require('path');
const config = require('../config/ocpp_config.json'); // Подключаем конфигурацию

const devFilePath = path.join(__dirname, '../data/dev_state.json'); // Путь для сохранения состояния

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
    if (fs.existsSync(devFilePath)) {
      const data = fs.readFileSync(devFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Ошибка загрузки состояния dev: ${error.message}`);
  }
  return null; // Возвращаем null если файл отсутствует или произошла ошибка
}

// Инициализация состояния dev
const dev = {};

// Загружаем состояние из файла, если доступно
const savedState = loadDevFromFile();

if (savedState) {
  console.log('Состояние dev загружено из файла.');
  Object.assign(dev, savedState);
} else {
  console.log('Инициализация состояния dev на основе конфигурации.');
  config.connectors.forEach((connector) => {
    const connectorKey = `${config.stationName}_connector${connector.id}`;
    dev[connectorKey] = {
      status: 'Available',           // Текущий статус коннектора (Available, Occupied, Charging, etc.)
      availability: 'Operative',     // Доступность коннектора (Operative или Inoperative)
      transactionId: null,           // ID текущей транзакции (если есть)
      idTag: null,                   // ID тега пользователя (если транзакция активна)
      Energy: 0,                     // Потребленная энергия (в kWh)
      Power: 0,                      // Текущая мощность (в kW)
      Summ: 0,                       // Сумма к оплате
      meterSerialNumber: null,       // Серийный номер счетчика
    };
  });
  saveDevToFile(dev); // Сохраняем начальное состояние
}

// Обновление состояния dev с автоматическим сохранением
function updateDevState(key, updates) {
  if (!dev[key]) {
    console.warn(`Ключ ${key} отсутствует в dev.`);
    return;
  }
  Object.assign(dev[key], updates); // Обновляем состояние
  saveDevToFile(dev); // Сохраняем новое состояние
}

module.exports = {
  dev,
  updateDevState,
  saveDevToFile,
};

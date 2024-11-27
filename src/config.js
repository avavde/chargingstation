const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const configPath = path.join(__dirname, '../config/ocpp_config.json');

let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  // Здесь можно добавить валидацию конфигурации
  module.exports = config;
} catch (error) {
  logger.error(`Ошибка при загрузке конфигурации: ${error.message}`);
  process.exit(1);
}

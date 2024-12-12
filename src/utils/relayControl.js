const fs = require('fs');
const logger = require('./logger');

function controlRelay(path, state) {
  try {
    if (!fs.existsSync(path)) {
      logger.error(`Файл реле ${path} не существует.`);
      return;
    }
    fs.writeFileSync(path, state ? '1' : '0');
    logger.info(`Реле ${path} установлено в состояние: ${state ? 'включено' : 'выключено'}`);
  } catch (error) {
    logger.error(`Ошибка управления реле ${path}: ${error.message}`);
  }
}

module.exports = {
  controlRelay,
};

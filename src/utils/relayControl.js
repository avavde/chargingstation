const fs = require('fs');
const logger = require('./logger');

function controlRelay(path, state) {
  try {
    fs.writeFileSync(path, state ? '1' : '0');
    logger.info(`Реле ${path} установлено в состояние ${state ? 'включено' : 'выключено'}`);
  } catch (error) {
    logger.error(`Ошибка управления реле ${path}: ${error.message}`);
  }
}

module.exports = {
  controlRelay,
};

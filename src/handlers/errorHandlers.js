const logger = require('../utils/logger');

function setupErrorHandlers() {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Необработанный отказ в промисе: ${reason.stack || reason}`);
    // Здесь можно добавить дополнительную логику для обработки ошибок
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Необработанное исключение: ${err.stack || err}`);
    // Предотвращаем остановку приложения
    // Можно уведомить соответствующие службы или перезапустить некоторые модули
  });

  // Обработка предупреждений
  process.on('warning', (warning) => {
    logger.warn(`Предупреждение процесса: ${warning.name} - ${warning.message}`);
  });

  // Обработка сигналов завершения
  process.on('SIGINT', () => {
    logger.info('Получен сигнал SIGINT. Остановка приложения.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Получен сигнал SIGTERM. Остановка приложения.');
    process.exit(0);
  });
}

module.exports = {
  setupErrorHandlers,
};

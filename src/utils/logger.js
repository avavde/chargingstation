const { createLogger, format, transports } = require('winston');
const path = require('path');

// Определяем формат логов
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
});

// Создаем логгер
const logger = createLogger({
  level: 'info', // Уровень логирования (info, error, warn, debug)
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Добавляем время
    logFormat
  ),
  transports: [
    new transports.Console(), // Вывод в консоль
    new transports.File({ filename: path.join(__dirname, '../logs/logfile.log') }) // Запись в файл
  ],
});

// Добавляем метод для логирования ошибок
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

// Экспортируем логгер
module.exports = logger;

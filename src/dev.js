
const config = require('./config'); // Подключаем конфигурацию

// Объект для хранения состояния коннекторов
const dev = {};

// Инициализируем состояние каждого коннектора на основе конфигурации
config.connectors.forEach((connector) => {
  const connectorKey = `${config.stationName}_connector${connector.id}`;
  dev[connectorKey] = {
    status: 'Available',           // Текущий статус коннектора (Available, Occupied, Charging, etc.)
    availability: 'Operative',     // Доступность коннектора (Operative или Inoperative)
    transactionId: null,           // ID текущей транзакции (если есть)
    idTag: null,                   // ID тега пользователя (если транзакция активна)
    Kwt: 0,                        // Показания энергии в кВт·ч
    Current: 0,                    // Текущий ток в Амперах
    Summ: 0,                       // Сумма к оплате
    meterSerialNumber: null,       // Серийный номер счетчика
  };
});

module.exports = dev;

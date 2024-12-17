Основные обработчики OCPP (Core OCPP Handlers)

Это основные обработчики для сообщений OCPP, которыми обмениваются зарядная станция и центральная система.

BootNotification

Функция: client.call("BootNotification", payload)
Описание: Отправляет BootNotification в центральную систему при включении или перезагрузке зарядной станции. Включает информацию о станции, такую как производитель, модель, версия прошивки и серийные номера.

Heartbeat

Функция: client.call("Heartbeat", {})
Описание: Периодически отправляет сообщения Heartbeat, чтобы информировать центральную систему о том, что зарядная станция все еще подключена.

Authorize

Обработчик: client.handle("Authorize", wrapHandler(async (payload)  => { ... })
Описание: Проверяет RFID-карту или другую идентификацию для авторизации пользователя на зарядку.

StartTransaction

Функция: client.call("StartTransaction", payload)
Описание: Инициализируется при начале сессии зарядки, предоставляя детали, такие как ID коннектора, начальное значение счетчика и временную метку.

StopTransaction

Функция: client.call("StopTransaction", payload)
Описание: Инициализируется при окончании сессии зарядки, предоставляя детали, такие как ID транзакции, конечное значение счетчика и временную метку.

StatusNotification

Функция: client.call("StatusNotification", payload)
Описание: Отправляет обновления в центральную систему о статусе коннекторов (например, Available, Occupied, Faulted).

MeterValues

Функция: client.call("MeterValues", payload)
Описание: Отправляет показания счетчиков в центральную систему, либо периодически, либо при определенных событиях.

DataTransfer

Обработчик: client.handle("DataTransfer", wrapHandler(async (payload)  => { ... })
Описание: Позволяет обмениваться пользовательскими данными между зарядной станцией и центральной системой.
Обработчики удаленного управления (Remote Control Handlers)

Эти обработчики обрабатывают команды, отправленные из центральной системы для удаленного управления зарядной станцией.

RemoteStartTransaction

Обработчик: client.handle("RemoteStartTransaction", wrapHandler(async (payload)  => { ... })
Описание: Инициирует сессию зарядки удаленно.

RemoteStopTransaction

Обработчик: client.handle("RemoteStopTransaction", wrapHandler(async (payload)  => { ... })
Описание: Останавливает текущую сессию зарядки удаленно.

ChangeAvailability

Обработчик: client.handle("ChangeAvailability", wrapHandler(async (payload)  => { ... })
Описание: Изменяет операционный статус зарядной станции или конкретного коннектора (например, на Inoperative или Operative).

ChangeConfiguration

Обработчик: client.handle("ChangeConfiguration", wrapHandler(async (payload)  => { ... })
Описание: Изменяет параметры конфигурации зарядной станции.
GetConfiguration

Обработчик: client.handle("GetConfiguration", wrapHandler(async (payload)  => { ... })
Описание: Получает параметры конфигурации от зарядной станции.

UnlockConnector

Обработчик: client.handle("UnlockConnector", wrapHandler(async (payload)  => { ... })
Описание: Разблокирует коннектор, обычно используется, когда кабель застрял.

Reset

Обработчик: client.handle("Reset", wrapHandler(async (payload)  => { ... })
Описание: Перезагружает зарядную станцию (либо Soft, либо Hard reset).
Обработчики бронирования (Reservation Handlers)

Обработчики, связанные с функционалом бронирования.

ReserveNow

Обработчик: client.handle("ReserveNow", wrapHandler(async (payload)  => { ... })
Описание: Бронирование коннектора для конкретного пользователя и времени.

CancelReservation

Обработчик: client.handle("CancelReservation", wrapHandler(async (payload)  => { ... })
Описание: Отменяет существующее бронирование.
Обработчики диагностики и управления прошивкой (Diagnostics and Firmware Management Handlers)

Обработчики для управления диагностикой и обновлениями прошивки.

GetDiagnostics

Обработчик: client.handle("GetDiagnostics", wrapHandler(async (payload)  => { ... })
Описание: Запрашивает у зарядной станции загрузить диагностическую информацию.

DiagnosticsStatusNotification

Функция: client.call("DiagnosticsStatusNotification", payload)
Описание: Отправляет обновления статуса загрузки диагностики в центральную систему.

UpdateFirmware

Обработчик: client.handle("UpdateFirmware", wrapHandler(async (payload)  => { ... })
Описание: Инициирует процесс обновления прошивки.
FirmwareStatusNotification

Функция: client.call("FirmwareStatusNotification", payload)
Описание: Отправляет обновления статуса процесса обновления прошивки.
Обработчики безопасности и аутентификации (Security and Authentication Handlers)

GetLocalListVersion

Обработчик: client.handle("GetLocalListVersion", wrapHandler(async (payload)  => { ... })
Описание: Получает номер версии локального списка авторизации.

SendLocalList

Обработчик: client.handle("SendLocalList", wrapHandler(async (payload)  => { ... })
Описание: Обновляет локальный список авторизации.
Вспомогательные функции (Auxiliary Functions)

Функции управления оборудованием, подключенным непосредственно к контроллеру

controlRelay

Функция: controlRelay(path, state)
Описание: Управляет физическим реле для начала или остановки зарядки.

readMeterSerialNumber

Функция: readMeterSerialNumber(connector)
Описание: Читает серийный номер с счетчика через Modbus.

getModemInfo

Функция: getModemInfo()
Описание: Получает информацию ICCID и IMSI от модема.

startTransaction

Функция: startTransaction(connectorId, idTag)
Описание: Подготавливает и инициирует транзакцию зарядки.

stopTransaction

Функция: stopTransaction(connectorId)
Описание: Останавливает текущую транзакцию зарядки.
sendFirmwareStatusNotification

Функция: sendFirmwareStatusNotification(status)
Описание: Отправляет уведомления о статусе обновления прошивки.

sendDiagnosticsStatusNotification

Функция: sendDiagnosticsStatusNotification(status)
Описание: Отправляет уведомления о статусе загрузки диагностики.

updateModbusData

Функция: updateModbusData()
Описание: Непрерывно считывает данные с устройств Modbus и обновляет внутреннее состояние.
sendInitialStatusNotifications

Функция: sendInitialStatusNotifications()
Описание: Отправляет начальные уведомления о статусе для всех коннекторов после загрузки.

sendHeartbeat

Функция: sendHeartbeat()
Описание: Отправляет периодические сообщения Heartbeat в центральную систему.
Утилитные функции (Utility Functions)

Обработчики process.on

Обработчики: process.on("unhandledRejection", ...) и process.on("uncaughtException", ...)
Описание: Глобальные обработчики ошибок для перехвата и логирования необработанных исключений и отклонений.

Функции логирования

Использование: console.log(), console.error()
Описание: Используются по всему коду для логирования сообщений и ошибок для отладки и мониторинга.

setInterval и setTimeout

Использование: Для периодических задач, таких как sendHeartbeat() и проверка истечения бронирований.
Описание: Управляет временем повторяющихся функций.
Периодические задачи и проверки (Periodic Tasks and Checks)

Проверка истечения бронирований

Функциональность: Периодически проверяет, истекли ли какие-либо бронирования, и обновляет статус коннектора соответственно.
Реализация: Функция setInterval, которая выполняется каждую минуту.
Автоматический запуск/остановка транзакции

Функциональность: Автоматически запускает или останавливает транзакции на основе статуса подключения автомобиля, обнаруженного через данные Modbus.
Реализация: Внутри updateModbusData(), проверяет показания тока для обнаружения подключения автомобиля.
Обработка данных Modbus (Modbus Data Handling)

Инициализация Modbus-клиента

Функция: modbusClient.connectRTUBuffered(...)
Описание: Устанавливает соединение с устройствами Modbus.
Чтение данных Modbus

Функция: modbusClient.readHoldingRegisters(...)
Описание: Считывает данные энергии и тока из регистров Modbus.
Обработка ошибок для Modbus

Реализация: Блоки try-catch вокруг операций Modbus для обработки ошибок связи.
Обработчики событий для OCPP-клиента (Event Handlers for OCPP Client)

client.on("open")

Описание: Обрабатывает событие, когда соединение с центральной системой установлено.
client.on("close")

Описание: Обрабатывает событие, когда соединение с центральной системой закрыто.
client.on("error")

Описание: Обрабатывает ошибки, возникающие у OCPP-клиента.
client.on("message")

Описание: Логирует все сообщения, отправленные и полученные OCPP-клиентом.
Дополнительные обработчики OCPP (Comprehensive OCPP Handlers)

Для полной реализации OCPP 1.6, в качестве развития системы, добавить обработчики для следующих сообщений:

ClearCache

Обработчик: client.handle("ClearCache", wrapHandler(async (payload)  => { ... })
Описание: Очищает локальный кэш авторизации.

GetCompositeSchedule

Обработчик: client.handle("GetCompositeSchedule", wrapHandler(async (payload)  => { ... })
Описание: Предоставляет графики зарядки на основе запрошенных параметров.

SetChargingProfile

Обработчик: client.handle("SetChargingProfile", wrapHandler(async (payload)  => { ... })
Описание: Устанавливает профиль зарядки для коннектора для контроля скоростей зарядки.

TriggerMessage

Обработчик: client.handle("TriggerMessage", wrapHandler(async (payload)  => { ... })
Описание: Запрашивает у зарядной станции отправить определенный тип сообщения в центральную систему.

DiagnosticsStatusNotification

Должен быть реализован, если используются диагностики.

Дополнительные соображения

Обработка ошибок

Реализация соответствующих кодов ошибок и сообщений при отклонении запросов или возникновении ошибок.

Структура кода

Импорты и начальная настройка
Загрузка конфигурации
Глобальные переменные и объекты состояния
Настройка Modbus-клиента
Настройка OCPP-клиента
Обработчики событий для OCPP-клиента
Основные функции (например, controlRelay, readMeterSerialNumber)
Обработчики сообщений OCPP (например, RemoteStartTransaction, ReserveNow)
Вспомогательные функции (например, sendHeartbeat, updateModbusData)
Периодические задачи и интервалы
Запуск основного потока исполнения
Заключительные заметки (Final Notes)

Дополнения

Обработка сообщений TriggerMessage:

Реализация обработчика TriggerMessage позволит центральной системе запрашивать у станции отправку определенных сообщений, таких как StatusNotification или MeterValues.

Обработчик SetChargingProfile:

Этот обработчик позволит центральной системе устанавливать профили зарядки, что может быть полезно для управления нагрузкой и оптимизации использования энергии.

Поддержка безопасности и TLS:

Если требуется, рассмотрите внедрение TLS для шифрования связи между станцией и центральной системой. Это может потребовать дополнительных настроек и сертификатов.

Управление локальным списком авторизации:

Реализация функций для работы с локальным списком (GetLocalListVersion, SendLocalList) позволит станции работать автономно в случае потери связи с центральной системой, используя локально сохраненные данные для авторизации.

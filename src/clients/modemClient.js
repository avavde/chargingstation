const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const config = require('../config');
const logger = require('../utils/logger');

async function getModemInfo() {
  return new Promise((resolve) => {
    const port = new SerialPort({ path: config.modemPort, baudRate: 115200 });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    let iccid = null;
    let imsi = null;

    parser.on('data', (line) => {
      line = line.trim();
      if (line.includes('CCID')) {
        iccid = line.split(':')[1].trim();
      }
      if (/^\d{15}$/.test(line)) {
        imsi = line;
      }
      if (iccid && imsi) {
        port.close();
        resolve({ iccid, imsi });
      }
    });

    port.on('open', () => {
      port.write('AT+CCID\r');
      setTimeout(() => {
        port.write('AT+CIMI\r');
      }, 500);
    });

    port.on('error', (err) => {
      logger.error(`Ошибка чтения данных модема: ${err.message}`);
      resolve({ iccid: null, imsi: null });
    });
  });
}

module.exports = {
  getModemInfo,
};

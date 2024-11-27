const dev = require('../dev');
const { sendStatusNotification } = require('./ocppUtils');
const logger = require('./logger');

const reservations = {};

function addReservation(reservationId, reservation) {
  reservations[reservationId] = reservation;
}

function removeReservation(reservationId) {
  delete reservations[reservationId];
}

async function checkReservations() {
  const now = new Date();
  for (const reservationId in reservations) {
    const reservation = reservations[reservationId];
    if (now > reservation.expiryDate) {
      logger.info(`Бронирование ${reservationId} истекло.`);
      const connectorKey = `${reservation.stationName}_connector${reservation.connectorId}`;
      dev[connectorKey].status = 'Available';
      await sendStatusNotification(reservation.connectorId, 'Available', 'NoError');
      removeReservation(reservationId);
    }
  }
}

module.exports = {
  addReservation,
  removeReservation,
  checkReservations,
};
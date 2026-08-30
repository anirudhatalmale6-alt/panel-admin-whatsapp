'use strict';

const { EventEmitter } = require('events');

// Bus internal aplikasi. messageService memancarkan event ke sini,
// server.js meneruskannya ke browser lewat Socket.IO.
// Dipisah supaya tidak ada ketergantungan melingkar antar-modul.
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;

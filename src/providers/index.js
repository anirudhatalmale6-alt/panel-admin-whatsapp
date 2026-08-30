'use strict';

const config = require('../config');

let instance = null;

/** Buat penyedia sesuai WA_PROVIDER di .env. Satu instance untuk seluruh aplikasi. */
function getProvider() {
  if (instance) return instance;

  switch (config.provider) {
    case 'baileys':
      instance = new (require('./baileys'))();
      break;
    case 'cloud':
    case 'cloudapi':
      instance = new (require('./cloud'))();
      break;
    case 'mock':
    default:
      instance = new (require('./mock'))();
      break;
  }
  return instance;
}

module.exports = { getProvider };

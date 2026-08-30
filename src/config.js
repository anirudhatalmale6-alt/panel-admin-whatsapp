'use strict';

require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),

  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtTtlHours: Number(process.env.JWT_TTL_HOURS || 24 * 7),

  // mock | baileys | cloud
  provider: (process.env.WA_PROVIDER || 'mock').toLowerCase(),

  baileys: {
    sessionDir: process.env.BAILEYS_SESSION_DIR || './data/baileys-session',
    markOnlineOnConnect: bool(process.env.BAILEYS_MARK_ONLINE, false),
  },

  cloud: {
    token: process.env.WA_CLOUD_TOKEN || '',
    phoneNumberId: process.env.WA_CLOUD_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WA_CLOUD_VERIFY_TOKEN || 'verify-me',
    apiVersion: process.env.WA_CLOUD_API_VERSION || 'v21.0',
  },

  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta',
};

module.exports = config;

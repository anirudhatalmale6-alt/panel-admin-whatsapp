'use strict';

// Webhook WhatsApp Cloud API. Rute ini TIDAK dilindungi login — Meta yang
// memanggilnya. Keamanannya dari verify token saat pendaftaran, dan dari
// mengabaikan payload yang tidak berbentuk seperti payload WhatsApp.

const express = require('express');
const { getProvider } = require('../providers');

const router = express.Router();

router.get('/whatsapp', (req, res) => {
  const provider = getProvider();
  if (typeof provider.verifyWebhook !== 'function') return res.sendStatus(404);

  const result = provider.verifyWebhook(req.query);
  if (result.ok) return res.status(200).send(result.challenge);
  return res.sendStatus(403);
});

router.post('/whatsapp', (req, res) => {
  // Selalu balas 200 secepatnya. Kalau lambat atau error, Meta akan
  // mengirim ulang payload yang sama berkali-kali.
  res.sendStatus(200);

  const provider = getProvider();
  if (typeof provider.handleWebhook !== 'function') return;
  if (req.body?.object !== 'whatsapp_business_account') return;

  try {
    provider.handleWebhook(req.body);
  } catch (err) {
    console.error('[webhook]', err.message);
  }
});

module.exports = router;

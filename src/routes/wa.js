'use strict';

const express = require('express');
const { getProvider } = require('../providers');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

/** Status koneksi + QR (kalau sedang menunggu scan). */
router.get('/status', (req, res) => {
  res.json(getProvider().getStatus());
});

router.post('/restart', requireAdmin, async (req, res) => {
  const provider = getProvider();
  await provider.stop();
  await provider.start();
  res.json(provider.getStatus());
});

/** Hapus sesi WhatsApp (Baileys) supaya bisa scan QR dengan nomor lain. */
router.post('/logout', requireAdmin, async (req, res) => {
  const provider = getProvider();
  await provider.logout();
  res.json(provider.getStatus());
});

/**
 * Hanya untuk mode simulasi: pura-pura ada pesan masuk dari pelanggan.
 * Dipakai untuk demo dan uji aturan tanpa nomor WhatsApp sungguhan.
 */
router.post('/simulate', async (req, res) => {
  const provider = getProvider();
  if (typeof provider.simulateIncoming !== 'function') {
    return res.status(400).json({ error: 'Simulasi hanya tersedia saat WA_PROVIDER=mock' });
  }
  const phone = String(req.body?.phone || '628123456789');
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Isi teks pesannya dulu' });

  // pushName sengaja tidak diberi nilai default: kalau tidak diisi, nama
  // kontak yang sudah ada tidak ikut tertimpa.
  const out = provider.simulateIncoming(phone, text, req.body?.pushName || null);
  res.json({ ok: true, ...out });
});

module.exports = router;

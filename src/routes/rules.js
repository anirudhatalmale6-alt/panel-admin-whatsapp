'use strict';

const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { dryRun } = require('../services/autoResponder');
const { parseHHMM, parseDays } = require('../lib/time');

const router = express.Router();
router.use(requireAuth);

const MATCH_TYPES = ['CONTAINS', 'EXACT', 'STARTS_WITH', 'REGEX', 'FIRST_MESSAGE', 'FALLBACK'];

/** Validasi + normalisasi isian form aturan. Melempar Error kalau tidak valid. */
function cleanRuleInput(body, { partial = false } = {}) {
  const data = {};
  const has = (k) => body[k] !== undefined;

  if (has('name') || !partial) {
    const name = String(body.name || '').trim();
    if (!name) throw new Error('Nama aturan wajib diisi');
    data.name = name;
  }

  if (has('matchType') || !partial) {
    const matchType = String(body.matchType || 'CONTAINS').toUpperCase();
    if (!MATCH_TYPES.includes(matchType)) throw new Error(`Tipe pemicu tidak dikenal: ${matchType}`);
    data.matchType = matchType;
  }

  if (has('keywords') || !partial) data.keywords = String(body.keywords || '').trim();

  if (has('replyText') || !partial) {
    const replyText = String(body.replyText || '').trim();
    if (!replyText) throw new Error('Teks balasan wajib diisi');
    if (replyText.length > 4096) throw new Error('Teks balasan maksimal 4096 karakter');
    data.replyText = replyText;
  }

  // Aturan yang butuh kata kunci harus punya kata kunci — kalau tidak,
  // aturan itu tidak akan pernah cocok dan klien akan bingung kenapa diam.
  const effectiveType = data.matchType || body.matchType;
  if (['CONTAINS', 'EXACT', 'STARTS_WITH', 'REGEX'].includes(effectiveType)) {
    const kw = data.keywords !== undefined ? data.keywords : body.keywords;
    if (partial === false && !String(kw || '').trim()) {
      throw new Error('Kata kunci wajib diisi untuk tipe pemicu ini');
    }
    if (effectiveType === 'REGEX' && kw) {
      try { new RegExp(String(kw)); } catch { throw new Error('Pola regex tidak valid'); }
    }
  }

  if (has('enabled')) data.enabled = Boolean(body.enabled);
  if (has('caseSensitive')) data.caseSensitive = Boolean(body.caseSensitive);
  if (has('priority')) data.priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100;
  if (has('cooldownSeconds')) data.cooldownSeconds = Math.max(0, Number(body.cooldownSeconds) || 0);
  if (has('maxPerContact')) data.maxPerContact = Math.max(0, Number(body.maxPerContact) || 0);
  if (has('timezone')) data.timezone = String(body.timezone || 'Asia/Jakarta');

  if (has('days')) {
    const days = Array.isArray(body.days) ? body.days : parseDays(body.days);
    if (!days.length) throw new Error('Pilih minimal satu hari');
    data.days = days.join(',');
  }

  for (const field of ['startTime', 'endTime']) {
    if (!has(field)) continue;
    const value = body[field];
    if (value === null || value === '') { data[field] = null; continue; }
    if (parseHHMM(value) === null) throw new Error(`Format jam salah pada ${field}, pakai HH:MM`);
    data[field] = value;
  }

  // jam mulai diisi tapi jam selesai tidak (atau sebaliknya) = jadwal setengah jadi
  const start = data.startTime !== undefined ? data.startTime : body.startTime;
  const end = data.endTime !== undefined ? data.endTime : body.endTime;
  if ((start && !end) || (!start && end)) {
    throw new Error('Isi jam mulai dan jam selesai dua-duanya, atau kosongkan dua-duanya untuk 24 jam');
  }

  return data;
}

router.get('/', async (req, res) => {
  const rules = await prisma.autoRule.findMany({ orderBy: [{ priority: 'asc' }, { id: 'asc' }] });
  res.json({ rules });
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const data = cleanRuleInput(req.body || {});
    const rule = await prisma.autoRule.create({ data });
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const data = cleanRuleInput(req.body || {}, { partial: true });
    const rule = await prisma.autoRule.update({ where: { id: Number(req.params.id) }, data });
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await prisma.autoRule.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

/** Tombol "Tes" di panel: lihat aturan mana yang akan menang, tanpa mengirim pesan. */
router.post('/test', async (req, res) => {
  const result = await dryRun(String(req.body?.text || ''), {
    isFirstMessage: Boolean(req.body?.isFirstMessage),
  });
  res.json(result);
});

module.exports = router;

'use strict';

const express = require('express');
const { getSettings, setSettings, prisma } = require('../db');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { parseHHMM, parseDays } = require('../lib/time');

const router = express.Router();
router.use(requireAuth);

const ALLOWED = [
  'bot_enabled', 'business_days', 'business_start', 'business_end', 'timezone',
  'outside_hours_enabled', 'outside_hours_text', 'outside_hours_cooldown',
];

router.get('/', async (req, res) => {
  res.json({ settings: await getSettings() });
});

router.put('/', requireAdmin, async (req, res) => {
  const patch = {};
  for (const key of ALLOWED) {
    if (req.body[key] === undefined) continue;
    let value = req.body[key];
    if (typeof value === 'boolean') value = value ? 'true' : 'false';
    if (key === 'business_days') {
      const days = Array.isArray(value) ? value : parseDays(value);
      if (!days.length) return res.status(400).json({ error: 'Pilih minimal satu hari kerja' });
      value = days.join(',');
    }
    if ((key === 'business_start' || key === 'business_end') && parseHHMM(value) === null) {
      return res.status(400).json({ error: `Format jam salah pada ${key}, pakai HH:MM` });
    }
    patch[key] = value;
  }
  res.json({ settings: await setSettings(patch) });
});

/** Angka ringkas untuk kartu statistik di dashboard. */
router.get('/stats', async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [contacts, unread, inToday, autoToday, failed, activeRules] = await Promise.all([
    prisma.contact.count(),
    prisma.contact.count({ where: { unreadCount: { gt: 0 } } }),
    prisma.message.count({ where: { direction: 'IN', timestamp: { gte: startOfDay } } }),
    prisma.message.count({ where: { isAuto: true, timestamp: { gte: startOfDay } } }),
    prisma.message.count({ where: { status: 'failed', timestamp: { gte: startOfDay } } }),
    prisma.autoRule.count({ where: { enabled: true } }),
  ]);

  res.json({ contacts, unread, inToday, autoToday, failed, activeRules });
});

module.exports = router;

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

// --- pengaturan global (tabel Setting) -------------------------------------

const DEFAULT_SETTINGS = {
  bot_enabled: 'true', // saklar utama auto-response
  business_days: '1,2,3,4,5', // 1=Senin ... 7=Minggu
  business_start: '08:00',
  business_end: '17:00',
  timezone: 'Asia/Jakarta',
  outside_hours_enabled: 'true',
  outside_hours_text:
    'Terima kasih sudah menghubungi kami. Saat ini di luar jam operasional (Sen-Jum 08:00-17:00 WIB). Pesan Anda sudah kami terima dan akan dibalas oleh tim kami pada jam kerja berikutnya.',
  outside_hours_cooldown: '3600', // detik
};

async function getSettings() {
  const rows = await prisma.setting.findMany();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

async function setSetting(key, value) {
  return prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

async function setSettings(obj) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    await setSetting(key, value);
  }
  return getSettings();
}

module.exports = { prisma, getSettings, setSetting, setSettings, DEFAULT_SETTINGS };

'use strict';

const express = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n');
  // BOM supaya Excel di Windows membaca huruf beraksen dengan benar
  return `﻿${head}\n${body}\n`;
}

/** Ekspor pesan ke CSV. Filter opsional: ?from=2026-01-01&to=2026-02-01&contactId=3 */
router.get('/messages.csv', async (req, res) => {
  const where = {};
  if (req.query.contactId) where.contactId = Number(req.query.contactId);
  if (req.query.from || req.query.to) {
    where.timestamp = {};
    if (req.query.from) where.timestamp.gte = new Date(req.query.from);
    if (req.query.to) where.timestamp.lte = new Date(req.query.to);
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { timestamp: 'asc' },
    include: { contact: true, sentBy: { select: { name: true } } },
    take: 50000,
  });

  const rows = messages.map((m) => ({
    id: m.id,
    waktu: m.timestamp,
    nomor: m.contact.waId,
    nama: m.contact.name || m.contact.pushName || '',
    arah: m.direction === 'IN' ? 'masuk' : 'keluar',
    tipe: m.type,
    isi: m.body,
    status: m.status,
    otomatis: m.isAuto ? 'ya' : 'tidak',
    aturan_id: m.ruleId || '',
    dikirim_oleh: m.sentBy?.name || (m.isAuto ? 'bot' : ''),
    error: m.errorText || '',
  }));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pesan.csv"');
  res.send(toCsv(rows, [
    'id', 'waktu', 'nomor', 'nama', 'arah', 'tipe', 'isi', 'status', 'otomatis', 'aturan_id', 'dikirim_oleh', 'error',
  ]));
});

router.get('/contacts.csv', async (req, res) => {
  const contacts = await prisma.contact.findMany({ orderBy: { id: 'asc' } });
  const rows = contacts.map((c) => ({
    id: c.id,
    nomor: c.waId,
    nama: c.name || '',
    nama_wa: c.pushName || '',
    bot_aktif: c.botEnabled ? 'ya' : 'tidak',
    belum_dibaca: c.unreadCount,
    pesan_terakhir: c.lastMessageAt,
    pertama_kontak: c.firstSeenAt,
    catatan: c.notes || '',
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kontak.csv"');
  res.send(toCsv(rows, [
    'id', 'nomor', 'nama', 'nama_wa', 'bot_aktif', 'belum_dibaca', 'pesan_terakhir', 'pertama_kontak', 'catatan',
  ]));
});

/** Backup semua aturan auto-response sebagai JSON (bisa di-import lagi). */
router.get('/rules.json', async (req, res) => {
  const rules = await prisma.autoRule.findMany({ orderBy: { priority: 'asc' } });
  res.setHeader('Content-Disposition', 'attachment; filename="auto-response.json"');
  res.json({ exportedAt: new Date(), rules });
});

module.exports = router;

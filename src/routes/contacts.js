'use strict';

const express = require('express');
const { prisma } = require('../db');
const bus = require('../lib/bus');
const messageService = require('../services/messageService');
const { normalizeWaId } = require('../providers/base');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

/** Daftar percakapan untuk panel kiri. */
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = q
    ? {
        OR: [
          { name: { contains: q } },
          { pushName: { contains: q } },
          { waId: { contains: q.replace(/\D/g, '') || q } },
        ],
      }
    : {};

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: Number(req.query.limit || 200),
    include: {
      messages: { orderBy: { timestamp: 'desc' }, take: 1 },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  res.json({
    contacts: contacts.map((c) => ({
      id: c.id,
      waId: c.waId,
      name: c.name,
      pushName: c.pushName,
      displayName: c.name || c.pushName || `+${c.waId}`,
      botEnabled: c.botEnabled,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      assignedTo: c.assignedTo,
      lastMessage: c.messages[0]
        ? { body: c.messages[0].body, direction: c.messages[0].direction, isAuto: c.messages[0].isAuto }
        : null,
    })),
  });
});

/** Riwayat pesan satu kontak. */
router.get('/:id/messages', async (req, res) => {
  const contactId = Number(req.params.id);
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
  if (!contact) return res.status(404).json({ error: 'Kontak tidak ditemukan' });

  const messages = await prisma.message.findMany({
    where: { contactId },
    orderBy: { timestamp: 'asc' },
    take: Number(req.query.limit || 500),
    include: { sentBy: { select: { id: true, name: true } } },
  });

  res.json({ contact, messages });
});

/** Kirim pesan manual dari admin. */
router.post('/:id/messages', async (req, res) => {
  const contactId = Number(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });

  try {
    const saved = await messageService.sendText({ contactId, text, userId: req.user.id });
    res.json({ message: saved });
  } catch (err) {
    // pesan tetap tersimpan dengan status "failed" — kirim balik supaya UI menandainya
    res.status(502).json({ error: err.message, message: err.savedMessage || null });
  }
});

/** Mulai percakapan baru ke nomor yang diketik admin. */
router.post('/', async (req, res) => {
  const waId = normalizeWaId(req.body?.phone);
  if (!waId || waId.length < 8) return res.status(400).json({ error: 'Nomor tidak valid' });

  const contact = await messageService.getOrCreateContact({ waId, pushName: req.body?.name || null });
  if (req.body?.name) {
    await prisma.contact.update({ where: { id: contact.id }, data: { name: req.body.name } });
  }
  res.json({ contact: await prisma.contact.findUnique({ where: { id: contact.id } }) });
});

/** Ubah kontak: nama, catatan, saklar bot per chat, agen yang ditugaskan. */
router.patch('/:id', async (req, res) => {
  const contactId = Number(req.params.id);
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name || null;
  if (req.body.notes !== undefined) data.notes = req.body.notes || null;
  if (req.body.botEnabled !== undefined) data.botEnabled = Boolean(req.body.botEnabled);
  if (req.body.assignedToId !== undefined) {
    data.assignedToId = req.body.assignedToId ? Number(req.body.assignedToId) : null;
  }

  const contact = await prisma.contact.update({ where: { id: contactId }, data });
  bus.emit('contact:update', contact);
  res.json({ contact });
});

/** Tandai percakapan sudah dibaca. */
router.post('/:id/read', async (req, res) => {
  const contact = await messageService.markRead(Number(req.params.id));
  res.json({ contact });
});

module.exports = router;

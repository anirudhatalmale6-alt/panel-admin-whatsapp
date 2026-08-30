'use strict';

const { prisma } = require('../db');
const bus = require('../lib/bus');
const { normalizeWaId } = require('../providers/base');
const autoResponder = require('./autoResponder');

let provider = null;

/** Pasang penyedia WhatsApp dan sambungkan event-nya ke aplikasi. */
function attachProvider(p) {
  provider = p;
  provider.on('message', (msg) => {
    handleIncoming(msg).catch((err) => console.error('[incoming]', err.message));
  });
  provider.on('ack', (ack) => {
    handleAck(ack).catch((err) => console.error('[ack]', err.message));
  });
  provider.on('status', (status) => bus.emit('wa:status', status));
}

async function getOrCreateContact({ waId, pushName }) {
  const id = normalizeWaId(waId);
  const existing = await prisma.contact.findUnique({ where: { waId: id } });
  if (existing) {
    if (pushName && existing.pushName !== pushName) {
      return prisma.contact.update({ where: { id: existing.id }, data: { pushName } });
    }
    return existing;
  }
  const created = await prisma.contact.create({
    data: { waId: id, phone: `+${id}`, pushName: pushName || null },
  });
  bus.emit('contact:new', created);
  return created;
}

// --- pesan masuk ------------------------------------------------------------

async function handleIncoming({ waId, pushName, text, type, waMessageId, timestamp }) {
  const contact = await getOrCreateContact({ waId, pushName });

  const previousInbound = await prisma.message.count({
    where: { contactId: contact.id, direction: 'IN' },
  });
  const isFirstMessage = previousInbound === 0;

  const saved = await prisma.message.create({
    data: {
      contactId: contact.id,
      waMessageId: waMessageId || null,
      direction: 'IN',
      type: type || 'text',
      body: text || '',
      status: 'received',
      timestamp: timestamp || new Date(),
    },
  });

  const updatedContact = await prisma.contact.update({
    where: { id: contact.id },
    data: { lastMessageAt: saved.timestamp, unreadCount: { increment: 1 } },
  });

  bus.emit('message:new', { message: saved, contact: updatedContact });

  // --- auto-response ---
  try {
    const decision = await autoResponder.decideReply({
      contact: updatedContact,
      text: text || '',
      isFirstMessage,
    });
    if (decision) {
      await autoResponder.recordHit(decision, updatedContact.id);
      await sendText({
        contactId: updatedContact.id,
        text: decision.text,
        isAuto: true,
        ruleId: decision.rule?.id || null,
      });
    }
  } catch (err) {
    console.error('[auto-response]', err.message);
  }

  return saved;
}

// --- pesan keluar -----------------------------------------------------------

/**
 * Kirim pesan teks ke sebuah kontak dan simpan ke database.
 * Baris database selalu dibuat — kalau pengiriman gagal, statusnya "failed"
 * dan alasannya tersimpan, jadi admin tidak pernah mengira pesan terkirim
 * padahal tidak.
 */
async function sendText({ contactId, waId, text, isAuto = false, ruleId = null, userId = null }) {
  let contact = null;
  if (contactId) {
    contact = await prisma.contact.findUnique({ where: { id: contactId } });
  } else if (waId) {
    contact = await getOrCreateContact({ waId });
  }
  if (!contact) throw new Error('Kontak tidak ditemukan');

  const body = String(text || '').trim();
  if (!body) throw new Error('Pesan kosong');

  let waMessageId = null;
  let status = 'sent';
  let errorText = null;

  try {
    if (!provider) throw new Error('Penyedia WhatsApp belum siap');
    const res = await provider.sendText(contact.waId, body);
    waMessageId = res?.waMessageId || null;
  } catch (err) {
    status = 'failed';
    errorText = err.message;
  }

  const saved = await prisma.message.create({
    data: {
      contactId: contact.id,
      waMessageId,
      direction: 'OUT',
      type: 'text',
      body,
      status,
      errorText,
      isAuto,
      ruleId,
      sentById: userId,
      timestamp: new Date(),
    },
    // ikut sertakan nama pengirim, supaya baris "dikirim oleh X" langsung
    // muncul di layar tanpa perlu memuat ulang percakapan
    include: { sentBy: { select: { id: true, name: true } } },
  });

  const updatedContact = await prisma.contact.update({
    where: { id: contact.id },
    data: { lastMessageAt: saved.timestamp },
  });

  bus.emit('message:new', { message: saved, contact: updatedContact });

  if (status === 'failed') {
    const err = new Error(errorText);
    err.savedMessage = saved;
    throw err;
  }
  return saved;
}

async function handleAck({ waMessageId, status, errorText }) {
  if (!waMessageId) return;
  const msg = await prisma.message.findFirst({ where: { waMessageId } });
  if (!msg) return;

  // jangan turunkan status: read > delivered > sent
  const RANK = { failed: -1, sent: 1, delivered: 2, read: 3, received: 1 };
  if ((RANK[status] ?? 0) <= (RANK[msg.status] ?? 0) && status !== 'failed') return;

  const updated = await prisma.message.update({
    where: { id: msg.id },
    data: { status, errorText: errorText || msg.errorText },
    // sentBy harus ikut: panel mengganti pesan di layar dengan objek ini,
    // kalau tidak disertakan nama pengirimnya hilang begitu status berubah
    include: { sentBy: { select: { id: true, name: true } } },
  });
  bus.emit('message:update', updated);
}

async function markRead(contactId) {
  const updated = await prisma.contact.update({
    where: { id: contactId },
    data: { unreadCount: 0 },
  });
  bus.emit('contact:update', updated);
  return updated;
}

module.exports = { attachProvider, handleIncoming, handleAck, sendText, markRead, getOrCreateContact };

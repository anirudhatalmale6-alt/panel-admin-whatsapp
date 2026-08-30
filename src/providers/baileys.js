'use strict';

const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  Browsers,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { BaseProvider, normalizeWaId } = require('./base');
const config = require('../config');

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

/**
 * Penyedia Baileys — menyambung ke WhatsApp lewat protokol WhatsApp Web
 * (nomor pribadi / WA Business biasa, login dengan scan QR).
 *
 * Catatan penting yang perlu klien tahu:
 *  - ini bukan API resmi Meta. Aman untuk membalas chat pelanggan, tapi
 *    jangan dipakai untuk blast massal — itu yang bikin nomor kena banned.
 *  - sesi login disimpan di folder BAILEYS_SESSION_DIR. Backup folder ini
 *    supaya tidak perlu scan QR ulang setiap kali server di-restart.
 */
class BaileysProvider extends BaseProvider {
  constructor() {
    super('baileys');
    this.sock = null;
    this.sessionDir = path.resolve(process.cwd(), config.baileys.sessionDir);
    this.stopped = false;
    this.reconnectAttempts = 0;
  }

  async start() {
    this.stopped = false;
    fs.mkdirSync(this.sessionDir, { recursive: true });
    await this.connect();
  }

  async connect() {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      browser: Browsers.appropriate('Panel Admin'),
      markOnlineOnConnect: config.baileys.markOnlineOnConnect,
      syncFullHistory: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u));
    this.sock.ev.on('messages.upsert', (u) => this.onMessages(u));
    this.sock.ev.on('messages.update', (updates) => this.onMessageUpdates(updates));
  }

  async onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      this.emitStatus({
        connected: false,
        qr: dataUrl,
        note: 'Buka WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat, lalu scan QR ini.',
      });
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0;
      const jid = this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
      this.emitStatus({
        connected: true,
        qr: null,
        me: { id: jid ? jid.split('@')[0] : null, name: this.sock?.user?.name || null },
        note: 'Tersambung ke WhatsApp.',
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      this.emitStatus({
        connected: false,
        me: null,
        note: loggedOut
          ? 'Sesi keluar dari WhatsApp. Hapus sesi lalu scan QR lagi.'
          : `Koneksi terputus (${statusCode || 'tidak diketahui'}), mencoba menyambung ulang...`,
      });

      if (loggedOut) {
        // kredensial sudah tidak berlaku — buang supaya QR baru bisa muncul
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      if (!this.stopped) {
        this.reconnectAttempts += 1;
        const delay = Math.min(30000, 2000 * this.reconnectAttempts);
        setTimeout(() => { if (!this.stopped) this.connect().catch(() => {}); }, delay);
      }
    }
  }

  onMessages({ messages, type }) {
    if (type !== 'notify') return; // abaikan sinkronisasi riwayat lama
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || '';
      if (!jid.endsWith('@s.whatsapp.net')) continue; // lewati grup, status, broadcast
      if (msg.key?.fromMe) continue;

      const text = extractText(msg);
      const type = detectType(msg);
      if (!text && type === 'text') continue;

      this.emit('message', {
        waId: normalizeWaId(jid),
        pushName: msg.pushName || null,
        text,
        type,
        waMessageId: msg.key.id,
        timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date(),
        fromMe: false,
      });
    }
  }

  onMessageUpdates(updates) {
    const MAP = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
    for (const u of updates) {
      const status = MAP[u.update?.status];
      if (status && u.key?.id) this.emit('ack', { waMessageId: u.key.id, status });
    }
  }

  async sendText(waId, text) {
    if (!this.sock || !this.connected) throw new Error('WhatsApp belum tersambung');
    const jid = `${normalizeWaId(waId)}@s.whatsapp.net`;
    const sent = await this.sock.sendMessage(jid, { text });
    return { waMessageId: sent?.key?.id || null };
  }

  async stop() {
    this.stopped = true;
    try { this.sock?.end(undefined); } catch { /* sudah tertutup */ }
    this.emitStatus({ connected: false, note: 'Dihentikan.' });
  }

  async logout() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* mungkin sudah putus */ }
    fs.rmSync(this.sessionDir, { recursive: true, force: true });
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.emitStatus({ connected: false, me: null, qr: null, note: 'Sesi dihapus. Mulai ulang untuk scan QR baru.' });
    this.stopped = false;
    setTimeout(() => this.connect().catch(() => {}), 1000);
  }
}

function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

function detectType(msg) {
  const m = msg.message || {};
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.locationMessage) return 'location';
  return 'text';
}

module.exports = BaileysProvider;

'use strict';

const { EventEmitter } = require('events');

/**
 * Kontrak yang sama untuk semua penyedia WhatsApp (mock / Baileys / Cloud API).
 * Sisa aplikasi hanya bicara ke antarmuka ini, jadi ganti penyedia = ganti
 * satu baris WA_PROVIDER di .env, tanpa menyentuh kode panel.
 *
 * Event yang dipancarkan:
 *   'message' -> { waId, pushName, text, type, waMessageId, timestamp, fromMe }
 *   'status'  -> { connected, qr, me, note }
 *   'ack'     -> { waMessageId, status }  status: sent|delivered|read|failed
 */
class BaseProvider extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.connected = false;
    this.qr = null;
    this.me = null;
    this.note = '';
  }

  async start() { throw new Error('start() belum diimplementasikan'); }
  async stop() {}
  async logout() { await this.stop(); }

  // eslint-disable-next-line no-unused-vars
  async sendText(waId, text) { throw new Error('sendText() belum diimplementasikan'); }

  getStatus() {
    return {
      provider: this.name,
      connected: this.connected,
      qr: this.qr,
      me: this.me,
      note: this.note,
    };
  }

  emitStatus(patch = {}) {
    Object.assign(this, patch);
    this.emit('status', this.getStatus());
  }
}

/** Bersihkan nomor menjadi format WhatsApp: hanya angka, 0 di depan -> 62. */
function normalizeWaId(input, countryCode = '62') {
  let digits = String(input || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = countryCode + digits.slice(1);
  return digits;
}

module.exports = { BaseProvider, normalizeWaId };

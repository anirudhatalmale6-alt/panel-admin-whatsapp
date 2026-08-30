'use strict';

const { BaseProvider, normalizeWaId } = require('./base');

/**
 * Penyedia simulasi. Tidak menyentuh WhatsApp sama sekali.
 *
 * Gunanya:
 *  - demo dan uji coba aturan auto-response tanpa perlu nomor WhatsApp
 *  - menjalankan tes otomatis di CI
 * Di panel akan muncul kotak "Simulasi pesan masuk" untuk mengetik pesan
 * seolah-olah datang dari pelanggan.
 */
class MockProvider extends BaseProvider {
  constructor() {
    super('mock');
    this.counter = 0;
    this.outbox = []; // semua pesan yang "terkirim", berguna untuk tes
  }

  async start() {
    this.emitStatus({
      connected: true,
      qr: null,
      me: { id: '628000000000', name: 'Nomor Simulasi' },
      note: 'Mode simulasi — tidak terhubung ke WhatsApp asli. Ganti WA_PROVIDER di .env untuk memakai nomor sungguhan.',
    });
  }

  async stop() {
    this.emitStatus({ connected: false });
  }

  async sendText(waId, text) {
    const id = `mock-out-${++this.counter}`;
    const entry = { waMessageId: id, waId: normalizeWaId(waId), text, at: new Date() };
    this.outbox.push(entry);
    // tiru status pengiriman WhatsApp
    setTimeout(() => this.emit('ack', { waMessageId: id, status: 'delivered' }), 200);
    return { waMessageId: id };
  }

  /** Dipanggil dari panel: pura-pura ada pesan masuk dari pelanggan. */
  simulateIncoming(waId, text, pushName = null) {
    const id = `mock-in-${++this.counter}`;
    this.emit('message', {
      waId: normalizeWaId(waId),
      pushName,
      text,
      type: 'text',
      waMessageId: id,
      timestamp: new Date(),
      fromMe: false,
    });
    return { waMessageId: id };
  }
}

module.exports = MockProvider;

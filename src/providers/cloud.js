'use strict';

const { BaseProvider, normalizeWaId } = require('./base');
const config = require('../config');

/**
 * Penyedia WhatsApp Cloud API (resmi Meta).
 *
 * Yang perlu disiapkan di Meta Business:
 *   WA_CLOUD_TOKEN           - permanent access token dari System User
 *   WA_CLOUD_PHONE_NUMBER_ID - Phone Number ID (bukan nomor teleponnya)
 *   WA_CLOUD_VERIFY_TOKEN    - teks bebas, harus sama dengan yang diisi di
 *                              kolom "Verify token" saat mendaftarkan webhook
 *
 * URL webhook yang didaftarkan di Meta:
 *   https://domain-anda.com/webhook/whatsapp
 *
 * Aturan Meta: di luar jendela 24 jam sejak pesan terakhir pelanggan, hanya
 * template yang sudah disetujui yang boleh dikirim. Pesan teks bebas akan
 * ditolak, dan alasannya kita simpan di kolom errorText supaya kelihatan di panel.
 */
class CloudProvider extends BaseProvider {
  constructor() {
    super('cloud');
    this.seenIds = new Set(); // Meta bisa mengirim ulang webhook yang sama
  }

  get baseUrl() {
    return `https://graph.facebook.com/${config.cloud.apiVersion}/${config.cloud.phoneNumberId}`;
  }

  async start() {
    const ready = Boolean(config.cloud.token && config.cloud.phoneNumberId);
    this.emitStatus({
      connected: ready,
      qr: null,
      me: ready ? { id: config.cloud.phoneNumberId, name: 'WhatsApp Cloud API' } : null,
      note: ready
        ? 'Cloud API siap. Pastikan webhook sudah diarahkan ke /webhook/whatsapp.'
        : 'WA_CLOUD_TOKEN dan WA_CLOUD_PHONE_NUMBER_ID belum diisi di file .env.',
    });
  }

  async sendText(waId, text) {
    if (!config.cloud.token || !config.cloud.phoneNumberId) {
      throw new Error('Kredensial Cloud API belum diisi di .env');
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cloud.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizeWaId(waId),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Cloud API menolak pesan: ${reason}`);
    }
    return { waMessageId: data?.messages?.[0]?.id || null };
  }

  /** Verifikasi webhook (GET) yang dipanggil Meta sekali saat pendaftaran. */
  verifyWebhook(query) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.cloud.verifyToken) {
      return { ok: true, challenge: query['hub.challenge'] };
    }
    return { ok: false };
  }

  /** Tangani payload webhook (POST) dari Meta. */
  handleWebhook(body) {
    const entries = body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contacts = value.contacts || [];

        for (const msg of value.messages || []) {
          if (this.seenIds.has(msg.id)) continue;
          this.seenIds.add(msg.id);
          if (this.seenIds.size > 5000) this.seenIds = new Set([...this.seenIds].slice(-2000));

          const profile = contacts.find((c) => c.wa_id === msg.from);
          this.emit('message', {
            waId: normalizeWaId(msg.from),
            pushName: profile?.profile?.name || null,
            text: extractText(msg),
            type: msg.type === 'text' ? 'text' : msg.type,
            waMessageId: msg.id,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
            fromMe: false,
          });
        }

        for (const st of value.statuses || []) {
          this.emit('ack', {
            waMessageId: st.id,
            status: st.status === 'failed' ? 'failed' : st.status,
            errorText: st.errors?.[0]?.title || null,
          });
        }
      }
    }
  }
}

function extractText(msg) {
  switch (msg.type) {
    case 'text': return msg.text?.body || '';
    case 'button': return msg.button?.text || '';
    case 'interactive':
      return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
    case 'image': return msg.image?.caption || '';
    case 'video': return msg.video?.caption || '';
    case 'document': return msg.document?.caption || msg.document?.filename || '';
    default: return '';
  }
}

module.exports = CloudProvider;

'use strict';

// Mesin auto-response.
//
// Alur untuk setiap pesan masuk:
//   1. saklar utama bot mati?            -> tidak membalas
//   2. bot dimatikan untuk kontak ini?   -> tidak membalas (admin sedang menangani manual)
//   3. cek aturan satu per satu, urut prioritas (angka kecil diperiksa lebih dulu):
//        - aturan aktif?
//        - sekarang masuk jam aktif aturan?
//        - teksnya cocok?
//        - cooldown / batas per kontak belum terlampaui?
//      aturan pertama yang lolos semua = yang dipakai. Selesai.
//   4. tidak ada aturan yang cocok dan sekarang di luar jam operasional
//      -> kirim pesan "di luar jam kerja" (punya cooldown sendiri).

const { prisma, getSettings } = require('../db');
const { isWithinSchedule, zonedParts } = require('../lib/time');

const MAX_MATCH_LENGTH = 4000; // batasi panjang teks yang diuji regex

function normalize(text, caseSensitive) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MATCH_LENGTH);
  return caseSensitive ? cleaned : cleaned.toLowerCase();
}

function keywordList(rule) {
  return String(rule.keywords || '')
    .split(',')
    .map((k) => normalize(k, rule.caseSensitive))
    .filter(Boolean);
}

/** Apakah teks pesan cocok dengan pemicu aturan? */
function matchesRule(rule, rawText, context = {}) {
  const text = normalize(rawText, rule.caseSensitive);

  switch (rule.matchType) {
    case 'FALLBACK':
      return true;

    case 'FIRST_MESSAGE':
      return Boolean(context.isFirstMessage);

    case 'REGEX': {
      // Untuk REGEX, seluruh isi kolom kata kunci dipakai sebagai satu pola
      // (pola regex sering mengandung koma, jadi tidak dipecah).
      const pattern = String(rule.keywords || '').trim();
      if (!pattern) return false;
      try {
        return new RegExp(pattern, rule.caseSensitive ? '' : 'i').test(text);
      } catch {
        return false; // pola tidak valid -> aturan dilewati, bukan bikin server error
      }
    }

    case 'EXACT': {
      const list = keywordList(rule);
      return list.some((k) => text === k);
    }

    case 'STARTS_WITH': {
      const list = keywordList(rule);
      return list.some((k) => text.startsWith(k));
    }

    case 'CONTAINS':
    default: {
      const list = keywordList(rule);
      if (!list.length) return false;
      return list.some((k) => text.includes(k));
    }
  }
}

/** Ganti variabel di dalam teks balasan. */
function renderTemplate(text, { contact, settings, incomingText }) {
  const tz = settings.timezone || 'Asia/Jakarta';
  const { hhmm } = zonedParts(new Date(), tz);
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());
  const nama = contact?.name || contact?.pushName || 'Kak';

  const values = {
    nama,
    name: nama,
    nomor: contact?.waId || '',
    jam: hhmm,
    tanggal,
    pesan: incomingText || '',
  };

  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : whole;
  });
}

async function cooldownBlocked(rule, contactId) {
  if (rule.maxPerContact > 0) {
    const total = await prisma.ruleHit.count({ where: { ruleId: rule.id, contactId } });
    if (total >= rule.maxPerContact) return true;
  }
  if (rule.cooldownSeconds > 0) {
    const since = new Date(Date.now() - rule.cooldownSeconds * 1000);
    const recent = await prisma.ruleHit.count({
      where: { ruleId: rule.id, contactId, firedAt: { gte: since } },
    });
    if (recent > 0) return true;
  }
  return false;
}

/**
 * Tentukan balasan otomatis untuk sebuah pesan masuk.
 * Mengembalikan { text, rule } atau { text, outsideHours: true }, atau null kalau tidak membalas.
 * Fungsi ini TIDAK mengirim apa pun — pengiriman dilakukan messageService.
 */
async function decideReply({ contact, text, isFirstMessage }) {
  const settings = await getSettings();

  if (settings.bot_enabled !== 'true') return null;
  if (contact.botEnabled === false) return null;
  if (!String(text || '').trim()) return null;

  const rules = await prisma.autoRule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
  });

  for (const rule of rules) {
    if (!isWithinSchedule(
      { days: rule.days, startTime: rule.startTime, endTime: rule.endTime, timezone: rule.timezone || settings.timezone },
    )) continue;

    if (!matchesRule(rule, text, { isFirstMessage })) continue;
    if (await cooldownBlocked(rule, contact.id)) continue;

    return {
      rule,
      text: renderTemplate(rule.replyText, { contact, settings, incomingText: text }),
    };
  }

  // Tidak ada aturan yang cocok -> cek pesan di luar jam operasional.
  if (settings.outside_hours_enabled !== 'true') return null;

  const inBusinessHours = isWithinSchedule({
    days: settings.business_days,
    startTime: settings.business_start,
    endTime: settings.business_end,
    timezone: settings.timezone,
  });
  if (inBusinessHours) return null;

  const cooldown = Number(settings.outside_hours_cooldown || 3600);
  if (cooldown > 0 && contact.lastOutsideAt) {
    const elapsed = (Date.now() - new Date(contact.lastOutsideAt).getTime()) / 1000;
    if (elapsed < cooldown) return null;
  }

  return {
    outsideHours: true,
    text: renderTemplate(settings.outside_hours_text, { contact, settings, incomingText: text }),
  };
}

/** Catat bahwa sebuah aturan (atau pesan luar jam kerja) sudah dipakai untuk kontak ini. */
async function recordHit(decision, contactId) {
  if (decision.rule) {
    await prisma.ruleHit.create({ data: { ruleId: decision.rule.id, contactId } });
    await prisma.autoRule.update({
      where: { id: decision.rule.id },
      data: { hitCount: { increment: 1 } },
    });
  } else if (decision.outsideHours) {
    await prisma.contact.update({ where: { id: contactId }, data: { lastOutsideAt: new Date() } });
  }
}

/** Uji sebuah teks terhadap aturan yang ada, tanpa mengirim apa pun (dipakai tombol "Tes" di panel). */
async function dryRun(text, { isFirstMessage = false } = {}) {
  const settings = await getSettings();
  const rules = await prisma.autoRule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
  });

  const trace = [];
  let winner = null;

  for (const rule of rules) {
    const scheduleOk = isWithinSchedule({
      days: rule.days, startTime: rule.startTime, endTime: rule.endTime,
      timezone: rule.timezone || settings.timezone,
    });
    const textOk = matchesRule(rule, text, { isFirstMessage });
    const passed = scheduleOk && textOk;
    trace.push({ id: rule.id, name: rule.name, priority: rule.priority, scheduleOk, textOk, passed });
    if (passed && !winner) winner = rule;
  }

  const inBusinessHours = isWithinSchedule({
    days: settings.business_days, startTime: settings.business_start,
    endTime: settings.business_end, timezone: settings.timezone,
  });

  const fakeContact = { name: 'Budi', pushName: 'Budi', waId: '628000000000' };

  if (winner) {
    return {
      matched: true, ruleId: winner.id, ruleName: winner.name,
      reply: renderTemplate(winner.replyText, { contact: fakeContact, settings, incomingText: text }),
      inBusinessHours, trace,
    };
  }
  if (settings.outside_hours_enabled === 'true' && !inBusinessHours) {
    return {
      matched: true, ruleName: 'Pesan di luar jam operasional', outsideHours: true,
      reply: renderTemplate(settings.outside_hours_text, { contact: fakeContact, settings, incomingText: text }),
      inBusinessHours, trace,
    };
  }
  return { matched: false, reply: null, inBusinessHours, trace };
}

module.exports = { decideReply, recordHit, matchesRule, renderTemplate, dryRun };

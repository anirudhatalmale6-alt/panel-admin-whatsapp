'use strict';

// Tes untuk dua bagian yang paling gampang salah diam-diam:
// perhitungan jam aktif (zona waktu) dan pencocokan pemicu aturan.
//   npm test

const test = require('node:test');
const assert = require('node:assert');

const { isWithinSchedule, parseHHMM, parseDays, zonedParts } = require('../src/lib/time');
const { matchesRule, renderTemplate } = require('../src/services/autoResponder');

// --- jam aktif --------------------------------------------------------------

test('zona waktu benar-benar dipakai, bukan jam server', () => {
  // 2026-08-31 01:30 UTC = 08:30 WIB (Senin), 22:30 UTC-... dst
  const d = new Date('2026-08-31T01:30:00Z');
  assert.strictEqual(zonedParts(d, 'Asia/Jakarta').hhmm, '08:30');
  assert.strictEqual(zonedParts(d, 'UTC').hhmm, '01:30');
  assert.strictEqual(zonedParts(d, 'Asia/Jayapura').hhmm, '10:30'); // WIT = UTC+9
});

test('jam kerja Senin-Jumat 08:00-17:00 WIB', () => {
  const jadwal = { days: '1,2,3,4,5', startTime: '08:00', endTime: '17:00', timezone: 'Asia/Jakarta' };

  // Senin 31 Agustus 2026, 09:00 WIB = 02:00 UTC -> di dalam
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-31T02:00:00Z')), true);
  // Senin 07:59 WIB -> di luar
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-31T00:59:00Z')), false);
  // Senin 17:00 WIB tepat -> sudah tutup (batas atas eksklusif)
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-31T10:00:00Z')), false);
  // Minggu 30 Agustus 2026, 09:00 WIB -> hari libur
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-30T02:00:00Z')), false);
});

test('jadwal yang melewati tengah malam (22:00-06:00)', () => {
  const malam = { days: '1,2,3,4,5', startTime: '22:00', endTime: '06:00', timezone: 'Asia/Jakarta' };

  // Senin 23:00 WIB -> di dalam
  assert.strictEqual(isWithinSchedule(malam, new Date('2026-08-31T16:00:00Z')), true);
  // Selasa 1 Sep 2026 03:00 WIB = Senin 31 Agu 20:00 UTC -> masih shift Senin malam
  assert.strictEqual(isWithinSchedule(malam, new Date('2026-08-31T20:00:00Z')), true);
  // Rabu 2 Sep 03:00 WIB -> masih shift Selasa malam
  assert.strictEqual(isWithinSchedule(malam, new Date('2026-09-01T20:00:00Z')), true);
  // Senin 12:00 WIB -> di luar
  assert.strictEqual(isWithinSchedule(malam, new Date('2026-08-31T05:00:00Z')), false);
  // Minggu 03:00 WIB (shift Sabtu malam tidak dipilih) -> di luar
  assert.strictEqual(isWithinSchedule(malam, new Date('2026-08-29T20:00:00Z')), false);
});

test('jam dikosongkan berarti 24 jam pada hari terpilih', () => {
  const jadwal = { days: '6,7', startTime: null, endTime: null, timezone: 'Asia/Jakarta' };
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-29T02:00:00Z')), true);  // Sabtu 09:00 WIB
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-30T02:00:00Z')), true);  // Minggu 09:00 WIB
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-30T18:00:00Z')), false); // sudah Senin 01:00 WIB
  assert.strictEqual(isWithinSchedule(jadwal, new Date('2026-08-31T02:00:00Z')), false); // Senin 09:00 WIB
});

test('zona waktu ngawur jatuh ke UTC, tidak melempar error', () => {
  assert.doesNotThrow(() => isWithinSchedule({ days: '1,2,3,4,5,6,7', timezone: 'Bukan/Zona' }));
});

test('parseHHMM dan parseDays menolak isian ngawur', () => {
  assert.strictEqual(parseHHMM('08:00'), 480);
  assert.strictEqual(parseHHMM('25:00'), null);
  assert.strictEqual(parseHHMM('halo'), null);
  assert.deepStrictEqual(parseDays('1,3,5'), [1, 3, 5]);
  assert.deepStrictEqual(parseDays(''), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(parseDays('0,9,3'), [3]);
});

// --- pencocokan pemicu ------------------------------------------------------

const rule = (patch) => ({
  matchType: 'CONTAINS', keywords: '', caseSensitive: false, ...patch,
});

test('CONTAINS tidak peduli huruf besar/kecil dan spasi berlebih', () => {
  const r = rule({ keywords: 'harga,price' });
  assert.strictEqual(matchesRule(r, 'Kak   berapa   HARGA paket A?'), true);
  assert.strictEqual(matchesRule(r, 'mau tanya PRICE list'), true);
  assert.strictEqual(matchesRule(r, 'jam buka kapan?'), false);
});

test('caseSensitive benar-benar membedakan huruf', () => {
  const r = rule({ keywords: 'STOP', caseSensitive: true });
  assert.strictEqual(matchesRule(r, 'STOP'), true);
  assert.strictEqual(matchesRule(r, 'stop'), false);
});

test('EXACT hanya cocok kalau sama persis', () => {
  const r = rule({ matchType: 'EXACT', keywords: '1,2,3' });
  assert.strictEqual(matchesRule(r, '1'), true);
  assert.strictEqual(matchesRule(r, ' 2 '), true); // spasi pinggir dibuang
  assert.strictEqual(matchesRule(r, 'nomor 1'), false);
});

test('STARTS_WITH', () => {
  const r = rule({ matchType: 'STARTS_WITH', keywords: '/menu,#order' });
  assert.strictEqual(matchesRule(r, '/menu makanan'), true);
  assert.strictEqual(matchesRule(r, 'lihat /menu'), false);
});

test('REGEX memakai seluruh isi kolom sebagai satu pola', () => {
  const r = rule({ matchType: 'REGEX', keywords: '^(halo|hai|hi|pagi)\\b' });
  assert.strictEqual(matchesRule(r, 'Halo kak'), true);
  assert.strictEqual(matchesRule(r, 'oke halo'), false);
});

test('REGEX yang salah tulis tidak menjatuhkan bot, cuma tidak pernah cocok', () => {
  const r = rule({ matchType: 'REGEX', keywords: '([kurung tidak ditutup' });
  assert.doesNotThrow(() => matchesRule(r, 'apa saja'));
  assert.strictEqual(matchesRule(r, 'apa saja'), false);
});

test('CONTAINS tanpa kata kunci tidak menyambar semua pesan', () => {
  assert.strictEqual(matchesRule(rule({ keywords: '' }), 'apa pun'), false);
});

test('FALLBACK cocok apa pun, FIRST_MESSAGE hanya untuk kontak baru', () => {
  assert.strictEqual(matchesRule(rule({ matchType: 'FALLBACK' }), 'apa pun'), true);
  const first = rule({ matchType: 'FIRST_MESSAGE' });
  assert.strictEqual(matchesRule(first, 'halo', { isFirstMessage: true }), true);
  assert.strictEqual(matchesRule(first, 'halo', { isFirstMessage: false }), false);
});

// --- variabel di teks balasan ----------------------------------------------

test('variabel diganti, yang tidak dikenal dibiarkan apa adanya', () => {
  const out = renderTemplate('Halo {{nama}}, nomor {{nomor}}. {{tidakada}}', {
    contact: { name: 'Budi', waId: '628123' },
    settings: { timezone: 'Asia/Jakarta' },
    incomingText: 'halo',
  });
  assert.match(out, /^Halo Budi, nomor 628123\. \{\{tidakada\}\}$/);
});

test('kontak tanpa nama tetap disapa dengan sopan', () => {
  const out = renderTemplate('Halo {{nama}}', {
    contact: { waId: '628123' }, settings: {}, incomingText: '',
  });
  assert.strictEqual(out, 'Halo Kak');
});

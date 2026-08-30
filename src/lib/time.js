'use strict';

// Helper jam aktif. Semua perhitungan pakai zona waktu yang dipilih di panel
// (Asia/Jakarta, Asia/Makassar, Asia/Jayapura, dst) lewat Intl, tanpa library
// tambahan — jadi server boleh saja pakai UTC, jadwal tetap benar.

const WEEKDAY_INDEX = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

const DAY_LABELS_ID = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu', 7: 'Minggu' };

/** Pecah sebuah Date menjadi { weekday 1-7, minutes sejak 00:00, hh:mm } di zona waktu tertentu. */
function zonedParts(date, timezone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
  } catch {
    // zona waktu tidak dikenal -> jatuh ke UTC daripada melempar error
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour')) % 24; // "24" bisa muncul di sebagian ICU
  const minute = Number(get('minute'));
  return {
    weekday: WEEKDAY_INDEX[get('weekday')] || 1,
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function parseHHMM(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseDays(value) {
  if (value === null || value === undefined || String(value).trim() === '') return [1, 2, 3, 4, 5, 6, 7];
  return String(value)
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 7);
}

/**
 * Apakah `date` berada di dalam jadwal?
 * schedule = { days, startTime, endTime, timezone }
 * - days kosong / null  -> semua hari
 * - startTime/endTime kosong -> 24 jam
 * - endTime < startTime -> jadwal melewati tengah malam (mis. 22:00-06:00)
 */
function isWithinSchedule(schedule, date = new Date()) {
  const timezone = schedule.timezone || 'Asia/Jakarta';
  const days = parseDays(schedule.days);
  const start = parseHHMM(schedule.startTime);
  const end = parseHHMM(schedule.endTime);
  const { weekday, minutes } = zonedParts(date, timezone);

  if (start === null || end === null) return days.includes(weekday); // 24 jam pada hari terpilih
  if (start === end) return days.includes(weekday); // 24 jam penuh

  if (start < end) {
    return days.includes(weekday) && minutes >= start && minutes < end;
  }

  // Jadwal melewati tengah malam: potongan malam milik hari mulai,
  // potongan dini hari milik hari sebelumnya.
  if (minutes >= start) return days.includes(weekday);
  if (minutes < end) {
    const previousDay = weekday === 1 ? 7 : weekday - 1;
    return days.includes(previousDay);
  }
  return false;
}

function formatDays(value) {
  const days = parseDays(value);
  if (days.length === 7) return 'Setiap hari';
  return days.map((d) => DAY_LABELS_ID[d]).join(', ');
}

module.exports = { zonedParts, parseHHMM, parseDays, isWithinSchedule, formatDays, DAY_LABELS_ID };

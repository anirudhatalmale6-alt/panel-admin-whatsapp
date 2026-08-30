# Panel Admin Chat WhatsApp

Panel web untuk tim customer service: satu inbox terpusat untuk semua chat WhatsApp
pelanggan, plus auto-response yang bisa diatur sendiri lewat panel — tanpa menyentuh kode.

## Fitur

**Inbox**
- Semua percakapan pelanggan dalam satu layar, mirip WhatsApp Web
- Pesan masuk muncul realtime (Socket.IO), tidak perlu refresh
- Balas manual dari panel, lengkap dengan status kirim / terkirim / dibaca
- Pesan yang gagal terkirim ditandai jelas beserta alasannya — tidak ada "gagal diam-diam"
- Tombol matikan bot per percakapan, untuk saat admin ingin menangani sendiri
- Mulai chat baru ke nomor mana pun, cari kontak, ganti nama kontak

**Auto-response**
- 6 tipe pemicu: mengandung kata, sama persis, diawali dengan, regex,
  pesan pertama dari kontak baru, dan fallback (semua pesan)
- Urutan prioritas — aturan pertama yang cocok dipakai, sisanya dilewati
- Jam aktif per aturan: pilih hari, jam mulai–selesai, dan zona waktu (WIB/WITA/WIT)
- Jadwal boleh melewati tengah malam (mis. shift 22:00–06:00)
- Jeda antar balasan dan batas maksimal per kontak, supaya pelanggan tidak dispam bot
- Balasan otomatis khusus di luar jam operasional
- Variabel di teks balasan: `{{nama}}`, `{{jam}}`, `{{tanggal}}`, `{{nomor}}`, `{{pesan}}`
- Tombol **Tes**: ketik contoh pesan pelanggan, lihat aturan mana yang menang dan
  balasan persisnya — tanpa mengirim apa pun ke WhatsApp
- Saklar utama untuk mematikan semua auto-response sekaligus

**Lain-lain**
- Multi-user dengan dua peran: Admin (akses penuh) dan Agen (hanya membalas chat)
- Ekspor pesan dan kontak ke CSV, backup aturan ke JSON
- Semua data di database — gampang di-backup dan dipindah

## Terhubung ke WhatsApp: tiga pilihan

Diatur lewat satu baris `WA_PROVIDER` di file `.env`. Kode aplikasi sama persis
untuk ketiganya.

| Mode | Untuk apa | Biaya | Catatan |
|---|---|---|---|
| `mock` | Demo dan uji coba aturan tanpa nomor WhatsApp | – | Ada tombol "Simulasi pesan masuk" di panel |
| `baileys` | Nomor WhatsApp biasa / WA Business, login scan QR | gratis | Bukan API resmi Meta — jangan dipakai blast massal |
| `cloud` | WhatsApp Cloud API resmi Meta | per percakapan | Perlu verifikasi Meta Business; di luar jendela 24 jam wajib pakai template |

## Instalasi cepat

```
git clone <repo> wa-admin && cd wa-admin
npm install
cp .env.example .env      # lalu edit .env
npx prisma generate && npx prisma db push
npm run seed              # membuat akun admin + 6 contoh aturan
npm start
```

Buka `http://localhost:3000`, login dengan akun dari `npm run seed`.

Panduan lengkap untuk VPS (PM2, Nginx, SSL, scan QR, webhook Meta) ada di
[docs/INSTALL.md](docs/INSTALL.md).

Cara menambah dan mengubah auto-response ada di
[docs/AUTO_RESPONSE.md](docs/AUTO_RESPONSE.md).

## Teknologi

Node.js 20+ · Express · Socket.IO · Prisma ORM (SQLite / MySQL / PostgreSQL) ·
Baileys · WhatsApp Cloud API · frontend vanilla JS tanpa build step.

## Tes

```
npm test
```

Menguji perhitungan jam aktif lintas zona waktu (termasuk jadwal yang melewati
tengah malam) dan semua tipe pencocokan pemicu.

## Struktur folder

```
src/
  server.js              titik masuk aplikasi + Socket.IO
  config.js              baca .env
  db.js                  koneksi Prisma + pengaturan global
  lib/       auth.js     login, JWT, hak akses
             time.js     perhitungan jam aktif per zona waktu
             bus.js      event internal -> Socket.IO
  providers/ base.js     kontrak yang sama untuk semua penyedia
             mock.js     simulasi
             baileys.js  WhatsApp Web (scan QR)
             cloud.js    WhatsApp Cloud API resmi
  services/  autoResponder.js   mesin aturan auto-response
             messageService.js  simpan pesan, kirim, status
  routes/                REST API
public/                  panel web (HTML/CSS/JS, tanpa build)
prisma/schema.prisma     struktur database
scripts/seed.js          akun admin + contoh aturan
tests/                   tes otomatis
deploy/                  contoh konfigurasi Nginx
```

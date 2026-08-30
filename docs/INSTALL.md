# Panduan Instalasi di VPS

Ditulis untuk Ubuntu 22.04 / 24.04. Untuk distro lain, yang berubah hanya
perintah `apt`.

---

## 1. Siapkan server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v    # harus v20 atau lebih baru
```

## 2. Ambil kode dan pasang dependensi

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone <URL-REPO> wa-admin
sudo chown -R $USER:$USER wa-admin
cd wa-admin

npm install --omit=dev
```

## 3. Isi file konfigurasi

```bash
cp .env.example .env
nano .env
```

Yang wajib diubah:

- `JWT_SECRET` — buat teks acak panjang:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `WA_PROVIDER` — isi `baileys` atau `cloud` (lihat langkah 6)
- `ADMIN_EMAIL` dan `ADMIN_PASSWORD` — akun admin pertama
- `PORT` — biarkan 3000 kalau tidak ada aplikasi lain di port itu

## 4. Siapkan database

Default memakai SQLite — tidak perlu install apa pun:

```bash
mkdir -p data
npx prisma generate
npx prisma db push
npm run seed
```

`npm run seed` membuat akun admin dan 6 contoh aturan auto-response.
Aman dijalankan berkali-kali, tidak menimpa data yang sudah ada.

**Kalau mau pakai MySQL atau PostgreSQL:**

1. Buat database kosong dan user-nya di server database Anda.
2. Buka `prisma/schema.prisma`, ubah baris `provider = "sqlite"` menjadi
   `"mysql"` atau `"postgresql"`.
3. Ubah `DATABASE_URL` di `.env` sesuai contoh di `.env.example`.
4. Jalankan lagi `npx prisma db push && npm run seed`.

Tidak ada perubahan lain yang diperlukan — kode aplikasi tidak peduli
database apa yang dipakai.

## 5. Jalankan dengan PM2

```bash
sudo npm install -g pm2

pm2 start ecosystem.config.js
pm2 save
pm2 startup          # jalankan perintah yang ditampilkan, supaya auto-start saat server reboot

pm2 logs wa-admin    # lihat log
pm2 restart wa-admin
```

> Penting: jangan menaikkan `instances` di `ecosystem.config.js`. Satu sesi
> WhatsApp hanya boleh dipegang oleh satu proses. Kalau dijalankan dua proses
> sekaligus, sesi akan saling menendang dan koneksi putus terus.

## 6. Sambungkan ke WhatsApp

### Pilihan A — Baileys (nomor WhatsApp biasa, scan QR)

Di `.env`:
```
WA_PROVIDER=baileys
BAILEYS_SESSION_DIR=./data/baileys-session
```

Restart aplikasi, lalu:

1. Buka panel di browser, login sebagai admin.
2. Masuk ke menu **Pengaturan → Koneksi WhatsApp**. QR code akan muncul di sana.
3. Di HP: WhatsApp → **Perangkat Tertaut** → **Tautkan Perangkat** → scan QR.
4. Setelah tersambung, indikator di pojok kiri bawah berubah menjadi hijau.

QR berganti setiap ~20 detik dan halaman memperbaruinya otomatis, jadi tidak
perlu di-refresh manual.

**Backup folder sesi.** Setelah tersambung, folder `data/baileys-session/`
berisi kredensial login. Simpan salinannya. Kalau folder ini hilang, Anda perlu
scan QR ulang.

```bash
tar czf backup-sesi-$(date +%F).tar.gz data/baileys-session
```

**Yang perlu diketahui soal Baileys:**

- Ini bukan API resmi Meta, melainkan implementasi protokol WhatsApp Web.
- Untuk membalas chat pelanggan yang masuk, risikonya kecil — polanya sama
  seperti orang membalas dari WhatsApp Web.
- Yang membuat nomor kena banned adalah blast massal, mengirim ke nomor yang
  tidak pernah menghubungi Anda, dan pesan yang dilaporkan spam oleh penerima.
  Jangan lakukan itu.
- Pakai nomor khusus untuk CS, bukan nomor pribadi pemilik usaha.

### Pilihan B — WhatsApp Cloud API (resmi Meta)

Di `.env`:
```
WA_PROVIDER=cloud
WA_CLOUD_TOKEN=<permanent access token>
WA_CLOUD_PHONE_NUMBER_ID=<Phone Number ID>
WA_CLOUD_VERIFY_TOKEN=<teks bebas buatan sendiri>
```

Langkah di sisi Meta:

1. Buat App di [developers.facebook.com](https://developers.facebook.com) →
   tambahkan produk **WhatsApp**.
2. Di **API Setup**, catat **Phone Number ID**.
3. Buat **System User** di Business Settings, beri akses ke WhatsApp Account,
   lalu generate **permanent access token**. (Token sementara 24 jam yang
   muncul di halaman API Setup hanya untuk uji coba.)
4. Di **Configuration → Webhooks**, isi:
   - Callback URL: `https://panel.domain-anda.com/webhook/whatsapp`
   - Verify token: sama persis dengan `WA_CLOUD_VERIFY_TOKEN` di `.env`
5. Klik **Verify and Save**, lalu **Subscribe** ke field `messages`.

> Webhook hanya bisa diverifikasi lewat HTTPS, jadi selesaikan langkah 7 dan 8
> dulu sebelum mendaftarkan webhook.

**Aturan jendela 24 jam.** Meta hanya mengizinkan pesan teks bebas dalam 24 jam
sejak pesan terakhir dari pelanggan. Di luar itu wajib memakai template yang
sudah disetujui. Auto-response yang membalas pesan masuk selalu berada di dalam
jendela ini, jadi aman. Yang tidak bisa adalah mengirim pesan bebas ke pelanggan
yang sudah lama tidak menghubungi — panel akan menandai pesan itu **GAGAL**
beserta alasannya dari Meta.

## 7. Pasang Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/wa-admin
sudo nano /etc/nginx/sites-available/wa-admin     # ganti server_name
sudo ln -s /etc/nginx/sites-available/wa-admin /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Dua baris ini di konfigurasi Nginx tidak boleh dihapus:

```
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Tanpa keduanya, Socket.IO tidak bisa naik ke WebSocket dan pesan masuk tidak
akan muncul realtime di panel (harus refresh manual).

## 8. Pasang SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.domain-anda.com
```

Setelah HTTPS aktif, pastikan `COOKIE_SECURE=1` di `.env`, lalu
`pm2 restart wa-admin`.

## 9. Setelah panel jalan

1. Login dengan akun dari `npm run seed`.
2. **Ganti password admin** lewat menu **Pengguna → Ganti password saya**.
3. Tambahkan akun untuk tim di menu **Pengguna**. Peran **Agen** hanya bisa
   membalas chat; peran **Admin** bisa mengubah aturan, pengaturan, dan pengguna.
4. Atur jam operasional di menu **Pengaturan**.
5. Sesuaikan contoh aturan di menu **Auto-Response** — lihat
   [AUTO_RESPONSE.md](AUTO_RESPONSE.md).

---

## Backup

Yang perlu di-backup rutin:

| Apa | Di mana | Kenapa |
|---|---|---|
| Database | `data/wa-admin.db` (SQLite) atau dump MySQL/PostgreSQL | semua pesan, kontak, aturan |
| Sesi WhatsApp | `data/baileys-session/` | supaya tidak perlu scan QR ulang |
| `.env` | file `.env` | berisi JWT_SECRET dan token |

Contoh cron harian jam 2 pagi:

```bash
crontab -e
```
```
0 2 * * * cd /var/www/wa-admin && tar czf /root/backup-wa-$(date +\%F).tar.gz data .env && find /root -name 'backup-wa-*.tar.gz' -mtime +14 -delete
```

Pesan dan kontak juga bisa diunduh sebagai CSV kapan saja dari menu
**Pengaturan → Ekspor & backup**.

## Update ke versi baru

```bash
cd /var/www/wa-admin
git fetch origin && git merge --ff-only origin/main
npm install --omit=dev
npx prisma generate && npx prisma db push
pm2 restart wa-admin
```

## Kalau ada masalah

| Gejala | Kemungkinan penyebab |
|---|---|
| Pesan masuk tidak muncul sampai halaman di-refresh | dua baris `proxy_set_header Upgrade/Connection` hilang dari konfigurasi Nginx |
| QR tidak muncul di menu Pengaturan | `WA_PROVIDER` belum diisi `baileys`, atau proses belum di-restart |
| QR muncul terus padahal sudah discan | folder sesi tidak bisa ditulis — cek pemilik folder `data/` |
| Koneksi putus-nyambung terus | ada dua proses memegang sesi yang sama — cek `pm2 list`, harus satu saja |
| Login berhasil lalu langsung keluar sendiri | `COOKIE_SECURE=1` tapi panel diakses lewat HTTP tanpa SSL |
| Pesan keluar bertanda GAGAL di Cloud API | biasanya di luar jendela 24 jam — alasan lengkap dari Meta ada di bawah pesan |
| `pm2 logs wa-admin` penuh error database | `npx prisma db push` belum dijalankan setelah update |

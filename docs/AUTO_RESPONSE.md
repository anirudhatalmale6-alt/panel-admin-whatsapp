# Cara Menambah dan Mengubah Auto-Response

Semua di dokumen ini dilakukan dari panel web — tidak ada kode yang perlu disentuh
dan tidak perlu me-restart server. Perubahan langsung berlaku untuk pesan berikutnya.

Masuk ke menu **Auto-Response** di sidebar kiri. Menu ini hanya bisa diubah oleh
pengguna dengan peran **Admin**.

---

## 1. Cara bot memilih balasan

Setiap kali ada pesan masuk, urutannya begini:

1. Saklar utama bot mati? → tidak membalas.
2. Bot dimatikan khusus untuk chat itu? → tidak membalas.
   (Tombol "Auto-response" di header percakapan, dipakai saat admin sedang
   menangani pelanggan itu sendiri.)
3. Aturan diperiksa satu per satu dari **prioritas terkecil ke terbesar**.
   Untuk setiap aturan dicek: aktif? masuk jam aktifnya? teksnya cocok?
   jeda antar balasannya sudah lewat?
4. **Aturan pertama yang lolos semua pengecekan itulah yang dipakai. Selesai.**
   Aturan sisanya tidak diperiksa lagi.
5. Kalau tidak ada satu pun yang cocok, dan sekarang di luar jam operasional,
   bot mengirim pesan "di luar jam kerja" (diatur di menu Pengaturan).
6. Kalau tetap tidak ada → bot diam. Pesannya tetap masuk ke inbox untuk
   dibalas manual.

Yang paling sering bikin bingung: **satu pesan hanya dibalas satu aturan.**
Kalau pelanggan menulis "harga paketnya berapa dan alamatnya di mana?", yang
terkirim hanya balasan dari satu aturan — yang prioritasnya paling kecil.

---

## 2. Membuat aturan baru

Klik **+ Aturan baru**. Isian yang ada:

### Nama aturan
Hanya untuk Anda sendiri, tidak pernah dilihat pelanggan. Buat yang jelas,
misalnya "Tanya ongkir Jabodetabek".

### Prioritas
Angka. **Kecil = diperiksa lebih dulu.**

Panduan angka yang rapi:

| Rentang | Untuk apa |
|---|---|
| 1–19 | sapaan pesan pertama, kata kunci khusus seperti "STOP" atau kode promo |
| 20–99 | pertanyaan spesifik: harga, ongkir, stok, lokasi, jam buka |
| 100–499 | pertanyaan umum |
| 500+ | fallback / balasan penutup |

Beri jarak (10, 20, 30) supaya nanti gampang menyelipkan aturan di tengah.

### Kapan aturan ini dipakai (tipe pemicu)

| Tipe | Cocok kalau | Contoh isian kata kunci | Cocok dengan |
|---|---|---|---|
| **Mengandung kata** | salah satu kata ada di mana pun dalam pesan | `harga, price, biaya` | "kak berapa **harga**nya?" |
| **Sama persis** | isi pesan sama persis dengan salah satunya | `1, 2, 3` | "2" — tapi bukan "nomor 2" |
| **Diawali dengan** | pesan dimulai dengan salah satunya | `/menu, #order` | "**/menu** makanan" |
| **Regex** | pola regex cocok | `^(halo\|hai\|hi)\b` | "Halo kak" — tapi bukan "oke halo" |
| **Pesan pertama kontak baru** | ini pesan pertama dari nomor itu, apa pun isinya | (kosong) | pesan pembuka siapa pun |
| **Semua pesan (fallback)** | selalu cocok | (kosong) | apa saja |

Catatan:

- Huruf besar/kecil dan spasi berlebih diabaikan, kecuali Anda menyalakan
  "Bedakan huruf besar/kecil". Jadi `harga` sudah otomatis cocok dengan
  "HARGA", "Harga", dan "berapa   harga".
- Kata kunci dipisah **koma**. Boleh berupa frasa: `jam buka, masih buka, buka jam berapa`.
- Untuk tipe **Regex**, seluruh isi kotak kata kunci dipakai sebagai satu pola —
  **tidak** dipecah per koma (karena pola regex sering mengandung koma).
- Pola regex yang salah tulis tidak akan menjatuhkan bot; aturan itu hanya
  tidak pernah cocok. Tapi panel akan menolak menyimpannya sejak awal.

### Teks balasan

Boleh beberapa baris, boleh pakai emoji. Variabel yang tersedia:

| Variabel | Diganti dengan |
|---|---|
| `{{nama}}` | nama kontak; kalau kosong, nama di WhatsApp-nya; kalau kosong juga, "Kak" |
| `{{jam}}` | jam sekarang, format 24 jam, sesuai zona waktu aturan |
| `{{tanggal}}` | tanggal hari ini, mis. "31 Agustus 2026" |
| `{{nomor}}` | nomor WhatsApp pengirim |
| `{{pesan}}` | isi pesan pelanggan yang memicu aturan ini |

Variabel yang salah tulis dibiarkan apa adanya (muncul sebagai `{{typo}}` di
chat pelanggan), jadi selalu pakai tombol **Tes** sebelum diaktifkan.

### Hari aktif dan jam mulai–selesai

- Klik nama hari untuk menyalakan/mematikan.
- **Kosongkan jam mulai dan jam selesai** supaya aturan berlaku 24 jam pada
  hari-hari yang dipilih.
- Kalau jam selesai lebih kecil dari jam mulai, artinya jadwal melewati tengah
  malam. Contoh `22:00`–`06:00` pada hari Senin berarti Senin malam sampai
  Selasa dini hari.
- Jam selesai bersifat eksklusif: `08:00`–`17:00` berarti balasan terakhir
  jam 16:59, bukan 17:00.
- Zona waktu dihitung sendiri oleh aplikasi, jadi jam di server (yang biasanya
  UTC) tidak mempengaruhi apa pun.

### Jeda antar balasan (detik)

Supaya satu pelanggan tidak dikirimi balasan yang sama berkali-kali kalau ia
mengetik beberapa pesan beruntun.

- `300` = aturan ini maksimal sekali per 5 menit ke kontak yang sama
- `0` = tanpa jeda

Kalau aturan diblokir karena jeda, bot **lanjut memeriksa aturan berikutnya** —
jadi pelanggan biasanya tetap dapat balasan, hanya dari aturan yang lebih umum.

### Maksimal per kontak

- `1` = aturan ini hanya dikirim sekali seumur hidup ke tiap kontak.
  Cocok untuk sapaan pembuka.
- `0` = tanpa batas.

---

## 3. Tes dulu sebelum diaktifkan

Di bagian atas halaman Auto-Response ada kotak **"Coba dulu sebelum dipakai"**.

Ketik contoh pesan pelanggan, klik **Tes**. Panel akan menampilkan:

- aturan mana yang menang,
- balasan persis yang akan dikirim (variabel sudah diisi),
- apakah sekarang termasuk jam kerja atau tidak.

Tidak ada apa pun yang dikirim ke WhatsApp saat menekan tombol ini.

Mode tes tidak menghitung jeda antar balasan, karena jeda tergantung riwayat
tiap kontak. Di percakapan asli, kalau aturan pemenang baru saja dipakai ke
kontak yang sama, bot akan lompat ke aturan berikutnya yang cocok.

**Selalu tes minimal tiga hal:** pesan yang seharusnya cocok, pesan mirip yang
seharusnya TIDAK cocok, dan pesan dari aturan lain yang prioritasnya berdekatan.

---

## 4. Kesalahan yang paling sering terjadi

### Kata kunci terlalu umum mencuri aturan lain

Ini penyebab nomor satu "kok balasannya salah". Contoh nyata:

- Aturan "Tanya harga" dengan kata kunci `berapa` (prioritas 20) akan menyambar
  "jam buka **berapa**?" sebelum aturan "Tanya jam buka" (prioritas 40) sempat
  diperiksa.
- Aturan "Tanya lokasi" dengan kata kunci `toko` akan menyambar
  "jam buka **toko**?".

Solusinya: pakai frasa, bukan kata tunggal — `berapa harga` bukan `berapa`,
`alamat toko` bukan `toko`. Kalau memang harus pakai kata umum, turunkan
prioritasnya (angka lebih besar) supaya aturan yang lebih spesifik diperiksa duluan.

Cara cepat mengeceknya: tes beberapa kalimat khas pelanggan Anda dan lihat
aturan mana yang menang.

### Fallback prioritasnya terlalu kecil

Aturan tipe **fallback** cocok dengan apa pun. Kalau prioritasnya kecil, ia
akan memenangkan semua pesan dan aturan lain tidak pernah kepakai. Taruh di
angka besar, misalnya 900.

### Aturan aktif tapi tidak pernah membalas

Periksa berurutan:

1. Kolom **Aktif** di daftar aturan — statusnya "aktif" atau "mati"?
2. Saklar utama di **Pengaturan → Saklar utama bot** — menyala?
3. Tombol **Auto-response** di header percakapan itu — mungkin dimatikan
   khusus untuk kontak tersebut (kontaknya bertanda 🔕 di daftar kiri).
4. Jam aktif aturan — apakah sekarang di dalam rentangnya? Kolom "Jam aktif"
   di daftar aturan menampilkannya.
5. Ada aturan lain dengan prioritas lebih kecil yang menang duluan? Tekan **Tes**
   untuk melihatnya.
6. Kolom **Dipakai** menunjukkan berapa kali aturan itu pernah terpakai —
   kalau `0×` terus, berarti memang tidak pernah cocok.

### Bot membalas terus-menerus

Naikkan jeda antar balasan, atau isi "maksimal per kontak".

---

## 5. Mematikan bot sementara

| Ingin mematikan | Caranya |
|---|---|
| Untuk satu percakapan saja | Tombol "Auto-response" di header percakapan itu |
| Untuk semua orang, sementara | Pengaturan → Saklar utama bot |
| Satu aturan saja | Tombol "Matikan" di baris aturan itu |
| Balasan di luar jam kerja saja | Pengaturan → matikan "Kirim balasan otomatis di luar jam kerja" |

Mematikan bot tidak mempengaruhi penerimaan pesan — chat pelanggan tetap masuk
ke inbox seperti biasa.

---

## 6. Pesan di luar jam operasional

Diatur terpisah di menu **Pengaturan**, bukan sebagai aturan biasa, karena
berlaku sebagai jaring pengaman terakhir.

- Dikirim hanya kalau **tidak ada satu pun aturan yang cocok** dan sekarang di
  luar jam operasional.
- Punya jeda sendiri (default 3600 detik = maksimal sekali per jam per kontak).
- Teksnya mendukung variabel yang sama: `{{nama}}`, `{{jam}}`, `{{tanggal}}`.

Kalau Anda ingin pesan luar jam kerja yang berbeda-beda per topik, buat saja
aturan biasa dengan jam aktif kebalikannya (mis. `17:00`–`08:00`) dan prioritas
kecil.

---

## 7. Backup aturan

Tombol **Backup JSON** di kanan atas halaman Auto-Response mengunduh semua
aturan beserta pengaturannya. Simpan sebelum melakukan perubahan besar.

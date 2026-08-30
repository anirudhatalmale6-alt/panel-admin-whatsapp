'use strict';

// Isi data awal: 1 akun admin + beberapa contoh aturan auto-response.
// Aman dijalankan berkali-kali — tidak menimpa data yang sudah ada.
//
//   npm run seed
//   ADMIN_EMAIL=saya@toko.com ADMIN_PASSWORD=rahasia123 npm run seed

require('dotenv').config();
const { prisma, setSetting, DEFAULT_SETTINGS } = require('../src/db');
const { hashPassword } = require('../src/lib/auth');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const SAMPLE_RULES = [
  {
    name: 'Sapaan pertama kali',
    matchType: 'FIRST_MESSAGE',
    keywords: '',
    priority: 10,
    replyText:
      'Halo {{nama}}! 👋 Terima kasih sudah menghubungi kami.\n\nAda yang bisa kami bantu? Ketik:\n1 - Info harga\n2 - Lokasi toko\n3 - Jam buka\n\nAtau ketik "admin" untuk bicara langsung dengan tim kami.',
    cooldownSeconds: 0,
    maxPerContact: 1,
  },
  {
    name: 'Tanya harga',
    matchType: 'CONTAINS',
    // "berapa" sendirian sengaja tidak dipakai: kata itu muncul juga di
    // "jam berapa buka?" dan akan mencuri aturan lain yang prioritasnya lebih besar.
    keywords: 'harga,price,biaya,tarif,ongkos,berapa harga,berapaan',
    priority: 20,
    replyText:
      'Untuk daftar harga terbaru, silakan cek katalog kami ya {{nama}}. Kalau ada produk tertentu yang mau ditanyakan, sebutkan saja nama produknya — tim kami akan bantu cek stok dan harganya.',
    cooldownSeconds: 300,
  },
  {
    name: 'Tanya lokasi',
    matchType: 'CONTAINS',
    // "toko" sendirian dihindari: "jam buka toko?" akan tersambar aturan ini
    keywords: 'alamat,lokasi,dimana,di mana,maps,google map,alamatnya',
    priority: 30,
    replyText:
      'Alamat toko kami:\nJl. Contoh No. 123, Jakarta Selatan\n\nSilakan ganti alamat ini lewat menu Auto-Response di panel admin.',
    cooldownSeconds: 300,
  },
  {
    name: 'Tanya jam buka',
    matchType: 'CONTAINS',
    keywords: 'jam buka,jam operasional,buka jam,masih buka,jam berapa',
    priority: 40,
    replyText: 'Kami buka Senin-Jumat pukul 08.00-17.00 WIB. Sekarang jam {{jam}} WIB.',
    cooldownSeconds: 300,
  },
  {
    name: 'Minta bicara dengan admin',
    matchType: 'CONTAINS',
    keywords: 'admin,cs,customer service,manusia,operator,orang',
    priority: 50,
    replyText:
      'Baik {{nama}}, pesan Anda sudah diteruskan ke tim kami. Mohon tunggu sebentar ya, admin akan segera membalas. 🙏',
    cooldownSeconds: 600,
  },
  {
    name: 'Balasan umum (fallback)',
    matchType: 'FALLBACK',
    keywords: '',
    priority: 900,
    replyText:
      'Terima kasih atas pesannya {{nama}}. Pesan Anda sudah kami terima dan akan dibalas oleh tim kami sesegera mungkin. 🙏',
    cooldownSeconds: 1800,
  },
];

async function main() {
  // pengaturan default
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (!existing) await setSetting(key, value);
  }

  // akun admin
  let admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: process.env.ADMIN_NAME || 'Administrator',
        email: ADMIN_EMAIL,
        role: 'ADMIN',
        passwordHash: await hashPassword(ADMIN_PASSWORD),
      },
    });
    console.log(`Akun admin dibuat: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    if (ADMIN_PASSWORD === 'admin123') {
      console.log('!! Ganti password ini segera lewat menu Pengguna di panel.');
    }
  } else {
    console.log(`Akun admin sudah ada: ${ADMIN_EMAIL} (dilewati)`);
  }

  // contoh aturan — hanya kalau tabelnya masih kosong
  const ruleCount = await prisma.autoRule.count();
  if (ruleCount === 0) {
    for (const rule of SAMPLE_RULES) {
      await prisma.autoRule.create({ data: rule });
    }
    console.log(`${SAMPLE_RULES.length} contoh aturan auto-response ditambahkan.`);
  } else {
    console.log(`Sudah ada ${ruleCount} aturan (contoh aturan dilewati).`);
  }

  console.log('Selesai.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const config = require('./config');
const bus = require('./lib/bus');
const { prisma } = require('./db');
const { getProvider } = require('./providers');
const messageService = require('./services/messageService');
const { verifyToken } = require('./lib/auth');

const app = express();
app.set('trust proxy', 1); // di belakang Nginx
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- rute -------------------------------------------------------------------

app.get('/health', (req, res) => res.json({ ok: true, provider: getProvider().getStatus() }));

app.use('/webhook', require('./routes/webhook'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/wa', require('./routes/wa'));
app.use('/api/export', require('./routes/export'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// penangkap error terakhir — jangan sampai satu error menjatuhkan server
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

// --- realtime ---------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io' });

// hanya pengguna yang sudah login boleh menerima pesan realtime
io.use((socket, next) => {
  const raw = socket.handshake.headers.cookie || '';
  const match = /(?:^|;\s*)wa_token=([^;]+)/.exec(raw);
  const token = match ? decodeURIComponent(match[1]) : socket.handshake.auth?.token;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return next(new Error('unauthorized'));
  socket.data.user = payload;
  next();
});

for (const event of ['message:new', 'message:update', 'contact:new', 'contact:update', 'wa:status']) {
  bus.on(event, (payload) => io.emit(event, payload));
}

// --- start ------------------------------------------------------------------

async function main() {
  const provider = getProvider();
  messageService.attachProvider(provider);
  await provider.start();

  server.listen(config.port, () => {
    console.log(`Panel admin WhatsApp jalan di http://localhost:${config.port}`);
    console.log(`Penyedia WhatsApp: ${config.provider}`);
    if (config.provider === 'mock') {
      console.log('Mode simulasi aktif — pakai kotak "Simulasi pesan masuk" di panel untuk uji coba.');
    }
  });
}

async function shutdown(signal) {
  console.log(`\n${signal} diterima, menutup...`);
  try { await getProvider().stop(); } catch { /* abaikan */ }
  server.close(() => {});
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

if (require.main === module) {
  main().catch((err) => {
    console.error('Gagal start:', err);
    process.exit(1);
  });
}

module.exports = { app, server, io, main };

'use strict';

const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requireAdmin, hashPassword } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

const SAFE = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true };

router.get('/', async (req, res) => {
  res.json({ users: await prisma.user.findMany({ select: SAFE, orderBy: { id: 'asc' } }) });
});

router.post('/', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'ADMIN' ? 'ADMIN' : 'AGENT';

  if (!name || !email) return res.status(400).json({ error: 'Nama dan email wajib diisi' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(400).json({ error: 'Email sudah dipakai' });
  }

  const user = await prisma.user.create({
    data: { name, email, role, passwordHash: await hashPassword(password) },
    select: SAFE,
  });
  res.json({ user });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.role !== undefined) data.role = req.body.role === 'ADMIN' ? 'ADMIN' : 'AGENT';
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.password) {
    if (String(req.body.password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
    data.passwordHash = await hashPassword(req.body.password);
  }

  // jangan sampai admin terakhir menonaktifkan dirinya sendiri dan panel terkunci
  if (data.active === false || data.role === 'AGENT') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    const target = await prisma.user.findUnique({ where: { id } });
    if (admins <= 1 && target?.role === 'ADMIN' && target?.active) {
      return res.status(400).json({ error: 'Ini admin aktif terakhir — tidak bisa dinonaktifkan atau diturunkan' });
    }
  }

  res.json({ user: await prisma.user.update({ where: { id }, data, select: SAFE }) });
});

/** Ganti password sendiri (semua peran boleh). */
router.post('/me/password', async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(password) } });
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
  const target = await prisma.user.findUnique({ where: { id } });
  if (admins <= 1 && target?.role === 'ADMIN') {
    return res.status(400).json({ error: 'Ini admin terakhir — tidak bisa dihapus' });
  }
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

module.exports = router;

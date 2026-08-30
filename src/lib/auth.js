'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { prisma } = require('../db');

const COOKIE_NAME = 'wa_token';

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: `${config.jwtTtlHours}h` },
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[COOKIE_NAME] || null;
}

/** Middleware: wajib login. */
async function requireAuth(req, res, next) {
  const payload = verifyToken(readToken(req));
  if (!payload) return res.status(401).json({ error: 'Silakan login dulu' });

  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.active) return res.status(401).json({ error: 'Akun tidak aktif' });

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

/** Middleware: wajib admin. */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Hanya admin yang boleh melakukan ini' });
  }
  next();
}

async function authenticate(email, password) {
  const user = await prisma.user.findUnique({ where: { email: String(email || '').toLowerCase().trim() } });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return null;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

module.exports = {
  COOKIE_NAME, signToken, verifyToken, readToken,
  requireAuth, requireAdmin, authenticate, hashPassword,
};

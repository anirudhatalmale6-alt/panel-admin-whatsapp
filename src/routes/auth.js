'use strict';

const express = require('express');
const config = require('../config');
const { COOKIE_NAME, signToken, authenticate, requireAuth } = require('../lib/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'Email atau password salah' });

  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production' && process.env.COOKIE_SECURE !== '0',
    maxAge: config.jwtTtlHours * 3600 * 1000,
  });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;

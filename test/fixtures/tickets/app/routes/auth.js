const express = require('express');
const { hashPassword, checkPassword } = require('../lib/hash');
const users = require('../lib/users');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' });
  }
  if (users.find(name)) {
    return res.status(409).json({ error: 'that name is taken' });
  }
  const hash = await hashPassword(password);
  users.add({ name, hash });
  res.status(201).json({ ok: true });
});

router.post('/login', async (req, res) => {
  const user = users.find(req.body.name);
  const ok = user && (await checkPassword(req.body.password, user.hash));
  if (!ok) return res.status(401).json({ error: 'wrong name or password' });
  res.json({ ok: true });
});

module.exports = router;

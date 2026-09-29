const bcrypt = require('bcryptjs');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, checkPassword };

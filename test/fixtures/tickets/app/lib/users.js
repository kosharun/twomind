const fs = require('fs');

const FILE = `${__dirname}/users.json`;

function load() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

exports.find = (name) => load().find((user) => user.name === name);

exports.add = (user) => {
  const all = load();
  all.push(user);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
};

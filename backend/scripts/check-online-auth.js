const fs = require('fs');
const jwt = require('jsonwebtoken');
const http = require('http');

const env = fs.readFileSync(__dirname + '/../.env', 'utf8');
const secret = (env.match(/^JWT_SECRET=(.*)$/m) || [])[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

// 找出超管用户 id
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, avatar: true } }).then(u => {
  console.log('super admin:', JSON.stringify(u));
  if (!u) process.exit(1);
  const token = jwt.sign({ userId: u.id, email: u.email, role: 'super_admin' }, secret, { expiresIn: '10m' });
  const paths = ['/api/auth/me', '/api/admin/users?scope=staff&limit=10'];
  let i = 0;
  (function next() {
    if (i >= paths.length) { p.$disconnect(); return; }
    const path = paths[i++];
    http.get({ host: 'localhost', port: 3000, path: path, headers: { Authorization: 'Bearer ' + token } }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => { console.log(path, '->', r.statusCode, b.slice(0, 150)); next(); });
    });
  })();
}).catch(e => { console.error('ERR', e.message); process.exit(1); });

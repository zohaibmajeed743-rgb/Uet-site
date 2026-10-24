import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import handler from './site.js';

// Temporary check page #3: runs the real save code and shows the real error.
export default async function diag3(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const out = [];
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  const exp = String(Date.now() + 60000);
  const token = exp + '.' + crypto.createHmac('sha256', secret).update(exp).digest('hex');
  const payload = JSON.stringify({ names: ['Hassan Sheraz', 'Arslan EE', 'Ayham'], announcements: [], photos: [], contact: { phone: '03719254430', email: 'zohaibmajeed743@gmail.com' } });

  const fake = Readable.from([Buffer.from(payload)]);
  fake.method = 'POST';
  fake.url = '/api/save';
  fake.query = { a: 'save' };
  fake.headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map((x) => (x && x.stack ? String(x.stack).split('\n').slice(0, 4).join(' | ') : String(x))).join(' '));
  const result = {};
  const fres = {
    setHeader() {},
    status(c) { result.code = c; return this; },
    json(j) { result.body = j; return this; }
  };
  try { await handler(fake, fres); } catch (e) { out.push('THROWN: ' + (e && e.stack ? e.stack : e)); }
  console.error = orig;

  out.push('status: ' + result.code);
  out.push('body: ' + JSON.stringify(result.body).slice(0, 300));
  out.push('logged errors: ' + (logs.join('\n') || 'none'));
  res.status(200).send(out.join('\n'));
}

import crypto from 'node:crypto';
import { put, list } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

const TTL = 12 * 60 * 60 * 1000;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX = 4 * 1024 * 1024;
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const hmac = (p) => crypto.createHmac('sha256', secret()).update(p).digest('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function sign() { const e = String(Date.now() + TTL); return e + '.' + hmac(e); }
function authed(req) {
  const h = req.headers.authorization || '';
  const parts = (h.startsWith('Bearer ') ? h.slice(7) : '').split('.');
  if (parts.length !== 2 || !secret()) return false;
  const a = Buffer.from(parts[1]), b = Buffer.from(hmac(parts[0]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(parts[0]) > Date.now();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX) { reject(new Error('too_big')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function clean(b) {
  const out = { names: [], announcements: [], photos: [], contact: {} };
  (Array.isArray(b.names) ? b.names : []).slice(0, 300).forEach((n) => { const s = str(n, 60); if (s) out.names.push(s); });
  (Array.isArray(b.announcements) ? b.announcements : []).slice(0, 50).forEach((a) => {
    if (!a) return;
    const title = str(a.title, 120), text = str(a.text, 1000);
    if (title || text) out.announcements.push({ title, text, date: str(a.date, 40) });
  });
  (Array.isArray(b.photos) ? b.photos : []).slice(0, 60).forEach((p) => {
    if (!p) return;
    const url = str(p.url, 500);
    if (/^https:\/\//i.test(url)) out.photos.push({ url, caption: str(p.caption, 100) });
  });
  const c = b.contact || {};
  out.contact = { phone: str(c.phone, 30), email: str(c.email, 120) };
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/', 'http://x');
  const q = req.query || {};
  const action = q.a || url.searchParams.get('a') || url.pathname.split('/').pop();

  try {
    if (action === 'data') {
      try {
        const { blobs } = await list({ prefix: 'site/data.json', limit: 1 });
        if (!blobs.length) return res.status(200).json({});
        const r = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' });
        return res.status(200).json(r.ok ? await r.json() : {});
      } catch (e) { console.error('data error', e); return res.status(200).json({}); }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

    if (action === 'login') {
      if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel.' });
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) {}
      if (!crypto.timingSafeEqual(sha(body.password || ''), sha(process.env.ADMIN_PASSWORD))) {
        await new Promise((r) => setTimeout(r, 800));
        return res.status(401).json({ error: 'Wrong password.' });
      }
      return res.status(200).json({ token: sign() });
    }

    if (!authed(req)) return res.status(401).json({ error: 'Not logged in.' });

    if (action === 'save') {
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) {}
      const data = clean(body);
      await put('site/data.json', JSON.stringify(data), {
        access: 'public', contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
      });
      return res.status(200).json({ ok: true, saved: data });
    }

    if (action === 'upload') {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!TYPES[type]) return res.status(400).json({ error: 'Only JPG, PNG, WebP or GIF images are allowed.' });
      const buf = await readBody(req);
      if (!buf.length) return res.status(400).json({ error: 'Empty file.' });
      const nm = String(q.name || url.searchParams.get('name') || 'photo');
      const base = nm.replace(/\.[^.]*$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'photo';
      const blob = await put('site/photos/' + base + '.' + TYPES[type], buf, { access: 'public', contentType: type, addRandomSuffix: true });
      return res.status(200).json({ url: blob.url });
    }

    return res.status(404).json({ error: 'Unknown action.' });
  } catch (e) {
    if (e && e.message === 'too_big') return res.status(413).json({ error: 'Image is too large. Use a smaller photo.' });
    console.error('api error', e);
    return res.status(500).json({ error: 'Something went wrong. Check that a Blob store is connected in Vercel.' });
  }
}

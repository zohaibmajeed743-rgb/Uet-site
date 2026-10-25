import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';

const TTL = 12 * 60 * 60 * 1000;
export const config = { api: { bodyParser: false } };

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
    if (req.readableEnded) return resolve(Buffer.alloc(0));
    const chunks = []; let size = 0;
    const timer = setTimeout(() => reject(new Error('Request body timed out')), 8000);
    req.on('data', (c) => { size += c.length; if (size > MAX) { clearTimeout(timer); reject(new Error('too_big')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function readJson(req) {
  let b;
  try { b = req.body; } catch (e) { b = undefined; }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  if (b && typeof b === 'object') return b;
  try { return JSON.parse((await readBody(req)).toString('utf8')); } catch (e) { return {}; }
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
  if (Array.isArray(b.rolls)) {
    out.v = 2;
    out.rolls = [];
    b.rolls.slice(0, 300).forEach((r) => {
      if (!r) return;
      const name = str(r.name, 60), roll = str(r.roll, 40);
      if (name || roll) out.rolls.push({ name, roll });
    });
    const p = b.party || {};
    out.party = { open: p.open !== false, details: str(p.details, 600) };
  }
  return out;
}

function storeHost() {
  const t = process.env.BLOB_READ_WRITE_TOKEN || '';
  const id = t.split('_')[3];
  return id ? id.toLowerCase() + '.public.blob.vercel-storage.com' : '';
}
let memo = { at: 0, data: null };
async function readData() {
  if (memo.data && Date.now() - memo.at < 10000) return memo.data;
  let data = null;
  const host = storeHost();
  if (host) {
    try {
      const r = await fetch('https://' + host + '/site/data.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.status === 404) data = {};
      else if (r.ok) data = await r.json();
    } catch (e) { data = null; }
  }
  if (data === null) {
    const { blobs } = await list({ prefix: 'site/data.json', limit: 1 });
    if (!blobs.length) data = {};
    else { const r = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' }); data = r.ok ? await r.json() : {}; }
  }
  memo = { at: Date.now(), data };
  return data;
}
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/', 'http://x');
  const q = req.query || {};
  const action = q.a || url.searchParams.get('a') || url.pathname.split('/').pop();

  try {
    if (action === 'data') {
      try {
        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
        return res.status(200).json(await readData());
      } catch (e) { console.error('data error', e); return res.status(200).json({}); }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

    if (action === 'login') {
      if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel.' });
      const body = await readJson(req);
      if (!crypto.timingSafeEqual(sha(body.password || ''), sha(process.env.ADMIN_PASSWORD))) {
        await new Promise((r) => setTimeout(r, 800));
        return res.status(401).json({ error: 'Wrong password.' });
      }
      return res.status(200).json({ token: sign() });
    }

    if (action === 'rsvp') {
      const b = await readJson(req);
      if (b.hp) return res.status(200).json({ ok: true });
      const name = str(b.name, 60).replace(/\s+/g, ' '), roll = str(b.roll, 30);
      if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
      const id = slug(name);
      if (!id) return res.status(400).json({ error: 'Please enter a valid name.' });
      const d = await readData();
      if (d && d.party && d.party.open === false) return res.status(403).json({ error: 'Sign-ups are closed.' });
      const { blobs } = await list({ prefix: 'site/rsvp/', limit: 1000 });
      const exists = blobs.some((x) => x.pathname === 'site/rsvp/' + id + '.json');
      if (!exists && blobs.length >= 300) return res.status(429).json({ error: 'The list is full.' });
      await put('site/rsvp/' + id + '.json', JSON.stringify({ name, roll, at: new Date().toISOString() }), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
      });
      return res.status(200).json({ ok: true });
    }

    if (!authed(req)) return res.status(401).json({ error: 'Not logged in.' });

    if (action === 'rsvps') {
      const { blobs } = await list({ prefix: 'site/rsvp/', limit: 1000 });
      const items = (await Promise.all(blobs.map(async (x) => {
        try {
          const r = await fetch(x.url + '?t=' + Date.now(), { cache: 'no-store' });
          const j = await r.json();
          return { id: x.pathname.slice('site/rsvp/'.length, -5), name: j.name || '', roll: j.roll || '', at: j.at || '' };
        } catch (e) { return null; }
      }))).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return res.status(200).json({ items });
    }

    if (action === 'rsvpdel') {
      const id = String((await readJson(req)).id || '');
      if (!/^[a-z0-9-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Bad id.' });
      const { blobs } = await list({ prefix: 'site/rsvp/' + id + '.json', limit: 5 });
      const hit = blobs.filter((x) => x.pathname === 'site/rsvp/' + id + '.json').map((x) => x.url);
      if (hit.length) await del(hit);
      return res.status(200).json({ ok: true });
    }

    if (action === 'save') {
      const data = clean(await readJson(req));
      await put('site/data.json', JSON.stringify(data), {
        access: 'public', contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
      });
      memo = { at: 0, data: null };
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
    return res.status(500).json({ error: 'Something went wrong: ' + (e && e.message ? e.message : String(e)) });
  }
}

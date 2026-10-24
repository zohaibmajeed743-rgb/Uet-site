import { put } from '@vercel/blob';

// Temporary check page #2: tries the exact same save the admin panel uses.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const out = [];
  const body = JSON.stringify({ names: ['test'], announcements: [], photos: [], contact: {} });
  const tests = [
    ['A (same as save: json + cacheControlMaxAge 60)', { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 }],
    ['B (json, no cacheControlMaxAge)', { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }],
    ['C (overwrite same file again, no cache option)', { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }]
  ];
  for (const [name, opt] of tests) {
    try {
      const b = await put('site/diag2.json', body, opt);
      out.push(name + ': ok');
    } catch (e) {
      out.push(name + ': FAILED -> ' + (e && e.name) + ': ' + (e && e.message));
    }
  }
  res.status(200).send(out.join('\n'));
}

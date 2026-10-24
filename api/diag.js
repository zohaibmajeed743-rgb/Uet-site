import { put, list } from '@vercel/blob';

// Temporary check page. Open /api/diag in the browser to see why saving fails.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const out = [];
  const tok = process.env.BLOB_READ_WRITE_TOKEN || '';
  out.push('ADMIN_PASSWORD set: ' + !!process.env.ADMIN_PASSWORD);
  out.push('BLOB_READ_WRITE_TOKEN set: ' + !!tok + (tok ? ' (starts with ' + tok.slice(0, 15) + ')' : ''));
  out.push('BLOB_STORE_ID set: ' + !!process.env.BLOB_STORE_ID);
  out.push('Node: ' + process.version);

  try {
    const r = await list({ prefix: 'site/', limit: 5 });
    out.push('LIST: ok, found ' + r.blobs.length + ' file(s)');
  } catch (e) {
    out.push('LIST: FAILED -> ' + (e && e.name) + ': ' + (e && e.message));
  }

  try {
    const b = await put('site/diag.txt', 'ok ' + Date.now(), {
      access: 'public', contentType: 'text/plain',
      addRandomSuffix: false, allowOverwrite: true
    });
    out.push('PUT: ok -> ' + b.url);
  } catch (e) {
    out.push('PUT: FAILED -> ' + (e && e.name) + ': ' + (e && e.message));
  }
  res.status(200).send(out.join('\n'));
}

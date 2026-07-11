import express from 'express';

// Owner: Person B (new file)
// Server-side image fetch so the extension can hand off a product image
// *URL* instead of trying to fetch/convert it in the content script -- an
// arbitrary retailer CDN image is very likely to fail a cross-origin fetch
// or taint a canvas there. A server-to-server fetch has no CORS
// restriction at all, so this is the simpler and more robust path.

export const imageProxyRouter = express.Router();

const MAX_BYTES = 15 * 1024 * 1024; // matches server.js's json body limit

imageProxyRouter.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let parsed;
  try {
    parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  try {
    const upstream = await fetch(parsed.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; deja-wear/1.0)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream image fetch failed (${upstream.status})` });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: `URL did not return an image (got ${contentType})` });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Image too large' });
    }

    res.json({ dataUrl: `data:${contentType};base64,${buffer.toString('base64')}` });
  } catch (err) {
    console.error('Image proxy fetch failed:', err);
    res.status(502).json({ error: 'Image proxy fetch failed', detail: String(err) });
  }
});

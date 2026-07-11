import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTryOn } from './tryonCore.js';
import { wardrobeRouter } from './wardrobe.js';
import { colorAnalysisRouter } from './colorAnalysis.js';
import { sustainabilityRouter } from './sustainability.js';
import { imageProxyRouter } from './imageProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '15mb' })); // photos as base64 data URLs
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Feature routers -- see CONTRACT.md for the API each one implements.
// Route bodies live in their own files; keep this file a thin mount point
// so two people aren't editing the same route handlers.
app.use(wardrobeRouter);
app.use(colorAnalysisRouter);
app.use(sustainabilityRouter);
app.use(imageProxyRouter);

// Rough, illustrative-only impact-per-item estimates for the demo overlay.
// Not sourced from a lifecycle-assessment study — swap for real figures later.
const IMPACT_ESTIMATES = {
  top: { co2Kg: 5, waterL: 2700 },
  bottom: { co2Kg: 9, waterL: 3800 },
  dress: { co2Kg: 11, waterL: 4500 },
  shoes: { co2Kg: 14, waterL: 8000 },
  other: { co2Kg: 7, waterL: 3000 },
};

app.get('/api/impact', (req, res) => {
  const category = String(req.query.category || 'other').toLowerCase();
  res.json(IMPACT_ESTIMATES[category] || IMPACT_ESTIMATES.other);
});

app.post('/api/tryon', async (req, res) => {
  const { personImage, garmentImage, garmentDescription } = req.body;

  if (!personImage || !garmentImage) {
    return res.status(400).json({ error: 'personImage and garmentImage are required' });
  }

  try {
    const outputUrl = await runTryOn({ personImage, garmentImage, garmentDescription });
    res.json({ outputUrl });
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    console.error('Try-on generation failed:', detail);
    res.status(500).json({ error: 'Try-on generation failed', detail });
  }
});

// Return clean JSON for the errors express.json() throws (malformed body ->
// SyntaxError, oversized photo -> PayloadTooLargeError) instead of Express's
// default HTML stack-trace page, so the API stays consistent under bad input
// during a demo. Must be registered after the routes.
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = status === 413 ? 'Request body too large' : 'Invalid request';
  if (status >= 500) console.error('Unhandled request error:', err);
  res.status(status).json({ error: message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`deja-wear running at http://localhost:${port}`);
});

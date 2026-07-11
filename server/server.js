import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@gradio/client';
import { wardrobeRouter } from './wardrobe.js';
import { colorAnalysisRouter } from './colorAnalysis.js';
import { sustainabilityRouter } from './sustainability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '15mb' })); // photos as base64 data URLs
app.use(express.static(path.join(__dirname, '..', 'public')));

// Feature routers -- see CONTRACT.md for the API each one implements.
// Route bodies live in their own files; keep this file a thin mount point
// so two people aren't editing the same route handlers.
app.use(wardrobeRouter);
app.use(colorAnalysisRouter);
app.use(sustainabilityRouter);

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

// data:image/png;base64,AAAA... -> Blob (what @gradio/client expects for file inputs)
function dataUrlToBlob(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL image');
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
}

// yisol/IDM-VTON is a free, shared ZeroGPU Space -- connecting is slow-ish,
// so reuse one client across requests instead of reconnecting every time.
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = Client.connect('yisol/IDM-VTON', {
      hf_token: process.env.HF_TOKEN || undefined,
    });
  }
  return clientPromise;
}

app.post('/api/tryon', async (req, res) => {
  const { personImage, garmentImage, garmentDescription } = req.body;

  if (!personImage || !garmentImage) {
    return res.status(400).json({ error: 'personImage and garmentImage are required' });
  }

  try {
    const client = await getClient();
    const personBlob = dataUrlToBlob(personImage);
    const garmentBlob = dataUrlToBlob(garmentImage);

    // Schema pulled live from https://yisol-idm-vton.hf.space/info --
    // the human image has to go through Gradio's ImageEditor shape, not a
    // plain file, or the Space rejects the call.
    const result = await client.predict('/tryon', {
      dict: { background: personBlob, layers: [], composite: null },
      garm_img: garmentBlob,
      garment_des: garmentDescription || 'clothing item',
      is_checked: true,
      is_checked_crop: false,
      denoise_steps: 30,
      seed: 42,
    });

    const output = result.data?.[0];
    const outputUrl = output?.url || output?.path;

    if (!outputUrl) {
      return res.status(502).json({ error: 'Space did not return an image', detail: result });
    }

    res.json({ outputUrl });
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    console.error('Try-on generation failed:', detail);
    res.status(500).json({ error: 'Try-on generation failed', detail });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`deja-wear running at http://localhost:${port}`);
});

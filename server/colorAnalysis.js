import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { callGemini } from './geminiClient.js';

// Owner: Person B
// Implements: POST /api/profile/photo, GET /api/profile, POST /api/wardrobe/:id/analyze-color
// See CONTRACT.md for exact shapes. Palette analysis runs ONCE per user photo
// and is cached on users_profile -- per-garment calls only compare against
// the cached palette, they never recompute it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads');

export const colorAnalysisRouter = express.Router();

// data:image/png;base64,AAAA... -> { mimeType, buffer, extension }
function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL image');
  const [, mimeType, base64] = match;
  const extension = mimeType.split('/')[1] || 'jpg';
  return { mimeType, buffer: Buffer.from(base64, 'base64'), extension };
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'image/jpeg';
}

function loadImageAsBase64(filePath) {
  return { mimeType: mimeTypeForPath(filePath), data: fs.readFileSync(filePath).toString('base64') };
}

const PALETTE_SCHEMA = {
  type: 'object',
  properties: {
    season: { type: 'string', enum: ['spring', 'summer', 'autumn', 'winter'] },
    undertone: { type: 'string', enum: ['warm', 'cool', 'neutral'] },
    bestColors: { type: 'array', items: { type: 'string' }, description: 'Hex codes, e.g. #4a6d8c' },
    avoidColors: { type: 'array', items: { type: 'string' }, description: 'Hex codes' },
  },
  required: ['season', 'undertone', 'bestColors', 'avoidColors'],
};

colorAnalysisRouter.post('/api/profile/photo', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'image is required' });

  try {
    const { mimeType, buffer, extension } = parseDataUrl(image);

    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `profile-${Date.now()}.${extension}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    const text = await callGemini({
      parts: [
        {
          text:
            'Analyze this person\'s natural coloring (skin, hair, eyes) and determine their ' +
            'seasonal color palette (spring/summer/autumn/winter), undertone (warm/cool/neutral), ' +
            'and 6-8 best hex colors + 4-6 colors to avoid for clothing.',
        },
        { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
      ],
      schema: PALETTE_SCHEMA,
    });
    const colorPalette = JSON.parse(text);

    const analyzedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO users_profile (id, fullBodyImagePath, colorPalette, analyzedAt)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fullBodyImagePath = excluded.fullBodyImagePath,
         colorPalette = excluded.colorPalette,
         analyzedAt = excluded.analyzedAt`
    ).run(filePath, JSON.stringify(colorPalette), analyzedAt);

    res.json({ fullBodyImagePath: filePath, colorPalette, analyzedAt });
  } catch (err) {
    console.error('Profile photo analysis failed:', err);
    res.status(500).json({ error: 'Profile photo analysis failed', detail: String(err) });
  }
});

colorAnalysisRouter.get('/api/profile', (req, res) => {
  const row = db.prepare('SELECT * FROM users_profile WHERE id = 1').get();
  if (!row) return res.json({});
  res.json({ ...row, colorPalette: row.colorPalette ? JSON.parse(row.colorPalette) : null });
});

const COLOR_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    dominantColors: { type: 'array', items: { type: 'string' }, description: 'Hex codes of the garment\'s main colors' },
    colorMatchScore: { type: 'integer', description: '0-100, how well this garment suits the given palette' },
    colorMatchNotes: { type: 'string', description: 'One or two plain-language sentences explaining the score' },
  },
  required: ['dominantColors', 'colorMatchScore', 'colorMatchNotes'],
};

colorAnalysisRouter.post('/api/wardrobe/:id/analyze-color', async (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM wardrobe_items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Wardrobe item not found' });
  if (!item.garmentImagePath) return res.status(400).json({ error: 'Item has no stored garment image' });

  const profile = db.prepare('SELECT * FROM users_profile WHERE id = 1').get();
  if (!profile || !profile.colorPalette) {
    return res.status(400).json({ error: 'No color profile yet -- call POST /api/profile/photo first' });
  }

  try {
    const garmentImage = loadImageAsBase64(item.garmentImagePath);
    const palette = JSON.parse(profile.colorPalette);

    const text = await callGemini({
      parts: [
        {
          text:
            `Extract this garment's dominant hex colors, then judge how well it suits someone with ` +
            `this seasonal palette: ${JSON.stringify(palette)}. Score 0-100 and give a one or two ` +
            `sentence plain-language explanation.`,
        },
        { inline_data: { mime_type: garmentImage.mimeType, data: garmentImage.data } },
      ],
      schema: COLOR_MATCH_SCHEMA,
    });
    const { dominantColors, colorMatchScore, colorMatchNotes } = JSON.parse(text);

    db.prepare(
      `UPDATE wardrobe_items SET garmentDominantColors = ?, colorMatchScore = ?, colorMatchNotes = ? WHERE id = ?`
    ).run(JSON.stringify(dominantColors), colorMatchScore, colorMatchNotes, id);

    const updated = db.prepare('SELECT * FROM wardrobe_items WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('Color match analysis failed:', err);
    res.status(500).json({ error: 'Color match analysis failed', detail: String(err) });
  }
});

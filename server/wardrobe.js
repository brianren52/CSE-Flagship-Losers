import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { runTryOn } from './tryonCore.js';

// Owner: [assign yourself here]
// Implements: POST /api/wardrobe/tryon, GET /api/wardrobe, PATCH /api/wardrobe/:id/decision
// See CONTRACT.md for the exact request/response shapes and the wardrobe_items schema.
// Reuse the existing IDM-VTON call from server/tryonCore.js -- don't wire up
// a second image-gen model.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Keep in sync with CONTRACT.md's wardrobe_items.category enum. Anything else
// is rejected server-side (rather than silently stored) so bad data can't slip
// in via a direct API call and then quietly fall back to "other" estimates.
const ALLOWED_CATEGORIES = new Set(['top', 'bottom', 'dress', 'shoes', 'other']);

export const wardrobeRouter = express.Router();

// ---- helpers -----------------------------------------------------------

// Decodes a base64 data URL image and writes it to server/uploads/, returning
// the absolute file path on disk.
async function saveDataUrlImage(dataUrl, prefix) {
  const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 image data URL');
  const [, subtype, base64] = match;
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.split('+')[0];
  const filename = `${prefix}-${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  await fsp.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

// The IDM-VTON result is a URL/path on the shared HF Space and can expire --
// download it immediately into server/uploads/ so it survives past the
// Space's own cache lifetime.
async function downloadOutputImage(outputUrl, prefix) {
  const ext = guessExtFromUrl(outputUrl) || 'webp';
  const filename = `${prefix}-${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = path.join(uploadsDir, filename);

  if (/^https?:\/\//i.test(outputUrl)) {
    const response = await fetch(outputUrl);
    if (!response.ok) {
      throw new Error(`Failed to download try-on output image: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fsp.writeFile(filePath, Buffer.from(arrayBuffer));
  } else {
    // Local filesystem path returned by the Gradio client (already downloaded
    // to a local temp dir by @gradio/client) -- copy it into our uploads dir.
    await fsp.copyFile(outputUrl, filePath);
  }

  return filePath;
}

function guessExtFromUrl(url) {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(url);
  return match ? match[1].toLowerCase() : null;
}

// Absolute filesystem path (server/uploads/xyz.png) -> web-servable path
// (/uploads/xyz.png), matching the static mount in server.js.
function toWebPath(filePath) {
  if (!filePath) return null;
  return `/uploads/${path.basename(filePath)}`;
}

function parseJsonColumn(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Converts a raw wardrobe_items DB row into the JSON shape returned to
// clients: file paths become /uploads/... web paths, JSON columns get parsed.
function serializeItem(row) {
  if (!row) return null;
  return {
    ...row,
    garmentImagePath: toWebPath(row.garmentImagePath),
    tryonImagePath: toWebPath(row.tryonImagePath),
    garmentDominantColors: parseJsonColumn(row.garmentDominantColors),
    sustainabilitySources: parseJsonColumn(row.sustainabilitySources),
  };
}

function getItemById(id) {
  const stmt = db.prepare('SELECT * FROM wardrobe_items WHERE id = ?');
  return stmt.get(id);
}

// ---- routes -------------------------------------------------------------

wardrobeRouter.post('/api/wardrobe/tryon', async (req, res) => {
  const {
    garmentImage,
    garmentDescription,
    category,
    sourceUrl,
    sourceName,
    sourcePrice,
    personImage,
  } = req.body || {};

  if (!garmentImage || !personImage) {
    return res.status(400).json({ error: 'garmentImage and personImage are required' });
  }

  const categoryValue = category || 'other';
  if (!ALLOWED_CATEGORIES.has(categoryValue)) {
    return res.status(400).json({
      error: `category must be one of: ${[...ALLOWED_CATEGORIES].join(', ')}`,
    });
  }

  try {
    // IDM-VTON on the shared ZeroGPU Space can legitimately take up to ~2
    // minutes (queueing + inference) -- no artificial timeout is set here,
    // and Express/Node's default HTTP server timeouts are long enough for a
    // single-machine hackathon demo.
    const outputUrl = await runTryOn({ personImage, garmentImage, garmentDescription });

    // Persist both the garment image we were given and the (possibly
    // ephemeral) try-on result, since the Space's own copy can expire. Use
    // allSettled so that if one write fails (e.g. the ephemeral URL 404s), we
    // can delete whichever file DID land instead of leaving an orphaned upload
    // with no DB row -- these accumulate fast if the HF Space is flaky mid-demo.
    const [garmentResult, tryonResult] = await Promise.allSettled([
      saveDataUrlImage(garmentImage, 'garment'),
      downloadOutputImage(outputUrl, 'tryon'),
    ]);

    if (garmentResult.status === 'rejected' || tryonResult.status === 'rejected') {
      for (const settled of [garmentResult, tryonResult]) {
        if (settled.status === 'fulfilled') {
          fsp.unlink(settled.value).catch(() => {}); // best-effort orphan cleanup
        }
      }
      throw (garmentResult.reason || tryonResult.reason);
    }

    const garmentImagePath = garmentResult.value;
    const tryonImagePath = tryonResult.value;

    const createdAt = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO wardrobe_items
        (category, sourceUrl, sourceName, sourcePrice, garmentImagePath, tryonImagePath, decision, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 'undecided', ?)
    `);
    const info = insertStmt.run(
      categoryValue,
      sourceUrl || null,
      sourceName || null,
      sourcePrice || null,
      garmentImagePath,
      tryonImagePath,
      createdAt
    );

    const created = getItemById(info.lastInsertRowid);
    res.status(201).json(serializeItem(created));
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    console.error('Wardrobe try-on failed:', detail);
    res.status(500).json({ error: 'Wardrobe try-on failed', detail });
  }
});

wardrobeRouter.get('/api/wardrobe', (req, res) => {
  const rows = db.prepare('SELECT * FROM wardrobe_items ORDER BY id DESC').all();
  res.json(rows.map(serializeItem));
});

wardrobeRouter.patch('/api/wardrobe/:id/decision', (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};

  if (decision !== 'skip' && decision !== 'bought') {
    return res.status(400).json({ error: 'decision must be "skip" or "bought"' });
  }

  const existing = getItemById(id);
  if (!existing) {
    return res.status(404).json({ error: `wardrobe item ${id} not found` });
  }

  db.prepare('UPDATE wardrobe_items SET decision = ? WHERE id = ?').run(decision, id);
  const updated = getItemById(id);
  res.json(serializeItem(updated));
});

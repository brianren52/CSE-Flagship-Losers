import express from 'express';
import { db } from './db.js';
import { callGemini } from './geminiClient.js';

// Owner: Person B
// Implements: POST /api/wardrobe/:id/sustainability
// See CONTRACT.md for exact shapes and the sustainability_cache table.
//
// NOT live-search-grounded: Gemini's google_search tool requires billing to
// be linked on the API key, which this project's key doesn't have. Instead
// this asks the model to answer only from well-established training
// knowledge about the specific brand and explicitly say so when it isn't
// confident, rather than inventing certifications or incidents. `sources`
// is always empty now -- there was no live search to cite. If a
// billing-enabled key becomes available later, swap `tools: [{ google_search:
// {} }]` back in (see git history on this file) and drop `confident` in
// favor of real source URLs.

export const sustainabilityRouter = express.Router();

// Rough, labeled-as-generic fallback when the model isn't confident about a
// specific brand. Not sourced from a real dataset -- purely a placeholder so
// the UI always has *something* to show, clearly marked as an estimate.
const GENERIC_FALLBACK = {
  top: { score: 35, summary: 'No reliable brand-specific data. Generic estimate for mass-market apparel.' },
  bottom: { score: 35, summary: 'No reliable brand-specific data. Generic estimate for mass-market apparel.' },
  dress: { score: 35, summary: 'No reliable brand-specific data. Generic estimate for mass-market apparel.' },
  shoes: { score: 30, summary: 'No reliable brand-specific data. Generic estimate for mass-market footwear.' },
  other: { score: 35, summary: 'No reliable brand-specific data. Generic estimate for mass-market apparel.' },
};

function normalizeBrandKey(sourceName) {
  return (sourceName || 'unknown').trim().toLowerCase();
}

const SUSTAINABILITY_SCHEMA = {
  type: 'object',
  properties: {
    confident: {
      type: 'boolean',
      description: 'true only if you have well-established, specific public knowledge about this exact brand',
    },
    score: { type: 'integer', description: '0-100, higher = more sustainable' },
    summary: { type: 'string', description: '1-3 sentences; state specifics you are confident about, or say knowledge is limited' },
  },
  required: ['confident', 'score', 'summary'],
};

sustainabilityRouter.post('/api/wardrobe/:id/sustainability', async (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM wardrobe_items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Wardrobe item not found' });

  const brandKey = normalizeBrandKey(item.sourceName);

  try {
    const cached = db.prepare('SELECT * FROM sustainability_cache WHERE brandKey = ?').get(brandKey);

    let result;
    if (cached) {
      result = { score: cached.score, summary: cached.summary, sources: JSON.parse(cached.sources) };
    } else {
      result = await lookupSustainability(item, brandKey);
      db.prepare(
        `INSERT INTO sustainability_cache (brandKey, score, summary, sources, cachedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(brandKey) DO UPDATE SET
           score = excluded.score, summary = excluded.summary,
           sources = excluded.sources, cachedAt = excluded.cachedAt`
      ).run(brandKey, result.score, result.summary, JSON.stringify(result.sources), new Date().toISOString());
    }

    db.prepare(
      `UPDATE wardrobe_items SET sustainabilityScore = ?, sustainabilitySummary = ?, sustainabilitySources = ? WHERE id = ?`
    ).run(result.score, result.summary, JSON.stringify(result.sources), id);

    const updated = db.prepare('SELECT * FROM wardrobe_items WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('Sustainability lookup failed:', err);
    res.status(500).json({ error: 'Sustainability lookup failed', detail: String(err) });
  }
});

async function lookupSustainability(item, brandKey) {
  const text = await callGemini({
    parts: [
      {
        text:
          `What do you know about the sustainability record of the brand/source "${item.sourceName || brandKey}" ` +
          `(a "${item.category}" clothing item)? Consider: manufacturing origin/labor practices, known ` +
          `certifications (GOTS, Fair Trade, OEKO-TEX, B Corp, etc.), and any widely-reported controversies ` +
          `(sweatshop reports, greenwashing findings, etc.).\n\n` +
          `Only state specifics (certifications, incidents, factory locations) that you're actually confident ` +
          `are true and well-established for this exact brand -- do not guess or infer from the brand's ` +
          `general category. If you don't have specific, reliable knowledge about this brand, set ` +
          `"confident": false and give a generic, honest answer rather than inventing details.`,
      },
    ],
    schema: SUSTAINABILITY_SCHEMA,
  });

  const parsed = JSON.parse(text);

  if (!parsed.confident) {
    const fallback = GENERIC_FALLBACK[item.category] || GENERIC_FALLBACK.other;
    return { score: fallback.score, summary: fallback.summary, sources: [] };
  }

  return {
    score: parsed.score,
    summary: `${parsed.summary} (based on general knowledge, not independently verified via live search)`,
    sources: [],
  };
}

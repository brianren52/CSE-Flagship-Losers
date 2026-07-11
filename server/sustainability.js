import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';

// Owner: Person B
// Implements: POST /api/wardrobe/:id/sustainability
// See CONTRACT.md for exact shapes and the sustainability_cache table.
// Grounded (web-search-backed) rather than freely generated -- the model is
// told to cite real sources and say "insufficient information" rather than
// invent specifics. Cache by normalized brand name so repeat lookups for the
// same brand are instant, not re-searched every time.

export const sustainabilityRouter = express.Router();

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Rough, labeled-as-generic fallback when web search turns up nothing for a
// brand. Not sourced from a real dataset -- purely a placeholder so the UI
// always has *something* to show, clearly marked as an estimate.
const GENERIC_FALLBACK = {
  top: { score: 35, summary: 'No brand-specific data found. Generic estimate for mass-market apparel.' },
  bottom: { score: 35, summary: 'No brand-specific data found. Generic estimate for mass-market apparel.' },
  dress: { score: 35, summary: 'No brand-specific data found. Generic estimate for mass-market apparel.' },
  shoes: { score: 30, summary: 'No brand-specific data found. Generic estimate for mass-market footwear.' },
  other: { score: 35, summary: 'No brand-specific data found. Generic estimate for mass-market apparel.' },
};

function normalizeBrandKey(sourceName) {
  return (sourceName || 'unknown').trim().toLowerCase();
}

// Claude's final text block is asked to end with a fenced JSON object; pull
// the first well-formed {...} out of it rather than assuming the whole
// block is pure JSON (tool-use responses often include prose around it).
function extractJson(text) {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

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
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content:
          `Research the sustainability record of the brand/source "${item.sourceName || brandKey}" ` +
          `(a "${item.category}" clothing item). Look for: manufacturing origin/labor practices, ` +
          `known certifications (GOTS, Fair Trade, OEKO-TEX, B Corp, etc.), and any public controversies ` +
          `(sweatshop reports, greenwashing findings, etc.).\n\n` +
          `Only state things you actually found via search -- do not invent certifications, factory ` +
          `locations, or incidents. If search turns up nothing substantive about this specific brand, ` +
          `say so explicitly rather than guessing.\n\n` +
          `End your response with a single fenced JSON object, no other text after it, in exactly ` +
          `this shape:\n` +
          '```json\n' +
          `{"score": <0-100 integer, higher = more sustainable, or null if truly no information was found>, ` +
          `"summary": "<1-3 sentences, cite what you found or state insufficient information>", ` +
          `"sources": ["<url>", ...]}\n` +
          '```',
      },
    ],
  });

  const textBlocks = response.content.filter((b) => b.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1]?.text || '';
  const parsed = extractJson(lastText);

  if (!parsed || parsed.score === null || parsed.score === undefined) {
    const fallback = GENERIC_FALLBACK[item.category] || GENERIC_FALLBACK.other;
    return { score: fallback.score, summary: fallback.summary, sources: [] };
  }

  return {
    score: parsed.score,
    summary: parsed.summary || 'No summary provided.',
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

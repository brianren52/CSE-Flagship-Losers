import express from 'express';

// Owner: [assign yourself here]
// Implements: POST /api/wardrobe/:id/sustainability
// See CONTRACT.md for exact shapes and the sustainability_cache table.
// Must be grounded (web-search-backed) rather than freely generated -- the
// model should cite real sources and say "insufficient information" rather
// than invent specifics. Cache by normalized brand name so repeat lookups
// for the same brand are instant, not re-searched every time.

export const sustainabilityRouter = express.Router();

sustainabilityRouter.post('/api/wardrobe/:id/sustainability', (req, res) => {
  res.status(501).json({ error: 'TODO: grounded sustainability lookup + cache (see CONTRACT.md)' });
});

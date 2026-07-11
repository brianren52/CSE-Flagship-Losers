import express from 'express';

// Owner: [assign yourself here]
// Implements: POST /api/profile/photo, GET /api/profile, POST /api/wardrobe/:id/analyze-color
// See CONTRACT.md for exact shapes. Palette analysis runs ONCE per user photo
// and is cached on users_profile -- per-garment calls only compare against
// the cached palette, they never recompute it.

export const colorAnalysisRouter = express.Router();

colorAnalysisRouter.post('/api/profile/photo', (req, res) => {
  res.status(501).json({ error: 'TODO: run one-time palette analysis (see CONTRACT.md)' });
});

colorAnalysisRouter.get('/api/profile', (req, res) => {
  res.status(501).json({ error: 'TODO: return cached profile (see CONTRACT.md)' });
});

colorAnalysisRouter.post('/api/wardrobe/:id/analyze-color', (req, res) => {
  res.status(501).json({ error: 'TODO: extract garment colors + compare to cached palette (see CONTRACT.md)' });
});

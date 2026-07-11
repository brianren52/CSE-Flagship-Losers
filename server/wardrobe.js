import express from 'express';

// Owner: [assign yourself here]
// Implements: POST /api/wardrobe/tryon, GET /api/wardrobe, PATCH /api/wardrobe/:id/decision
// See CONTRACT.md for the exact request/response shapes and the wardrobe_items schema.
// Reuse the existing IDM-VTON call from server/server.js's /api/tryon -- don't
// wire up a second image-gen model.

export const wardrobeRouter = express.Router();

wardrobeRouter.post('/api/wardrobe/tryon', (req, res) => {
  res.status(501).json({ error: 'TODO: run try-on + save wardrobe item (see CONTRACT.md)' });
});

wardrobeRouter.get('/api/wardrobe', (req, res) => {
  res.status(501).json({ error: 'TODO: list wardrobe items (see CONTRACT.md)' });
});

wardrobeRouter.patch('/api/wardrobe/:id/decision', (req, res) => {
  res.status(501).json({ error: 'TODO: update item decision (see CONTRACT.md)' });
});

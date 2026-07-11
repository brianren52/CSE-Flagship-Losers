# déjà wear — API & data contract

This is the shared interface both of us build against. If you need a field or
route that isn't here, add it here first and mention it in your PR — don't
silently diverge, or the other person's code will break against your changes.

## Existing (already working, don't change the shape)
- `GET /api/impact?category=` -> `{ co2Kg, waterL }` (hardcoded illustrative table in server/server.js)
- `POST /api/tryon` -> `{ personImage, garmentImage, garmentDescription }` -> `{ outputUrl }` (IDM-VTON via @gradio/client)

## Data model (SQLite via Node's built-in `node:sqlite`, server/data.db)

No native build step (avoids the node-gyp/Python toolchain `better-sqlite3`
would need, which isn't set up on every machine by default). Requires Node
22.5+ -- run `node -v` and update if needed.

```
users_profile
  id                 INTEGER PRIMARY KEY (always 1 -- single demo user)
  fullBodyImagePath  TEXT
  colorPalette       TEXT (JSON: { season, undertone, bestColors: [hex], avoidColors: [hex] })
  analyzedAt         TEXT (ISO timestamp)

wardrobe_items
  id                   INTEGER PRIMARY KEY AUTOINCREMENT
  category             TEXT (top|bottom|dress|shoes|other)
  sourceUrl            TEXT
  sourceName           TEXT
  sourcePrice          TEXT
  garmentImagePath     TEXT
  tryonImagePath       TEXT
  garmentDominantColors TEXT (JSON array of hex)
  colorMatchScore      INTEGER (0-100, nullable until analyzed)
  colorMatchNotes      TEXT (nullable until analyzed)
  sustainabilityScore  INTEGER (0-100, nullable until looked up)
  sustainabilitySummary TEXT (nullable)
  sustainabilitySources TEXT (JSON array of URLs, nullable)
  decision             TEXT (skip|bought|undecided, default undecided)
  createdAt            TEXT (ISO timestamp)

sustainability_cache
  brandKey    TEXT PRIMARY KEY (normalized lowercase brand/source name)
  score       INTEGER
  summary     TEXT
  sources     TEXT (JSON array of URLs)
  cachedAt    TEXT (ISO timestamp)
```

## New routes (all stubbed as 501 in server/server.js right now — implement in place, don't rename)

- `POST /api/profile/photo` — body `{ image: dataUrl }` -> runs one-time color palette analysis, upserts users_profile, returns it.
- `GET /api/profile` -> returns users_profile (or `{}` if not yet analyzed).
- `POST /api/wardrobe/tryon` — body `{ garmentImage, garmentDescription, category, sourceUrl, sourceName, sourcePrice }` -> runs try-on (reuse existing /api/tryon logic, don't duplicate), saves images to server/uploads/, inserts a wardrobe_items row, returns the created item.
- `POST /api/wardrobe/:id/analyze-color` -> pulls stored images for that item, extracts dominant colors, compares against cached users_profile.colorPalette (do NOT recompute the palette here), writes colorMatchScore + colorMatchNotes onto the item, returns it.
- `POST /api/wardrobe/:id/sustainability` -> looks up item.sourceName in sustainability_cache first; on miss, does a grounded (web-search-backed) lookup, writes to cache + onto the item, returns it. Must explicitly avoid inventing unsourced claims — fall back to a labeled generic per-category estimate if nothing is found.
- `GET /api/wardrobe` -> list all wardrobe_items, newest first.
- `PATCH /api/wardrobe/:id/decision` — body `{ decision: "skip"|"bought" }` -> updates the row, returns it.

## Ownership (edit only your own files to avoid merge conflicts)
- `server/wardrobe.js` — try-on-to-wardrobe pipeline + wardrobe list/decision routes
- `server/colorAnalysis.js` — profile photo + color match routes
- `server/sustainability.js` — sustainability lookup + cache
- `server/db.js` — shared DB access, both may need to read it; if you need a schema change, edit it and flag in your commit message
- `public/*.js` — split by feature (see file headers) once wardrobe UI work starts

Each module is required/mounted from `server/server.js`, which stays a thin router — avoid both of you editing that file's route bodies directly.

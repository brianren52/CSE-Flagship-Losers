// Node's built-in SQLite (no native build step -- avoids the node-gyp/Python
// toolchain that better-sqlite3 requires, which isn't set up on every
// teammate's machine). Requires Node 22.5+; this repo targets 24.x.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data.db');

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users_profile (
    id INTEGER PRIMARY KEY,
    fullBodyImagePath TEXT,
    colorPalette TEXT,
    analyzedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS wardrobe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    sourceUrl TEXT,
    sourceName TEXT,
    sourcePrice TEXT,
    garmentImagePath TEXT,
    tryonImagePath TEXT,
    garmentDominantColors TEXT,
    colorMatchScore INTEGER,
    colorMatchNotes TEXT,
    sustainabilityScore INTEGER,
    sustainabilitySummary TEXT,
    sustainabilitySources TEXT,
    decision TEXT DEFAULT 'undecided',
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS sustainability_cache (
    brandKey TEXT PRIMARY KEY,
    score INTEGER,
    summary TEXT,
    sources TEXT,
    cachedAt TEXT
  );
`);

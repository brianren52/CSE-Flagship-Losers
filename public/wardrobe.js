// Owner: person-a. Renders the wardrobe gallery and derives the header tally
// (items skipped, $/CO2/water saved) from GET /api/wardrobe -- the DB is the
// source of truth so the tally survives a page refresh, unlike the old
// localStorage counters. Cards only DISPLAY the decision (skip/bought is
// decided once, in the #decision section for the current in-progress item in
// app.js) -- no per-card decision buttons here.
//
// Sustainability now lives entirely on the current-item flow in app.js; this
// file only renders the color-match chip, which is still written by Person
// B's analyze-color route and may be null for a while after an item is
// created.

const wardrobeGalleryEl = document.getElementById('wardrobeGallery');
const wardrobeEmptyEl = document.getElementById('wardrobeEmpty');

const itemsSkippedEl = document.getElementById('itemsSkipped');
const moneySavedEl = document.getElementById('moneySaved');
const co2SavedEl = document.getElementById('co2Saved');
const waterSavedEl = document.getElementById('waterSaved');

// Cache of /api/impact responses per category so we don't refetch on every
// render -- the table is small (top/bottom/dress/shoes/other) and static.
const impactCache = new Map();

async function getImpactForCategory(category) {
  const key = category || 'other';
  if (impactCache.has(key)) return impactCache.get(key);
  const promise = fetch(`/api/impact?category=${encodeURIComponent(key)}`)
    .then((res) => res.json())
    .catch(() => ({ co2Kg: 0, waterL: 0 }));
  impactCache.set(key, promise);
  return promise;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatPrice(sourcePrice) {
  // sourcePrice is TEXT in the DB and could arrive with currency symbols or
  // thousands separators (e.g. "$1,234.56") from a scraped/query-param value.
  // Strip everything but digits and the decimal point before parsing so the
  // tally doesn't silently undercount to $0 on a NaN.
  const cleaned = String(sourcePrice ?? '').replace(/[^0-9.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// Renders a 0-100 score as a chip, or a muted "pending" chip if the score
// hasn't been computed yet (null until Person B's analyze-color route runs
// against this item).
function scoreChip(label, score) {
  if (score === null || score === undefined) {
    return `<span class="score-chip pending">${escapeHtml(label)}: pending</span>`;
  }
  return `<span class="score-chip">${escapeHtml(label)}: ${escapeHtml(score)}</span>`;
}

function cardHtml(item) {
  const price = formatPrice(item.sourcePrice);
  const priceLabel = item.sourcePrice ? `$${price.toFixed(2)}` : '—';
  const decision = item.decision || 'undecided';
  const imgSrc = item.tryonImagePath || item.garmentImagePath || '';

  return `
    <article class="wardrobe-card" data-id="${item.id}" data-decision="${escapeHtml(decision)}">
      <div class="wardrobe-card-img">
        ${imgSrc
          ? `<img src="${escapeHtml(imgSrc)}" alt="Try-on for ${escapeHtml(item.sourceName || item.category || 'item')}" loading="lazy" />`
          : '<div class="wardrobe-card-noimg">No image</div>'}
      </div>
      <div class="wardrobe-card-body">
        <p class="wardrobe-card-category">${escapeHtml(item.category || 'other')}</p>
        <p class="wardrobe-card-source">${escapeHtml(item.sourceName || 'Unknown source')} · ${priceLabel}</p>
        <div class="wardrobe-card-scores">
          ${scoreChip('Color match', item.colorMatchScore)}
        </div>
        <p class="wardrobe-card-decision decision-${escapeHtml(decision)}">${escapeHtml(decisionLabel(decision))}</p>
      </div>
    </article>
  `;
}

function decisionLabel(decision) {
  if (decision === 'skip') return 'Skipped';
  if (decision === 'bought') return 'Bought';
  return 'Undecided';
}

let wardrobeItems = [];

function renderGallery() {
  if (!wardrobeItems.length) {
    wardrobeGalleryEl.innerHTML = '';
    wardrobeEmptyEl.hidden = false;
    return;
  }
  wardrobeEmptyEl.hidden = true;
  wardrobeGalleryEl.innerHTML = wardrobeItems.map(cardHtml).join('');
}

async function renderTally() {
  const skipped = wardrobeItems.filter((item) => item.decision === 'skip');

  let moneySaved = 0;
  let co2Saved = 0;
  let waterSaved = 0;

  const impacts = await Promise.all(skipped.map((item) => getImpactForCategory(item.category)));

  skipped.forEach((item, i) => {
    moneySaved += formatPrice(item.sourcePrice);
    co2Saved += Number(impacts[i]?.co2Kg) || 0;
    waterSaved += Number(impacts[i]?.waterL) || 0;
  });

  itemsSkippedEl.textContent = skipped.length;
  moneySavedEl.textContent = `$${moneySaved.toFixed(2)}`;
  co2SavedEl.textContent = co2Saved.toFixed(1);
  waterSavedEl.textContent = waterSaved.toFixed(0);
}

async function fetchWardrobe() {
  const res = await fetch('/api/wardrobe');
  if (!res.ok) throw new Error(`Failed to load wardrobe (status ${res.status})`);
  return res.json();
}

async function refresh() {
  try {
    wardrobeItems = await fetchWardrobe();
  } catch (err) {
    console.error('Could not load wardrobe:', err);
    wardrobeItems = [];
  }
  renderGallery();
  await renderTally();
}

// Exposed so app.js can trigger a refresh after a new try-on is persisted or
// the current item's decision changes, without either file reaching into the
// other's internals.
window.dejaWearWardrobe = { refresh };

refresh();

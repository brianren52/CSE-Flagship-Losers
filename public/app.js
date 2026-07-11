const personInput = document.getElementById('personInput');
const garmentInput = document.getElementById('garmentInput');
const personPreview = document.getElementById('personPreview');
const garmentPreview = document.getElementById('garmentPreview');
const personLabel = document.getElementById('personLabel');
const garmentLabel = document.getElementById('garmentLabel');
const changePersonBtn = document.getElementById('changePersonBtn');
const changeGarmentBtn = document.getElementById('changeGarmentBtn');
const itemNameInput = document.getElementById('itemName');
const categorySelect = document.getElementById('category');
const priceInput = document.getElementById('price');
const tryOnBtn = document.getElementById('tryOnBtn');
const statusEl = document.getElementById('status');
const tryOnPreviewSection = document.getElementById('tryOnPreview');
const resultImage = document.getElementById('resultImage');
const impactBadge = document.getElementById('impactBadge');
const skipBtn = document.getElementById('skipBtn');
const skipPriceEl = document.getElementById('skipPrice');
const buyReasonSelect = document.getElementById('buyReason');
const buyBtn = document.getElementById('buyBtn');
const sourceBanner = document.getElementById('sourceBanner');
const similarAlert = document.getElementById('similarAlert');

let personDataUrl = null;
let garmentDataUrl = null;
let currentImpact = null;
let currentItemId = null; // id of the wardrobe_items row for the in-progress item, once try-on succeeds

// --- Auto-fill photos: the user shouldn't have to manually supply either
// photo on every check. The person photo comes from their one-time profile
// (server/uploads, via colorAnalysis.js); the garment photo comes from the
// product image URL the extension scraped off the page, fetched server-side
// via /api/proxy-image (avoids CORS issues fetching arbitrary retailer CDNs
// from the content script). Both fall back to the manual file inputs if
// auto-load isn't available or fails -- never a hard blocker.

function useAutoPhoto({ dataUrl, previewEl, inputEl, labelEl, changeBtn }) {
  previewEl.src = dataUrl;
  previewEl.hidden = false;
  inputEl.hidden = true;
  labelEl.hidden = true;
  changeBtn.hidden = false;
}

function revealManualInput({ previewEl, inputEl, labelEl, changeBtn }) {
  inputEl.hidden = false;
  labelEl.hidden = false;
  changeBtn.hidden = true;
  previewEl.hidden = true;
}

changePersonBtn.addEventListener('click', () => {
  personDataUrl = null;
  revealManualInput({ previewEl: personPreview, inputEl: personInput, labelEl: personLabel, changeBtn: changePersonBtn });
});

changeGarmentBtn.addEventListener('click', () => {
  garmentDataUrl = null;
  revealManualInput({ previewEl: garmentPreview, inputEl: garmentInput, labelEl: garmentLabel, changeBtn: changeGarmentBtn });
});

// Returns the saved profile, or redirects to onboarding and returns null if
// no full-body photo has been analyzed yet (first-time use).
async function ensureProfileOrRedirect() {
  const res = await fetch('/api/profile');
  const profile = await res.json();
  if (!profile.fullBodyImagePath) {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/onboarding.html?returnTo=${encodeURIComponent(returnTo)}`;
    return null;
  }
  return profile;
}

async function autoLoadPersonPhoto(profile) {
  try {
    const filename = profile.fullBodyImagePath.split(/[\\/]/).pop();
    const imgRes = await fetch(`/uploads/${filename}`);
    if (!imgRes.ok) return;
    const blob = await imgRes.blob();
    personDataUrl = await fileToDataUrl(blob);
    useAutoPhoto({ dataUrl: personDataUrl, previewEl: personPreview, inputEl: personInput, labelEl: personLabel, changeBtn: changePersonBtn });
  } catch (err) {
    console.warn('Could not auto-load profile photo, falling back to manual upload:', err);
  }
}

async function autoLoadGarmentImage(imageUrl) {
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
    const data = await res.json();
    if (!res.ok || !data.dataUrl) throw new Error(data.error || 'proxy fetch failed');
    garmentDataUrl = data.dataUrl;
    useAutoPhoto({ dataUrl: garmentDataUrl, previewEl: garmentPreview, inputEl: garmentInput, labelEl: garmentLabel, changeBtn: changeGarmentBtn });
  } catch (err) {
    console.warn('Could not auto-load product image, falling back to manual upload:', err);
  }
}

// Prefill from a nudge extension / share-sheet: /?price=49.99&name=Blue+Hoodie&source=amazon.com&image=<url>
(async function init() {
  const params = new URLSearchParams(window.location.search);
  const price = params.get('price');
  const name = params.get('name');
  const source = params.get('source');
  const imageUrl = params.get('image');

  if (price) priceInput.value = price;
  if (name) itemNameInput.value = name;

  if (source || name) {
    sourceBanner.textContent = `👋 Checking ${name ? `"${name}"` : 'an item'}${source ? ` from ${source}` : ''} before you buy.`;
    sourceBanner.hidden = false;
  }

  checkForSimilarPurchase();
  refreshImpact();

  const profile = await ensureProfileOrRedirect();
  if (!profile) return; // redirecting to onboarding

  await autoLoadPersonPhoto(profile);
  if (imageUrl) await autoLoadGarmentImage(imageUrl);
})();

// --- Purchase history: items you've confirmed buying through deja-wear,
// used to flag repeat purchases of similar things in the future. ---

function loadPurchases() {
  return JSON.parse(localStorage.getItem('dejaWearPurchases') || '[]');
}

function savePurchase(purchase) {
  const purchases = loadPurchases();
  purchases.push(purchase);
  localStorage.setItem('dejaWearPurchases', JSON.stringify(purchases));
}

function normalizeWords(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
  );
}

// Crude but zero-cost: same category + at least half the words in the
// shorter name also appear in the other name. No image/vision comparison
// (yet) -- upgrade path is comparing garment photos instead of just text.
function wordOverlapRatio(a, b) {
  const setA = normalizeWords(a);
  const setB = normalizeWords(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  return shared / Math.min(setA.size, setB.size);
}

function findSimilarPurchase(name, category) {
  return loadPurchases().find(
    (p) => p.category === category && wordOverlapRatio(p.name, name) >= 0.5
  );
}

function checkForSimilarPurchase() {
  const match = findSimilarPurchase(itemNameInput.value, categorySelect.value);
  if (match) {
    const when = new Date(match.date).toLocaleDateString();
    similarAlert.textContent = `⚠️ You bought "${match.name}" on ${when} for $${match.price.toFixed(2)} (reason: ${match.reason.replace(/_/g, ' ')}). This looks similar.`;
    similarAlert.hidden = false;
  } else {
    similarAlert.hidden = true;
  }
}

itemNameInput.addEventListener('input', checkForSimilarPurchase);
categorySelect.addEventListener('change', checkForSimilarPurchase);

// --- Impact estimate + skip/buy decision: independent of the try-on photo,
// so the core loop works even when the (optional, flaky) image step doesn't. ---

async function refreshImpact() {
  const res = await fetch(`/api/impact?category=${categorySelect.value}`);
  currentImpact = await res.json();
  currentImpact.price = Number(priceInput.value) || 0;

  impactBadge.textContent = `~${currentImpact.co2Kg}kg CO2 · ${currentImpact.waterL}L water to make this`;
  skipPriceEl.textContent = currentImpact.price.toFixed(2);
}

categorySelect.addEventListener('change', refreshImpact);
priceInput.addEventListener('input', refreshImpact);

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

personInput.addEventListener('change', async () => {
  const file = personInput.files[0];
  if (!file) return;
  personDataUrl = await fileToDataUrl(file);
  personPreview.src = personDataUrl;
  personPreview.hidden = false;
});

garmentInput.addEventListener('change', async () => {
  const file = garmentInput.files[0];
  if (!file) return;
  garmentDataUrl = await fileToDataUrl(file);
  garmentPreview.src = garmentDataUrl;
  garmentPreview.hidden = false;
});

function setStatus(message) {
  if (!message) {
    statusEl.hidden = true;
    return;
  }
  statusEl.textContent = message;
  statusEl.hidden = false;
}

// Query params carried over from a nudge extension / share-sheet link, used
// to fill in the wardrobe_items sourceUrl/sourceName/sourcePrice columns.
function currentSourceInfo() {
  const params = new URLSearchParams(window.location.search);
  return {
    sourceUrl: params.get('url') || params.get('sourceUrl') || null,
    sourceName: itemNameInput.value || params.get('name') || params.get('source') || null,
    sourcePrice: priceInput.value || params.get('price') || null,
  };
}

tryOnBtn.addEventListener('click', async () => {
  if (!personDataUrl || !garmentDataUrl) {
    setStatus('Add a photo of you and the item first.');
    return;
  }

  tryOnBtn.disabled = true;
  tryOnPreviewSection.hidden = true;
  currentItemId = null;
  setStatus('Generating try-on... this can take up to ~2 min (longer if the free queue is busy).');

  try {
    const { sourceUrl, sourceName, sourcePrice } = currentSourceInfo();

    const tryOnRes = await fetch('/api/wardrobe/tryon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personImage: personDataUrl,
        garmentImage: garmentDataUrl,
        garmentDescription: itemNameInput.value || categorySelect.value,
        category: categorySelect.value,
        sourceUrl,
        sourceName,
        sourcePrice,
      }),
    });

    const tryOnData = await tryOnRes.json();
    if (!tryOnRes.ok) {
      const detail = typeof tryOnData.detail === 'string' ? tryOnData.detail : JSON.stringify(tryOnData.detail);
      throw new Error(`${tryOnData.error || 'Try-on failed'}${detail ? ` — ${detail}` : ''}`);
    }

    currentItemId = tryOnData.id;
    resultImage.src = tryOnData.tryonImagePath;
    tryOnPreviewSection.hidden = false;
    setStatus(null);

    // A new wardrobe row now exists in the DB -- refresh the gallery/tally.
    if (window.dejaWearWardrobe) window.dejaWearWardrobe.refresh();
  } catch (err) {
    setStatus(`Try-on image failed, but you can still decide below: ${err.message}`);
  } finally {
    tryOnBtn.disabled = false;
  }
});

// The header tally (items skipped, $/CO2/water saved) is derived entirely
// from GET /api/wardrobe (decision === 'skip') -- see wardrobe.js. This file
// only handles the current in-progress item's skip/buy actions.

async function recordDecision(decision) {
  if (!currentItemId) {
    // No wardrobe row yet (try-on wasn't run or failed before persisting) --
    // nothing to PATCH, but let the user still get the "logged" UX below.
    return null;
  }
  const res = await fetch(`/api/wardrobe/${currentItemId}/decision`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(`Failed to record decision (status ${res.status})`);
  return res.json();
}

skipBtn.addEventListener('click', async () => {
  if (!currentImpact) return;
  try {
    await recordDecision('skip');
    setStatus('Nice — logged as skipped. Try another item.');
    if (window.dejaWearWardrobe) window.dejaWearWardrobe.refresh();
  } catch (err) {
    setStatus(`Couldn't save that decision: ${err.message}`);
  }
});

buyBtn.addEventListener('click', async () => {
  if (!buyReasonSelect.value) {
    setStatus('Pick a reason first — even "no similar item" counts.');
    return;
  }

  savePurchase({
    name: itemNameInput.value || 'Unnamed item',
    category: categorySelect.value,
    price: currentImpact?.price || 0,
    reason: buyReasonSelect.value,
    date: new Date().toISOString(),
  });

  try {
    await recordDecision('bought');
    if (window.dejaWearWardrobe) window.dejaWearWardrobe.refresh();
  } catch (err) {
    console.error(err);
  }

  buyReasonSelect.value = '';
  setStatus('Logged. Future similar items will flag this purchase.');
  checkForSimilarPurchase();
});

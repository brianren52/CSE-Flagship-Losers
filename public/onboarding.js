const personPhotoInput = document.getElementById('personPhoto');
const personPreview = document.getElementById('personPreview');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const paletteCard = document.getElementById('paletteCard');
const paletteSeason = document.getElementById('paletteSeason');
const paletteUndertone = document.getElementById('paletteUndertone');
const bestColorsEl = document.getElementById('bestColors');
const avoidColorsEl = document.getElementById('avoidColors');
const analyzedAtEl = document.getElementById('analyzedAt');
const continueLink = document.getElementById('continueLink');

let personDataUrl = null;

// If we got here via app.js redirecting a first-time user (no profile yet),
// this carries them back to the item they were checking once setup is done.
const returnTo = new URLSearchParams(window.location.search).get('returnTo');
if (returnTo) continueLink.href = returnTo;

function setStatus(message) {
  if (!message) {
    statusEl.hidden = true;
    return;
  }
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function renderSwatches(container, hexColors) {
  container.innerHTML = '';
  for (const hex of hexColors || []) {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = hex;
    swatch.innerHTML = `<span>${hex}</span>`;
    container.appendChild(swatch);
  }
}

function renderPalette(profile) {
  if (!profile || !profile.colorPalette) {
    paletteCard.hidden = true;
    return;
  }
  const { season, undertone, bestColors, avoidColors } = profile.colorPalette;
  paletteSeason.textContent = season;
  paletteUndertone.textContent = `${undertone} undertone`;
  renderSwatches(bestColorsEl, bestColors);
  renderSwatches(avoidColorsEl, avoidColors);
  analyzedAtEl.textContent = profile.analyzedAt ? `Analyzed ${new Date(profile.analyzedAt).toLocaleString()}` : '';
  paletteCard.hidden = false;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

personPhotoInput.addEventListener('change', async () => {
  const file = personPhotoInput.files[0];
  if (!file) return;
  personDataUrl = await fileToDataUrl(file);
  personPreview.src = personDataUrl;
  personPreview.hidden = false;
});

analyzeBtn.addEventListener('click', async () => {
  if (!personDataUrl) {
    setStatus('Add a full-body photo first.');
    return;
  }

  analyzeBtn.disabled = true;
  setStatus('Analyzing your coloring... this can take 10-20s.');

  try {
    const res = await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: personDataUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    renderPalette(data);
    setStatus('Done -- this is cached, you only need to do this once.');
    if (returnTo) continueLink.hidden = false;
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    analyzeBtn.disabled = false;
  }
});

// Load any existing analysis on page open, so this page is safely revisitable.
(async function loadExistingProfile() {
  try {
    const res = await fetch('/api/profile');
    const profile = await res.json();
    renderPalette(profile);
    if (profile.fullBodyImagePath) {
      // fullBodyImagePath is a server filesystem path (see CONTRACT.md) --
      // resolve it to the web-servable /uploads/<file> path, same as app.js
      // does for the auto-load flow.
      const filename = profile.fullBodyImagePath.split(/[\\/]/).pop();
      personPreview.src = `/uploads/${filename}`;
      personPreview.hidden = false;
    }
    if (returnTo && profile.colorPalette) continueLink.hidden = false;
  } catch {
    // No profile yet -- fine, the form is still usable.
  }
})();

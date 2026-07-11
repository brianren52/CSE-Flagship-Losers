(function () {
  // Point this at wherever the deja-wear server is running for the demo.
  const APP_URL = 'http://localhost:3000';

  // Amazon has stable selectors for these; other sites fall back to the
  // page title with no price, which still works, just less pre-filled.
  function extractProductInfo() {
    const titleEl = document.querySelector('#productTitle');
    const priceEl = document.querySelector('.a-price .a-offscreen');
    const name = (titleEl ? titleEl.textContent : document.title).trim().slice(0, 120);
    const priceText = priceEl ? priceEl.textContent : '';
    const price = priceText.replace(/[^0-9.]/g, '');
    return { name, price };
  }

  function injectBanner() {
    if (document.getElementById('deja-wear-banner')) return;

    const { name, price } = extractProductInfo();

    const banner = document.createElement('div');
    banner.id = 'deja-wear-banner';
    banner.innerHTML = `
      <span>🛍️ Thinking about buying this? Check <strong>déjà wear</strong> first.</span>
      <button id="deja-wear-check">Check first</button>
      <button id="deja-wear-dismiss" aria-label="Dismiss">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('deja-wear-check').addEventListener('click', () => {
      const params = new URLSearchParams({ source: location.hostname, name, price });
      window.open(`${APP_URL}/?${params.toString()}`, '_blank');
    });

    document.getElementById('deja-wear-dismiss').addEventListener('click', () => {
      banner.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBanner);
  } else {
    injectBanner();
  }
})();

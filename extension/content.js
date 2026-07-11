(function () {
  // Point this at wherever the deja-wear server is running for the demo.
  const APP_URL = 'http://localhost:3000';

  // --- Product extraction -------------------------------------------------
  // Strategy (most to least reliable, since retailer DOMs churn constantly):
  //   1. JSON-LD structured data (<script type="application/ld+json">, @type
  //      Product) - name + offers.price. Most sites ship this for SEO and it
  //      rarely changes shape.
  //   2. OpenGraph / itemprop meta tags (og:title, product:price:amount,
  //      itemprop=price, etc.) - also SEO-driven and fairly stable.
  //   3. Site-specific CSS selectors (best-effort, hand-picked per hostname).
  //      These ARE the most likely thing to break when a retailer redesigns;
  //      flagged inline below where confidence is lower.
  //   4. document.title with no price, as an absolute last resort.
  // Every layer is wrapped so a thrown error (missing element, bad JSON,
  // etc.) just falls through to the next layer instead of breaking the
  // banner entirely.

  function cleanName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function cleanPrice(raw) {
    if (raw === null || raw === undefined) return '';
    const match = String(raw).match(/[0-9]+(\.[0-9]+)?/);
    return match ? match[0] : '';
  }

  // 1. JSON-LD Product data. Accepts a document-like object with
  // querySelectorAll so this is testable without a real DOM.
  function extractFromJsonLd(doc) {
    try {
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        let data;
        try {
          data = JSON.parse(script.textContent);
        } catch (_) {
          continue;
        }
        const candidates = Array.isArray(data) ? data : [data];
        for (const entry of candidates) {
          const nodes = entry && Array.isArray(entry['@graph']) ? entry['@graph'] : [entry];
          for (const node of nodes) {
            if (!node || typeof node !== 'object') continue;
            const type = node['@type'];
            const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
            if (!isProduct) continue;
            const name = cleanName(node.name);
            let offers = node.offers;
            if (Array.isArray(offers)) offers = offers[0];
            const price = cleanPrice(offers && (offers.price || offers.lowPrice));
            if (name) return { name, price };
          }
        }
      }
    } catch (_) {
      // ignore, fall through
    }
    return null;
  }

  // 2. OpenGraph / itemprop meta tags.
  function extractFromMeta(doc) {
    try {
      const getMeta = (selector) => {
        const el = doc.querySelector(selector);
        return el ? el.getAttribute('content') : null;
      };
      const name = cleanName(
        getMeta('meta[property="og:title"]') || getMeta('meta[name="twitter:title"]')
      );
      const price = cleanPrice(
        getMeta('meta[property="product:price:amount"]') ||
          getMeta('meta[property="og:price:amount"]') ||
          getMeta('meta[itemprop="price"]')
      );
      if (name) return { name, price };
    } catch (_) {
      // ignore, fall through
    }
    return null;
  }

  // 3. Site-specific CSS selectors, keyed by hostname substring. Best-effort:
  // retailers redesign frequently, so treat these as "good enough for a demo",
  // not guaranteed. Each entry is [nameSelectors[], priceSelectors[]].
  const SITE_SELECTORS = [
    {
      test: (host) => host.includes('amazon.'),
      name: ['#productTitle'],
      // Amazon's price markup is the most stable of the bunch.
      price: ['.a-price .a-offscreen', '#corePrice_feature_div .a-offscreen'],
    },
    {
      test: (host) => host.includes('ebay.'),
      // eBay varies name markup by listing template; these two cover most.
      name: ['h1.x-item-title__mainTitle span.ux-textspans', '.x-item-title__mainTitle'],
      price: ['.x-price-primary span.ux-textspans', '.x-bin-price__content span.ux-textspans'],
    },
    {
      test: (host) => host.includes('asos.'),
      // ASOS is a heavy SPA; class names are hashed/obfuscated and drift
      // often, so these are low-confidence guesses - JSON-LD is preferred.
      name: ['[data-testid="product-title"]', 'h1'],
      price: ['[data-testid="current-price"]', '[data-testid="product-price"]'],
    },
    {
      test: (host) => host.includes('zara.'),
      // Zara also relies heavily on JS-rendered/obfuscated classes.
      name: ['h1.product-detail-info__header-name', '.product-detail-info h1'],
      price: ['.money-amount__main', '.product-detail-info .price__amount'],
    },
    {
      test: (host) => host.includes('hm.com'),
      name: ['h1.pdp-mainname', '[data-testid="product-name"]', 'h1'],
      price: ['.pdp-price .price-value', '[data-testid="price"]'],
    },
    {
      test: (host) => host.includes('shein.'),
      // Shein frequently rotates class names; low confidence.
      name: ['.product-intro__head-name', '[data-testid="product-name"]', 'h1'],
      price: ['.product-intro__head-price .original', '.product-intro__head-price'],
    },
  ];

  function extractFromSiteSelectors(doc, hostname) {
    try {
      const site = SITE_SELECTORS.find((s) => s.test(hostname));
      if (!site) return null;
      const findText = (selectors) => {
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (el && el.textContent && el.textContent.trim()) return el.textContent;
        }
        return null;
      };
      const name = cleanName(findText(site.name));
      const price = cleanPrice(findText(site.price));
      if (name) return { name, price };
    } catch (_) {
      // ignore, fall through
    }
    return null;
  }

  // 4. Absolute fallback: page title, no price.
  function extractFromTitle(doc) {
    try {
      return { name: cleanName(doc.title), price: '' };
    } catch (_) {
      return { name: '', price: '' };
    }
  }

  // Runs the full fallback chain. `doc` defaults to the global `document` in
  // the browser but can be swapped for a document-like stub in tests.
  function extractProductInfo(doc = document, hostname = location.hostname) {
    try {
      return (
        extractFromJsonLd(doc) ||
        extractFromMeta(doc) ||
        extractFromSiteSelectors(doc, hostname) ||
        extractFromTitle(doc)
      );
    } catch (_) {
      // Never throw - a broken selector on one site must not break the banner.
      return { name: '', price: '' };
    }
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

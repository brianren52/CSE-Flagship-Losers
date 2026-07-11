// MV3 service worker. Only job right now: get first-time installs into the
// onboarding flow so we have a full-body photo before any nudge needs one.

// Point this at wherever the deja-wear server is running for the demo.
// Kept in sync with the same const in content.js -- no shared module system
// here, so duplication is the tradeoff for "no build step".
const APP_URL = 'http://localhost:3000';

chrome.runtime.onInstalled.addListener(async (details) => {
  // Only fresh installs, not updates/reloads -- otherwise every extension
  // reload during dev (or every version bump in prod) would reopen the tab.
  if (details.reason !== 'install') return;

  try {
    const res = await fetch(`${APP_URL}/api/profile`);
    const profile = await res.json();
    // A profile with fullBodyImagePath set means onboarding already happened
    // against this server (e.g. the user reinstalled the extension but the
    // server + its data.db stuck around). Nothing to do.
    if (profile && profile.fullBodyImagePath) return;
  } catch (_) {
    // Server not running yet, unreachable, or returned bad JSON -- fall
    // through and open onboarding anyway. Worst case the onboarding page
    // itself fails to load/save, which is no worse than not prompting.
  }

  chrome.tabs.create({ url: `${APP_URL}/onboarding.html` });
});

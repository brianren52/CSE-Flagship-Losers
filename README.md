# déjà wear

See a clothing item on yourself before you buy it, with a landfill-impact
estimate stamped on top and a running tally of what you skip.

## What's here (bare minimum)

- Upload a photo of yourself + a photo of an item -> virtual try-on via the
  free, public [IDM-VTON Hugging Face Space](https://huggingface.co/spaces/yisol/IDM-VTON)
  (purpose-built virtual try-on model, genuinely free, no card). Runs on a
  shared community GPU queue, so generation can be slow (tens of seconds to
  a couple minutes) depending on how busy the Space is.
- A rough, illustrative CO2/water estimate shown alongside the result.
- "I'll skip it" / "Still buying it" -> skipping logs to a running counter
  (items skipped, $ + CO2 + water saved), stored in localStorage.
- `extension/` — a Chrome extension (the "ping") that injects a banner on
  Amazon/Shein/ASOS/eBay/Zara/H&M product pages prompting you to check
  déjà wear before buying. Clicking it opens the app pre-filled with the
  item's name/price (scraped from the page on Amazon; other sites fall
  back to just the page title, no price).

## Not built yet (by design, cut for scope)

- Automatic "do you already own this" detection from a photo of your closet
  — currently the user just self-reports via the skip/buy buttons.
- Cooling-off timer.
- Secondhand/rental alternative search.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` (optional, but recommended):
- `HF_TOKEN` — a free Hugging Face token from https://huggingface.co/settings/tokens.
  The Space works anonymously too, but a token gives you priority in the
  shared queue, which matters on demo day.

```bash
npm start
```

Then open http://localhost:3000.

## Loading the extension (the "ping")

1. Go to `chrome://extensions`, enable "Developer mode" (top right).
2. "Load unpacked" -> select the `extension/` folder.
3. Visit a product page on Amazon (or ASOS/eBay/Zara/H&M/Shein) — a banner
   appears bottom-right. Click "Check first" to open déjà wear pre-filled
   with the item.

The extension points at `http://localhost:3000` (see `APP_URL` in
`extension/content.js`) — change that if you deploy the app somewhere else
for the demo.

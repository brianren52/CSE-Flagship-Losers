import { Client } from '@gradio/client';

// Shared IDM-VTON try-on logic, extracted out of server.js so both
// POST /api/tryon and POST /api/wardrobe/tryon call the exact same code path
// instead of duplicating the Gradio wiring.

// data:image/png;base64,AAAA... -> Blob (what @gradio/client expects for file inputs)
export function dataUrlToBlob(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL image');
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
}

// yisol/IDM-VTON is a free, shared ZeroGPU Space -- connecting is slow-ish,
// so reuse one client across requests instead of reconnecting every time.
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = Client.connect('yisol/IDM-VTON', {
      hf_token: process.env.HF_TOKEN || undefined,
    });
  }
  return clientPromise;
}

// Runs the IDM-VTON try-on and returns the output image URL/path as given by
// the Space (this is a URL/path on the HF Space and can be ephemeral --
// callers that need to persist it must download it promptly).
async function runTryOnViaHuggingFace({ personImage, garmentImage, garmentDescription }) {
  const client = await getClient();
  const personBlob = dataUrlToBlob(personImage);
  const garmentBlob = dataUrlToBlob(garmentImage);

  // Schema pulled live from https://yisol-idm-vton.hf.space/info --
  // the human image has to go through Gradio's ImageEditor shape, not a
  // plain file, or the Space rejects the call.
  const result = await client.predict('/tryon', {
    dict: { background: personBlob, layers: [], composite: null },
    garm_img: garmentBlob,
    garment_des: garmentDescription || 'clothing item',
    is_checked: true,
    is_checked_crop: false,
    denoise_steps: 30,
    seed: 42,
  });

  const output = result.data?.[0];
  const outputUrl = output?.url || output?.path;

  if (!outputUrl) {
    const error = new Error('Space did not return an image');
    error.detail = result;
    throw error;
  }

  return outputUrl;
}

// Optional, clearly-scoped fallback: if REPLICATE_API_TOKEN is set and the
// HF call fails, we *could* retry via Replicate's hosted IDM-VTON instead of
// failing the whole request. We intentionally do NOT add the `replicate`
// npm package or require a token for this hackathon build -- when no token
// is configured (the default), this just rethrows the original HF error
// unchanged so behavior is identical to before this refactor.
async function runTryOnWithFallback({ personImage, garmentImage, garmentDescription }) {
  try {
    return await runTryOnViaHuggingFace({ personImage, garmentImage, garmentDescription });
  } catch (hfError) {
    if (!process.env.REPLICATE_API_TOKEN) {
      // No fallback configured -- surface the original HF error as-is.
      throw hfError;
    }

    // NOTE: not implemented for this hackathon build. If you set
    // REPLICATE_API_TOKEN, wire up a real call here (e.g. via `replicate`
    // npm package or a raw fetch to api.replicate.com) that returns an
    // output image URL in the same shape as runTryOnViaHuggingFace. Until
    // then, still rethrow so callers get a clear error instead of a silent
    // no-op.
    console.error('HF try-on failed and REPLICATE_API_TOKEN is set, but no Replicate fallback is implemented yet:', hfError);
    throw hfError;
  }
}

/**
 * @param {{ personImage: string, garmentImage: string, garmentDescription?: string }} params
 *   personImage/garmentImage are base64 data URLs.
 * @returns {Promise<string>} outputUrl -- a (possibly ephemeral) URL/path to
 *   the generated try-on image, as returned by the Space.
 */
export async function runTryOn({ personImage, garmentImage, garmentDescription }) {
  if (!personImage || !garmentImage) {
    throw new Error('personImage and garmentImage are required');
  }
  return runTryOnWithFallback({ personImage, garmentImage, garmentDescription });
}

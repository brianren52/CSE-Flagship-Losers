// Shared low-level Gemini call helper for Person B's routes (color analysis +
// sustainability). Raw fetch rather than a client library, matching the
// pattern already used elsewhere in this project for Gemini calls.

function requireEnv() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Copy .env.example to .env and fill it in.');
  }
  return { apiKey, model };
}

// parts: array of Gemini "part" objects (text / inline_data).
// schema: optional JSON schema for structured output -- NOT combinable with
// `tools` (Gemini rejects responseSchema + google_search together on
// pre-Gemini-3 models), so only pass one of schema/tools per call.
// tools: optional Gemini tools array, e.g. [{ google_search: {} }].
export async function callGemini({ parts, schema, tools }) {
  const { apiKey, model } = requireEnv();

  const body = { contents: [{ parts }] };
  if (schema) body.generationConfig = { responseMimeType: 'application/json', responseSchema: schema };
  if (tools) body.tools = tools;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${detail}`);
  }

  const result = await res.json();
  const candidate = result.candidates?.[0];
  const textPart = candidate?.content?.parts?.find((p) => p.text);

  if (!textPart) {
    throw new Error(`Gemini returned no text content: ${JSON.stringify(result)}`);
  }

  return textPart.text;
}

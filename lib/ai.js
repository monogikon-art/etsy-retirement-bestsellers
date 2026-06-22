// Provider-agnostic vision tagging for the embedded AI Agent.
// Reads the configured provider/model/key from the settings table, loads the
// rule-book vocabulary, and asks a multimodal model to tag a listing image with
// metadata constrained to that vocabulary.

import { sql } from './db.js';

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct'
};

// Which rule-book dimensions feed which metadata field. design_style spans two
// categories (styles + tutorials) so it is collected by dimension, not slug.
const VOCAB_DIMENSIONS = ['design_style', 'aesthetic', 'value_add', 'color', 'font', 'cross_niche'];

export async function getAISettings() {
  const rows = await sql`
    SELECT key, value FROM settings
    WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const provider = (m.ai_provider || 'gemini').toLowerCase();
  return {
    provider,
    model: m.ai_model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini,
    key: m.ai_api_key || ''
  };
}

let vocabCache = null;
export async function loadVocabulary() {
  if (vocabCache) return vocabCache;
  const cats = await sql`SELECT id, dimension FROM rulebook_categories`;
  const entries = await sql`SELECT category_id, label FROM rulebook_entries`;
  const dimOf = new Map(cats.map((c) => [c.id, c.dimension]));
  const out = {};
  for (const d of VOCAB_DIMENSIONS) out[d] = [];
  for (const e of entries) {
    const d = dimOf.get(e.category_id);
    if (out[d]) out[d].push(e.label);
  }
  for (const d of VOCAB_DIMENSIONS) out[d] = Array.from(new Set(out[d]));
  vocabCache = out;
  return out;
}

function buildPrompt(vocab) {
  const list = (arr) => arr.map((x) => `- ${x}`).join('\n');
  return `You are a print-on-demand (POD) design analyst. You are given the printed design from an Etsy product listing (usually a t-shirt or apparel graphic). Classify the DESIGN ARTWORK itself, not the mockup/model.

Use ONLY labels from the controlled vocabularies below. Pick the closest matches; if nothing fits a field, return an empty array for it. Never invent labels.

DESIGN STYLES:
${list(vocab.design_style)}

AESTHETICS:
${list(vocab.aesthetic)}

VALUE ADDS (techniques the design uses):
${list(vocab.value_add)}

CROSS-NICHE ELEMENTS:
${list(vocab.cross_niche)}

TYPOGRAPHY (only if clearly text-based):
${list(vocab.font)}

SHIRT/BLANK COLORS:
${list(vocab.color)}

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "design_styles": [],
  "aesthetics": [],
  "value_adds": [],
  "cross_niche": [],
  "typography": [],
  "colors": [],
  "phrase": "the exact text printed on the design, or null if none",
  "summary": "one short sentence describing the design"
}`;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function fetchImageBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('image fetch ' + r.status);
  const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString('base64'), mime };
}

async function callGemini(prompt, img, { model, key }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || ('Gemini ' + r.status));
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAICompatible(endpoint, prompt, img, { model, key }) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } }
        ]
      }]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || (r.status + ' error'));
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt, img, { model, key }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || ('Anthropic ' + r.status));
  return data.content?.[0]?.text || '';
}

function normalize(meta) {
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  return {
    design_styles: arr(meta.design_styles),
    aesthetics: arr(meta.aesthetics),
    value_adds: arr(meta.value_adds),
    cross_niche: arr(meta.cross_niche),
    typography: arr(meta.typography),
    colors: arr(meta.colors),
    phrase: typeof meta.phrase === 'string' && meta.phrase.trim() ? meta.phrase.trim() : null,
    summary: typeof meta.summary === 'string' ? meta.summary.trim() : ''
  };
}

// Analyze one image URL and return normalized rule-book metadata.
export async function analyzeImage(imageUrl, vocab, settings) {
  const prompt = buildPrompt(vocab);
  const img = await fetchImageBase64(imageUrl);
  let raw;
  switch (settings.provider) {
    case 'openai':
      raw = await callOpenAICompatible('https://api.openai.com/v1/chat/completions', prompt, img, settings);
      break;
    case 'groq':
      raw = await callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', prompt, img, settings);
      break;
    case 'anthropic':
      raw = await callAnthropic(prompt, img, settings);
      break;
    case 'gemini':
    default:
      raw = await callGemini(prompt, img, settings);
  }
  return normalize(extractJson(raw));
}

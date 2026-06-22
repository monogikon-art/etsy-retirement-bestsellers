import { sql, ensureSchema } from '../lib/db.js';

// Settings read by future AI agent modules. The AI API key is stored server-side
// and never returned to the browser — GET only exposes a masked preview.
const AI_KEYS = ['ai_provider', 'ai_model', 'ai_api_key'];

function maskKey(value) {
  if (!value) return null;
  const last4 = value.slice(-4);
  return '••••••••' + last4;
}

async function getAll() {
  const rows = await sql`SELECT key, value FROM settings WHERE key = ANY(${AI_KEYS})`;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return map;
}

async function upsert(key, value) {
  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const s = await getAll();
      return res.status(200).json({
        ai_provider: s.ai_provider || '',
        ai_model: s.ai_model || '',
        ai_key_set: Boolean(s.ai_api_key),
        ai_key_preview: maskKey(s.ai_api_key)
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      if (typeof body.ai_provider === 'string') await upsert('ai_provider', body.ai_provider.trim());
      if (typeof body.ai_model === 'string') await upsert('ai_model', body.ai_model.trim());

      // Only overwrite the key when a non-empty value is supplied; empty string clears it.
      if (typeof body.ai_api_key === 'string') {
        const k = body.ai_api_key.trim();
        if (k) await upsert('ai_api_key', k);
        else if (body.clear_key === true) await upsert('ai_api_key', '');
      }

      const s = await getAll();
      return res.status(200).json({
        ok: true,
        ai_provider: s.ai_provider || '',
        ai_model: s.ai_model || '',
        ai_key_set: Boolean(s.ai_api_key),
        ai_key_preview: maskKey(s.ai_api_key)
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

import { sql, ensureSchema } from '../lib/db.js';
import { getAISettings, loadVocabulary, analyzeImage } from '../lib/ai.js';

export const config = { maxDuration: 30 };

// On-demand AI tagging of a single listing image with rule-book metadata.
export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const listingId = parseInt(body.listing_id, 10);
    if (!listingId) return res.status(400).json({ error: 'A listing_id is required.' });

    const settings = await getAISettings();
    if (!settings.key) {
      return res.status(400).json({ error: 'No AI key configured. Add one in Settings.' });
    }

    const [listing] = await sql`SELECT id, image_url FROM listings WHERE id = ${listingId}`;
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (!listing.image_url) return res.status(422).json({ error: 'Listing has no image to analyze.' });

    const vocab = await loadVocabulary();
    let metadata;
    try {
      metadata = await analyzeImage(listing.image_url, vocab, settings);
    } catch (e) {
      return res.status(502).json({ error: 'AI analysis failed: ' + e.message });
    }

    await sql`
      UPDATE listings
      SET ai_metadata = ${JSON.stringify(metadata)}::jsonb, ai_tagged_at = now()
      WHERE id = ${listingId}`;

    return res.status(200).json({ listing_id: listingId, metadata });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

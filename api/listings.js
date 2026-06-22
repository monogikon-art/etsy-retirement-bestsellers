import { sql, ensureSchema } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const slug = (req.query.niche || '').toString().trim();
    if (!slug) return res.status(400).json({ error: 'A niche slug is required.' });

    const [niche] = await sql`
      SELECT id, slug, label, status, listing_count, created_at
      FROM niches WHERE slug = ${slug}`;
    if (!niche) return res.status(404).json({ error: 'Niche not found.' });

    const listings = await sql`
      SELECT id, etsy_listing_id, title, url, image_url, price, currency, tags, rank, ai_metadata
      FROM listings
      WHERE niche_id = ${niche.id}
      ORDER BY rank ASC NULLS LAST, id ASC`;

    return res.status(200).json({ niche, listings });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

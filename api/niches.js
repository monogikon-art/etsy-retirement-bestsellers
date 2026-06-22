import { sql, ensureSchema, slugify } from '../lib/db.js';
import { searchEtsy } from '../lib/etsy.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const niches = await sql`
        SELECT slug, label, status, listing_count, created_at
        FROM niches
        ORDER BY created_at DESC`;
      return res.status(200).json({ niches });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const label = (body.label || '').toString().trim();
      if (!label) return res.status(400).json({ error: 'A niche label is required.' });

      const slug = slugify(label);
      if (!slug) return res.status(400).json({ error: 'Niche label must contain letters or numbers.' });

      let listings;
      try {
        listings = await searchEtsy(label, 100);
      } catch (e) {
        const status = e.code === 'NO_KEY' ? 503 : 502;
        return res.status(status).json({ error: 'Etsy fetch failed: ' + e.message });
      }

      const [niche] = await sql`
        INSERT INTO niches (slug, label, status, listing_count)
        VALUES (${slug}, ${label}, 'ready', ${listings.length})
        ON CONFLICT (slug) DO UPDATE
          SET label = EXCLUDED.label,
              status = 'ready',
              listing_count = EXCLUDED.listing_count,
              created_at = now()
        RETURNING id, slug, label, status, listing_count, created_at`;

      // Replace this niche's listings atomically in a single round trip.
      const ops = [sql`DELETE FROM listings WHERE niche_id = ${niche.id}`];
      for (const l of listings) {
        ops.push(sql`
          INSERT INTO listings (niche_id, etsy_listing_id, title, url, image_url, price, currency, tags, rank)
          VALUES (${niche.id}, ${l.etsy_listing_id}, ${l.title}, ${l.url}, ${l.image_url}, ${l.price}, ${l.currency}, ${JSON.stringify(l.tags)}::jsonb, ${l.rank})`);
      }
      await sql.transaction(ops);

      return res.status(201).json({ niche, count: listings.length });
    }

    if (req.method === 'DELETE') {
      const slug = (req.query.niche || '').toString().trim();
      if (!slug) return res.status(400).json({ error: 'A niche slug is required.' });
      const deleted = await sql`DELETE FROM niches WHERE slug = ${slug} RETURNING slug`;
      if (!deleted.length) return res.status(404).json({ error: 'Niche not found.' });
      return res.status(200).json({ deleted: slug });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

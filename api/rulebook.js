import { sql, ensureSchema } from '../lib/db.js';
import { RULEBOOK } from '../lib/rulebookData.js';

// One-time population of the rule book from the embedded playbook data.
// Runs server-side where DATABASE_URL is available; no-op once data exists.
async function seedIfEmpty() {
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM rulebook_categories`;
  if (count > 0) return;
  for (const c of RULEBOOK) {
    const [cat] = await sql`
      INSERT INTO rulebook_categories (slug, name, dimension, description, sort_order)
      VALUES (${c.slug}, ${c.name}, ${c.dimension}, ${c.description}, ${c.sort_order})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    if (!c.entries.length) continue;
    await sql.transaction(
      c.entries.map((e, i) => sql`
        INSERT INTO rulebook_entries (category_id, label, note, grouping, sort_order)
        VALUES (${cat.id}, ${e.label}, ${e.note}, ${e.grouping}, ${i})`)
    );
  }
}

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    await seedIfEmpty();

    const categories = await sql`
      SELECT id, slug, name, dimension, description, sort_order
      FROM rulebook_categories
      ORDER BY sort_order ASC, name ASC`;

    const entries = await sql`
      SELECT category_id, label, note, grouping, sort_order
      FROM rulebook_entries
      ORDER BY category_id ASC, sort_order ASC, id ASC`;

    const byCat = new Map();
    for (const e of entries) {
      if (!byCat.has(e.category_id)) byCat.set(e.category_id, []);
      byCat.get(e.category_id).push({ label: e.label, note: e.note, grouping: e.grouping });
    }

    // Auto-populated example galleries: bucket AI-tagged listing images by the
    // rule-book label they were tagged with, per dimension.
    const tagged = await sql`
      SELECT image_url, url, ai_metadata
      FROM listings
      WHERE ai_metadata IS NOT NULL AND image_url IS NOT NULL`;

    const dimField = {
      design_style: 'design_styles', aesthetic: 'aesthetics', value_add: 'value_adds',
      color: 'colors', font: 'typography', cross_niche: 'cross_niche'
    };
    // examplesByDim[dimension][lowercased label] -> [{image_url, url}]
    const examplesByDim = {};
    for (const t of tagged) {
      const meta = t.ai_metadata || {};
      for (const [dim, field] of Object.entries(dimField)) {
        const labels = Array.isArray(meta[field]) ? meta[field] : [];
        for (const lbl of labels) {
          const key = String(lbl).toLowerCase();
          (examplesByDim[dim] ||= {});
          (examplesByDim[dim][key] ||= []);
          if (examplesByDim[dim][key].length < 6) {
            examplesByDim[dim][key].push({ image_url: t.image_url, url: t.url });
          }
        }
      }
    }

    const result = categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      dimension: c.dimension,
      description: c.description,
      entries: (byCat.get(c.id) || []).map((e) => ({
        ...e,
        examples: (examplesByDim[c.dimension]?.[e.label.toLowerCase()]) || []
      }))
    }));

    return res.status(200).json({ categories: result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

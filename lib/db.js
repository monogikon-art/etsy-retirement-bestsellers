import { neon } from '@neondatabase/serverless';

// Neon serverless HTTP client. DATABASE_URL is provided by the Neon/Vercel integration.
export const sql = neon(process.env.DATABASE_URL);

let schemaReady = false;

// Creates the tables on first use. Cheap to call repeatedly (IF NOT EXISTS),
// and short-circuited within a warm function instance.
export async function ensureSchema() {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS niches (
      id            SERIAL PRIMARY KEY,
      slug          TEXT UNIQUE NOT NULL,
      label         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ready',
      listing_count INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS listings (
      id              SERIAL PRIMARY KEY,
      niche_id        INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      etsy_listing_id TEXT,
      title           TEXT NOT NULL,
      url             TEXT,
      image_url       TEXT,
      price           NUMERIC,
      currency        TEXT,
      tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
      rank            INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_listings_niche ON listings(niche_id)`;

  // Rule book: a POD design playbook organized into metadata dimensions
  // (design styles, aesthetics, phrases, value-adds, cross-niche ideas, colors, fonts).
  await sql`
    CREATE TABLE IF NOT EXISTS rulebook_categories (
      id           SERIAL PRIMARY KEY,
      slug         TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      dimension    TEXT NOT NULL,
      description  TEXT,
      sort_order   INTEGER NOT NULL DEFAULT 0
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS rulebook_entries (
      id           SERIAL PRIMARY KEY,
      category_id  INTEGER NOT NULL REFERENCES rulebook_categories(id) ON DELETE CASCADE,
      label        TEXT NOT NULL,
      note         TEXT,
      grouping     TEXT,
      sort_order   INTEGER NOT NULL DEFAULT 0
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rb_entries_cat ON rulebook_entries(category_id)`;

  // Key-value settings (e.g. AI provider/key) read by future AI agent modules.
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  schemaReady = true;
}

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

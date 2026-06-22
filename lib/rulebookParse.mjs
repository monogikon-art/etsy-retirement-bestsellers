// Pure parser for the POD design playbook (spreadsheet_ALL.txt). No DB / no I/O —
// used both by the local emit script and (indirectly) by the seed data it produces.

export const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Minimal RFC-4180 CSV parser (handles quotes, commas & newlines in fields).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function splitSheets(raw) {
  const blocks = [];
  const re = /# SHEET (\d+)\s*:\s*(.+?)\s*\(gid=\d+\)\s*\n=+\n/g;
  let m, prev = null;
  while ((m = re.exec(raw)) !== null) {
    if (prev) prev.body = raw.slice(prev.bodyStart, m.index).replace(/=+\s*$/, '').trim();
    prev = { num: parseInt(m[1], 10), name: m[2].trim(), bodyStart: re.lastIndex };
    blocks.push(prev);
  }
  if (prev) prev.body = raw.slice(prev.bodyStart).trim();
  return blocks;
}

const firstUrl = (s) => (s.match(/https?:\/\/\S+/) || [null])[0];

export function build(blocks) {
  const byNum = Object.fromEntries(blocks.map((b) => [b.num, b]));
  const categories = [];

  const push = (slug, name, dimension, description, sort, entries) => {
    const seen = new Set();
    const clean = entries
      .map((e) => ({ label: (e.label || '').trim(), note: (e.note || '').trim() || null, grouping: (e.grouping || '').trim() || null }))
      .filter((e) => e.label && e.label.length > 1)
      .filter((e) => { const k = e.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (clean.length) categories.push({ slug, name, dimension, description, sort_order: sort, entries: clean });
  };

  if (byNum[1]) {
    const rows = parseCsv(byNum[1].body);
    const lines = rows.map((r) => (r[0] || '').trim()).filter(Boolean);
    const desc = lines.shift() || null;
    push('how-to-use', 'How To Use', 'guide', desc, 1, lines.map((l) => ({ label: l })));
  }

  if (byNum[2]) {
    const headers = new Set([
      'proven design styles', 'hot newer trending design styles', 'top recent proven design styles',
      'longer term proven design styles', 'bootleg design style', 'text only design styles',
      'random design styles', 'examples specifically for men'
    ]);
    const rows = parseCsv(byNum[2].body);
    const group = ['', ''];
    const entries = [];
    for (const r of rows) {
      for (let c = 0; c < 2; c++) {
        const cell = (r[c] || '').trim();
        if (!cell) continue;
        if (headers.has(cell.toLowerCase())) { group[c] = cell; continue; }
        entries.push({ label: cell, grouping: group[c] || null });
      }
    }
    push('design-styles', 'Design Styles', 'design_style',
      'Proven, trending and text-only design styles for POD apparel.', 2, entries);
  }

  if (byNum[3]) {
    const rows = parseCsv(byNum[3].body);
    const entries = rows.map((r) => (r[0] || '').trim())
      .filter((v) => v && !/trending aesthetics/i.test(v))
      .map((v) => ({ label: v }));
    push('trending-aesthetics', 'Trending Aesthetics', 'aesthetic',
      'Color and visual aesthetic combinations that are currently selling.', 3, entries);
  }

  if (byNum[4]) {
    const rows = parseCsv(byNum[4].body);
    const entries = rows.map((r) => (r[0] || '').trim())
      .filter((v) => v && !/value add saying ideas/i.test(v))
      .map((v) => ({ label: v }));
    push('value-add-sayings', 'Value Add Sayings', 'phrase',
      'Fill-in-the-blank saying formulas (replace ___/X/*** with the niche).', 4, entries);
  }

  if (byNum[5]) {
    const rows = parseCsv(byNum[5].body);
    const entries = rows.map((r) => (r[0] || '').trim())
      .filter((v) => v && !/^value adds$/i.test(v))
      .map((v) => ({ label: v }));
    push('value-adds', 'Value Adds', 'value_add',
      'Listing-level techniques that add value (matching sets, back prints, bundles, etc.).', 5, entries);
  }

  if (byNum[6]) {
    const rows = parseCsv(byNum[6].body);
    const entries = rows.map((r) => (r[0] || '').trim())
      .filter((v) => v && !/cross niche ideas/i.test(v))
      .map((v) => ({ label: v }));
    push('cross-niche-ideas', 'Cross Niche Ideas', 'cross_niche',
      'Trending motifs/elements that cross over into many niches.', 6, entries);
  }

  if (byNum[7]) {
    const rows = parseCsv(byNum[7].body);
    let brand = '';
    const entries = [];
    for (const r of rows) {
      const c0 = (r[0] || '').trim();
      if (!c0) continue;
      if (/best selling colors on printify/i.test(c0)) continue;
      if (/bella|gildan|comfort colors/i.test(c0)) { brand = c0.replace(/\s*\(.*?\)\s*/g, '').replace(/:$/, '').trim(); continue; }
      const color = c0.replace(/^\d+\s+/, '').trim();
      if (color) entries.push({ label: color, grouping: brand || null });
    }
    push('bestselling-shirt-colors', 'Bestselling Shirt Colors', 'color',
      'Top-selling blank colors per print provider / brand.', 7, entries);
  }

  if (byNum[8]) {
    const rows = parseCsv(byNum[8].body);
    const entries = rows.map((r) => (r[0] || '').trim())
      .filter((v) => v && !/reccomended fonts/i.test(v) && !/coming soon/i.test(v))
      .map((v) => { const i = v.indexOf(' - '); return i > 0 ? { label: v.slice(0, i).trim(), note: v.slice(i + 3).trim() } : { label: v }; });
    push('fonts-typography', 'Fonts & Typography', 'font',
      'Recommended fonts for text-based designs.', 8, entries);
  }

  const tutorials = [];
  for (let n = 9; n <= 58; n++) {
    if (!byNum[n]) continue;
    const url = firstUrl(byNum[n].body);
    if (url) tutorials.push({ label: byNum[n].name, note: url });
  }
  if (tutorials.length) {
    push('design-style-tutorials', 'Design Style Tutorials', 'design_style',
      'External tutorials/templates for specific design styles.', 9, tutorials);
  }

  return categories;
}

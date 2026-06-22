const ETSY_BASE = 'https://openapi.etsy.com/v3/application';

// Searches Etsy's public catalog of active listings by keyword and returns a
// normalized list. Etsy's API does NOT expose the website "Bestseller" badge,
// so we request the most relevant/popular listings (sort_on=score) as the
// closest legitimate proxy. One call returns title, url, image, price and the
// seller's real tags.
export async function searchEtsy(keywords, limit = 100) {
  const key = process.env.ETSY_API_KEY;
  if (!key) {
    const err = new Error('ETSY_API_KEY is not configured');
    err.code = 'NO_KEY';
    throw err;
  }

  const params = new URLSearchParams({
    keywords,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    sort_on: 'score',
    sort_order: 'down',
    includes: 'Images'
  });

  const res = await fetch(`${ETSY_BASE}/listings/active?${params.toString()}`, {
    headers: { 'x-api-key': key }
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Etsy API ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];

  return results.map((l, i) => {
    const img = Array.isArray(l.images) && l.images.length ? l.images[0] : null;
    const divisor = l.price && l.price.divisor ? Number(l.price.divisor) : 100;
    return {
      etsy_listing_id: String(l.listing_id),
      title: l.title || '',
      url: l.url || `https://www.etsy.com/listing/${l.listing_id}`,
      image_url: img ? (img.url_fullxfull || img.url_570xN || img.url_340x270 || '') : '',
      price: l.price ? Number(l.price.amount) / divisor : null,
      currency: l.price ? l.price.currency_code || null : null,
      tags: Array.isArray(l.tags) ? l.tags : [],
      rank: i + 1
    };
  });
}

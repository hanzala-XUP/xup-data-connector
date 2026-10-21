// Everything the connector needs comes from environment variables (Railway → Variables).
// Secrets never live in the repo: see .env.example for the full list.

function parseStores(raw) {
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { throw new Error('STORES must be JSON, e.g. [{"id":"rtzn","name":"RTZN","shop":"rtzn-store.myshopify.com"}]'); }
  if (!Array.isArray(list)) throw new Error('STORES must be a JSON array');
  return list.map((s, i) => {
    if (!s || !s.shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(s.shop)) throw new Error(`STORES[${i}].shop must be a *.myshopify.com domain`);
    const id = String(s.id || s.name || s.shop.split('.')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { id, name: s.name || id, shop: s.shop, token: s.token || null, source: 'env' };
  });
}

export const config = {
  port: Number(process.env.PORT || 8080),
  // the secret that callers must present: in the connector URL path (/mcp/<key>) or as "Authorization: Bearer <key>"
  accessKey: process.env.ACCESS_KEY || '',
  mock: process.env.MOCK === '1',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10', // shopifyqlQuery needs 2025-10 or later
  // Dev Dashboard app installed on our stores (client credentials grant)
  clientId: process.env.SHOPIFY_CLIENT_ID || '',
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  stores: parseStores(process.env.STORES),
  // optional: reuse the per-brand tokens the xup-reports app already stores (its Brand table)
  reportsDatabaseUrl: process.env.REPORTS_DATABASE_URL || '',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 240)
};

export function assertConfig() {
  if (config.mock) return;
  if (config.accessKey.length < 32) throw new Error('ACCESS_KEY must be at least 32 characters (generate one with: openssl rand -hex 32)');
  if (!config.stores.length && !config.reportsDatabaseUrl) throw new Error('Set STORES and/or REPORTS_DATABASE_URL so the connector knows which stores to read');
}

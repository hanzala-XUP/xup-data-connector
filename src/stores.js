// The list of stores the connector can read: STORES from the environment, plus
// (optionally) every installed brand in the xup-reports database, which already
// holds a Shopify access token per brand. Environment entries win on conflicts.
import { config } from './config.js';
import { memo } from './cache.js';

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function storesFromReportsDb() {
  if (!config.reportsDatabaseUrl) return [];
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: config.reportsDatabaseUrl, ssl: config.reportsDatabaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT name, "shopDomain", "accessToken" FROM "Brand" WHERE installed = true AND "accessToken" IS NOT NULL ORDER BY name');
    return rows.map(r => ({ id: slug(r.name), name: r.name, shop: r.shopDomain, token: r.accessToken, source: 'reports-db' }));
  } finally { await client.end().catch(() => {}); }
}

export async function listStores() {
  if (config.mock) return [
    { id: 'demo-a', name: 'Demo Store A', shop: 'demo-a.myshopify.com', source: 'mock' },
    { id: 'demo-b', name: 'Demo Store B', shop: 'demo-b.myshopify.com', source: 'mock' }
  ];
  return memo('stores', 5 * 60e3, async () => {
    let fromDb = [];
    try { fromDb = await storesFromReportsDb(); }
    catch (e) { console.warn('reports database unavailable:', e.message); }
    const byShop = new Map();
    for (const s of [...fromDb, ...config.stores]) byShop.set(s.shop, { ...(byShop.get(s.shop) || {}), ...s, token: s.token || byShop.get(s.shop)?.token || null });
    return [...byShop.values()];
  });
}

// accept a store id, name or myshopify domain, case-insensitively
export async function findStore(ref) {
  const want = slug(ref), list = await listStores();
  const s = list.find(x => x.id === want || slug(x.name) === want || x.shop === String(ref).toLowerCase() || slug(x.shop.split('.')[0]) === want);
  if (!s) throw new Error(`Unknown store "${ref}". Known stores: ${list.map(x => x.id).join(', ') || 'none configured'}`);
  return s;
}

export const publicStore = s => ({ id: s.id, name: s.name, shop: s.shop });

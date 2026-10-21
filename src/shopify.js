// Read-only access to the GraphQL Admin API, one store at a time.
// Token order: the store's own token (env or reports DB), else the Dev Dashboard app's
// client credentials grant, which returns a token valid for ~24 hours that we refresh early.
import { config } from './config.js';
import { mockShopifyql } from './mock.js';

const tokens = new Map(); // shop -> { token, expiresAt, pending }

export class ShopifyError extends Error {
  constructor(message, { status, store } = {}) { super(message); this.status = status; this.store = store; }
}

async function clientCredentialsToken(shop) {
  if (!config.clientId || !config.clientSecret) throw new ShopifyError(`No access token for ${shop}: set its token, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET`, { store: shop });
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret })
  });
  if (!res.ok) throw new ShopifyError(`Token request for ${shop} failed (${res.status}). Is the X UP Data app installed on this store?`, { status: res.status, store: shop });
  const { access_token, expires_in } = await res.json();
  return { token: access_token, expiresAt: Date.now() + (Number(expires_in) || 86400) * 1000 };
}

async function tokenFor(store) {
  if (store.token) return store.token;
  const cur = tokens.get(store.shop);
  if (cur?.token && cur.expiresAt - Date.now() > 5 * 60e3) return cur.token;
  if (cur?.pending) return cur.pending;
  const pending = clientCredentialsToken(store.shop).then(t => { tokens.set(store.shop, t); return t.token; }, e => { tokens.delete(store.shop); throw e; });
  tokens.set(store.shop, { pending });
  return pending;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function graphql(store, query, variables = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await tokenFor(store);
    const res = await fetch(`https://${store.shop}/admin/api/${config.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables })
    });
    if (res.status === 401 && !store.token && attempt === 0) { tokens.delete(store.shop); continue; } // expired grant token: fetch a new one once
    if (res.status === 429 || res.status >= 500) { await sleep(800 * (attempt + 1)); continue; }
    if (!res.ok) throw new ShopifyError(`Shopify returned ${res.status} for ${store.name}`, { status: res.status, store: store.shop });
    const body = await res.json();
    if (body.errors?.some(e => e.extensions?.code === 'THROTTLED')) { await sleep(1000 * (attempt + 1)); continue; }
    if (body.errors?.length) throw new ShopifyError(`${store.name}: ${body.errors.map(e => e.message).join('; ')}`, { store: store.shop });
    return body.data;
  }
  throw new ShopifyError(`${store.name}: Shopify is busy, try again shortly`, { status: 429, store: store.shop });
}

const SHOPIFYQL = `query Q($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name dataType displayName } rows } parseErrors } }`;

// Runs one ShopifyQL query and returns rows as objects keyed by column name.
export async function shopifyql(store, q) {
  if (config.mock) return mockShopifyql(store, q);
  const data = await graphql(store, SHOPIFYQL, { q });
  const r = data?.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new ShopifyError(`ShopifyQL error: ${r.parseErrors.join('; ')}`, { store: store.shop });
  const cols = r?.tableData?.columns || [], names = cols.map(c => c.name);
  const rows = (r?.tableData?.rows || []).map(row => Array.isArray(row) ? Object.fromEntries(names.map((n, i) => [n, row[i]])) : row);
  return { columns: cols, rows };
}

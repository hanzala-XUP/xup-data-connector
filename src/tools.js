// The connector's tools. All are read-only: nothing here can change a store.
import { z } from 'zod';
import { listStores, findStore, publicStore } from './stores.js';
import { storeOverview, salesToday, salesByDay, funnel, topProducts, allStoresSummary } from './metrics.js';
import { shopifyql } from './shopify.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const store = z.string().min(1).describe('Store id, name or myshopify domain, as returned by list_stores');
const days = z.number().int().min(1).max(365).default(30).describe('Look-back window in days (1-365), ending today');

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const fail = e => ({ isError: true, content: [{ type: 'text', text: e?.message || String(e) }] });
const safe = fn => async args => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

export function registerTools(server) {
  server.registerTool('list_stores', {
    title: 'List stores',
    description: 'Every X UP Shopify store this connector can read, with the id to pass to the other tools.',
    inputSchema: {}, annotations: READ
  }, safe(async () => ({ stores: (await listStores()).map(publicStore) })));

  server.registerTool('all_stores_summary', {
    title: 'All stores summary',
    description: 'Sales and orders for every store side by side: today, the last N days, change vs the previous N days, and a company total. Stores that fail are listed under errors.',
    inputSchema: { days }, annotations: READ
  }, safe(({ days: d }) => allStoresSummary(d ?? 30)));

  server.registerTool('store_overview', {
    title: 'Store overview',
    description: "One store's headline numbers: today's sales and orders, the last N days with change vs the previous N days, average order value, sessions, conversion rate and returning customer rate.",
    inputSchema: { store, days }, annotations: READ
  }, safe(async ({ store: s, days: d }) => storeOverview(await findStore(s), d ?? 30)));

  server.registerTool('sales_today_by_hour', {
    title: 'Sales today by hour',
    description: "Today's sales and orders hour by hour, in the store's own time zone. Refreshes every minute.",
    inputSchema: { store }, annotations: READ
  }, safe(async ({ store: s }) => salesToday(await findStore(s))));

  server.registerTool('sales_by_day', {
    title: 'Sales by day',
    description: 'Daily sales and orders for the last N days.',
    inputSchema: { store, days }, annotations: READ
  }, safe(async ({ store: s, days: d }) => salesByDay(await findStore(s), d ?? 30)));

  server.registerTool('checkout_funnel', {
    title: 'Checkout funnel',
    description: 'Sessions, added to cart, reached checkout and purchased for the last N days, with conversion rate.',
    inputSchema: { store, days }, annotations: READ
  }, safe(async ({ store: s, days: d }) => funnel(await findStore(s), d ?? 30)));

  server.registerTool('top_products', {
    title: 'Top products',
    description: 'Best-selling products by net sales for the last N days.',
    inputSchema: { store, days, limit: z.number().int().min(1).max(25).default(5).describe('How many products (1-25)') }, annotations: READ
  }, safe(async ({ store: s, days: d, limit }) => topProducts(await findStore(s), d ?? 30, limit ?? 5)));

  server.registerTool('run_shopifyql', {
    title: 'Run a ShopifyQL query',
    description: 'Advanced: run any read-only ShopifyQL query (FROM ... SHOW ...) on one store and get columns and rows back. Use the other tools first; this is for questions they do not cover.',
    inputSchema: { store, query: z.string().min(10).max(2000).describe('ShopifyQL, e.g. FROM sales SHOW total_sales GROUP BY order_referrer_source SINCE -7d UNTIL today') }, annotations: READ
  }, safe(async ({ store: s, query }) => {
    if (!/^\s*FROM\s+\w+\s+SHOW\s/i.test(query)) throw new Error('Query must start with FROM <dataset> SHOW <metrics>');
    const st = await findStore(s);
    return { store: publicStore(st), ...(await shopifyql(st, query)) };
  }));
}

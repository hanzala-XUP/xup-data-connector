// The questions the Agent Office (and agents) ask, each answered with ShopifyQL.
// "today" is the store's own day in its own time zone.
import { shopifyql } from './shopify.js';
import { memo } from './cache.js';
import { listStores, publicStore } from './stores.js';

const TODAY_TTL = 60e3, PERIOD_TTL = 5 * 60e3;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
const change = (now, prev) => prev ? round2((now - prev) / prev * 100) : null;
const q = (store, query, ttl) => memo(`${store.shop}|${query}`, ttl, () => shopifyql(store, query));
const range = days => `SINCE -${days}d UNTIL today`;

export async function salesToday(store) {
  const { rows } = await q(store, 'FROM sales SHOW total_sales, orders TIMESERIES hour SINCE today UNTIL today', TODAY_TTL);
  const hours = rows.map(r => ({ hour: r.hour, sales: round2(num(r.total_sales)), orders: num(r.orders) }));
  return { store: publicStore(store), sales: round2(hours.reduce((s, h) => s + h.sales, 0)), orders: hours.reduce((s, h) => s + h.orders, 0), hours };
}

export async function periodSummary(store, days) {
  const { rows } = await q(store, `FROM sales SHOW total_sales, orders, average_order_value ${range(days)} COMPARE TO previous_period`, PERIOD_TTL);
  const r = rows[0] || {};
  const sales = num(r.total_sales), orders = num(r.orders), aov = num(r.average_order_value);
  const pSales = num(r.comparison_total_sales__previous_period), pOrders = num(r.comparison_orders__previous_period), pAov = num(r.comparison_average_order_value__previous_period);
  return { days, sales: round2(sales), orders, aov: round2(aov),
    previous: { sales: round2(pSales), orders: pOrders, aov: round2(pAov) },
    changePct: { sales: change(sales, pSales), orders: change(orders, pOrders), aov: change(aov, pAov) } };
}

export async function funnel(store, days) {
  const { rows } = await q(store, `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate ${range(days)}`, PERIOD_TTL);
  const r = rows[0] || {}, sessions = num(r.sessions);
  const step = (label, v) => ({ label, sessions: v, pctOfSessions: sessions ? round2(v / sessions * 100) : 0 });
  return { store: publicStore(store), days, conversionRatePct: round2(num(r.conversion_rate) * 100),
    steps: [step('Sessions', sessions), step('Added to cart', num(r.sessions_with_cart_additions)), step('Reached checkout', num(r.sessions_that_reached_checkout)), step('Purchased', num(r.sessions_that_completed_checkout))] };
}

export async function returningRate(store, days) {
  const { rows } = await q(store, `FROM sales SHOW returning_customer_rate ${range(days)}`, PERIOD_TTL);
  return round2(num(rows[0]?.returning_customer_rate) * 100);
}

export async function salesByDay(store, days) {
  const { rows } = await q(store, `FROM sales SHOW total_sales, orders TIMESERIES day ${range(days)}`, PERIOD_TTL);
  return { store: publicStore(store), days, series: rows.map(r => ({ day: r.day, sales: round2(num(r.total_sales)), orders: num(r.orders) })) };
}

export async function topProducts(store, days, limit) {
  const { rows } = await q(store, `FROM sales SHOW net_sales, orders GROUP BY product_title ${range(days)} ORDER BY net_sales DESC LIMIT ${limit}`, PERIOD_TTL);
  return { store: publicStore(store), days, products: rows.map(r => ({ title: r.product_title, netSales: round2(num(r.net_sales)), orders: num(r.orders) })) };
}

// one store, everything the dashboard's headline needs; a failing part is reported, not fatal
export async function storeOverview(store, days) {
  const parts = await Promise.allSettled([salesToday(store), periodSummary(store, days), funnel(store, days), returningRate(store, days)]);
  const [t, p, f, rr] = parts.map(x => x.status === 'fulfilled' ? x.value : null);
  const errors = parts.map((x, i) => x.status === 'rejected' ? `${['today', 'period', 'funnel', 'returning'][i]}: ${x.reason?.message || x.reason}` : null).filter(Boolean);
  return { store: publicStore(store), generatedAt: new Date().toISOString(),
    today: t && { sales: t.sales, orders: t.orders },
    period: p, conversionRatePct: f?.conversionRatePct ?? null, sessions: f?.steps[0].sessions ?? null,
    returningCustomerRatePct: rr, errors };
}

// every store side by side plus a company total; stores that fail are listed under errors
export async function allStoresSummary(days) {
  const stores = await listStores();
  const results = await Promise.allSettled(stores.map(async s => ({ s, t: await salesToday(s), p: await periodSummary(s, days) })));
  const rows = [], errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push({ store: publicStore(r.value.s), today: { sales: r.value.t.sales, orders: r.value.t.orders }, period: r.value.p });
    else errors.push({ store: publicStore(stores[i]), error: r.reason?.message || String(r.reason) });
  });
  rows.sort((a, b) => b.period.sales - a.period.sales);
  const sum = f => round2(rows.reduce((s, r) => s + f(r), 0));
  const totalSales = sum(r => r.period.sales), totalOrders = sum(r => r.period.orders), prevSales = sum(r => r.period.previous.sales);
  return { generatedAt: new Date().toISOString(), days,
    total: { todaySales: sum(r => r.today.sales), todayOrders: sum(r => r.today.orders), sales: totalSales, orders: totalOrders,
      aov: totalOrders ? round2(totalSales / totalOrders) : 0, previousSales: prevSales, salesChangePct: change(totalSales, prevSales) },
    stores: rows, errors };
}

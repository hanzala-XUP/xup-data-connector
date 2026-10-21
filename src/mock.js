// MOCK=1: made-up numbers in the exact shapes Shopify returns, so the connector and
// anything built on it can be tested without store credentials. Never real data.
function seeded(seedText) { let h = 7; for (const c of seedText) h = (h * 31 + c.charCodeAt(0)) % 2147483647; return () => (h = (h * 16807) % 2147483647) / 2147483647; }
const col = (name, dataType) => ({ name, dataType, displayName: name });
const fmt = n => n.toFixed(2);

export function mockShopifyql(store, q) {
  const r = seeded(store.id + q), base = store.id === 'demo-a' ? 3200 : 1400;
  if (/TIMESERIES hour/.test(q)) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { columns: [col('hour', 'HOUR_TIMESTAMP'), col('total_sales', 'MONEY'), col('orders', 'INTEGER')],
      rows: Array.from({ length: 24 }, (_, i) => { const past = i <= new Date().getHours(), s = past ? base / 24 * (0.4 + r() * 1.4) : 0;
        return { hour: new Date(+start + i * 3600e3).toISOString(), total_sales: fmt(s), orders: String(Math.round(s / 30)) }; }) };
  }
  if (/TIMESERIES day/.test(q)) {
    const days = Number((q.match(/SINCE -(\d+)d/) || [])[1] || 30);
    return { columns: [col('day', 'DAY_TIMESTAMP'), col('total_sales', 'MONEY'), col('orders', 'INTEGER')],
      rows: Array.from({ length: days + 1 }, (_, i) => { const d = new Date(Date.now() - (days - i) * 864e5), s = base * (0.7 + r() * 0.6);
        return { day: d.toISOString().slice(0, 10), total_sales: fmt(s), orders: String(Math.round(s / 30)) }; }) };
  }
  if (/GROUP BY product_title/.test(q)) {
    const limit = Number((q.match(/LIMIT (\d+)/) || [])[1] || 5);
    return { columns: [col('product_title', 'STRING'), col('net_sales', 'MONEY'), col('orders', 'INTEGER')],
      rows: Array.from({ length: limit }, (_, i) => ({ product_title: `Demo Product ${String.fromCharCode(65 + i)}`, net_sales: fmt(base * 6 / (i + 1)), orders: String(Math.round(base / 5 / (i + 1))) })) };
  }
  if (/FROM sessions/.test(q)) {
    const s = Math.round(base * 14 * (0.9 + r() * 0.2));
    return { columns: ['sessions', 'sessions_with_cart_additions', 'sessions_that_reached_checkout', 'sessions_that_completed_checkout', 'conversion_rate'].map(n => col(n, n === 'conversion_rate' ? 'PERCENT' : 'INTEGER')),
      rows: [{ sessions: String(s), sessions_with_cart_additions: String(Math.round(s * 0.11)), sessions_that_reached_checkout: String(Math.round(s * 0.08)), sessions_that_completed_checkout: String(Math.round(s * 0.05)), conversion_rate: '0.05' }] };
  }
  if (/returning_customer_rate/.test(q)) return { columns: [col('returning_customer_rate', 'PERCENT')], rows: [{ returning_customer_rate: '0.12' }] };
  if (/COMPARE TO previous_period/.test(q)) {
    const t = base * 30, o = Math.round(t / 30);
    return { columns: ['total_sales', 'orders', 'average_order_value', 'comparison_total_sales__previous_period', 'comparison_orders__previous_period', 'comparison_average_order_value__previous_period'].map(n => col(n, 'MONEY')),
      rows: [{ total_sales: fmt(t), orders: String(o), average_order_value: fmt(t / o), comparison_total_sales__previous_period: fmt(t * 0.9), comparison_orders__previous_period: String(Math.round(o * 0.92)), comparison_average_order_value__previous_period: fmt(t / o * 0.98) }] };
  }
  if (/SINCE today/.test(q)) return { columns: [col('total_sales', 'MONEY'), col('orders', 'INTEGER')], rows: [{ total_sales: fmt(base * 0.6), orders: String(Math.round(base * 0.02)) }] };
  return { columns: [col('value', 'NUMBER')], rows: [{ value: '1' }] };
}

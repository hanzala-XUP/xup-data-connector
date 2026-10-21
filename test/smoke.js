// End-to-end check on mock data: start the server, connect as an MCP client the way
// claude.ai does, call every tool, and confirm the key check works. No store credentials needed.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = 8800 + Math.floor(Math.random() * 100), KEY = 'test-key-test-key-test-key-test-0001';
const proc = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, MOCK: '1', ACCESS_KEY: KEY, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { proc.stdout.on('data', d => String(d).includes('listening') && resolve()); proc.on('exit', c => reject(new Error('server exited ' + c))); });

let failed = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++; };
try {
  const health = await (await fetch(`http://localhost:${PORT}/health`)).json();
  check('health endpoint', health.ok === true);
  const bad = await fetch(`http://localhost:${PORT}/mcp/wrong-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('wrong key is refused', bad.status === 401);

  const client = new Client({ name: 'smoke', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp/${KEY}`)));
  const { tools } = await client.listTools();
  check('lists 8 tools', tools.length === 8, tools.map(t => t.name).join(', '));
  check('all tools are read-only', tools.every(t => t.annotations?.readOnlyHint === true));

  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content?.[0]?.text); return r.structuredContent; };
  const stores = await call('list_stores');
  check('list_stores', stores.stores.length === 2);
  const all = await call('all_stores_summary', { days: 30 });
  check('all_stores_summary', all.stores.length === 2 && all.total.sales > 0 && all.errors.length === 0, `total $${all.total.sales}`);
  const ov = await call('store_overview', { store: 'Demo Store A' });
  check('store_overview by name', ov.store.id === 'demo-a' && ov.period.sales > 0 && ov.conversionRatePct > 0 && ov.errors.length === 0);
  const today = await call('sales_today_by_hour', { store: 'demo-a' });
  check('sales_today_by_hour', today.hours.length === 24);
  const daily = await call('sales_by_day', { store: 'demo-b', days: 14 });
  check('sales_by_day', daily.series.length === 15);
  const fn = await call('checkout_funnel', { store: 'demo-b.myshopify.com' });
  check('checkout_funnel by domain', fn.steps.length === 4 && fn.steps[0].pctOfSessions === 100);
  const top = await call('top_products', { store: 'demo-a', limit: 3 });
  check('top_products', top.products.length === 3);
  const raw = await call('run_shopifyql', { store: 'demo-a', query: 'FROM sales SHOW total_sales SINCE today UNTIL today' });
  check('run_shopifyql', raw.rows.length === 1);
  const r1 = await client.callTool({ name: 'run_shopifyql', arguments: { store: 'demo-a', query: 'DELETE everything please' } });
  check('run_shopifyql rejects non-ShopifyQL', r1.isError === true);
  const r2 = await client.callTool({ name: 'store_overview', arguments: { store: 'nope' } });
  check('unknown store gives a clear error', r2.isError === true && /Known stores/.test(r2.content[0].text));
  await client.close();
} catch (e) { check('unexpected error', false, e.message); }
finally { proc.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);

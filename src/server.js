// X UP Data: an MCP server (Streamable HTTP, stateless) that claude.ai adds as a custom connector.
//   POST /mcp/<ACCESS_KEY>    the connector URL to paste into claude.ai
//   POST /mcp + "Authorization: Bearer <ACCESS_KEY>"   for scripts and scheduled jobs
//   GET  /health              for Railway's health check (no data)
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config, assertConfig } from './config.js';
import { registerTools } from './tools.js';

assertConfig();

function keyMatches(given) {
  if (!given || !config.accessKey) return false;
  const a = Buffer.from(given), b = Buffer.from(config.accessKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

// a simple per-IP budget so a leaked URL cannot hammer Shopify
const hits = new Map();
function allowed(ip) {
  const now = Date.now(), w = hits.get(ip) || { start: now, n: 0 };
  if (now - w.start > 60e3) { w.start = now; w.n = 0; }
  w.n++; hits.set(ip, w);
  return w.n <= config.rateLimitPerMinute;
}

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : undefined); } catch (e) { reject(e); } });
});

function buildServer() {
  const server = new McpServer({ name: 'xup-data', version: '0.1.0' }, {
    instructions: 'Live, read-only Shopify data for every X UP Brands store. Call list_stores first to get store ids. Money is in the store currency; "today" is the store\'s own day.'
  });
  registerTools(server);
  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true, mock: config.mock });

  const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!keyMatches(m[1] ? decodeURIComponent(m[1]) : bearer)) return send(res, 401, { error: 'unauthorized' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  if (!allowed(ip)) return send(res, 429, { error: 'too many requests' });
  if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }); // stateless: no SSE stream or sessions

  try {
    const body = await readBody(req);
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('mcp request failed:', e.message);
    if (!res.headersSent) send(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

httpServer.listen(config.port, () => console.log(`X UP Data listening on :${config.port}${config.mock ? ' (MOCK data)' : ''}`));

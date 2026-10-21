# X UP Data connector

One **read-only** connector for live Shopify data across every X UP brand. It runs on Railway, and claude.ai adds it as a custom connector named **X UP Data**. The Agent Office page, Claude chats, and the weekly CRO report tasks can then read all stores at once, with no more `switch-shop`.

Nothing in it can change a store. Every tool is read-only, and the Shopify app only gets read permissions.

## Tools

| Tool | What it answers |
|---|---|
| `list_stores` | Which stores the connector can read, and their ids |
| `all_stores_summary` | Every store side by side: today, the last N days, the change vs the previous N days, and a company total |
| `store_overview` | One store's sales today, sales/orders/AOV for N days, sessions, conversion rate and returning customers |
| `sales_today_by_hour` | Today's sales by hour, in the store's own time zone |
| `sales_by_day` | Daily sales and orders |
| `checkout_funnel` | Sessions → cart → checkout → purchased |
| `top_products` | Best sellers by net sales |
| `run_shopifyql` | Any read-only ShopifyQL query, for questions the others don't cover |

Results are cached for 60 seconds for "today" and 5 minutes for everything else, so many viewers make few calls to Shopify.

## Setup (about 1 hour, plus Shopify's approval time)

### 1. Create one Shopify app for all stores
1. Open the **Shopify Dev Dashboard** with the account that owns X UP's Shopify organization, then **Create app** → name it `X UP Data (read-only)`.
2. Give the app version the access scope **`read_reports`**, the only one the tools need.
3. Under **Protected customer data**, request **Level 2** access. Shopify requires it for analytics queries, and approval can take a few days, so **do this first**.
4. **Install the app on every store** in the organization.
5. In **App settings**, copy the **Client ID** and **Client secret**.

The connector swaps these for an access token for each store (Shopify's client credentials grant; tokens last about 24 hours and refresh automatically).

> Brands already installed in **xup-reports** can be read straight away with the tokens that app stores. Set `REPORTS_DATABASE_URL`, and check that its app has `read_reports` (its older API version did not support ShopifyQL).

### 2. Deploy on Railway
1. Create a new service from this folder in our Railway project. `railway.toml` sets the start command and the `/health` check.
2. Add these variables (see `.env.example`):
   - `ACCESS_KEY`: run `openssl rand -hex 32`
   - `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`
   - `STORES`: a JSON list, e.g. `[{"id":"rtzn","name":"RTZN","shop":"rtzn-store.myshopify.com"},{"id":"thera","name":"TheraCopper","shop":"theracopper-store.myshopify.com"}]`
   - optional: `REPORTS_DATABASE_URL`
3. Deploy. `https://<service>.up.railway.app/health` should return `{"ok":true}`.

### 3. Add it to claude.ai
**Settings → Connectors → Add custom connector** (an org admin can add it for everyone):
- Name: **X UP Data**. The Agent Office page looks for this exact name.
- URL: `https://<service>.up.railway.app/mcp/<ACCESS_KEY>`

Then ask Claude "list my X UP stores" to test it.

## Security
- The URL contains the access key. **Treat it like a password**: only org admins add it, and never paste it into chats, tickets or docs.
- To rotate the key, change `ACCESS_KEY` in Railway, then update the connector URL in claude.ai.
- There's a per-IP rate limit (`RATE_LIMIT_PER_MINUTE`), so a leaked URL can't hammer Shopify.
- **Next step:** replace the key-in-URL with a Google Workspace sign-in limited to `@xupbrands.com` (OAuth), so access follows each person's account.

## Local development
```bash
npm install
npm run dev     # mock data, key: local-dev-key-local-dev-key-0000
npm test        # end-to-end check on mock data
```
`MOCK=1` serves made-up numbers in Shopify's exact response shape, so no credentials are needed.

## Files
- `src/server.js` — HTTP + MCP endpoint, key check, rate limit
- `src/tools.js` — tool definitions
- `src/metrics.js` — the ShopifyQL behind each tool
- `src/shopify.js` — tokens and GraphQL Admin API calls
- `src/stores.js` — store list (env + optional xup-reports DB)
- `src/mock.js` — test data

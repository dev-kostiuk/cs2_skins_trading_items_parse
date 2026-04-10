# Items Parse — CS2 Skins Catalog Parser

> 🇺🇦 [Українська версія](README.uk.md)

Two daemons that collect the **catalog of all CS2 skins** from DMarket and WhiteMarket. This is not prices or offers — just the list of existing items (name, type, category, exterior). The catalog is then used by offer parsers as a queue — "which items to parse".

No API keys required — both sources are public.

---

## Installation

```bash
cd cs2_skins_trading_items_parse
npm install
cp .env.example .env   # edit if needed
```

## Run

```bash
# Via PM2 (recommended)
pm2 start items.config.cjs

# Or manually
node dmarket.js
node whitemarket.js
```

---

## How it works

### `dmarket.js` — DMarket catalog parser

**Source:** `https://api.dmarket.com/exchange/v1/market/items` (public API, no auth)

1. Fetches DMarket API with pagination (100 items per page)
2. For each item extracts: `name`, `exterior`, `category`, `item_type`, `inspect_url`
3. Writes to two databases:
   - `items.db` — general catalog (`INSERT OR IGNORE`)
   - `items_dmarket.db` — DMarket catalog with `offers_parsed=0` (queue for offers parser)
4. Iterates all pages until cursor ends
5. Sleeps `DMARKET_LOOP_SLEEP_MS` and starts over

**Speed:** ~100 items/request, 250ms between requests. Full cycle ~12,600 items in ~30 minutes.

### `whitemarket.js` — WhiteMarket catalog parser

**Source:** `https://s3.white.market/export/v1/prices/730.json` (public S3 file)

1. Downloads one large JSON file with all items (~27,000)
2. Parses `market_hash_name` → extracts `name`, `exterior`, `category`
3. Writes to `items.db` and `items_whitemarket.db` (with `offers_parsed=0`)
4. Sleeps `WHITEMARKET_LOOP_SLEEP_MS` (file updates rarely)

**Speed:** single request, ~27,000 items in a few seconds.

### `env.js` — Configuration

Reads `.env` file with hot-reload — re-reads on file change without daemon restart.

---

## .env parameters

### DMarket

| Parameter | Default | Description |
|-----------|---------|-------------|
| `DMARKET_URL` | `https://api.dmarket.com/exchange/v1/market/items` | API endpoint |
| `DMARKET_GAME_ID` | `a8db` | CS2 game ID on DMarket |
| `DMARKET_CURRENCY` | `USD` | Price currency |
| `DMARKET_LIMIT` | `100` | Items per page (max 100) |
| `DMARKET_MAX_PAGES` | `1000` | Max pages to fetch per cycle |
| `DMARKET_HTTP_MAX_RETRIES` | `8` | Max retries on 429/5xx/network errors |
| `DMARKET_PAGE_DELAY_MS` | `250` | Delay between page requests (ms) |
| `DMARKET_MAX_WAIT_MS` | `15000` | Max wait time for retry backoff (ms) |
| `DMARKET_FETCH_TOTAL_TIMEOUT_MS` | `30000` | Request timeout (ms) |
| `DMARKET_LOOP_SLEEP_MS` | `60000` | Sleep between full cycles (ms). Default: 1 min |
| `DMARKET_EMPTY_SLEEP_MS` | `300000` | Sleep when no data returned (ms). Default: 5 min |
| `DMARKET_ITEMS_DB_PATH` | `../database/items.db` | Path to general items DB |
| `DMARKET_ITEMS_DMARKET_DB_PATH` | `../database/items_dmarket.db` | Path to DMarket items DB |
| `DMARKET_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout |

### WhiteMarket

| Parameter | Default | Description |
|-----------|---------|-------------|
| `WHITEMARKET_URL` | `https://s3.white.market/export/v1/prices/730.json` | S3 JSON export URL |
| `WHITEMARKET_HTTP_MAX_RETRIES` | `8` | Max retries |
| `WHITEMARKET_MAX_WAIT_MS` | `15000` | Max retry backoff (ms) |
| `WHITEMARKET_FETCH_TOTAL_TIMEOUT_MS` | `60000` | Request timeout (ms) |
| `WHITEMARKET_LOOP_SLEEP_MS` | `3600000` | Sleep between cycles (ms). Default: 1 hour |
| `WHITEMARKET_EMPTY_SLEEP_MS` | `3600000` | Sleep when empty (ms) |
| `WHITEMARKET_ITEMS_DB_PATH` | `../database/items.db` | Path to general items DB |
| `WHITEMARKET_ITEMS_WHITEMARKET_DB_PATH` | `../database/items_whitemarket.db` | Path to WM items DB |
| `WHITEMARKET_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout |

---

## PM2 configuration

`items.config.cjs` defines two daemons:

| Daemon | Script | Description |
|--------|--------|-------------|
| `dmarket-items-daemon` | `dmarket.js` | DMarket catalog parser |
| `whitemarket-items-daemon` | `whitemarket.js` | WhiteMarket catalog parser |

```bash
pm2 start items.config.cjs          # Start both
pm2 restart dmarket-items-daemon     # Restart one
pm2 logs dmarket-items-daemon        # View logs
pm2 stop items.config.cjs           # Stop both
```

---

## Debugging

```bash
# Check daemon status
pm2 logs dmarket-items-daemon --lines 20

# Check how many items parsed
sqlite3 ../database/items_dmarket.db "SELECT COUNT(*) FROM items_dmarket;"

# Check parsing queue
sqlite3 ../database/items_dmarket.db "SELECT COUNT(*) as pending FROM items_dmarket WHERE offers_parsed=0;"

# Reset queue (force re-parse all offers)
sqlite3 ../database/items_dmarket.db "UPDATE items_dmarket SET offers_parsed=0;"

# Check for errors
pm2 logs dmarket-items-daemon --err --lines 50
```

---

## File structure

```
items_parse/
├── dmarket.js          # DMarket catalog daemon
├── whitemarket.js      # WhiteMarket catalog daemon
├── env.js              # Configuration with hot-reload
├── items.config.cjs    # PM2 ecosystem config
├── .env.example        # Environment template
├── package.json
├── README.md           # English
└── README.uk.md        # Ukrainian
```

---

## Dependencies

- `better-sqlite3` — SQLite driver
- `dotenv` — Environment variables

Requires initialized databases. See **[cs2_skins_trading_database](https://github.com/dev-kostiuk/cs2_skins_trading_database)** for schemas and setup:

```bash
# 1. Clone and init database first
git clone git@github.com:dev-kostiuk/cs2_skins_trading_database.git database
cd database && npm install
node items.js
node items_dmarket.js
node items_whitemarket.js
cd ..

# 2. Then clone and run items_parse
git clone git@github.com:dev-kostiuk/cs2_skins_trading_items_parse.git items_parse
cd cs2_skins_trading_items_parse && npm install
cp .env.example .env
pm2 start items.config.cjs
```

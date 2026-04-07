import Database from "better-sqlite3";
import { reloadEnvIfChanged, getDmarketEnv, assertDmarketEnv } from "./env.js";

function nowIso() {
    return new Date().toISOString();
}
function normalize(v) {
    return typeof v === "string" ? v.trim() : "";
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function applyPragmas(db, env) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("temp_store = MEMORY");
    db.pragma(`busy_timeout = ${env.BUSY_TIMEOUT_MS}`);
}

function buildUrl(env, cursor) {
    const u = new URL(env.URL);
    u.searchParams.set("gameId", env.GAME_ID);
    u.searchParams.set("currency", env.CURRENCY);
    u.searchParams.set("limit", String(env.LIMIT));
    if (cursor) u.searchParams.set("cursor", cursor);
    return u.toString();
}

async function fetchJsonWithRetry(env, url, attempt = 0) {
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), env.FETCH_TOTAL_TIMEOUT_MS);

        const res = await fetch(url, {
            headers: { accept: "application/json" },
            signal: ac.signal,
        });

        clearTimeout(t);

        if (res.ok) return res.json();

        const retryableStatus =
            res.status === 429 ||
            res.status === 500 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504;

        if (retryableStatus && attempt < env.HTTP_MAX_RETRIES) {
            const ra = res.headers.get("retry-after");
            let waitMs;

            if (ra && /^\d+$/.test(ra)) waitMs = Number(ra) * 1000;
            else waitMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);

            waitMs = Math.min(waitMs, env.MAX_WAIT_MS);
            console.warn("DMarket retry (status)", { status: res.status, attempt, waitMs });

            await sleep(waitMs);
            return fetchJsonWithRetry(env, url, attempt + 1);
        }

        const text = await res.text().catch(() => "");
        throw new Error(`Failed fetch ${url}. Status: ${res.status}. Body: ${text.slice(0, 500)}`);
    } catch (err) {
        const code = err?.cause?.code || err?.code || "";
        const msg = String(err?.message || "");

        const retryableNetwork =
            code === "UND_ERR_HEADERS_TIMEOUT" ||
            code === "UND_ERR_CONNECT_TIMEOUT" ||
            code === "UND_ERR_SOCKET" ||
            code === "ECONNRESET" ||
            code === "ETIMEDOUT" ||
            code === "EAI_AGAIN" ||
            msg.includes("fetch failed") ||
            msg.includes("aborted");

        if (retryableNetwork && attempt < env.HTTP_MAX_RETRIES) {
            let waitMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            waitMs = Math.min(waitMs, env.MAX_WAIT_MS);
            console.warn("DMarket retry (network)", { code, attempt, waitMs });
            await sleep(waitMs);
            return fetchJsonWithRetry(env, url, attempt + 1);
        }

        throw err;
    }
}

/**
 * Мапінг DMarket -> (item_type, name, category, exterior, inspect_url, steam_url)
 * category/exterior беремо з extra, якщо є
 */
function mapDmarketItem(obj) {
    const extra = obj?.extra || {};

    const name =
        normalize(extra?.name) ||
        normalize(obj?.title).replace(/\s*\([^)]*\)\s*$/, "").trim();

    const exterior = normalize(extra?.exterior) || "unknown";
    const category = normalize(extra?.categoryPath) || normalize(extra?.category) || "unknown";
    const item_type = normalize(extra?.itemType) || normalize(obj?.type) || "unknown";

    const inspect_url = normalize(extra?.inspectInGame) || null;
    const steam_url = normalize(extra?.viewAtSteam) || null;

    if (!name) return null;

    return { item_type, name, category, exterior, inspect_url, steam_url };
}

function openDbs(env) {
    const dbItems = new Database(env.ITEMS_DB_PATH);
    const dbDmarket = new Database(env.ITEMS_DMARKET_DB_PATH);
    applyPragmas(dbItems, env);
    applyPragmas(dbDmarket, env);

    // ВАЖЛИВО: таблиці вже існують, тому нічого не create-имо

    const insItems = dbItems.prepare(`
    INSERT OR IGNORE INTO items (item_type, name, category, exterior, inspect_url, steam_url)
    VALUES (@item_type, @name, @category, @exterior, @inspect_url, @steam_url)
  `);

    const insDmarket = dbDmarket.prepare(`
    INSERT OR IGNORE INTO items_dmarket (item_type, name, category, exterior, inspect_url, steam_url, offers_parsed)
    VALUES (@item_type, @name, @category, @exterior, @inspect_url, @steam_url, 0)
  `);

    const txItems = dbItems.transaction((rows) => {
        for (const r of rows) insItems.run(r);
    });

    const txDmarket = dbDmarket.transaction((rows) => {
        for (const r of rows) insDmarket.run(r);
    });

    return {
        dbItems,
        dbDmarket,
        insertItems: txItems,
        insertDmarket: txDmarket,
    };
}

async function runOnce(env, db) {
    const stats = {
        started_at: nowIso(),
        pages: 0,
        fetched: 0,
        invalid: 0,
        inserted_attempts: 0,
        ended_at: null,
        reason: null,
    };

    let cursor = null;
    let sawAny = false;

    for (let page = 0; page < env.MAX_PAGES; page++) {
        const url = buildUrl(env, cursor);
        const json = await fetchJsonWithRetry(env, url);

        const objects = Array.isArray(json?.objects) ? json.objects : [];
        const nextCursor =
            typeof json?.cursor === "string" && json.cursor.trim() ? json.cursor.trim() : null;

        stats.pages++;
        stats.fetched += objects.length;
        if (objects.length) sawAny = true;

        const rows = [];
        for (const obj of objects) {
            const mapped = mapDmarketItem(obj);
            if (!mapped) {
                stats.invalid++;
                continue;
            }
            rows.push(mapped);
        }

        if (rows.length) {
            // “перевірити чи є” = INSERT OR IGNORE по унікальному індексу
            db.insertItems(rows);
            db.insertDmarket(rows);
            stats.inserted_attempts += rows.length;
        }

        if (env.PAGE_DELAY_MS > 0) await sleep(env.PAGE_DELAY_MS);

        if (objects.length === 0) {
            stats.reason = "empty_objects";
            break;
        }
        if (!nextCursor || nextCursor === cursor) {
            stats.reason = "cursor_end_or_stuck";
            break;
        }
        cursor = nextCursor;
    }

    stats.ended_at = nowIso();
    return { stats, sawAny };
}

let shuttingDown = false;
process.on("SIGINT", () => (shuttingDown = true));
process.on("SIGTERM", () => (shuttingDown = true));

async function main() {
    console.log("dmarket daemon started", { at: nowIso() });

    let db = null;
    let last1 = "";
    let last2 = "";

    while (!shuttingDown) {
        const e0 = getDmarketEnv();
        reloadEnvIfChanged(e0.ENV_PATH);

        const env = getDmarketEnv();
        assertDmarketEnv(env);

        // reopen DBs if paths changed in env
        if (!db || env.ITEMS_DB_PATH !== last1 || env.ITEMS_DMARKET_DB_PATH !== last2) {
            try {
                db?.dbItems?.close();
            } catch {}
            try {
                db?.dbDmarket?.close();
            } catch {}

            db = openDbs(env);
            last1 = env.ITEMS_DB_PATH;
            last2 = env.ITEMS_DMARKET_DB_PATH;

            console.log("[db] opened", { items: last1, items_dmarket: last2 });
        }

        try {
            const { stats, sawAny } = await runOnce(env, db);
            console.log("runOnce done", stats);

            const sleepMs = sawAny ? env.LOOP_SLEEP_MS : env.EMPTY_SLEEP_MS;
            if (sleepMs > 0) await sleep(sleepMs);
        } catch (e) {
            console.error("runOnce fatal:", e?.stack || e);
            await sleep(Math.min(env.MAX_WAIT_MS, 15000));
        }
    }

    try {
        db?.dbItems?.close();
    } catch {}
    try {
        db?.dbDmarket?.close();
    } catch {}
    console.log("dmarket daemon stopped", { at: nowIso() });
}

main().catch((e) => {
    console.error("Fatal:", e?.stack || e);
    process.exitCode = 1;
});
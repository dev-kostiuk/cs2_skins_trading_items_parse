import Database from "better-sqlite3";
import { reloadEnvIfChanged, getWhitemarketEnv, assertWhitemarketEnv } from "./env.js";

function nowIso() { return new Date().toISOString(); }
function normalize(v) { return typeof v === "string" ? v.trim() : ""; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function applyPragmas(db, env) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("temp_store = MEMORY");
    db.pragma(`busy_timeout = ${env.BUSY_TIMEOUT_MS}`);
}

/**
 * White.market експортує JSON масив з S3:
 * https://s3.white.market/export/v1/prices/730.json
 * Кожен елемент: { market_hash_name, market_product_link, market_product_count, ... }
 */
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

        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < env.HTTP_MAX_RETRIES) {
            const ra = res.headers.get("retry-after");
            let waitMs = ra && /^\d+$/.test(ra)
                ? Number(ra) * 1000
                : 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            waitMs = Math.min(waitMs, env.MAX_WAIT_MS);
            console.warn("Whitemarket retry (status)", { status: res.status, attempt, waitMs });
            await sleep(waitMs);
            return fetchJsonWithRetry(env, url, attempt + 1);
        }

        const text = await res.text().catch(() => "");
        throw new Error(`Failed fetch ${url}. Status: ${res.status}. Body: ${text.slice(0, 500)}`);
    } catch (err) {
        const code = err?.cause?.code || err?.code || "";
        const msg = String(err?.message || "");
        const retryableNetwork =
            code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_CONNECT_TIMEOUT" ||
            code === "UND_ERR_SOCKET" || code === "ECONNRESET" || code === "ETIMEDOUT" ||
            code === "EAI_AGAIN" || msg.includes("fetch failed") || msg.includes("aborted");

        if (retryableNetwork && attempt < env.HTTP_MAX_RETRIES) {
            let waitMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            waitMs = Math.min(waitMs, env.MAX_WAIT_MS);
            console.warn("Whitemarket retry (network)", { code, attempt, waitMs });
            await sleep(waitMs);
            return fetchJsonWithRetry(env, url, attempt + 1);
        }
        throw err;
    }
}

/**
 * Парсимо market_hash_name -> { item_type, name, category, exterior }
 * Формат: "Type | Name (Exterior)" або просто "Name (Exterior)"
 */
function mapWhitemarketItem(raw) {
    const fullName = normalize(raw?.market_hash_name);
    if (!fullName) return null;

    // Витягуємо exterior з дужок в кінці
    const exteriorMatch = fullName.match(/\(([^)]+)\)\s*$/);
    const exterior = exteriorMatch ? normalize(exteriorMatch[1]) : "unknown";

    // Витягуємо name (без exterior)
    const nameWithoutExterior = fullName.replace(/\s*\([^)]*\)\s*$/, "").trim();

    // Якщо є " | " — перша частина це item_type, друга — name
    const pipeIdx = nameWithoutExterior.indexOf(" | ");
    let item_type, name;
    if (pipeIdx !== -1) {
        item_type = normalize(nameWithoutExterior.slice(0, pipeIdx));
        name = normalize(nameWithoutExterior.slice(pipeIdx + 3));
    } else {
        item_type = "unknown";
        name = nameWithoutExterior;
    }

    if (!name) return null;

    // category — беремо item_type як базу (можна розширити)
    const category = item_type !== "unknown" ? item_type : "unknown";

    return { item_type, name: nameWithoutExterior, category, exterior: exterior.toLowerCase(), inspect_url: null, steam_url: null };
}

function openDbs(env) {
    const dbItems = new Database(env.ITEMS_DB_PATH);
    const dbWhitemarket = new Database(env.ITEMS_WHITEMARKET_DB_PATH);
    applyPragmas(dbItems, env);
    applyPragmas(dbWhitemarket, env);

    const insItems = dbItems.prepare(`
        INSERT OR IGNORE INTO items (item_type, name, category, exterior, inspect_url, steam_url)
        VALUES (@item_type, @name, @category, @exterior, @inspect_url, @steam_url)
    `);

    const insWhitemarket = dbWhitemarket.prepare(`
        INSERT OR IGNORE INTO items_whitemarket (item_type, name, category, exterior, inspect_url, steam_url, offers_parsed)
        VALUES (@item_type, @name, @category, @exterior, @inspect_url, @steam_url, 0)
    `);

    const txItems = dbItems.transaction((rows) => { for (const r of rows) insItems.run(r); });
    const txWhitemarket = dbWhitemarket.transaction((rows) => { for (const r of rows) insWhitemarket.run(r); });

    return { dbItems, dbWhitemarket, insertItems: txItems, insertWhitemarket: txWhitemarket };
}

async function runOnce(env, db) {
    const stats = {
        started_at: nowIso(),
        fetched: 0,
        invalid: 0,
        inserted_attempts: 0,
        ended_at: null,
        reason: null,
    };

    const data = await fetchJsonWithRetry(env, env.URL);

    if (!Array.isArray(data)) {
        stats.reason = "unexpected_json_shape";
        stats.ended_at = nowIso();
        return { stats, sawAny: false };
    }

    stats.fetched = data.length;

    const BATCH_SIZE = 500;
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const slice = data.slice(i, i + BATCH_SIZE);
        const rows = [];

        for (const item of slice) {
            const mapped = mapWhitemarketItem(item);
            if (!mapped) { stats.invalid++; continue; }
            rows.push(mapped);
        }

        if (rows.length) {
            db.insertItems(rows);
            db.insertWhitemarket(rows);
            stats.inserted_attempts += rows.length;
        }
    }

    stats.reason = "done";
    stats.ended_at = nowIso();
    return { stats, sawAny: data.length > 0 };
}

let shuttingDown = false;
process.on("SIGINT", () => (shuttingDown = true));
process.on("SIGTERM", () => (shuttingDown = true));

async function main() {
    console.log("whitemarket daemon started", { at: nowIso() });

    let db = null;
    let last1 = "";
    let last2 = "";

    while (!shuttingDown) {
        const e0 = getWhitemarketEnv();
        reloadEnvIfChanged(e0.ENV_PATH);

        const env = getWhitemarketEnv();
        assertWhitemarketEnv(env);

        if (!db || env.ITEMS_DB_PATH !== last1 || env.ITEMS_WHITEMARKET_DB_PATH !== last2) {
            try { db?.dbItems?.close(); } catch {}
            try { db?.dbWhitemarket?.close(); } catch {}

            db = openDbs(env);
            last1 = env.ITEMS_DB_PATH;
            last2 = env.ITEMS_WHITEMARKET_DB_PATH;
            console.log("[db] opened", { items: last1, items_whitemarket: last2 });
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

    try { db?.dbItems?.close(); } catch {}
    try { db?.dbWhitemarket?.close(); } catch {}
    console.log("whitemarket daemon stopped", { at: nowIso() });
}

main().catch((e) => {
    console.error("Fatal:", e?.stack || e);
    process.exitCode = 1;
});

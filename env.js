import fs from "node:fs";
import dotenv from "dotenv";

let lastEnvMtime = 0;

export function reloadEnvIfChanged(envPath = ".env") {
    try {
        const stat = fs.statSync(envPath);
        if (stat.mtimeMs !== lastEnvMtime) {
            dotenv.config({ path: envPath, override: true });
            lastEnvMtime = stat.mtimeMs;
            console.log(`[env] reloaded ${envPath}`);
        }
    } catch {}
}

function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

/* ─── DMarket ─────────────────────────────────────────────── */

export function getDmarketEnv() {
    return {
        ENV_PATH: (process.env.DMARKET_ENV_PATH || ".env").trim(),

        URL: (process.env.DMARKET_URL || "").trim(),
        GAME_ID: (process.env.DMARKET_GAME_ID || "").trim(),
        CURRENCY: (process.env.DMARKET_CURRENCY || "").trim(),

        LIMIT: num(process.env.DMARKET_LIMIT, 100),
        MAX_PAGES: num(process.env.DMARKET_MAX_PAGES, 100000),

        HTTP_MAX_RETRIES: num(process.env.DMARKET_HTTP_MAX_RETRIES, 8),
        PAGE_DELAY_MS: num(process.env.DMARKET_PAGE_DELAY_MS, 250),
        MAX_WAIT_MS: num(process.env.DMARKET_MAX_WAIT_MS, 15000),
        FETCH_TOTAL_TIMEOUT_MS: num(process.env.DMARKET_FETCH_TOTAL_TIMEOUT_MS, 30000),

        LOOP_SLEEP_MS: num(process.env.DMARKET_LOOP_SLEEP_MS, 60000),
        EMPTY_SLEEP_MS: num(process.env.DMARKET_EMPTY_SLEEP_MS, 300000),

        ITEMS_DB_PATH: (process.env.DMARKET_ITEMS_DB_PATH || "../database/items.db").trim(),
        ITEMS_DMARKET_DB_PATH: (process.env.DMARKET_ITEMS_DMARKET_DB_PATH || "../database/items_dmarket.db").trim(),

        BUSY_TIMEOUT_MS: num(process.env.DMARKET_BUSY_TIMEOUT_MS, 5000),
    };
}

export function assertDmarketEnv(env) {
    if (!env.URL) throw new Error("DMARKET_URL is missing");
    if (!env.GAME_ID) throw new Error("DMARKET_GAME_ID is missing");
    if (!env.CURRENCY) throw new Error("DMARKET_CURRENCY is missing");
    if (!env.ITEMS_DB_PATH) throw new Error("DMARKET_ITEMS_DB_PATH is missing");
    if (!env.ITEMS_DMARKET_DB_PATH) throw new Error("DMARKET_ITEMS_DMARKET_DB_PATH is missing");
}

/* ─── Whitemarket ─────────────────────────────────────────── */

export function getWhitemarketEnv() {
    return {
        ENV_PATH: (process.env.WHITEMARKET_ENV_PATH || ".env").trim(),

        // S3 публічний JSON з усіма айтемами
        URL: (process.env.WHITEMARKET_URL || "https://s3.white.market/export/v1/prices/730.json").trim(),

        HTTP_MAX_RETRIES: num(process.env.WHITEMARKET_HTTP_MAX_RETRIES, 8),
        MAX_WAIT_MS: num(process.env.WHITEMARKET_MAX_WAIT_MS, 15000),
        FETCH_TOTAL_TIMEOUT_MS: num(process.env.WHITEMARKET_FETCH_TOTAL_TIMEOUT_MS, 60000),

        LOOP_SLEEP_MS: num(process.env.WHITEMARKET_LOOP_SLEEP_MS, 3600000),   // 1 год — файл рідко змінюється
        EMPTY_SLEEP_MS: num(process.env.WHITEMARKET_EMPTY_SLEEP_MS, 3600000),

        ITEMS_DB_PATH: (process.env.WHITEMARKET_ITEMS_DB_PATH || "../database/items.db").trim(),
        ITEMS_WHITEMARKET_DB_PATH: (process.env.WHITEMARKET_ITEMS_WHITEMARKET_DB_PATH || "../database/items_whitemarket.db").trim(),

        BUSY_TIMEOUT_MS: num(process.env.WHITEMARKET_BUSY_TIMEOUT_MS, 5000),
    };
}

export function assertWhitemarketEnv(env) {
    if (!env.URL) throw new Error("WHITEMARKET_URL is missing");
    if (!env.ITEMS_DB_PATH) throw new Error("WHITEMARKET_ITEMS_DB_PATH is missing");
    if (!env.ITEMS_WHITEMARKET_DB_PATH) throw new Error("WHITEMARKET_ITEMS_WHITEMARKET_DB_PATH is missing");
}

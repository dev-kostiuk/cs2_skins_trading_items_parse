# Items Parse — Парсер каталогу CS2 скінів

> 🇬🇧 [English version](README.md)

Два демони які збирають **каталог всіх CS2 скінів** з DMarket та WhiteMarket. Це не ціни і не оффери — просто список існуючих айтемів (назва, тип, категорія, exterior). Каталог потім використовується парсерами офферів як черга — "які айтеми парсити".

API ключі не потрібні — обидва джерела публічні.

---

## Встановлення

```bash
cd cs2_skins_trading_items_parse
npm install
cp .env.example .env   # відредагуй за потреби
```

## Запуск

```bash
# Через PM2 (рекомендовано)
pm2 start items.config.cjs

# Або вручну
node dmarket.js
node whitemarket.js
```

---

## Як працює

### `dmarket.js` — Парсер каталогу DMarket

**Джерело:** `https://api.dmarket.com/exchange/v1/market/items` (публічний API, без авторизації)

1. Запитує DMarket API з пагінацією (100 айтемів за сторінку)
2. Для кожного айтема витягує: `name`, `exterior`, `category`, `item_type`, `inspect_url`
3. Записує в дві БД:
   - `items.db` — загальний каталог (`INSERT OR IGNORE`)
   - `items_dmarket.db` — каталог DMarket з `offers_parsed=0` (черга для парсера офферів)
4. Проходить всі сторінки поки cursor не закінчиться
5. Спить `DMARKET_LOOP_SLEEP_MS` і починає заново

**Швидкість:** ~100 айтемів/запит, 250мс між запитами. Повний цикл ~12 600 айтемів за ~30 хвилин.

### `whitemarket.js` — Парсер каталогу WhiteMarket

**Джерело:** `https://s3.white.market/export/v1/prices/730.json` (публічний S3 файл)

1. Завантажує один великий JSON файл з усіма айтемами (~27 000)
2. Парсить `market_hash_name` → витягує `name`, `exterior`, `category`
3. Записує в `items.db` і `items_whitemarket.db` (з `offers_parsed=0`)
4. Спить `WHITEMARKET_LOOP_SLEEP_MS` (файл оновлюється рідко)

**Швидкість:** один запит, ~27 000 айтемів за кілька секунд.

### `env.js` — Конфігурація

Читає `.env` файл з hot-reload — перечитує при зміні файлу без перезапуску демона.

---

## Параметри .env

### DMarket

| Параметр | За замовч. | Опис |
|----------|-----------|------|
| `DMARKET_URL` | `https://api.dmarket.com/exchange/v1/market/items` | Ендпоінт API |
| `DMARKET_GAME_ID` | `a8db` | ID гри CS2 на DMarket |
| `DMARKET_CURRENCY` | `USD` | Валюта цін |
| `DMARKET_LIMIT` | `100` | Айтемів на сторінку (макс 100) |
| `DMARKET_MAX_PAGES` | `1000` | Макс сторінок за цикл |
| `DMARKET_HTTP_MAX_RETRIES` | `8` | Макс повторів при 429/5xx/мережевих помилках |
| `DMARKET_PAGE_DELAY_MS` | `250` | Затримка між запитами сторінок (мс) |
| `DMARKET_MAX_WAIT_MS` | `15000` | Макс час очікування при retry (мс) |
| `DMARKET_FETCH_TOTAL_TIMEOUT_MS` | `30000` | Таймаут запиту (мс) |
| `DMARKET_LOOP_SLEEP_MS` | `60000` | Пауза між повними циклами (мс). За замовч: 1 хв |
| `DMARKET_EMPTY_SLEEP_MS` | `300000` | Пауза коли немає даних (мс). За замовч: 5 хв |
| `DMARKET_ITEMS_DB_PATH` | `../database/items.db` | Шлях до загальної БД айтемів |
| `DMARKET_ITEMS_DMARKET_DB_PATH` | `../database/items_dmarket.db` | Шлях до БД DMarket айтемів |
| `DMARKET_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout |

### WhiteMarket

| Параметр | За замовч. | Опис |
|----------|-----------|------|
| `WHITEMARKET_URL` | `https://s3.white.market/export/v1/prices/730.json` | URL S3 JSON експорту |
| `WHITEMARKET_HTTP_MAX_RETRIES` | `8` | Макс повторів |
| `WHITEMARKET_MAX_WAIT_MS` | `15000` | Макс час retry (мс) |
| `WHITEMARKET_FETCH_TOTAL_TIMEOUT_MS` | `60000` | Таймаут запиту (мс) |
| `WHITEMARKET_LOOP_SLEEP_MS` | `3600000` | Пауза між циклами (мс). За замовч: 1 година |
| `WHITEMARKET_EMPTY_SLEEP_MS` | `3600000` | Пауза коли порожньо (мс) |
| `WHITEMARKET_ITEMS_DB_PATH` | `../database/items.db` | Шлях до загальної БД |
| `WHITEMARKET_ITEMS_WHITEMARKET_DB_PATH` | `../database/items_whitemarket.db` | Шлях до БД WM айтемів |
| `WHITEMARKET_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout |

---

## PM2 конфігурація

`items.config.cjs` визначає два демони:

| Демон | Скрипт | Опис |
|-------|--------|------|
| `dmarket-items-daemon` | `dmarket.js` | Парсер каталогу DMarket |
| `whitemarket-items-daemon` | `whitemarket.js` | Парсер каталогу WhiteMarket |

```bash
pm2 start items.config.cjs          # Запустити обидва
pm2 restart dmarket-items-daemon     # Перезапустити один
pm2 logs dmarket-items-daemon        # Переглянути логи
pm2 stop items.config.cjs           # Зупинити обидва
```

---

## Дебаг

```bash
# Статус демона
pm2 logs dmarket-items-daemon --lines 20

# Скільки айтемів спарсено
sqlite3 ../database/items_dmarket.db "SELECT COUNT(*) FROM items_dmarket;"

# Черга парсингу офферів
sqlite3 ../database/items_dmarket.db "SELECT COUNT(*) as pending FROM items_dmarket WHERE offers_parsed=0;"

# Скинути чергу (перепарсити всі оффери)
sqlite3 ../database/items_dmarket.db "UPDATE items_dmarket SET offers_parsed=0;"

# Перевірити помилки
pm2 logs dmarket-items-daemon --err --lines 50
```

---

## Структура файлів

```
items_parse/
├── dmarket.js          # Демон парсингу каталогу DMarket
├── whitemarket.js      # Демон парсингу каталогу WhiteMarket
├── env.js              # Конфігурація з hot-reload
├── items.config.cjs    # PM2 ecosystem конфіг
├── .env.example        # Шаблон змінних оточення
├── package.json
├── README.md           # English
└── README.uk.md        # Українська
```

---

## Залежності

- `better-sqlite3` — SQLite драйвер
- `dotenv` — Змінні оточення

Потребує ініціалізованих баз даних. Див. **[cs2_skins_trading_database](https://github.com/dev-kostiuk/cs2_skins_trading_database)** для схем та налаштування:

```bash
# 1. Спочатку клонуй та ініціалізуй базу даних
git clone git@github.com:dev-kostiuk/cs2_skins_trading_database.git database
cd database && npm install
node items.js
node items_dmarket.js
node items_whitemarket.js
cd ..

# 2. Потім клонуй та запусти items_parse
git clone git@github.com:dev-kostiuk/cs2_skins_trading_items_parse.git items_parse
cd cs2_skins_trading_items_parse && npm install
cp .env.example .env
pm2 start items.config.cjs
```

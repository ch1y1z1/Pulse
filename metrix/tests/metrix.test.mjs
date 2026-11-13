// Checks for Pulse for Metrix.Bar that run without the app: the registry entry
// matches the published file, the declared hosts match the README, and the
// Worker's symbol, search and formatting rules behave. Rendering and live
// quotes need Metrix.Bar itself (POST /v0/check, or the installed dashboard).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = new URL("../", import.meta.url);
const raw = readFileSync(new URL("pulse.bar", dir));
const source = raw.toString("utf8");
const index = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
const readme = readFileSync(new URL("README.md", dir), "utf8");

// The Worker module, with the host's globals stubbed and test hooks appended.
const script = /<script[^>]*><!\[CDATA\[([\s\S]*)\]\]><\/script>/.exec(source)[1];
const store = new Map();
globalThis.$metrix = { invalidate() {}, schedule() {}, openURL() {} };
// English names and strings, whatever this machine's locale.
Object.defineProperty(globalThis, "navigator", { value: { language: "en-US", languages: ["en-US"] }, configurable: true });
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const scratch = mkdtempSync(join(tmpdir(), "pulse-metrix-"));
const modulePath = join(scratch, "worker.mjs");
writeFileSync(
  modulePath,
  script +
    `\nexport { normalizeSymbol, parseWatchlist, marketOf, formatPrice, fold, yahooSymbol, searchCatalog, decodeYahoo, decodeBinance, decodeKlines, chartSession, chartData, staleDate, sparkline, detailView, fetchStocks, openAdd, setQuery };` +
    `\nexport function useCatalog(document) { catalog = buildIndex(document); }\n` +
    `\nexport function useQuote(q) { quotes = {[q.symbol]: q}; watchlist = [{symbol: q.symbol, invalid: false}]; selected = null; mode = "list"; }\n`,
);
const worker = await import(pathToFileURL(modulePath).href);
rmSync(scratch, { recursive: true, force: true });

test("the registry entry describes the published file", () => {
  assert.equal(index.schema_version, 1);
  assert.equal(index.dashboards.length, 1);
  const entry = index.dashboards[0];
  assert.equal(entry.file, "pulse.bar");
  assert.equal(entry.sha256, createHash("sha256").update(raw).digest("hex"), "rebuild index.json after editing pulse.bar");
  assert.equal(entry.version, /<bar [^>]*\bversion="([^"]+)"/.exec(source)[1]);
  assert.equal(entry.id, /<bar [^>]*\bid="([^"]+)"/.exec(source)[1]);
  assert.equal(entry.name, "Pulse for Metrix.Bar");
});

test("the dashboard contacts only the hosts the README names", () => {
  const origins = [...source.matchAll(/<network origin="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(origins, [
    "https://data-api.binance.vision",
    "https://query1.finance.yahoo.com",
    "https://www.pulseticker.app",
  ]);
  for (const origin of origins) assert.ok(readme.includes(new URL(origin).host), `README names ${origin}`);
  assert.doesNotMatch(source, /utm_|upsell|ctaMenu|openURL|Try free for 30 days|获取完整版|解锁完整版/);
  assert.doesNotMatch(index.dashboards[0].docs, /Pulse for Mac|30 days/);
});

test("tickers are written the way Yahoo and Binance spell them", () => {
  assert.equal(worker.normalizeSymbol(" aapl "), "AAPL");
  assert.equal(worker.normalizeSymbol("700.hk"), "0700.HK");
  assert.equal(worker.normalizeSymbol("600519.SH"), "600519.SS");
  assert.equal(worker.normalizeSymbol("btc/usdt"), "BTC/USDT");
  assert.equal(worker.normalizeSymbol("^gspc"), "^GSPC");
  assert.throws(() => worker.normalizeSymbol("Apple Inc"));
  assert.throws(() => worker.normalizeSymbol("https://example.com"));
});

test("the starting watchlist is ordered, deduplicated and capped", () => {
  const list = worker.parseWatchlist("AAPL, aapl，0700.HK; ??? BTC/USDT");
  assert.deepEqual(list.map((e) => e.symbol), ["AAPL", "0700.HK", "???", "BTC/USDT"]);
  assert.deepEqual(list.map((e) => e.invalid), [false, false, true, false]);
  const many = Array.from({ length: 40 }, (_, i) => `T${i}`).join(",");
  assert.equal(worker.parseWatchlist(many).length, 30);
});

test("markets come from the suffix, the index list or the pair", () => {
  assert.equal(worker.marketOf("0700.HK"), "hk");
  assert.equal(worker.marketOf("600519.SS"), "sh");
  assert.equal(worker.marketOf("7203.T"), "jp");
  assert.equal(worker.marketOf("^HSI"), "hk");
  assert.equal(worker.marketOf("ETH/USDT"), "crypto");
  assert.equal(worker.marketOf("GC=F"), "metal");
  assert.equal(worker.marketOf("BTC-USD"), "us");
  assert.equal(worker.marketOf("AAPL", "America/New_York"), "us");
});

test("prices keep each market's places without grouping", () => {
  assert.equal(worker.formatPrice(342.37, "us"), "342.37");
  assert.equal(worker.formatPrice(1453, "sh"), "1453.00");
  assert.equal(worker.formatPrice(2850, "jp"), "2850");
  assert.equal(worker.formatPrice(76053.5, "crypto"), "76053.50");
  assert.equal(worker.formatPrice(0.00000441, "crypto"), "0.00000441");
});

test("search folds case, width, accents and punctuation", () => {
  assert.equal(worker.fold("ＡＡＰＬ"), "aapl");
  assert.equal(worker.fold("BRK.B"), "brkb");
  assert.equal(worker.fold("Nestlé"), "nestle");
  assert.equal(worker.fold("腾讯 控股"), "腾讯控股");
});

test("catalog listings map to the tickers quotes are fetched under", () => {
  assert.equal(worker.yahooSymbol("hk", "700"), "0700.HK");
  assert.equal(worker.yahooSymbol("sh", "600519"), "600519.SS");
  assert.equal(worker.yahooSymbol("kq", "035720"), "035720.KQ");
  assert.equal(worker.yahooSymbol("two", "6488"), "6488.TWO");
  assert.equal(worker.yahooSymbol("us", "BRK-B"), "BRK-B");
});

test("search ranks exact over prefix over substring, then popularity", () => {
  worker.useCatalog({
    schema: 1,
    generatedAt: "2026-11-07T00:00:00Z",
    markets: ["us", "hk", "sh"],
    securities: [
      { m: "us", c: "AAPL", n: { en: "Apple Inc.", "zh-Hans": "苹果公司" }, p: 0.95 },
      { m: "us", c: "AAPU", n: { en: "Direxion Daily AAPL Bull 2X Shares" }, p: 0.2 },
      { m: "hk", c: "700", n: { en: "Tencent", "zh-Hans": "腾讯控股", "zh-Hant": "騰訊控股" }, p: 0.78 },
      { m: "us", c: "TCEHY", n: { en: "Tencent Holdings Ltd." }, p: 0.3 },
      { m: "sh", c: "600519", n: { "zh-Hans": "贵州茅台", en: "Kweichow Moutai Company" }, p: 0.73 },
    ],
    crypto: [{ b: "BTC", p: 0.8 }],
  });
  const symbols = (q) => worker.searchCatalog(q).map((r) => r.symbol);
  assert.deepEqual(symbols("aapl"), ["AAPL", "AAPU"]);
  assert.deepEqual(symbols("700"), ["0700.HK"]);
  assert.deepEqual(symbols("00700"), ["0700.HK"]);
  assert.deepEqual(symbols("tencent"), ["0700.HK", "TCEHY"]);
  assert.deepEqual(symbols("腾讯"), ["0700.HK"]);
  assert.deepEqual(symbols("騰訊"), ["0700.HK"]);
  assert.deepEqual(symbols("茅台"), ["600519.SS"]);
  assert.deepEqual(symbols("btc"), ["BTC/USDT"]);
  assert.deepEqual(symbols("spx"), ["^GSPC"]);
  // Two Latin letters match codes and name starts, never the middle of a name.
  assert.ok(!symbols("ai").includes("AAPU"));
  const [apple] = worker.searchCatalog("apple");
  assert.equal(apple.name, "Apple");
  const [bitcoin] = worker.searchCatalog("bitcoin");
  assert.equal(bitcoin.name, "Bitcoin");
});

const ms = s => Date.parse(s);
const session = (date, open = "14:30", close = "21:00") => [ms(`${date}T${open}:00Z`), ms(`${date}T${close}:00Z`)];
const bars = (date, count = 79, value = 100, open = "14:30") => Array.from({length: count}, (_, i) =>
  [ms(`${date}T${open}:00Z`) + i * 300000, value + i / 10]);
function quote(points, overrides = {}) {
  return {symbol: "AAPL", market: "us", source: "Yahoo Finance", price: 110, previousClose: 99,
    timestamp: ms("2026-11-13T14:30:00Z"), gmtoffset: -18000, timeZone: "America/New_York",
    periods: {regular: session("2026-11-13")}, tradingPeriods: [session("2026-11-12"), session("2026-11-13")],
    points, ...overrides};
}
function at(time, fn) {
  const now = Date.now;
  Date.now = () => ms(time);
  try { return fn(); } finally { Date.now = now; }
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...(tree.children || []).flatMap(nodes)];
}
function renderedChart(q, detail = true) {
  return nodes(worker.sparkline(q, "#00FF00", 150, detail)).find(n => n.type === "Chart")?.props;
}

// Yahoo's actual chart response nests regular history under meta.tradingPeriods.
function yahooHistory(points, ranges, {symbol = "AAPL", zone = "America/New_York", offset = -18000,
  current = session("2026-11-13"), timestamp = "2026-11-12T21:00:00Z", shape = "regular", root} = {}) {
  const history = ranges.map(([start, end]) => [{start: start / 1000, end: end / 1000}]);
  const meta = {symbol, regularMarketPrice: 110, regularMarketTime: ms(timestamp) / 1000,
    exchangeTimezoneName: zone, gmtoffset: offset,
    currentTradingPeriod: {regular: {start: current[0] / 1000, end: current[1] / 1000}}};
  if (shape !== "root") meta.tradingPeriods = shape === "array" ? history : {pre: [], regular: history, post: []};
  const result = {meta, timestamp: points.map(p => p[0] / 1000), indicators: {quote: [{close: points.map(p => p[1])}]}};
  if (root) result.tradingPeriods = {regular: root.map(([start, end]) => [{start: start / 1000, end: end / 1000}])};
  return worker.decodeYahoo(symbol, {ok: true, status: 200, text: JSON.stringify({chart: {result: [result]}})});
}

test("real Yahoo metadata keeps sparse history on its full session axis and takes priority over root", () => at("2026-11-13T14:00:00Z", () => {
  for (const shape of ["regular", "array", "root"]) {
    const ranges = [session("2026-11-12"), session("2026-11-13")];
    const q = yahooHistory(bars("2026-11-12", 2), ranges, {shape,
      root: shape === "root" ? ranges : [session("2026-11-12", "14:30", "14:35")]});
    assert.equal(q.tradingPeriods.length, 2);
    const chart = renderedChart(q);
    assert.deepEqual(chart.xDomain, [0, 78]);
    assert.deepEqual(chart.series[0].points.map(p => p.x), [0, 1]);
    assert.equal(chart.labels[0], "09:30");
    assert.equal(chart.labels.at(-1), "16:00");
  }
}));

test("decoded historical metadata honors early closes and sessions across DST", () => {
  const cases = [
    {now: "2026-11-30T13:00:00Z", date: "2026-11-27", open: "14:30", close: "18:00", slots: 42, end: "13:00"},
    {now: "2026-11-02T13:00:00Z", date: "2026-10-30", open: "13:30", close: "20:00", slots: 78, end: "16:00"},
  ];
  for (const c of cases) at(c.now, () => {
    const q = yahooHistory(bars(c.date, 2, 100, c.open), [session(c.date, c.open, c.close)], {
      current: session(c.now.slice(0, 10)), timestamp: `${c.date}T${c.close}:00Z`,
    });
    const chart = renderedChart(q);
    assert.equal(q.tradingPeriods.length, 1);
    assert.deepEqual(chart.xDomain, [0, c.slots]);
    assert.equal(chart.labels[0], "09:30");
    assert.equal(chart.labels.at(-1), c.end);
    assert.match(chart.series[0].points[0].label, new RegExp(`^${c.date} 09:30`));
  });
});

test("decoded HK history retains full bounds and collapses lunch", () => at("2026-11-13T01:00:00Z", () => {
  const q = yahooHistory([[ms("2026-11-12T03:55:00Z"), 100], [ms("2026-11-12T05:00:00Z"), 101]],
    [session("2026-11-12", "01:30", "08:00")], {symbol: "0700.HK", zone: "Asia/Hong_Kong", offset: 28800,
      current: session("2026-11-13", "01:30", "08:00"), timestamp: "2026-11-12T08:00:00Z"});
  assert.equal(q.tradingPeriods.length, 1);
  const chart = renderedChart(q);
  assert.deepEqual(chart.xDomain, [0, 66]);
  assert.equal(chart.labels[0], "09:30");
  assert.equal(chart.labels.at(-1), "16:00");
  assert.equal(chart.series[0].points[1].x - chart.series[0].points[0].x, 1);
}));

test("quote date and time use the exchange zone even when Beijing sees the same local date", () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = "Asia/Shanghai";
    at("2026-11-13T14:00:00Z", () => {
      const q = quote(bars("2026-11-11", 2), {timestamp: ms("2026-11-12T21:00:00Z")});
      assert.equal(worker.staleDate(q), "2026-11-12");
      const tree = JSON.stringify(worker.detailView(q, () => {}));
      assert.match(tree, /2026-11-12 16:00/);
      assert.match(tree, /Intraday · 2026-11-11/);
    });
    at("2026-11-02T13:00:00Z", () => {
      const q = quote(bars("2026-10-30", 2, 100, "13:30"), {timestamp: ms("2026-10-30T20:00:00Z")});
      assert.match(JSON.stringify(worker.detailView(q, () => {})), /2026-10-30 16:00/);
    });
    at("2026-11-14T00:30:00Z", () => {
      assert.equal(worker.staleDate(quote([], {timestamp: ms("2026-11-13T21:00:00Z")})), "");
    });
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("session caching reuses list/detail selection but expires for replacement quotes and exchange midnight", () => {
  let reads = 0;
  const points = bars("2026-11-13", 2);
  points.filter = function (...args) { reads++; return Array.prototype.filter.apply(this, args); };
  const q = quote(points);
  let first;
  at("2026-11-13T15:00:00Z", () => {
    first = worker.chartSession(q);
    worker.sparkline(q, "green", 30, false);
    worker.detailView(q, () => {});
    assert.strictEqual(worker.chartSession(q), first);
    assert.equal(reads, 1, "month history is scanned once across chart and title rendering");
    const replacement = quote(bars("2026-11-13", 3));
    assert.notStrictEqual(worker.chartSession(replacement), first);
    assert.equal(worker.chartData(replacement).points.length, 3);
  });
  at("2026-11-14T00:30:00Z", () => {
    assert.strictEqual(worker.chartSession(q), first, "host midnight is not exchange midnight");
  });
  at("2026-11-14T05:00:00Z", () => {
    const next = worker.chartSession(q);
    assert.notStrictEqual(next, first);
    assert.equal(reads, 2);
    assert.equal(next.baseline, null);
  });
});

test("pre-market renders all 79 previous-session points with their own date and axis", () => at("2026-11-13T13:58:00Z", () => {
  const q = quote(bars("2026-11-12"));
  const chart = renderedChart(q);
  assert.equal(chart.series[0].points.length, 79);
  assert.equal(chart.labels[0], "09:30");
  assert.equal(chart.labels.at(-1), "16:00");
  assert.match(chart.series[0].points[0].label, /^2026-11-12 /);
  assert.deepEqual(chart.referenceLines, []);
  assert.ok(chart.yDomain[0] > 99, "today's previous close must not stretch yesterday's domain");
  assert.match(JSON.stringify(worker.detailView(q, () => {})), /Intraday · 2026-11-12/);
  assert.match(JSON.stringify(worker.sparkline(q, "#00FF00", 30, false)), /2026-11-12/);
}));

test("today wins without stitching yesterday; one point renders a visible dot", () => at("2026-11-13T15:00:00Z", () => {
  for (const count of [1, 2, 7]) {
    const q = quote([...bars("2026-11-12"), ...bars("2026-11-13", count, 111)]);
    const chart = renderedChart(q);
    assert.equal(chart.series[0].points.length, count);
    assert.ok(chart.series[0].points.every(p => p.y >= 111));
    assert.equal(chart.dots, count === 1);
    assert.match(chart.series[0].points[0].label, /^2026-11-13 /);
    assert.equal(chart.referenceLines[0].value, 99);
  }
}));

test("null and zero current-day closes fall back through the actual Yahoo decoder", () => at("2026-11-13T15:00:00Z", () => {
  const points = [...bars("2026-11-12"), [ms("2026-11-13T14:30:00Z"), null], [ms("2026-11-13T14:35:00Z"), 0]];
  const body = {chart: {result: [{meta: {symbol: "AAPL", regularMarketPrice: 110, regularMarketTime: ms("2026-11-13T14:35:00Z") / 1000,
    previousClose: 99, chartPreviousClose: 50, exchangeTimezoneName: "America/New_York", gmtoffset: -18000,
    currentTradingPeriod: {regular: {start: session("2026-11-13")[0] / 1000, end: session("2026-11-13")[1] / 1000}}},
    timestamp: points.map(p => p[0] / 1000), indicators: {quote: [{close: points.map(p => p[1])}]}}]}};
  const q = worker.decodeYahoo("AAPL", {ok: true, status: 200, text: JSON.stringify(body)});
  assert.equal(q.previousClose, 99);
  assert.equal(renderedChart(q).series[0].points.length, 79);
  assert.equal(worker.chartData(q).date, "2026-11-12");
}));

test("weekends and long holidays select the latest populated day, not 24 hours ago", () => {
  for (const now of ["2026-11-15T12:00:00Z", "2026-11-23T13:00:00Z"]) at(now, () => {
    const q = quote([...bars("2026-11-11"), ...bars("2026-11-13")]);
    assert.equal(worker.chartData(q).date, "2026-11-13");
    assert.equal(renderedChart(q).series[0].points.length, 79);
  });
});

test("exchange dates cross reader midnight correctly and historical axes honor DST", () => {
  at("2026-11-14T00:30:00Z", () => {
    const q = quote([...bars("2026-11-12"), ...bars("2026-11-13")]);
    assert.equal(worker.chartData(q).date, "2026-11-13");
  });
  at("2026-11-02T13:00:00Z", () => {
    const q = quote(bars("2026-10-30", 79, 100, "13:30"), {
      periods: {regular: session("2026-11-02")}, tradingPeriods: [session("2026-10-30", "13:30", "20:00")],
    });
    const chart = renderedChart(q);
    assert.equal(chart.labels[0], "09:30");
    assert.equal(chart.labels.at(-1), "16:00");
  });
});

test("HK lunch collapses while both morning and afternoon bars survive", () => at("2026-11-13T09:00:00Z", () => {
  const q = quote([[ms("2026-11-13T03:55:00Z"), 100], [ms("2026-11-13T05:00:00Z"), 101]], {
    symbol: "0700.HK", market: "hk", timeZone: "Asia/Hong_Kong", gmtoffset: 28800,
    periods: {regular: session("2026-11-13", "01:30", "08:00")}, tradingPeriods: [],
  });
  const chart = renderedChart(q);
  assert.equal(chart.series[0].points.length, 2);
  assert.equal(chart.series[0].points[1].x - chart.series[0].points[0].x, 1);
}));

test("no valid points renders the empty state, and crypto retains all 96 rolling points", () => at("2026-11-13T15:00:00Z", () => {
  const empty = quote([[ms("2026-11-12T14:30:00Z"), 0], [ms("2026-11-13T14:30:00Z"), null]]);
  assert.equal(renderedChart(empty), undefined);
  assert.match(JSON.stringify(worker.sparkline(empty, "red", 150, true)), /No intraday data yet/);
  const q = quote(bars("2026-11-12", 96), {symbol: "BTC/USDT", market: "crypto", periods: null, gmtoffset: null});
  const chart = renderedChart(q);
  assert.equal(chart.series[0].points.length, 96);
  assert.equal(chart.referenceLines[0].value, 99);
  assert.match(JSON.stringify(worker.detailView(q, () => {})), /Last 24 hours/);
}));

test("Binance BASE/QUOTE decoding keeps all rolling 24-hour bars across dates", () => at("2026-11-13T15:00:00Z", () => {
  const response = value => ({ok: true, status: 200, text: JSON.stringify(value)});
  const q = worker.decodeBinance(["ETH/BTC"], response([{symbol: "ETHBTC", lastPrice: "0.03", prevClosePrice: "0.029",
    closeTime: ms("2026-11-13T15:00:00Z")}]))["ETH/BTC"];
  q.points = worker.decodeKlines(response(Array.from({length: 96}, (_, i) =>
    [ms("2026-11-12T15:00:00Z") + i * 900000, "0", "0", "0", String(0.03 + i / 100000)])));
  const chart = renderedChart(q);
  assert.equal(q.market, "crypto");
  assert.equal(chart.series[0].points.length, 96);
  assert.deepEqual(chart.xDomain, [0, 95]);
  assert.equal(chart.referenceLines[0].value, 0.029);
  assert.match(JSON.stringify(worker.detailView(q, () => {})), /Last 24 hours/);
}));

test("session boundaries exclude pre-market and future bars, retaining the exact close", () => at("2026-11-13T21:05:00Z", () => {
  const q = quote([...bars("2026-11-12"), [ms("2026-11-13T14:25:00Z"), 88],
    [ms("2026-11-13T21:00:00Z"), 111], [ms("2026-11-14T14:30:00Z"), 222]]);
  const chart = renderedChart(q);
  assert.equal(chart.series[0].points.length, 1);
  assert.equal(chart.series[0].points[0].y, 111);
  assert.equal(chart.series[0].points[0].x, 78);
  assert.equal(chart.dots, true);
}));

test("a stale quote timestamp cannot make today's previous close a historical baseline", () => at("2026-11-13T13:58:00Z", () => {
  const q = quote(bars("2026-11-12"), {timestamp: ms("2026-11-12T21:00:00Z"), previousClose: 999});
  const chart = renderedChart(q);
  assert.deepEqual(chart.referenceLines, []);
  assert.ok(chart.yDomain[1] < 110);
}));

test("fetch uses one multi-session request and rendered list/detail/search contain no promotion", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return {ok: false, status: 404, text: async () => "{}", headers: {get: () => null}};
  };
  try {
    await worker.fetchStocks(["AAPL"]);
    assert.equal(urls.length, 1);
    const url = new URL(urls[0]);
    assert.equal(url.searchParams.get("range"), "1mo");
    assert.equal(url.searchParams.get("interval"), "5m");
    assert.equal(url.searchParams.get("includePrePost"), "false");
    worker.useQuote(quote(bars("2026-11-12")));
    const list = worker.default.render({inputs: {}});
    assert.equal(nodes(list.panel).find(n => n.type === "Chart").props.series[0].points.length, 79);
    nodes(list.panel).find(n => n.props?.key === "AAPL").props.onClick();
    const detail = worker.default.render({inputs: {}});
    assert.equal(nodes(detail.panel).find(n => n.type === "Chart").props.series[0].points.length, 79);
    const trees = [list, detail];
    worker.openAdd();
    worker.setQuery("aapl");
    const search = worker.default.render({inputs: {}});
    trees.push(search);
    assert.ok(nodes(search.panel).some(n => n.type === "TextInput"));
    assert.match(JSON.stringify(search), /Apple/);
    for (const tree of trees) {
      assert.doesNotMatch(JSON.stringify(tree, (_, v) => typeof v === "function" ? v.toString() : v), /Pulse for Mac|utm_|openURL|pulseticker\.app|免费试用|完整版|30 days/);
    }
  } finally { globalThis.fetch = originalFetch; }
});

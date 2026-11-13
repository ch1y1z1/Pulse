# Pulse for Metrix.Bar

A [Metrix.Bar](https://metrix.bar) stock and crypto watchlist in your menu bar.
This [fork](https://github.com/ch1y1z1/Pulse) of [fatwang2/Pulse](https://github.com/fatwang2/Pulse)
removes the promotional footer, detail card, menu item and tracking links, and
fixes charts before the market opens. It keeps the Pulse name, `id=pulse`,
MIT license and original attribution. Version 1.0.2 replaces 1.0.1.

Each ticker shows its price, change and a single trading day's line; click one
for its day: a chart, the open, high,
low and previous close, and whether its market is open. Stocks and indices
come from Yahoo Finance, crypto pairs (`BTC/USDT`) from Binance's public Spot
data.

## Install

Install [Metrix.Bar](https://metrix.bar/download) and open it once. Then run
this in Terminal, or open the link in your browser:

```sh
open "metrixbar://install/pulse?registry_url=https%3A%2F%2Fraw.githubusercontent.com%2Fch1y1z1%2FPulse%2Fmain%2Fmetrix%2Findex.json"
```

Metrix.Bar shows the hosts the dashboard contacts and its settings, and
installs it after you confirm. The link also adds this folder's
[`index.json`](index.json) as a dashboard source, so Metrix.Bar offers new
versions as they are published here.

An agent connected to Metrix.Bar's local API (its
[Agent Skill](https://metrix.bar/docs/agents)) can install
[`pulse.bar`](pulse.bar) for you instead. That copy is a local import and is
not offered updates.

Metrix.Bar's free plan holds a limited number of dashboards. If you are at the
limit, Pulse installs disabled until you remove one or upgrade.

## Use

- It starts with `AAPL`, `NVDA`, `^GSPC`, `0700.HK` and `BTC/USDT`. The first
  ticker is shown in the menu bar, or choose **Pulse icon only** in the
  dashboard's settings.
- **+** (or ⌘F) opens search: type a ticker or a company name in English,
  Chinese, Japanese or Korean (`AAPL`, `Tencent`, `腾讯`, `600519`, `7203`,
  `BTC`) and click **+**, or press Return for the top result. A full ticker
  the search doesn't know (`GC=F`, `ETH/BTC`) can be added as typed. With the
  field empty it lists your watchlist to reorder or remove.
- Right-click a row to move it to the top, up or down, or remove it.
- Click a ticker for its day; Esc goes back. ⌘R refreshes.
- Settings: **Starting watchlist** (editing it replaces the panel's list),
  **Menu bar** and **Up / down colors** (green up or red up).

Quotes refresh every minute. Stock prices are Yahoo's regular-session quotes;
exchange delays vary and are shown when Yahoo reports them. Crypto changes and
lines are 24-hour. A quote from an earlier exchange day carries its absolute
`YYYY-MM-DD` date; both its date and time use the exchange time zone (including
DST), independently of the reader's local date. The interface
is in English or Chinese, following your system language; names follow it
too where the catalog has them.

Stock charts request one month of five-minute regular-session bars in a single
Yahoo request per ticker per refresh. The exchange's calendar date and returned
session bounds select today's valid points; only when there are none does the
chart use the latest available earlier trading day, including across weekends
and holidays within that history window. Days are never stitched together. A
single point today is shown as a dot. Historical lines show an absolute
`YYYY-MM-DD` exchange date in the list and detail view; the chart date comes
from its points, independently of quote time. Empty history shows no chart.

Historical session bounds prefer Yahoo's `meta.tradingPeriods` (an array or
its `regular` array), with root-level `tradingPeriods` as a compatibility fallback.
Even sparse history uses those full session bounds, including early closes;
without bounds the axis spans that day's actual returned points. Session selection
is cached per quote object and exchange calendar day, reused by charts and titles;
refreshing a quote or crossing exchange midnight invalidates it. Exchange time zones account for DST,
and Hong Kong lunch remains collapsed. Quotes keep Yahoo's price and explicit
previous close; if Yahoo omits previous close, the last available close before
the quote's exchange day is used, which can differ from an official closing
auction price. The multi-day range's `chartPreviousClose` is not yesterday's
close and is not used. Historical charts omit the previous-close reference:
Yahoo may advance that field before its quote timestamp changes. Binance's
rolling 24-hour charts are unchanged.

The registry link installs this fork from its `main` branch.
A different registry can receive a different composite installation ID in
Metrix.Bar; check the installation sheet when switching sources.

## Privacy

The watchlist is saved in Metrix.Bar's storage for this dashboard on your
computer. Watching a ticker sends it to Yahoo Finance
(`query1.finance.yahoo.com`); watching a pair sends it to Binance
(`data-api.binance.vision`). Search runs on your computer over Pulse's symbol
catalog, downloaded from `www.pulseticker.app` when you first search (and at
start-up on a Chinese, Japanese or Korean system, for names) and at most once
a day after that; what you type is not sent anywhere. The dashboard contacts
no other host, reads no files and has no account or analytics. This fork has
no promotional browser links or tracking parameters. The symbol catalog's
website permission remains necessary for search.

## Development

```sh
node --test metrix/tests/*.test.mjs
```

The tests check that `index.json` matches `pulse.bar` (its SHA-256 and
version), the declared hosts, and the Worker's symbol rules, search ranking
and price formatting. Deterministic regression tests also execute the Worker
and assert rendered chart point counts, dates, axes, baselines, single-point
markers, crypto behavior, and promotion-free list/detail/search trees. Native
rendering and live quotes need Metrix.Bar: validate and preview a change with its local API (`POST /v0/validate` and
`POST /v0/check`), then rebuild the index:

```sh
curl -fsS https://metrix.bar/dashboards/build.js -o /tmp/build.js
mkdir -p /tmp/pulse-in && cp metrix/pulse.bar /tmp/pulse-in/
node /tmp/build.js --input /tmp/pulse-in --output /tmp/pulse-out --id pulse --name "Pulse"
cp /tmp/pulse-out/index.json metrix/index.json
```

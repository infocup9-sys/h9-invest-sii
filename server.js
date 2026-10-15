const yahooInstruments = {
  gold: { symbol: "GC=F", instrument: "Gold futures · USD per troy ounce" },
  oil: { symbol: "CL=F", instrument: "WTI crude futures · USD per barrel" },
  sp500: { symbol: "^GSPC", instrument: "S&P 500 index · index points" },
  nasdaq: { symbol: "^IXIC", instrument: "NASDAQ Composite · index points" },
  tesla: { symbol: "TSLA", instrument: "Tesla common stock · USD per share" },
  artificialIntelligence: { symbol: "AIQ", instrument: "Global X AI & Technology ETF · USD per share" },
};

let cachedQuotes = null;
let cachedAt = 0;
let refreshInFlight = null;
let cachedHistory = null;
let historyAt = 0;
let historyInFlight = null;

async function fetchJson(url, yahooRequest = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: yahooRequest
        ? { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; YouInvestMarket/1.0)", referer: "https://finance.yahoo.com/" }
        : { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function yahooQuote(key, asset) {
  const url = "https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(asset.symbol) + "?range=1d&interval=1m";
  const body = await fetchJson(url, true);
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const chartTime = result?.timestamp?.at(-1);
  const marketAt = Number(meta?.regularMarketTime || chartTime) * 1000;
  return {
    price,
    currency: key === "sp500" || key === "nasdaq" ? "" : "USD",
    unit: key === "sp500" || key === "nasdaq" ? "index points" : "",
    instrument: asset.instrument,
    symbol: asset.symbol,
    provider: "Yahoo Finance",
    marketAt: Number.isFinite(marketAt) ? marketAt : Date.now(),
  };
}

async function cryptoQuotes(now) {
  const body = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD");
  const result = body?.result;
  if (body?.error?.length || !result) return {};
  const quotes = {};
  for (const [key, ticker, instrument, symbol] of [
    ["bitcoin", "XXBTZUSD", "Bitcoin spot · USD per BTC", "BTC/USD"],
    ["ethereum", "XETHZUSD", "Ethereum spot · USD per ETH", "ETH/USD"],
  ]) {
    const price = Number(result[ticker]?.c?.[0]);
    if (!Number.isFinite(price) || price <= 0) continue;
    quotes[key] = {
      price, currency: "USD", unit: "", instrument, symbol,
      provider: "Kraken", marketAt: now,
    };
  }
  return quotes;
}

async function electricityQuote(now) {
  const start = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const end = new Date(now).toISOString();
  const params = new URLSearchParams({ bzn: "DE-LU", start, end });
  const body = await fetchJson("https://api.energy-charts.info/price?" + params);
  if (!Array.isArray(body?.unix_seconds) || !Array.isArray(body?.price)) return null;
  let latest = -1;
  for (let i = 0; i < body.unix_seconds.length; i += 1) {
    const timestamp = Number(body.unix_seconds[i]) * 1000;
    const price = Number(body.price[i]);
    if (Number.isFinite(timestamp) && timestamp <= now && Number.isFinite(price) && timestamp > latest) latest = timestamp;
  }
  if (latest < 0) return null;
  const index = body.unix_seconds.findIndex((timestamp) => Number(timestamp) * 1000 === latest);
  return {
    price: Number(body.price[index]),
    currency: "EUR",
    unit: "per MWh",
    instrument: "DE-LU day-ahead electricity · wholesale market",
    symbol: "DE-LU",
    provider: "Energy-Charts · Bundesnetzagentur",
    marketAt: latest,
  };
}


async function yahooHistory(asset) {
  const body = await fetchJson(
    "https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(asset.symbol) + "?range=1d&interval=1m",
    true,
  );
  const result = body?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = timestamps.flatMap((timestamp, index) => {
    const value = Number(closes[index]);
    return Number.isFinite(value) && value > 0
      ? [{ time: Number(timestamp) * 1000, value }]
      : [];
  });
  return points.filter((point, index) => index % 15 === 0 || index === points.length - 1);
}

function electricityHistory(body, since) {
  return (body?.unix_seconds || []).flatMap((seconds, index) => {
    const time = Number(seconds) * 1000;
    const value = Number(body.price[index]);
    return Number.isFinite(time) && time >= since * 1000 && Number.isFinite(value)
      ? [{ time, value }]
      : [];
  });
}

async function loadAssetHistory() {
  const now = Date.now();
  const since = Math.floor((now - 24 * 60 * 60 * 1000) / 1000);
  const electricityParams = new URLSearchParams({
    bzn: "DE-LU",
    start: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    end: new Date(now).toISOString(),
  });
  const [yahooEntries, bitcoinBody, ethereumBody, bitcoinYahoo, ethereumYahoo, electricityBody] = await Promise.all([
    Promise.all(Object.entries(yahooInstruments).map(async ([key, asset]) => [key, await yahooHistory(asset)])),
    fetchJson("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=30&since=" + since),
    fetchJson("https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=30&since=" + since),
    yahooHistory({ symbol: "BTC-USD" }),
    yahooHistory({ symbol: "ETH-USD" }),
    fetchJson("https://api.energy-charts.info/price?" + electricityParams),
  ]);
  const histories = Object.fromEntries(yahooEntries.filter(([, points]) => points.length));
  for (const [key, body, fallback] of [["bitcoin", bitcoinBody, bitcoinYahoo], ["ethereum", ethereumBody, ethereumYahoo]]) {
    const result = body?.result || {};
    const ticker = Object.keys(result).find((name) => name !== "last");
    const points = (ticker ? result[ticker] : []).flatMap((row) => {
      const value = Number(row[4]);
      return Number.isFinite(value) && value > 0 ? [{ time: Number(row[0]) * 1000, value }] : [];
    });
    const fallbackPoints = fallback.filter((point) => Number.isFinite(point.value) && point.value > 0);
    if (points.length) histories[key] = points;
    else if (fallbackPoints.length) histories[key] = fallbackPoints;
  }
  const electricity = electricityHistory(electricityBody, since);
  if (electricity.length) histories.electricity = electricity;
  return { histories, fetchedAt: Date.now() };
}

async function loadQuotes() {
  const now = Date.now();
  const [entries, crypto, electricity] = await Promise.all([
    Promise.all(Object.entries(yahooInstruments).map(async ([key, asset]) => [key, await yahooQuote(key, asset)])),
    cryptoQuotes(now),
    electricityQuote(now),
  ]);
  const quotes = Object.fromEntries(entries.filter(([, quote]) => quote));
  Object.assign(quotes, crypto);
  if (electricity) quotes.electricity = electricity;
  return { quotes, fetchedAt: Date.now() };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Not found", { status: 404 });
    if (url.pathname === "/api/asset-history") {
      if (cachedHistory && Date.now() - historyAt < 20_000) {
        return Response.json(cachedHistory, { headers: { "Cache-Control": "no-store" } });
      }
      if (!historyInFlight) {
        historyInFlight = loadAssetHistory().then((data) => {
          cachedHistory = data;
          historyAt = Date.now();
          return cachedHistory;
        }).finally(() => { historyInFlight = null; });
      }
      return Response.json(await historyInFlight, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname !== "/api/asset-prices") return new Response("Not found", { status: 404 });
    if (cachedQuotes && Date.now() - cachedAt < 60_000) {
      return Response.json(cachedQuotes, { headers: { "Cache-Control": "no-store" } });
    }
    if (!refreshInFlight) {
      refreshInFlight = loadQuotes().then((data) => {
        if (Object.keys(data.quotes).length) {
          cachedQuotes = {
            quotes: { ...(cachedQuotes?.quotes || {}), ...data.quotes },
            fetchedAt: data.fetchedAt,
          };
          cachedAt = Date.now();
        }
        return cachedQuotes || data;
      }).finally(() => { refreshInFlight = null; });
    }
    const data = await refreshInFlight;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  },
};

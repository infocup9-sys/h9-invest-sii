const CACHE_KEY = "h9-live-market-prices-v1";
const assetKeys = {
  Gold: "gold",
  Oil: "oil",
  Electricity: "electricity",
  "S&P 500": "sp500",
  NASDAQ: "nasdaq",
  Tesla: "tesla",
  "Artificial intelligence": "artificialIntelligence",
  Bitcoin: "bitcoin",
  Ethereum: "ethereum",
};

function readCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return saved?.quotes && typeof saved.quotes === "object" ? saved : { quotes: {}, fetchedAt: 0 };
  } catch {
    return { quotes: {}, fetchedAt: 0 };
  }
}

let marketCache = readCache();

export function getMarketQuote(assetName) {
  const key = assetKeys[assetName];
  return key ? marketCache.quotes[key] || null : null;
}

export async function refreshMarketQuotes() {
  try {
    const response = await fetch("/api/asset-prices", { cache: "no-store" });
    if (!response.ok) return marketCache.quotes;
    const data = await response.json();
    const nextQuotes = { ...marketCache.quotes };
    for (const [key, quote] of Object.entries(data?.quotes || {})) {
      const price = Number(quote?.price);
      const marketAt = Number(quote?.marketAt);
      if (Number.isFinite(price) && (key === 'electricity' || price > 0) && Number.isFinite(marketAt) && marketAt > 0) {
        nextQuotes[key] = { ...quote, price, marketAt };
      }
    }
    if (Object.keys(nextQuotes).length) {
      marketCache = { quotes: nextQuotes, fetchedAt: Number(data.fetchedAt) || Date.now() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(marketCache)); } catch {}
    }
  } catch {}
  return marketCache.quotes;
}

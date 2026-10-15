import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve tutti i file statici della cartella
app.use(express.static(__dirname));

// Credenziali admin iniziali (modificabili dinamicamente tramite API)
let adminCredentials = {
  email: "h9invest@gmail.com",
  password: "h9invest@gmail.com"
};

// Configurazione asset Yahoo Finance
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

async function fetchJson(url, yahooRequest = false) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: yahooRequest
        ? { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; YouInvestMarket/1.0)", referer: "https://finance.yahoo.com/" }
        : { accept: "application/json" },
    });
    return response.data;
  } catch {
    return null;
  }
}

async function yahooQuote(key, asset) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?range=1d&interval=1m`;
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
  const body = await fetchJson(`https://api.energy-charts.info/price?${params}`);
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

// Rotta API per i prezzi degli asset
app.get('/api/asset-prices', async (req, res) => {
  try {
    if (cachedQuotes && Date.now() - cachedAt < 60_000) {
      return res.setHeader("Cache-Control", "no-store").json(cachedQuotes);
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
    res.setHeader("Cache-Control", "no-store").json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch market data" });
  }
});

// Rotta di login sicura con supporto Admin globale
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (email === adminCredentials.email && password === adminCredentials.password) {
    return res.json({ 
      token: "admin-global-secure-token", 
      account: { email: adminCredentials.email, username: "Administrator", role: "admin" } 
    });
  }

  res.json({ 
    token: "live-token-session", 
    account: { email: email || "user@example.com", username: "User", role: "user" } 
  });
});

// Rotta protetta per aggiornare le credenziali dell'Admin dal pannello
app.put('/api/admin/credentials', (req, res) => {
  const { currentEmail, currentPassword, newEmail, newPassword } = req.body;

  // Verifica che le credenziali attuali siano corrette
  if (currentEmail === adminCredentials.email && currentPassword === adminCredentials.password) {
    if (newEmail) adminCredentials.email = newEmail;
    if (newPassword) adminCredentials.password = newPassword;
    return res.json({ success: true, message: "Admin credentials updated successfully" });
  }

  res.status(401).json({ success: false, message: "Invalid current admin credentials" });
});

app.get('/api/account', (req, res) => {
  res.json({ status: "active", balances: { deposit: 0, earnings: 0 } });
});

// Reindirizzamento universale per la Single Page Application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});

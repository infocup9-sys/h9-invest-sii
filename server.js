import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve tutti i file statici della cartella
app.use(express.static(__dirname));

// Percorso file per la persistenza dei dati
const DB_FILE = path.join(__dirname, 'database.json');

// Stato iniziale predefinito
let db = {
  adminCredentials: {
    email: "h9invest@gmail.com",
    password: "h9invest@gmail.com"
  },
  registeredUsers: {} // Oggetto per salvare gli utenti con le relative email
};

// Funzione per caricare i dati dal file JSON
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      console.log("Database caricato con successo.");
    } else {
      saveDatabase(); // Crea il file se non esiste
    }
  } catch (err) {
    console.error("Errore nel caricamento del database:", err);
  }
}

// Funzione per salvare i dati sul file JSON
function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Errore nel salvataggio del database:", err);
  }
}

// Carica il DB all'avvio del server
loadDatabase();

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

// Registrazione Utenti e Referral (Salvata in modo permanente)
app.post('/api/auth/register', (req, res) => {
  const { email, password, username, referredBy } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const cleanEmail = email.toLowerCase();

  if (cleanEmail === db.adminCredentials.email.toLowerCase()) {
    return res.status(403).json({ error: "This email address is reserved" });
  }

  db.registeredUsers[cleanEmail] = {
    email,
    password,
    username: username || "User",
    referredBy: referredBy || null,
    role: "user",
    createdAt: new Date().toISOString()
  };

  saveDatabase(); // Scrive sul file database.json
  res.json({ success: true, message: "User registered successfully" });
});

// Login Sicuro e Permanente
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const cleanEmail = email.toLowerCase();

  // Controllo credenziali Admin
  if (cleanEmail === db.adminCredentials.email.toLowerCase() && password === db.adminCredentials.password) {
    return res.json({ 
      token: "admin-global-secure-token", 
      account: { email: db.adminCredentials.email, username: "Administrator", role: "admin" } 
    });
  }

  // Controllo credenziali Utente normale
  const existingUser = db.registeredUsers[cleanEmail];
  if (existingUser && existingUser.password === password) {
    return res.json({ 
      token: `user-token-${Date.now()}`, 
      account: { email: existingUser.email, username: existingUser.username, role: "user", referredBy: existingUser.referredBy } 
    });
  }

  // Credenziali errate
  res.status(401).json({ error: "Invalid email or password" });
});

// Rotta per consentire all'Admin di vedere la lista degli utenti registrati e i referral
app.get('/api/admin/users', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes("admin-global-secure-token")) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  const usersList = Object.values(db.registeredUsers).map(u => ({
    email: u.email,
    username: u.username,
    referredBy: u.referredBy,
    createdAt: u.createdAt
  }));

  res.json({ users: usersList });
});

// Rotta protetta per aggiornare le credenziali Admin (Salvata su disco)
app.put('/api/admin/credentials', (req, res) => {
  const { currentEmail, currentPassword, newEmail, newPassword } = req.body || {};

  if (currentEmail?.toLowerCase() === db.adminCredentials.email.toLowerCase() && currentPassword === db.adminCredentials.password) {
    if (newEmail) db.adminCredentials.email = newEmail;
    if (newPassword) db.adminCredentials.password = newPassword;
    saveDatabase(); // Scrive le nuove credenziali sul file database.json
    return res.json({ success: true, message: "Admin credentials updated successfully" });
  }

  res.status(401).json({ success: false, message: "Invalid current admin credentials" });
});

app.get('/api/account', (req, res) => {
  res.json({ status: "active", balances: { deposit: 0, earnings: 0 } });
});

// Reindirizzamento universale per SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});

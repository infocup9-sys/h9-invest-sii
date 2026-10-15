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
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

let db = {
  adminCredentials: {
    email: "h9invest@gmail.com",
    password: "h9invest@gmail.com"
  },
  registeredUsers: {}
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.error("Errore DB:", err);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Errore salvataggio DB:", err);
  }
}

loadDatabase();

// Configurazione asset Yahoo Finance & mercati
const yahooInstruments = {
  gold: { symbol: "GC=F", instrument: "Gold futures" },
  oil: { symbol: "CL=F", instrument: "WTI crude futures" },
  sp500: { symbol: "^GSPC", instrument: "S&P 500 index" },
  nasdaq: { symbol: "^IXIC", instrument: "NASDAQ Composite" },
  tesla: { symbol: "TSLA", instrument: "Tesla stock" },
};

let cachedQuotes = null;
let cachedAt = 0;

async function fetchJson(url, yahooRequest = false) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: yahooRequest
        ? { accept: "application/json", "user-agent": "Mozilla/5.0", referer: "https://finance.yahoo.com/" }
        : { accept: "application/json" },
    });
    return response.data;
  } catch {
    return null;
  }
}

// API Prezzi Asset
app.get('/api/asset-prices', async (req, res) => {
  try {
    if (cachedQuotes && Date.now() - cachedAt < 60_000) {
      return res.json(cachedQuotes);
    }
    
    const quotes = {};
    for (const [key, asset] of Object.entries(yahooInstruments)) {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?range=1d&interval=1m`;
      const body = await fetchJson(url, true);
      const meta = body?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (Number.isFinite(price) && price > 0) {
        quotes[key] = { price, currency: "USD", instrument: asset.instrument, symbol: asset.symbol };
      }
    }

    cachedQuotes = { quotes, fetchedAt: Date.now() };
    cachedAt = Date.now();
    res.json(cachedQuotes);
  } catch (err) {
    res.json({ quotes: {} });
  }
});

// Registrazione Utenti
app.post('/api/auth/register', (req, res) => {
  const { email, password, username, referredBy } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Dati mancanti" });

  const cleanEmail = email.toLowerCase();
  if (cleanEmail === db.adminCredentials.email.toLowerCase()) {
    return res.status(403).json({ error: "Email riservata" });
  }

  db.registeredUsers[cleanEmail] = {
    email,
    password,
    username: username || "User",
    referredBy: referredBy || null,
    createdAt: new Date().toISOString()
  };
  saveDatabase();
  res.json({ success: true });
});

// Login (Admin o Utente)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(401).json({ error: "Credenziali non valide" });

  const cleanEmail = email.toLowerCase();
  if (cleanEmail === db.adminCredentials.email.toLowerCase() && password === db.adminCredentials.password) {
    return res.json({ token: "admin-global-secure-token", account: { email: db.adminCredentials.email, role: "admin" } });
  }

  const user = db.registeredUsers[cleanEmail];
  if (user && user.password === password) {
    return res.json({ token: `user-token-${Date.now()}`, account: { email: user.email, username: user.username, role: "user" } });
  }

  res.status(401).json({ error: "Credenziali errate" });
});

// Lista Utenti per Admin
app.get('/api/admin/users', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes("admin-global-secure-token")) {
    return res.status(401).json({ error: "Non autorizzato" });
  }
  res.json({ users: Object.values(db.registeredUsers) });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});

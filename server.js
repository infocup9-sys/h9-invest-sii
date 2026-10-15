const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve tutti i file statici presenti nella cartella principale (HTML, CSS, JS, immagini)
app.use(express.static(path.join(__dirname)));

// Rotte API di esempio conformi al backend
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  res.json({ token: "live-token-session", account: { email, username: "User" } });
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

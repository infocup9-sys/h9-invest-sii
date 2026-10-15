const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve i file statici del frontend (HTML, CSS, JS) dalla stessa cartella
app.use(express.static(path.join(__dirname)));

// Rotta di esempio per le API di autenticazione/stato
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  // Logica di esempio (da collegare a un database o persistenza)
  res.json({ token: "sample-token-123", account: { email, username: "User" } });
});

app.get('/api/account', (req, res) => {
  res.json({ status: "active", balance: 0 });
});

app.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});

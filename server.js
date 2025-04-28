/* ---------- IMPORT ---------- */
require('dotenv').config();
const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const cors         = require('cors');
const Database     = require('better-sqlite3');

/* ---------- CHATBOT CONFIG ---------- */
const CHATBOT_API_KEY = process.env.CHATBOT_API_KEY ;

/* ---------- APP ---------- */
const app  = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

// Configurazione CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

/* ---------- LOGIN ---------- */
app.post('/api/login', async (req, res) => {
  const ok = await bcrypt.compare(req.body.password || '', process.env.ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ error: 'Bad credentials' });

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.cookie('crmToken', token, {
    httpOnly: true,
    secure  : false,          // metti true in produzione HTTPS
    sameSite: 'Strict',
    maxAge  : 2 * 60 * 60 * 1000
  }).sendStatus(204);
});

/* ---------- LOGOUT ---------- */
app.post('/api/logout', (req, res) => {
  res.clearCookie('crmToken', { path: '/' }).sendStatus(204);
});

/* ---------- MIDDLEWARE ---------- */
function checkAuth(req, res, next) {
  try {
    const t = req.cookies.crmToken;
    jwt.verify(t, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.sendStatus(401);
  }
}

/* ---------- PAGINE HTML PROTETTE ---------- */
app.get(['/','/index.html','/knowledge.html'], checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public',
    req.path === '/' ? 'index.html' : req.path));
});

/* ---------- STATIC ---------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- API PROTETTE ---------- */
app.use('/api', checkAuth);

/* ---------- DATI ---------- */
const clientsPath = process.env.NODE_ENV === 'production' 
    ? path.join('/tmp', 'clients.json')
    : path.join(__dirname, 'data', 'clients.json');

const knowledgePath = process.env.NODE_ENV === 'production'
    ? path.join('/tmp', 'knowledge.json')
    : path.join(__dirname, 'data', 'knowledge.json');

// Assicuriamoci che i file esistano in produzione
if (process.env.NODE_ENV === 'production') {
    if (!fs.existsSync('/tmp')) {
        fs.mkdirSync('/tmp');
    }
    if (!fs.existsSync(clientsPath)) {
        fs.writeFileSync(clientsPath, '[]');
    }
    if (!fs.existsSync(knowledgePath)) {
        fs.writeFileSync(knowledgePath, '[]');
    }
}

let clienti   = [];
let knowledge = [];

try   { clienti   = JSON.parse(fs.readFileSync(clientsPath));   }
catch { console.error('⚠️ Errore clients.json'); }

try   { knowledge = JSON.parse(fs.readFileSync(knowledgePath)); }
catch { console.error('⚠️ Errore knowledge.json'); }

const save = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

/* ---------- SQLITE SETUP ---------- */
const db = new Database('crm.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_voiceflow TEXT UNIQUE,
  nome TEXT,
  numero TEXT,
  summary TEXT,
  data_modifica TEXT,
  conversazioni TEXT
);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT,
  nome TEXT,
  prezzo TEXT,
  consegna TEXT,
  descrizione TEXT,
  domande TEXT
);
`);

/* ---------- API CLIENTI  (restano uguali) ---------- */
app.get('/api/clients', (_ , res) => {
  const rows = db.prepare('SELECT * FROM clients').all();
  // Decodifica conversazioni da JSON
  rows.forEach(r => {
    r.conversazioni = r.conversazioni ? JSON.parse(r.conversazioni) : [];
  });
  res.json(rows);
});

app.get('/api/clients/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE id = ? OR id_voiceflow = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente non trovato' });
  row.conversazioni = row.conversazioni ? JSON.parse(row.conversazioni) : [];
  res.json(row);
});

app.post('/api/clients', (req, res) => {
  const { id_voiceflow } = req.body;
  if (!id_voiceflow) return res.status(400).json({ error: 'id_voiceflow richiesto' });
  const exists = db.prepare('SELECT 1 FROM clients WHERE id_voiceflow = ?').get(id_voiceflow);
  if (exists) return res.status(409).json({ error: 'Cliente già esistente' });
  const now = new Date().toISOString();
  const info = db.prepare('INSERT INTO clients (id_voiceflow, nome, numero, summary, data_modifica, conversazioni) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id_voiceflow, '', '', '', now, JSON.stringify([]));
  const nuovo = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  nuovo.conversazioni = [];
  res.status(201).json(nuovo);
});

app.put('/api/clients/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente non trovato' });
  const now = new Date().toISOString();
  // Aggiorna solo i campi forniti
  const nome = req.body.nome !== undefined ? req.body.nome : row.nome;
  const numero = req.body.numero !== undefined ? req.body.numero : row.numero;
  const summary = req.body.summary !== undefined ? req.body.summary : row.summary;
  const conversazioni = req.body.conversazioni !== undefined ? JSON.stringify(req.body.conversazioni) : row.conversazioni;
  db.prepare('UPDATE clients SET nome = ?, numero = ?, summary = ?, data_modifica = ?, conversazioni = ? WHERE id = ?')
    .run(nome, numero, summary, now, conversazioni, req.params.id);
  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  updated.conversazioni = updated.conversazioni ? JSON.parse(updated.conversazioni) : [];
  res.json(updated);
});

app.delete('/api/clients/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente non trovato' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ---------- API KNOWLEDGE ---------- */
app.get('/api/knowledge', (_ , res) => {
  const rows = db.prepare('SELECT * FROM knowledge').all();
  rows.forEach(r => {
    r.domande = r.domande ? JSON.parse(r.domande) : [];
  });
  res.json(rows);
});

// Nuova API per ricerca avanzata
app.get('/api/knowledge/search', (req, res) => {
  const { tipo, nome, consegna, prezzo } = req.query;
  let results = [...knowledge];

  // Filtra per tipo
  if (tipo) {
    results = results.filter(k => k.tipo.toLowerCase() === tipo.toLowerCase());
  }

  // Filtra per nome
  if (nome) {
    results = results.filter(k => k.nome.toLowerCase().includes(nome.toLowerCase()));
  }

  // Filtra per consegna
  if (consegna) {
    const consegnaNum = parseInt(consegna);
    results = results.filter(k => {
      // Estrae i numeri dalla stringa di consegna (es: "30-60 giorni" o "45 giorni")
      const consegnaMatch = k.consegna.match(/(\d+)(?:-(\d+))?/);
      if (!consegnaMatch) return false;
      
      const min = parseInt(consegnaMatch[1]);
      const max = consegnaMatch[2] ? parseInt(consegnaMatch[2]) : min;
      
      return consegnaNum >= min && consegnaNum <= max;
    });
  }

  // Filtra per prezzo
  if (prezzo) {
    const prezzoNum = parseInt(prezzo);
    results = results.filter(k => {
      // Estrae i numeri dalla stringa di prezzo (es: "100-500€" o "250€")
      const prezzoMatch = k.prezzo.match(/(\d+)(?:-(\d+))?/);
      if (!prezzoMatch) return false;
      
      const min = parseInt(prezzoMatch[1]);
      const max = prezzoMatch[2] ? parseInt(prezzoMatch[2]) : min;
      
      return prezzoNum >= min && prezzoNum <= max;
    });
  }

  res.json(results);
});

app.post('/api/knowledge', (req, res) => {
  const { tipo, nome, prezzo, consegna, descrizione, domande } = req.body;
  if (!tipo || !nome || !prezzo || !consegna || !descrizione)
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  const info = db.prepare('INSERT INTO knowledge (tipo, nome, prezzo, consegna, descrizione, domande) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tipo, nome, prezzo, consegna, descrizione, JSON.stringify(domande || []));
  const nuovo = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(info.lastInsertRowid);
  nuovo.domande = nuovo.domande ? JSON.parse(nuovo.domande) : [];
  res.status(201).json(nuovo);
});

app.put('/api/knowledge/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record non trovato' });
  const tipo = req.body.tipo !== undefined ? req.body.tipo : row.tipo;
  const nome = req.body.nome !== undefined ? req.body.nome : row.nome;
  const prezzo = req.body.prezzo !== undefined ? req.body.prezzo : row.prezzo;
  const consegna = req.body.consegna !== undefined ? req.body.consegna : row.consegna;
  const descrizione = req.body.descrizione !== undefined ? req.body.descrizione : row.descrizione;
  const domande = req.body.domande !== undefined ? JSON.stringify(req.body.domande) : row.domande;
  db.prepare('UPDATE knowledge SET tipo = ?, nome = ?, prezzo = ?, consegna = ?, descrizione = ?, domande = ? WHERE id = ?')
    .run(tipo, nome, prezzo, consegna, descrizione, domande, req.params.id);
  const updated = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(req.params.id);
  updated.domande = updated.domande ? JSON.parse(updated.domande) : [];
  res.json(updated);
});

app.delete('/api/knowledge/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record non trovato' });
  db.prepare('DELETE FROM knowledge WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ---------- CHATBOT API ROUTES ---------- */
// Middleware per verificare l'API key del chatbot
const verifyChatbotApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== 'Vttr%627/03bxtbDG&Ut32g38') {
        return res.status(401).json({ error: 'API key non valida' });
    }
    next();
};

// Route per la ricerca nella knowledge base dal chatbot
app.get('/api/chatbot/knowledge/search', verifyChatbotApiKey, (req, res) => {
    const { tipo, prezzo, consegna } = req.query;
    let filteredData = knowledge;

    if (tipo) {
        filteredData = filteredData.filter(item => item.tipo.toLowerCase().includes(tipo.toLowerCase()));
    }
    if (prezzo) {
        filteredData = filteredData.filter(item => {
            const [min, max] = item.prezzo.split('-').map(Number);
            return prezzo >= min && prezzo <= max;
        });
    }
    if (consegna) {
        filteredData = filteredData.filter(item => {
            const [min, max] = item.consegna.split('-').map(Number);
            return consegna >= min && consegna <= max;
        });
    }

    res.json(filteredData);
});

// Route per gestire i clienti dal chatbot
app.get('/api/chatbot/clients/:id_voiceflow', verifyChatbotApiKey, (req, res) => {
    const client = clienti.find(c => c.id_voiceflow === req.params.id_voiceflow);
    if (!client) {
        return res.status(404).json({ error: 'Cliente non trovato' });
    }
    res.json(client);
});

app.put('/api/chatbot/clients/:id_voiceflow', verifyChatbotApiKey, (req, res) => {
    const index = clienti.findIndex(c => c.id_voiceflow === req.params.id_voiceflow);
    if (index === -1) {
        return res.status(404).json({ error: 'Cliente non trovato' });
    }
    clienti[index] = { ...clienti[index], ...req.body };
    save(clientsPath, clienti);
    res.json(clienti[index]);
});

// Route per gestire le conversazioni
app.post('/api/chatbot/clients/:id_voiceflow/conversazioni', verifyChatbotApiKey, (req, res) => {
    const index = clienti.findIndex(c => c.id_voiceflow === req.params.id_voiceflow);
    if (index === -1) {
        return res.status(404).json({ error: 'Cliente non trovato' });
    }
    
    const newConversation = {
        data: new Date().toISOString(),
        user: req.body.user,
        bot: req.body.bot
    };
    
    if (!clienti[index].conversazioni) {
        clienti[index].conversazioni = [];
    }
    clienti[index].conversazioni.push(newConversation);
    
    save(clientsPath, clienti);
    res.json(newConversation);
});

/* ---------- START ---------- */
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 CRM attivo su porta ${port}`);
});

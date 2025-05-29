/* ---------- IMPORT ---------- */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Pool } = require('pg');

/* ---------- APP ---------- */
const app = express();
const port = process.env.PORT || 3000;

// Configurazione più robusta per il parsing JSON
app.use(express.json());
// Middleware per intercettare errori di parsing JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ result: 'JSON_NON_VALIDO' });
    }
    next();
});
app.use(cookieParser());

// Configurazione CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-API-KEY'],
    exposedHeaders: ['*', 'Authorization']
}));

/* ---------- LOGIN ---------- */
app.post('/api/login', async (req, res) => {
  const ok = await bcrypt.compare(req.body.password || '', process.env.ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ error: 'Bad credentials' });

    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('crmToken', token, {
    httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000
  }).sendStatus(204);
});

// Logout route
app.post('/api/logout', (req, res) => {
    res.clearCookie('crmToken').sendStatus(204);
});

/* ---------- MIDDLEWARE ---------- */
function checkAuth(req, res, next) {
  try {
        const token = req.cookies.crmToken;
        if (!token) throw new Error('No token');
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.redirect('/login.html');
  }
}

/* ---------- PAGINE HTML PROTETTE ---------- */
app.get(['/', '/index.html', '/knowledge.html'], checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public',
    req.path === '/' ? 'index.html' : req.path));
});

// Serve login page without auth
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* ---------- STATIC ---------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- API PROTETTE ---------- */
app.use('/api', (req, res, next) => {
    // Skip auth check for login/logout and chatbot routes
    if (req.path === '/login' || req.path === '/logout' || req.path.startsWith('/chatbot/')) {
        return next();
    }
    
    try {
        const token = req.cookies.crmToken;
        if (!token) throw new Error('No token');
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

/* ---------- SQLITE SETUP ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
    const client = await pool.connect();
    try {
        const res = await client.query(text, params);
        return res;
    } finally {
        client.release();
    }
}

/* ---------- CHATBOT API ROUTES ---------- */
// Middleware per verificare l'API key del chatbot
const verifyChatbotApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-KEY'];
    if (!apiKey || apiKey !== process.env.CHATBOT_API_KEY) {
        return res.status(401).json({ error: 'API key non valida o mancante' });
    }
    next();
};

// Helper per formattare le risposte in formato Voiceflow
function formatVoiceflowResponse(type, data) {
  const parts = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      parts.push(`${key}:${value.join('/')}`);
    } else if (typeof value === 'object' && value !== null) {
      const objParts = [];
      for (const [k, v] of Object.entries(value)) {
        objParts.push(`${k}:${v}`);
      }
      parts.push(`${key}:${objParts.join('/')}`);
    } else {
      parts.push(`${key}:${value}`);
    }
  }
  return `${type}|${parts.join('|')}`;
}

// Get client by Voiceflow ID
app.get('/api/chatbot/client/:id_voiceflow', verifyChatbotApiKey, async (req, res) => {
    try {
        const id_voiceflow = req.params.id_voiceflow.replace(/[{}]/g, '');
        const result = await query('SELECT * FROM clients WHERE id_voiceflow = $1', [id_voiceflow]);
        const client = result.rows[0];
        if (!client) {
      return res.status(404).json({ result: 'CLIENTE_NON_TROVATO' });
        }
        client.conversazioni = client.conversazioni || [];
    const response = formatVoiceflowResponse('CLIENTE_TROVATO', {
      id: client.id,
      nome: client.nome || '',
      numero: client.numero || '',
      summary: client.summary || '',
      data: client.data_modifica,
      messaggio: `Cliente trovato: ${client.nome || ''} (${client.numero || 'N/A'})${client.summary ? ' - ' + client.summary : ''}`
    });
    res.json({ result: response });
    } catch (error) {
        console.error('Errore nel recupero del cliente:', error);
    res.status(500).json({ result: 'ERRORE_INTERNO' });
    }
});

// Helper per sanitizzare le stringhe
function sanitizeString(str) {
    if (!str) return '';
    return String(str)
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Rimuove caratteri di controllo
        .replace(/[{}]/g, '') // Rimuove le parentesi graffe
        .replace(/^["']|["']$/g, '') // Rimuove doppi apici all'inizio e alla fine
        .trim();
}

// Create or update client from chatbot
app.post('/api/chatbot/client', verifyChatbotApiKey, async (req, res) => {
    try {
        let { id_voiceflow, nome, numero, summary } = req.body;
        id_voiceflow = sanitizeString(id_voiceflow);
        if (!id_voiceflow) {
      return res.status(400).json({ result: 'ID_VOICEFLOW_MANCANTE' });
        }
        const isZeroValue = (value) => {
            if (!value) return true;
            const cleanValue = String(value).replace(/['"{}]/g, '').trim();
            return cleanValue === '0' || cleanValue === '';
        };
        const selectResult = await query('SELECT * FROM clients WHERE id_voiceflow = $1', [id_voiceflow]);
        const existingClient = selectResult.rows[0];
        if (existingClient) {
            const updates = [];
            const params = [];
            if (!isZeroValue(nome)) { 
                nome = sanitizeString(nome);
                updates.push('nome = $' + (params.length + 1));
                params.push(nome); 
            }
            if (!isZeroValue(numero)) { 
                numero = sanitizeString(numero);
                updates.push('numero = $' + (params.length + 1));
                params.push(numero); 
            }
            if (!isZeroValue(summary)) { 
                summary = sanitizeString(summary);
                updates.push('summary = $' + (params.length + 1));
                params.push(summary); 
            }
            if (updates.length > 0) {
                updates.push('data_modifica = NOW()');
                params.push(id_voiceflow);
                await query(`UPDATE clients SET ${updates.join(', ')} WHERE id_voiceflow = $${params.length}`, params);
            }
        } else {
            await query(
                `INSERT INTO clients (id_voiceflow, nome, numero, summary, conversazioni, data_modifica)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [
                id_voiceflow,
                isZeroValue(nome) ? null : sanitizeString(nome),
                isZeroValue(numero) ? null : sanitizeString(numero),
                    isZeroValue(summary) ? null : sanitizeString(summary),
                    '[]'
                ]
            );
        }
        const clientResult = await query('SELECT * FROM clients WHERE id_voiceflow = $1', [id_voiceflow]);
        const client = clientResult.rows[0];
    const response = formatVoiceflowResponse('CLIENTE_AGGIORNATO', {
      id: client.id,
      nome: client.nome || '',
      numero: client.numero || '',
      summary: client.summary || '',
      data: client.data_modifica,
      messaggio: 'Cliente creato o aggiornato con successo.'
    });
    res.json({ result: response });
    } catch (error) {
        console.error('Errore nel salvataggio del cliente:', error);
    res.status(500).json({ result: 'ERRORE_INTERNO' });
    }
});

// Add conversation to client
app.post('/api/chatbot/client/conversation', verifyChatbotApiKey, async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ result: 'FORMATO_RICHIESTA_NON_VALIDO' });
        }
        const id_voiceflow = req.body.id_voiceflow ? sanitizeString(req.body.id_voiceflow) : null;
        const user_message = req.body.user_message ? sanitizeString(req.body.user_message) : null;
        const bot_messages = req.body.bot_messages;
        if (!id_voiceflow || !user_message || !bot_messages) {
            return res.status(400).json({ result: 'CAMPI_MANCANTI' });
        }
        let processedBotMessages;
        try {
            if (Array.isArray(bot_messages)) {
                processedBotMessages = bot_messages.map(msg => sanitizeString(msg));
            } else if (typeof bot_messages === 'string') {
                processedBotMessages = bot_messages
                    .split('/')
                    .map(msg => sanitizeString(msg))
                    .filter(msg => msg.length > 0);
            } else {
                processedBotMessages = [sanitizeString(String(bot_messages))];
            }
        } catch (error) {
            return res.status(400).json({ result: 'FORMATO_MESSAGGI_BOT_NON_VALIDO' });
        }
        const selectResult = await query('SELECT * FROM clients WHERE id_voiceflow = $1', [id_voiceflow]);
        const client = selectResult.rows[0];
        if (!client) {
            return res.status(404).json({ result: 'CLIENTE_NON_TROVATO' });
        }
        const currentConversazioni = client.conversazioni || [];
        const newConversation = {
            id: Date.now(),
            user: user_message,
            bot: processedBotMessages
        };
        const updatedConversazioni = [...currentConversazioni, newConversation];
        await query(
            `UPDATE clients SET conversazioni = $1::jsonb, data_modifica = NOW() WHERE id_voiceflow = $2`,
            [JSON.stringify(updatedConversazioni), id_voiceflow]
        );
        const response = formatVoiceflowResponse('CONVERSAZIONE_AGGIUNTA', {
            id: newConversation.id,
            user: newConversation.user,
            bot: newConversation.bot.join('/'),
            messaggio: 'Conversazione salvata con successo.'
        });
        res.json({ result: response });
    } catch (error) {
        console.error('Errore nel salvataggio della conversazione:', error);
        res.status(500).json({ result: 'ERRORE_INTERNO' });
    }
});

// Helper per il parsing sicuro dei campi JSON
function safeParseJSON(str, fallback = []) {
  try {
    if (Array.isArray(str)) return str;
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

// Route per la ricerca nella knowledge base dal chatbot
app.get('/api/chatbot/knowledge/search', verifyChatbotApiKey, async (req, res) => {
    try {
        let tipo = req.query.tipo || req.query.Tipo;
        tipo = sanitizeString(tipo);
        if (!tipo) {
            return res.status(400).json({ result: 'TIPO_MANCANTE' });
        }
        const allDataResult = await query('SELECT * FROM knowledge', []);
        const allData = allDataResult.rows;
        let results = allData.filter(item => {
            const itemTipo = sanitizeString(item.tipo);
            return itemTipo === tipo;
        });
        if (results.length === 0) {
            return res.status(404).json({ result: 'NESSUN_PRODOTTO_TROVATO' });
        }
        const formattedResults = results.map(row => {
            const domande = safeParseJSON(row.domande);
            const domande_finali = safeParseJSON(row.domande_finali);
            const categorie = safeParseJSON(row.categorie);
            const finiture = safeParseJSON(row.finiture);
            const categorie_domande = safeParseJSON(row.categorie_domande);
            const finiture_domande = safeParseJSON(row.finiture_domande);
            const productDetails = {
                id: row.id,
                tipo: sanitizeString(row.tipo),
                nome: sanitizeString(row.nome),
                descrizione: sanitizeString(row.descrizione) || '',
                prezzo: sanitizeString(row.prezzo) || '',
                consegna: sanitizeString(row.consegna) || '',
                domande: domande.map(d => sanitizeString(d)).join('/'),
                domande_finali: domande_finali.map(d => sanitizeString(d)).join('/')
            };
            if (row.tipo === 'arredo' && categorie) {
                productDetails.categorie = categorie
                    .map(c => `${sanitizeString(c.titolo)}:${sanitizeString(c.descrizione)}`)
                    .join('/');
                productDetails.categorie_domande = categorie_domande.map(d => sanitizeString(d)).join('/');
            } else if (row.tipo === "complemento d'arredo" && finiture) {
                productDetails.finiture = finiture
                    .map(f => `${sanitizeString(f.titolo)}:${sanitizeString(f.descrizione)}:${sanitizeString(f.prezzo)}`)
                    .join('/');
                productDetails.finiture_domande = finiture_domande.map(d => sanitizeString(d)).join('/');
            }
            const parts = [];
            for (const [key, value] of Object.entries(productDetails)) {
                if (value) {
                    parts.push(`${key}:${value}`);
                }
            }
            return `PRODOTTO_TROVATO|${parts.join('|')}`;
        });
        const responseString = formattedResults.join('|||');
        res.json({ result: responseString });
    } catch (error) {
        console.error('Errore nella ricerca:', error);
        res.status(500).json({ result: 'ERRORE_INTERNO' });
    }
});

/* ---------- API CLIENTS ---------- */
// Get all clients
app.get('/api/clients', async (_, res) => {
    try {
        const result = await query('SELECT * FROM clients', []);
        const rows = result.rows;
    rows.forEach(r => {
            r.conversazioni = r.conversazioni || [];
    });
    res.json(rows);
    } catch (err) {
        console.error('Errore recupero clienti:', err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Get single client
app.get('/api/clients/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
        const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Cliente non trovato' });
        row.conversazioni = row.conversazioni || [];
    res.json(row);
    } catch (err) {
        console.error('Errore recupero cliente:', err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Create client
app.post('/api/clients', async (req, res) => {
    const { id_voiceflow } = req.body;
    if (!id_voiceflow) return res.status(400).json({ error: 'ID Voiceflow mancante' });
    try {
        const result = await query(
            "INSERT INTO clients (id_voiceflow, data_modifica) VALUES ($1, NOW()) RETURNING *",
            [id_voiceflow]
        );
        const nuovo = result.rows[0];
        nuovo.conversazioni = [];
        res.status(201).json(nuovo);
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            res.status(400).json({ error: 'ID Voiceflow già esistente' });
        } else {
            console.error('Errore creazione cliente:', err);
            res.status(500).json({ error: 'Errore interno' });
        }
    }
});

// Update client
app.put('/api/clients/:id', async (req, res) => {
    const { nome, numero, summary, conversazioni } = req.body;
    const updates = [];
    const params = [];
    if (nome !== undefined)          { updates.push('nome = $' + (params.length + 1));          params.push(nome); }
    if (numero !== undefined)        { updates.push('numero = $' + (params.length + 1));        params.push(numero); }
    if (summary !== undefined)       { updates.push('summary = $' + (params.length + 1));       params.push(summary); }
    if (conversazioni !== undefined) { updates.push('conversazioni = $' + (params.length + 1)); params.push(JSON.stringify(conversazioni)); }
    if (updates.length === 0) {
        return res.status(400).json({ error: 'Nessun campo da aggiornare' });
    }
    updates.push("data_modifica = NOW()");
    params.push(req.params.id);
    try {
        const result = await query(
            `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        const updated = result.rows[0];
        if (!updated) {
            res.status(404).json({ error: 'Cliente non trovato' });
        } else {
            updated.conversazioni = updated.conversazioni || [];
            res.json(updated);
        }
    } catch (err) {
        console.error('Errore aggiornamento cliente:', err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Delete client
app.delete('/api/clients/:id', async (req, res) => {
    try {
        const result = await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Cliente non trovato' });
        } else {
            res.sendStatus(204);
        }
    } catch (err) {
        console.error('Errore eliminazione cliente:', err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

/* ---------- API KNOWLEDGE ---------- */
// Route per ottenere tutti i record della knowledge base
app.get('/api/knowledge', async (_, res) => {
    try {
        const result = await query('SELECT * FROM knowledge', []);
        const rows = result.rows;
    rows.forEach(r => {
        r.domande = safeParseJSON(r.domande);
            r.domande_finali = safeParseJSON(r.domande_finali);
        if (r.tipo === 'arredo') {
            r.categorie = safeParseJSON(r.categorie);
            r.categorie_domande = safeParseJSON(r.categorie_domande);
        }
        if (r.tipo === "complemento d'arredo") {
            r.finiture = safeParseJSON(r.finiture);
            r.finiture_domande = safeParseJSON(r.finiture_domande);
        }
    });
    res.json(rows);
    } catch (err) {
        console.error('Errore recupero knowledge:', err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Route per creare un nuovo record knowledge
app.post('/api/knowledge', async (req, res) => {
  const { tipo, nome, descrizione } = req.body;
  if (!tipo || !nome)
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    let prezzo = '', consegna = '', domande = '', categorie = '', finiture = '', categorie_domande = '', finiture_domande = '', domande_finali = '';
  try {
    if (tipo === 'arredo') {
      categorie = JSON.stringify(req.body.categorie || []);
      categorie_domande = JSON.stringify(req.body.categorie_domande || []);
    } else {
      categorie = JSON.stringify([]);
      categorie_domande = JSON.stringify([]);
    }
    if (tipo === "complemento d'arredo") {
      finiture = JSON.stringify(req.body.finiture || []);
      finiture_domande = JSON.stringify(req.body.finiture_domande || []);
    } else {
      finiture = JSON.stringify([]);
      finiture_domande = JSON.stringify([]);
    }
    prezzo = req.body.prezzo || '';
    consegna = req.body.consegna || '';
    domande = JSON.stringify(req.body.domande || []);
        domande_finali = JSON.stringify(req.body.domande_finali || []);
        const result = await query(
            `INSERT INTO knowledge (tipo, nome, prezzo, consegna, descrizione, domande, categorie, finiture, categorie_domande, finiture_domande, domande_finali)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [tipo, nome, prezzo, consegna, descrizione || '', domande, categorie, finiture, categorie_domande, finiture_domande, domande_finali]
        );
        const newRecord = result.rows[0];
    res.json(newRecord);
  } catch (err) {
    console.error('Errore POST /api/knowledge:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Route per aggiornare un record knowledge
app.put('/api/knowledge/:id', async (req, res) => {
  const { tipo, nome, descrizione } = req.body;
  if (!tipo || !nome)
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    let prezzo = '', consegna = '', domande = '', categorie = '', finiture = '', categorie_domande = '', finiture_domande = '', domande_finali = '';
  try {
    if (tipo === 'arredo') {
      categorie = JSON.stringify(req.body.categorie || []);
      categorie_domande = JSON.stringify(req.body.categorie_domande || []);
    } else {
      categorie = JSON.stringify([]);
      categorie_domande = JSON.stringify([]);
    }
    if (tipo === "complemento d'arredo") {
      finiture = JSON.stringify(req.body.finiture || []);
      finiture_domande = JSON.stringify(req.body.finiture_domande || []);
    } else {
      finiture = JSON.stringify([]);
      finiture_domande = JSON.stringify([]);
    }
    prezzo = req.body.prezzo || '';
    consegna = req.body.consegna || '';
    domande = JSON.stringify(req.body.domande || []);
        domande_finali = JSON.stringify(req.body.domande_finali || []);
        const result = await query(
            `UPDATE knowledge SET tipo = $1, nome = $2, prezzo = $3, consegna = $4, descrizione = $5, domande = $6, categorie = $7, finiture = $8, categorie_domande = $9, finiture_domande = $10, domande_finali = $11 WHERE id = $12 RETURNING *`,
            [tipo, nome, prezzo, consegna, descrizione || '', domande, categorie, finiture, categorie_domande, finiture_domande, domande_finali, req.params.id]
        );
        const updated = result.rows[0];
        if (!updated) {
      res.status(404).json({ error: 'Record knowledge non trovato' });
    } else {
      res.json(updated);
    }
  } catch (err) {
    console.error('Errore PUT /api/knowledge:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Route per eliminare un record knowledge
app.delete('/api/knowledge/:id', async (req, res) => {
    try {
        const result = await query('DELETE FROM knowledge WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
      res.status(404).json({ error: 'Record knowledge non trovato' });
        } else {
            res.sendStatus(204);
        }
    } catch (err) {
        res.status(500).json({ error: 'Errore interno' });
    }
});

app.listen(port, () => {
  console.log(`Server avviato su http://localhost:${port}`);
});
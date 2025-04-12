const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

// Imposta la cartella "public" per servire i file statici
app.use(express.static('public'));

// Middleware per parsare JSON
app.use(bodyParser.json());

// Dati simulati in memoria
let clients = [];
let knowledgeItems = [];

// --- Endpoints per i clients ---

// Recupera tutti i clienti
app.get('/api/clients', (req, res) => {
  res.json(clients);
});

// Recupera un cliente per ID
app.get('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = clients.find(c => c.id === id);
  if (client) {
    res.json(client);
  } else {
    res.status(404).json({ error: 'Cliente non trovato' });
  }
});

// Aggiunge un nuovo cliente
app.post('/api/clients', (req, res) => {
  const newClient = {
    ...req.body,
    id: Date.now(), // ID univoco basato sul timestamp
    data_modifica: new Date(), // Data di creazione
    conversazioni: [],
    progetti: []
  };
  clients.push(newClient);
  res.status(201).json(newClient);
});

// Aggiorna un cliente esistente
app.put('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const clientIndex = clients.findIndex(c => c.id === id);
  if (clientIndex > -1) {
    clients[clientIndex] = {
      ...clients[clientIndex],
      ...req.body,
      data_modifica: new Date()
    };
    res.json(clients[clientIndex]);
  } else {
    res.status(404).json({ error: 'Cliente non trovato' });
  }
});

// Elimina un cliente
app.delete('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const clientIndex = clients.findIndex(c => c.id === id);
  if (clientIndex > -1) {
    const deletedClient = clients.splice(clientIndex, 1);
    res.json(deletedClient[0]);
  } else {
    res.status(404).json({ error: 'Cliente non trovato' });
  }
});

// --- Endpoints per la Knowledge Base ---

// Recupera tutti i record della Knowledge Base
app.get('/api/knowledge', (req, res) => {
  res.json(knowledgeItems);
});

// Aggiunge un nuovo record nella Knowledge Base
app.post('/api/knowledge', (req, res) => {
  const newItem = {
    ...req.body,
    id: Date.now() // ID univoco basato sul timestamp
  };
  knowledgeItems.push(newItem);
  res.status(201).json(newItem);
});

// Elimina un record della Knowledge Base
app.delete('/api/knowledge/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const knowledgeIndex = knowledgeItems.findIndex(item => item.id === id);
  if (knowledgeIndex > -1) {
    const deletedItem = knowledgeItems.splice(knowledgeIndex, 1);
    res.json(deletedItem[0]);
  } else {
    res.status(404).json({ error: 'Record non trovato' });
  }
});

// Avvia il server
app.listen(port, () => {
  console.log(`Server in ascolto sulla porta ${port}`);
});

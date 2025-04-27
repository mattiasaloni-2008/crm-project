/* ---------- IMPORT ---------- */
require('dotenv').config();
const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const cors         = require('cors');

/* ---------- CHATBOT CONFIG ---------- */
const CHATBOT_API_KEY = process.env.CHATBOT_API_KEY || 'test123';

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

/* ---------- API CLIENTI  (restano uguali) ---------- */
app.get('/api/clients', (_ , res) => res.json(clienti));
app.get('/api/clients/:id', (req,res)=>{
  const c = clienti.find(x=>x.id==req.params.id||x.id_voiceflow==req.params.id);
  c ? res.json(c) : res.status(404).json({error:'Cliente non trovato'});
});
app.post('/api/clients',(req,res)=>{
  const {id_voiceflow}=req.body;
  if(!id_voiceflow) return res.status(400).json({error:'id_voiceflow richiesto'});
  if(clienti.find(c=>c.id_voiceflow===id_voiceflow))
    return res.status(409).json({error:'Cliente già esistente'});
  const nuovo={id:Date.now(),id_voiceflow,nome:'',numero:'',summary:'',data_modifica:new Date().toISOString(),conversazioni:[]};
  clienti.push(nuovo); save(clientsPath,clienti); res.status(201).json(nuovo);
});
app.put('/api/clients/:id',(req,res)=>{
  const i=clienti.findIndex(c=>c.id==req.params.id);
  if(i===-1) return res.status(404).json({error:'Cliente non trovato'});
  clienti[i]={...clienti[i],...req.body,data_modifica:new Date().toISOString()};
  save(clientsPath,clienti); res.json(clienti[i]);
});
app.delete('/api/clients/:id',(req,res)=>{
  const i=clienti.findIndex(c=>c.id==req.params.id);
  if(i===-1) return res.status(404).json({error:'Cliente non trovato'});
  clienti.splice(i,1); save(clientsPath,clienti); res.json({success:true});
});

/* ---------- API KNOWLEDGE ---------- */
app.get('/api/knowledge',(_ ,res)=>res.json(knowledge));

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

app.post('/api/knowledge',(req,res)=>{
  const {tipo,nome,prezzo,consegna,descrizione,domande}=req.body;
  if(!tipo||!nome||!prezzo||!consegna||!descrizione)
    return res.status(400).json({error:'Campi obbligatori mancanti'});
  const nuovo={id:Date.now(),tipo,nome,prezzo,consegna,descrizione,domande:domande||[]};
  knowledge.push(nuovo); save(knowledgePath,knowledge); res.status(201).json(nuovo);
});
app.delete('/api/knowledge/:id',(req,res)=>{
  const len=knowledge.length; knowledge=knowledge.filter(k=>k.id!=req.params.id);
  if(len===knowledge.length) return res.status(404).json({error:'Record non trovato'});
  save(knowledgePath,knowledge); res.json({success:true});
});

/* ---------- CHATBOT API ROUTES ---------- */
// Middleware per verificare l'API key del chatbot
const verifyChatbotApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== 'test123') {
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

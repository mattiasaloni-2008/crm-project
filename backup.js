const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configurazione PostgreSQL (come in server.js)
const pool = new Pool({
    user: process.env.PGUSER || 'macbook',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'crm',
    password: process.env.PGPASSWORD || '',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
});

// Crea la directory dei backup se non esiste
const backupDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.json`);
    try {
        const client = await pool.connect();
        const knowledgeRes = await client.query('SELECT * FROM knowledge');
        const clientsRes = await client.query('SELECT * FROM clients');
        client.release();

        const backup = {
            timestamp,
            knowledge: knowledgeRes.rows,
            clients: clientsRes.rows
        };
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
        console.log(`Backup creato: ${backupFile}`);

        // Mantieni solo gli ultimi 5 backup
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .reverse();
        if (backups.length > 5) {
            backups.slice(5).forEach(f => {
                fs.unlinkSync(path.join(backupDir, f));
                console.log(`Rimosso vecchio backup: ${f}`);
            });
        }
    } catch (err) {
        console.error('Errore durante il backup:', err);
    } finally {
        await pool.end();
    }
}

// Usage: node backup.js
// Rimuovi o commenta la riga:
// createBackup(); 

 
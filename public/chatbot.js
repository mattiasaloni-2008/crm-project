// Configurazione
const CHATBOT_API_KEY = 'Vttr%627/03bxtbDG&Ut32g38';
const VOICEFLOW_CONFIG = {
    API_KEY: 'VF.DM.6808d4b9ddd828fb75c39185.vGgBueP6Vj4k5pjM',
    VERSION_ID: '67f944f72bc3d09f3867cb0e',
    PROJECT_ID: '67f944f72bc3d09f3867cb0d'
};

// Funzioni per la knowledge base
async function searchKnowledge(tipo, prezzo, consegna) {
    try {
        const response = await fetch(`/api/chatbot/knowledge/search?tipo=${tipo}&prezzo=${prezzo}&consegna=${consegna}`, {
            headers: {
                'x-api-key': CHATBOT_API_KEY
            }
        });
        if (!response.ok) throw new Error('Errore nella ricerca');
        return await response.json();
    } catch (error) {
        console.error('Errore nella ricerca:', error);
        return [];
    }
}

// Funzioni per i clienti
async function getClient(id_voiceflow) {
    try {
        const response = await fetch(`/api/chatbot/clients/${id_voiceflow}`, {
            headers: {
                'x-api-key': CHATBOT_API_KEY
            }
        });
        if (!response.ok) throw new Error('Cliente non trovato');
        return await response.json();
    } catch (error) {
        console.error('Errore nel recupero del cliente:', error);
        return null;
    }
}

async function updateClient(id_voiceflow, data) {
    try {
        const response = await fetch(`/api/chatbot/clients/${id_voiceflow}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CHATBOT_API_KEY
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Errore nell\'aggiornamento');
        return await response.json();
    } catch (error) {
        console.error('Errore nell\'aggiornamento del cliente:', error);
        return null;
    }
}

async function addConversation(id_voiceflow, userMessage, botMessages) {
    try {
        const response = await fetch(`/api/chatbot/clients/${id_voiceflow}/conversazioni`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CHATBOT_API_KEY
            },
            body: JSON.stringify({
                user: userMessage,
                bot: botMessages
            })
        });
        if (!response.ok) throw new Error('Errore nell\'aggiunta della conversazione');
        return await response.json();
    } catch (error) {
        console.error('Errore nell\'aggiunta della conversazione:', error);
        return null;
    }
}

// Integrazione con Voiceflow
async function interactWithVoiceflow(message, userId) {
    try {
        // Prima otteniamo i dati del cliente
        const clientData = await getClient(userId);
        
        // Otteniamo i risultati della knowledge base pertinenti
        const knowledgeResults = await searchKnowledge(
            message.includes('tipo') ? message : '',
            message.includes('prezzo') ? message.match(/\d+/)?.[0] : '',
            message.includes('consegna') ? message.match(/\d+/)?.[0] : ''
        );

        const response = await fetch('https://general-runtime.voiceflow.com/state/user/interact', {
            method: 'POST',
            headers: {
                'Authorization': VOICEFLOW_CONFIG.API_KEY,
                'Content-Type': 'application/json',
                'versionID': VOICEFLOW_CONFIG.VERSION_ID
            },
            body: JSON.stringify({
                action: {
                    type: 'text',
                    payload: message
                },
                config: {
                    tts: false,
                    stripSSML: true
                },
                state: {
                    client: clientData,
                    knowledge: knowledgeResults
                }
            })
        });

        if (!response.ok) {
            throw new Error('Errore nella comunicazione con Voiceflow');
        }

        const data = await response.json();
        
        // Salviamo la conversazione
        await addConversation(userId, message, data.trace);
        
        return data.trace;
    } catch (error) {
        console.error('Errore in Voiceflow:', error);
        throw error;
    }
}

// Esporta le funzioni
export {
    searchKnowledge,
    getClient,
    updateClient,
    addConversation,
    interactWithVoiceflow
};
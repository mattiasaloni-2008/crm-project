// Importa le funzioni del chatbot
import { searchKnowledge, getClient, updateClient, addConversation } from './chatbot.js';

/**
 * 1. Funzione per cercare/creare cliente tramite ID Voiceflow
 * Restituisce le informazioni del cliente nelle variabili di Voiceflow
 */
export async function getOrCreateClient(args) {
    const { id_voiceflow } = args.inputVars;
    
    if (!id_voiceflow) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "ID Voiceflow mancante"
                }
            }]
        };
    }

    try {
        let client = await getClient(id_voiceflow);
        let isNew = false;

        // Se il cliente non esiste, lo creiamo
        if (!client) {
            const response = await fetch('/api/clients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': 'test123'
                },
                body: JSON.stringify({ id_voiceflow })
            });
            
            if (!response.ok) throw new Error('Errore nella creazione del cliente');
            client = await response.json();
            isNew = true;
        }

        // Restituiamo i dati nelle variabili di Voiceflow
        return {
            next: { path: isNew ? 'new_client' : 'existing_client' },
            variables: {
                client_nome: client.nome || '',
                client_numero: client.numero || '',
                client_summary: client.summary || ''
            },
            trace: [{
                type: "text",
                payload: {
                    message: isNew ? "👋 Benvenuto nuovo cliente!" : "👋 Bentornato!"
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore: " + error.message
                }
            }]
        };
    }
}

/**
 * 2. Funzione per aggiornare un campo specifico del cliente
 */
export async function updateClientField(args) {
    const { id_voiceflow, field, value } = args.inputVars;
    
    if (!id_voiceflow || !field || !value) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Parametri mancanti per l'aggiornamento"
                }
            }]
        };
    }

    try {
        // Verifica che il campo sia valido
        if (!['nome', 'numero', 'summary'].includes(field)) {
            throw new Error('Campo non valido');
        }

        const updateData = {
            [field]: value,
            data_modifica: new Date().toISOString()
        };

        await updateClient(id_voiceflow, updateData);

        return {
            next: { path: 'success' },
            variables: {
                [`client_${field}`]: value
            },
            trace: [{
                type: "text",
                payload: {
                    message: `✅ Campo ${field} aggiornato con successo!`
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nell'aggiornamento: " + error.message
                }
            }]
        };
    }
}

/**
 * 3. Funzione per salvare una conversazione
 */
export async function saveConversation(args) {
    const { id_voiceflow, user_message, bot_message } = args.inputVars;
    
    if (!id_voiceflow || !user_message || !bot_message) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Dati conversazione incompleti"
                }
            }]
        };
    }

    try {
        await addConversation(id_voiceflow, user_message, bot_message);
        
        return {
            next: { path: 'success' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Conversazione salvata"
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nel salvataggio: " + error.message
                }
            }]
        };
    }
}

/**
 * 4. Funzione per cercare prodotti nella knowledge base
 */
export async function searchProducts(args) {
    const { tipo, nome, prezzo, consegna } = args.inputVars;
    
    try {
        const results = await searchKnowledge(tipo, prezzo, consegna);
        
        // Filtra per nome se specificato
        const filteredResults = nome 
            ? results.filter(item => item.nome.toLowerCase().includes(nome.toLowerCase()))
            : results;

        if (filteredResults.length === 0) {
            return {
                next: { path: 'no_results' },
                trace: [{
                    type: "text",
                    payload: {
                        message: "Mi dispiace, non ho trovato prodotti con questi criteri."
                    }
                }]
            };
        }

        // Formatta i risultati senza includere le domande
        const formattedResults = filteredResults.map(item => ({
            nome: item.nome,
            tipo: item.tipo,
            prezzo: item.prezzo,
            consegna: item.consegna,
            descrizione: item.descrizione
        }));

        return {
            next: { path: 'show_results' },
            variables: {
                search_results: formattedResults
            },
            trace: [{
                type: "text",
                payload: {
                    message: `Ho trovato ${filteredResults.length} risultati!`
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nella ricerca: " + error.message
                }
            }]
        };
    }
}

/**
 * 5. Funzione per ottenere una domanda specifica
 */
export async function getQuestion(args) {
    const { nome, index } = args.inputVars;
    
    if (!nome || index === undefined) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Nome prodotto o indice domanda mancante"
                }
            }]
        };
    }

    try {
        // Cerca il prodotto per nome
        const results = await searchKnowledge('', '', '');
        const product = results.find(item => item.nome.toLowerCase() === nome.toLowerCase());

        if (!product) {
            return {
                next: { path: 'no_product' },
                trace: [{
                    type: "text",
                    payload: {
                        message: "Prodotto non trovato."
                    }
                }]
            };
        }

        // Verifica se esistono domande e se l'indice è valido
        if (!product.domande || !product.domande[index]) {
            return {
                next: { path: 'no_question' },
                trace: [{
                    type: "text",
                    payload: {
                        message: "Domanda non trovata per questo prodotto."
                    }
                }]
            };
        }

        return {
            next: { path: 'show_question' },
            variables: {
                current_question: product.domande[index]
            },
            trace: [{
                type: "text",
                payload: {
                    message: product.domande[index]
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nel recupero della domanda: " + error.message
                }
            }]
        };
    }
}

/**
 * Funzione per salvare i dati del cliente
 */
export async function saveClientData(args) {
    const { id_voiceflow, nome, telefono, note } = args.inputVars;

    if (!id_voiceflow) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "ID Voiceflow mancante"
                }
            }]
        };
    }

    try {
        const clientData = {
            nome: nome || '',
            numero: telefono || '',
            summary: note || '',
            data_modifica: new Date().toISOString()
        };

        await updateClient(id_voiceflow, clientData);

        return {
            next: { path: 'success' },
            trace: [{
                type: "text",
                payload: {
                    message: "✅ Dati salvati con successo!"
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nel salvataggio: " + error.message
                }
            }]
        };
    }
}

/**
 * Funzione per inviare email tramite Google Apps Script
 */
export async function sendEmail(args) {
    const { nome, telefono, messaggio } = args.inputVars;

    if (!messaggio) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Il campo 'messaggio' è obbligatorio per inviare l'email."
                }
            }]
        };
    }

    const body = `
        📬 Nuova interazione sul chatbot

        👤 Nome: ${nome || "Non fornito"}
        📞 Telefono: ${telefono || "Non fornito"}
        💬 Messaggio: ${messaggio}
    `;

    const url = "https://script.google.com/macros/s/AKfycbyqwGhr8tKHP5MzNHGuJcYvI4leJuCpa41HNY1BArlAxk8KEzRxlZkffHJ28GB0Qq3r/exec";

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testo: body })
        });

        if (!response.ok) {
            throw new Error(`Errore HTTP: ${response.status}`);
        }

        return {
            next: { path: 'success' },
            trace: [{
                type: "text",
                payload: {
                    message: "📩 Email inviata correttamente!"
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nell'invio dell'email: " + error.message
                }
            }]
        };
    }
}

/**
 * Funzione per recuperare lo storico delle conversazioni
 */
export async function getClientHistory(args) {
    const { id_voiceflow } = args.inputVars;

    if (!id_voiceflow) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "ID Voiceflow mancante"
                }
            }]
        };
    }

    try {
        const client = await getClient(id_voiceflow);
        
        if (!client || !client.conversazioni || client.conversazioni.length === 0) {
            return {
                next: { path: 'no_history' },
                trace: [{
                    type: "text",
                    payload: {
                        message: "Non ho trovato conversazioni precedenti."
                    }
                }]
            };
        }

        // Prendi le ultime 5 conversazioni
        const recentConversations = client.conversazioni
            .slice(-5)
            .map(conv => `
                🗓️ ${new Date(conv.data).toLocaleString()}
                👤 Utente: ${conv.user}
                🤖 Bot: ${Array.isArray(conv.bot) ? conv.bot.join('\n') : conv.bot}
            `).join('\n\n');

        return {
            next: { path: 'show_history' },
            trace: [{
                type: "text",
                payload: {
                    message: `Ecco le tue ultime conversazioni:\n${recentConversations}`
                }
            }]
        };
    } catch (error) {
        return {
            next: { path: 'error' },
            trace: [{
                type: "debug",
                payload: {
                    message: "Errore nel recupero dello storico: " + error.message
                }
            }]
        };
    }
} 

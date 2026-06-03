'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname)));

const salas = new Map();

function gerarPIN() {
    let pin;
    do {
        pin = String(Math.floor(1000 + Math.random() * 9000));
    } while (salas.has(pin));
    return pin;
}

function emitirJogadores(pin) {
    const sala = salas.get(pin);
    if (!sala) return;
    io.to(pin).emit('atualizarJogadores', sala.jogadores);
}

io.on('connection', (socket) => {

    socket.on('criarSala', ({ nome }) => {
        if (!nome || typeof nome !== 'string') return;

        const pin = gerarPIN();
        salas.set(pin, {
            jogadores: [{ id: socket.id, nome: nome.trim().slice(0, 20) }],
            config: {
                categorias: [],
                letras: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
                rodadas: 8
            }
        });
        socket.join(pin);
        socket.data.pin = pin;

        socket.emit('salaCriada', pin);
        emitirJogadores(pin);
    });

    socket.on('entrarSala', ({ pin, nome }) => {
        if (!pin || typeof pin !== 'string' || !nome || typeof nome !== 'string') return;

        const sala = salas.get(pin.trim());
        if (!sala) {
            socket.emit('erroEntrada', 'Sala não encontrada. Verifique o PIN.');
            return;
        }
        if (sala.jogadores.length >= 10) {
            socket.emit('erroEntrada', 'Sala cheia (máximo 10 jogadores).');
            return;
        }

        sala.jogadores.push({ id: socket.id, nome: nome.trim().slice(0, 20) });
        socket.join(pin);
        socket.data.pin = pin;

        socket.emit('entradaSucesso', pin);
        socket.emit('configAtualizada', sala.config);
        emitirJogadores(pin);
    });

    socket.on('atualizarConfig', ({ pin, categorias, letras, rodadas }) => {
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.jogadores[0]?.id !== socket.id) return;

        sala.config = { categorias, letras, rodadas };
        socket.to(pin).emit('configAtualizada', { categorias, letras, rodadas });
    });

    socket.on('iniciarJogo', (pin) => {
        if (typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.jogadores[0]?.id !== socket.id) return;

        const letras = sala.config.letras?.length ? sala.config.letras : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
        const letra  = letras[Math.floor(Math.random() * letras.length)];
        io.to(pin).emit('jogoIniciado', { letra });
    });

    socket.on('chatMsg', ({ pin, nome, msg }) => {
        if (!pin || typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (!sala.jogadores.some(j => j.id === socket.id)) return;

        const msgSegura  = String(msg  ?? '').trim().slice(0, 100);
        const nomeSeguro = String(nome ?? '').trim().slice(0, 20);
        if (!msgSegura) return;

        io.to(pin).emit('chatMsg', { nome: nomeSeguro, msg: msgSegura });
    });

    socket.on('disconnect', () => {
        const pin = socket.data.pin;
        if (!pin) return;
        const sala = salas.get(pin);
        if (!sala) return;

        const eraHost = sala.jogadores[0]?.id === socket.id;
        sala.jogadores = sala.jogadores.filter(j => j.id !== socket.id);

        if (sala.jogadores.length === 0) {
            salas.delete(pin);
            return;
        }

        emitirJogadores(pin);

        if (eraHost) {
            io.to(sala.jogadores[0].id).emit('voceEhHost');
        }
    });
});

server.listen(PORT, () => {
    console.log(`✅  Servidor rodando em http://localhost:${PORT}`);
});

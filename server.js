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
const TEMPO_VOTACAO_MS = 20000;

function normalizarTexto(texto) {
    return String(texto || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function embaralharArr(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function gerarPIN() {
    let pin;
    do {
        pin = String(Math.floor(1000 + Math.random() * 9000));
    } while (salas.has(pin));
    return pin;
}

function criarEstadoSala(pin, hostId, hostNome) {
    const sala = {
        pin,
        hostId,
        jogadores: [{ id: hostId, nome: String(hostNome || '').trim().slice(0, 20) }],
        pontuacoes: { [hostId]: 0 },
        rodadaAtual: 0,
        letraAtual: '',
        respostasRodada: {},
        votos: {},
        historicoRodadas: [],
        categoriasFila: [],
        categoriasRodada: [],
        itensVerificacao: [],
        filaValidacao: [],
        resultadosValidacao: {},
        votacaoAtiva: null,
        fase: 'lobby',
        config: {
            categorias: [],
            letras: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
            rodadas: 8
        }
    };

    salas.set(pin, sala);
    return sala;
}

function emitirJogadores(pin) {
    const sala = salas.get(pin);
    if (!sala) return;
    const jogadores = [...sala.jogadores]
        .map(j => ({
            ...j,
            host: j.id === sala.hostId,
            pontos: sala.pontuacoes?.[j.id] || 0
        }))
        .sort((a, b) => (b.pontos - a.pontos) || a.nome.localeCompare(b.nome, 'pt-BR'));
    io.to(pin).emit('atualizarJogadores', jogadores);
}

function obterSala(pin) {
    return salas.get(pin);
}

function obterCategoriaAtual(sala) {
    if (sala.categoriasRodada?.length) return sala.categoriasRodada;
    const todasCats = sala.config.categorias || [];
    if (todasCats.length <= 5) return [...todasCats];
    if (!sala.categoriasFila || sala.categoriasFila.length === 0) {
        sala.categoriasFila = embaralharArr([...todasCats]);
    }
    const selecionadas = sala.categoriasFila.splice(0, 5);
    if (selecionadas.length < 5) {
        sala.categoriasFila = embaralharArr([...todasCats]);
        selecionadas.push(...sala.categoriasFila.splice(0, 5 - selecionadas.length));
    }
    return selecionadas;
}

function montarFilaValidacao(sala) {
    const fila = [];
    const vistos = new Map();
    sala.resultadosValidacao = {};

    (sala.categoriasRodada || []).forEach(categoria => {
        Object.values(sala.respostasRodada || {}).forEach(submissao => {
            const texto = String(submissao.respostas?.[categoria.id] || '').trim();
            if (!texto) return;
            const chave = `${categoria.id}__${normalizarTexto(texto)}`;
            if (!vistos.has(chave)) {
                const item = {
                    key: chave,
                    catId: categoria.id,
                    categoria: categoria.label,
                    emoji: categoria.emoji,
                    texto,
                    donos: [submissao.id],
                    quantidade: 1,
                    valido: null,
                    sim: 0,
                    nao: 0
                };
                vistos.set(chave, item);
                fila.push(item);
            } else {
                const item = vistos.get(chave);
                item.donos.push(submissao.id);
                item.quantidade += 1;
            }
        });
    });

    sala.itensVerificacao = fila;
    sala.filaValidacao = [...fila];
    sala.votacaoAtiva = null;
}

function finalizarVotacaoItem(pin) {
    const sala = salas.get(pin);
    if (!sala || !sala.votacaoAtiva) return;

    const atual = sala.votacaoAtiva;
    if (atual.timer) clearTimeout(atual.timer);

    const sim = Object.values(atual.votos).filter(Boolean).length;
    const nao = Object.values(atual.votos).filter(v => !v).length;
    const aceito = sim >= nao;

    const item = sala.itensVerificacao.find(i => i.key === atual.key) || {
        key: atual.key,
        catId: atual.catId,
        categoria: atual.categoria,
        emoji: atual.emoji,
        texto: atual.texto,
        donos: atual.donos,
        quantidade: atual.quantidade
    };

    sala.resultadosValidacao[atual.key] = {
        ...item,
        sim,
        nao,
        valido: aceito,
        votos: { ...atual.votos }
    };

    sala.votacaoAtiva = null;

    io.to(pin).emit('votacaoEncerrada', {
        itemId: atual.key,
        catId: atual.catId,
        chave: atual.key,
        sim,
        nao,
        aceito
    });

    if (sala.filaValidacao.length > 0) {
        setTimeout(() => iniciarProximaVotacao(pin, sala), 750);
        return;
    }

    calcularPontuacaoRodada(pin);
}

function calcularPontuacaoRodada(pin) {
    const sala = salas.get(pin);
    if (!sala) return;

    const pontuacaoRodada = {};
    sala.jogadores.forEach(j => {
        pontuacaoRodada[j.id] = 0;
    });

    sala.jogadores.forEach(jogador => {
        sala.categoriasRodada.forEach(categoria => {
            const texto = String(sala.respostasRodada?.[jogador.id]?.respostas?.[categoria.id] || '').trim();
            if (!texto) return;

            const chave = `${categoria.id}__${normalizarTexto(texto)}`;
            const resultado = sala.resultadosValidacao[chave];
            if (!resultado || !resultado.valido) return;

            pontuacaoRodada[jogador.id] += resultado.quantidade > 1 ? 5 : 10;
        });
    });

    sala.jogadores.forEach(jogador => {
        sala.pontuacoes[jogador.id] = (sala.pontuacoes[jogador.id] || 0) + (pontuacaoRodada[jogador.id] || 0);
    });

    sala.historicoRodadas.push({
        rodada: sala.rodadaAtual,
        letra: sala.letraAtual,
        pontuacaoRodada: { ...pontuacaoRodada }
    });

    sala.fase = 'resultado';

    const ranking = obterRankingSala(sala);
    emitirJogadores(pin);
    io.to(pin).emit('leaderboardAtualizado', ranking);
    io.to(pin).emit('rodadaFinalizada', {
        rodadaAtual: sala.rodadaAtual,
        totalRodadas: sala.config.rodadas,
        letraAtual: sala.letraAtual,
        pontuacaoRodada,
        ranking,
        historicoRodadas: sala.historicoRodadas
    });
}

function obterRankingSala(sala) {
    return [...sala.jogadores]
        .map(j => ({
            id: j.id,
            nome: j.nome,
            host: j.id === sala.hostId,
            pontos: sala.pontuacoes?.[j.id] || 0
        }))
        .sort((a, b) => (b.pontos - a.pontos) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function broadcastEstadoSala(pin) {
    const sala = obterSala(pin);
    if (!sala) return;
    emitirJogadores(pin);
    io.to(pin).emit('estadoSalaAtualizado', {
        rodadaAtual: sala.rodadaAtual,
        letraAtual: sala.letraAtual,
        totalRodadas: sala.config.rodadas,
        fase: sala.fase,
        ranking: obterRankingSala(sala)
    });
}

function registrarRespostasRodada(socket, pin, nome, respostas) {
    const sala = salas.get(pin);
    if (!sala) return;
    if (!sala.jogadores.some(j => j.id === socket.id)) return;

    sala.respostasRodada[socket.id] = {
        id: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        respostas
    };

    io.to(pin).emit('respostasRodadaAtualizadas', { respostas: sala.respostasRodada });

    const submetidos = sala.jogadores.filter(j => sala.respostasRodada[j.id]).length;
    if (submetidos === sala.jogadores.length) {
        iniciarVerificacaoRodada(pin, sala);
    }
}

function encerrarRodadaPorStop(socket, pin, nome, respostas) {
    const sala = salas.get(pin);
    if (!sala) return;
    if (sala.fase !== 'jogando') return;
    if (!sala.jogadores.some(j => j.id === socket.id)) return;

    const categorias = sala.categoriasRodada || [];
    const completo = categorias.length > 0 && categorias.every(c => {
        const valor = String(respostas?.[c.id] || '').trim();
        return valor.length > 0;
    });

    if (!completo) {
        socket.emit('erroEntrada', 'Preencha todas as categorias antes do STOP.');
        return;
    }

    registrarRespostasRodada(socket, pin, nome, respostas);

    if (sala.fase !== 'jogando') {
        return;
    }

    sala.jogadores.forEach(jogador => {
        if (!sala.respostasRodada[jogador.id]) {
            const respostasVazias = {};
            categorias.forEach(c => {
                respostasVazias[c.id] = '';
            });
            sala.respostasRodada[jogador.id] = {
                id: jogador.id,
                nome: jogador.nome,
                respostas: respostasVazias
            };
        }
    });

    io.to(pin).emit('rodadaEncerrada', {
        por: socket.id,
        nome: String(nome || '').trim().slice(0, 20)
    });

    iniciarVerificacaoRodada(pin, sala);
}

function iniciarRodadaInterna(pin, sala) {
    sala.fase = 'jogando';
    sala.respostasRodada = {};
    sala.resultadosValidacao = {};
    sala.filaValidacao = [];
    sala.votacaoAtiva = null;
    sala.rodadaAtual = (sala.rodadaAtual || 0) + 1;

    const letras = sala.config.letras?.length ? sala.config.letras : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    sala.letraAtual = letras[Math.floor(Math.random() * letras.length)];
    sala.categoriasRodada = [];
    sala.categoriasRodada = obterCategoriaAtual(sala);

    io.to(pin).emit('jogoIniciado', {
        letra: sala.letraAtual,
        categorias: sala.categoriasRodada,
        rodadaAtual: sala.rodadaAtual,
        totalRodadas: sala.config.rodadas,
        ranking: obterRankingSala(sala)
    });
}

function iniciarVerificacaoRodada(pin, sala) {
    sala.fase = 'verificacao';
    montarFilaValidacao(sala);
    io.to(pin).emit('iniciarVerificacao', {
        rodadaAtual: sala.rodadaAtual,
        letraAtual: sala.letraAtual,
        categorias: sala.categoriasRodada,
        respostas: sala.respostasRodada,
        itens: sala.itensVerificacao,
        ranking: obterRankingSala(sala)
    });
    if (sala.filaValidacao.length === 0) {
        calcularPontuacaoRodada(pin);
        return;
    }
    iniciarProximaVotacao(pin, sala);
}

function iniciarProximaVotacao(pin, sala) {
    if (sala.votacaoAtiva?.timer) clearTimeout(sala.votacaoAtiva.timer);
    const proxima = sala.filaValidacao.shift();
    if (!proxima) {
        finalizarRodada(pin, sala);
        return;
    }

    sala.votacaoAtiva = {
        ...proxima,
        votos: {},
        timer: null,
        startedAt: Date.now(),
        endsAt: Date.now() + TEMPO_VOTACAO_MS
    };

    sala.votacaoAtiva.timer = setTimeout(() => {
        if (salas.has(pin)) {
            const atual = salas.get(pin);
            if (atual?.votacaoAtiva?.key === proxima.key) {
                finalizarVotacaoItem(pin);
            }
        }
    }, TEMPO_VOTACAO_MS);

    io.to(pin).emit('votacaoIniciada', {
        catId: proxima.catId,
        chave: proxima.key,
        startedAt: sala.votacaoAtiva.startedAt,
        endsAt: sala.votacaoAtiva.endsAt,
        item: {
            key: proxima.key,
            catId: proxima.catId,
            categoria: proxima.categoria,
            emoji: proxima.emoji,
            texto: proxima.texto,
            donos: proxima.donos,
            quantidade: proxima.quantidade
        },
        duracao: Math.floor(TEMPO_VOTACAO_MS / 1000),
        totalJogadores: sala.jogadores.length
    });
}

function encerrarVotacaoAtual(pin, sala) {
    if (!sala?.votacaoAtiva) return;
    finalizarVotacaoItem(pin);
}

function finalizarRodada(pin, sala) {
    const pontuacaoRodada = {};
    sala.jogadores.forEach(j => {
        pontuacaoRodada[j.id] = 0;
    });

    Object.values(sala.resultadosValidacao || {}).forEach(resultado => {
        const pontos = resultado.valido ? (resultado.quantidade > 1 ? 5 : 10) : 0;
        resultado.donos.forEach(id => {
            pontuacaoRodada[id] = (pontuacaoRodada[id] || 0) + pontos;
        });
    });

    sala.jogadores.forEach(j => {
        sala.pontuacoes[j.id] = (sala.pontuacoes[j.id] || 0) + (pontuacaoRodada[j.id] || 0);
    });

    sala.historicoRodadas.push({
        rodada: sala.rodadaAtual,
        letra: sala.letraAtual,
        pontuacaoRodada: { ...pontuacaoRodada }
    });

    sala.fase = 'resultado';
    emitirJogadores(pin);
    io.to(pin).emit('resultadoRodada', {
        rodadaAtual: sala.rodadaAtual,
        letraAtual: sala.letraAtual,
        pontuacaoRodada,
        ranking: obterRankingSala(sala),
        historicoRodadas: sala.historicoRodadas,
        pontuacoes: sala.pontuacoes
    });
}

io.on('connection', (socket) => {

    socket.on('criarSala', ({ nome }) => {
        if (!nome || typeof nome !== 'string') return;

        const pin = gerarPIN();
        criarEstadoSala(pin, socket.id, nome);
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
        sala.pontuacoes[socket.id] = sala.pontuacoes[socket.id] || 0;
        socket.join(pin);
        socket.data.pin = pin;

        socket.emit('entradaSucesso', pin);
        socket.emit('configAtualizada', sala.config);
        emitirJogadores(pin);
    });

    socket.on('atualizarConfig', ({ pin, categorias, letras, rodadas }) => {
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.hostId !== socket.id) return;

        sala.config = { categorias, letras, rodadas };
        sala.categoriasFila = [];
        sala.categoriasRodada = [];
        emitirJogadores(pin);
        socket.to(pin).emit('configAtualizada', { categorias, letras, rodadas });
    });

    socket.on('iniciarJogo', (pin) => {
        if (typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.hostId !== socket.id) return;

        iniciarRodadaInterna(pin, sala);
        broadcastEstadoSala(pin);
    });

    socket.on('enviarRespostasRodada', ({ pin, nome, respostas }) => {
        if (!pin || typeof pin !== 'string' || !respostas || typeof respostas !== 'object') return;
        registrarRespostasRodada(socket, pin, nome, respostas);
    });

    socket.on('enviarRespostas', ({ pin, nome, respostas }) => {
        if (!pin || typeof pin !== 'string' || !respostas || typeof respostas !== 'object') return;
        registrarRespostasRodada(socket, pin, nome, respostas);
    });

    socket.on('pressionarStop', ({ pin, nome, respostas }) => {
        if (!pin || typeof pin !== 'string' || !respostas || typeof respostas !== 'object') return;
        encerrarRodadaPorStop(socket, pin, nome, respostas);
    });

    socket.on('proximaRodada', (pin) => {
        if (typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.hostId !== socket.id) return;

        const totalRodadas = sala.config.rodadas || 8;
        if (sala.rodadaAtual >= totalRodadas) {
            sala.fase = 'finalizada';
            io.to(pin).emit('jogoFinalizado');
        } else {
            iniciarRodadaInterna(pin, sala);
            broadcastEstadoSala(pin);
        }
    });

    socket.on('votarPalavra', ({ pin, itemId, catId, chave, aceito }) => {
        if (!pin || typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (!sala.jogadores.some(j => j.id === socket.id)) return;

        const itemIdResolvido = itemId || (catId && chave ? `${catId}__${chave}` : null);
        if (!itemIdResolvido) return;
        if (!sala.votacaoAtiva || sala.votacaoAtiva.key !== itemIdResolvido) return;
        if (Object.prototype.hasOwnProperty.call(sala.votacaoAtiva.votos, socket.id)) return;

        sala.votacaoAtiva.votos[socket.id] = Boolean(aceito);

        io.to(pin).emit('votacaoAtualizada', {
            itemId: itemIdResolvido,
            catId: sala.votacaoAtiva.catId,
            chave: itemIdResolvido,
            votos: sala.votacaoAtiva.votos,
            totalJogadores: sala.jogadores.length
        });

        const totalVotos = Object.keys(sala.votacaoAtiva.votos).length;
        if (totalVotos >= sala.jogadores.length) {
            finalizarVotacaoItem(pin);
        }
    });

    socket.on('finalizarVerificacao', ({ pin }) => {
        if (!pin || typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.hostId !== socket.id) return;
        if (sala.votacaoAtiva) return;
        if (!sala.filaValidacao || sala.filaValidacao.length > 0) return;
        calcularPontuacaoRodada(pin);
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

        const eraHost = sala.hostId === socket.id;
        sala.jogadores = sala.jogadores.filter(j => j.id !== socket.id);
        if (sala.pontuacoes) {
            delete sala.pontuacoes[socket.id];
        }
        if (sala.respostasRodada) {
            delete sala.respostasRodada[socket.id];
        }

        if (sala.jogadores.length === 0) {
            salas.delete(pin);
            return;
        }

        if (eraHost && sala.jogadores[0]) {
            sala.hostId = sala.jogadores[0].id;
            io.to(sala.hostId).emit('voceEhHost');
        }

        emitirJogadores(pin);
    });
});

server.listen(PORT, () => {
    console.log(`✅  Servidor rodando em http://localhost:${PORT}`);
});

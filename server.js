'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3001;
const DEBUG_STOP = process.env.DEBUG_STOP === '1';

app.use(express.static(path.join(__dirname)));

const salas = new Map();
const TEMPO_VOTACAO_MS = 20000;
const GRACE_WINDOW_MS  = 1500;

function debugLog(...args) {
    if (!DEBUG_STOP) return;
    console.log('[DEBUG_STOP]', ...args);
}

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
        verificacaoCategoria: null,
        votacoesCategoria: {},
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

function obterItensCategoriaValidacao(sala, categoriaId) {
    return (sala.itensVerificacao || []).filter(item => item.catId === categoriaId);
}

function finalizarItemVotacaoCategoria(pin, sala, itemId) {
    if (!sala || !sala.votacoesCategoria[itemId]) return;
    const atual = sala.votacoesCategoria[itemId];
    if (atual.encerrada) return;

    const sim = Object.values(atual.votos).filter(Boolean).length;
    const nao = Object.values(atual.votos).filter(v => !v).length;
    const aceito = sim >= nao;

    atual.sim = sim;
    atual.nao = nao;
    atual.valido = aceito;
    atual.encerrada = true;

    sala.resultadosValidacao[itemId] = {
        key: atual.key,
        catId: atual.catId,
        categoria: atual.categoria,
        emoji: atual.emoji,
        texto: atual.texto,
        donos: atual.donos,
        quantidade: atual.quantidade,
        sim,
        nao,
        valido: aceito,
        votos: { ...atual.votos }
    };

    debugLog('votacao item finalizada', {
        pin,
        item: itemId,
        texto: atual.texto,
        sim,
        nao,
        aceito,
        categoria: atual.catId
    });

    io.to(pin).emit('votacaoItemEncerrada', {
        itemId,
        catId: atual.catId,
        chave: itemId,
        sim,
        nao,
        aceito
    });
}

function todasVotacoesCategoriaEncerradas(sala) {
    return Object.values(sala.votacoesCategoria || {}).every(item => item.encerrada);
}

function irParaProximaCategoriaVerificacao(pin, sala) {
    if (!sala || !sala.verificacaoCategoria) return;
    const proximoIndice = sala.verificacaoCategoria.indice + 1;
    iniciarCategoriaVerificacao(pin, sala, proximoIndice);
}

function encerrarCategoriaVerificacao(pin, sala) {
    if (!sala || !sala.verificacaoCategoria) return;

    const categoriaAtual = sala.verificacaoCategoria;
    if (categoriaAtual.timer) {
        clearTimeout(categoriaAtual.timer);
    }

    Object.keys(sala.votacoesCategoria || {}).forEach(itemId => {
        if (!sala.votacoesCategoria[itemId].encerrada) {
            finalizarItemVotacaoCategoria(pin, sala, itemId);
        }
    });

    io.to(pin).emit('categoriaVerificacaoEncerrada', {
        categoriaId: categoriaAtual.categoria.id,
        indice: categoriaAtual.indice,
        totalCategorias: sala.categoriasRodada.length
    });

    sala.verificacaoCategoria = null;
    sala.votacoesCategoria = {};

    if (categoriaAtual.indice >= sala.categoriasRodada.length - 1) {
        calcularPontuacaoRodada(pin);
        return;
    }

    setTimeout(() => irParaProximaCategoriaVerificacao(pin, sala), 600);
}

function iniciarCategoriaVerificacao(pin, sala, indiceCategoria) {
    if (!sala) return;

    const categoria = sala.categoriasRodada[indiceCategoria];
    if (!categoria) {
        calcularPontuacaoRodada(pin);
        return;
    }

    const itensCategoria = obterItensCategoriaValidacao(sala, categoria.id);
    const endsAt = Date.now() + TEMPO_VOTACAO_MS;

    sala.votacoesCategoria = {};
    itensCategoria.forEach(item => {
        sala.votacoesCategoria[item.key] = {
            ...item,
            votos: {},
            encerrada: false,
            sim: 0,
            nao: 0,
            valido: null
        };
    });

    const timer = setTimeout(() => {
        const atual = salas.get(pin);
        if (!atual) return;
        if (!atual.verificacaoCategoria) return;
        if (atual.verificacaoCategoria.indice !== indiceCategoria) return;
        encerrarCategoriaVerificacao(pin, atual);
    }, TEMPO_VOTACAO_MS);

    sala.verificacaoCategoria = {
        indice: indiceCategoria,
        categoria,
        startedAt: Date.now(),
        endsAt,
        timer
    };

    debugLog('categoria verificacao iniciada', {
        pin,
        indice: indiceCategoria,
        categoria: categoria.id,
        totalItens: itensCategoria.length,
        itens: itensCategoria.map(item => ({ key: item.key, texto: item.texto, donos: item.donos }))
    });

    io.to(pin).emit('categoriaVerificacaoIniciada', {
        indice: indiceCategoria,
        totalCategorias: sala.categoriasRodada.length,
        categoria,
        duracao: Math.floor(TEMPO_VOTACAO_MS / 1000),
        startedAt: sala.verificacaoCategoria.startedAt,
        endsAt,
        totalJogadores: sala.jogadores.length,
        itens: itensCategoria.map(item => ({
            key: item.key,
            catId: item.catId,
            categoria: item.categoria,
            emoji: item.emoji,
            texto: item.texto,
            donos: item.donos,
            quantidade: item.quantidade,
            votos: {},
            sim: 0,
            nao: 0,
            encerrada: false,
            valido: null
        }))
    });

    if (itensCategoria.length === 0) {
        encerrarCategoriaVerificacao(pin, sala);
    }
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

    debugLog('pontuacao rodada', {
        pin,
        rodada: sala.rodadaAtual,
        letra: sala.letraAtual,
        pontuacaoRodada,
        resultados: sala.resultadosValidacao
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
    if (sala.fase !== 'jogando' && sala.fase !== 'parando') return;
    if (!sala.jogadores.some(j => j.id === socket.id)) return;
    if (sala.respostasRodada[socket.id]) return;

    sala.respostasRodada[socket.id] = {
        id: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        respostas
    };

    debugLog('resposta registrada', {
        pin,
        jogador: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        fase: sala.fase,
        totalRecebidas: Object.keys(sala.respostasRodada).length,
        totalJogadores: sala.jogadores.length,
        respostas
    });

    io.to(pin).emit('respostasRodadaAtualizadas', { respostas: sala.respostasRodada });

    const submetidos = sala.jogadores.filter(j => sala.respostasRodada[j.id]).length;
    if (submetidos === sala.jogadores.length) {
        if (sala._stopTimer) {
            clearTimeout(sala._stopTimer);
            sala._stopTimer = null;
        }
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

    sala.fase = 'parando';
    sala.respostasRodada[socket.id] = {
        id: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        respostas
    };

    debugLog('stop acionado', {
        pin,
        jogador: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        respostas,
        totalRecebidas: Object.keys(sala.respostasRodada).length,
        totalJogadores: sala.jogadores.length
    });

    io.to(pin).emit('rodadaParando', {
        por: socket.id,
        nome: String(nome || '').trim().slice(0, 20),
        graceMs: GRACE_WINDOW_MS
    });

    sala._stopTimer = setTimeout(() => finalizarFaseParando(pin), GRACE_WINDOW_MS);

    // Fast-path: all players had already submitted before STOP
    const submetidos = sala.jogadores.filter(j => sala.respostasRodada[j.id]).length;
    if (submetidos === sala.jogadores.length) {
        clearTimeout(sala._stopTimer);
        sala._stopTimer = null;
        iniciarVerificacaoRodada(pin, sala);
    }
}

function finalizarFaseParando(pin) {
    const sala = salas.get(pin);
    if (!sala || sala.fase !== 'parando') return;
    sala._stopTimer = null;

    const categorias = sala.categoriasRodada || [];
    sala.jogadores.forEach(jogador => {
        if (!sala.respostasRodada[jogador.id]) {
            const respostasVazias = {};
            categorias.forEach(c => { respostasVazias[c.id] = ''; });
            sala.respostasRodada[jogador.id] = {
                id: jogador.id,
                nome: jogador.nome,
                respostas: respostasVazias
            };
        }
    });

    iniciarVerificacaoRodada(pin, sala);
}

function iniciarRodadaInterna(pin, sala) {
    if (sala._stopTimer) {
        clearTimeout(sala._stopTimer);
        sala._stopTimer = null;
    }
    sala.fase = 'jogando';
    sala.respostasRodada = {};
    sala.resultadosValidacao = {};
    sala.filaValidacao = [];
    sala.votacaoAtiva = null;
    sala.verificacaoCategoria = null;
    sala.votacoesCategoria = {};
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

    debugLog('verificacao iniciada', {
        pin,
        rodada: sala.rodadaAtual,
        letra: sala.letraAtual,
        totalSubmissoes: Object.keys(sala.respostasRodada).length,
        totalItens: sala.itensVerificacao.length,
        itens: sala.itensVerificacao.map(item => ({
            key: item.key,
            categoria: item.categoria,
            texto: item.texto,
            donos: item.donos,
            quantidade: item.quantidade
        }))
    });

    io.to(pin).emit('iniciarVerificacao', {
        rodadaAtual: sala.rodadaAtual,
        letraAtual: sala.letraAtual,
        categorias: sala.categoriasRodada,
        respostas: sala.respostasRodada,
        itens: sala.itensVerificacao,
        ranking: obterRankingSala(sala)
    });
    if (sala.itensVerificacao.length === 0) {
        calcularPontuacaoRodada(pin);
        return;
    }
    iniciarCategoriaVerificacao(pin, sala, 0);
}

function reconciliarSalaAposSaida(pin, sala) {
    if (!sala) return;

    if ((sala.fase === 'jogando' || sala.fase === 'parando')) {
        const submetidos = sala.jogadores.filter(j => sala.respostasRodada[j.id]).length;
        if (submetidos === sala.jogadores.length) {
            if (sala._stopTimer) {
                clearTimeout(sala._stopTimer);
                sala._stopTimer = null;
            }
            debugLog('reconciliando rodada apos saida', {
                pin,
                fase: sala.fase,
                submetidos,
                totalJogadores: sala.jogadores.length
            });
            iniciarVerificacaoRodada(pin, sala);
            return;
        }
    }

    if (sala.fase === 'verificacao' && sala.verificacaoCategoria) {
        Object.keys(sala.votacoesCategoria || {}).forEach(itemId => {
            const item = sala.votacoesCategoria[itemId];
            if (item.encerrada) return;
            const totalVotos = Object.keys(item.votos).length;
            if (totalVotos >= sala.jogadores.length) {
                finalizarItemVotacaoCategoria(pin, sala, itemId);
            }
        });

        if (todasVotacoesCategoriaEncerradas(sala)) {
            encerrarCategoriaVerificacao(pin, sala);
        }
    }
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
        if (sala.fase !== 'verificacao') return;

        const itemIdResolvido = itemId || (catId && chave ? `${catId}__${chave}` : null);
        if (!itemIdResolvido) return;
        const votoItem = sala.votacoesCategoria[itemIdResolvido];
        if (!votoItem) return;
        if (votoItem.encerrada) return;
        if (Object.prototype.hasOwnProperty.call(votoItem.votos, socket.id)) return;

        votoItem.votos[socket.id] = Boolean(aceito);
        votoItem.sim = Object.values(votoItem.votos).filter(Boolean).length;
        votoItem.nao = Object.values(votoItem.votos).filter(v => !v).length;

        io.to(pin).emit('votacaoItemAtualizada', {
            itemId: itemIdResolvido,
            catId: votoItem.catId,
            chave: itemIdResolvido,
            votos: votoItem.votos,
            sim: votoItem.sim,
            nao: votoItem.nao,
            totalJogadores: sala.jogadores.length
        });

        const totalVotos = Object.keys(votoItem.votos).length;
        if (totalVotos >= sala.jogadores.length) {
            finalizarItemVotacaoCategoria(pin, sala, itemIdResolvido);
        }

        if (todasVotacoesCategoriaEncerradas(sala)) {
            encerrarCategoriaVerificacao(pin, sala);
        }
    });

    socket.on('finalizarVerificacao', ({ pin }) => {
        if (!pin || typeof pin !== 'string') return;
        const sala = salas.get(pin);
        if (!sala) return;
        if (sala.hostId !== socket.id) return;
        if (sala.fase !== 'verificacao') return;
        encerrarCategoriaVerificacao(pin, sala);
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

        debugLog('jogador saiu', {
            pin,
            jogador: socket.id,
            eraHost,
            fase: sala.fase,
            jogadoresRestantes: sala.jogadores.map(j => j.id)
        });

        if (sala.jogadores.length === 0) {
            salas.delete(pin);
            return;
        }

        if (eraHost && sala.jogadores[0]) {
            sala.hostId = sala.jogadores[0].id;
            io.to(sala.hostId).emit('voceEhHost');
        }

        reconciliarSalaAposSaida(pin, sala);
        emitirJogadores(pin);
    });
});

server.listen(PORT, () => {
    console.log(`✅  Servidor rodando em http://localhost:${PORT}`);
});

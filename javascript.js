const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const socket = io();
let meuNome = '';
let meuPin = '';
let souHost = false;

const AVATAR_CORES = [
    '#f97316', '#22c55e', '#3b82f6', '#ec4899',
    '#a855f7', '#14b8a6', '#eab308', '#ef4444', '#06b6d4', '#84cc16'
];

const CATEGORIAS_PADRAO = [
    { id: 'nome', label: 'Nome', emoji: '👤' },
    { id: 'animal', label: 'Animal', emoji: '🐾' },
    { id: 'cor', label: 'Cor', emoji: '🎨' },
    { id: 'cidade', label: 'Cidade', emoji: '🏙️' },
    { id: 'fruta', label: 'Fruta', emoji: '🍎' },
    { id: 'objeto', label: 'Objeto', emoji: '📦' },
    { id: 'pais', label: 'País', emoji: '🌍' },
    { id: 'filme', label: 'Filme', emoji: '🎬' },
    { id: 'marca', label: 'Marca', emoji: '🏷️' },
    { id: 'comida', label: 'Comida', emoji: '🍽️' },
    { id: 'profissao', label: 'Profissão', emoji: '💼' },
    { id: 'esporte', label: 'Esporte', emoji: '⚽' },
    { id: 'mse', label: 'MSÉ', emoji: '👵' },
    { id: 'personagem', label: 'Personagem', emoji: '🧑' },
    { id: 'musica', label: 'Música', emoji: '🎵' },
    { id: 'desculpa', label: 'Desculpa esfarrapada', emoji: '🤷‍♂️' },
    { id: 'demissao', label: 'Motivo para ser demitido', emoji: '🤷' },
    { id: 'xingamento', label: 'Xingamento', emoji: '🤬' }
];

const TEMPO_TOTAL = 60;
const CATS_POR_RODADA = 5;
const DEBUG_STOP = new URLSearchParams(window.location.search).get('debug') === '1';

let categoriasAtivas = [];
let letrasAtivas = new Set([...LETRAS]);
let totalRodadas = 8;
let rodadaAtual = 0;
let pontuacaoAcumulada = 0;
let historicoRodadas = [];
let letrasUsadas = [];
let letraAtual = '';
let timerInterval = null;
let tempoRestante = TEMPO_TOTAL;
let jogoAtivo = false;
let respostasJogo = {};
let respostasRodadaSala = {};
let categoriasRodada = [];
let categoriasFila = [];
let indiceVerificacaoAtual = 0;
let categoriaTimerInterval = null;

const estadoServidor = {
    leaderboard: [],
    verificacao: null,
    categoriaAtual: null,
    rodadaFinal: null,
    resultadosValidacao: {}
};

function debugLog(...args) {
    if (!DEBUG_STOP) return;
    console.log('[DEBUG_STOP_CLIENT]', ...args);
}

function normalizarTexto(texto) {
    return String(texto || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function escaparHtml(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function embaralhar(arr) {
    const copia = [...arr];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function selecionarCategoriasDaRodada(pool) {
    if (pool.length <= CATS_POR_RODADA) return [...pool];
    if (categoriasFila.length === 0) {
        categoriasFila = embaralhar(pool);
    }
    const selecionadas = categoriasFila.splice(0, CATS_POR_RODADA);
    if (selecionadas.length < CATS_POR_RODADA) {
        categoriasFila = embaralhar(pool);
        selecionadas.push(...categoriasFila.splice(0, CATS_POR_RODADA - selecionadas.length));
    }
    return selecionadas;
}

function mostrarTela(id) {
    document.querySelectorAll('.tela').forEach(tela => tela.classList.remove('ativa'));
    document.getElementById(id)?.classList.add('ativa');
}

function sacudir(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
}

function emitirConfigSeModoOnline() {
    if (!meuPin || !souHost) return;
    socket.emit('atualizarConfig', {
        pin: meuPin,
        categorias: categoriasAtivas,
        letras: [...letrasAtivas],
        rodadas: totalRodadas
    });
}

function enviarChat() {
    const input = document.getElementById('chat-input');
    if (!input || !meuPin) return;
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chatMsg', { pin: meuPin, nome: meuNome, msg });
    input.value = '';
}

function adicionarMensagemChat(nome, msg) {
    const lista = document.getElementById('chat-lista');
    if (!lista) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const nomeSpan = document.createElement('span');
    nomeSpan.className = 'chat-nome';
    nomeSpan.textContent = `${nome}:`;
    div.appendChild(nomeSpan);
    div.appendChild(document.createTextNode(` ${msg}`));
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
}

function renderLobby(jogadores) {
    const lista = document.getElementById('lobby-lista');
    const count = document.getElementById('lobby-count');
    const ranking = [...(jogadores || [])];
    if (count) count.textContent = `${ranking.length}/10`;
    if (!lista) return;

    let html = '';
    for (let i = 0; i < 10; i++) {
        const jogador = ranking[i];
        if (jogador) {
            const cor = AVATAR_CORES[i % AVATAR_CORES.length];
            const inicial = jogador.nome.charAt(0).toUpperCase();
            const isHost = Boolean(jogador.host);
            const souEu = jogador.id === socket.id;
            html += `
                <div class="lobby-jogador${souEu ? ' lobby-eu' : ''}">
                    <div class="lobby-avatar" style="background:${cor}">${inicial}</div>
                    <span class="lobby-nome">${escaparHtml(jogador.nome)}${souEu ? ' <em class="lobby-voce">(você)</em>' : ''}</span>
                    ${isHost ? '<span class="lobby-coroa" title="Host">👑</span>' : ''}
                    <span class="lobby-pts">⭐ ${jogador.pontos || 0}</span>
                </div>`;
        } else {
            html += `
                <div class="lobby-jogador lobby-vazio">
                    <div class="lobby-avatar" style="background:#2a2a5a">👤</div>
                    <span class="lobby-nome">Disponível</span>
                </div>`;
        }
    }

    lista.innerHTML = html;
}

function renderCategoriasSetup() {
    const container = document.getElementById('lista-categorias-setup');
    const estadoVazio = document.getElementById('cat-estado-vazio');
    const count = document.getElementById('cat-count');
    const podeEditar = !meuPin || souHost;

    if (!container) return;
    if (count) count.textContent = `(${categoriasAtivas.length})`;
    if (estadoVazio) estadoVazio.style.display = categoriasAtivas.length === 0 ? 'flex' : 'none';

    container.innerHTML = categoriasAtivas.map(categoria => `
        <div class="chip-categoria" id="chip-${categoria.id}">
            <span>${categoria.emoji} ${escaparHtml(categoria.label)}</span>
            ${podeEditar ? `<button class="chip-remover" onclick="removerCategoria('${categoria.id}')" aria-label="Remover ${escaparHtml(categoria.label)}">×</button>` : ''}
        </div>
    `).join('');

    const acoes = document.getElementById('painel-cat-acoes');
    const addArea = document.getElementById('adicionar-cat-area');
    const rodadasHost = document.getElementById('rodadas-host');
    const rodadasDisp = document.getElementById('rodadas-display');
    if (acoes) acoes.style.display = podeEditar ? 'flex' : 'none';
    if (addArea) addArea.style.display = podeEditar ? 'flex' : 'none';
    if (rodadasHost) rodadasHost.style.display = podeEditar ? 'block' : 'none';
    if (rodadasDisp) rodadasDisp.style.display = podeEditar ? 'none' : 'block';
}

function renderLetrasSetup() {
    const grid = document.getElementById('letras-grid');
    const count = document.getElementById('letras-count');
    const podeEditar = !meuPin || souHost;
    if (!grid) return;
    if (count) count.textContent = `(${letrasAtivas.size})`;

    grid.innerHTML = [...LETRAS].map(letra => `
        <button type="button" class="letra-btn ${letrasAtivas.has(letra) ? 'ativa' : 'inativa'}"
                ${podeEditar ? `onclick="toggleLetra('${letra}')"` : 'disabled'}>${letra}</button>
    `).join('');
}

function resetarCategorias() {
    if (meuPin && !souHost) return;
    categoriasAtivas = CATEGORIAS_PADRAO.map(categoria => ({ ...categoria }));
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function limparCategorias() {
    if (meuPin && !souHost) return;
    categoriasAtivas = [];
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function toggleLetra(letra) {
    if (meuPin && !souHost) return;
    if (letrasAtivas.has(letra)) {
        if (letrasAtivas.size <= 1) return;
        letrasAtivas.delete(letra);
    } else {
        letrasAtivas.add(letra);
    }
    renderLetrasSetup();
    emitirConfigSeModoOnline();
}

function adicionarCategoria() {
    const input = document.getElementById('nova-categoria');
    if (!input) return;
    const nome = input.value.trim();
    if (!nome) return;

    if (categoriasAtivas.some(categoria => categoria.label.toLowerCase() === nome.toLowerCase())) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
    }

    categoriasAtivas.push({
        id: `cat_${Date.now()}`,
        label: nome,
        emoji: '📝'
    });
    input.value = '';
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function removerCategoria(id) {
    if (meuPin && !souHost) return;
    categoriasAtivas = categoriasAtivas.filter(categoria => categoria.id !== id);
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function renderCategoriasJogo() {
    const container = document.getElementById('categorias-jogo');
    if (!container) return;

    container.innerHTML = categoriasRodada.map(categoria => `
        <div class="categoria">
            <label for="${categoria.id}">${categoria.emoji} ${escaparHtml(categoria.label)}</label>
            <input type="text" id="${categoria.id}" placeholder="${escaparHtml(categoria.label)} com a letra..." autocomplete="off">
        </div>
    `).join('');
}

function atualizarTimer() {
    const el = document.getElementById('timer');
    if (!el) return;
    el.textContent = String(tempoRestante);
    el.classList.toggle('urgente', tempoRestante <= 10);
}

function iniciarJogo(letraForcada = null, categoriasForcadas = null) {
    if (letraForcada) {
        letraAtual = letraForcada;
        rodadaAtual += 1;
        categoriasRodada = Array.isArray(categoriasForcadas) && categoriasForcadas.length
            ? categoriasForcadas
            : selecionarCategoriasDaRodada(categoriasAtivas);
    } else {
        if (categoriasAtivas.length < 2) {
            sacudir('btn-iniciar-online');
            return;
        }
        if (letrasAtivas.size === 0) return;
        const disponiveis = [...letrasAtivas].filter(letra => !letrasUsadas.includes(letra));
        const pool = disponiveis.length > 0 ? disponiveis : [...letrasAtivas];
        letraAtual = pool[Math.floor(Math.random() * pool.length)];
        letrasUsadas.push(letraAtual);
        rodadaAtual += 1;
        categoriasRodada = selecionarCategoriasDaRodada(categoriasAtivas);
    }

    const letraDisplay = document.getElementById('letra-display');
    if (letraDisplay) letraDisplay.textContent = letraAtual || '?';

    renderCategoriasJogo();

    tempoRestante = TEMPO_TOTAL;
    atualizarTimer();
    jogoAtivo = true;
    respostasJogo = {};
    respostasRodadaSala = {};
    indiceVerificacaoAtual = 0;
    estadoServidor.verificacao = null;
    estadoServidor.categoriaAtual = null;
    estadoServidor.resultadosValidacao = {};
    clearInterval(categoriaTimerInterval);

    const stopBtn = document.getElementById('btn-stop');
    if (stopBtn) stopBtn.disabled = false;

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        tempoRestante -= 1;
        atualizarTimer();
        if (tempoRestante <= 0) pararJogo('tempo');
    }, 1000);

    mostrarTela('tela-jogo');
    if (categoriasRodada[0]) {
        document.getElementById(categoriasRodada[0].id)?.focus();
    }
}

function coletarRespostasAtuais() {
    const respostas = {};
    categoriasRodada.forEach(categoria => {
        const input = document.getElementById(categoria.id);
        respostas[categoria.id] = input ? input.value.trim() : '';
        if (input) input.disabled = true;
    });
    respostasJogo = respostas;
    return respostas;
}

function pararJogo(origem = 'stop') {
    if (!jogoAtivo) return;
    jogoAtivo = false;
    clearInterval(timerInterval);

    const respostas = coletarRespostasAtuais();

    debugLog('parar jogo', {
        origem,
        meuPin,
        rodadaAtual,
        letraAtual,
        respostas
    });

    if (meuPin && origem === 'stop') {
        socket.emit('pressionarStop', {
            pin: meuPin,
            nome: meuNome,
            respostas,
            rodada: rodadaAtual,
            letra: letraAtual
        });
        return;
    }

    if (meuPin) {
        socket.emit('enviarRespostasRodada', {
            pin: meuPin,
            nome: meuNome,
            respostas,
            rodada: rodadaAtual,
            letra: letraAtual
        });
        return;
    }

    iniciarVerificacao();
}

function obterSubmissoesRodada() {
    if (!meuPin) {
        return [{ id: 'local', nome: meuNome || 'Jogador', respostas: respostasJogo }];
    }

    return Object.values(estadoServidor.verificacao?.respostas || respostasRodadaSala || {});
}

function agruparRespostasCategoriaLocal(categoriaId) {
    const grupos = new Map();

    obterSubmissoesRodada().forEach(submissao => {
        const textoOriginal = String(submissao.respostas?.[categoriaId] || '').trim();
        if (!textoOriginal) return;

        const chave = normalizarTexto(textoOriginal);
        if (!grupos.has(chave)) {
            grupos.set(chave, { texto: textoOriginal, quantidade: 0 });
        }

        grupos.get(chave).quantidade += 1;
    });

    return [...grupos.values()];
}

function calcularPontuacaoJogadorLocal(respostasJogador) {
    let total = 0;
    categoriasRodada.forEach(categoria => {
        const textoOriginal = String(respostasJogador?.[categoria.id] || '').trim();
        if (!textoOriginal) return;
        const grupo = agruparRespostasCategoriaLocal(categoria.id)
            .find(item => normalizarTexto(item.texto) === normalizarTexto(textoOriginal));
        if (!grupo) return;
        total += grupo.quantidade > 1 ? 5 : 10;
    });
    return total;
}

function iniciarVerificacao() {
    indiceVerificacaoAtual = 0;
    if (meuPin) {
        if (!estadoServidor.verificacao) return;
        renderCategoriaVerificacao();
        mostrarTela('tela-verificacao');
        return;
    }

    renderCategoriaVerificacao();
    mostrarTela('tela-verificacao');
}

function obterRespostasServidor() {
    return estadoServidor.verificacao?.respostas || respostasRodadaSala || {};
}

function obterAutoresItem(item) {
    const respostas = obterRespostasServidor();
    const autores = (item.donos || []).map(id => respostas[id]?.nome || 'Jogador');
    return autores.length > 0 ? autores : ['Jogador'];
}

function obterItensVerificacaoCategoria(categoriaId) {
    const itensServidor = estadoServidor.categoriaAtual?.itens || [];
    return itensServidor
        .filter(item => item.catId === categoriaId)
        .map(item => ({
            ...item,
            autores: obterAutoresItem(item)
        }));
}

function agruparRespostasServidor(categoriaId) {
    return obterItensVerificacaoCategoria(categoriaId);
}

function obterClasseValidacao(status) {
    if (status === 'aceito') return 'aceito';
    if (status === 'negado') return 'negado';
    return 'pendente';
}

function obterRotuloValidacao(status) {
    if (status === 'aceito') return 'ACEITA';
    if (status === 'negado') return 'REJEITADA';
    return 'AGUARDANDO VOTO';
}

function obterStatusItem(item) {
    if (item.valido === true) return 'aceito';
    if (item.valido === false) return 'negado';
    return 'pendente';
}

function obterVotosTotal(item) {
    return (item.sim || 0) + (item.nao || 0);
}

function getClasseDestaque(item, maxVotos) {
    const totalVotos = obterVotosTotal(item);
    if (maxVotos === 0) return '';
    if (totalVotos === maxVotos) return ' destaque';
    return '';
}

function atualizarTimerCategoriaUI() {
    const el = document.getElementById('ver-btn-avancar');
    if (!el || !estadoServidor.categoriaAtual?.endsAt) return;
    const restante = Math.max(0, Math.ceil((estadoServidor.categoriaAtual.endsAt - Date.now()) / 1000));
    el.textContent = `Tempo: ${restante}s`;
}

function renderCategoriaVerificacao() {
    const categoriasVerificacao = estadoServidor.verificacao?.categorias || categoriasRodada;
    const total = categoriasVerificacao.length;
    const categoria = meuPin
        ? estadoServidor.categoriaAtual?.categoria
        : categoriasVerificacao[indiceVerificacaoAtual];
    const container = document.getElementById('ver-chips-container');

    if (!categoria || !container) return;

    const idx = document.getElementById('ver-progresso-idx');
    const ttl = document.getElementById('ver-progresso-total');
    const nome = document.getElementById('ver-categoria-nome');
    if (idx) idx.textContent = String(meuPin ? ((estadoServidor.categoriaAtual?.indice ?? 0) + 1) : (indiceVerificacaoAtual + 1));
    if (ttl) ttl.textContent = String(total);
    if (nome) nome.textContent = categoria.label.toUpperCase();

    if (!meuPin) {
        const respostasLocais = agruparRespostasCategoriaLocal(categoria.id);
        container.innerHTML = respostasLocais.length
            ? respostasLocais.map(item => `
                <div class="ver-chip-wrapper">
                    <span class="resposta-chip aceito">${escaparHtml(item.texto)}</span>
                    <span class="ver-autores">${item.quantidade > 1 ? `${item.quantidade} jogadores` : '1 jogador'}</span>
                </div>`).join('')
            : '<div class="ver-vazio">Sem respostas</div>';
    } else {
        const respostas = agruparRespostasServidor(categoria.id);
        const maxVotos = respostas.reduce((max, item) => Math.max(max, obterVotosTotal(item)), 0);
        container.innerHTML = respostas.length
            ? respostas.map(item => {
                const status = obterStatusItem(item);
                const classe = obterClasseValidacao(status);
                const votos = `<span class="vot-info">${item.sim || 0}✓ ${item.nao || 0}✗ · ${obterVotosTotal(item)} votos</span>`;
                const votei = Object.prototype.hasOwnProperty.call(item.votos || {}, socket.id);
                const desabilitado = item.encerrada ? 'disabled' : (votei ? 'disabled' : '');
                const classeFinalizada = item.encerrada ? ' encerrada' : '';
                return `
                    <div class="ver-chip-wrapper item-votacao${classeFinalizada}${getClasseDestaque(item, maxVotos)}">
                        <span class="resposta-chip ${classe}">${escaparHtml(item.texto)}</span>
                        <span class="chip-label-status">${obterRotuloValidacao(status)}</span>
                        <span class="ver-autores">${escaparHtml(item.autores.join(', '))}</span>
                        ${votos}
                        <div class="voto-acoes">
                            <button class="voto-item-btn voto-item-sim" onclick="votarItemValidacao('${item.key}', true)" ${desabilitado}>Válido</button>
                            <button class="voto-item-btn voto-item-nao" onclick="votarItemValidacao('${item.key}', false)" ${desabilitado}>Inválido</button>
                        </div>
                    </div>`;
            }).join('')
            : '<div class="ver-vazio">Sem respostas</div>';
    }

    const prev = document.getElementById('ver-btn-prev');
    const avancar = document.getElementById('ver-btn-avancar');
    if (prev) prev.style.visibility = !meuPin && indiceVerificacaoAtual > 0 ? 'visible' : 'hidden';
    if (avancar) {
        if (!meuPin) {
            avancar.textContent = indiceVerificacaoAtual < total - 1 ? '→' : 'CONFIRMAR';
        } else {
            avancar.textContent = 'Tempo: --s';
        }
    }

    if (meuPin) {
        clearInterval(categoriaTimerInterval);
        atualizarTimerCategoriaUI();
        categoriaTimerInterval = setInterval(() => {
            atualizarTimerCategoriaUI();
        }, 250);
    }
}

function navVerificacao(delta) {
    if (meuPin) return;
    const total = (estadoServidor.verificacao?.categorias || categoriasRodada).length;
    if (total === 0) return;
    if (delta > 0 && indiceVerificacaoAtual >= total - 1) {
        confirmarVerificacao();
        return;
    }
    indiceVerificacaoAtual = Math.max(0, Math.min(total - 1, indiceVerificacaoAtual + delta));
    renderCategoriaVerificacao();
}

function mostrarPainelVotacao(item, duracao, totalJogadores, endsAt) {
    return;
}

function atualizarContadorVotos(itemId, votos, totalJogadores) {
    return;
}

function mostrarResultadoVotacao(itemId, sim, nao, aceito) {
    return;
}

function votarPalavra(catId, chave, aceito) {
    if (!meuPin) return;
    socket.emit('votarPalavra', {
        pin: meuPin,
        itemId: `${catId}__${chave}`,
        aceito
    });
}

function votarItemValidacao(itemId, aceito) {
    if (!meuPin) return;
    socket.emit('votarPalavra', {
        pin: meuPin,
        itemId,
        aceito
    });
}

function confirmarVerificacao() {
    if (meuPin && souHost) {
        socket.emit('finalizarVerificacao', { pin: meuPin });
        return;
    }

    if (!meuPin) {
        let pontuacao = 0;
        let html = '';

        categoriasRodada.forEach(categoria => {
            const respostas = agruparRespostasCategoriaLocal(categoria.id);
            const minhaResposta = String(respostasJogo?.[categoria.id] || '').trim();
            const grupo = respostas.find(item => normalizarTexto(item.texto) === normalizarTexto(minhaResposta));
            const meusPts = grupo ? (grupo.quantidade > 1 ? 5 : 10) : 0;
            pontuacao += meusPts;

            const chips = respostas.length
                ? respostas.map(item => `<span class="resposta-chip aceito">${escaparHtml(item.texto)}</span>`).join('')
                : '<span class="resposta-chip negado resposta-vazia">(vazio)</span>';

            html += `
                <li class="resultado-card">
                    <div class="resultado-cabecalho">
                        <strong>${escaparHtml(categoria.label)}</strong>
                        <span class="pts">${meusPts} pts</span>
                    </div>
                    <div class="ver-respostas">${chips}</div>
                </li>`;
        });

        const max = categoriasRodada.length * 10;
        pontuacaoAcumulada += pontuacao;
        historicoRodadas.push({ rodada: rodadaAtual, letra: letraAtual, pontuacao, max });

        const placarHtml = obterSubmissoesRodada().map(jogador => {
            const pts = calcularPontuacaoJogadorLocal(jogador.respostas);
            const souEu = jogador.id === socket.id || jogador.id === 'local';
            return `<div class="placar-linha${souEu ? ' placar-eu' : ''}">
                <span class="placar-nome">${escaparHtml(jogador.nome)}</span>
                <span class="placar-pts">${pts} pts</span>
            </div>`;
        }).join('');

        const placar = document.getElementById('placar-jogadores');
        if (placar) placar.innerHTML = placarHtml;

        const letraUsada = document.getElementById('letra-usada');
        if (letraUsada) letraUsada.textContent = `Letra da rodada: ${letraAtual}`;

        const resultadoLista = document.getElementById('resultado-lista');
        if (resultadoLista) resultadoLista.innerHTML = html;

        const pontuacaoTotal = document.getElementById('pontuacao-total');
        if (pontuacaoTotal) {
            pontuacaoTotal.innerHTML = `Pontuação desta rodada: <strong>${pontuacao}</strong> / ${max}`;
        }

        const infoRodada = document.getElementById('info-rodada');
        if (infoRodada) {
            infoRodada.textContent = `Rodada ${rodadaAtual} de ${totalRodadas} · Total acumulado: ${pontuacaoAcumulada} pts`;
        }

        mostrarTela('tela-resultado');
    }
}

function renderResultadoRodada(payload) {
    const ranking = payload?.ranking || estadoServidor.leaderboard || [];
    const pontuacoesRodada = payload?.pontuacaoRodada || {};

    const htmlRanking = ranking.map(jogador => `
        <div class="placar-linha${jogador.id === socket.id ? ' placar-eu' : ''}">
            <span class="placar-nome">${escaparHtml(jogador.nome)}</span>
            <span class="placar-pts">${jogador.pontos || 0} pts</span>
        </div>`).join('');

    const rodadaHtml = Object.entries(pontuacoesRodada).map(([id, pontos]) => {
        const jogador = ranking.find(item => item.id === id);
        return `
            <li class="final-item">
                <span class="final-rodada-num">${escaparHtml(jogador?.nome || 'Jogador')}</span>
                <span class="final-pts">${pontos} pts</span>
            </li>`;
    }).join('');

    const placar = document.getElementById('placar-jogadores');
    if (placar) placar.innerHTML = htmlRanking;

    const resultadoLista = document.getElementById('resultado-lista');
    if (resultadoLista) resultadoLista.innerHTML = rodadaHtml;

    const letraUsada = document.getElementById('letra-usada');
    if (letraUsada) letraUsada.textContent = `Letra da rodada: ${payload?.letraAtual || letraAtual}`;

    const pontuacaoTotal = document.getElementById('pontuacao-total');
    if (pontuacaoTotal) pontuacaoTotal.innerHTML = 'Pontuação atualizada no leaderboard';

    const infoRodada = document.getElementById('info-rodada');
    if (infoRodada) {
        infoRodada.textContent = `Rodada ${payload?.rodadaAtual || rodadaAtual} de ${payload?.totalRodadas || totalRodadas}`;
    }

    estadoServidor.leaderboard = ranking;
    pontuacaoAcumulada = ranking.find(jogador => jogador.id === socket.id)?.pontos || 0;
}

function proximaRodadaOuFim() {
    if (meuPin) {
        if (souHost) socket.emit('proximaRodada', meuPin);
        return;
    }

    if (rodadaAtual < totalRodadas) {
        iniciarJogo();
    } else {
        mostrarResultadoFinal();
    }
}

function mostrarResultadoFinal() {
    const ranking = estadoServidor.rodadaFinal?.ranking || estadoServidor.leaderboard || [];
    const total = document.getElementById('final-total');
    const lista = document.getElementById('final-historico');

    if (lista) {
        lista.innerHTML = ranking.map((jogador, index) => `
            <li class="final-item">
                <span class="final-rodada-num">${index + 1}º</span>
                <span class="final-letra">${escaparHtml(jogador.nome)}</span>
                <span class="final-pts">${jogador.pontos || 0} pts</span>
            </li>`).join('');
    }

    if (total) {
        total.innerHTML = ranking.map(jogador => `${escaparHtml(jogador.nome)}: ${jogador.pontos || 0} pts`).join('<br>');
    }

    mostrarTela('tela-final');
}

function reiniciar() {
    rodadaAtual = 0;
    pontuacaoAcumulada = 0;
    historicoRodadas = [];
    letrasUsadas = [];
    categoriasFila = [];
    categoriasRodada = [];
    respostasJogo = {};
    respostasRodadaSala = {};
    indiceVerificacaoAtual = 0;
    estadoServidor.verificacao = null;
    estadoServidor.categoriaAtual = null;
    estadoServidor.rodadaFinal = null;
    estadoServidor.resultadosValidacao = {};
    clearInterval(categoriaTimerInterval);
    mostrarTela(meuPin ? 'tela-sala' : 'tela-nome');
}

function criarSala() {
    const nome = document.getElementById('input-nome')?.value.trim();
    if (!nome) {
        sacudir('input-nome');
        return;
    }
    meuNome = nome;
    socket.emit('criarSala', { nome });
}

function entrarSalaPIN() {
    const nome = document.getElementById('input-nome')?.value.trim();
    const pin = document.getElementById('input-pin')?.value.trim();
    if (!nome) {
        sacudir('input-nome');
        return;
    }
    if (!pin) {
        sacudir('input-pin');
        return;
    }
    meuNome = nome;
    socket.emit('entrarSala', { pin, nome });
}

function iniciarJogoOnline() {
    socket.emit('iniciarJogo', meuPin);
}

document.addEventListener('DOMContentLoaded', () => {
    resetarCategorias();
    renderLetrasSetup();
    document.getElementById('nova-categoria')?.addEventListener('keydown', evento => {
        if (evento.key === 'Enter') adicionarCategoria();
    });
});

socket.on('salaCriada', pin => {
    meuPin = pin;
    souHost = true;
    document.getElementById('lobby-pin').textContent = pin;
    document.getElementById('btn-iniciar-online').style.display = 'block';
    document.getElementById('lobby-aguardando').style.display = 'none';
    renderCategoriasSetup();
    renderLetrasSetup();
    emitirConfigSeModoOnline();
    mostrarTela('tela-sala');
});

socket.on('entradaSucesso', pin => {
    meuPin = pin;
    souHost = false;
    document.getElementById('lobby-pin').textContent = pin;
    renderCategoriasSetup();
    renderLetrasSetup();
    mostrarTela('tela-sala');
});

socket.on('atualizarJogadores', jogadores => {
    renderLobby(jogadores);
});

socket.on('voceEhHost', () => {
    souHost = true;
    document.getElementById('btn-iniciar-online').style.display = 'block';
    document.getElementById('lobby-aguardando').style.display = 'none';
    renderCategoriasSetup();
    renderLetrasSetup();
});

socket.on('jogoIniciado', ({ letra, categorias, rodadaAtual: rodada, totalRodadas: total }) => {
    if (rodada !== undefined) rodadaAtual = rodada - 1;
    if (total !== undefined) totalRodadas = total;
    iniciarJogo(letra, categorias);
});

socket.on('jogoFinalizado', () => {
    mostrarResultadoFinal();
});

socket.on('erroEntrada', msg => {
    const el = document.getElementById('erro-sala');
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => {
        el.textContent = '';
    }, 3500);
});

socket.on('configAtualizada', ({ categorias, letras, rodadas }) => {
    categoriasAtivas = categorias;
    letrasAtivas = new Set(letras);
    totalRodadas = rodadas;
    renderCategoriasSetup();
    renderLetrasSetup();
    const disp = document.getElementById('rodadas-display');
    if (disp) disp.textContent = `${rodadas} Rodada${rodadas !== 1 ? 's' : ''}`;
});

socket.on('chatMsg', ({ nome, msg }) => {
    adicionarMensagemChat(nome, msg);
});

socket.on('respostasRodadaAtualizadas', ({ respostas }) => {
    respostasRodadaSala = respostas || {};
    debugLog('respostasRodadaAtualizadas', {
        total: Object.keys(respostasRodadaSala).length,
        jogadores: Object.values(respostasRodadaSala).map(item => ({
            id: item.id,
            nome: item.nome,
            respostas: item.respostas
        }))
    });
    if (document.getElementById('tela-verificacao')?.classList.contains('ativa')) {
        renderCategoriaVerificacao();
    }
});

socket.on('rodadaParando', () => {
    if (!jogoAtivo) return;

    jogoAtivo = false;
    clearInterval(timerInterval);

    const respostasParciais = coletarRespostasAtuais();
    debugLog('rodadaParando', {
        meuPin,
        rodadaAtual,
        respostasParciais
    });
    socket.emit('enviarRespostas', {
        pin: meuPin,
        nome: meuNome,
        respostas: respostasParciais
    });

    const stopBtn = document.getElementById('btn-stop');
    if (stopBtn) stopBtn.disabled = true;
    const timerEl = document.getElementById('timer');
    if (timerEl) {
        timerEl.textContent = 'STOP!';
        timerEl.classList.remove('urgente');
    }
});

socket.on('leaderboardAtualizado', ranking => {
    estadoServidor.leaderboard = ranking || [];
    renderLobby(estadoServidor.leaderboard);
});

socket.on('iniciarVerificacao', payload => {
    estadoServidor.verificacao = payload || null;
    estadoServidor.categoriaAtual = null;
    estadoServidor.resultadosValidacao = {};
    indiceVerificacaoAtual = 0;
    clearInterval(categoriaTimerInterval);
    debugLog('iniciarVerificacao', {
        rodadaAtual: payload?.rodadaAtual,
        letraAtual: payload?.letraAtual,
        totalRespostas: Object.keys(payload?.respostas || {}).length,
        totalItens: (payload?.itens || []).length,
        itens: (payload?.itens || []).map(item => ({
            key: item.key,
            categoria: item.categoria,
            texto: item.texto,
            donos: item.donos,
            quantidade: item.quantidade
        }))
    });
    renderCategoriaVerificacao();
    mostrarTela('tela-verificacao');
});

socket.on('categoriaVerificacaoIniciada', payload => {
    estadoServidor.categoriaAtual = {
        ...payload,
        itens: [...(payload?.itens || [])]
    };
    indiceVerificacaoAtual = payload?.indice || 0;
    debugLog('categoriaVerificacaoIniciada', {
        indice: payload?.indice,
        categoria: payload?.categoria,
        totalItens: (payload?.itens || []).length,
        totalJogadores: payload?.totalJogadores
    });
    renderCategoriaVerificacao();
});

socket.on('votacaoItemAtualizada', ({ itemId, votos, sim, nao, totalJogadores }) => {
    const item = estadoServidor.categoriaAtual?.itens?.find(i => i.key === itemId);
    if (!item) return;
    item.votos = votos || {};
    item.sim = sim ?? Object.values(item.votos).filter(Boolean).length;
    item.nao = nao ?? Object.values(item.votos).filter(v => !v).length;
    debugLog('votacaoItemAtualizada', { itemId, sim: item.sim, nao: item.nao, totalJogadores });
    renderCategoriaVerificacao();
});

socket.on('votacaoItemEncerrada', ({ itemId, sim, nao, aceito }) => {
    const item = estadoServidor.categoriaAtual?.itens?.find(i => i.key === itemId);
    if (item) {
        item.sim = sim;
        item.nao = nao;
        item.valido = aceito;
        item.encerrada = true;
        estadoServidor.resultadosValidacao[itemId] = {
            ...item,
            sim,
            nao,
            valido: aceito,
            votos: { ...(item.votos || {}) }
        };
    }
    debugLog('votacaoItemEncerrada', { itemId, sim, nao, aceito });
    renderCategoriaVerificacao();
});

socket.on('categoriaVerificacaoEncerrada', ({ categoriaId, indice, totalCategorias }) => {
    debugLog('categoriaVerificacaoEncerrada', { categoriaId, indice, totalCategorias });
    clearInterval(categoriaTimerInterval);
    const avancar = document.getElementById('ver-btn-avancar');
    if (avancar) avancar.textContent = 'Aguardando próxima categoria...';
});

socket.on('rodadaFinalizada', payload => {
    clearInterval(categoriaTimerInterval);
    estadoServidor.rodadaFinal = payload || null;
    estadoServidor.leaderboard = payload?.ranking || [];
    renderResultadoRodada(payload);
    mostrarTela('tela-resultado');
});

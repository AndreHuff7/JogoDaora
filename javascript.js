const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const socket = io();
let meuNome  = "";
let meuPin   = "";
let souHost  = false;

const AVATAR_CORES = [
    '#f97316','#22c55e','#3b82f6','#ec4899',
    '#a855f7','#14b8a6','#eab308','#ef4444','#06b6d4','#84cc16'
];

socket.on('salaCriada', (pin) => {
    meuPin  = pin;
    souHost = true;
    document.getElementById('lobby-pin').textContent = pin;
    document.getElementById('btn-iniciar-online').style.display = 'block';
    document.getElementById('lobby-aguardando').style.display   = 'none';
    renderCategoriasSetup();
    renderLetrasSetup();
    emitirConfigSeModoOnline();
    mostrarTela('tela-sala');
});

socket.on('entradaSucesso', (pin) => {
    meuPin  = pin;
    souHost = false;
    document.getElementById('lobby-pin').textContent = pin;
    renderCategoriasSetup();
    renderLetrasSetup();
    mostrarTela('tela-sala');
});

socket.on('atualizarJogadores', (jogadores) => {
    renderLobby(jogadores);
});

socket.on('voceEhHost', () => {
    souHost = true;
    document.getElementById('btn-iniciar-online').style.display = 'block';
    document.getElementById('lobby-aguardando').style.display   = 'none';
    renderCategoriasSetup();
    renderLetrasSetup();
});

socket.on('jogoIniciado', ({ letra, categorias, rodadaAtual: ra, totalRodadas: tr }) => {
    if (ra !== undefined) rodadaAtual = ra - 1;
    if (tr !== undefined) totalRodadas = tr;
    iniciarJogo(letra, categorias);
});

socket.on('jogoFinalizado', () => {
    mostrarResultadoFinal();
});

socket.on('erroEntrada', (msg) => {
    const el = document.getElementById('erro-sala');
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3500);
});

socket.on('configAtualizada', ({ categorias, letras, rodadas }) => {
    categoriasAtivas = categorias;
    letrasAtivas     = new Set(letras);
    totalRodadas     = rodadas;
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
    if (document.getElementById('tela-verificacao')?.classList.contains('ativa')) {
        renderCategoriaVerificacao();
    }
});

function emitirConfigSeModoOnline() {
    if (meuPin && souHost) {
        socket.emit('atualizarConfig', {
            pin:       meuPin,
            categorias: categoriasAtivas,
            letras:    [...letrasAtivas],
            rodadas:   totalRodadas
        });
    }
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
    nomeSpan.textContent = nome + ':';
    div.appendChild(nomeSpan);
    div.appendChild(document.createTextNode(' ' + msg));
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
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

function obterSubmissoesRodada() {
    if (!meuPin) {
        return [{ id: 'local', nome: meuNome || 'Jogador', respostas: respostasJogo }];
    }

    const submissoes = Object.values(respostasRodadaSala || {});
    if (!submissoes.some(submissao => submissao.id === socket.id)) {
        submissoes.push({ id: socket.id, nome: meuNome || 'Você', respostas: respostasJogo });
    }
    return submissoes;
}

function agruparRespostasCategoria(categoriaId) {
    const grupos = new Map();

    obterSubmissoesRodada().forEach(submissao => {
        const textoOriginal = String(submissao.respostas?.[categoriaId] || '').trim();
        if (!textoOriginal) return;

        const chave = normalizarTexto(textoOriginal);
        if (!grupos.has(chave)) {
            grupos.set(chave, { texto: textoOriginal, quantidade: 0, aceita: false, pontos: 0 });
        }

        grupos.get(chave).quantidade++;
    });

    return [...grupos.values()].map(item => {
        const aceita = item.texto.toUpperCase().startsWith(letraAtual);
        return {
            ...item,
            aceita,
            pontos: aceita ? (item.quantidade > 1 ? 5 : 10) : 0
        };
    });
}

const CATS_POR_RODADA = 5;

function embaralhar(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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

function calcularPontuacaoJogador(respostasJogador) {
    let total = 0;
    categoriasRodada.forEach(c => {
        const textoOriginal = String(respostasJogador?.[c.id] || '').trim();
        if (!textoOriginal) return;
        const chave = normalizarTexto(textoOriginal);
        const key = `${c.id}__${chave}`;
        const grupos = agruparRespostasCategoria(c.id);
        const grupo = grupos.find(g => normalizarTexto(g.texto) === chave);
        if (!grupo) return;
        const aceito = votosManual.hasOwnProperty(key) ? votosManual[key] : grupo.aceita;
        total += aceito ? (grupo.quantidade > 1 ? 5 : 10) : 0;
    });
    return total;
}

function renderCategoriaVerificacao() {
    const total = categoriasRodada.length;
    if (total === 0) return;
    const cat = categoriasRodada[indiceVerificacaoAtual];

    document.getElementById('ver-progresso-idx').textContent = indiceVerificacaoAtual + 1;
    document.getElementById('ver-progresso-total').textContent = total;
    document.getElementById('ver-categoria-nome').textContent = cat.label.toUpperCase();

    const respostas = agruparRespostasCategoria(cat.id);
    const container = document.getElementById('ver-chips-container');

    if (respostas.length === 0) {
        container.innerHTML = `
            <div class="ver-chip-wrapper">
                <span class="resposta-chip negado resposta-vazia">(sem resposta)</span>
            </div>`;
    } else {
        container.innerHTML = respostas.map(resposta => {
            const chave = normalizarTexto(resposta.texto);
            const key = `${cat.id}__${chave}`;
            const aceito = votosManual.hasOwnProperty(key) ? votosManual[key] : resposta.aceita;
            const votRes = votacaoResultados[key];
            const votInfo = votRes
                ? `<span class="vot-info">${Object.values(votRes.votos).filter(Boolean).length}✓ ${Object.values(votRes.votos).filter(v=>!v).length}✗</span>`
                : '';
            return `
                <div class="ver-chip-wrapper${meuPin && souHost ? ' clicavel' : ''}" data-cat="${escaparHtml(cat.id)}" data-chave="${escaparHtml(chave)}">
                    <span class="resposta-chip ${aceito ? 'aceito' : 'negado'}">${escaparHtml(resposta.texto)}</span>
                    ${aceito ? '<span class="chip-label-aceito">VALIDADO!</span>' : ''}
                    ${votInfo}
                    ${meuPin && souHost ? `<button class="btn-votar-chip" onclick="iniciarVotacaoChip('${escaparHtml(cat.id)}','${escaparHtml(chave)}')" title="Abrir votação">🗳️</button>` : ''}
                </div>`;
        }).join('');
        container.querySelectorAll('.ver-chip-wrapper[data-cat]').forEach(el => {
            if (!meuPin) el.addEventListener('click', () => toggleVotoManual(el.dataset.cat, el.dataset.chave));
        });
    }

    const prev = document.getElementById('ver-btn-prev');
    const avancar = document.getElementById('ver-btn-avancar');
    if (prev) prev.style.visibility = indiceVerificacaoAtual > 0 ? 'visible' : 'hidden';
    if (avancar) avancar.textContent = indiceVerificacaoAtual < total - 1 ? '→' : 'CONFIRMAR';
}

function toggleVotoManual(catId, chave) {
    const key = `${catId}__${chave}`;
    if (votosManual.hasOwnProperty(key)) {
        votosManual[key] = !votosManual[key];
    } else {
        const respostas = agruparRespostasCategoria(catId);
        const resposta = respostas.find(r => normalizarTexto(r.texto) === chave);
        votosManual[key] = resposta ? !resposta.aceita : true;
    }
    renderCategoriaVerificacao();
}

function iniciarVotacaoChip(catId, chave) {
    if (!meuPin || !souHost) return;
    socket.emit('iniciarVotacao', { pin: meuPin, catId, chave });
}

function mostrarPainelVotacao(catId, chave, duracao) {
    const cat = categoriasRodada.find(c => c.id === catId);
    const submissoes = obterSubmissoesRodada();
    let textoResposta = chave;
    submissoes.forEach(s => {
        const t = String(s.respostas?.[catId] || '').trim();
        if (t && normalizarTexto(t) === chave) textoResposta = t;
    });

    const painel = document.getElementById('painel-votacao');
    if (!painel) return;
    painel.innerHTML = `
        <div class="vot-overlay">
            <div class="vot-card">
                <div class="vot-categoria">${escaparHtml(cat?.label || catId)}</div>
                <div class="vot-resposta">${escaparHtml(textoResposta)}</div>
                <div class="vot-timer" id="vot-timer">${duracao}</div>
                <div class="vot-contagem" id="vot-contagem">Aguardando votos...</div>
                <div class="vot-botoes" id="vot-botoes">
                    <button class="vot-btn vot-sim" onclick="votarPalavra('${escaparHtml(catId)}','${escaparHtml(chave)}',true)">✓ VÁLIDA</button>
                    <button class="vot-btn vot-nao" onclick="votarPalavra('${escaparHtml(catId)}','${escaparHtml(chave)}',false)">✗ INVÁLIDA</button>
                </div>
                <div class="vot-resultado" id="vot-resultado" style="display:none"></div>
            </div>
        </div>`;
    painel.style.display = 'block';

    let restante = duracao;
    clearInterval(votacaoTimerInterval);
    votacaoTimerInterval = setInterval(() => {
        restante--;
        const el = document.getElementById('vot-timer');
        if (el) el.textContent = restante;
        if (restante <= 0) clearInterval(votacaoTimerInterval);
    }, 1000);
}

function atualizarContadorVotos(catId, chave, votos, totalJogadores) {
    const el = document.getElementById('vot-contagem');
    if (!el) return;
    const sim = Object.values(votos).filter(Boolean).length;
    const nao = Object.values(votos).filter(v => !v).length;
    el.textContent = `${sim + nao}/${totalJogadores} votaram  ·  ✓ ${sim}  ✗ ${nao}`;
    const meuvoto = votos[socket.id];
    const botoes = document.getElementById('vot-botoes');
    if (botoes && meuvoto !== undefined) {
        botoes.querySelectorAll('.vot-btn').forEach(b => b.disabled = true);
    }
}

function mostrarResultadoVotacao(catId, chave, sim, nao, aceito) {
    const painel = document.getElementById('painel-votacao');
    if (!painel) return;
    const res = document.getElementById('vot-resultado');
    const bots = document.getElementById('vot-botoes');
    const timer = document.getElementById('vot-timer');
    if (timer) timer.textContent = '0';
    if (bots) bots.style.display = 'none';
    if (res) {
        res.style.display = 'block';
        res.innerHTML = `
            <div class="vot-veredicto ${aceito ? 'vot-aceito' : 'vot-negado'}">
                ${aceito ? '✓ ACEITA' : '✗ REJEITADA'}
            </div>
            <div class="vot-placar">${sim} ✓ &nbsp; ${nao} ✗</div>`;
    }
    setTimeout(() => {
        if (painel) painel.style.display = 'none';
        renderCategoriaVerificacao();
    }, 3000);
}

function votarPalavra(catId, chave, aceito) {
    if (!meuPin) return;
    socket.emit('votarPalavra', {
        pin: meuPin,
        itemId: `${catId}__${chave}`,
        aceito
    });
}

function navVerificacao(delta) {
    const total = categoriasRodada.length;
    if (delta > 0 && indiceVerificacaoAtual >= total - 1) {
        confirmarVerificacao();
        return;
    }
    indiceVerificacaoAtual = Math.max(0, Math.min(total - 1, indiceVerificacaoAtual + delta));
    renderCategoriaVerificacao();
}

function criarSala() {
    const nome = document.getElementById('input-nome').value.trim();
    if (!nome) {
        sacudir('input-nome');
        return;
    }
    meuNome = nome;
    socket.emit('criarSala', { nome });
}

function entrarSalaPIN() {
    const nome = document.getElementById('input-nome').value.trim();
    const pin  = document.getElementById('input-pin').value.trim();
    if (!nome) { sacudir('input-nome'); return; }
    if (!pin)  { sacudir('input-pin');  return; }
    meuNome = nome;
    socket.emit('entrarSala', { pin, nome });
}

function iniciarJogoOnline() {
    socket.emit('iniciarJogo', meuPin);
}

function sacudir(id) {
    const el = document.getElementById(id);
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
}

function renderLobby(jogadores) {
    const MAX   = 10;
    const lista = document.getElementById('lobby-lista');
    const count = document.getElementById('lobby-count');
    count.textContent = `${jogadores.length}/10`;

    let html = '';
    for (let i = 0; i < MAX; i++) {
        const j = jogadores[i];
        if (j) {
            const cor    = AVATAR_CORES[i % AVATAR_CORES.length];
            const inicial = j.nome.charAt(0).toUpperCase();
            const isHost  = i === 0;
            const souEu   = j.id === socket.id;
            html += `
                <div class="lobby-jogador${souEu ? ' lobby-eu' : ''}">
                    <div class="lobby-avatar" style="background:${cor}">${inicial}</div>
                    <span class="lobby-nome">${j.nome}${souEu ? ' <em class="lobby-voce">(você)</em>' : ''}</span>
                    ${isHost ? '<span class="lobby-coroa" title="Host">👑</span>' : ''}
                    <span class="lobby-pts">⭐ ${j.pontos || 0}</span>
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

const CATEGORIAS_PADRAO = [
    { id: "nome",      label: "Nome",      emoji: "👤" },
    { id: "animal",    label: "Animal",    emoji: "🐾" },
    { id: "cor",       label: "Cor",       emoji: "🎨" },
    { id: "cidade",    label: "Cidade",    emoji: "🏙️" },
    { id: "fruta",     label: "Fruta",     emoji: "🍎" },
    { id: "objeto",    label: "Objeto",    emoji: "📦" },
    { id: "pais",      label: "País",      emoji: "🌍" },
    { id: "filme",     label: "Filme",     emoji: "🎬" },
    { id: "marca",     label: "Marca",     emoji: "🏷️" },
    { id: "comida",    label: "Comida",    emoji: "🍽️" },
    { id: "profissao", label: "Profissão", emoji: "💼" },
    { id: "esporte",   label: "Esporte",   emoji: "⚽" },
    { id: "mse",       label: "MSÉ",       emoji: "👵" },
    { id: "personagem",label: "Personagem",emoji: "🧑" },
    { id: "musica",    label: "Música",    emoji: "🎵" },
    { id: "desculpa",  label: "Desculpa esfarrapada",    emoji: "🤷‍♂️" },
    { id: "demissao",  label: "Motivo para ser demitido",    emoji: "🤷" },
    { id: "xingamento",  label: "Xingamento",    emoji: "🤬" },
];

const TEMPO_TOTAL = 60;
const PONTOS = { valido: 10, repetido: 5, invalido: 0 };

let categoriasAtivas   = [];
let letrasAtivas       = new Set([...LETRAS]);
let totalRodadas       = 8;
let rodadaAtual        = 0;
let pontuacaoAcumulada = 0;
let historicoRodadas   = [];
let letrasUsadas       = [];
let letraAtual    = "";
let timerInterval = null;
let tempoRestante = TEMPO_TOTAL;
let jogoAtivo     = false;
let votos         = {};
let respostasJogo = {};
let respostasRodadaSala = {};
let indiceVerificacaoAtual = 0;
let votosManual = {};
let categoriasRodada = [];
let categoriasFila   = [];
let votacaoTimerInterval = null;
let votacaoResultados = {};

function renderCategoriasSetup() {
    const container   = document.getElementById("lista-categorias-setup");
    const estadoVazio = document.getElementById("cat-estado-vazio");
    const count       = document.getElementById("cat-count");
    if (count)       count.textContent = `(${categoriasAtivas.length})`;
    if (estadoVazio) estadoVazio.style.display = categoriasAtivas.length === 0 ? "flex" : "none";

    const podeEditar = !meuPin || souHost;
    container.innerHTML = categoriasAtivas.map(c => `
        <div class="chip-categoria" id="chip-${c.id}">
            <span>${c.emoji} ${c.label}</span>
            ${podeEditar ? `<button class="chip-remover" onclick="removerCategoria('${c.id}')" aria-label="Remover ${c.label}">×</button>` : ''}
        </div>
    `).join("");

    const acoes       = document.getElementById("painel-cat-acoes");
    const addArea     = document.getElementById("adicionar-cat-area");
    const rodadasHost = document.getElementById("rodadas-host");
    const rodadasDisp = document.getElementById("rodadas-display");
    if (acoes)       acoes.style.display       = podeEditar ? "flex"  : "none";
    if (addArea)     addArea.style.display     = podeEditar ? "flex"  : "none";
    if (rodadasHost) rodadasHost.style.display = podeEditar ? "block" : "none";
    if (rodadasDisp) rodadasDisp.style.display = podeEditar ? "none"  : "block";
}

function resetarCategorias() {
    if (meuPin && !souHost) return;
    categoriasAtivas = CATEGORIAS_PADRAO.map(c => ({ ...c }));
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function limparCategorias() {
    if (meuPin && !souHost) return;
    categoriasAtivas = [];
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function renderLetrasSetup() {
    const grid  = document.getElementById("letras-grid");
    const count = document.getElementById("letras-count");
    if (!grid) return;
    if (count) count.textContent = `(${letrasAtivas.size})`;
    const podeEditar = !meuPin || souHost;
    grid.innerHTML = [...LETRAS].map(l =>
        `<button type="button" class="letra-btn ${letrasAtivas.has(l) ? 'ativa' : 'inativa'}"
                ${podeEditar ? `onclick="toggleLetra('${l}')"` : 'disabled'}>${l}</button>`
    ).join("");
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
    const input = document.getElementById("nova-categoria");
    const nome  = input.value.trim();
    if (!nome) return;

    if (categoriasAtivas.some(c => c.label.toLowerCase() === nome.toLowerCase())) {
        input.classList.add("shake");
        setTimeout(() => input.classList.remove("shake"), 400);
        return;
    }

    const id = "cat_" + Date.now();
    categoriasAtivas.push({ id, label: nome, emoji: "📝" });
    input.value = "";
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function removerCategoria(id) {
    if (meuPin && !souHost) return;
    categoriasAtivas = categoriasAtivas.filter(c => c.id !== id);
    renderCategoriasSetup();
    emitirConfigSeModoOnline();
}

function renderCategoriasJogo() {
    const container = document.getElementById("categorias-jogo");
    container.innerHTML = categoriasRodada.map(c => `
        <div class="categoria">
            <label for="${c.id}">${c.emoji} ${c.label}</label>
            <input type="text" id="${c.id}" placeholder="${c.label} com a letra..." autocomplete="off">
        </div>
    `).join("");
}

function iniciarJogo(letraForcada = null, categoriasForcadas = null) {
    if (letraForcada) {
        letraAtual = letraForcada;
        rodadaAtual++;
        if (categoriasAtivas.length === 0) categoriasAtivas = CATEGORIAS_PADRAO.map(c => ({ ...c }));
        categoriasRodada = (categoriasForcadas?.length > 0) ? categoriasForcadas : selecionarCategoriasDaRodada(categoriasAtivas);
    } else {
        if (categoriasAtivas.length < 2) { sacudir('btn-iniciar-online'); return; }
        if (letrasAtivas.size === 0)     return;
        const disponiveis = [...letrasAtivas].filter(l => !letrasUsadas.includes(l));
        const pool = disponiveis.length > 0 ? disponiveis : [...letrasAtivas];
        letraAtual = pool[Math.floor(Math.random() * pool.length)];
        letrasUsadas.push(letraAtual);
        rodadaAtual++;
        categoriasRodada = selecionarCategoriasDaRodada(categoriasAtivas);
    }
    document.getElementById("letra-display").textContent = letraAtual;

    renderCategoriasJogo();

    tempoRestante = TEMPO_TOTAL;
    atualizarTimer();
    jogoAtivo     = true;
    votos         = {};
    respostasJogo = {};
    respostasRodadaSala = {};
    indiceVerificacaoAtual = 0;
    votosManual = {};

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        tempoRestante--;
        atualizarTimer();
        if (tempoRestante <= 0) pararJogo('tempo');
    }, 1000);

    mostrarTela("tela-jogo");
    if (categoriasRodada[0]) document.getElementById(categoriasRodada[0].id)?.focus();
}

function atualizarTimer() {
    const el = document.getElementById("timer");
    el.textContent = tempoRestante;
    el.classList.toggle("urgente", tempoRestante <= 10);
}

function pararJogo(origem = 'stop') {
    if (!jogoAtivo) return;
    jogoAtivo = false;
    clearInterval(timerInterval);

    categoriasRodada.forEach(c => {
        const input = document.getElementById(c.id);
        respostasJogo[c.id] = input ? input.value.trim() : "";
        if (input) input.disabled = true;
    });

    if (meuPin) {
        socket.emit('enviarRespostasRodada', {
            pin: meuPin,
            nome: meuNome,
            respostas: respostasJogo,
            rodada: rodadaAtual,
            letra: letraAtual
        });
    }

    iniciarVerificacao();
}

function iniciarVerificacao() {
    indiceVerificacaoAtual = 0;
    votosManual = {};
    votacaoResultados = {};
    renderCategoriaVerificacao();
    mostrarTela("tela-verificacao");
}

function confirmarVerificacao() {
    let pontuacao = 0;
    let html = "";

    categoriasRodada.forEach(c => {
        const respostas = agruparRespostasCategoria(c.id);

        const minhaResposta = String(respostasJogo?.[c.id] || '').trim();
        let meusPts = 0;
        if (minhaResposta) {
            const chave = normalizarTexto(minhaResposta);
            const key = `${c.id}__${chave}`;
            const grupo = respostas.find(g => normalizarTexto(g.texto) === chave);
            if (grupo) {
                const aceito = votosManual.hasOwnProperty(key) ? votosManual[key] : grupo.aceita;
                meusPts = aceito ? (grupo.quantidade > 1 ? 5 : 10) : 0;
            }
        }
        pontuacao += meusPts;

        const chips = respostas.length
            ? respostas.map(resposta => {
                const chave = normalizarTexto(resposta.texto);
                const key = `${c.id}__${chave}`;
                const aceito = votosManual.hasOwnProperty(key) ? votosManual[key] : resposta.aceita;
                return `<span class="resposta-chip ${aceito ? 'aceito' : 'negado'}">${escaparHtml(resposta.texto)}</span>`;
            }).join('')
            : '<span class="resposta-chip negado resposta-vazia">(vazio)</span>';

        html += `
            <li class="resultado-card">
                <div class="resultado-cabecalho">
                    <strong>${escaparHtml(c.label)}</strong>
                    <span class="pts">${meusPts} pts</span>
                </div>
                <div class="ver-respostas">${chips}</div>
            </li>`;
    });

    const max = categoriasRodada.length * 10;
    pontuacaoAcumulada += pontuacao;
    historicoRodadas.push({ rodada: rodadaAtual, letra: letraAtual, pontuacao, max });

    const submissoes = obterSubmissoesRodada();
    const placarHtml = submissoes.map(j => {
        const pts = calcularPontuacaoJogador(j.respostas);
        const souEu = j.id === socket.id || j.id === 'local';
        return `<div class="placar-linha${souEu ? ' placar-eu' : ''}">
            <span class="placar-nome">${escaparHtml(j.nome)}</span>
            <span class="placar-pts">${pts} pts</span>
        </div>`;
    }).join('');
    document.getElementById('placar-jogadores').innerHTML = placarHtml;

    document.getElementById("letra-usada").textContent = `Letra da rodada: ${letraAtual}`;
    document.getElementById("resultado-lista").innerHTML = html;
    document.getElementById("pontuacao-total").innerHTML =
        `Pontuação desta rodada: <strong>${pontuacao}</strong> / ${max}`;
    document.getElementById("info-rodada").textContent =
        `Rodada ${rodadaAtual} de ${totalRodadas} · Total acumulado: ${pontuacaoAcumulada} pts`;

    if (meuPin) {
        socket.emit('atualizarPontuacao', {
            pin: meuPin,
            pontos: pontuacaoAcumulada
        });
    }

    const btnProximo = document.getElementById('btn-proximo');
    if (btnProximo) {
        btnProximo.textContent = (!meuPin && rodadaAtual >= totalRodadas)
            ? '🏆 Ver Resultado Final'
            : '→ Próxima Rodada';
    }

    mostrarTela("tela-resultado");
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
    const max  = historicoRodadas.reduce((s, r) => s + r.max, 0);
    const html = historicoRodadas.map(r => `
        <li class="final-item">
            <span class="final-rodada-num">Rodada ${r.rodada}</span>
            <span class="final-letra">Letra <strong>${r.letra}</strong></span>
            <span class="final-pts">${r.pontuacao} pts</span>
        </li>`).join("");
    document.getElementById("final-historico").innerHTML = html;
    document.getElementById("final-total").innerHTML =
        `Pontuação Final: <strong>${pontuacaoAcumulada}</strong> / ${max} pts`;
    mostrarTela("tela-final");
}

function reiniciar() {
    rodadaAtual        = 0;
    pontuacaoAcumulada = 0;
    historicoRodadas   = [];
    letrasUsadas       = [];
    categoriasFila     = [];
    categoriasRodada   = [];
    votacaoResultados  = {};
    mostrarTela(meuPin ? "tela-sala" : "tela-nome");
}

function mostrarTela(id) {
    document.querySelectorAll(".tela").forEach(t => t.classList.remove("ativa"));
    document.getElementById(id).classList.add("ativa");
}

document.addEventListener("DOMContentLoaded", () => {
    renderCategoriasSetup();
    renderLetrasSetup();
    document.getElementById("nova-categoria").addEventListener("keydown", e => {
        if (e.key === "Enter") adicionarCategoria();
    });
});

const estadoServidor = {
    leaderboard: [],
    verificacao: null,
    votacaoAtual: null,
    rodadaFinal: null
};

socket.off('votacaoIniciada');
socket.off('votacaoAtualizada');
socket.off('votacaoEncerrada');

socket.on('rodadaEncerrada', () => {
    jogoAtivo = false;
    clearInterval(timerInterval);
    categoriasRodada.forEach(c => {
        const input = document.getElementById(c.id);
        if (input) input.disabled = true;
    });
});

socket.on('leaderboardAtualizado', (ranking) => {
    estadoServidor.leaderboard = ranking || [];
    renderLobby(estadoServidor.leaderboard);
});

socket.on('iniciarVerificacao', (payload) => {
    estadoServidor.verificacao = payload || null;
    estadoServidor.votacaoAtual = null;
    indiceVerificacaoAtual = 0;
    renderCategoriaVerificacao();
    mostrarTela('tela-verificacao');
});

socket.on('votacaoIniciada', ({ item, duracao, totalJogadores, startedAt, endsAt }) => {
    estadoServidor.votacaoAtual = { item, duracao, totalJogadores, votos: {}, startedAt, endsAt };
    mostrarPainelVotacao(item, duracao, totalJogadores, endsAt);
});

socket.on('votacaoAtualizada', ({ itemId, votos, totalJogadores }) => {
    if (!estadoServidor.votacaoAtual?.item?.key || estadoServidor.votacaoAtual.item.key !== itemId) return;
    estadoServidor.votacaoAtual.votos = votos || {};
    atualizarContadorVotos(itemId, votos || {}, totalJogadores);
});

socket.on('votacaoEncerrada', ({ itemId, sim, nao, aceito }) => {
    if (estadoServidor.votacaoAtual?.item?.key === itemId) {
        estadoServidor.votacaoAtual.finalizada = true;
    }
    mostrarResultadoVotacao(itemId, sim, nao, aceito);
});

socket.on('rodadaFinalizada', (payload) => {
    estadoServidor.rodadaFinal = payload || null;
    estadoServidor.leaderboard = payload?.ranking || [];
    renderResultadoRodada(payload);
    mostrarTela('tela-resultado');
});

function renderLobby(jogadores) {
    const MAX   = 10;
    const lista = document.getElementById('lobby-lista');
    const count = document.getElementById('lobby-count');
    const ranking = [...(jogadores || [])];
    if (count) count.textContent = `${ranking.length}/10`;

    let html = '';
    for (let i = 0; i < MAX; i++) {
        const j = ranking[i];
        if (j) {
            const cor    = AVATAR_CORES[i % AVATAR_CORES.length];
            const inicial = j.nome.charAt(0).toUpperCase();
            const isHost  = j.host || j.id === socket.id && i === 0;
            const souEu   = j.id === socket.id;
            html += `
                <div class="lobby-jogador${souEu ? ' lobby-eu' : ''}">
                    <div class="lobby-avatar" style="background:${cor}">${inicial}</div>
                    <span class="lobby-nome">${j.nome}${souEu ? ' <em class="lobby-voce">(você)</em>' : ''}</span>
                    ${isHost ? '<span class="lobby-coroa" title="Host">👑</span>' : ''}
                    <span class="lobby-pts">⭐ ${j.pontos || 0}</span>
                </div>`;
        } else {
            html += `
                <div class="lobby-jogador lobby-vazio">
                    <div class="lobby-avatar" style="background:#2a2a5a">👤</div>
                    <span class="lobby-nome">Disponível</span>
                </div>`;
        }
    }

    if (lista) lista.innerHTML = html;
}

function renderCategoriasJogo() {
    const container = document.getElementById('categorias-jogo');
    const cats = categoriasRodada.length ? categoriasRodada : categoriasAtivas.slice(0, 5);
    if (!container) return;
    container.innerHTML = cats.map(c => `
        <div class="categoria">
            <label for="${c.id}">${c.emoji} ${c.label}</label>
            <input type="text" id="${c.id}" placeholder="${c.label} com a letra..." autocomplete="off">
        </div>
    `).join('');
}

function iniciarJogo(letraForcada = null, categoriasForcadas = null) {
    if (letraForcada) letraAtual = letraForcada;
    rodadaAtual += 1;
    if (Array.isArray(categoriasForcadas) && categoriasForcadas.length) {
        categoriasRodada = categoriasForcadas;
    } else if (!categoriasRodada.length) {
        categoriasRodada = categoriasAtivas.slice(0, 5);
    }

    if (!letraAtual && categoriasRodada.length) {
        letraAtual = LETRAS[Math.floor(Math.random() * LETRAS.length)];
    }

    document.getElementById('letra-display').textContent = letraAtual || '?';
    renderCategoriasJogo();

    tempoRestante = TEMPO_TOTAL;
    atualizarTimer();
    jogoAtivo = true;
    respostasJogo = {};
    respostasRodadaSala = {};

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        tempoRestante--;
        atualizarTimer();
        if (tempoRestante <= 0) pararJogo('tempo');
    }, 1000);

    mostrarTela('tela-jogo');
    if (categoriasRodada[0]) document.getElementById(categoriasRodada[0].id)?.focus();
}

function pararJogo(origem = 'stop') {
    if (!jogoAtivo) return;
    jogoAtivo = false;
    clearInterval(timerInterval);

    categoriasRodada.forEach(c => {
        const input = document.getElementById(c.id);
        respostasJogo[c.id] = input ? input.value.trim() : '';
        if (input) input.disabled = true;
    });

    if (meuPin && origem === 'stop') {
        socket.emit('pressionarStop', {
            pin: meuPin,
            nome: meuNome,
            respostas: respostasJogo,
            rodada: rodadaAtual,
            letra: letraAtual
        });
        return;
    }

    if (meuPin) {
        socket.emit('enviarRespostasRodada', {
            pin: meuPin,
            nome: meuNome,
            respostas: respostasJogo,
            rodada: rodadaAtual,
            letra: letraAtual
        });
        return;
    }

    mostrarTela('tela-verificacao');
}

function iniciarVerificacao() {
    if (estadoServidor.verificacao) {
        renderCategoriaVerificacao();
        mostrarTela('tela-verificacao');
    }
}

function agruparRespostasServidor(categoriaId) {
    const mapa = new Map();
    const respostas = estadoServidor.verificacao?.respostas || respostasRodadaSala || {};

    Object.values(respostas).forEach(submissao => {
        const texto = String(submissao.respostas?.[categoriaId] || '').trim();
        if (!texto) return;
        const chave = normalizarTexto(texto);
        if (!mapa.has(chave)) {
            mapa.set(chave, {
                texto,
                quantidade: 0,
                autores: [],
                aceito: false
            });
        }
        const item = mapa.get(chave);
        item.quantidade += 1;
        item.autores.push(submissao.nome || 'Jogador');
        item.aceito = texto.toUpperCase().startsWith(letraAtual);
    });

    return [...mapa.values()];
}

function renderCategoriaVerificacao() {
    const total = estadoServidor.verificacao?.categorias?.length || categoriasRodada.length;
    const categoria = estadoServidor.verificacao?.categorias?.[indiceVerificacaoAtual] || categoriasRodada[indiceVerificacaoAtual];
    const container = document.getElementById('ver-chips-container');
    if (!categoria || !container) return;

    const idx = document.getElementById('ver-progresso-idx');
    const ttl = document.getElementById('ver-progresso-total');
    const nome = document.getElementById('ver-categoria-nome');
    if (idx) idx.textContent = String(indiceVerificacaoAtual + 1);
    if (ttl) ttl.textContent = String(total);
    if (nome) nome.textContent = categoria.label.toUpperCase();

    const respostas = agruparRespostasServidor(categoria.id);
    container.innerHTML = respostas.length ? respostas.map(r => {
        const key = `${categoria.id}__${normalizarTexto(r.texto)}`;
        const ativo = estadoServidor.votacaoAtual?.item?.key === key;
        const autores = r.autores.join(', ');
        return `
            <div class="ver-chip-wrapper${ativo ? ' ativo' : ''}">
                <span class="resposta-chip ${r.aceito ? 'aceito' : 'negado'}">${escaparHtml(r.texto)}</span>
                <span class="ver-autores">${escaparHtml(autores)}</span>
            </div>`;
    }).join('') : '<div class="ver-vazio">Sem respostas</div>';

    const prev = document.getElementById('ver-btn-prev');
    const avancar = document.getElementById('ver-btn-avancar');
    if (prev) prev.style.visibility = indiceVerificacaoAtual > 0 ? 'visible' : 'hidden';
    if (avancar) avancar.textContent = indiceVerificacaoAtual < total - 1 ? '→' : 'CONFIRMAR';
}

function iniciarVotacaoChip(catId, chave) {
    return;
}

function mostrarPainelVotacao(itemOuCatId, duracaoOuChave, totalJogadores, endsAtOpcional) {
    const painel = document.getElementById('painel-votacao');
    if (!painel) return;

    const item = typeof itemOuCatId === 'object'
        ? itemOuCatId
        : {
            catId: itemOuCatId,
            key: `${itemOuCatId}__${duracaoOuChave}`,
            categoria: itemOuCatId,
            texto: duracaoOuChave,
            donos: []
        };
    const duracao = typeof itemOuCatId === 'object' ? duracaoOuChave : totalJogadores;
    const total = typeof itemOuCatId === 'object'
        ? totalJogadores
        : (estadoServidor.votacaoAtual?.totalJogadores || 0);
    const endsAt = typeof itemOuCatId === 'object'
        ? (endsAtOpcional || estadoServidor.votacaoAtual?.endsAt)
        : null;

    painel.innerHTML = `
        <div class="vot-overlay">
            <div class="vot-card">
                <div class="vot-categoria">${escaparHtml(item.categoria || '')}</div>
                <div class="vot-resposta">${escaparHtml(item.texto || '')}</div>
                <div class="vot-timer" id="vot-timer">${duracao}</div>
                <div class="vot-contagem" id="vot-contagem">0/${total || 0} votaram</div>
                <div class="vot-botoes" id="vot-botoes">
                    <button class="vot-btn vot-sim" onclick="votarPalavra('${item.catId}','${normalizarTexto(item.texto)}',true)">✓ VÁLIDA</button>
                    <button class="vot-btn vot-nao" onclick="votarPalavra('${item.catId}','${normalizarTexto(item.texto)}',false)">✗ INVÁLIDA</button>
                </div>
                <div class="vot-resultado" id="vot-resultado" style="display:none"></div>
            </div>
        </div>`;
    painel.style.display = 'block';

    clearInterval(votacaoTimerInterval);
    let restante = Number(duracao) || 0;
    votacaoTimerInterval = setInterval(() => {
        if (endsAt) {
            restante = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        } else {
            restante -= 1;
        }
        const el = document.getElementById('vot-timer');
        if (el) el.textContent = String(Math.max(restante, 0));
        if (restante <= 0) clearInterval(votacaoTimerInterval);
    }, 1000);
}

function votarPalavra(catId, chave, aceito) {
    if (!meuPin) return;
    socket.emit('votarPalavra', {
        pin: meuPin,
        itemId: `${catId}__${chave}`,
        aceito
    });
}

function atualizarContadorVotos(itemIdOuCatId, votosOuChave, totalJogadoresOuVotos, totalJogadoresOpcional) {
    const el = document.getElementById('vot-contagem');
    if (!el) return;
    const votos = typeof votosOuChave === 'object' ? votosOuChave : totalJogadoresOuVotos;
    const totalJogadores = typeof votosOuChave === 'object'
        ? totalJogadoresOuVotos
        : (totalJogadoresOpcional || estadoServidor.votacaoAtual?.totalJogadores || 0);
    const sim = Object.values(votos || {}).filter(Boolean).length;
    const nao = Object.values(votos || {}).filter(v => !v).length;
    el.textContent = `${sim + nao}/${totalJogadores || 0} votaram · ✓ ${sim} · ✗ ${nao}`;
}

function mostrarResultadoVotacao(itemIdOuCatId, simOuChave, naoOuSim, aceitoOuNao, aceitoOpcional) {
    const res = document.getElementById('vot-resultado');
    const bots = document.getElementById('vot-botoes');
    const painel = document.getElementById('painel-votacao');
    const sim = typeof itemIdOuCatId === 'string' && typeof simOuChave === 'string' ? naoOuSim : simOuChave;
    const nao = typeof itemIdOuCatId === 'string' && typeof simOuChave === 'string' ? aceitoOuNao : naoOuSim;
    const aceito = typeof itemIdOuCatId === 'string' && typeof simOuChave === 'string' ? aceitoOpcional : aceitoOuNao;
    if (bots) bots.style.display = 'none';
    if (res) {
        res.style.display = 'block';
        res.innerHTML = `
            <div class="vot-veredicto ${aceito ? 'vot-aceito' : 'vot-negado'}">${aceito ? '✓ ACEITA' : '✗ REJEITADA'}</div>
            <div class="vot-placar">${sim} ✓ &nbsp; ${nao} ✗</div>`;
    }
    setTimeout(() => {
        if (painel) painel.style.display = 'none';
        renderCategoriaVerificacao();
    }, 1500);
}

function confirmarVerificacao() {
    if (meuPin && souHost) {
        socket.emit('finalizarVerificacao', { pin: meuPin });
    }
}

function renderResultadoRodada(payload) {
    const ranking = payload?.ranking || estadoServidor.leaderboard || [];
    const pontuacoesRodada = payload?.pontuacaoRodada || {};
    const totalRodadasRodada = payload?.totalRodadas || totalRodadas;

    const htmlRanking = ranking.map(j => `
        <div class="placar-linha${j.id === socket.id ? ' placar-eu' : ''}">
            <span class="placar-nome">${escaparHtml(j.nome)}</span>
            <span class="placar-pts">${j.pontos || 0} pts</span>
        </div>`).join('');

    const rodadaHtml = Object.entries(pontuacoesRodada).map(([id, pts]) => {
        const jogador = ranking.find(j => j.id === id);
        return `<li class="final-item"><span class="final-rodada-num">${escaparHtml(jogador?.nome || 'Jogador')}</span><span class="final-pts">${pts} pts</span></li>`;
    }).join('');

    const lista = document.getElementById('placar-jogadores');
    if (lista) lista.innerHTML = htmlRanking;

    const resultadoLista = document.getElementById('resultado-lista');
    if (resultadoLista) resultadoLista.innerHTML = rodadaHtml;

    const letra = document.getElementById('letra-usada');
    if (letra) letra.textContent = `Letra da rodada: ${payload?.letraAtual || letraAtual}`;

    const total = document.getElementById('pontuacao-total');
    if (total) total.innerHTML = `Pontuação atualizada no leaderboard`;

    const info = document.getElementById('info-rodada');
    if (info) info.textContent = `Rodada ${payload?.rodadaAtual || rodadaAtual} de ${payload?.totalRodadas || totalRodadasRodada}`;

    estadoServidor.leaderboard = ranking;
    pontuacaoAcumulada = ranking.find(j => j.id === socket.id)?.pontos || 0;
}

function mostrarResultadoFinal() {
    const ranking = estadoServidor.rodadaFinal?.ranking || estadoServidor.leaderboard || [];
    const total = document.getElementById('final-total');
    const lista = document.getElementById('final-historico');
    if (lista) {
        lista.innerHTML = ranking.map((j, index) => `
            <li class="final-item">
                <span class="final-rodada-num">${index + 1}º</span>
                <span class="final-letra">${escaparHtml(j.nome)}</span>
                <span class="final-pts">${j.pontos || 0} pts</span>
            </li>`).join('');
    }
    if (total) {
        total.innerHTML = ranking.map(j => `${escaparHtml(j.nome)}: ${j.pontos || 0} pts`).join('<br>');
    }
    mostrarTela('tela-final');
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


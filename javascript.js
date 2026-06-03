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

socket.on('jogoIniciado', ({ letra }) => {
    iniciarJogo(letra);
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
                    <span class="lobby-pts">⭐ 0</span>
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
    { id: "esporte",   label: "Esporte",   emoji: "⚽" }
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
    container.innerHTML = categoriasAtivas.map(c => `
        <div class="categoria">
            <label for="${c.id}">${c.emoji} ${c.label}</label>
            <input type="text" id="${c.id}" placeholder="${c.label} com a letra..." autocomplete="off">
        </div>
    `).join("");
}

function iniciarJogo(letraForcada = null) {
    if (letraForcada) {
        letraAtual = letraForcada;
        if (categoriasAtivas.length === 0) categoriasAtivas = CATEGORIAS_PADRAO.map(c => ({ ...c }));
    } else {
        if (categoriasAtivas.length < 2) { sacudir('btn-iniciar-online'); return; }
        if (letrasAtivas.size === 0)     return;
        const disponiveis = [...letrasAtivas].filter(l => !letrasUsadas.includes(l));
        const pool = disponiveis.length > 0 ? disponiveis : [...letrasAtivas];
        letraAtual = pool[Math.floor(Math.random() * pool.length)];
        letrasUsadas.push(letraAtual);
        rodadaAtual++;
    }
    document.getElementById("letra-display").textContent = letraAtual;

    renderCategoriasJogo();

    tempoRestante = TEMPO_TOTAL;
    atualizarTimer();
    jogoAtivo     = true;
    votos         = {};
    respostasJogo = {};

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        tempoRestante--;
        atualizarTimer();
        if (tempoRestante <= 0) pararJogo();
    }, 1000);

    mostrarTela("tela-jogo");
    document.getElementById(categoriasAtivas[0].id).focus();
}

function atualizarTimer() {
    const el = document.getElementById("timer");
    el.textContent = tempoRestante;
    el.classList.toggle("urgente", tempoRestante <= 10);
}

function pararJogo() {
    if (!jogoAtivo) return;
    jogoAtivo = false;
    clearInterval(timerInterval);

    categoriasAtivas.forEach(c => {
        const input = document.getElementById(c.id);
        respostasJogo[c.id] = input ? input.value.trim() : "";
        if (input) input.disabled = true;
    });

    iniciarVerificacao();
}

function iniciarVerificacao() {
    document.getElementById("ver-letra").textContent = letraAtual;
    const lista = document.getElementById("ver-lista");
    lista.innerHTML = "";

    categoriasAtivas.forEach(c => {
        const valor       = respostasJogo[c.id] || "";
        const começaCerto = valor.length > 0 && valor.toUpperCase().startsWith(letraAtual);

        votos[c.id] = (valor === "" || !começaCerto) ? "invalido" : "valido";

        const card = document.createElement("div");
        card.className = "ver-card";
        card.id = `vercard-${c.id}`;
        card.innerHTML = `
            <div class="ver-info">
                <span class="ver-cat">${c.emoji} ${c.label}</span>
                <span class="ver-resposta">${valor || "<em class='vazio'>(vazio)</em>"}</span>
            </div>
            <div class="ver-botoes">
                <button class="vbtn vbtn-valido   ${votos[c.id] === 'valido'    ? 'ativo' : ''}"
                        onclick="votar('${c.id}','valido')"   title="Válida — 10 pts">✅ 10pts</button>
                <button class="vbtn vbtn-repetido ${votos[c.id] === 'repetido'  ? 'ativo' : ''}"
                        onclick="votar('${c.id}','repetido')" title="Repetida — 5 pts">🔁 5pts</button>
                <button class="vbtn vbtn-invalido ${votos[c.id] === 'invalido'  ? 'ativo' : ''}"
                        onclick="votar('${c.id}','invalido')" title="Inválida — 0 pts">❌ 0pts</button>
            </div>
        `;
        lista.appendChild(card);
    });

    mostrarTela("tela-verificacao");
}

function votar(categoriaId, tipo) {
    votos[categoriaId] = tipo;
    const card = document.getElementById(`vercard-${categoriaId}`);
    card.querySelectorAll(".vbtn").forEach(b => b.classList.remove("ativo"));
    card.querySelector(`.vbtn-${tipo}`).classList.add("ativo");
}

function confirmarVerificacao() {
    let pontuacao = 0;
    let html = "";

    categoriasAtivas.forEach(c => {
        const valor  = respostasJogo[c.id] || "";
        const voto   = votos[c.id] || "invalido";
        const pontos = PONTOS[voto];
        pontuacao   += pontos;

        const iconeMap = { valido: "✅", repetido: "🔁", invalido: "❌" };
        html += `<li class="${voto}">
                    ${iconeMap[voto]} <strong>${c.label}:</strong>
                    ${valor || "<em>(vazio)</em>"}
                    <span class="pts">${pontos} pts</span>
                 </li>`;
    });

    const max = categoriasAtivas.length * 10;

    pontuacaoAcumulada += pontuacao;
    historicoRodadas.push({ rodada: rodadaAtual, letra: letraAtual, pontuacao });

    document.getElementById("letra-usada").textContent = `Letra da rodada: ${letraAtual}`;
    document.getElementById("resultado-lista").innerHTML = html;
    document.getElementById("pontuacao-total").innerHTML =
        `Pontuação desta rodada: <strong>${pontuacao}</strong> / ${max}`;
    document.getElementById("info-rodada").textContent =
        `Rodada ${rodadaAtual} de ${totalRodadas} · Total acumulado: ${pontuacaoAcumulada} pts`;

    mostrarTela("tela-resultado");
}

function proximaRodadaOuFim() {
    if (meuPin) { reiniciar(); return; }
    if (rodadaAtual < totalRodadas) {
        iniciarJogo();
    } else {
        mostrarResultadoFinal();
    }
}

function mostrarResultadoFinal() {
    const max  = totalRodadas * categoriasAtivas.length * 10;
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


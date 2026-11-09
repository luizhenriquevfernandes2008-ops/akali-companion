// Overlay da partida: lê o mesmo estado ao vivo do app (SSE /api/live/stream) e o status do replay.
// Janela transparente e "atravessável": só mostra informação, nunca recebe cliques.
const DD = 'https://ddragon.leagueoflegends.com';
const G = { v: null, champs: {} };
const MOCK = new URLSearchParams(location.search).has('mock');
const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
const ADV = { EVEN: 'Equilibrada' };

let st = null;          // estado ao vivo
let recvAt = Date.now();
let rep = null;         // status do replay
let lastToastAt = 0;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const champImg = (key) => (G.champs[key] && G.v ? `${DD}/cdn/${G.v}/img/champion/${G.champs[key]}.png` : '');
const itemImg = (id) => (id && G.v ? `<img class="it" src="${DD}/cdn/${G.v}/img/item/${id}.png" alt="">` : '<span class="it"></span>');
const fmt = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const signed = (n) => `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR')}`;
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const kda = (p) => `${p.kills}/${p.deaths}/${p.assists}`;
const keyName = (a) => (a || '').replace('Control', 'Ctrl').split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('+');

function gameNow() {
  const L = st?.live;
  return L?.time != null ? L.time + (Date.now() - recvAt) / 1000 : null;
}

function recPill() {
  if (!rep) return '';
  if (rep.recording) return `<span class="rec on"><span class="d"></span>REPLAY ${rep.settings?.replaySeconds || 30}s</span>`;
  if (rep.settings?.replayMode === 'off') return '';
  return `<span class="rec" title="${esc(rep.error || '')}"><span class="d"></span>${rep.ffmpeg ? 'replay parado' : 'sem FFmpeg'}</span>`;
}

function header() {
  const t = gameNow();
  return `<div class="card head"><span class="brand"><i>◆</i> Akali</span>${recPill()}<span class="clock" id="clock">${t != null ? fmt(t) : ''}</span></div>`;
}

function keys() {
  const s = rep?.settings;
  if (!s) return '';
  return `<div class="keys">${s.overlayShortcut ? `<span>${keyName(s.overlayShortcut)} esconde</span>` : ''}${s.clipShortcut && s.replayMode !== 'off' ? `<span>${keyName(s.clipShortcut)} salva replay</span>` : ''}</div>`;
}

function idle() {
  const phase = st?.phase;
  const msg = !st || !st.connected
    ? 'Cliente do LoL fechado. Quando a partida começar, as estatísticas aparecem aqui.'
    : phase === 'ChampSelect' ? 'Seleção de campeões em andamento: o overlay muda quando a partida carregar.'
      : ['GameStart', 'InProgress', 'Reconnect'].includes(phase) ? 'Carregando a partida…'
        : 'Fora de partida. Entre numa partida para ver suas estatísticas ao vivo.';
  return `${header()}<div class="card idle"><div class="label">Overlay</div><p>${esc(msg)}</p></div>${keys()}`;
}

function inGame() {
  const L = st.live;
  const me = L.me;
  const op = L.opponent;
  let html = header();

  if (op) {
    const d = { lvl: me.level - op.level, cs: me.cs - op.cs, gold: me.itemGold - op.itemGold };
    html += `
      <div class="card">
        <div class="label"><span>Sua rota · ${esc(POS_PT[me.position] || me.position || '')}</span><span>${me.gold?.toLocaleString('pt-BR') ?? ''} 🪙</span></div>
        <div class="vs">
          <div class="side"><img src="${champImg(me.championId)}" alt=""><div class="n"><b>${esc(me.champion)}</b><span>Nv ${me.level} · ${kda(me)}</span></div></div>
          <span class="vsx">VS</span>
          <div class="side right"><img class="${op.dead ? 'dead' : ''}" src="${champImg(op.championId)}" alt=""><div class="n"><b>${esc(op.champion)}</b><span>${op.dead ? `💀 ${op.respawn}s · ` : ''}Nv ${op.level} · ${kda(op)}</span></div></div>
        </div>
        <div class="diffs">
          <div><b class="${cls(d.lvl)}">${signed(d.lvl)}</b>nível</div>
          <div><b class="${cls(d.cs)}">${signed(d.cs)}</b>CS</div>
          <div><b class="${cls(d.gold)}">${signed(d.gold)}</b>ouro itens</div>
        </div>
        <div class="items"><div>${me.items.map(itemImg).join('')}</div><div>${op.items.map(itemImg).join('')}</div></div>
      </div>`;
  } else {
    html += `<div class="card"><div class="label">Você</div><div class="side"><img src="${champImg(me.championId)}" alt=""><div class="n"><b>${esc(me.champion)}</b><span>Nv ${me.level} · ${kda(me)} · ${me.cs} CS</span></div></div></div>`;
  }

  const A = L.teams.ally;
  const E = L.teams.enemy;
  const pct = A.gold + E.gold ? (A.gold / (A.gold + E.gold)) * 100 : 50;
  const timer = (gs) => (gs ? `<b data-at="${gs}">${fmt(gs - (gameNow() ?? 0))}</b>` : '<b>—</b>');
  html += `
    <div class="card">
      <div class="obj">
        <div>🐉 Dragão ${timer(L.timers?.nextDragon)}</div>
        <div>👁 Barão ${timer(L.timers?.nextBaron)}</div>
      </div>
      <div class="score"><span class="a">${A.kills}</span><div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div><span class="e">${E.kills}</span></div>
      <div class="gold">ouro em itens ${signed(A.gold - E.gold)} · dragões ${A.dragons.length} × ${E.dragons.length} · torres ${A.towers} × ${E.towers}</div>
    </div>`;

  const m = L.matchup;
  if (op && m && !m.loading && !m.error && (m.winRate != null || m.tip)) {
    const adv = !m.laneAdvantage ? '—' : ADV[m.laneAdvantage] || (m.laneAdvantage === me.champion ? 'Sua' : `do ${op.champion}`);
    html += `
      <div class="card">
        <div class="label"><span>Matchup · OP.GG</span><span>vantagem: ${esc(adv)}</span></div>
        <div class="mu"><b class="${m.winRate >= 0.5 ? 'up' : 'down'}">${m.winRate != null ? `${(m.winRate * 100).toFixed(1)}%` : '—'}</b><span>vitórias de ${esc(me.champion)}${m.games ? ` em ${m.games.toLocaleString('pt-BR')} jogos` : ''}</span></div>
        ${m.tip ? `<p class="tip">💡 ${esc(m.tip)}</p>` : ''}
      </div>`;
  }

  if (L.tips?.length) {
    html += `<div class="card"><div class="label">Dicas agora</div><div class="tips">${L.tips.slice(0, 3).map((t) => `
      <div class="t">${t.item && G.v ? `<img src="${DD}/cdn/${G.v}/img/item/${t.item}.png" alt="">` : '<span class="ico">⚡</span>'}<span>${esc(t.text)}</span></div>`).join('')}</div></div>`;
  }
  return html + keys();
}

let lastHtml = '';
function render() {
  const html = st?.live?.me ? inGame() : idle();
  if (html !== lastHtml) { lastHtml = html; $('#root').innerHTML = html; }
}

// relógio e timers andam sozinhos entre as atualizações
setInterval(() => {
  const t = gameNow();
  const c = $('#clock');
  if (c && t != null) c.textContent = fmt(t);
  for (const el of document.querySelectorAll('[data-at]')) el.textContent = fmt(Number(el.dataset.at) - (t ?? 0));
}, 500);

function toast() {
  const c = rep?.lastClip;
  if (!c || c.at <= lastToastAt) return;
  lastToastAt = c.at;
  if (Date.now() - c.at > 8000) return; // aviso antigo (de antes de abrir o overlay)
  const el = $('#toast');
  el.className = c.error ? 'err' : '';
  el.innerHTML = c.error ? `⚠ Replay não salvo<small>${esc(c.error)}</small>` : `🎬 Replay salvo · ${c.seconds}s<small>${esc(c.name)}</small>`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3800);
}

async function pollReplay() {
  try {
    rep = await (await fetch('/api/replay/status', { cache: 'no-store' })).json();
    toast();
    render();
  } catch { /* app fechando */ }
  setTimeout(pollReplay, 1000);
}

function connect() {
  const es = new EventSource('/api/live/stream');
  es.onmessage = (e) => {
    try { st = JSON.parse(e.data); recvAt = Date.now(); render(); } catch { /* ignora */ }
  };
}

const MOCK_STATE = {
  connected: true, phase: 'InProgress',
  live: {
    time: 845,
    me: { champion: 'Akali', championId: 84, position: 'MIDDLE', level: 11, kills: 6, deaths: 2, assists: 4, cs: 128, items: [3152, 4645, 3020, 1058], itemGold: 7100, gold: 1240 },
    opponent: { champion: 'Syndra', championId: 134, level: 10, kills: 2, deaths: 5, assists: 3, cs: 141, items: [6655, 3020, 1026], itemGold: 5900, dead: true, respawn: 23 },
    teams: { ally: { kills: 18, gold: 31400, dragons: ['Infernal', 'Oceano'], towers: 4 }, enemy: { kills: 12, gold: 28900, dragons: ['Nuvens'], towers: 2 } },
    timers: { nextDragon: 1010, nextBaron: 1200 },
    matchup: { winRate: 0.531, games: 18234, laneAdvantage: 'Akali', tip: 'Espere a Syndra gastar a esfera de atordoar (E) antes de entrar; com Shroud ela perde a mira.' },
    tips: [{ item: 3135, text: 'Inimigos com 2 itens de resistência mágica — Cajado do Vazio aumenta muito seu dano.' }, { text: 'Você tem ultimate e Syndra ainda não — boa janela para all-in.' }],
  },
};

async function boot() {
  try {
    const [v] = await (await fetch(`${DD}/api/versions.json`)).json();
    const champs = await (await fetch(`${DD}/cdn/${v}/data/pt_BR/champion.json`)).json();
    for (const c of Object.values(champs.data)) G.champs[Number(c.key)] = c.id;
    G.v = v;
  } catch { /* sem internet: overlay sem ícones */ }
  if (MOCK) {
    st = MOCK_STATE;
    rep = { recording: true, ffmpeg: true, settings: { replaySeconds: 30, replayMode: 'game', overlayShortcut: 'Control+Shift+A', clipShortcut: 'Control+Shift+S' } };
    render();
    return;
  }
  connect();
  pollReplay();
  render();
}
boot();

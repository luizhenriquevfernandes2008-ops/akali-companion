// Akali Remote — controle do cliente do LoL pelo celular
const DD = 'https://ddragon.leagueoflegends.com';
const CD = 'https://raw.communitydragon.org/latest';

const G = { v: null, champs: {}, spells: {} };   // dados do jogo
let st = null;                                     // último estado recebido do PC
let recvAt = 0;                                    // quando chegou (para os cronômetros)
let lastEventId = null;
let lastPhase = null;
const ui = { selected: null, search: '', filter: 'all', tab: 'pick', slot: 1, viewKey: null, lane: null, sound: false };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
let favs = new Set(store.get('favs', [84]));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const patch = (el, html) => { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };

const QUEUES = [
  { id: 420, name: 'Ranqueada Solo/Duo' }, { id: 440, name: 'Ranqueada Flex' },
  { id: 400, name: 'Normal (Escolha)' }, { id: 490, name: 'Partida Rápida' }, { id: 450, name: 'ARAM' },
];
const QUEUE_NAME = { 420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (Escolha)', 430: 'Normal (Às cegas)', 490: 'Partida Rápida', 480: 'Swiftplay', 450: 'ARAM', 1700: 'Arena', 1900: 'URF' };
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'FILL'];
const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte', FILL: 'Qualquer', UNSELECTED: '—' };
const TAGS = [['all', 'Todos'], ['fav', '★ Favoritos'], ['Assassin', 'Assassinos'], ['Mage', 'Magos'], ['Fighter', 'Lutadores'], ['Marksman', 'Atiradores'], ['Tank', 'Tanques'], ['Support', 'Suportes']];

const img = {
  champ: (key) => (G.champs[key] ? `${DD}/cdn/${G.v}/img/champion/${G.champs[key].id}.png` : ''),
  centered: (key, skinId) => G.champs[key] ? `${DD}/cdn/img/champion/centered/${G.champs[key].id}_${skinId ? skinId % 1000 : 0}.jpg` : '',
  loading: (key, skinId) => `${DD}/cdn/img/champion/loading/${G.champs[key]?.id}_${skinId % 1000}.jpg`,
  spell: (key) => (G.spells[key] ? `${DD}/cdn/${G.v}/img/spell/${G.spells[key].image}` : ''),
  pos: (p) => `${CD}/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${String(p || 'fill').toLowerCase()}.png`,
  profile: (id) => `${DD}/cdn/${G.v}/img/profileicon/${id}.png`,
};
const cname = (key) => G.champs[key]?.name || '';

// ---------------- comunicação ----------------
const MOCK = new URLSearchParams(location.search).has('mock'); // modo demonstração: não envia nada ao cliente

async function act(type, params = {}) {
  if (MOCK) { toast(`[demo] ${type} ${JSON.stringify(params)}`); return { ok: true, text: 'demo' }; }
  try {
    const r = await fetch('/api/live/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...params }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
    return d;
  } catch (e) {
    toast(e.message, 'err');
    throw e;
  }
}
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  $('#toast').append(el);
  setTimeout(() => el.remove(), 4000);
}
function setStatus(ok, text) {
  $('#dot').className = `dot ${ok ? 'on' : 'off'}`;
  $('#statusText').textContent = text;
}

function connect() {
  const es = new EventSource('/api/live/stream');
  es.onmessage = (e) => {
    st = JSON.parse(e.data);
    recvAt = Date.now();
    const s = st.summoner;
    setStatus(st.connected, st.connected ? `PC conectado · ${s?.gameName || 'LoL aberto'}` : 'PC conectado · LoL fechado');
    onPhaseChange();
    if (st.event && st.event.id !== lastEventId) {
      if (lastEventId !== null) toast(st.event.text, st.event.type === 'error' ? 'err' : 'ok');
      lastEventId = st.event.id;
    }
    syncSettings();
    render();
  };
  es.onerror = () => setStatus(false, 'Sem conexão com o PC — reconectando…');
}

// ---------------- alertas ----------------
let audio = null;
function beep() {
  if (!audio) return;
  const t = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.25);
    o.start(t + i * 0.35); o.stop(t + i * 0.35 + 0.3);
  }
}
function onPhaseChange() {
  const phase = st.connected ? st.phase : 'Closed';
  if (phase === lastPhase) return;
  if (phase === 'ReadyCheck' && !st.settings?.autoAccept) {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
    beep();
  }
  if (phase === 'ChampSelect') { ui.selected = null; ui.tab = 'pick'; ui.search = ''; ui.lane = null; }
  lastPhase = phase;
}

function syncSettings() {
  const s = st.settings || {};
  if (document.activeElement !== $('#optAccept')) $('#optAccept').checked = Boolean(s.autoAccept);
  if (document.activeElement !== $('#optRunes')) $('#optRunes').checked = Boolean(s.autoRunes);
}

// ---------------- telas ----------------
function setBackground(key, skinId) {
  const url = key ? img.centered(key, skinId) : `${DD}/cdn/img/champion/centered/Akali_102.jpg`;
  const el = $('#bgImg');
  if (el._url !== url) { el._url = url; el.style.backgroundImage = `url(${url})`; }
}

function screen(key, skeleton) {
  const main = $('#screen');
  if (ui.viewKey !== key) {
    ui.viewKey = key;
    main._h = null;
    main.innerHTML = skeleton;
    window.scrollTo(0, 0);
  }
  return main;
}

function render() {
  if (!G.v) return;
  if (!st) return;
  if (!st.connected) {
    setBackground();
    screen('closed', '');
    patch($('#screen'), `<div class="card center" style="margin-top:20vh"><h2 class="title">LoL fechado</h2><p class="sub">Abra o cliente do League of Legends no PC. Assim que ele estiver aberto, o controle aparece aqui.</p></div>`);
    return;
  }
  const p = st.phase;
  if (p === 'ChampSelect' && st.champSelect) return renderChampSelect();
  if (p === 'ReadyCheck') return renderReady();
  if (p === 'Lobby' || p === 'Matchmaking') return renderLobby();
  if (p === 'None') return renderHome();
  if (['GameStart', 'InProgress', 'Reconnect'].includes(p)) return renderInGame();
  if (['WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(p)) return renderPostGame();
  setBackground();
  screen('other', '');
  patch($('#screen'), `<div class="card center" style="margin-top:20vh"><h2>${esc(p)}</h2><p class="sub">Aguardando o cliente…</p></div>`);
}

function queueChips(current) {
  return `<div class="chips">${QUEUES.map((q) => `<button class="chip ${q.id === current ? 'on' : ''}" data-act="queue" data-q="${q.id}">${q.name}</button>`).join('')}</div>`;
}

function partyCard(party) {
  const queue = party.queueId ? ` · ${esc(QUEUE_NAME[party.queueId] || `fila ${party.queueId}`)}` : '';
  // fora de sala, mas registrado como membro: geralmente é o grupo da partida anterior que ficou preso
  if (st.phase === 'None') {
    return `<div class="card" style="margin-top:12px">
      👥 O cliente ainda te registra como <b>membro de um grupo de ${party.size}</b>${queue} — normalmente o grupo da sua última partida, que ficou preso.<br><br>
      <span class="muted">Se você <b>não</b> está em grupo: no PC, clique em <b>JOGAR</b> no cliente uma vez (ou feche e abra o LoL). Depois disso, as filas voltam a aparecer aqui.<br>
      Se estiver em grupo de verdade: só o líder escolhe a fila; quando ele procurar partida, o aceite aparece aqui.</span></div>`;
  }
  return `<div class="card" style="margin-top:12px">
    👥 Você está num grupo de <b>${party.size}</b>${queue}.<br>
    <span class="muted">Só o líder escolhe a fila e entra na fila. Quando ele procurar partida, o aceite aparece aqui.</span></div>`;
}

function renderHome() {
  setBackground();
  screen('home', '');
  const member = st.party && !st.party.isLeader;
  patch($('#screen'), member ? `
    <h1 class="title">Grupo preso no cliente</h1>
    ${partyCard(st.party)}` : `
    <h1 class="title">Bora jogar?</h1>
    <p class="sub">${st.party ? `Você é o líder do grupo de ${st.party.size}. ` : ''}Escolha a fila para criar a sala no cliente.</p>
    ${queueChips(null)}`);
  updateActionBar('');
}

function renderLobby() {
  setBackground();
  const l = st.lobby || {};
  const s = st.search;
  const searching = st.phase === 'Matchmaking' || s?.state === 'Searching';
  screen('lobby', '');
  const [first, second] = l.positions || [];
  const posRow = (which, val) => `<div class="pos-row">${POS.map((p) => `
      <button class="chip ${val === p ? 'on' : ''}" data-act="pos" data-which="${which}" data-pos="${p}" title="${POS_PT[p]}"><img src="${img.pos(p)}" alt="${POS_PT[p]}"></button>`).join('')}</div>`;
  const errors = (s?.errors || []).map((e) => `<div class="card" style="border-color:rgba(255,84,112,.5);margin-top:10px">⚠ ${esc(e.message || 'Fila bloqueada')}${e.penalty ? ` · ${Math.ceil(e.penalty / 60)} min de espera` : ''}</div>`).join('');

  patch($('#screen'), searching ? `
      <div class="center" style="padding-top:8vh">
        <div class="muted">${esc(QUEUE_NAME[l.queueId] || 'Fila')}</div>
        <h1 class="title" style="margin:8px 0 18px">Procurando partida</h1>
        <div class="big-time" data-since="${recvAt - (s?.timeInQueue || 0) * 1000}">0:00</div>
        ${s?.estimated ? `<div class="muted" style="margin-top:6px">Estimativa: ${fmtTime(s.estimated)}</div>` : ''}
        ${errors}
      </div>` : `
      <h1 class="title">${esc(QUEUE_NAME[l.queueId] || 'Sala')}</h1>
      <p class="sub">${l.isLeader ? 'Você é o líder da sala.' : 'Aguardando o líder iniciar a fila.'}</p>
      ${!l.isLeader && st.party ? partyCard(st.party) : ''}
      ${l.positionSelector ? `
        <div class="label">1ª rota · ${POS_PT[first] || '—'}</div>${posRow('first', first)}
        <div class="label">2ª rota · ${POS_PT[second] || '—'}</div>${posRow('second', second)}` : ''}
      ${(l.members || []).length > 1 ? `<div class="label">Sala</div><div class="card members">${l.members.map((m) => `
        <div class="member"><img src="${img.profile(m.icon)}" alt=""><b style="flex:1">${esc(m.name)}${m.leader ? ' 👑' : ''}</b>
        ${m.first && m.first !== 'UNSELECTED' ? `<img class="pos" src="${img.pos(m.first)}" alt="">` : ''}</div>`).join('')}</div>` : ''}
      ${l.isLeader ? `<div class="label">Trocar fila</div>${queueChips(l.queueId)}` : ''}
      ${errors}`);

  updateActionBar(searching
    ? `<button class="btn wide red big" data-act="cancelSearch">Cancelar fila</button>`
    : l.isLeader
      ? `<button class="btn wide primary big" data-act="search" ${l.canStart === false ? 'disabled' : ''}>Procurar partida</button>`
      : `<div class="note">Esperando o líder…</div>`);
}

function renderReady() {
  setBackground();
  const rc = st.readyCheck || {};
  screen('ready', '');
  const accepted = rc.response === 'Accepted';
  const declined = rc.response === 'Declined';
  const deadline = recvAt + Math.max(0, 12 - (rc.elapsed || 0)) * 1000;
  patch($('#screen'), `
    <div class="ready">
      <h1 class="title center">Partida encontrada!</h1>
      <div class="ring" data-ring="${deadline}"><div><div><b data-deadline="${deadline}">12</b><span class="muted">segundos</span></div></div></div>
      ${accepted ? '<div class="card center">✔ Aceita! Esperando os outros jogadores…</div>' : ''}
      ${declined ? '<div class="card center">Você recusou a partida.</div>' : ''}
    </div>`);
  updateActionBar(accepted || declined ? '' : `
    <div style="display:grid;gap:10px">
      <button class="btn wide green big" data-act="accept">ACEITAR</button>
      <button class="btn wide red" data-act="decline">Recusar</button>
    </div>`);
}

// ---------------- monitor da partida ----------------
const itemImg = (id, cls = '') => (id ? `<img class="it ${cls}" src="${DD}/cdn/${G.v}/img/item/${id}.png" alt="" loading="lazy">` : `<span class="it empty ${cls}"></span>`);
const kda = (p) => `${p.kills}/${p.deaths}/${p.assists}`;
const signed = (n, suffix = '') => `${n > 0 ? '+' : ''}${n}${suffix}`;
const diffCls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const ADV_PT = (v, opp) => (!v ? '—' : v === 'EVEN' ? 'Equilibrada' : v === 'Akali' || v === st.live?.me?.champion ? 'Sua' : `Do ${esc(opp)}`);
const STYLE_PT = { aggressive: 'Agressivo', even: 'Equilibrado', passive: 'Defensivo', defensive: 'Defensivo' };

function renderInGame() {
  const L = st.live;
  const champ = st.game?.championId;
  setBackground(champ);
  screen('ingame', '');
  if (!L || L.loading || !L.me) {
    patch($('#screen'), `
      <div class="center" style="padding-top:22vh">
        <div class="muted">${esc(st.game?.queueName || QUEUE_NAME[st.game?.queueId] || '')}</div>
        <h1 class="title" style="margin-top:6px">Carregando partida…</h1>
        <p class="sub">O monitor aparece assim que o jogo começar.</p>
      </div>`);
    updateActionBar('');
    return;
  }
  const me = L.me, op = L.opponent;
  const clockBase = recvAt - L.time * 1000;
  const A = L.teams.ally, E = L.teams.enemy;
  const goldDiff = A.gold - E.gold;
  const goldPct = A.gold + E.gold ? (A.gold / (A.gold + E.gold)) * 100 : 50;
  const countdown = (gameSec) => (gameSec ? `<span data-countdown="${recvAt + (gameSec - L.time) * 1000}">--:--</span>` : '—');

  const lane = op ? (() => {
    const d = { lvl: me.level - op.level, cs: me.cs - op.cs, gold: me.itemGold - op.itemGold, k: me.kills - op.kills };
    return `
      <div class="card lane">
        <div class="label" style="margin-top:0">Sua rota · ${esc(POS_PT[me.position] || me.position)}</div>
        <div class="vs">
          <div class="side"><img src="${img.champ(me.championId)}" alt=""><b>${esc(me.champion)}</b><span>Nv ${me.level} · ${kda(me)}</span></div>
          <div class="diffs">
            <div><span class="${diffCls(d.lvl)}">${signed(d.lvl)}</span> nível</div>
            <div><span class="${diffCls(d.cs)}">${signed(d.cs)}</span> CS</div>
            <div><span class="${diffCls(d.gold)}">${signed(d.gold)}</span> ouro em itens</div>
          </div>
          <div class="side right"><img src="${img.champ(op.championId)}" alt="" class="${op.dead ? 'dead' : ''}"><b>${esc(op.champion)}</b><span>Nv ${op.level} · ${kda(op)}${op.dead ? ` · 💀 ${op.respawn}s` : ''}</span></div>
        </div>
        <div class="items-row"><div>${me.items.map((i) => itemImg(i)).join('')}</div><div class="right">${op.items.map((i) => itemImg(i)).join('')}</div></div>
      </div>`;
  })() : '';

  const m = L.matchup;
  const matchup = !op || !m ? '' : m.loading ? `<div class="card muted" style="margin-top:12px">Buscando matchup no OP.GG…</div>` : m.error ? '' : `
    <div class="card" style="margin-top:12px">
      <div class="label" style="margin-top:0">Matchup · OP.GG</div>
      <div class="mu-stats">
        <div><b class="${m.winRate >= 0.5 ? 'up' : 'down'}">${m.winRate != null ? (m.winRate * 100).toFixed(1) + '%' : '—'}</b><span>vitórias de ${esc(me.champion)}${m.games ? ` (${m.games} jogos)` : ''}</span></div>
        <div><b>${ADV_PT(m.laneAdvantage, op.champion)}</b><span>vantagem na lane</span></div>
        <div><b>${STYLE_PT[m.playStyle] || esc(m.playStyle || '—')}</b><span>estilo</span></div>
      </div>
      ${m.tip ? `<p class="tip">💡 ${esc(m.tip)}</p>` : ''}
      ${m.core?.length ? `<div class="muted" style="font-size:12px;margin-top:8px">Core que mais vence contra ${esc(op.champion)}:</div><div class="items-line">${m.core.map((i) => itemImg(i, 'md')).join('<span class="muted">›</span>')}</div>` : ''}
    </div>`;

  const tips = L.tips?.length ? `
    <div class="card" style="margin-top:12px">
      <div class="label" style="margin-top:0">Dicas agora</div>
      ${L.tips.map((t) => `<div class="tip-row">${t.item ? itemImg(t.item, 'md') : '<span class="tip-ico">⚡</span>'}<span>${esc(t.text)}</span></div>`).join('')}
    </div>` : '';

  const teamRows = (team) => L.players.filter((p) => p.team === team).map((p) => `
    <div class="prow ${p.riotId === me.riotId ? 'me' : ''}">
      <img class="pchamp ${p.dead ? 'dead' : ''}" src="${img.champ(p.championId)}" alt="">
      <div class="pinfo"><b>${esc(p.champion)}</b><span>Nv ${p.level} · ${kda(p)} · ${p.cs} CS${p.dead ? ` · 💀${p.respawn}s` : ''}</span></div>
      <div class="pitems">${p.items.map((i) => itemImg(i, 'sm')).join('')}</div>
    </div>`).join('');

  const feed = L.kills?.length ? `
    <div class="card" style="margin-top:12px">
      <div class="label" style="margin-top:0">Últimos abates</div>
      ${L.kills.map((k) => `<div class="kill ${k.ally ? 'ally' : 'enemy'} ${k.involvesMe ? 'mine' : ''}">
        <span class="muted">${fmtTime(k.t)}</span>${k.killer ? `<img src="${img.champ(k.killer)}" alt="">` : '<span>🗼</span>'}<span>⚔</span><img src="${img.champ(k.victim)}" alt="">
      </div>`).join('')}
    </div>` : '';

  patch($('#screen'), `
    <div class="ig-head">
      <div class="clock" data-gameclock="${clockBase}">0:00</div>
      <div class="score"><b class="ally">${A.kills}</b><span>×</span><b class="enemy">${E.kills}</b></div>
    </div>
    <div class="goldbar"><span style="width:${goldPct.toFixed(1)}%"></span></div>
    <div class="gold-txt"><span>${(A.gold / 1000).toFixed(1)}k</span><span class="${diffCls(goldDiff)}">${signed(Math.round(goldDiff / 100) / 10, 'k')} em itens</span><span>${(E.gold / 1000).toFixed(1)}k</span></div>
    <div class="objs">
      <div>🐉 <b class="ally">${A.dragons.length}</b> × <b class="enemy">${E.dragons.length}</b><small>próx. ${countdown(L.timers.nextDragon)}</small></div>
      <div>🗼 <b class="ally">${A.towers}</b> × <b class="enemy">${E.towers}</b><small>torres</small></div>
      <div>👁 <b class="ally">${A.barons}</b> × <b class="enemy">${E.barons}</b><small>${L.timers.nextBaron ? `barão ${countdown(L.timers.nextBaron)}` : 'barões'}</small></div>
    </div>
    ${lane}
    ${matchup}
    ${tips}
    <div class="label">Seu time</div><div class="card team-card">${teamRows(L.myTeam)}</div>
    <div class="label">Time inimigo · dano ${Math.round(L.magicShare * 100)}% mágico</div><div class="card team-card">${teamRows(L.myTeam === 'ORDER' ? 'CHAOS' : 'ORDER')}</div>
    ${feed}`);
  updateActionBar('');
}

function renderPostGame() {
  setBackground(st.game?.championId);
  screen('post', '');
  patch($('#screen'), `
    <div class="center" style="padding-top:20vh">
      <h1 class="title">Partida finalizada</h1>
      <p class="sub">Quer entrar na fila de novo com a mesma sala?</p>
    </div>`);
  updateActionBar(st.phase === 'EndOfGame' ? `<button class="btn wide primary big" data-act="playAgain">Jogar de novo</button>` : `<div class="note">Carregando resultados…</div>`);
}

// ---------------- seleção de campeões ----------------
const CS_SKELETON = `
  <div class="cs-head"><div><div class="muted" id="csSub"></div><div class="phase" id="csPhase"></div></div><div class="timer" id="csTimer"></div></div>
  <div class="teams"><div class="team" id="csAllies"></div><div class="team enemy" id="csEnemies"></div></div>
  <div id="csBans"></div>
  <div id="csMe"></div>
  <div class="tabs" id="csTabs"></div>
  <div id="panePick">
    <input class="search" id="search" type="search" placeholder="Buscar campeão…" autocomplete="off" enterkeyhint="search">
    <div class="filters" id="filters"></div>
    <div class="grid" id="grid"></div>
  </div>
  <div id="paneSpells" hidden></div>
  <div id="paneSkin" hidden></div>
  <div id="paneRunes" hidden></div>`;

function phaseText(cs) {
  const t = cs.timer.phase;
  if (cs.action?.type === 'ban') return ['Sua vez', 'Banir um campeão'];
  if (cs.action?.type === 'pick') return ['Sua vez', 'Escolher seu campeão'];
  if (t === 'PLANNING') return ['Planejamento', 'Declare sua intenção'];
  if (t === 'FINALIZATION') return ['Finalização', 'Feitiços, skin e runas'];
  if (t === 'GAME_STARTING') return ['Carregando', 'A partida vai começar'];
  if (cs.locked) return ['Confirmado', 'Aguardando os outros'];
  return ['Seleção', cs.nextAction?.type === 'ban' ? 'Seu banimento vem aí' : 'Aguardando sua vez'];
}

function slotHtml(m, enemy) {
  const key = m.championId || m.intent;
  const icon = key ? `<img src="${img.champ(key)}" alt="">` : '';
  return `<div class="slot ${m.isMe ? 'me' : ''} ${m.picking ? 'picking' : ''}">
    <div class="av ${!m.championId && m.intent ? 'intent' : ''}">${icon}</div>
    <div class="meta"><b>${esc(key ? cname(key) : enemy ? '—' : (m.picking ? 'Escolhendo…' : '…'))}</b>
    ${m.position ? `<img class="pos" src="${img.pos(m.position)}" alt="" style="display:inline-block;vertical-align:middle">` : ''}
    ${!enemy ? `<span class="muted">${esc(m.isMe ? 'Você' : m.name)}</span>` : ''}</div></div>`;
}

function renderChampSelect() {
  const cs = st.champSelect;
  const meKey = cs.me.championId;
  setBackground(meKey || ui.selected, cs.me.skinId);
  const main = screen(`cs:${cs.gameId}`, CS_SKELETON);
  if (main.querySelector('#search').value !== ui.search && document.activeElement !== main.querySelector('#search')) main.querySelector('#search').value = ui.search;

  const [sub, phase] = phaseText(cs);
  patch($('#csSub'), esc(sub));
  patch($('#csPhase'), esc(phase));
  $('#csTimer').dataset.deadline = String(recvAt + cs.timer.remainingMs);

  patch($('#csAllies'), cs.myTeam.map((m) => slotHtml(m, false)).join(''));
  patch($('#csEnemies'), cs.theirTeam.map((m) => slotHtml(m, true)).join(''));
  const bans = [...cs.bans.ally, ...cs.bans.enemy].length
    ? `<div class="bans"><span class="side">Bans</span>${cs.bans.ally.map((k) => `<img src="${img.champ(k)}" alt="">`).join('')}<span style="flex:1"></span>${cs.bans.enemy.map((k) => `<img src="${img.champ(k)}" alt="">`).join('')}</div>`
    : '';
  patch($('#csBans'), bans);

  const showKey = meKey || ui.selected;
  patch($('#csMe'), showKey ? `
    <div class="me-card" style="background-image:url('${img.centered(showKey, meKey ? cs.me.skinId : 0)}')">
      <div class="cap"><div><div class="muted">${cs.locked ? 'Seu campeão' : cs.me.hovering || ui.selected ? 'Selecionado' : ''}${cs.me.position ? ` · ${POS_PT[cs.me.position]}` : ''}</div><h2>${esc(cname(showKey))}</h2></div>
      <button class="fav" data-act="fav" data-k="${showKey}">${favs.has(Number(showKey)) ? '★' : '☆'}</button></div>
    </div>` : `<div class="me-card empty">Escolha seu campeão abaixo</div>`);

  // abas
  const canPick = !cs.locked && !cs.aram;
  if (!canPick && ui.tab === 'pick' && !cs.action) ui.tab = cs.aram ? 'pick' : 'spells';
  const tabs = [['pick', cs.aram ? 'Banco' : cs.action?.type === 'ban' ? 'Banir' : 'Campeões', true], ['spells', 'Feitiços', true], ['skin', 'Skin', cs.skins.length > 0], ['runes', 'Runas', Boolean(meKey || ui.selected)]];
  patch($('#csTabs'), tabs.map(([k, label, enabled]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" ${enabled ? '' : 'disabled'}>${label}</button>`).join(''));
  $('#panePick').hidden = ui.tab !== 'pick';
  $('#paneSpells').hidden = ui.tab !== 'spells';
  $('#paneSkin').hidden = ui.tab !== 'skin';
  $('#paneRunes').hidden = ui.tab !== 'runes';

  if (ui.tab === 'pick') renderGrid(cs);
  if (ui.tab === 'spells') renderSpells(cs);
  if (ui.tab === 'skin') renderSkins(cs);
  if (ui.tab === 'runes') renderRunes(cs);

  // barra de ação
  const sel = ui.selected || cs.action?.championId || 0;
  let bar = '';
  if (cs.action?.type === 'ban') bar = `<button class="btn wide red big" data-act="lock" ${sel ? '' : 'disabled'}>${sel ? `BANIR ${esc(cname(sel).toUpperCase())}` : 'Escolha quem banir'}</button>`;
  else if (cs.action?.type === 'pick') bar = `<button class="btn wide primary big" data-act="lock" ${sel ? '' : 'disabled'}>${sel ? `CONFIRMAR ${esc(cname(sel).toUpperCase())}` : 'Escolha um campeão'}</button>`;
  else if (cs.locked) bar = `<div class="note">✔ ${esc(cname(meKey))} confirmado${cs.timer.phase === 'FINALIZATION' ? ' — ajuste feitiços, skin e runas' : ''}</div>`;
  else if (cs.aram) bar = `<button class="btn wide" data-act="reroll">🎲 Rerrolar</button>`;
  else bar = `<div class="note">${cs.nextAction?.type === 'pick' ? 'Toque num campeão para pré-selecionar (o time vê sua intenção)' : 'Aguarde sua vez'}</div>`;
  updateActionBar(bar);
}

function renderGrid(cs) {
  patch($('#filters'), TAGS.map(([k, label]) => `<button class="${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${label}</button>`).join(''));
  let ids;
  if (cs.aram) ids = cs.bench;
  else if (cs.action?.type === 'ban') ids = cs.bannable;
  else ids = cs.pickable;
  const q = norm(ui.search);
  const list = ids
    .filter((k) => G.champs[k])
    .filter((k) => !q || norm(G.champs[k].name).includes(q))
    .filter((k) => ui.filter === 'all' || (ui.filter === 'fav' ? favs.has(k) : G.champs[k].tags.includes(ui.filter)))
    .sort((a, b) => Number(favs.has(b)) - Number(favs.has(a)) || G.champs[a].name.localeCompare(G.champs[b].name));
  const sel = ui.selected || cs.action?.championId || (cs.me.hovering ? cs.me.championId : 0);
  patch($('#grid'), list.length
    ? list.map((k) => `<button class="champ ${k === sel ? 'sel' : ''} ${favs.has(k) ? 'fav' : ''}" data-act="pick" data-k="${k}"><img src="${img.champ(k)}" alt="" loading="lazy"><span>${esc(G.champs[k].name)}</span></button>`).join('')
    : `<div class="muted" style="grid-column:1/-1;padding:20px;text-align:center">${cs.aram ? 'Banco vazio' : 'Nenhum campeão encontrado'}</div>`);
}

function spellList(cs) {
  const mode = cs.aram ? 'ARAM' : 'CLASSIC';
  return Object.values(G.spells).filter((s) => s.modes.includes(mode)).sort((a, b) => a.name.localeCompare(b.name));
}
function renderSpells(cs) {
  const s1 = cs.me.spell1Id, s2 = cs.me.spell2Id;
  patch($('#paneSpells'), `
    <div class="spell-slots">
      <button class="spell-slot ${ui.slot === 1 ? 'on' : ''}" data-act="slot" data-s="1"><img src="${img.spell(s1)}" alt=""><div><b>D</b><div class="muted">${esc(G.spells[s1]?.name || '')}</div></div></button>
      <button class="spell-slot ${ui.slot === 2 ? 'on' : ''}" data-act="slot" data-s="2"><img src="${img.spell(s2)}" alt=""><div><b>F</b><div class="muted">${esc(G.spells[s2]?.name || '')}</div></div></button>
    </div>
    <div class="spells">${spellList(cs).map((s) => `<button class="${s.key === s1 || s.key === s2 ? 'on' : ''}" data-act="spell" data-k="${s.key}" title="${esc(s.name)}"><img src="${img.spell(s.key)}" alt="${esc(s.name)}"></button>`).join('')}</div>
    ${cs.me.championId || cs.me.hovering ? `<button class="btn wide" style="margin-top:14px" data-act="opggSpells">Usar feitiços do OP.GG</button>` : ''}`);
}

function renderSkins(cs) {
  const key = cs.me.championId;
  patch($('#paneSkin'), cs.skins.length ? `<div class="skins">${cs.skins.map((s) => `
      <button class="skin ${s.id === cs.me.skinId ? 'on' : ''}" data-act="skin" data-id="${s.id}">
        <img src="${img.loading(key, s.id)}" alt="" loading="lazy"><span>${esc(s.name)}</span></button>`).join('')}</div>`
    : `<p class="muted">Nenhuma skin disponível.</p>`);
}

function renderRunes(cs) {
  const key = cs.me.championId || ui.selected;
  const lane = ui.lane || cs.me.position || 'MIDDLE';
  patch($('#paneRunes'), `
    <p class="muted" style="margin:14px 0 8px">Importa a página de runas mais jogada no OP.GG para <b style="color:var(--text)">${esc(cname(key))}</b>. Se suas páginas estiverem cheias, a página atual é substituída.</p>
    <div class="label">Rota</div>
    <div class="pos-row">${POS.slice(0, 5).map((p) => `<button class="chip ${lane === p ? 'on' : ''}" data-act="lane" data-pos="${p}"><img src="${img.pos(p)}" alt="${POS_PT[p]}"></button>`).join('')}</div>
    <button class="btn wide primary" style="margin-top:14px" data-act="runes" data-k="${key}" data-lane="${lane}">Importar runas · ${POS_PT[lane]}</button>
    ${st.settings?.autoRunes ? '<p class="muted" style="font-size:13px">Importação automática ligada: acontece sozinha ao confirmar o campeão.</p>' : ''}`);
}

function updateActionBar(html) {
  let bar = $('#actionBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'actionBar';
    bar.className = 'actionbar';
    document.body.append(bar);
  }
  patch(bar, `<div>${html}</div>`);
  bar.hidden = !html;
}

// ---------------- cronômetros ----------------
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function tickTimers() {
  const now = Date.now();
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const left = Math.max(0, (Number(el.dataset.deadline) - now) / 1000);
    el.textContent = Math.ceil(left);
    el.classList.toggle('low', left < 10);
  });
  document.querySelectorAll('[data-ring]').forEach((el) => {
    const left = Math.max(0, (Number(el.dataset.ring) - now) / 1000);
    el.style.setProperty('--p', ((left / 12) * 100).toFixed(1));
  });
  document.querySelectorAll('[data-since]').forEach((el) => {
    el.textContent = fmtTime((now - Number(el.dataset.since)) / 1000);
  });
  document.querySelectorAll('[data-gameclock]').forEach((el) => {
    el.textContent = fmtTime((now - Number(el.dataset.gameclock)) / 1000);
  });
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const left = (Number(el.dataset.countdown) - now) / 1000;
    el.textContent = left > 0 ? fmtTime(left) : 'agora';
  });
  requestAnimationFrame(tickTimers);
}

// ---------------- eventos ----------------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = el.dataset.act;
  const cs = st?.champSelect;
  try {
    if (a === 'sheet') { $('#sheet').hidden = !$('#sheet').hidden; return; }
    if (a === 'sound') {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      await audio.resume();
      beep(); navigator.vibrate?.(200);
      toast('Alertas ativados para quando a partida for encontrada', 'ok');
      return;
    }
    if (a === 'queue') { await act('createLobby', { queueId: el.dataset.q }); return; }
    if (a === 'pos') {
      const [first, second] = st.lobby?.positions || [];
      const pos = el.dataset.pos;
      const next = el.dataset.which === 'first' ? { first: pos, second: second === pos ? first : second } : { first: first === pos ? second : first, second: pos };
      await act('positions', next);
      return;
    }
    if (a === 'search' || a === 'cancelSearch' || a === 'accept' || a === 'decline' || a === 'playAgain' || a === 'reroll') {
      el.disabled = true;
      await act(a);
      if (a === 'accept') navigator.vibrate?.(80);
      return;
    }
    if (a === 'tab') { ui.tab = el.dataset.tab; render(); return; }
    if (a === 'filter') { ui.filter = el.dataset.f; render(); return; }
    if (a === 'fav') {
      const k = Number(el.dataset.k);
      favs.has(k) ? favs.delete(k) : favs.add(k);
      store.set('favs', [...favs]);
      render();
      return;
    }
    if (a === 'pick') {
      const k = Number(el.dataset.k);
      if (cs?.aram) { await act('benchSwap', { championId: k }); return; }
      ui.selected = k;
      render();
      if (cs?.action || cs?.nextAction?.type === 'pick') act('hover', { championId: k }).catch(() => {});
      return;
    }
    if (a === 'lock') {
      el.disabled = true;
      await act('lock', { championId: ui.selected || cs?.action?.championId });
      navigator.vibrate?.(60);
      ui.selected = null;
      return;
    }
    if (a === 'slot') { ui.slot = Number(el.dataset.s); render(); return; }
    if (a === 'spell') {
      const k = Number(el.dataset.k);
      let s1 = cs.me.spell1Id, s2 = cs.me.spell2Id;
      if (ui.slot === 1) { if (k === s2) s2 = s1; s1 = k; } else { if (k === s1) s1 = s2; s2 = k; }
      await act('spells', { spell1Id: s1, spell2Id: s2 });
      ui.slot = ui.slot === 1 ? 2 : 1;
      return;
    }
    if (a === 'opggSpells') { await act('opggSpells'); toast('Feitiços do OP.GG aplicados', 'ok'); return; }
    if (a === 'skin') { await act('skin', { skinId: el.dataset.id }); return; }
    if (a === 'lane') { ui.lane = el.dataset.pos; render(); return; }
    if (a === 'runes') {
      el.disabled = true;
      const r = await act('runes', { championId: Number(el.dataset.k), position: el.dataset.lane });
      toast(`${r.text}${r.replaced ? ` (substituiu “${r.replaced}”)` : ''}`, 'ok');
      el.disabled = false;
    }
  } catch { if (el.isConnected) el.disabled = false; }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.search = e.target.value; if (st?.champSelect) renderGrid(st.champSelect); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'optAccept' || e.target.id === 'optRunes') {
    await fetch('/api/live/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [e.target.id === 'optAccept' ? 'autoAccept' : 'autoRunes']: e.target.checked }),
    });
    toast('Configuração salva', 'ok');
  }
});

// ---------------- início ----------------
async function boot() {
  try {
    const [v] = await (await fetch(`${DD}/api/versions.json`)).json();
    G.v = v;
    const [champs, summs] = await Promise.all([
      fetch(`${DD}/cdn/${v}/data/pt_BR/champion.json`).then((r) => r.json()),
      fetch(`${DD}/cdn/${v}/data/pt_BR/summoner.json`).then((r) => r.json()),
    ]);
    for (const c of Object.values(champs.data)) G.champs[Number(c.key)] = { id: c.id, name: c.name, tags: c.tags };
    for (const s of Object.values(summs.data)) G.spells[Number(s.key)] = { key: Number(s.key), name: s.name, image: s.image.full, modes: s.modes };
  } catch {
    toast('Sem internet no celular para carregar as imagens do jogo', 'err');
  }
  setBackground();
  if (MOCK) {
    window.__mock = (state) => { st = state; recvAt = Date.now(); onPhaseChange(); render(); };
    setStatus(true, 'Modo demonstração');
  } else {
    connect();
  }
  requestAnimationFrame(tickTimers);
  render();
}
boot();

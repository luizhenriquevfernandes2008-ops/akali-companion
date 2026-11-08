// Akali Companion — frontend
const DD = 'https://ddragon.leagueoflegends.com';
const CD = 'https://raw.communitydragon.org/latest';
const LANG = 'pt_BR';
const NEW_KDA_SKIN = 102; // Akali K/DA FIRESTARTER Ignição
const DEFAULT_PPG = 700;   // pontos de maestria por partida (estimativa até termos seu histórico real)

const S = {
  v: null, akali: null, items: {}, runes: {}, summs: {}, champsByKey: {}, champsById: {},
  data: null, config: { hasKey: false, platforms: ['br1'] },
  player: null, loading: false, error: null, lcuChecking: false,
  lane: 'MIDDLE', queue: 'all', rotateTimer: null,
};

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const QUEUES = {
  420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (Escolha)', 430: 'Normal (Às cegas)',
  490: 'Partida Rápida', 480: 'Swiftplay', 450: 'ARAM', 1700: 'Arena', 700: 'Clash', 900: 'URF', 1900: 'URF',
};
const LANES = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte', UNKNOWN: '—' };
const LANE_ICON = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };
const SHARDS = {
  5008: ['Força Adaptativa', 'StatModsAdaptiveForceIcon'],
  5005: ['Velocidade de Ataque', 'StatModsAttackSpeedIcon'],
  5007: ['Aceleração de Habilidade', 'StatModsCDRScalingIcon'],
  5010: ['Velocidade de Movimento', 'StatModsMovementSpeedIcon'],
  5001: ['Vida Escalável', 'StatModsHealthScalingIcon'],
  5011: ['Vida', 'StatModsHealthPlusIcon'],
  5013: ['Tenacidade e Resistência a Lentidão', 'StatModsTenacityIcon'],
};

// ---------------- utilidades ----------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => `${fmt(n, 0)}%`;
async function getJSON(url) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Erro ${r.status}`);
  return body;
}
function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 3600) return `há ${Math.max(1, Math.round(d / 60))} min`;
  if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  return `há ${Math.round(d / 86400)} d`;
}

// ---------------- URLs de imagem ----------------
const img = {
  splash: (n) => `${DD}/cdn/img/champion/splash/Akali_${n}.jpg`,
  loading: (n) => `${DD}/cdn/img/champion/loading/Akali_${n}.jpg`,
  tile: (n) => `${DD}/cdn/img/champion/tiles/Akali_${n}.jpg`,
  champ: (id) => `${DD}/cdn/${S.v}/img/champion/${id}.png`,
  item: (id) => `${DD}/cdn/${S.v}/img/item/${id}.png`,
  spell: (file) => `${DD}/cdn/${S.v}/img/spell/${file}`,
  passive: (file) => `${DD}/cdn/${S.v}/img/passive/${file}`,
  rune: (icon) => `${DD}/cdn/img/${icon}`,
  shard: (id) => `${DD}/cdn/img/perk-images/StatMods/${SHARDS[id]?.[1]}.png`,
  profile: (id) => `${DD}/cdn/${S.v}/img/profileicon/${id}.png`,
  emblem: (tier) => `${CD}/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png`,
  lane: (l) => `${CD}/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${LANE_ICON[l] || 'fill'}.png`,
};

const champInfo = (idOrKey) => S.champsById[idOrKey] || S.champsByKey[idOrKey] || { id: idOrKey, name: idOrKey };
const itemIcon = (id, cls = '') =>
  id ? `<img class="icon ${cls}" src="${img.item(id)}" data-tip="item:${id}" alt="${esc(S.items[id]?.name)}" loading="lazy">`
     : `<div class="icon ${cls} empty-slot"></div>`;
const champIcon = (idOrKey, cls = '') => {
  const c = champInfo(idOrKey);
  return `<img class="icon ${cls}" src="${img.champ(c.id)}" alt="${esc(c.name)}" data-tip="text:${esc(c.name)}" loading="lazy">`;
};
const runeIcon = (id, cls = 'rune') => {
  const r = S.runes[id];
  return r ? `<img class="${cls}" src="${img.rune(r.icon)}" alt="${esc(r.name)}" data-tip="rune:${id}" loading="lazy">` : '';
};
const shardIcon = (id) => `<img class="shard" src="${img.shard(id)}" alt="${esc(SHARDS[id]?.[0])}" data-tip="text:${esc(SHARDS[id]?.[0])}">`;
const summIcon = (key) => {
  const s = S.summs[key];
  return s ? `<img class="icon" src="${img.spell(s.image.full)}" alt="${esc(s.name)}" data-tip="summ:${key}">` : '';
};
// ---------------- dados remotos (OP.GG) ----------------
const remote = {};
function useRemote(key, url) {
  if (!remote[key]) {
    remote[key] = { status: 'loading' };
    getJSON(url)
      .then((data) => { remote[key] = { status: 'ok', data }; render(); })
      .catch((e) => { remote[key] = { status: 'error', error: e.message }; render(); });
  }
  return remote[key];
}
const pctR = (r) => (r == null ? '—' : `${fmt(r * 100, 1)}%`);
const wrCls = (r) => (r == null ? '' : r >= 0.5 ? 'win' : 'loss');
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const opggChip = (txt = 'OP.GG') => `<span class="chip opgg-chip">${txt}</span>`;
const remoteState = (r, what) =>
  r.status === 'loading' ? `<div class="panel muted">Carregando ${what} do OP.GG…</div>`
  : r.status === 'error' ? `<div class="error">Não foi possível carregar ${what} do OP.GG: ${esc(r.error)}</div>` : null;

const laneIcon = (l) => (LANE_ICON[l] ? `<img src="${img.lane(l)}" alt="" style="width:20px;height:20px">` : '');

// ---------------- fundo ----------------
let bgFlip = false;
function setBg(num) {
  const next = bgFlip ? $('#bgA') : $('#bgB');
  const prev = bgFlip ? $('#bgB') : $('#bgA');
  const pre = new Image();
  pre.onload = () => {
    next.style.setProperty('--img', `url(${img.splash(num)})`);
    next.classList.add('on');
    prev.classList.remove('on');
    bgFlip = !bgFlip;
  };
  pre.src = img.splash(num);
  S.bg = num;
}
const baseSkins = () => (S.akali?.skins || []).filter((s) => s.parentSkin == null);
const skinName = (num) => {
  const s = (S.akali?.skins || []).find((x) => x.num === num);
  return !s ? '' : s.name === 'default' ? 'Akali Clássica' : s.name;
};
function setRotation(on) {
  clearInterval(S.rotateTimer);
  store.set('rotate', on);
  if (!on) return;
  const kda = baseSkins().filter((s) => /K\/DA/.test(s.name)).map((s) => s.num);
  let i = Math.max(0, kda.indexOf(S.bg));
  S.rotateTimer = setInterval(() => {
    i = (i + 1) % kda.length;
    setBg(kda[i]);
    if (currentRoute() === '') render();
  }, 15000);
}

// ---------------- tooltip ----------------
function tipHtml(key) {
  const [type, ...rest] = key.split(':');
  const val = rest.join(':');
  if (type === 'text') return `<strong>${val}</strong>`;
  if (type === 'item') {
    const it = S.items[val];
    if (!it) return '<strong>Item removido do jogo</strong>';
    const desc = stripHtml(it.description).slice(0, 420).replace(/\n/g, '<br>');
    return `<strong>${esc(it.name)}</strong><span class="gold">${fmt(it.gold.total)} de ouro</span><br>${desc}`;
  }
  if (type === 'rune') {
    const r = S.runes[val];
    return r ? `<strong>${esc(r.name)}</strong>${esc(stripHtml(r.shortDesc || ''))}` : '';
  }
  if (type === 'summ') {
    const s = S.summs[val];
    return s ? `<strong>${esc(s.name)}</strong>${esc(stripHtml(s.description))}<br><span class="gold">Recarga: ${s.cooldownBurn}s</span>` : '';
  }
  if (type === 'ability') {
    if (val === 'P') return `<strong>${esc(S.akali.passive.name)} (Passiva)</strong>${esc(stripHtml(S.akali.passive.description))}`;
    const sp = S.akali.spells['QWER'.indexOf(val)];
    return `<strong>${esc(sp.name)} (${val})</strong>${esc(stripHtml(sp.description))}<br><span class="gold">Recarga: ${sp.cooldownBurn}s</span>`;
  }
  return '';
}
function initTooltip() {
  const tip = $('#tooltip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return tip.classList.remove('on');
    tip.innerHTML = tipHtml(el.dataset.tip);
    tip.classList.toggle('on', Boolean(tip.innerHTML));
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip.classList.contains('on')) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > innerHeight - 8) y = e.clientY - h - 16;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  });
  // imagens que não existem mais (itens antigos, skins sem splash)
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t.tagName !== 'IMG') return;
    if (t.closest('.skin')) t.closest('.skin').remove();
    else t.style.visibility = 'hidden';
  }, true);
}

// ---------------- análise das partidas ----------------
function filteredMatches() {
  const ms = S.player?.matches || [];
  if (S.queue === 'all') return ms;
  if (S.queue === 'ranked') return ms.filter((m) => m.queue === 420 || m.queue === 440);
  return ms.filter((m) => String(m.queue) === S.queue);
}
function agg(ms) {
  const n = ms.length;
  const sum = (k) => ms.reduce((a, m) => a + (m[k] || 0), 0);
  const w = ms.filter((m) => m.win).length;
  const kpMs = ms.filter((m) => m.kp != null);
  return {
    n, w, l: n - w, wr: n ? (w / n) * 100 : 0,
    k: n ? sum('kills') / n : 0, d: n ? sum('deaths') / n : 0, a: n ? sum('assists') / n : 0,
    kda: (sum('kills') + sum('assists')) / Math.max(1, sum('deaths')),
    cs: n ? sum('csMin') / n : 0, dmg: n ? sum('dmgMin') / n : 0,
    kp: kpMs.length ? kpMs.reduce((a, m) => a + m.kp, 0) / kpMs.length : null,
    pentas: sum('pentas'),
  };
}
function groupBy(ms, keyFn) {
  const g = new Map();
  for (const m of ms) {
    const k = keyFn(m);
    if (k == null) continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(m);
  }
  return [...g.entries()].map(([k, list]) => ({ key: k, ...agg(list) })).sort((a, b) => b.n - a.n);
}
function isCompletedItem(id) {
  const it = S.items[id];
  if (!it || id === 0) return false;
  if (it.tags?.includes('Boots')) return it.gold.total >= 900;
  return it.gold.total >= 2200 && !(it.into && it.into.length) && !it.consumed;
}
function itemStats(ms) {
  const list = [];
  for (const m of ms) for (const id of new Set(m.items.slice(0, 6))) if (isCompletedItem(id)) list.push({ ...m, _item: id });
  return groupBy(list, (x) => x._item);
}

// ---------------- conta ----------------
async function loadPlayer(name, tag, platform) {
  S.loading = true; S.error = null; render(); renderAccount();
  try {
    const p = await getJSON(`/api/player?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&platform=${platform}`);
    S.player = p;
    store.set('riotId', { name: p.gameName, tag: p.tagLine, platform: p.platform || platform });
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render(); renderAccount();
  }
}
async function detectClient() {
  S.lcuChecking = true; S.error = null; renderAccount(); render();
  try {
    const l = await getJSON('/api/lcu');
    if (!l.connected) {
      S.error = 'Cliente do LoL não encontrado. Abra e faça login no cliente, ou digite seu Riot ID.';
      return false;
    }
    if (S.config.hasKey) {
      S.lcuChecking = false;
      await loadPlayer(l.gameName, l.tagLine, l.platform || 'br1');
    } else {
      S.player = { ...l, source: 'lcu', league: [] };
      store.set('riotId', { name: l.gameName, tag: l.tagLine, platform: l.platform || 'br1' });
    }
    return true;
  } catch (e) {
    S.error = e.message;
    return false;
  } finally {
    S.lcuChecking = false; render(); renderAccount();
  }
}
async function autoConnect() {
  const saved = store.get('riotId', null);
  S.lcuChecking = true; renderAccount();
  const l = await getJSON('/api/lcu').catch(() => ({ connected: false }));
  S.lcuChecking = false;
  if (l.connected) {
    if (S.config.hasKey) return loadPlayer(l.gameName, l.tagLine, l.platform || 'br1');
    S.player = { ...l, source: 'lcu', league: [] };
    render(); renderAccount();
    return;
  }
  if (saved && S.config.hasKey) return loadPlayer(saved.name, saved.tag, saved.platform);
  renderAccount();
}

function renderAccount() {
  const box = $('#accountBox');
  const p = S.player;
  if (S.loading || S.lcuChecking) {
    box.innerHTML = `<div class="panel muted" style="padding:14px">${S.lcuChecking ? 'Procurando o cliente do LoL…' : 'Carregando sua conta…'}</div>`;
    return;
  }
  if (!p) {
    box.innerHTML = `<div class="panel" style="padding:14px"><div class="muted" style="font-size:12px;margin-bottom:8px">Nenhuma conta conectada</div><a class="btn small primary" href="#/">Conectar</a></div>`;
    return;
  }
  const m = p.mastery;
  box.innerHTML = `
    <div class="panel" style="padding:14px;display:flex;gap:10px;align-items:center">
      <img class="icon round" src="${img.profile(p.profileIconId)}" alt="">
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.gameName)}<span class="muted">#${esc(p.tagLine)}</span></div>
        <div class="muted" style="font-size:12px">${m ? `Maestria ${m.championLevel} · ${fmt(m.championPoints)} pts` : 'Sem maestria de Akali'}</div>
        <div class="muted" style="font-size:11px">${p.source === 'lcu' ? 'via cliente do LoL' : 'via Riot API'}</div>
      </div>
      <button class="btn small" data-action="logout" title="Desconectar">✕</button>
    </div>`;
}

// ---------------- views ----------------
function needPlayer() {
  if (S.loading) return `<div class="loading">Buscando suas partidas de Akali… (a primeira vez pode levar até 1 minuto por causa do limite da API)</div>`;
  return `
    <div class="panel" style="max-width:560px">
      <h2 style="font-size:26px">Conecte sua conta</h2>
      <p class="muted">Para ver suas estatísticas e a previsão de maestria, conecte sua conta na página inicial.</p>
      ${S.error ? `<div class="error">${esc(S.error)}</div><br>` : ''}
      <a class="btn primary" href="#/">Ir para conexão</a>
    </div>`;
}

function laneTabs() {
  return `<div class="tabs">${['MIDDLE', 'TOP'].map((l) =>
    `<button class="tab ${S.lane === l ? 'active' : ''}" data-action="lane" data-lane="${l}">${laneIcon(l)} ${LANES[l]}</button>`).join('')}</div>`;
}

function viewHome() {
  const p = S.player;
  const a = p ? agg(p.matches || []) : null;
  const kda = baseSkins().filter((s) => /K\/DA/.test(s.name) || s.num === NEW_KDA_SKIN);
  const abilities = ['P', 'Q', 'W', 'E', 'R'].map((k) => {
    const src = k === 'P' ? img.passive(S.akali.passive.image.full) : img.spell(S.akali.spells['QWER'.indexOf(k)].image.full);
    return `<div class="ability" data-tip="ability:${k}"><img class="icon lg" src="${src}" alt="${k}"><span class="key">${k}</span></div>`;
  }).join('');

  const connect = p
    ? `<div class="grid g6" style="margin-top:28px;max-width:900px">
        ${tile('Maestria', p.mastery ? `Nv ${p.mastery.championLevel}` : '—', p.mastery ? `${fmt(p.mastery.championPoints)} pontos` : '')}
        ${tile('Partidas', a.n, `últimas ${p.scanned ?? a.n} analisadas`)}
        ${tile('Winrate', a.n ? pct(a.wr) : '—', `${a.w}V ${a.l}D`, a.wr >= 50 ? 'win' : 'loss')}
        ${tile('KDA', a.n ? fmt(a.kda, 2) : '—', a.n ? `${fmt(a.k, 1)} / ${fmt(a.d, 1)} / ${fmt(a.a, 1)}` : '')}
        ${tile('CS/min', a.n ? fmt(a.cs, 1) : '—')}
        ${tile('Dano/min', a.n ? fmt(a.dmg) : '—')}
      </div>`
    : `<form class="connect" data-form="connect">
        <input class="input" name="riotId" placeholder="Seu Riot ID (Nome#TAG)" value="${esc(store.get('riotId', null) ? `${store.get('riotId').name}#${store.get('riotId').tag}` : '')}" required>
        <select class="input" name="platform">${S.config.platforms.map((pl) => `<option value="${pl}" ${pl === (store.get('riotId', null)?.platform || 'br1') ? 'selected' : ''}>${pl.toUpperCase()}</option>`).join('')}</select>
        <button class="btn primary" ${S.loading ? 'disabled' : ''}>${S.loading ? 'Carregando…' : 'Conectar'}</button>
        <button type="button" class="btn" data-action="detect" ${S.lcuChecking ? 'disabled' : ''}>⚡ Detectar pelo cliente do LoL</button>
      </form>
      ${!S.config.hasKey ? `<p class="muted" style="font-size:12px;margin-top:10px">Sem API key configurada: use “Detectar pelo cliente” com o LoL aberto, ou coloque sua chave no arquivo <code>.env</code>.</p>` : ''}
      ${S.error ? `<div class="error" style="margin-top:12px;max-width:640px">${esc(S.error)}</div>` : ''}`;
  const warn = p?.warning ? `<div class="error" style="margin-top:14px;max-width:900px">⚠ ${esc(p.warning)} — usando os dados do cliente do LoL por enquanto. <a href="#/config" style="text-decoration:underline">Atualizar chave</a></div>` : '';

  return `
    <section class="hero">
      <div class="eyebrow">League of Legends · Meio / Topo</div>
      <h1>AKALI</h1>
      <div class="title">${esc(S.akali.title)}</div>
      <div class="skin-name"><span class="chip pink">${esc(skinName(S.bg))}</span></div>
      <div class="abilities" style="margin-top:22px">${abilities}</div>
      ${connect}
      ${warn}
    </section>
    <div class="section-title">Fundo <small>clique para trocar · <label style="cursor:pointer"><input type="checkbox" data-action="rotate" ${store.get('rotate', false) ? 'checked' : ''}> alternar entre as skins K/DA</label></small></div>
    <div class="icons">
      ${kda.map((s) => `<img class="icon lg" style="cursor:pointer;${s.num === S.bg ? 'border-color:var(--pink);box-shadow:0 0 0 2px var(--pink)' : ''}" src="${img.tile(s.num)}" data-action="skin" data-num="${s.num}" data-tip="text:${esc(s.name)}" alt="">`).join('')}
      <a class="btn small" href="#/skins" style="margin-left:6px">Todas as skins →</a>
    </div>`;
}

function tile(label, value, hint = '', cls = '') {
  return `<div class="panel tile"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function skillGrid(levels) {
  const rows = ['Q', 'W', 'E', 'R'].map((k) => {
    const sp = S.akali.spells['QWER'.indexOf(k)];
    return `<img class="icon sm" src="${img.spell(sp.image.full)}" data-tip="ability:${k}" alt="${k}">` +
      levels.map((l) => `<div class="cell ${l === k ? 'on' : ''} ${l === 'R' && k === 'R' ? 'r' : ''}">${l === k ? k : ''}</div>`).join('');
  }).join('');
  return `<div class="skill-grid" style="grid-template-columns:40px repeat(${levels.length}, minmax(0, 1fr))">
    <div></div>${levels.map((_, i) => `<div class="lvl">${i + 1}</div>`).join('')}${rows}</div>`;
}

function runesBlock(r) {
  return `<div class="runes">
    <div class="rune-col">${runeIcon(r.primary, 'style-icon')}${runeIcon(r.keystone, 'keystone')}${r.minor.map((id) => runeIcon(id)).join('')}</div>
    <div class="rune-col">${runeIcon(r.secondary, 'style-icon')}${r.secondaryRunes.map((id) => runeIcon(id)).join('')}</div>
    <div class="rune-col">${r.shards.map(shardIcon).join('')}</div>
  </div>`;
}
const statLine = (x) => (x ? `<div class="stat-line"><b class="${wrCls(x.winRate)}">${pctR(x.winRate)} WR</b> · ${pctR(x.pickRate)} pick · ${fmt(x.games)} jogos</div>` : '');
const itemSeq = (ids) => ids.map((id, i) => `${i ? '<span class="arrow">›</span>' : ''}${itemIcon(id)}`).join('');

function opggMeta() {
  const r = useRemote(`meta:${S.lane}`, `/api/opgg/meta?lane=${S.lane}`);
  const st = remoteState(r, 'as estatísticas');
  if (st) return st;
  const m = r.data;
  const options = (title, list) => list?.length ? `<div><div class="block-label">${title}</div><div class="opts">${list.map((x) => `
      <div class="opt">${itemIcon(x.ids[0])}<div><b class="${wrCls(x.winRate)}">${pctR(x.winRate)}</b><span>${pctR(x.pickRate)}</span></div></div>`).join('')}</div></div>` : '';
  return `
    <article class="panel build opgg">
      <div class="build-head">
        <div><h3>Build mais jogada ${opggChip(`OP.GG · patch ${esc(m.patch || '')}`)}</h3>
        <div class="muted">${fmt(m.stats.games)} partidas ranqueadas de Akali no ${LANES[S.lane].toLowerCase()} neste patch.</div></div>
      </div>
      <div class="grid g6">
        ${tile('Winrate', pctR(m.stats.winRate), '', wrCls(m.stats.winRate))}
        ${tile('Pick rate', pctR(m.stats.pickRate))}
        ${tile('Ban rate', pctR(m.stats.banRate))}
        ${tile('KDA médio', fmt(m.stats.kda, 2))}
        ${tile('Tier', m.stats.tier ? `T${m.stats.tier}` : '—', m.stats.tier === 1 ? 'OP' : '1 = mais forte')}
        ${tile('Ranking', m.stats.rank ? `#${m.stats.rank}` : '—', 'entre campeões da rota')}
      </div>
      ${m.runes ? `<div><div class="block-label">Runas mais populares</div>${runesBlock(m.runes)}${statLine(m.runes)}</div>` : ''}
      <div class="item-row">
        ${m.spells ? `<div><div class="block-label">Feitiços</div><div class="icons">${m.spells.ids.map(summIcon).join('')}</div>${statLine(m.spells)}</div>` : ''}
        ${m.starter ? `<div><div class="block-label">Inicial</div><div class="icons">${m.starter.ids.map((id) => itemIcon(id)).join('')}</div>${statLine(m.starter)}</div>` : ''}
        ${m.core ? `<div><div class="block-label">Core</div><div class="icons">${itemSeq(m.core.ids)}</div>${statLine(m.core)}</div>` : ''}
        ${m.boots ? `<div><div class="block-label">Botas</div><div class="icons">${m.boots.ids.map((id) => itemIcon(id)).join('')}</div>${statLine(m.boots)}</div>` : ''}
      </div>
      <div class="item-row">
        ${options('4º item', m.fourth)}
        ${options('5º item', m.fifth)}
        ${options('6º item', m.sixth)}
      </div>
      ${m.skills?.order ? `<div><div class="block-label">Ordem de habilidades mais jogada ${m.skillMax ? `· maximize ${m.skillMax.join(' › ')}` : ''}</div>${skillGrid(m.skills.order)}${statLine(m.skills)}</div>` : ''}
      ${m.combos?.length ? `<div><div class="block-label">Combos (vídeos)</div><div class="icons">${m.combos.map((c) => `<a class="chip" href="${esc(c.video)}" target="_blank" rel="noopener">▶ ${esc(c.name)}</a>`).join('')}</div></div>` : ''}
    </article>`;
}

function viewBuilds() {
  const builds = S.data.builds[S.lane] || [];
  const { levels } = S.data.skillOrder;

  const mine = (S.player?.matches || []).filter((m) => m.lane === S.lane);
  let personal = '';
  if (S.player) {
    if (!mine.length) {
      personal = `<div class="empty">Nenhuma partida de Akali ${LANES[S.lane].toLowerCase()} no seu histórico recente.</div>`;
    } else {
      const items = itemStats(mine).slice(0, 8);
      const keys = groupBy(mine, (m) => m.keystone).slice(0, 3);
      personal = `
        <div class="panel grid g2">
          <div>
            <div class="block-label">Itens que você mais fecha (${mine.length} partidas)</div>
            <table><tbody>${items.map((i) => `
              <tr><td><div class="who">${itemIcon(i.key, 'sm')} ${esc(S.items[i.key]?.name || 'Item antigo')}</div></td>
              <td class="muted">${i.n}×</td><td class="${i.wr >= 50 ? 'win' : 'loss'}">${pct(i.wr)}</td></tr>`).join('')}</tbody></table>
          </div>
          <div>
            <div class="block-label">Suas runas principais</div>
            <table><tbody>${keys.map((k) => `
              <tr><td><div class="who">${runeIcon(k.key)} ${esc(S.runes[k.key]?.name || '—')}</div></td>
              <td class="muted">${k.n}×</td><td class="${k.wr >= 50 ? 'win' : 'loss'}">${pct(k.wr)}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>`;
    }
  }

  return `
    <h1 class="page-title">Builds</h1>
    <p class="page-sub">Estatísticas reais do OP.GG para o patch atual, mais builds alternativas. Passe o mouse em qualquer ícone para ver os detalhes.</p>
    ${laneTabs()}
    ${opggMeta()}
    <div class="section-title">Builds alternativas <small>variações para situações específicas</small></div>
    <div class="grid">
      ${builds.map((b) => buildCard(b)).join('')}
    </div>
    <div class="section-title">Ordem de habilidades padrão <small>maximize ${S.data.skillOrder.max.join(' › ')}</small></div>
    <div class="panel">${skillGrid(levels)}</div>
    ${S.player ? `<div class="section-title">Sua build na prática <small>baseado nas suas partidas</small></div>${personal}` : ''}`;
}

function buildCard(b) {
  const r = b.runes;
  const seq = (ids) => ids.map((id, i) => `${i ? '<span class="arrow">›</span>' : ''}${itemIcon(id)}`).join('');
  return `
    <article class="panel build">
      <div class="build-head">
        <div><h3>${esc(b.name)}</h3><div class="muted">${esc(b.desc)}</div></div>
        <span class="chip ${b.tag === 'Mais popular' ? 'pink' : 'gold'}">${esc(b.tag)}</span>
      </div>
      <div class="runes">
        <div class="rune-col">
          ${runeIcon(r.primary, 'style-icon')}
          ${runeIcon(r.keystone, 'keystone')}
          ${r.minor.map((id) => runeIcon(id)).join('')}
        </div>
        <div class="rune-col">
          ${runeIcon(r.secondary, 'style-icon')}
          ${r.secondaryRunes.map((id) => runeIcon(id)).join('')}
        </div>
        <div class="rune-col">${r.shards.map(shardIcon).join('')}</div>
      </div>
      <div class="item-row">
        <div><div class="block-label">Feitiços</div><div class="icons">${b.spells.map(summIcon).join('')}</div></div>
        <div><div class="block-label">Inicial</div><div class="icons">${b.start.map((id) => itemIcon(id)).join('')}</div></div>
        <div><div class="block-label">Core</div><div class="icons">${seq(b.core)}</div></div>
        <div><div class="block-label">Late game</div><div class="icons">${b.late.map((id) => itemIcon(id)).join('')}</div></div>
      </div>
      ${b.situational.length ? `<div><div class="block-label">Situacionais</div><div class="situ grid g2">
        ${b.situational.map((s) => `<div>${itemIcon(s.item, 'sm')}<span><b>${esc(S.items[s.item]?.name)}</b> <span class="muted">— ${esc(s.when)}</span></span></div>`).join('')}
      </div></div>` : ''}
    </article>`;
}

function diffBar(n, kind) {
  return `<span class="diff ${kind}" title="Dificuldade ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

const ADV = (v, opp) => (!v ? '—' : v === 'EVEN' ? 'Equilibrada' : v === 'Akali' ? 'Akali' : esc(opp));
const STYLE = { aggressive: 'Agressivo', even: 'Equilibrado', passive: 'Defensivo', defensive: 'Defensivo' };

function guidePanel(opponents) {
  if (!S.guideOpp) return '';
  const r = useRemote(`guide:${S.lane}:${S.guideOpp}`, `/api/opgg/matchup?lane=${S.lane}&opponent=${encodeURIComponent(S.guideOpp)}`);
  const st = remoteState(r, `o guia contra ${S.guideOpp}`);
  if (st) return st;
  const g = r.data;
  const c = Object.values(S.champsById).find((x) => x.name === S.guideOpp || x.name === g.opponent) || champInfo(S.guideOpp);
  const vs = opponents.find((o) => String(o.championId) === String(c.key));
  const curated = [...S.data.matchups[S.lane].counters, ...S.data.matchups[S.lane].favorable].find((m) => m.champ === c.id);
  return `
    <article class="panel build guide">
      <div class="build-head">
        <div style="display:flex;gap:14px;align-items:center">
          <img class="icon lg" src="${img.champ('Akali')}" alt="Akali"><b style="font:700 20px var(--font-head)">VS</b>${champIcon(c.key || c.id, 'lg')}
          <div><h3>Akali vs ${esc(c.name)}</h3>
          <div class="muted">${vs ? `<b class="${wrCls(vs.winRate)}">${pctR(vs.winRate)} de vitórias</b> em ${fmt(vs.games)} partidas` : 'Sem dados suficientes de winrate'}</div></div>
        </div>
        <button class="btn small" data-action="guide-close">Fechar ✕</button>
      </div>
      <div class="grid g3">
        ${tile('Vantagem na lane', ADV(g.laneAdvantage, c.name))}
        ${tile('Vantagem em solo kill', ADV(g.soloKillAdvantage, c.name))}
        ${tile('Estilo recomendado', STYLE[g.playStyle] || esc(g.playStyle || '—'))}
      </div>
      ${g.tip ? `<div><div class="block-label">Dica do OP.GG</div><p style="margin:0">${esc(g.tip)}</p></div>` : ''}
      ${curated ? `<div><div class="block-label">Dica extra</div><p style="margin:0">${esc(curated.tip)}</p></div>` : ''}
      ${g.runes ? `<div><div class="block-label">Runas contra ${esc(c.name)}</div>${runesBlock(g.runes)}${statLine(g.runes)}</div>` : ''}
      <div class="item-row">
        ${g.spells ? `<div><div class="block-label">Feitiços</div><div class="icons">${g.spells.ids.map(summIcon).join('')}</div>${statLine(g.spells)}</div>` : ''}
        ${g.starter ? `<div><div class="block-label">Inicial</div><div class="icons">${g.starter.ids.map((id) => itemIcon(id)).join('')}</div></div>` : ''}
        ${g.core ? `<div><div class="block-label">Core contra ${esc(c.name)}</div><div class="icons">${itemSeq(g.core.ids)}</div>${statLine(g.core)}</div>` : ''}
      </div>
    </article>`;
}

function opponentRow(o, kind) {
  const c = champInfo(String(o.championId));
  return `<div class="mu clickable" data-action="guide" data-champ="${esc(c.name)}">
    ${champIcon(String(o.championId), 'lg')}
    <div style="flex:1"><div class="name">${esc(c.name)}</div>
    <div class="bar" style="margin-top:6px"><span style="width:${(o.winRate * 100).toFixed(1)}%;${kind === 'hard' ? 'background:var(--loss)' : 'background:var(--win)'}"></span></div>
    <p>Akali vence <b class="${wrCls(o.winRate)}">${pctR(o.winRate)}</b> · ${fmt(o.games)} partidas</p></div>
    <span class="muted" style="align-self:center">guia ›</span></div>`;
}

function viewMatchups() {
  const r = useRemote(`mu:${S.lane}`, `/api/opgg/matchup?lane=${S.lane}`);
  const opponents = r.status === 'ok' ? r.data.opponents : [];
  const minGames = 100;
  const solid = opponents.filter((o) => o.games >= minGames);
  const hard = [...solid].sort((a, b) => a.winRate - b.winRate).slice(0, 8);
  const easy = [...solid].sort((a, b) => b.winRate - a.winRate).slice(0, 8);
  const mu = S.data.matchups[S.lane];
  const tipRow = (m, kind) => {
    const c = champInfo(m.champ);
    return `<div class="mu clickable" data-action="guide" data-champ="${esc(c.name)}">${champIcon(m.champ, 'lg')}<div style="flex:1"><div class="name">${esc(c.name)} ${diffBar(m.difficulty, kind)}</div><p>${esc(m.tip)}</p></div></div>`;
  };

  let personal = '';
  if (S.player) {
    const ms = (S.player.matches || []).filter((m) => m.lane === S.lane && m.opponent);
    const opp = groupBy(ms, (m) => String(m.opponent.championId));
    if (S.player.source === 'lcu') {
      personal = `<div class="empty">O histórico do cliente do LoL não informa quem era seu oponente de rota. Com uma API key válida da Riot no .env, seus matchups reais aparecem aqui.</div>`;
    } else if (!opp.length) {
      personal = `<div class="empty">Sem partidas de Akali ${LANES[S.lane].toLowerCase()} no histórico recente.</div>`;
    } else {
      personal = `<div class="panel"><table>
        <thead><tr><th>Oponente</th><th>Partidas</th><th>Seu winrate</th><th></th><th>Seu KDA</th></tr></thead>
        <tbody>${opp.map((o) => `<tr>
          <td><div class="who">${champIcon(o.key, 'sm')} ${esc(champInfo(o.key).name)}</div></td>
          <td>${o.n}</td>
          <td class="${o.wr >= 50 ? 'win' : 'loss'}">${pct(o.wr)}</td>
          <td style="width:30%"><div class="bar"><span style="width:${o.wr}%"></span></div></td>
          <td>${fmt(o.kda, 2)} <span class="muted">(${fmt(o.k, 1)}/${fmt(o.d, 1)}/${fmt(o.a, 1)})</span></td>
        </tr>`).join('')}</tbody></table></div>`;
    }
  }

  const all = [...opponents].sort((a, b) => champInfo(String(a.championId)).name.localeCompare(champInfo(String(b.championId)).name));
  return `
    <h1 class="page-title">Matchups</h1>
    <p class="page-sub">Winrate real da Akali contra cada campeão (OP.GG). Clique em um campeão para ver o guia do confronto: dica, quem tem vantagem e a build recomendada contra ele.</p>
    ${laneTabs()}
    <div class="calc-row" style="margin-bottom:18px">
      <span class="muted">Guia contra:</span>
      <select class="input" data-action="guide-select" style="width:auto">
        <option value="">Escolha um campeão…</option>
        ${all.map((o) => { const c = champInfo(String(o.championId)); return `<option value="${esc(c.name)}" ${S.guideOpp === c.name ? 'selected' : ''}>${esc(c.name)} (${pctR(o.winRate)})</option>`; }).join('')}
      </select>
    </div>
    ${guidePanel(opponents)}
    ${remoteState(r, 'os matchups') || `
    <div class="grid g2" style="margin-top:16px">
      <div class="panel"><h2 style="font-size:22px">Counters da Akali ${opggChip()}</h2><p class="muted" style="margin:2px 0 6px;font-size:12px">Menor winrate da Akali (mín. ${minGames} partidas)</p>${hard.map((o) => opponentRow(o, 'hard')).join('')}</div>
      <div class="panel"><h2 style="font-size:22px">Akali countera ${opggChip()}</h2><p class="muted" style="margin:2px 0 6px;font-size:12px">Maior winrate da Akali (mín. ${minGames} partidas)</p>${easy.map((o) => opponentRow(o, 'easy')).join('')}</div>
    </div>`}
    <div class="section-title">Dicas rápidas <small>como jogar as lanes mais comuns</small></div>
    <div class="grid g2">
      <div class="panel"><h2 style="font-size:20px">Lanes difíceis</h2>${mu.counters.map((m) => tipRow(m, 'hard')).join('')}</div>
      <div class="panel"><h2 style="font-size:20px">Lanes favoráveis</h2>${mu.favorable.map((m) => tipRow(m, 'easy')).join('')}</div>
    </div>
    ${S.player ? `<div class="section-title">Seus matchups reais <small>${LANES[S.lane]} · partidas recentes</small></div>${personal}` : ''}`;
}

function queueSelect() {
  const opts = [['all', 'Todas as filas'], ['ranked', 'Ranqueadas'], ['420', 'Solo/Duo'], ['440', 'Flex'], ['400', 'Normal'], ['490', 'Partida Rápida']];
  return `<select class="input" data-action="queue">${opts.map(([v, l]) => `<option value="${v}" ${S.queue === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

function viewStats() {
  const p = S.player;
  if (!p) return `<h1 class="page-title">Minhas estatísticas</h1><p class="page-sub">Seu desempenho jogando de Akali.</p>${needPlayer()}`;
  const ms = filteredMatches();
  const a = agg(ms);
  const prof = useRemote(`prof:${p.gameName}#${p.tagLine}`, `/api/opgg/profile?name=${encodeURIComponent(p.gameName)}&tag=${encodeURIComponent(p.tagLine)}&platform=${p.platform || 'br1'}`);
  const og = prof.status === 'ok' ? prof.data : null;
  let ranks = (p.league || []).filter((l) => l.queueType.startsWith('RANKED_')).map((l) => ({
    queue: l.queueType === 'RANKED_SOLO_5x5' ? 'Solo/Duo' : 'Flex', tier: l.tier, division: l.rank, lp: l.leaguePoints, wins: l.wins, losses: l.losses,
  }));
  if (!ranks.length && og) ranks = og.league.map((l) => ({ ...l, division: ROMAN[l.division] || l.division }));
  const lanes = groupBy(ms, (m) => m.lane);

  return `
    <h1 class="page-title">Minhas estatísticas</h1>
    <p class="page-sub">Partidas de Akali entre as últimas ${p.scanned ?? ms.length} que você jogou.</p>
    <div class="panel" style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center">
      <div class="profile">
        <div class="pic"><img src="${img.profile(p.profileIconId)}" alt=""><span>${p.summonerLevel ?? ''}</span></div>
        <div><h2 style="font-size:28px">${esc(p.gameName)}<span class="muted">#${esc(p.tagLine)}</span></h2>
        <div class="muted">${(p.platform || '').toUpperCase()} · ${p.source === 'lcu' ? 'dados do cliente do LoL' : 'dados da Riot API'}</div></div>
      </div>
      <div class="ranks">${ranks.length ? ranks.map((r) => `
        <div class="rank"><img src="${img.emblem(r.tier)}" alt="${r.tier}">
        <div><div class="muted" style="font-size:12px">${r.queue}${r.hotStreak ? ' · 🔥 em sequência' : ''}</div>
        <b style="font:700 18px var(--font-head)">${TIER_PT[r.tier] || r.tier} ${r.division ?? ''}</b> · ${r.lp} PDL
        <div class="muted" style="font-size:12px">${r.wins}V ${r.losses}D · ${pct((r.wins / Math.max(1, r.wins + r.losses)) * 100)}</div></div></div>`).join('')
        : `<span class="muted">${prof.status === 'loading' ? 'Buscando elo no OP.GG…' : 'Sem ranqueadas nesta temporada'}</span>`}</div>
    </div>
    ${og ? opggSeason(og) : ''}

    <div class="section-title">Resumo de Akali ${queueSelect()}</div>
    ${!ms.length ? `<div class="empty">Nenhuma partida de Akali encontrada${S.queue !== 'all' ? ' nessa fila' : ''}. Jogue algumas e volte aqui!</div>` : `
    <div class="grid g6">
      ${tile('Partidas', a.n, `${a.w}V ${a.l}D`)}
      ${tile('Winrate', pct(a.wr), '', a.wr >= 50 ? 'win' : 'loss')}
      ${tile('KDA', fmt(a.kda, 2), `${fmt(a.k, 1)} / ${fmt(a.d, 1)} / ${fmt(a.a, 1)}`)}
      ${tile('CS/min', fmt(a.cs, 1))}
      ${tile('Dano/min', fmt(a.dmg))}
      ${tile('Part. em abates', a.kp == null ? '—' : pct(a.kp), a.pentas ? `${a.pentas} pentakill${a.pentas > 1 ? 's' : ''}!` : '')}
    </div>

    <div class="section-title">Últimos resultados <small>mais recente à esquerda</small></div>
    <div class="panel"><div class="streak">${ms.slice(0, 30).map((m) => `<i class="${m.win ? 'w' : 'l'}" data-tip="text:${m.win ? 'Vitória' : 'Derrota'} · ${m.kills}/${m.deaths}/${m.assists}"></i>`).join('')}</div></div>

    <div class="section-title">Por rota</div>
    <div class="panel"><table>
      <thead><tr><th>Rota</th><th>Partidas</th><th>Winrate</th><th>KDA</th><th>CS/min</th><th>Dano/min</th></tr></thead>
      <tbody>${lanes.map((l) => `<tr>
        <td><div class="who">${laneIcon(l.key)} ${LANES[l.key] || l.key}</div></td><td>${l.n}</td>
        <td class="${l.wr >= 50 ? 'win' : 'loss'}">${pct(l.wr)}</td><td>${fmt(l.kda, 2)}</td><td>${fmt(l.cs, 1)}</td><td>${fmt(l.dmg)}</td></tr>`).join('')}
      </tbody></table></div>

    <div class="section-title">Histórico de partidas</div>
    <div>${ms.slice(0, 25).map(matchRow).join('')}</div>`}`;
}

function opggSeason(og) {
  const a = og.akali;
  const min = a ? a.seconds / 60 : 0;
  return `
    <div class="section-title">Temporada ranqueada ${opggChip()} <a class="btn small" href="${esc(og.url)}" target="_blank" rel="noopener" style="margin-left:auto">Abrir perfil no OP.GG ↗</a></div>
    ${a ? `<div class="grid g6">
      ${tile('Akali na temporada', a.games, `${a.wins}V ${a.games - a.wins}D`)}
      ${tile('Winrate', pctR(a.wins / a.games), '', wrCls(a.wins / a.games))}
      ${tile('KDA', fmt((a.kills + a.assists) / Math.max(1, a.deaths), 2), `${fmt(a.kills / a.games, 1)} / ${fmt(a.deaths / a.games, 1)} / ${fmt(a.assists / a.games, 1)}`)}
      ${tile('CS/min', fmt(a.cs / Math.max(1, min), 1))}
      ${tile('Dano/min', fmt(a.damage / Math.max(1, min)))}
      ${tile('Pentakills', a.pentas || 0)}
    </div>` : '<div class="empty">Nenhuma ranqueada de Akali nesta temporada segundo o OP.GG.</div>'}
    ${og.champions.length ? `<div class="panel" style="margin-top:16px"><div class="block-label">Seus campeões mais jogados em ranqueada</div><table><tbody>
      ${og.champions.slice(0, 6).map((c) => `<tr>
        <td><div class="who">${champIcon(String(c.championId), 'sm')} ${esc(champInfo(String(c.championId)).name)} ${c.championId === 84 ? '<span class="chip pink">♥</span>' : ''}</div></td>
        <td>${c.games} jogos</td><td class="${wrCls(c.wins / c.games)}">${pctR(c.wins / c.games)}</td>
        <td>${fmt((c.kills + c.assists) / Math.max(1, c.deaths), 2)} KDA</td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
}

function matchRow(m) {
  const min = Math.floor(m.duration / 60), sec = String(m.duration % 60).padStart(2, '0');
  return `
    <div class="match ${m.win ? 'w' : 'l'}">
      <div class="side"></div>
      <div style="display:flex;gap:4px;align-items:center">
        <img class="icon lg" src="${img.champ('Akali')}" alt="Akali">
        <div style="display:grid;gap:3px">${runeIcon(m.keystone, 'shard')}${runeIcon(m.secondaryStyle, 'shard')}</div>
      </div>
      <div>
        <div class="kda">${m.kills} / <span class="loss">${m.deaths}</span> / ${m.assists} <span class="muted" style="font-size:13px">${fmt((m.kills + m.assists) / Math.max(1, m.deaths), 2)} KDA</span></div>
        <div class="meta"><b class="${m.win ? 'win' : 'loss'}">${m.win ? 'Vitória' : 'Derrota'}</b> · ${QUEUES[m.queue] || `Fila ${m.queue}`} · ${LANES[m.lane] || ''} · ${min}:${sec} · ${timeAgo(m.date)}</div>
        <div class="meta">${m.cs} CS (${m.csMin}/min) · ${fmt(m.damage)} dano${m.kp != null ? ` · ${m.kp}% KP` : ''}</div>
      </div>
      <div class="icons">${m.items.map((id, i) => itemIcon(id, i === 6 ? 'sm round' : 'sm')).join('')}</div>
      <div class="vs">${m.opponent ? `vs ${champIcon(String(m.opponent.championId), 'sm')}` : ''}</div>
    </div>`;
}

// ---- maestria ----
function realPointsPerGame(history = [], matches = []) {
  let pts = 0, games = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i];
    if (b.points <= a.points) continue;
    const n = matches.filter((m) => { const end = m.date + m.duration * 1000; return end > a.t && end <= b.t; }).length;
    if (n > 0) { pts += b.points - a.points; games += n; }
  }
  return games ? { ppg: pts / games, games } : null;
}
function gamesPerDay(matches) {
  const since = Date.now() - 14 * 86400000;
  const recent = matches.filter((m) => m.date >= since);
  if (!recent.length) return 0;
  const days = Math.max(1, (Date.now() - Math.min(...recent.map((m) => m.date))) / 86400000);
  return recent.length / Math.min(14, days);
}
const GRADE_TXT = (g) => `nota <b>${esc(g)}</b> ou melhor`;

function viewMastery() {
  const p = S.player;
  if (!p) return `<h1 class="page-title">Maestria</h1><p class="page-sub">Quanto falta para o próximo nível de maestria de Akali.</p>${needPlayer()}`;
  const m = p.mastery;
  if (!m) return `<h1 class="page-title">Maestria</h1><div class="empty">Você ainda não tem pontos de maestria com a Akali. Bora jogar a primeira!</div>`;

  const since = m.championPointsSinceLastLevel || 0;
  const until = Math.max(0, m.championPointsUntilNextLevel || 0);
  const prog = since + until > 0 ? (since / (since + until)) * 100 : 100;
  const marksNeed = m.markRequiredForNextLevel || 0;
  const marksHave = m.tokensEarned || 0;
  const marksMissing = Math.max(0, marksNeed - marksHave);

  const real = realPointsPerGame(p.masteryHistory, p.matches);
  const override = store.get('ppg', null);
  const ppg = override || (real ? Math.round(real.ppg) : DEFAULT_PPG);
  const ppgSource = override ? 'valor definido por você' : real ? `média real de ${real.games} partida(s) acompanhadas` : 'estimativa padrão — fica precisa conforme você joga com o app aberto';
  const gamesNeeded = until > 0 ? Math.ceil(until / ppg) : 0;
  const pace = gamesPerDay(p.matches || []);
  const days = pace > 0 ? Math.ceil(gamesNeeded / pace) : null;

  const ms = m.nextSeasonMilestone;
  const req = ms?.requireGradeCounts ? Object.entries(ms.requireGradeCounts) : [];

  const top = (p.topMastery || []).slice(0, 5);
  const sim = [5, 10, 20, 50].map((g) => ({ g, pts: g * ppg }));

  return `
    <h1 class="page-title">Maestria</h1>
    <p class="page-sub">Sua progressão de maestria com a Akali e a previsão de partidas para o próximo nível.</p>
    <div class="panel mastery-hero">
      <div class="crest" style="--p:${prog.toFixed(1)};--img:url('${img.tile(S.bg)}')"><b>${m.championLevel}<small>NÍVEL</small></b></div>
      <div>
        <div class="muted" style="font:700 13px var(--font-head);letter-spacing:2px">PONTOS TOTAIS</div>
        <div class="big-number">${fmt(m.championPoints)}</div>
        <div class="progress"><span style="width:${prog}%"></span></div>
        <div class="muted">${fmt(since)} / ${fmt(since + until)} neste nível · faltam <b style="color:var(--text)">${fmt(until)}</b> pontos</div>
        ${marksNeed ? `<div style="margin-top:12px;display:flex;gap:10px;align-items:center"><span class="muted">Marcas de maestria:</span>
          <div class="marks">${Array.from({ length: marksNeed }, (_, i) => `<i class="${i < marksHave ? 'on' : ''}"></i>`).join('')}</div>
          <span class="muted">${Math.min(marksHave, marksNeed)}/${marksNeed}${marksMissing ? '' : ' ✔ completas'}</span></div>` : ''}
      </div>
    </div>

    <div class="section-title">Previsão para o nível ${m.championLevel + 1}</div>
    <div class="grid g3">
      <div class="panel tile"><div class="label">Partidas necessárias</div>
        <div class="value" style="font-size:44px">${until > 0 ? `~${gamesNeeded}` : '0'}</div>
        <div class="hint">${until > 0 ? `com ~${fmt(ppg)} pts por partida` : 'pontos completos!'}${marksMissing ? ` + ${marksMissing} marca(s)` : ''}</div></div>
      <div class="panel tile"><div class="label">No seu ritmo</div>
        <div class="value" style="font-size:44px">${until <= 0 ? '—' : days != null ? `${days} dia${days > 1 ? 's' : ''}` : '—'}</div>
        <div class="hint">${pace > 0 ? `${fmt(pace, 1)} partidas de Akali/dia (últimos 14 dias)` : 'sem partidas recentes para medir o ritmo'}</div></div>
      <div class="panel tile"><div class="label">Pontos por partida</div>
        <div class="calc-row" style="margin-top:6px"><input class="input" type="number" min="50" max="3000" step="10" value="${ppg}" data-action="ppg">
        ${override ? '<button class="btn small" data-action="ppg-reset">Usar automático</button>' : ''}</div>
        <div class="hint" style="margin-top:6px">${ppgSource}</div></div>
    </div>

    ${req.length || marksMissing ? `
    <div class="section-title">Requisitos de marcas</div>
    <div class="panel">
      ${marksMissing ? `<p style="margin-top:0">Além dos pontos, você precisa de <b>${marksMissing} marca(s)</b> para subir. Marcas são ganhas completando marcos da temporada:</p>` : '<p style="margin-top:0">Próximo marco da temporada:</p>'}
      ${req.length ? `<ul>${req.map(([g, n]) => `<li>Tirar ${GRADE_TXT(g)} em <b>${n}</b> partida${n > 1 ? 's' : ''}</li>`).join('')}</ul>` : ''}
      ${ms?.rewardMarks ? `<div class="muted">Recompensa: ${ms.rewardMarks} marca(s)${ms.bonus ? ' + bônus' : ''}.</div>` : ''}
      <div class="muted" style="font-size:12px;margin-top:8px">Dica: a nota depende de KDA, farm, dano e visão em relação aos outros jogadores da mesma rota.</div>
    </div>` : ''}

    <div class="section-title">Simulador <small>pontos estimados ao jogar mais partidas</small></div>
    <div class="panel"><table><thead><tr><th>Partidas</th><th>Pontos estimados</th><th>Total</th><th>Chega ao próximo nível?</th></tr></thead>
      <tbody>${sim.map((s) => `<tr><td>+${s.g}</td><td>+${fmt(s.pts)}</td><td>${fmt(m.championPoints + s.pts)}</td>
      <td>${s.pts >= until ? `<span class="win">Sim ✔</span>${marksMissing ? ' <span class="muted">(se tiver as marcas)</span>' : ''}` : `<span class="muted">faltariam ${fmt(until - s.pts)}</span>`}</td></tr>`).join('')}</tbody></table></div>

    ${top.length ? `<div class="section-title">Suas maiores maestrias</div>
    <div class="panel"><table><tbody>${top.map((t, i) => `<tr>
      <td style="width:30px" class="muted">#${i + 1}</td>
      <td><div class="who">${champIcon(String(t.championId), 'sm')} ${esc(champInfo(String(t.championId)).name)} ${t.championId === 84 ? '<span class="chip pink">♥</span>' : ''}</div></td>
      <td>Nível ${t.championLevel}</td><td>${fmt(t.championPoints)} pts</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function viewSkins() {
  const skins = baseSkins();
  const maxNum = Math.max(...skins.map((s) => s.num));
  return `
    <h1 class="page-title">Skins</h1>
    <p class="page-sub">${skins.length} skins da Akali. Clique em uma para usar a splash art como fundo do app.</p>
    <div class="skins">
      ${skins.map((s) => `
        <div class="skin ${s.num === S.bg ? 'current' : ''}" data-action="skin" data-num="${s.num}">
          <img src="${img.loading(s.num)}" alt="${esc(skinName(s.num))}" loading="lazy">
          ${s.num === NEW_KDA_SKIN ? '<span class="chip pink badge">NOVA K/DA</span>' : s.num >= maxNum - 1 ? '<span class="chip gold badge">NOVA</span>' : /K\/DA/.test(s.name) ? '<span class="chip pink badge">K/DA</span>' : ''}
          <div class="cap">${esc(skinName(s.num))}</div>
        </div>`).join('')}
    </div>`;
}

// ---------------- roteamento ----------------
// ---- configurações ----
const KEY_REASON = {
  missing: 'Nenhuma chave configurada.',
  expired: 'A chave expirou ou é inválida (a chave de desenvolvimento dura 24h).',
  network: 'Não foi possível falar com a Riot agora (sem internet?).',
};
function viewConfig() {
  const st = S.settings;
  if (!st) {
    getJSON('/api/settings').then((d) => { S.settings = d; render(); }).catch((e) => { S.settings = { valid: false, reason: 'network', error: e.message }; render(); });
    S.settings = { loading: true };
  }
  const cur = S.settings;
  const status = cur.loading
    ? '<div class="key-status"><span class="dot"></span> Verificando chave…</div>'
    : cur.valid
      ? `<div class="key-status ok"><span class="dot"></span> Chave válida (${esc(cur.keyPreview)})</div>`
      : `<div class="key-status bad"><span class="dot"></span> ${esc(KEY_REASON[cur.reason] || 'Chave com problema.')}${cur.keyPreview ? ` <span class="muted">(${esc(cur.keyPreview)})</span>` : ''}</div>`;
  return `
    <h1 class="page-title">Configurações</h1>
    <p class="page-sub">A chave da Riot libera seu elo pela API oficial, o oponente de rota de cada partida e funciona com o cliente do LoL fechado. Sem ela, o app usa o cliente do LoL e o OP.GG.</p>
    <div class="grid g2">
      <div class="panel build">
        <h3>Chave da Riot API</h3>
        ${status}
        <form class="connect" data-form="key" style="margin-top:0">
          <input class="input" name="key" placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="flex:1;min-width:260px" autocomplete="off" spellcheck="false">
          <button class="btn primary" ${S.savingKey ? 'disabled' : ''}>${S.savingKey ? 'Testando…' : 'Salvar chave'}</button>
        </form>
        ${S.keyMsg ? `<div class="${S.keyMsg.ok ? 'chip' : 'error'}" style="${S.keyMsg.ok ? 'padding:8px 12px' : ''}">${esc(S.keyMsg.text)}</div>` : ''}
      </div>
      <div class="panel build">
        <h3>Como gerar a chave</h3>
        <ol class="steps">
          <li>Abra o <a href="https://developer.riotgames.com/" target="_blank" rel="noopener"><b>Riot Developer Portal ↗</b></a> (já logado na sua conta).</li>
          <li>Marque <b>“Não sou um robô”</b> e clique em <b>REGENERATE API KEY</b>.</li>
          <li>Clique em <b>Copy</b> ao lado da chave.</li>
          <li>Cole aqui ao lado e clique em <b>Salvar chave</b>.</li>
        </ol>
        <p class="muted" style="margin:0;font-size:12px">A chave de desenvolvimento expira a cada 24h — quando expirar, repita estes passos.</p>
      </div>
    </div>
    ${liveSection()}`;
}

function liveSection() {
  if (!S.remote) {
    S.remote = { loading: true };
    getJSON('/api/remote').then((d) => { S.remote = d; render(); }).catch((e) => { S.remote = { error: e.message }; render(); });
  }
  if (!S.liveSettings) {
    S.liveSettings = {};
    getJSON('/api/live/settings').then((d) => { S.liveSettings = d; render(); }).catch(() => {});
  }
  const r = S.remote;
  const ls = S.liveSettings;
  const hidden = (u) => esc(u.replace(/t=.*/, 't=••••••'));
  return `
    <div class="section-title">Cliente do LoL &amp; celular</div>
    <div class="grid g2">
      <div class="panel build">
        <h3>Automações</h3>
        <label class="switch-row"><input type="checkbox" data-action="live-opt" data-opt="autoAccept" ${ls.autoAccept ? 'checked' : ''}> Aceitar partidas automaticamente</label>
        <label class="switch-row"><input type="checkbox" data-action="live-opt" data-opt="autoRunes" ${ls.autoRunes ? 'checked' : ''}> Importar runas do OP.GG ao confirmar o campeão</label>
        <p class="muted" style="font-size:12px;margin:0">Funcionam enquanto o Akali Companion estiver aberto (pode ficar minimizado). Se suas páginas de runas estiverem cheias, a página atual é substituída.</p>
        <div><a class="btn" href="#/live">Abrir controle ao vivo</a></div>
      </div>
      <div class="panel build">
        <h3>Controlar pelo celular</h3>
        <label class="switch-row"><input type="checkbox" data-action="remote-toggle" ${r.enabled ? 'checked' : ''}> Permitir acesso pelo celular (mesma rede Wi-Fi)</label>
        ${r.loading ? '<p class="muted">Carregando…</p>' : r.error ? `<div class="error">${esc(r.error)}</div>` : !r.enabled
          ? '<p class="muted" style="margin:0">Desativado: nenhum outro aparelho consegue acessar o app.</p>'
          : r.urls?.length ? `
            <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
              <div class="qr">${r.qr || ''}</div>
              <ol class="steps" style="flex:1;min-width:200px">
                <li>Conecte o celular no <b>mesmo Wi-Fi</b> do PC.</li>
                <li>Aponte a <b>câmera do celular</b> para o QR code.</li>
                <li>No navegador do celular: <b>Adicionar à tela inicial</b> para virar um app.</li>
              </ol>
            </div>
            <div class="muted" style="font-size:12px">Endereço: <code>${hidden(r.urls[0].url)}</code>${r.urls.length > 1 ? ` · outras redes: ${r.urls.slice(1).map((u) => `<code>${hidden(u.url)}</code>`).join(', ')}` : ''}</div>
            <div><button class="btn small" data-action="remote-regen">Gerar novo código (desconecta os celulares)</button></div>`
          : '<div class="error">Nenhuma rede local encontrada. Conecte o PC ao Wi-Fi/cabo.</div>'}
      </div>
    </div>`;
}

function viewLive() {
  return `
    <h1 class="page-title">Ao vivo</h1>
    <p class="page-sub">Fila, aceitar partida e seleção de campeões, ligados ao cliente do LoL. É a mesma tela que aparece no celular.</p>
    <div class="phone"><iframe src="/m" title="Controle ao vivo"></iframe></div>`;
}
async function saveKeyForm(form) {
  const key = new FormData(form).get('key');
  S.savingKey = true; S.keyMsg = null; render();
  try {
    const r = await fetch('/api/settings/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro ao salvar');
    S.settings = d;
    S.config.hasKey = true;
    S.keyMsg = { ok: true, text: '✔ Chave salva! Recarregando seus dados pela Riot API…' };
    const saved = store.get('riotId', null) || (S.player && { name: S.player.gameName, tag: S.player.tagLine, platform: S.player.platform || 'br1' });
    if (saved) loadPlayer(saved.name, saved.tag, saved.platform);
  } catch (e) {
    S.keyMsg = { ok: false, text: e.message };
  } finally {
    S.savingKey = false; render();
  }
}

const VIEWS = { '': viewHome, builds: viewBuilds, matchups: viewMatchups, stats: viewStats, mastery: viewMastery, skins: viewSkins, config: viewConfig, live: viewLive };
const currentRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0];
function render() {
  if (!S.akali) return;
  const r = VIEWS[currentRoute()] ? currentRoute() : '';
  document.body.dataset.page = r || 'home';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  const html = VIEWS[r]();
  const view = $('#view');
  if (view._h !== html) { view._h = html; view.innerHTML = html; }
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'lane') { S.lane = el.dataset.lane; S.guideOpp = null; store.set('lane', S.lane); render(); }
    if (act === 'skin') { const n = Number(el.dataset.num); setBg(n); store.set('bgSkin', n); setTimeout(render, 50); }
    if (act === 'detect') detectClient();
    if (act === 'logout') { S.player = null; store.del('riotId'); render(); renderAccount(); }
    if (act === 'ppg-reset') { store.del('ppg'); render(); }
    if (act === 'guide') { S.guideOpp = el.dataset.champ; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
    if (act === 'guide-close') { S.guideOpp = null; render(); }
    if (act === 'remote-regen') {
      fetch('/api/remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerate: true }) })
        .then((r) => r.json()).then((d) => { S.remote = d; render(); });
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'queue') { S.queue = el.value; render(); }
    if (el.dataset.action === 'guide-select') { S.guideOpp = el.value || null; render(); }
    if (el.dataset.action === 'live-opt') {
      fetch('/api/live/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [el.dataset.opt]: el.checked }) })
        .then((r) => r.json()).then((d) => { S.liveSettings = d; render(); });
    }
    if (el.dataset.action === 'remote-toggle') {
      fetch('/api/remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: el.checked }) })
        .then((r) => r.json()).then((d) => { S.remote = d; render(); });
    }
    if (el.dataset.action === 'rotate') setRotation(el.checked);
    if (el.dataset.action === 'ppg') { const v = Number(el.value); if (v >= 50) { store.set('ppg', v); render(); } }
  });
  document.addEventListener('submit', (e) => {
    const keyForm = e.target.closest('[data-form="key"]');
    if (keyForm) { e.preventDefault(); saveKeyForm(keyForm); return; }
    const form = e.target.closest('[data-form="connect"]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const [name, tag] = String(fd.get('riotId')).split('#').map((s) => s.trim());
    if (!name || !tag) { S.error = 'Use o formato Nome#TAG (ex: Faker#KR1)'; render(); return; }
    loadPlayer(name, tag, fd.get('platform'));
  });
  window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
}

// ---------------- inicialização ----------------
async function init() {
  initTooltip();
  bindEvents();
  try {
    const versions = await getJSON(`${DD}/api/versions.json`);
    S.v = versions[0];
    const base = `${DD}/cdn/${S.v}/data/${LANG}`;
    const [akali, items, runes, summs, champs, data, config] = await Promise.all([
      getJSON(`${base}/champion/Akali.json`),
      getJSON(`${base}/item.json`),
      getJSON(`${base}/runesReforged.json`),
      getJSON(`${base}/summoner.json`),
      getJSON(`${base}/champion.json`),
      getJSON('data/akali.json'),
      getJSON('/api/config').catch(() => S.config),
    ]);
    S.akali = akali.data.Akali;
    S.items = Object.fromEntries(Object.entries(items.data).map(([k, v]) => [Number(k), v]));
    for (const style of runes) {
      S.runes[style.id] = style;
      for (const slot of style.slots) for (const r of slot.runes) S.runes[r.id] = r;
    }
    for (const s of Object.values(summs.data)) S.summs[s.key] = s;
    for (const c of Object.values(champs.data)) { S.champsById[c.id] = c; S.champsByKey[c.key] = c; }
    S.data = data;
    S.config = config;
    if (config.desktop) document.body.classList.add('desktop');
    S.lane = store.get('lane', 'MIDDLE');
    $('#brandIcon').src = img.champ('Akali');
  } catch (e) {
    $('#view').innerHTML = `<div class="error">Não foi possível carregar os dados do jogo (Data Dragon). Verifique sua internet.<br>${esc(e.message)}</div>`;
    return;
  }
  S.bg = store.get('bgSkin', NEW_KDA_SKIN);
  setBg(S.bg);
  if (store.get('rotate', false)) setRotation(true);
  render();
  autoConnect();
}

init();

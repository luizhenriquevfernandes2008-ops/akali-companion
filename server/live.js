// Controle ao vivo do cliente do LoL: fila, aceitar partida, seleção de campeões, feitiços, skins e runas.
// Estado é lido por polling da API local (LCU) e enviado aos aparelhos conectados via Server-Sent Events.
import fs from 'node:fs';
import path from 'node:path';
import { lcu } from './lcu.js';
import { gameData } from './ddragon.js';
import { getMeta } from './opgg.js';
import { DATA_DIR } from './riot.js';
import { readGame } from './ingame.js';

// ---------------- configurações persistentes ----------------
const SETTINGS_FILE = path.join(DATA_DIR, 'live-settings.json');
let settings = { autoAccept: false, autoRunes: false }; // tudo desligado até o usuário ativar
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { /* padrão */ }

export const getSettings = () => ({ ...settings });
export function setSettings(patch) {
  for (const k of ['autoAccept', 'autoRunes']) if (typeof patch[k] === 'boolean') settings[k] = patch[k];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
  schedule(0);
  return getSettings();
}

const safe = (p, fallback = null) => lcu('GET', p).catch(() => fallback);
const LANE = { top: 'TOP', jungle: 'JUNGLE', middle: 'MIDDLE', bottom: 'BOTTOM', utility: 'UTILITY' };
const LANE_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };

// ---------------- leitura de estado ----------------
let summonerCache = null;
let pickableCache = { pickable: [], bannable: [] };
let ownedCache = [];
let lastEvent = null;
const event = (type, text) => { lastEvent = { id: Date.now(), type, text }; };

// ---------------- registro de diagnóstico (live-log.txt na pasta de dados) ----------------
const LOG_FILE = path.join(DATA_DIR, 'live-log.txt');
export function log(kind, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try { if (fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`); } catch { /* ainda não existe */ }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${kind} ${JSON.stringify(data)}\n`);
  } catch { /* log nunca derruba o app */ }
}
let lastSnap = '';
function logSnapshot(cs, mine, nPick, nBan) {
  const snap = JSON.stringify({
    timer: cs.timer?.phase, cell: cs.localPlayerCellId,
    mine: mine.map((a) => ({ id: a.id, type: a.type, prog: a.isInProgress, done: a.completed, champ: a.championId })),
    nPick, nBan,
  });
  if (snap !== lastSnap) { lastSnap = snap; log('champselect', JSON.parse(snap)); }
}

async function champSelectState() {
  const cs = await lcu('GET', '/lol-champ-select/v1/session');
  const myCell = cs.localPlayerCellId;
  const actions = (cs.actions || []).flat();
  const mine = actions.filter((a) => a.actorCellId === myCell);
  const current = mine.find((a) => a.isInProgress && !a.completed);
  const pending = mine.find((a) => !a.completed);
  const me = cs.myTeam.find((m) => m.cellId === myCell) || {};
  const allyCells = new Set(cs.myTeam.map((m) => m.cellId));

  // Listas de campeões disponíveis: buscadas a cada atualização (são chamadas locais e baratas).
  // Antes ficavam em cache por fase — se o cliente respondesse vazio no início da fase,
  // a lista de banimento ficava vazia até o fim. Agora, se vier vazia, usamos alternativas.
  let [pickable, bannable] = await Promise.all([
    safe('/lol-champ-select/v1/pickable-champion-ids', []),
    safe('/lol-champ-select/v1/bannable-champion-ids', []),
  ]);
  if (!Array.isArray(pickable)) pickable = [];
  if (!Array.isArray(bannable)) bannable = [];
  const taken = new Set(actions.filter((a) => a.completed && a.championId > 0).map((a) => a.championId));
  if (!pickable.length) {
    if (!ownedCache.length) ownedCache = (await safe('/lol-champions/v1/owned-champions-minimal', [])).filter((c) => c.ownership?.owned || c.freeToPlay).map((c) => c.id);
    pickable = ownedCache.filter((id) => !taken.has(id));
  }
  if (!bannable.length && current?.type === 'ban') {
    const { champions } = await gameData();
    bannable = Object.keys(champions).map(Number).filter((id) => !taken.has(id));
  }
  pickableCache = { pickable, bannable };
  logSnapshot(cs, mine, pickable.length, bannable.length);

  let skins = [];
  if (me.championId) {
    const carousel = await safe('/lol-champ-select/v1/skin-carousel-skins', []);
    skins = carousel.filter((s) => s.unlocked && !s.disabled).map((s) => ({ id: s.id, name: s.name }));
  }

  const banned = actions.filter((a) => a.type === 'ban' && a.completed && a.championId > 0);
  const locked = Boolean(me.championId) && !mine.some((a) => a.type === 'pick' && !a.completed);

  return {
    gameId: cs.gameId,
    timer: {
      phase: cs.timer?.phase, // BAN_PICK | PLANNING | FINALIZATION | GAME_STARTING
      remainingMs: cs.timer?.adjustedTimeLeftInPhase ?? 0,
      totalMs: cs.timer?.totalTimeInPhase ?? 0,
      at: Date.now(),
    },
    aram: Boolean(cs.benchEnabled),
    bench: (cs.benchChampions || []).map((b) => b.championId),
    myTeam: cs.myTeam.map((m) => ({
      cellId: m.cellId, championId: m.championId, intent: m.championPickIntent,
      position: LANE[m.assignedPosition] || null, name: m.gameName || m.summonerName || '',
      spell1Id: m.spell1Id, spell2Id: m.spell2Id, isMe: m.cellId === myCell,
      picking: actions.some((a) => a.actorCellId === m.cellId && a.isInProgress && a.type === 'pick'),
    })),
    theirTeam: cs.theirTeam.map((m) => ({ cellId: m.cellId, championId: m.championId, position: LANE[m.assignedPosition] || null })),
    bans: {
      ally: banned.filter((a) => allyCells.has(a.actorCellId)).map((a) => a.championId),
      enemy: banned.filter((a) => !allyCells.has(a.actorCellId)).map((a) => a.championId),
    },
    action: current ? { id: current.id, type: current.type, championId: current.championId } : null,
    nextAction: !current && pending ? { type: pending.type } : null,
    locked,
    me: {
      championId: me.championId || me.championPickIntent || 0,
      hovering: !me.championId && Boolean(me.championPickIntent),
      position: LANE[me.assignedPosition] || null,
      spell1Id: me.spell1Id, spell2Id: me.spell2Id, skinId: me.selectedSkinId,
    },
    pickable,
    bannable,
    skins,
  };
}

export async function readState() {
  let phase;
  try {
    phase = await lcu('GET', '/lol-gameflow/v1/gameflow-phase');
  } catch (e) {
    summonerCache = null;
    return { connected: false, reason: e.status === 503 ? 'closed' : e.message, settings: getSettings() };
  }
  if (!summonerCache) {
    const s = await safe('/lol-summoner/v1/current-summoner');
    if (s) summonerCache = { gameName: s.gameName, tagLine: s.tagLine, profileIconId: s.profileIconId, puuid: s.puuid };
  }
  const st = { connected: true, phase, summoner: summonerCache, settings: getSettings(), event: lastEvent };

  // grupo (party): existe mesmo fora da sala; só o líder pode escolher a fila
  if (['None', 'Lobby', 'Matchmaking'].includes(phase)) {
    const pp = await safe('/lol-lobby/v1/parties/player');
    const party = pp?.currentParty;
    if (party?.players?.length > 1) {
      const me = party.players.find((p) => p.puuid === pp.puuid);
      st.party = { size: party.players.length, isLeader: me?.role === 'LEADER', queueId: party.gameMode?.queueId || null };
    }
  }

  if (['Lobby', 'Matchmaking', 'ReadyCheck'].includes(phase)) {
    const lobby = await safe('/lol-lobby/v2/lobby');
    if (lobby) {
      st.lobby = {
        queueId: lobby.gameConfig?.queueId,
        positionSelector: Boolean(lobby.gameConfig?.showPositionSelector),
        canStart: Boolean(lobby.canStartActivity),
        isLeader: Boolean(lobby.localMember?.isLeader),
        positions: [lobby.localMember?.firstPositionPreference, lobby.localMember?.secondPositionPreference],
        members: (lobby.members || []).map((m) => ({
          name: m.gameName || m.summonerName, icon: m.summonerIconId, leader: m.isLeader,
          first: m.firstPositionPreference, second: m.secondPositionPreference,
        })),
      };
    }
    const search = await safe('/lol-lobby/v2/lobby/matchmaking/search-state');
    if (search) {
      st.search = {
        state: search.searchState, timeInQueue: search.timeInQueue, estimated: search.estimatedQueueTime,
        errors: (search.errors || []).map((e) => ({ message: e.message, penalty: e.penaltyTimeRemaining })),
        at: Date.now(),
      };
    }
  }
  if (phase === 'ReadyCheck') {
    const rc = await safe('/lol-matchmaking/v1/ready-check');
    if (rc) st.readyCheck = { state: rc.state, response: rc.playerResponse, elapsed: rc.timer, at: Date.now() };
  }
  if (phase === 'ChampSelect') {
    try { st.champSelect = await champSelectState(); } catch { /* sessão ainda carregando */ }
  }
  if (['GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(phase)) {
    const s = await safe('/lol-gameflow/v1/session');
    const puuid = summonerCache?.puuid;
    const players = [...(s?.gameData?.teamOne || []), ...(s?.gameData?.teamTwo || [])];
    st.game = {
      queueId: s?.gameData?.queue?.id,
      queueName: s?.gameData?.queue?.description,
      championId: s?.gameData?.playerChampionSelections?.find((x) => x.puuid === puuid)?.championId
        || players.find((x) => x.puuid === puuid)?.championId || null,
    };
    // monitor da partida (Live Client Data API, só existe com o jogo rodando)
    if (['GameStart', 'InProgress', 'Reconnect'].includes(phase)) {
      st.live = await readGame().catch(() => null);
    }
  }
  return st;
}

// ---------------- ações ----------------
async function myCurrentAction({ allowPendingPick = false } = {}) {
  const cs = await lcu('GET', '/lol-champ-select/v1/session');
  const mine = (cs.actions || []).flat().filter((a) => a.actorCellId === cs.localPlayerCellId && !a.completed);
  const action = mine.find((a) => a.isInProgress) || (allowPendingPick ? mine.find((a) => a.type === 'pick') : null);
  if (!action) throw Object.assign(new Error('Não é a sua vez agora'), { status: 409 });
  return action;
}

export async function importRunes({ championId, position } = {}) {
  const cs = championId ? null : await lcu('GET', '/lol-champ-select/v1/session');
  if (cs) {
    const me = cs.myTeam.find((m) => m.cellId === cs.localPlayerCellId);
    championId = me?.championId || me?.championPickIntent;
    position = position || LANE[me?.assignedPosition];
  }
  if (!championId) throw Object.assign(new Error('Escolha um campeão primeiro'), { status: 400 });
  const { champions } = await gameData();
  const champ = champions[String(championId)];
  const lane = position || 'MIDDLE'; // escolha às cegas não informa rota
  const meta = await getMeta(lane, champ.name);
  const r = meta.runes;
  if (!r) throw Object.assign(new Error(`OP.GG sem runas para ${champ.name}`), { status: 404 });

  const page = {
    name: `AC: ${champ.name} ${LANE_PT[lane] || ''}`.trim(),
    primaryStyleId: r.primary,
    subStyleId: r.secondary,
    selectedPerkIds: [r.keystone, ...r.minor, ...r.secondaryRunes, ...r.shards],
    current: true,
  };
  const pages = await lcu('GET', '/lol-perks/v1/pages');
  const inv = await lcu('GET', '/lol-perks/v1/inventory');
  // reaproveita a página criada pelo app; se não houver espaço, substitui a página atual (editável)
  let target = pages.find((p) => p.isEditable && p.isDeletable && p.name?.startsWith('AC: '));
  if (!target && !inv.canAddCustomPage) {
    target = pages.find((p) => p.current && p.isEditable && p.isDeletable) || pages.find((p) => p.isEditable && p.isDeletable);
  }
  if (target) await lcu('DELETE', `/lol-perks/v1/pages/${target.id}`);
  await lcu('POST', '/lol-perks/v1/pages', page);
  const text = `Runas de ${champ.name} (${LANE_PT[lane] || lane}) importadas do OP.GG${r.winRate ? ` · ${(r.winRate * 100).toFixed(1)}% WR` : ''}`;
  event('runes', text);
  return { ok: true, page: page.name, replaced: target?.name || null, text };
}

export async function opggSpells() {
  const cs = await lcu('GET', '/lol-champ-select/v1/session');
  const me = cs.myTeam.find((m) => m.cellId === cs.localPlayerCellId);
  const championId = me?.championId || me?.championPickIntent;
  if (!championId) throw Object.assign(new Error('Escolha um campeão primeiro'), { status: 400 });
  const { champions } = await gameData();
  const meta = await getMeta(LANE[me.assignedPosition] || 'MIDDLE', champions[String(championId)].name);
  let [a, b] = meta.spells?.ids || [];
  if (!a) throw Object.assign(new Error('OP.GG sem feitiços para esse campeão'), { status: 404 });
  // mantém o Flash na tecla em que você costuma usar
  if (me.spell2Id === 4 && a === 4) [a, b] = [b, a];
  if (me.spell1Id === 4 && b === 4) [a, b] = [b, a];
  await lcu('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: a, spell2Id: b });
  return { ok: true, spell1Id: a, spell2Id: b };
}

// mensagens do cliente traduzidas para algo que dê para entender no celular
const LCU_ERRORS = {
  INVALID_PERMISSIONS: 'O cliente diz que você é membro de um grupo, e só o líder escolhe a fila. Se você não está em grupo, clique em JOGAR no cliente do PC uma vez (ou reinicie o LoL) para limpar o grupo antigo.',
  LOBBY_NOT_FOUND: 'Nenhuma sala aberta no cliente.',
  GATEKEEPER_RESTRICTED: 'A fila está bloqueada no momento (penalidade ou restrição da conta).',
  QUEUE_NOT_ENABLED: 'Essa fila não está disponível agora.',
};

export async function action(type, p = {}) {
  try {
    const r = await runAction(type, p);
    if (!['hover'].includes(type)) log('acao-ok', { type, p });
    return r;
  } catch (e) {
    log('acao-erro', { type, p, status: e.status, erro: e.message });
    const key = Object.keys(LCU_ERRORS).find((k) => String(e.message).includes(k));
    if (key) throw Object.assign(new Error(LCU_ERRORS[key]), { status: e.status || 400 });
    throw e;
  }
}

async function runAction(type, p = {}) {
  let result;
  switch (type) {
    case 'accept': result = await lcu('POST', '/lol-matchmaking/v1/ready-check/accept'); break;
    case 'decline': result = await lcu('POST', '/lol-matchmaking/v1/ready-check/decline'); break;
    case 'createLobby': result = await lcu('POST', '/lol-lobby/v2/lobby', { queueId: Number(p.queueId) }); break;
    case 'positions':
      result = await lcu('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', {
        firstPreference: p.first || 'UNSELECTED', secondPreference: p.second || 'UNSELECTED',
      });
      break;
    case 'search': result = await lcu('POST', '/lol-lobby/v2/lobby/matchmaking/search'); break;
    case 'cancelSearch': result = await lcu('DELETE', '/lol-lobby/v2/lobby/matchmaking/search'); break;
    case 'playAgain': result = await lcu('POST', '/lol-lobby/v2/play-again'); break;
    case 'hover': { // na sua vez marca o campeão; antes dela, vira a pré-seleção (intenção) que o time vê
      const a = await myCurrentAction({ allowPendingPick: true });
      result = await lcu('PATCH', `/lol-champ-select/v1/session/actions/${a.id}`, { championId: Number(p.championId) });
      break;
    }
    case 'lock': {
      const a = await myCurrentAction();
      const championId = Number(p.championId || a.championId);
      if (!championId) throw Object.assign(new Error('Selecione um campeão'), { status: 400 });
      const url = `/lol-champ-select/v1/session/actions/${a.id}`;
      // 1º: marca e confirma de uma vez (forma mais compatível); 2º: marca e chama /complete
      try {
        await lcu('PATCH', url, { championId, completed: true });
      } catch (e1) {
        log('lock-patch-falhou', { id: a.id, type: a.type, championId, erro: e1.message });
        await lcu('PATCH', url, { championId });
        await lcu('POST', `${url}/complete`);
      }
      // confere se o cliente realmente travou
      await new Promise((r) => setTimeout(r, 400));
      const cs = await lcu('GET', '/lol-champ-select/v1/session');
      const after = (cs.actions || []).flat().find((x) => x.id === a.id);
      log('lock-resultado', { id: a.id, type: a.type, championId, completed: after?.completed, champ: after?.championId });
      if (after && !after.completed) {
        throw Object.assign(new Error(`O cliente não aceitou ${a.type === 'ban' ? 'o banimento' : 'a escolha'} (campeão indisponível ou já escolhido/banido). Tente outro.`), { status: 409 });
      }
      result = { ok: true, completed: true };
      break;
    }
    case 'spells':
      result = await lcu('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: Number(p.spell1Id), spell2Id: Number(p.spell2Id) });
      break;
    case 'skin': result = await lcu('PATCH', '/lol-champ-select/v1/session/my-selection', { selectedSkinId: Number(p.skinId) }); break;
    case 'benchSwap': result = await lcu('POST', `/lol-champ-select/v1/session/bench/swap/${Number(p.championId)}`); break;
    case 'reroll': result = await lcu('POST', '/lol-champ-select/v1/session/my-selection/reroll'); break;
    case 'runes': result = await importRunes(p); break;
    case 'opggSpells': result = await opggSpells(); break;
    default: throw Object.assign(new Error(`Ação desconhecida: ${type}`), { status: 400 });
  }
  schedule(150); // atualiza os aparelhos logo após a ação
  return result ?? { ok: true };
}

// ---------------- automações ----------------
let accepted = false;
let runesFor = null;

async function automations(st) {
  if (!st.connected) return;
  if (st.phase !== 'ReadyCheck') accepted = false; // cada novo ready check é aceito uma vez
  else if (settings.autoAccept && !accepted && st.readyCheck?.state === 'InProgress' && st.readyCheck.response === 'None') {
    accepted = true;
    await lcu('POST', '/lol-matchmaking/v1/ready-check/accept').catch(() => { accepted = false; });
    event('accept', 'Partida aceita automaticamente');
  }
  const cs = st.champSelect;
  if (settings.autoRunes && cs?.locked && cs.me.championId) {
    const key = `${cs.gameId}:${cs.me.championId}`;
    if (runesFor !== key) {
      runesFor = key;
      await importRunes({ championId: cs.me.championId, position: cs.me.position }).catch((e) => event('error', `Não consegui importar runas: ${e.message}`));
    }
  }
}

// ---------------- polling + transmissão (SSE) ----------------
const clients = new Set();
let timer = null;
let busy = false;
let lastJson = '';
let lastPhase = null;

function interval() {
  if (!lastPhase) return 5000;
  if (['ReadyCheck', 'ChampSelect', 'Matchmaking'].includes(lastPhase)) return 1000;
  return clients.size ? 2000 : 4000;
}
const active = () => clients.size > 0 || settings.autoAccept || settings.autoRunes;

function schedule(ms) {
  clearTimeout(timer);
  if (!active()) return;
  timer = setTimeout(tick, ms ?? interval());
}

async function tick() {
  if (busy) return schedule();
  busy = true;
  try {
    const st = await readState();
    lastPhase = st.connected ? st.phase : null;
    await automations(st).catch(() => {});
    if (lastEvent) st.event = lastEvent;
    const json = JSON.stringify(st);
    if (json !== lastJson) {
      lastJson = json;
      for (const res of clients) res.write(`data: ${json}\n\n`);
    }
  } catch (e) {
    console.error('[live]', e.message);
  } finally {
    busy = false;
    schedule();
  }
}

export function stream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  if (lastJson) res.write(`data: ${lastJson}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
  schedule(0);
}

export function startLive() { schedule(0); }

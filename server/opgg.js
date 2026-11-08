// Integração com a API pública do OP.GG (servidor MCP oficial: https://mcp-api.op.gg/mcp)
const ENDPOINT = 'https://mcp-api.op.gg/mcp';
const LANG = 'pt_BR';

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

let rpcId = 0;
async function callTool(name, args) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw Object.assign(new Error(`OP.GG respondeu ${res.status}`), { status: 502 });
  let body = await res.text();
  // a resposta pode vir como JSON puro ou como evento SSE ("data: {...}")
  if (body.startsWith('event:') || body.startsWith('data:')) {
    body = body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  }
  const json = JSON.parse(body);
  if (json.error) throw Object.assign(new Error(`OP.GG: ${json.error.message}`), { status: 502 });
  const text = json.result?.content?.[0]?.text || '';
  if (json.result?.isError) throw Object.assign(new Error(`OP.GG: ${text.slice(0, 200)}`), { status: 502 });
  try { return JSON.parse(text); } catch { return parseToon(text); }
}

/**
 * O OP.GG devolve um formato compacto: cabeçalho "class Nome: campo1,campo2"
 * seguido de chamadas tipo Nome(valor1, valor2, [lista], "texto", null).
 * Este parser transforma isso em objetos JS com os nomes dos campos.
 */
export function parseToon(text) {
  const lines = text.split('\n');
  const schemas = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^class (\w+): (.*)$/);
    if (!m) break;
    schemas[m[1]] = m[2].split(',');
  }
  const src = lines.slice(i).join('\n').trim();
  let p = 0;
  const ws = () => { while (p < src.length && /\s/.test(src[p])) p++; };
  const fail = () => { throw new Error(`Formato OP.GG inesperado perto de: ${src.slice(p, p + 40)}`); };
  function list(close) {
    const out = [];
    ws();
    if (src[p] === close) { p++; return out; }
    for (;;) {
      out.push(value());
      ws();
      if (src[p] === ',') { p++; continue; }
      if (src[p] === close) { p++; return out; }
      fail();
    }
  }
  function value() {
    ws();
    const c = src[p];
    if (c === '"') {
      let j = p + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      const s = JSON.parse(src.slice(p, j + 1));
      p = j + 1;
      return s;
    }
    if (c === '[') { p++; return list(']'); }
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(p, p + 40));
    if (num) { p += num[0].length; return Number(num[0]); }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(p, p + 80));
    if (!id) fail();
    p += id[0].length;
    const word = id[0];
    if (word === 'null' || word === 'None') return null;
    if (word === 'true' || word === 'True') return true;
    if (word === 'false' || word === 'False') return false;
    ws();
    if (src[p] !== '(') fail();
    p++;
    const args = list(')');
    const fields = schemas[word];
    if (!fields) return { _type: word, _args: args };
    return Object.fromEntries(fields.map((f, k) => [f, args[k] ?? null]));
  }
  return value();
}

// ---------- normalização ----------
const rate = (o) => (o && o.play ? o.win / o.play : null);
const first = (x) => (Array.isArray(x) ? x[0] : x);
const items = (x) => (x ? { ids: x.ids || [], winRate: rate(x), pickRate: x.pick_rate, games: x.play } : null);
const runes = (r) => r && {
  keystone: r.primary_rune_ids?.[0],
  primary: r.primary_page_id,
  minor: (r.primary_rune_ids || []).slice(1),
  secondary: r.secondary_page_id,
  secondaryRunes: r.secondary_rune_ids || [],
  shards: r.stat_mod_ids || [],
  winRate: rate(r), pickRate: r.pick_rate, games: r.play,
};
const champList = (arr) => (arr || []).map((c) => ({
  championId: c.champion_id, name: c.champion_name, games: c.play,
  winRate: c.my_win_rate ?? rate(c),
}));

const POS = { MIDDLE: 'mid', TOP: 'top', JUNGLE: 'jungle', BOTTOM: 'adc', UTILITY: 'support' };
export const toOpggPosition = (lane) => POS[lane] || String(lane).toLowerCase();
// nome do campeão no formato do OP.GG: "Twisted Fate" -> TWISTED_FATE, "Kog'Maw" -> KOG_MAW
export const toOpggChampion = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

const HOUR = 3600 * 1000;

export function getMeta(lane, champion = 'Akali') {
  const position = toOpggPosition(lane);
  const champ = toOpggChampion(champion);
  return cached(`meta:${champ}:${position}`, 6 * HOUR, async () => {
    const r = await callTool('lol_get_champion_analysis', { champion: champ, position, game_mode: 'ranked', lang: LANG });
    const d = r.data || r;
    const pos = (d.summary?.positions || []).find((x) => x.name?.toLowerCase() === (position === 'mid' ? 'mid' : position));
    const s = pos?.stats || d.summary?.average_stats || {};
    return {
      patch: d.trends?.win?.version || null,
      stats: {
        winRate: s.win_rate, pickRate: s.pick_rate, banRate: s.ban_rate, kda: s.kda,
        tier: s.tier_data?.tier ?? s.tier, rank: s.tier_data?.rank ?? s.rank, games: s.play,
      },
      runes: runes(first(d.runes)),
      spells: items(first(d.summoner_spells)),
      starter: items(first(d.starter_items)),
      boots: items(first(d.boots)),
      core: items(first(d.core_items)),
      fourth: (d.fourth_items || []).map(items),
      fifth: (d.fifth_items || []).map(items),
      sixth: (d.sixth_items || []).map(items),
      skills: d.skills ? { order: d.skills.order, winRate: rate(d.skills), pickRate: d.skills.pick_rate } : null,
      skillMax: d.skill_masteries?.ids || null,
      combos: (d.skill_combos || []).map((c) => ({ name: c.name, video: c.video_url })),
      strongAgainst: champList(d.strong_counters),
      weakAgainst: champList(d.weak_counters),
    };
  });
}

// Mapa completo: winrate da Akali contra cada campeão da rota
const SAMPLE_OPPONENT = { mid: 'AHRI', top: 'AATROX', jungle: 'LEE_SIN', adc: 'JINX', support: 'THRESH' };

export function getMatchup(lane, opponent, myChampion = 'Akali') {
  const position = toOpggPosition(lane);
  const opp = toOpggChampion(opponent || SAMPLE_OPPONENT[position]);
  const mine = toOpggChampion(myChampion);
  return cached(`mu:${mine}:${position}:${opp}`, 6 * HOUR, async () => {
    const r = await callTool('lol_get_lane_matchup_guide', {
      my_champion: mine, opponent_champion: opp, position, lang: LANG,
    });
    const d = r.data || {};
    const runePage = first(d.rune_pages);
    return {
      opponent: r.opponent_champion || opponent,
      tip: d.opponent_champion_tip || null,
      laneAdvantage: d.lane_advantage_champion || null,
      soloKillAdvantage: d.lane_solo_kill_advantage_champion || null,
      playStyle: d.recommended_play_style || null,
      runes: runes(first(runePage?.builds) || runePage),
      core: items(first(d.core_items)),
      spells: items(first(d.summoner_spells)),
      starter: items(first(d.starter_items)),
      boots: items(first(d.boots)),
      skills: d.skills ? { order: first(d.skills)?.order || d.skills.order } : null,
      opponents: champList(d.counters),
    };
  });
}

const REGION = {
  br1: 'br', na1: 'na', la1: 'lan', la2: 'las', euw1: 'euw', eun1: 'eune', tr1: 'tr', ru: 'ru', me1: 'me',
  kr: 'kr', jp1: 'jp', oc1: 'oce', ph2: 'ph', sg2: 'sg', th2: 'th', tw2: 'tw', vn2: 'vn',
};

export function getProfile(gameName, tagLine, platform) {
  const region = REGION[platform] || 'br';
  return cached(`profile:${region}:${gameName}#${tagLine}`.toLowerCase(), 5 * 60 * 1000, async () => {
    const r = await callTool('lol_get_summoner_profile', { game_name: gameName, tag_line: tagLine, region, lang: LANG });
    const s = r?.data?.summoner;
    if (!s) throw Object.assign(new Error('Conta não encontrada no OP.GG'), { status: 404 });
    const league = (s.league_stats || [])
      .filter((l) => l.tier_info?.tier && /RANKED/.test(l.game_type))
      .map((l) => ({
        queue: l.game_type === 'SOLORANKED' ? 'Solo/Duo' : 'Flex',
        tier: l.tier_info.tier, division: l.tier_info.division, lp: l.tier_info.lp,
        wins: l.win, losses: l.lose, hotStreak: l.is_hot_streak,
      }));
    const pool = (s.most_champions?.champion_stats || []).map((c) => ({
      championId: c.id, name: c.champion_name, games: c.play, wins: c.win,
      kills: c.kill, deaths: c.death, assists: c.assist,
      cs: (c.minion_kill || 0) + (c.neutral_minion_kill || 0), seconds: c.game_length_second,
      damage: c.damage_dealt_to_champions, pentas: c.penta_kill,
    }));
    const prev = (s.previous_seasons || []).map((x) => ({ season: x.season_id, tier: x.tier_info?.tier, division: x.tier_info?.division }));
    return {
      url: `https://op.gg/lol/summoners/${region}/${encodeURIComponent(`${s.game_name}-${s.tagline}`)}`,
      level: s.level,
      updatedAt: s.updated_at,
      league,
      previousSeasons: prev,
      seasonGames: s.most_champions?.play ?? null,
      champions: pool.slice(0, 10),
      akali: pool.find((c) => c.championId === 84) || null,
      focus: Object.fromEntries([84, 117, 29, 267].map((id) => [id, pool.find((c) => c.championId === id) || null])),
    };
  });
}

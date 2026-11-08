// Cliente da Riot API (account-v1, summoner-v4, champion-mastery-v4, league-v4, match-v5)
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// No app de desktop os dados graváveis ficam na pasta do usuário (AppData); no modo dev, na pasta do projeto
export const DATA_DIR = process.env.AKALI_DATA_DIR || ROOT;
export const ENV_FILE = path.join(DATA_DIR, '.env');
const MATCH_CACHE = path.join(DATA_DIR, 'cache', 'matches');

export const AKALI_ID = 84;

// plataforma -> roteamento regional
const REGIONAL = {
  br1: 'americas', na1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};
export const PLATFORMS = Object.keys(REGIONAL);

export function regionalOf(platform) {
  const r = REGIONAL[platform];
  if (!r) throw httpError(400, `Região desconhecida: ${platform}`);
  return r;
}
// account-v1 não roda em "sea"; qualquer cluster serve para qualquer conta
const accountCluster = (platform) => (regionalOf(platform) === 'sea' ? 'asia' : regionalOf(platform));

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// relê o .env a cada chamada: trocar a chave não exige reiniciar o app
export function currentKey() {
  try {
    const m = fsSync.readFileSync(ENV_FILE, 'utf8').match(/^\s*RIOT_API_KEY\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch { /* sem .env */ }
  return process.env.RIOT_API_KEY || '';
}
export const hasKey = () => /^RGAPI-/.test(currentKey()) && !currentKey().includes('xxxx');

/** Salva a chave no .env, preservando as outras linhas. */
export async function saveKey(key) {
  let content = '';
  try { content = await fs.readFile(ENV_FILE, 'utf8'); } catch { /* novo arquivo */ }
  content = /^\s*RIOT_API_KEY\s*=.*$/m.test(content)
    ? content.replace(/^\s*RIOT_API_KEY\s*=.*$/m, `RIOT_API_KEY=${key}`)
    : `RIOT_API_KEY=${key}\n${content}`;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ENV_FILE, content);
}

/** Testa a chave num endpoint leve (status do servidor). */
export async function testKey(key = currentKey()) {
  if (!/^RGAPI-/.test(key)) return { valid: false, reason: 'missing' };
  try {
    const r = await fetch('https://br1.api.riotgames.com/lol/status/v4/platform-data', {
      headers: { 'X-Riot-Token': key }, signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { valid: true };
    return { valid: false, reason: r.status === 401 || r.status === 403 ? 'expired' : `http_${r.status}` };
  } catch {
    return { valid: false, reason: 'network' };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riot(host, pathname, { retries = 3 } = {}) {
  if (!hasKey()) throw httpError(401, 'RIOT_API_KEY não configurada no arquivo .env');
  const url = `https://${host}.api.riotgames.com${pathname}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'X-Riot-Token': currentKey() } });
    if (res.status === 429 && attempt < retries) {
      const wait = Number(res.headers.get('retry-after') || 2) * 1000;
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw httpError(403, 'API key inválida ou expirada. Gere uma nova em developer.riotgames.com e atualize o .env');
    }
    if (!res.ok) throw httpError(res.status, `Riot API ${res.status} em ${pathname}`);
    return res.json();
  }
}

export async function getAccount(gameName, tagLine, platform) {
  const acc = await riot(
    accountCluster(platform),
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
  if (!acc) throw httpError(404, `Conta ${gameName}#${tagLine} não encontrada`);
  return acc;
}

export async function getProfile(puuid, platform) {
  const [summoner, mastery, league, topMastery] = await Promise.all([
    riot(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`),
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/by-champion/${AKALI_ID}`),
    riot(platform, `/lol/league/v4/entries/by-puuid/${puuid}`),
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=5`),
  ]);
  return { summoner, mastery, league: league || [], topMastery: topMastery || [] };
}

async function cachedMatch(regional, id) {
  const file = path.join(MATCH_CACHE, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    const m = await riot(regional, `/lol/match/v5/matches/${id}`);
    if (m) {
      await fs.mkdir(MATCH_CACHE, { recursive: true });
      await fs.writeFile(file, JSON.stringify(m));
    }
    return m;
  }
}

/**
 * Busca as últimas `scan` partidas e devolve só as de Akali, já resumidas.
 * Partidas ficam em cache no disco (são imutáveis), então só a 1ª busca é lenta.
 */
export async function getAkaliMatches(puuid, platform, scan = 60) {
  const regional = regionalOf(platform);
  const ids = (await riot(regional, `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${Math.min(scan, 100)}`)) || [];
  const out = [];
  // concorrência baixa para respeitar o limite da Development Key (20 req/s, 100 req/2min)
  const queue = [...ids];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const m = await cachedMatch(regional, id);
      const s = m && summarizeMatch(m, puuid);
      if (s) out.push(s);
    }
  });
  await Promise.all(workers);
  return { scanned: ids.length, matches: out.sort((a, b) => b.date - a.date) };
}

export function summarizeMatch(m, puuid) {
  const info = m.info;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me || me.championId !== AKALI_ID) return null;
  if (info.gameDuration < 300) return null; // remake
  const team = info.participants.filter((p) => p.teamId === me.teamId);
  const teamKills = team.reduce((a, p) => a + p.kills, 0) || 1;
  const opp = info.participants.find(
    (p) => p.teamId !== me.teamId && p.teamPosition && p.teamPosition === me.teamPosition,
  );
  const minutes = info.gameDuration / 60;
  const styles = me.perks?.styles || [];
  return {
    id: m.metadata.matchId,
    date: info.gameStartTimestamp || info.gameCreation,
    duration: info.gameDuration,
    queue: info.queueId,
    win: me.win,
    lane: me.teamPosition || me.individualPosition || 'UNKNOWN',
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    csMin: +((me.totalMinionsKilled + me.neutralMinionsKilled) / minutes).toFixed(1),
    damage: me.totalDamageDealtToChampions,
    dmgMin: Math.round(me.totalDamageDealtToChampions / minutes),
    gold: me.goldEarned,
    vision: me.visionScore,
    level: me.champLevel,
    kp: Math.round(((me.kills + me.assists) / teamKills) * 100),
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6],
    keystone: styles[0]?.selections?.[0]?.perk || null,
    secondaryStyle: styles[1]?.style || null,
    spells: [me.summoner1Id, me.summoner2Id],
    pentas: me.pentaKills,
    opponent: opp ? { champion: opp.championName, championId: opp.championId, kills: opp.kills, deaths: opp.deaths, assists: opp.assists } : null,
  };
}

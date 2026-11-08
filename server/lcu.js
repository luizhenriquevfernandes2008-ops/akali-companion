// Conector com o cliente local do League of Legends (LCU API).
// Funciona só na mesma máquina, com o cliente aberto e logado.
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { FOCUS, FOCUS_IDS } from './riot.js';

const DEFAULT_PATHS = [
  process.env.LOL_PATH,
  'C:\\Riot Games\\League of Legends',
  'D:\\Riot Games\\League of Legends',
  'C:\\Program Files\\Riot Games\\League of Legends',
].filter(Boolean);

const REGION_TO_PLATFORM = {
  BR: 'br1', NA: 'na1', LA1: 'la1', LA2: 'la2', LAN: 'la1', LAS: 'la2',
  EUW: 'euw1', EUNE: 'eun1', TR: 'tr1', RU: 'ru', ME1: 'me1',
  KR: 'kr', JP: 'jp1', OC1: 'oc1', OCE: 'oc1',
  PH: 'ph2', PH2: 'ph2', SG: 'sg2', SG2: 'sg2', TH: 'th2', TH2: 'th2', TW: 'tw2', TW2: 'tw2', VN: 'vn2', VN2: 'vn2',
};

async function fromLockfile() {
  for (const dir of DEFAULT_PATHS) {
    try {
      const raw = await fs.readFile(path.join(dir, 'lockfile'), 'utf8');
      const [, , port, password] = raw.split(':');
      return { port, password };
    } catch { /* tenta o próximo */ }
  }
  return null;
}

// Fallback: lê a linha de comando do processo LeagueClientUx.exe
function fromProcess() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const port = stdout.match(/--app-port=(\d+)/)?.[1];
        const password = stdout.match(/--remoting-auth-token=([\w-]+)/)?.[1];
        resolve(port && password ? { port, password } : null);
      },
    );
  });
}

// Credenciais em cache: o cliente troca porta/senha a cada abertura, então
// revalidamos periodicamente e sempre que a conexão falha.
let credCache = null;
let credAt = 0;
async function credentials(force = false) {
  const ttl = credCache ? 30000 : 5000; // sem cliente: tenta de novo a cada 5s (evita abrir powershell toda hora)
  if (!force && Date.now() - credAt < ttl) return credCache;
  credCache = (await fromLockfile()) || (await fromProcess());
  credAt = Date.now();
  return credCache;
}

function lcuRaw(creds, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path: pathname,
        method,
        rejectUnauthorized: false, // o cliente usa certificado próprio da Riot
        headers: {
          Authorization: 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64'),
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
        timeout: 8000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* corpo vazio/texto */ }
          if (res.statusCode >= 400) {
            const e = new Error(json?.message || `LCU ${res.statusCode} ${method} ${pathname}`);
            e.status = res.statusCode;
            return reject(e);
          }
          resolve(json);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('LCU timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Chamada genérica à API local do cliente. Lança status 503 se o cliente estiver fechado. */
export async function lcu(method, pathname, body) {
  let creds = await credentials();
  if (!creds) throw Object.assign(new Error('Cliente do LoL não está aberto'), { status: 503 });
  try {
    return await lcuRaw(creds, method, pathname, body);
  } catch (e) {
    if (!['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(e.code)) throw e;
    creds = await credentials(true); // cliente reiniciou: pega porta/senha novas
    if (!creds) throw Object.assign(new Error('Cliente do LoL não está aberto'), { status: 503 });
    return lcuRaw(creds, method, pathname, body);
  }
}
const lcuGet = (_creds, pathname) => lcu('GET', pathname);

const LANE_MAP = { TOP: 'TOP', MIDDLE: 'MIDDLE', MID: 'MIDDLE', JUNGLE: 'JUNGLE', BOTTOM: 'BOTTOM' };

function normalizeLcuGame(g, puuid) {
  const ident = g.participantIdentities?.find((i) => i.player?.puuid === puuid) || g.participantIdentities?.[0];
  const me = g.participants?.find((p) => p.participantId === ident?.participantId) || g.participants?.[0];
  if (!me || !FOCUS[me.championId] || g.gameDuration < 300) return null;
  const s = me.stats;
  const minutes = g.gameDuration / 60;
  const cs = s.totalMinionsKilled + s.neutralMinionsKilled;
  let lane = LANE_MAP[me.timeline?.lane] || 'UNKNOWN';
  if (lane === 'BOTTOM' && me.timeline?.role === 'DUO_SUPPORT') lane = 'UTILITY';
  return {
    id: `LCU_${g.gameId}`,
    championId: me.championId,
    date: g.gameCreation,
    duration: g.gameDuration,
    queue: g.queueId,
    win: s.win,
    lane,
    kills: s.kills, deaths: s.deaths, assists: s.assists,
    cs, csMin: +(cs / minutes).toFixed(1),
    damage: s.totalDamageDealtToChampions,
    dmgMin: Math.round(s.totalDamageDealtToChampions / minutes),
    gold: s.goldEarned, vision: s.visionScore, level: s.champLevel, kp: null,
    items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6],
    keystone: s.perk0 || null, secondaryStyle: s.perkSubStyle || null,
    spells: [me.spell1Id, me.spell2Id], pentas: s.pentaKills,
    opponent: null, // o histórico do cliente não traz o oponente de lane
  };
}

/** Retorna os dados da conta logada no cliente, ou null se o cliente não estiver aberto. */
export async function getLcuData() {
  const creds = await credentials();
  if (!creds) return null;
  try {
    const summoner = await lcuGet(creds, '/lol-summoner/v1/current-summoner');
    const [regionLocale, masteries, history] = await Promise.all([
      lcuGet(creds, '/riotclient/region-locale').catch(() => null),
      lcuGet(creds, '/lol-champion-mastery/v1/local-player/champion-mastery').catch(() => []),
      lcuGet(creds, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=99').catch(() => null),
    ]);
    const region = (regionLocale?.region || '').toUpperCase();
    const games = history?.games?.games || [];
    return {
      gameName: summoner.gameName || summoner.displayName,
      tagLine: summoner.tagLine,
      puuid: summoner.puuid,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
      platform: REGION_TO_PLATFORM[region] || null,
      masteries: Object.fromEntries(FOCUS_IDS.map((id) => [id, (masteries || []).find((m) => m.championId === id) || null])),
      topMastery: (masteries || []).slice(0, 5),
      matches: games.map((g) => normalizeLcuGame(g, summoner.puuid)).filter(Boolean),
    };
  } catch {
    return null;
  }
}

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccount, getProfile, getFocusMatches, hasKey, PLATFORMS, DATA_DIR, currentKey, saveKey, testKey, FOCUS_IDS } from './riot.js';
import { getLcuData } from './lcu.js';
import * as opgg from './opgg.js';
import * as live from './live.js';
import * as remote from './remote.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_FILE = path.join(DATA_DIR, 'cache', 'mastery-history.json');

const app = express();
let listenPort = null;
app.use(remote.guard); // outros aparelhos da rede só entram com o controle remoto ativo + token
app.use(express.json());
app.get('/m', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'mobile.html')));
app.use(express.static(path.join(ROOT, 'public')));

// ---- histórico de maestria (para calcular seus pontos médios reais por partida) ----
async function readHistory() {
  try { return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8')); } catch { return {}; }
}
// histórico por campeão: chave "puuid:championId" (versões antigas usavam só o puuid, que era da Akali)
async function recordMastery(puuid, masteries) {
  const out = {};
  if (!puuid || !masteries) return out;
  const all = await readHistory();
  let changed = false;
  if (all[puuid] && !all[`${puuid}:84`]) { all[`${puuid}:84`] = all[puuid]; delete all[puuid]; changed = true; }
  for (const id of FOCUS_IDS) {
    const key = `${puuid}:${id}`;
    const m = masteries[id];
    const list = all[key] || [];
    const last = list[list.length - 1];
    if (m && (!last || last.points !== m.championPoints)) {
      list.push({ t: Date.now(), points: m.championPoints, level: m.championLevel });
      all[key] = list.slice(-200);
      changed = true;
    }
    out[id] = all[key] || [];
  }
  if (changed) {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.writeFile(HISTORY_FILE, JSON.stringify(all));
  }
  return out;
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error('[erro]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  });

app.get('/api/config', (_req, res) => res.json({ hasKey: hasKey(), platforms: PLATFORMS, desktop: Boolean(process.env.AKALI_DESKTOP) }));

// ---- configurações (chave da Riot) ----
const maskKey = (k) => (k ? `${k.slice(0, 10)}…${k.slice(-4)}` : null);
app.use(['/api/settings', '/api/remote'], remote.localOnly);
app.get('/api/settings', wrap(async (_req, res) => {
  const key = currentKey();
  res.json({ keyPreview: maskKey(key), ...(await testKey(key)) });
}));
app.post('/api/settings/key', wrap(async (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (!/^RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return res.status(400).json({ error: 'Formato inválido. A chave começa com RGAPI- (copie com o botão "Copy" do portal).' });
  }
  const test = await testKey(key);
  if (!test.valid && test.reason !== 'network') {
    return res.status(400).json({ error: 'A Riot recusou essa chave (expirada ou inválida). Gere uma nova no portal e tente de novo.' });
  }
  await saveKey(key);
  res.json({ ok: true, keyPreview: maskKey(key), ...test });
}));

app.get('/api/lcu', wrap(async (_req, res) => {
  const data = await getLcuData();
  if (!data) return res.json({ connected: false });
  const masteryHistory = await recordMastery(data.puuid, data.masteries);
  res.json({ connected: true, ...data, masteryHistory });
}));

app.get('/api/player', wrap(async (req, res) => {
  const { name, tag, platform = 'br1' } = req.query;
  if (!name || !tag) return res.status(400).json({ error: 'Informe nome e tag (ex: Akali#BR1)' });

  // Sem API key (ou chave recusada): usa o cliente aberto
  const fromLcu = async (warning) => {
    const lcu = await getLcuData();
    if (lcu && lcu.gameName?.toLowerCase() === String(name).toLowerCase()) {
      const masteryHistory = await recordMastery(lcu.puuid, lcu.masteries);
      res.json({ source: 'lcu', ...lcu, league: [], masteryHistory, scanned: lcu.matches.length, warning });
      return true;
    }
    return false;
  };

  if (!hasKey()) {
    if (await fromLcu()) return;
    return res.status(401).json({
      error: 'Sem RIOT_API_KEY no .env. Configure a chave ou abra o cliente do LoL logado nessa conta.',
    });
  }

  let account, profile, matchData;
  try {
    account = await getAccount(name, tag, platform);
    [profile, matchData] = await Promise.all([
      getProfile(account.puuid, platform),
      getFocusMatches(account.puuid, platform, Number(req.query.scan) || 80),
    ]);
  } catch (e) {
    if (e.status === 403 && (await fromLcu(e.message))) return;
    throw e;
  }
  const masteryHistory = await recordMastery(account.puuid, profile.masteries);
  res.json({
    source: 'riot',
    gameName: account.gameName,
    tagLine: account.tagLine,
    puuid: account.puuid,
    platform,
    profileIconId: profile.summoner?.profileIconId,
    summonerLevel: profile.summoner?.summonerLevel,
    masteries: profile.masteries,
    topMastery: profile.topMastery,
    league: profile.league,
    matches: matchData.matches,
    scanned: matchData.scanned,
    masteryHistory,
  });
}));

// ---- OP.GG ----
app.get('/api/opgg/meta', wrap(async (req, res) => {
  res.json(await opgg.getMeta(req.query.lane || 'MIDDLE', req.query.champ || 'Akali'));
}));
app.get('/api/opgg/matchup', wrap(async (req, res) => {
  res.json(await opgg.getMatchup(req.query.lane || 'MIDDLE', req.query.opponent, req.query.champ || 'Akali'));
}));
app.get('/api/opgg/profile', wrap(async (req, res) => {
  const { name, tag, platform = 'br1' } = req.query;
  if (!name || !tag) return res.status(400).json({ error: 'Informe nome e tag' });
  res.json(await opgg.getProfile(name, tag, platform));
}));

// ---- cliente do LoL ao vivo ----
app.get('/api/live/state', wrap(async (_req, res) => res.json(await live.readState())));
app.get('/api/live/stream', (req, res) => live.stream(req, res));
app.post('/api/live/action', wrap(async (req, res) => {
  const { type, ...params } = req.body || {};
  res.json(await live.action(type, params));
}));
app.get('/api/live/settings', (_req, res) => res.json(live.getSettings()));
app.post('/api/live/settings', (req, res) => res.json(live.setSettings(req.body || {})));

// ---- controle pelo celular (só o PC pode ver o token / ligar e desligar) ----
app.get('/api/remote', wrap(async (_req, res) => res.json(await remote.info(listenPort))));
app.post('/api/remote', wrap(async (req, res) => {
  if (typeof req.body?.enabled === 'boolean') remote.setEnabled(req.body.enabled);
  if (req.body?.regenerate) remote.regenerate();
  res.json(await remote.info(listenPort));
}));

/** Inicia o servidor. Se a porta estiver ocupada, usa uma livre. Retorna a porta. */
export function start(port = Number(process.env.PORT || 3000)) {
  return new Promise((resolve, reject) => {
    // escuta na rede local para o celular conseguir acessar (protegido pelo remote.guard)
    const server = app.listen(port, '0.0.0.0', () => {
      listenPort = server.address().port;
      live.startLive();
      resolve(listenPort);
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0) resolve(start(0));
      else reject(e);
    });
  });
}

// Executado direto (npm start): sobe o servidor
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then((port) => {
    console.log(`\n  ⚡ Akali Companion rodando em http://localhost:${port}`);
    console.log(`  API key: ${hasKey() ? 'configurada ✔' : 'NÃO configurada (modo cliente LoL / só builds)'}\n`);
  });
}

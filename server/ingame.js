// Monitor da partida em andamento — usa a Live Client Data API oficial da Riot
// (https://127.0.0.1:2999, disponível só enquanto o jogo está rodando, sem autenticação).
// Mostra apenas informação que o próprio jogo já dá ao jogador (placar, itens, eventos) + dados do OP.GG.
import https from 'node:https';
import { gameData } from './ddragon.js';
import { getMatchup } from './opgg.js';

function liveGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path, rejectUnauthorized: false, timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`live ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('live timeout')));
    req.on('error', reject);
  });
}

// campeões com cura forte (para sugerir antecura)
const HEALERS = new Set(['soraka', 'yuumi', 'sona', 'nami', 'aatrox', 'vladimir', 'sylas', 'warwick', 'fiddlesticks', 'drmundo', 'swain', 'olaf', 'briar', 'senna', 'seraphine', 'renata', 'illaoi', 'maokai', 'zac', 'kayn', 'belveth', 'irelia', 'samira', 'ksante']);
const SUGGEST = { voidStaff: 3135, morello: 3165, zhonya: 3157, banshee: 3102, mortalReminder: 3033, chempunk: 6609, maw: 3156, steraks: 3053 };
const DRAGON_PT = { Fire: 'Infernal', Water: 'Oceano', Earth: 'Montanha', Air: 'Nuvens', Hextech: 'Hextec', Chemtech: 'Quimtec', Elder: 'Ancião' };

// matchups do OP.GG buscados em segundo plano (não travam a atualização ao vivo)
const matchupCache = new Map();
function matchupFor(lane, opponentName, myName) {
  const key = `${myName}|${lane}|${opponentName}`;
  if (!matchupCache.has(key)) {
    matchupCache.set(key, { loading: true });
    getMatchup(lane, opponentName, myName)
      .then((m) => matchupCache.set(key, m))
      .catch((e) => matchupCache.set(key, { error: e.message }));
  }
  return matchupCache.get(key);
}

let cache = null;
let cachedAt = 0;

export async function readGame() {
  if (cache && Date.now() - cachedAt < 1500) return cache;
  const d = await liveGet('/liveclientdata/allgamedata');
  if (!d.allPlayers || !d.activePlayer) return { loading: true };
  const gd = await gameData();

  const players = d.allPlayers.map((p) => {
    const raw = String(p.rawChampionName || '').replace('game_character_displayname_', '').toLowerCase();
    const champ = gd.championsById[raw] || Object.values(gd.championsById).find((c) => c.name === p.championName) || {};
    const items = (p.items || []).filter((i) => i.slot < 6);
    return {
      name: p.riotIdGameName || p.summonerName,
      riotId: p.riotId,
      championId: champ.key || null,
      champion: p.championName,
      champKey: champ.id?.toLowerCase(),
      attack: champ.attack ?? 5, magic: champ.magic ?? 5,
      team: p.team,
      position: p.position || '',
      level: p.level,
      kills: p.scores.kills, deaths: p.scores.deaths, assists: p.scores.assists,
      cs: p.scores.creepScore, ward: Math.round(p.scores.wardScore || 0),
      items: items.map((i) => i.itemID),
      trinket: (p.items || []).find((i) => i.slot === 6)?.itemID || null,
      itemGold: items.reduce((sum, i) => sum + (gd.items[i.itemID]?.gold || i.price || 0) * (i.count || 1), 0),
      dead: p.isDead, respawn: Math.ceil(p.respawnTimer || 0),
      keystone: p.runes?.keystone?.id || null,
    };
  });

  const me = players.find((p) => p.riotId === d.activePlayer.riotId) || players.find((p) => p.name === d.activePlayer.riotIdGameName);
  const myTeam = me?.team || 'ORDER';
  const enemyTeam = myTeam === 'ORDER' ? 'CHAOS' : 'ORDER';
  const opp = me?.position ? players.find((p) => p.team === enemyTeam && p.position === me.position) : null;
  const teamOf = new Map(players.flatMap((p) => [[p.name, p.team], [p.riotId, p.team]]));
  const champOf = new Map(players.flatMap((p) => [[p.name, p.championId], [p.riotId, p.championId]]));

  // ---- eventos: abates, objetivos ----
  const events = d.events?.Events || [];
  const obj = { [myTeam]: { dragons: [], barons: 0, heralds: 0, grubs: 0, towers: 0, inhibs: 0 }, [enemyTeam]: { dragons: [], barons: 0, heralds: 0, grubs: 0, towers: 0, inhibs: 0 } };
  let lastDragon = null;
  let lastBaron = null;
  const kills = [];
  for (const e of events) {
    const team = teamOf.get(e.KillerName);
    if (e.EventName === 'DragonKill' && team) { obj[team].dragons.push(DRAGON_PT[e.DragonType] || e.DragonType); lastDragon = e; }
    if (e.EventName === 'BaronKill' && team) { obj[team].barons++; lastBaron = e; }
    if (e.EventName === 'HeraldKill' && team) obj[team].heralds++;
    if (e.EventName === 'HordeKill' && team) obj[team].grubs++;
    if (e.EventName === 'TurretKilled') {
      // Turret_T1_* pertence ao time ORDER; quem ganha o ponto é o outro time
      const owner = /_T1_/.test(e.TurretKilled) ? 'ORDER' : /_T2_/.test(e.TurretKilled) ? 'CHAOS' : null;
      if (owner) obj[owner === 'ORDER' ? 'CHAOS' : 'ORDER'].towers++;
    }
    if (e.EventName === 'InhibKilled') {
      const owner = /_T1_/.test(e.InhibKilled) ? 'ORDER' : /_T2_/.test(e.InhibKilled) ? 'CHAOS' : null;
      if (owner) obj[owner === 'ORDER' ? 'CHAOS' : 'ORDER'].inhibs++;
    }
    if (e.EventName === 'ChampionKill') {
      kills.push({
        t: e.EventTime, killer: champOf.get(e.KillerName) || null, victim: champOf.get(e.VictimName) || null,
        ally: teamOf.get(e.VictimName) === enemyTeam, involvesMe: [e.KillerName, e.VictimName, ...(e.Assisters || [])].includes(me?.name),
      });
    }
  }
  const t = d.gameData.gameTime;
  // horários de nascimento (o próprio jogo mostra esses timers; aqui é só conveniência)
  const nextDragon = lastDragon ? lastDragon.EventTime + (lastDragon.DragonType === 'Elder' ? 360 : 300) : 300;
  const nextBaron = lastBaron ? lastBaron.EventTime + 360 : 1200;

  const sum = (team, k) => players.filter((p) => p.team === team).reduce((a, p) => a + (p[k] || 0), 0);
  const teams = {
    ally: { kills: sum(myTeam, 'kills'), gold: sum(myTeam, 'itemGold'), ...obj[myTeam] },
    enemy: { kills: sum(enemyTeam, 'kills'), gold: sum(enemyTeam, 'itemGold'), ...obj[enemyTeam] },
  };

  // ---- dicas de build e de lane ----
  const enemies = players.filter((p) => p.team === enemyTeam);
  const att = enemies.reduce((a, p) => a + p.attack, 0);
  const mag = enemies.reduce((a, p) => a + p.magic, 0);
  const magicShare = att + mag ? mag / (att + mag) : 0.5;
  const tips = [];
  if (me) {
    const iAmAp = me.magic >= me.attack;
    const owned = new Set(me.items);
    const has = (id) => owned.has(id);
    const enemyMrItems = enemies.flatMap((p) => p.items).filter((id) => gd.items[id]?.completed && gd.items[id].tags.includes('SpellBlock')).length;
    const enemyArmorItems = enemies.flatMap((p) => p.items).filter((id) => gd.items[id]?.completed && gd.items[id].tags.includes('Armor')).length;
    const healers = enemies.filter((p) => HEALERS.has(p.champKey));
    const suggest = (id, text) => { if (gd.items[id] && !has(id)) tips.push({ item: id, text }); };

    if (iAmAp && enemyMrItems >= 2) suggest(SUGGEST.voidStaff, `Inimigos com ${enemyMrItems} itens de resistência mágica — Cajado do Vazio aumenta muito seu dano.`);
    if (!iAmAp && enemyArmorItems >= 2) tips.push({ text: `Inimigos com ${enemyArmorItems} itens de armadura — priorize penetração de armadura.` });
    if (healers.length) suggest(iAmAp ? SUGGEST.morello : SUGGEST.chempunk, `Cura forte no time inimigo (${healers.map((h) => h.champion).join(', ')}) — compre antecura.`);
    if (magicShare <= 0.4) suggest(iAmAp ? SUGGEST.zhonya : SUGGEST.steraks, `Dano inimigo é ${Math.round((1 - magicShare) * 100)}% físico — ${iAmAp ? 'Zhonya te salva dos assassinos AD.' : 'itens de vida/armadura ajudam.'}`);
    if (magicShare >= 0.6) suggest(iAmAp ? SUGGEST.banshee : SUGGEST.maw, `Dano inimigo é ${Math.round(magicShare * 100)}% mágico — um item com resistência mágica vale a pena.`);
    if (opp) {
      const csDiff = me.cs - opp.cs;
      if (csDiff <= -15) tips.push({ text: `Você está ${-csDiff} CS atrás do ${opp.champion}. Foque no farm antes de trocar.` });
      if (opp.kills >= 3 && opp.kills > me.kills + 1) tips.push({ text: `${opp.champion} está forte (${opp.kills} abates). Jogue mais seguro e peça ajuda ao jungle.` });
      if (me.level >= 6 && opp.level < 6) tips.push({ text: `Você tem ultimate e ${opp.champion} ainda não — boa janela para all-in.` });
    }
  }

  // ---- matchup (OP.GG) ----
  let matchup = null;
  if (me && opp && me.position && ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(me.position)) {
    const m = matchupFor(me.position, opp.champion, me.champion);
    if (m && !m.loading && !m.error) {
      const vs = m.opponents?.find((o) => o.championId === opp.championId);
      matchup = {
        winRate: vs?.winRate ?? null, games: vs?.games ?? null,
        tip: m.tip, laneAdvantage: m.laneAdvantage, playStyle: m.playStyle,
        core: m.core?.ids || [], runes: m.runes ? { keystone: m.runes.keystone, secondary: m.runes.secondary } : null,
      };
    } else matchup = m?.error ? { error: m.error } : { loading: true };
  }

  cache = {
    time: t,
    at: Date.now(),
    mode: d.gameData.gameMode,
    myTeam,
    me: me ? { ...me, gold: Math.floor(d.activePlayer.currentGold || 0) } : null,
    opponent: opp,
    players,
    teams,
    timers: { nextDragon: nextDragon > t ? nextDragon : null, nextBaron: t >= 840 && nextBaron > t ? nextBaron : null },
    magicShare,
    tips,
    matchup,
    kills: kills.slice(-6).reverse(),
  };
  cachedAt = Date.now();
  return cache;
}

// Dados estáticos do jogo (Data Dragon) usados pelo servidor
const DD = 'https://ddragon.leagueoflegends.com';
let cache = null;
let cachedAt = 0;

export async function gameData() {
  if (cache && Date.now() - cachedAt < 6 * 3600 * 1000) return cache;
  const [version] = await (await fetch(`${DD}/api/versions.json`)).json();
  const [champs, summs, items] = await Promise.all([
    fetch(`${DD}/cdn/${version}/data/pt_BR/champion.json`).then((r) => r.json()),
    fetch(`${DD}/cdn/${version}/data/pt_BR/summoner.json`).then((r) => r.json()),
    fetch(`${DD}/cdn/${version}/data/pt_BR/item.json`).then((r) => r.json()),
  ]);
  const byKey = {};
  const byId = {};
  for (const c of Object.values(champs.data)) {
    const info = { id: c.id, key: Number(c.key), name: c.name, tags: c.tags, attack: c.info.attack, magic: c.info.magic };
    byKey[c.key] = info;
    byId[c.id.toLowerCase()] = info;
  }
  const spells = {};
  for (const s of Object.values(summs.data)) {
    if (s.modes.includes('CLASSIC') || s.modes.includes('ARAM')) spells[s.key] = { id: Number(s.key), name: s.name, image: s.image.full, modes: s.modes };
  }
  const itemMap = {};
  for (const [id, it] of Object.entries(items.data)) {
    itemMap[id] = { id: Number(id), name: it.name, gold: it.gold.total, tags: it.tags || [], completed: it.gold.total >= 2000 && !(it.into && it.into.length) };
  }
  cache = { version, champions: byKey, championsById: byId, spells, items: itemMap };
  cachedAt = Date.now();
  return cache;
}

export async function championName(key) {
  const d = await gameData();
  return d.champions[String(key)]?.name || null;
}

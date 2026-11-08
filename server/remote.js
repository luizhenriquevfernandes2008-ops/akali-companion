// Acesso pelo celular na mesma rede Wi-Fi.
// Desativado por padrão; quando ativo, quem não está no próprio PC precisa do token secreto
// (vem embutido no QR code e depois fica salvo num cookie no celular).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { DATA_DIR } from './riot.js';

const FILE = path.join(DATA_DIR, 'remote.json');
const newToken = () => crypto.randomBytes(24).toString('base64url');

let cfg = { enabled: false, token: newToken() };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* primeira vez */ }
const save = () => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cfg)); };
save();

export const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function tokenOk(t) {
  if (!t) return false;
  const a = Buffer.from(String(t));
  const b = Buffer.from(cfg.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookieToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)ac_t=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Bloqueia acesso de outros aparelhos, a menos que o remoto esteja ativo e o token seja válido. */
export function guard(req, res, next) {
  if (isLoopback(req)) return next();
  if (!cfg.enabled) return res.status(403).type('text').send('Controle pelo celular desativado. Ative em Configurações no app do PC.');
  const fromQuery = req.query.t;
  if (tokenOk(fromQuery)) {
    res.setHeader('Set-Cookie', `ac_t=${encodeURIComponent(fromQuery)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    return next();
  }
  if (tokenOk(cookieToken(req)) || tokenOk(req.headers['x-remote-token'])) return next();
  res.status(401).type('text').send('Acesso negado. Escaneie o QR code de novo no app do PC (Configurações).');
}

/** Rotas que só o próprio PC pode usar (chave da Riot, token do celular). */
export function localOnly(req, res, next) {
  if (isLoopback(req)) return next();
  res.status(403).json({ error: 'Disponível só no PC' });
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier/i.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ name, address: a.address, priv });
    }
  }
  // redes privadas (Wi-Fi/cabo de casa) primeiro
  return out.sort((x, y) => Number(y.priv) - Number(x.priv) || (/wi-?fi|wlan|sem fio/i.test(y.name) ? 1 : 0) - (/wi-?fi|wlan|sem fio/i.test(x.name) ? 1 : 0));
}

export async function info(port) {
  const ips = lanAddresses();
  const urls = ips.map((ip) => ({ name: ip.name, url: `http://${ip.address}:${port}/m?t=${cfg.token}` }));
  const qr = urls[0]
    ? await QRCode.toString(urls[0].url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0912', light: '#ffffff' } })
    : null;
  return { enabled: cfg.enabled, urls, qr };
}

export function setEnabled(enabled) { cfg.enabled = Boolean(enabled); save(); }
export function regenerate() { cfg.token = newToken(); save(); }

// Configurações do app de desktop: overlay, atalhos globais e replay (últimos N segundos).
// O processo do Electron (electron/main.js) escuta o "bus" para reaplicar atalhos e janelas.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './riot.js';

const FILE = path.join(DATA_DIR, 'desktop-settings.json');

export const DEFAULTS = {
  overlayShortcut: 'Control+Shift+A', // mostra/esconde o overlay
  clipShortcut: 'Control+Shift+S',    // salva os últimos N segundos
  overlayAutoShow: true,              // abre o overlay sozinho quando a partida começa
  overlaySide: 'right',               // 'right' | 'left'
  overlayScale: 1,                    // 0.8 – 1.4
  replayMode: 'game',                 // 'game' (só nas partidas) | 'always' (com o app aberto) | 'off'
  replaySeconds: 30,                  // 15 | 30 | 60 | 90
  replayFps: 60,                      // 30 | 60
  replayMonitor: 0,                   // índice do monitor (0 = principal)
  replayQuality: 'high',              // 'medium' | 'high'
  replayAudio: '',                    // nome do dispositivo de áudio (DirectShow) ou '' = sem áudio
};

export const bus = new EventEmitter();
// preenchido pelo Electron: se cada atalho conseguiu ser registrado
export const runtime = { desktop: false, shortcuts: {}, overlayVisible: false };

let settings = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

const ACCEL = /^((Control|Alt|Shift|Super)\+){0,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|num[0-9]|numadd|numsub|nummult|numdiv|numdec|[`\-=[\];',./\\])$/;
const pick = (v, list, def) => (list.includes(v) ? v : def);

function sanitize(input) {
  const out = { ...settings };
  for (const k of ['overlayShortcut', 'clipShortcut']) {
    if (k in input) out[k] = input[k] === '' ? '' : ACCEL.test(String(input[k])) ? String(input[k]) : out[k];
  }
  if ('overlayAutoShow' in input) out.overlayAutoShow = Boolean(input.overlayAutoShow);
  if ('overlaySide' in input) out.overlaySide = pick(input.overlaySide, ['right', 'left'], out.overlaySide);
  if ('overlayScale' in input) out.overlayScale = Math.min(1.4, Math.max(0.8, Number(input.overlayScale) || 1));
  if ('replayMode' in input) out.replayMode = pick(input.replayMode, ['game', 'always', 'off'], out.replayMode);
  if ('replaySeconds' in input) out.replaySeconds = pick(Number(input.replaySeconds), [15, 30, 60, 90], out.replaySeconds);
  if ('replayFps' in input) out.replayFps = pick(Number(input.replayFps), [30, 60], out.replayFps);
  if ('replayMonitor' in input) out.replayMonitor = Math.min(7, Math.max(0, Math.floor(Number(input.replayMonitor) || 0)));
  if ('replayAudio' in input) out.replayAudio = String(input.replayAudio || '').slice(0, 200);
  if ('replayQuality' in input) out.replayQuality = pick(input.replayQuality, ['medium', 'high'], out.replayQuality);
  return out;
}

export const getSettings = () => ({ ...settings });

export function setSettings(input) {
  const prev = settings;
  settings = sanitize(input || {});
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('[desktop] não salvou as configurações:', e.message); }
  bus.emit('settings', settings, prev);
  return getSettings();
}

/** Ações pedidas pela interface que só o processo do Electron sabe fazer. */
export function request(type, params = {}) {
  bus.emit('request', type, params);
}

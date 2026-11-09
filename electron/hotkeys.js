// Atalhos globais que funcionam com o League em primeiro plano.
//
// O globalShortcut do Electron usa RegisterHotKey, e o cliente da partida do LoL lê o teclado
// via Raw Input com hotkeys de aplicativo desligadas — então, dentro da partida, o atalho
// simplesmente não chega. Um hook de teclado de baixo nível (uiohook) enxerga as teclas antes
// do jogo, igual ao push-to-talk do Discord. Se o hook não carregar, cai no globalShortcut.
import { createRequire } from 'node:module';
import { globalShortcut } from 'electron';

const require = createRequire(import.meta.url);

let hook = null;   // { uIOhook, UiohookKey }
let hookError = null;
try {
  hook = require('uiohook-napi');
} catch (e) {
  hookError = e.message;
}

// nome da tecla no accelerator do Electron → nome no UiohookKey
const NAMED = {
  Space: 'Space', Tab: 'Tab', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Backspace: 'Backspace',
  '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', ';': 'Semicolon', "'": 'Quote',
  ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash',
  numadd: 'NumpadAdd', numsub: 'NumpadSubtract', nummult: 'NumpadMultiply', numdiv: 'NumpadDivide', numdec: 'NumpadDecimal',
};

function parse(accel) {
  const parts = String(accel).split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  let name;
  if (/^[A-Z0-9]$/.test(key)) name = key;
  else if (/^F\d{1,2}$/.test(key)) name = key;
  else if (/^num\d$/.test(key)) name = `Numpad${key.slice(3)}`;
  else name = NAMED[key];
  const keycode = name != null ? hook?.UiohookKey[name] : undefined;
  if (keycode == null) return null;
  return {
    keycode,
    ctrl: mods.has('Control'), alt: mods.has('Alt'), shift: mods.has('Shift'), meta: mods.has('Super'),
  };
}

let bindings = [];          // { combo, fn }
let paused = false;
let started = false;
const held = new Set();     // evita disparar várias vezes enquanto a tecla fica segurada

function onKeyDown(e) {
  if (paused) return;
  if (held.has(e.keycode)) return;
  held.add(e.keycode);
  for (const { combo, fn } of bindings) {
    if (e.keycode === combo.keycode && e.ctrlKey === combo.ctrl && e.altKey === combo.alt
      && e.shiftKey === combo.shift && e.metaKey === combo.meta) {
      try { fn(); } catch (err) { console.error('[hotkeys]', err.message); }
    }
  }
}
function onKeyUp(e) { held.delete(e.keycode); }

function ensureHook() {
  if (started || !hook) return started;
  try {
    hook.uIOhook.on('keydown', onKeyDown);
    hook.uIOhook.on('keyup', onKeyUp);
    hook.uIOhook.start();
    started = true;
  } catch (e) {
    hookError = e.message;
    hook = null;
  }
  return started;
}

/**
 * Registra os atalhos. `list` = [[chave, accelerator, fn], ...].
 * Retorna { chave: { ok, accel, paused, empty?, via } } para a tela de Configurações.
 */
export function setHotkeys(list, { pause = false } = {}) {
  paused = pause;
  bindings = [];
  held.clear();
  globalShortcut.unregisterAll();
  const result = {};
  const useHook = ensureHook();
  for (const [key, accel, fn] of list) {
    if (!accel) { result[key] = { ok: false, accel: '', empty: true }; continue; }
    const combo = useHook ? parse(accel) : null;
    if (combo) {
      bindings.push({ combo, fn });
      result[key] = { ok: true, accel, paused: pause, via: 'hook' };
      continue;
    }
    // sem hook (ou tecla que ele não conhece): atalho do sistema, que pode não funcionar dentro da partida
    let ok = false;
    if (!pause) {
      try { ok = globalShortcut.register(accel, fn); } catch { ok = false; }
    }
    result[key] = { ok: ok || pause, accel, paused: pause, via: 'system' };
  }
  if (hookError) console.error('[hotkeys] hook indisponível:', hookError);
  return result;
}

export function stopHotkeys() {
  globalShortcut.unregisterAll();
  if (started) { try { hook.uIOhook.stop(); } catch { /* já parado */ } started = false; }
}

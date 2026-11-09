// Processo principal do app de desktop (Electron)
import { app, BrowserWindow, Menu, shell, globalShortcut, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dados graváveis (chave, cache de partidas, histórico de maestria) ficam em %APPDATA%\Akali Companion
process.env.AKALI_DATA_DIR = app.getPath('userData');
process.env.AKALI_VIDEOS_DIR = app.getPath('videos');
process.env.AKALI_DESKTOP = '1';

// porta fixa: mantém as preferências salvas (skin de fundo, conta) entre aberturas
const PREFERRED_PORT = 39784;
const GAME_PHASES = ['GameStart', 'InProgress', 'Reconnect'];
const STOP_DELAY = 45000; // continua gravando um pouco depois da partida (dá pra salvar a explosão do Nexus)

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let overlay;
let origin;
let desktop;
let recorder;
let live;

// ---------------- overlay ----------------
const ov = { wanted: false, auto: false, flashing: false, flashTimer: null };

function overlayBounds() {
  const s = desktop.getSettings();
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  const w = Math.round(330 * s.overlayScale);
  // faixa lateral entre o placar (topo) e o minimapa (canto inferior)
  const top = y + Math.round(height * 0.2);
  const h = Math.round(height * 0.56);
  const left = s.overlaySide === 'left' ? x + 12 : x + width - w - 12;
  return { x: left, y: top, width: w, height: h };
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // nunca rouba o foco do jogo
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Akali Companion · Overlay',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true); // cliques passam direto para o jogo
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.on('did-finish-load', () => overlay.webContents.setZoomFactor(desktop.getSettings().overlayScale));
  overlay.loadURL(`${origin}/overlay.html`);
  // alguns jogos sobem a própria janela de vez em quando: reafirma o overlay por cima
  setInterval(() => { if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.moveTop(); }, 2500);
}

function updateOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const visible = ov.wanted || ov.flashing;
  if (visible && !overlay.isVisible()) {
    overlay.setBounds(overlayBounds());
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
  } else if (!visible && overlay.isVisible()) overlay.hide();
  desktop.runtime.overlayVisible = ov.wanted;
}

function toggleOverlay() {
  ov.wanted = !ov.wanted;
  ov.auto = false;
  ov.flashing = false;
  clearTimeout(ov.flashTimer);
  updateOverlay();
}

/** Mostra o overlay por alguns segundos (aviso de replay salvo com ele escondido). */
function flashOverlay(ms = 4000) {
  if (ov.wanted) return;
  ov.flashing = true;
  updateOverlay();
  clearTimeout(ov.flashTimer);
  ov.flashTimer = setTimeout(() => { ov.flashing = false; updateOverlay(); }, ms);
}

// ---------------- atalhos globais ----------------
let shortcutsPaused = false;

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const s = desktop.getSettings();
  const result = {};
  for (const [key, accel, fn] of [['overlay', s.overlayShortcut, toggleOverlay], ['clip', s.clipShortcut, saveClip]]) {
    if (!accel) { result[key] = { ok: false, accel: '', empty: true }; continue; }
    let ok = false;
    if (!shortcutsPaused) {
      try { ok = globalShortcut.register(accel, fn); } catch { ok = false; }
    }
    result[key] = { ok: ok || shortcutsPaused, accel, paused: shortcutsPaused };
  }
  desktop.runtime.shortcuts = result;
}

// ---------------- replay ----------------
let inGame = false;
let lastState = null;
let stopTimer = null;

function applyReplay({ delayed = false } = {}) {
  const s = desktop.getSettings();
  const want = s.replayMode === 'always' || (s.replayMode === 'game' && inGame);
  if (want) {
    clearTimeout(stopTimer); stopTimer = null;
    const st = recorder.status();
    if (!st.recording && !st.starting) {
      // sem FFmpeg não tenta (a tela de Configurações oferece instalar)
      recorder.findFfmpeg().then((f) => f && recorder.startBuffer()).catch((e) => console.error('[replay]', e.message));
    }
  } else if (recorder.status().recording) {
    clearTimeout(stopTimer);
    if (delayed) stopTimer = setTimeout(() => { stopTimer = null; recorder.stopBuffer(); }, STOP_DELAY);
    else recorder.stopBuffer();
  }
}

async function saveClip() {
  const champ = lastState?.live?.me?.champion || lastState?.game?.championName || '';
  try {
    await recorder.saveClip({ label: champ });
    shell.beep();
  } catch (e) {
    console.error('[replay]', e.message);
  }
  flashOverlay();
}

function onLiveState(st) {
  lastState = st;
  const nowIn = Boolean(st.connected && GAME_PHASES.includes(st.phase));
  if (nowIn === inGame) return;
  inGame = nowIn;
  const s = desktop.getSettings();
  if (inGame && s.overlayAutoShow && !ov.wanted) { ov.wanted = true; ov.auto = true; updateOverlay(); }
  if (!inGame && ov.auto) { ov.wanted = false; ov.auto = false; updateOverlay(); }
  applyReplay({ delayed: !inGame });
}

function onRequest(type, params = {}) {
  switch (type) {
    case 'toggle-overlay': toggleOverlay(); break;
    case 'save-clip': saveClip(); break;
    case 'replay-start': recorder.startBuffer().catch((e) => console.error('[replay]', e.message)); break;
    case 'replay-stop': clearTimeout(stopTimer); recorder.stopBuffer(); break;
    case 'ffmpeg-ready': applyReplay(); break;
    case 'pause-shortcuts': shortcutsPaused = true; registerShortcuts(); break;
    case 'resume-shortcuts': shortcutsPaused = false; registerShortcuts(); break;
    case 'open-clips': {
      const dir = recorder.clipsDir();
      fs.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
      break;
    }
    case 'open-clip': {
      const file = path.join(recorder.clipsDir(), path.basename(String(params.name || '')));
      if (fs.existsSync(file)) shell.showItemInFolder(file);
      break;
    }
    default: break;
  }
}

// ---------------- janela principal ----------------
async function createWindow() {
  // importa o servidor só depois de definir AKALI_DATA_DIR
  const { start } = await import('../server/index.js');
  desktop = await import('../server/desktop.js');
  recorder = await import('../server/recorder.js');
  live = await import('../server/live.js');
  desktop.runtime.desktop = true;

  const port = await start(PREFERRED_PORT);
  origin = `http://127.0.0.1:${port}`;

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Akali Companion',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#07060d',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f1edf9', height: 34 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  win.once('ready-to-show', () => win.show());
  // o overlay é outra janela: fechar a principal encerra o app inteiro
  win.on('closed', () => { win = null; app.quit(); });

  // links externos (OP.GG, YouTube, portal da Riot) abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  await win.loadURL(`${origin}/`);

  createOverlay();
  registerShortcuts();
  desktop.bus.on('settings', (s, prev) => {
    if (s.overlayShortcut !== prev.overlayShortcut || s.clipShortcut !== prev.clipShortcut) registerShortcuts();
    if (overlay && !overlay.isDestroyed()) {
      overlay.setBounds(overlayBounds());
      overlay.webContents.setZoomFactor(s.overlayScale);
    }
    const rec = ['replayFps', 'replayMonitor', 'replayQuality', 'replayAudio'].some((k) => s[k] !== prev[k]);
    if (rec && recorder.status().recording) recorder.stopBuffer().then(() => applyReplay());
    else if (s.replayMode !== prev.replayMode) applyReplay();
  });
  desktop.bus.on('request', onRequest);
  live.watch(onLiveState);
  applyReplay();
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow().catch((e) => {
    console.error(e);
    app.quit();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  recorder?.stopBuffer();
});
app.on('window-all-closed', () => app.quit());

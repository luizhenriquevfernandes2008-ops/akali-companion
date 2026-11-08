// Processo principal do app de desktop (Electron)
import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dados graváveis (chave, cache de partidas, histórico de maestria) ficam em %APPDATA%\Akali Companion
process.env.AKALI_DATA_DIR = app.getPath('userData');
process.env.AKALI_DESKTOP = '1';

// porta fixa: mantém as preferências salvas (skin de fundo, conta) entre aberturas
const PREFERRED_PORT = 39784;

if (!app.requestSingleInstanceLock()) app.quit();

let win;

async function createWindow() {
  // importa o servidor só depois de definir AKALI_DATA_DIR
  const { start } = await import('../server/index.js');
  const port = await start(PREFERRED_PORT);
  const origin = `http://127.0.0.1:${port}`;

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

app.on('window-all-closed', () => app.quit());

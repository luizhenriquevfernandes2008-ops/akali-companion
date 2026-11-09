// Replay estilo "instant replay": o FFmpeg grava a tela o tempo todo em pedaços de 2 s
// (buffer circular numa pasta temporária) e, ao apertar o atalho, junta os últimos N segundos
// num .mp4 sem recodificar. Usa o encoder da placa de vídeo (NVENC / AMF / QuickSync) quando existe.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './riot.js';
import { getSettings } from './desktop.js';

const SEG = 2; // segundos por pedaço
const BIN_DIR = path.join(DATA_DIR, 'ffmpeg');
const BUF_DIR = path.join(os.tmpdir(), 'akali-companion-replay');
export const clipsDir = () => process.env.AKALI_VIDEOS_DIR
  ? path.join(process.env.AKALI_VIDEOS_DIR, 'Akali Companion')
  : path.join(os.homedir(), 'Videos', 'Akali Companion');

// builds oficiais recomendadas pelo ffmpeg.org para Windows (com NVENC, AMF, QSV e ddagrab)
const DOWNLOADS = [
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
];

const state = {
  ffmpeg: null,          // caminho do ffmpeg.exe
  encoder: null,         // encoder escolhido
  download: null,        // { progress, error }
  proc: null,
  recording: false,
  source: null,          // 'ddagrab' | 'gdigrab'
  startedAt: 0,
  error: null,
  lastClip: null,        // { file, at, seconds } ou { error, at }
  saving: false,
  log: [],
};

// ---------------- localizar / baixar o FFmpeg ----------------
function run(bin, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, out: e.message }); }
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

async function works(bin) {
  if (!bin) return false;
  const r = await run(bin, ['-hide_banner', '-version'], { timeout: 8000 });
  return r.code === 0 && /ffmpeg version/i.test(r.out);
}

export async function findFfmpeg() {
  if (state.ffmpeg && fs.existsSync(state.ffmpeg)) return state.ffmpeg;
  const candidates = [process.env.AKALI_FFMPEG, path.join(BIN_DIR, 'ffmpeg.exe')];
  const where = await run('where', ['ffmpeg'], { timeout: 5000 });
  if (where.code === 0) candidates.push(...where.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  // instalado pelo winget com o app já aberto (o PATH deste processo ainda não tem a pasta nova)
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet');
  candidates.push(path.join(winget, 'Links', 'ffmpeg.exe'));
  const pkgs = path.join(winget, 'Packages');
  try {
    for (const d of await fsp.readdir(pkgs)) {
      if (/ffmpeg/i.test(d)) { const f = await findFile(path.join(pkgs, d), 'ffmpeg.exe').catch(() => null); if (f) candidates.push(f); }
    }
  } catch { /* sem winget */ }
  for (const c of candidates) {
    if (c && fs.existsSync(c) && (await works(c))) { state.ffmpeg = c; return c; }
  }
  return null;
}

async function findFile(dir, name) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = await findFile(p, name); if (f) return f; } else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

/** Baixa o FFmpeg para %APPDATA%\Akali Companion\ffmpeg (uma vez só). */
export async function downloadFfmpeg() {
  if (state.download && !state.download.error && !state.download.done) return; // já baixando
  state.download = { progress: 0, via: 'winget' };
  // 1º: winget (gerenciador de pacotes oficial do Windows 11)
  const wg = await run('winget', ['install', '--id', 'Gyan.FFmpeg.Essentials', '-e', '--silent',
    '--accept-source-agreements', '--accept-package-agreements'], { timeout: 600000 });
  state.ffmpeg = null; state.encoder = null;
  if (await findFfmpeg()) { state.download = { progress: 1, done: true }; return; }
  pushLog(`[winget] ${wg.out.trim().split(/\r?\n/).pop() || 'indisponível'}`);
  // 2º: download direto da build recomendada pelo ffmpeg.org
  state.download = { progress: 0, via: 'download' };
  const tmp = path.join(os.tmpdir(), `akali-ffmpeg-${Date.now()}`);
  let lastErr = null;
  try {
    await fsp.mkdir(tmp, { recursive: true });
    for (const url of DOWNLOADS) {
      try {
        const zip = path.join(tmp, 'ffmpeg.zip');
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length')) || 0;
        let got = 0;
        const body = Readable.fromWeb(res.body);
        body.on('data', (c) => { got += c.length; if (total) state.download.progress = Math.min(0.95, got / total); });
        await pipeline(body, fs.createWriteStream(zip));
        // tar.exe do Windows 10/11 também extrai .zip
        const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        const x = await run(tar, ['-xf', zip, '-C', tmp], { timeout: 180000 });
        if (x.code !== 0) throw new Error(`não consegui extrair (${x.out.trim().slice(0, 120)})`);
        const exe = await findFile(tmp, 'ffmpeg.exe');
        if (!exe) throw new Error('ffmpeg.exe não veio no pacote');
        await fsp.mkdir(BIN_DIR, { recursive: true });
        await fsp.copyFile(exe, path.join(BIN_DIR, 'ffmpeg.exe'));
        state.ffmpeg = null; state.encoder = null;
        if (!(await findFfmpeg())) throw new Error('o ffmpeg baixado não abriu');
        state.download = { progress: 1, done: true };
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('falha no download');
  } catch (e) {
    state.download = { error: e.message };
    throw e;
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------- encoder ----------------
const ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'];

async function pickEncoder(ffmpeg) {
  if (state.encoder) return state.encoder;
  for (const enc of ENCODERS) {
    const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30',
      '-frames:v', '10', '-pix_fmt', 'yuv420p', '-c:v', enc, '-f', 'null', '-'], { timeout: 15000 });
    if (r.code === 0) { state.encoder = enc; return enc; }
  }
  throw new Error('nenhum encoder de vídeo funcionou');
}

function encoderArgs(enc, fps, quality) {
  const q = quality === 'medium';
  const gop = ['-g', String(fps), '-keyint_min', String(fps)];
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', enc, '-preset', 'p4', '-rc', 'vbr', '-cq', q ? '27' : '22', '-b:v', '0', '-bf', '0', ...gop];
    case 'h264_amf': return ['-c:v', enc, '-quality', 'speed', '-rc', 'cqp', '-qp_i', q ? '26' : '21', '-qp_p', q ? '28' : '23', ...gop];
    case 'h264_qsv': return ['-c:v', enc, '-preset', 'veryfast', '-global_quality', q ? '27' : '22', ...gop];
    default: return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', q ? '27' : '22', ...gop];
  }
}

function captureArgs(source, enc, { fps, monitor }) {
  const hwFmt = enc === 'libx264' ? 'yuv420p' : 'nv12';
  if (source === 'ddagrab') {
    // Desktop Duplication: captura direto na GPU (leve, pega jogo em tela cheia sem bordas)
    const input = ['-f', 'lavfi', '-i', `ddagrab=output_idx=${monitor}:framerate=${fps}:draw_mouse=1`];
    return enc === 'h264_nvenc' ? input : [...input, '-vf', `hwdownload,format=bgra,format=${hwFmt}`];
  }
  return ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', 'desktop', '-vf', `format=${hwFmt}`];
}

// ---------------- áudio (DirectShow) ----------------
let audioCache = null;
/** Dispositivos de áudio que o FFmpeg enxerga (microfones, "Mixagem estéreo", VB-Cable...). */
export async function listAudioDevices({ fresh = false } = {}) {
  if (audioCache && !fresh) return audioCache;
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return [];
  const r = await run(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 10000 });
  audioCache = [...r.out.matchAll(/"([^"]+)"\s*\(audio\)/g)].map((m) => m[1]);
  return audioCache;
}

// ---------------- buffer ----------------
const pushLog = (line) => { state.log.push(line); if (state.log.length > 30) state.log.shift(); };

async function spawnCapture(source) {
  const s = getSettings();
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error('FFmpeg não encontrado');
  const enc = await pickEncoder(ffmpeg);
  await fsp.rm(BUF_DIR, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(BUF_DIR, { recursive: true });
  const wrap = Math.ceil(90 / SEG) + 6; // guarda até 90 s + folga
  const audio = s.replayAudio && (await listAudioDevices()).includes(s.replayAudio) ? s.replayAudio : '';
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...captureArgs(source, enc, { fps: s.replayFps, monitor: s.replayMonitor }),
    ...(audio ? ['-thread_queue_size', '1024', '-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${audio}`] : []),
    ...(audio ? ['-map', '0:v', '-map', '1:a'] : []),
    ...encoderArgs(enc, s.replayFps, s.replayQuality),
    ...(audio ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    '-f', 'segment', '-segment_time', String(SEG), '-segment_wrap', String(wrap), '-segment_format', 'mpegts', '-reset_timestamps', '1',
    path.join(BUF_DIR, 'seg%03d.ts'),
  ];
  const p = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(pushLog));
  return { p, enc, audio };
}

/** Liga o buffer de replay (não faz nada se já estiver ligado). */
export async function startBuffer() {
  if (state.proc || state.starting) return status();
  state.starting = true;
  state.error = null;
  try {
    for (const source of ['ddagrab', 'gdigrab']) {
      const { p, audio } = await spawnCapture(source);
      // se morrer nos primeiros segundos, a fonte não funciona nesta máquina: tenta a próxima
      const died = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 3500);
        p.once('exit', () => { clearTimeout(t); resolve(true); });
      });
      if (died) { pushLog(`[${source}] falhou ao iniciar`); continue; }
      state.proc = p; state.source = source; state.audio = audio; state.recording = true; state.startedAt = Date.now();
      p.once('exit', (code) => {
        if (state.proc !== p) return;
        state.proc = null; state.recording = false;
        if (!state.stopping) state.error = `a gravação parou sozinha (código ${code}). ${state.log.slice(-1)[0] || ''}`.trim();
        state.stopping = false;
      });
      return status();
    }
    throw new Error(`não consegui capturar a tela. ${state.log.slice(-1)[0] || ''}`.trim());
  } catch (e) {
    state.error = e.message;
    throw e;
  } finally {
    state.starting = false;
  }
}

export async function stopBuffer() {
  const p = state.proc;
  if (!p) return status();
  state.stopping = true;
  state.proc = null; state.recording = false;
  p.kill();
  return status();
}

const stamp = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
};

/** Junta os últimos N segundos do buffer num .mp4. */
export async function saveClip({ seconds = getSettings().replaySeconds, label = '' } = {}) {
  if (!state.recording) throw new Error('O replay não está gravando agora.');
  if (state.saving) throw new Error('Já estou salvando um replay.');
  state.saving = true;
  try {
    const files = (await fsp.readdir(BUF_DIR)).filter((f) => f.endsWith('.ts'));
    const stats = await Promise.all(files.map(async (f) => {
      const full = path.join(BUF_DIR, f);
      const st = await fsp.stat(full);
      return { full, mtime: st.mtimeMs, size: st.size };
    }));
    // mais novo primeiro; o primeiro ainda está sendo escrito (entra também, pega até "agora")
    const recent = stats.filter((s) => s.mtime >= state.startedAt - 1000 && s.size > 0).sort((a, b) => b.mtime - a.mtime);
    const take = recent.slice(0, Math.ceil(seconds / SEG) + 1).reverse();
    if (!take.length) throw new Error('O buffer ainda está vazio, espere alguns segundos.');

    const dir = clipsDir();
    await fsp.mkdir(dir, { recursive: true });
    const safe = String(label).replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-');
    const out = path.join(dir, `${safe ? `${safe}_` : 'Replay_'}${stamp()}.mp4`);
    const list = path.join(BUF_DIR, `list-${Date.now()}.txt`);
    await fsp.writeFile(list, take.map((t) => `file '${t.full.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const r = await run(state.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out], { timeout: 60000 });
    fsp.rm(list, { force: true }).catch(() => {});
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`o FFmpeg não conseguiu montar o vídeo (${r.out.trim().split(/\r?\n/).pop()})`);
    const dur = Math.min(seconds, Math.round((Date.now() - state.startedAt) / 1000));
    state.lastClip = { file: out, name: path.basename(out), at: Date.now(), seconds: dur };
    return state.lastClip;
  } catch (e) {
    state.lastClip = { error: e.message, at: Date.now() };
    throw e;
  } finally {
    state.saving = false;
  }
}

export async function listClips(limit = 8) {
  const dir = clipsDir();
  try {
    const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.mp4'));
    const st = await Promise.all(files.map(async (f) => ({ name: f, ...(await fsp.stat(path.join(dir, f))) })));
    return st.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit).map((s) => ({ name: s.name, size: s.size, at: s.mtimeMs }));
  } catch { return []; }
}

export function status() {
  return {
    ffmpeg: Boolean(state.ffmpeg),
    ffmpegPath: state.ffmpeg,
    encoder: state.encoder,
    download: state.download,
    recording: state.recording,
    starting: Boolean(state.starting),
    source: state.source,
    audio: state.audio || '',
    bufferedSeconds: state.recording ? Math.min(90, Math.round((Date.now() - state.startedAt) / 1000)) : 0,
    error: state.error,
    lastClip: state.lastClip,
    saving: state.saving,
    clipsDir: clipsDir(),
  };
}

export async function cleanup() {
  await stopBuffer();
  await fsp.rm(BUF_DIR, { recursive: true, force: true }).catch(() => {});
}

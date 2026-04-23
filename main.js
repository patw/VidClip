const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const PACKAGE = require('./package.json');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');

// Bundled ffmpeg/ffprobe binaries via ffmpeg-static / ffprobe-static.
// When packaged with asar, files listed in asarUnpack land in app.asar.unpacked/
// so we rewrite the path accordingly.
function unpackedPath(p) {
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}
const FFMPEG  = unpackedPath(require('ffmpeg-static'));
const FFPROBE = unpackedPath(require('ffprobe-static').path);

let mainWindow;
let serverPort = null;

// ── Local HTTP server for range-request-capable video serving ─────────────────
// The HTML5 video element needs HTTP range requests to seek. We serve local
// files through this server instead of file:// to ensure that works.
const CONTENT_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mts': 'video/mp2t', '.m2ts': 'video/mp2t', '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
};

const fileServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1`);
  const filePath = decodeURIComponent(url.searchParams.get('f') || '');

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let stat;
  try { stat = fs.statSync(filePath); } catch {
    res.writeHead(500); res.end('Stat failed'); return;
  }

  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'video/mp4';
  const rangeHeader = req.headers['range'];

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

fileServer.listen(0, '127.0.0.1', () => {
  serverPort = fileServer.address().port;
});

// ── IPC: get server port ──────────────────────────────────────────────────────
ipcMain.handle('get-server-port', () => serverPort);
ipcMain.handle('get-app-version', () => PACKAGE.version);

// ── Proxy transcoding ─────────────────────────────────────────────────────────
// When a codec isn't supported natively (e.g. HEVC/H.265), transcode to a
// temporary H.264 file for playback. The original file is always used for export.
const proxyDir = path.join(os.tmpdir(), 'vidclip-proxy');
fs.mkdirSync(proxyDir, { recursive: true });

let activeProxyProc = null;

ipcMain.handle('make-proxy', async (event, srcPath) => {
  // Kill any previous proxy transcode
  if (activeProxyProc) { try { activeProxyProc.kill(); } catch {} activeProxyProc = null; }

  const proxyPath = path.join(proxyDir, `proxy_${Date.now()}.mp4`);

  const args = [
    '-y',
    '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-c:a', 'aac', '-b:a', '128k',
    '-af', 'aformat=sample_fmts=fltp',
    '-movflags', '+faststart',
    proxyPath,
  ];

  return new Promise((resolve, reject) => {
    activeProxyProc = spawn(FFMPEG, args);
    let stderr = '';

    activeProxyProc.stderr.on('data', d => {
      const chunk = d.toString();
      stderr += chunk;
      const m = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) {
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        event.sender.send('proxy-progress', { secs });
      }
    });

    activeProxyProc.on('close', code => {
      activeProxyProc = null;
      if (code === 0) resolve(proxyPath);
      else reject(new Error(`Proxy transcode failed (code ${code})\n${stderr.slice(-1000)}`));
    });
    activeProxyProc.on('error', reject);
  });
});

ipcMain.handle('cancel-proxy', () => {
  if (activeProxyProc) { try { activeProxyProc.kill(); } catch {} activeProxyProc = null; }
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  // Open a file passed on the command line, e.g.: electron . /path/to/video.mp4
  mainWindow.webContents.once('did-finish-load', () => {
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    const filePath = args.find(a => !a.startsWith('-') && fs.existsSync(a));
    if (filePath) mainWindow.webContents.send('open-file-path', filePath);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Open / Save dialogs ───────────────────────────────────────────────────────
ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Video Files',
        extensions: ['mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
      },
    ],
  });
  if (canceled) return null;
  return filePaths[0];
});

ipcMain.handle('save-file', async (_, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'clip.mp4',
    filters: [
      { name: 'MP4', extensions: ['mp4'] },
      { name: 'MOV', extensions: ['mov'] },
      { name: 'MKV', extensions: ['mkv'] },
      { name: 'WebM', extensions: ['webm'] },
    ],
  });
  if (canceled) return null;
  return filePath;
});

// ── Probe video ───────────────────────────────────────────────────────────────
ipcMain.handle('probe-video', async (_, filePath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ]);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
});

// ── Export clip ───────────────────────────────────────────────────────────────
ipcMain.handle('export-clip', async (event, opts) => {
  const {
    inputPath, outputPath, inPoint, outPoint,
    videoCodec, audioCodec, resolution,
    audioBitrate, volumeFilter, crfValue, audioNormalize,
  } = opts;

  const duration = outPoint - inPoint;
  const args = ['-y', '-ss', String(inPoint), '-i', inputPath, '-t', String(duration)];

  if (videoCodec === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', videoCodec);
    if (crfValue != null && ['libx264', 'libx265', 'libvpx-vp9'].includes(videoCodec)) {
      if (videoCodec === 'libvpx-vp9') args.push('-crf', String(crfValue), '-b:v', '0');
      else args.push('-crf', String(crfValue));
    }
    if (resolution && resolution !== 'source') {
      args.push('-vf', `scale=${resolution}:flags=lanczos`);
    }
  }

  if (audioCodec === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:a', audioCodec);
    if (audioBitrate) args.push('-b:a', audioBitrate);
    const af = [];
    if (audioNormalize) af.push('loudnorm');
    if (volumeFilter && volumeFilter !== '1.0000') af.push(`volume=${volumeFilter}`);
    if (af.length) args.push('-af', af.join(','));
  }

  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.mp4' || ext === '.mov') {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let stderr = '';
    proc.stderr.on('data', data => {
      const chunk = data.toString();
      stderr += chunk;
      const m = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) {
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        const pct  = Math.min(100, Math.round((secs / duration) * 100));
        event.sender.send('export-progress', { pct, secs, total: duration });
      }
    });
    proc.on('close', code => {
      if (code === 0) resolve({ success: true, outputPath });
      else reject(new Error(`FFmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
    proc.on('error', reject);
  });
});

// ── Show in folder ────────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder', async (_, filePath) => {
  shell.showItemInFolder(filePath);
});

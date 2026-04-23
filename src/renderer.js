'use strict';

// ── Elements ──────────────────────────────────────────────────────────────────
const versionLabel = document.getElementById('version-label');
const video       = document.getElementById('video');
const dropOverlay = document.getElementById('drop-overlay');
const fileLabel   = document.getElementById('file-label');
const btnOpen     = document.getElementById('btn-open');
const btnPlay     = document.getElementById('btn-play');
const btnExport   = document.getElementById('btn-export');
const timeDisplay = document.getElementById('time-display');
const speedSelect = document.getElementById('speed-select');
const volumeSlider= document.getElementById('volume');
const timeline    = document.getElementById('timeline');
const playhead    = document.getElementById('playhead');
const btnIn       = document.getElementById('btn-in');
const btnOut      = document.getElementById('btn-out');
const btnClear    = document.getElementById('btn-clear');
const btnGotoIn   = document.getElementById('btn-goto-in');
const btnGotoOut  = document.getElementById('btn-goto-out');
const inDisplay   = document.getElementById('in-display');
const outDisplay  = document.getElementById('out-display');
const clipDur     = document.getElementById('clip-dur');

// Export dialog
const exportOverlay   = document.getElementById('export-overlay');
const btnCancelExport = document.getElementById('btn-cancel-export');
const btnRunExport    = document.getElementById('btn-run-export');
const btnBrowse       = document.getElementById('btn-browse');
const outPathInput    = document.getElementById('out-path');
const outFormat       = document.getElementById('out-format');
const vCodec          = document.getElementById('v-codec');
const crfSlider       = document.getElementById('crf-slider');
const crfVal          = document.getElementById('crf-val');
const vRes            = document.getElementById('v-res');
const aCodec          = document.getElementById('a-codec');
const aBitrate        = document.getElementById('a-bitrate');
const volBoost        = document.getElementById('vol-boost');
const volBoostVal     = document.getElementById('vol-boost-val');
const aNormalize      = document.getElementById('a-normalize');
const progressSection = document.getElementById('progress-section');
const progressBar     = document.getElementById('progress-bar');
const progressLabel   = document.getElementById('progress-label');
const rowCrf          = document.getElementById('row-crf');

// Proxy dialog
const proxyOverlay       = document.getElementById('proxy-overlay');
const proxyProgressBar   = document.getElementById('proxy-progress-bar');
const proxyProgressLabel = document.getElementById('proxy-progress-label');
const btnCancelProxy     = document.getElementById('btn-cancel-proxy');

// ── State ─────────────────────────────────────────────────────────────────────
let currentFile  = null;  // original file path (always used for export)
let inPoint      = null;
let outPoint     = null;
let duration     = 0;
let isDragging   = false;
let dragTarget   = null;
let serverPort   = null;
const ctx        = timeline.getContext('2d');

// Get the local HTTP server port from main process
window.api.getServerPort().then(p => { serverPort = p; });

// Display app version
window.api.getAppVersion().then(v => { versionLabel.textContent = `v${v}`; });

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n, len = 2) { return String(Math.floor(n)).padStart(len, '0'); }

function fmtTime(s) {
  if (s == null || isNaN(s)) return '--:--:--.---';
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms  = Math.round((s % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${String(ms).padStart(3, '0')}`;
}

function fmtDur(s) {
  if (s == null || isNaN(s) || s <= 0) return '';
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2);
  return h > 0 ? `${h}h ${pad(m)}m ${sec}s` : m > 0 ? `${pad(m)}m ${sec}s` : `${sec}s`;
}

function timeAtX(x) {
  const rect = timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  return ratio * duration;
}

function xForTime(t) {
  if (!duration) return 0;
  return (t / duration) * timeline.clientWidth;
}

function updateMarkerDisplays() {
  inDisplay.textContent  = fmtTime(inPoint);
  outDisplay.textContent = fmtTime(outPoint);
  const dur = (inPoint != null && outPoint != null) ? outPoint - inPoint : null;
  clipDur.textContent = dur != null && dur > 0 ? `Clip: ${fmtDur(dur)}` : '';
  const hasMarkers = inPoint != null && outPoint != null && outPoint > inPoint;
  btnExport.disabled  = !hasMarkers;
  btnClear.disabled   = inPoint == null && outPoint == null;
  btnGotoIn.disabled  = inPoint == null;
  btnGotoOut.disabled = outPoint == null;
}

function videoUrl(filePath) {
  return `http://127.0.0.1:${serverPort}?f=${encodeURIComponent(filePath)}`;
}

// ── Timeline drawing ──────────────────────────────────────────────────────────
function resizeTimeline() {
  const rect = timeline.parentElement.getBoundingClientRect();
  timeline.width = Math.floor(rect.width);
  drawTimeline();
}

function drawTimeline() {
  const W = timeline.width;
  const H = timeline.height;
  ctx.clearRect(0, 0, W, H);

  if (!duration) {
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#555';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No video loaded', W / 2, H / 2 + 4);
    return;
  }

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, W, H);

  // Tick marks
  const minTickSecs = duration / (W / 80);
  const niceIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const tickInterval = niceIntervals.find(i => i >= minTickSecs) || niceIntervals[niceIntervals.length - 1];

  ctx.strokeStyle = '#3a3a3a';
  ctx.fillStyle   = '#666';
  ctx.font        = '10px monospace';
  ctx.textAlign   = 'center';
  ctx.lineWidth   = 1;

  for (let t = 0; t <= duration; t += tickInterval) {
    const x = Math.round(xForTime(t));
    ctx.beginPath();
    ctx.moveTo(x + 0.5, H - 16);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
    if (x > 10 && x < W - 10) {
      ctx.fillStyle = '#666';
      ctx.fillText(fmtTime(t).slice(0, -4), x, H - 18);
    }
  }

  // Selected region
  if (inPoint != null && outPoint != null) {
    const ix = xForTime(inPoint);
    const ox = xForTime(outPoint);
    ctx.fillStyle = 'rgba(232, 93, 4, 0.2)';
    ctx.fillRect(ix, 0, ox - ix, H);
  }

  // In marker
  if (inPoint != null) {
    const ix = Math.round(xForTime(inPoint));
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(ix + 1, 0); ctx.lineTo(ix + 1, H);
    ctx.stroke();
    ctx.fillStyle = '#00c853';
    ctx.fillRect(ix + 1, 0, 20, 14);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('IN', ix + 3, 10);
  }

  // Out marker
  if (outPoint != null) {
    const ox = Math.round(xForTime(outPoint));
    ctx.strokeStyle = '#ff3d00';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 1, 0); ctx.lineTo(ox - 1, H);
    ctx.stroke();
    ctx.fillStyle = '#ff3d00';
    ctx.fillRect(ox - 22, 0, 22, 14);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('OUT', ox - 3, 10);
  }
}

function updatePlayhead() {
  if (!duration) return;
  playhead.style.left = `${(video.currentTime / duration) * 100}%`;
}

// ── Video event handlers ──────────────────────────────────────────────────────
let proxyInProgress = false;

// Codecs that Chromium/Electron cannot decode natively
const NEEDS_PROXY_CODECS = new Set([
  'hevc', 'h265',        // GoPro HERO 8+, most modern cameras
  'vc1', 'wmv3', 'wmv2', 'wmv1',
  'vp6', 'vp6f', 'flv1',
  'mpeg1video', 'mpeg2video',
  'rv40', 'rv30',
]);

async function startProxy(filePath, knownDuration = 0) {
  if (proxyInProgress) return;
  proxyInProgress = true;
  proxyOverlay.classList.remove('hidden');
  proxyProgressBar.style.width = '0%';
  proxyProgressLabel.textContent = 'Starting…';
  window.api.onProxyProgress(({ secs }) => {
    proxyProgressLabel.textContent = `Transcoding… ${fmtTime(secs)}`;
    if (knownDuration > 0) {
      const pct = Math.min(100, Math.round((secs / knownDuration) * 100));
      proxyProgressBar.style.width = `${pct}%`;
    }
  });
  try {
    const proxyPath = await window.api.makeProxy(filePath);
    window.api.offProxyProgress();
    proxyOverlay.classList.add('hidden');
    fileLabel.textContent = currentFile.split('/').pop() + ' [proxy]';
    proxyInProgress = false;
    video.src = videoUrl(proxyPath);
    video.load();
  } catch (err) {
    window.api.offProxyProgress();
    proxyInProgress = false;
    proxyOverlay.classList.add('hidden');
    fileLabel.textContent = `Error: ${err.message}`;
  }
}

video.addEventListener('loadedmetadata', () => {
  duration = video.duration;
  updateMarkerDisplays();
  drawTimeline();
  btnPlay.disabled = false;
  btnIn.disabled   = false;
  btnOut.disabled  = false;
  dropOverlay.classList.add('hidden');
  updateTimeDisplay();
});

video.addEventListener('error', async () => {
  if (!currentFile || proxyInProgress) return;
  // Native decode failed — transcode to H.264 proxy for playback
  await startProxy(currentFile, duration || 0);
});

// ── Load video ────────────────────────────────────────────────────────────────
async function loadFile(filePath) {
  proxyInProgress = false;
  currentFile     = filePath;
  inPoint         = null;
  outPoint        = null;
  duration        = 0;
  btnPlay.disabled = true;
  btnIn.disabled   = true;
  btnOut.disabled  = true;
  updateMarkerDisplays();

  fileLabel.textContent = filePath.split('/').pop();
  drawTimeline();

  // Wait until serverPort is known (it's set async on startup)
  if (!serverPort) serverPort = await window.api.getServerPort();

  // Probe codec upfront — skip native playback attempt for known-unsupported codecs
  // (e.g. GoPro H.265/HEVC: metadata loads fine but video renders black, no error event)
  try {
    const info = await window.api.probeVideo(filePath);
    const vs = info.streams.find(s => s.codec_type === 'video');
    if (vs && NEEDS_PROXY_CODECS.has(vs.codec_name?.toLowerCase())) {
      const dur = parseFloat(info.format?.duration) || 0;
      await startProxy(filePath, dur);
      return;
    }
  } catch { /* ignore probe errors; fall through to native attempt */ }

  video.src = videoUrl(filePath);
  video.load();
}

// ── Open file ─────────────────────────────────────────────────────────────────
btnOpen.addEventListener('click', async () => {
  const filePath = await window.api.openFile();
  if (filePath) loadFile(filePath);
});

// ── Drag and drop ─────────────────────────────────────────────────────────────
document.body.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
document.body.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  const file = e.dataTransfer.files[0];
  if (file) {
    const filePath = window.api.getFilePath(file);
    if (filePath) loadFile(filePath);
  }
});

// ── CLI / IPC file open ───────────────────────────────────────────────────────
window.api.onOpenFilePath(filePath => { if (filePath) loadFile(filePath); });

// ── Playback controls ─────────────────────────────────────────────────────────
btnPlay.addEventListener('click', togglePlay);
video.addEventListener('play',  () => { btnPlay.innerHTML = '&#9646;&#9646;'; });
video.addEventListener('pause', () => { btnPlay.innerHTML = '&#9654;'; });
video.addEventListener('ended', () => { btnPlay.innerHTML = '&#9654;'; });

function togglePlay() {
  if (!currentFile) return;
  video.paused ? video.play() : video.pause();
}

function updateTimeDisplay() {
  timeDisplay.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`;
}

video.addEventListener('timeupdate', () => {
  updateTimeDisplay();
  updatePlayhead();
  drawTimeline();
});

speedSelect.addEventListener('change', () => { video.playbackRate = parseFloat(speedSelect.value); });
volumeSlider.addEventListener('input', () => { video.volume = parseFloat(volumeSlider.value); });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (!currentFile) return;
  switch (e.key) {
    case ' ':        e.preventDefault(); togglePlay(); break;
    case 'i': case 'I': setInPoint();  break;
    case 'o': case 'O': setOutPoint(); break;
    case 'ArrowLeft':
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 1));
      break;
    case 'ArrowRight':
      e.preventDefault();
      video.currentTime = Math.min(duration, video.currentTime + (e.shiftKey ? 10 : 1));
      break;
    case 'j': video.playbackRate = Math.max(0.25, video.playbackRate - 0.25); speedSelect.value = video.playbackRate; break;
    case 'k': togglePlay(); break;
    case 'l': video.playbackRate = Math.min(4, video.playbackRate + 0.25); speedSelect.value = video.playbackRate; break;
  }
});

// ── In/Out markers ────────────────────────────────────────────────────────────
function setInPoint() {
  inPoint = video.currentTime;
  if (outPoint != null && inPoint >= outPoint) outPoint = null;
  updateMarkerDisplays(); drawTimeline();
}

function setOutPoint() {
  outPoint = video.currentTime;
  if (inPoint != null && outPoint <= inPoint) inPoint = null;
  updateMarkerDisplays(); drawTimeline();
}

btnIn.addEventListener('click', setInPoint);
btnOut.addEventListener('click', setOutPoint);

btnClear.addEventListener('click', () => {
  inPoint = null; outPoint = null;
  updateMarkerDisplays(); drawTimeline();
});

btnGotoIn.addEventListener('click',  () => { if (inPoint  != null) video.currentTime = inPoint; });
btnGotoOut.addEventListener('click', () => { if (outPoint != null) video.currentTime = outPoint; });

// ── Timeline mouse interaction ────────────────────────────────────────────────
const MARKER_GRAB_PX = 10;

function nearMarker(x) {
  if (!duration) return null;
  if (inPoint  != null && Math.abs(x - xForTime(inPoint))  < MARKER_GRAB_PX) return 'in';
  if (outPoint != null && Math.abs(x - xForTime(outPoint)) < MARKER_GRAB_PX) return 'out';
  return null;
}

timeline.addEventListener('mousedown', e => {
  if (!duration) return;
  e.preventDefault();
  const rect   = timeline.getBoundingClientRect();
  const x      = e.clientX - rect.left;
  const marker = nearMarker(x);
  isDragging   = true;
  dragTarget   = marker || 'playhead';
  if (!marker) video.currentTime = timeAtX(e.clientX);
});

window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const t = timeAtX(e.clientX);
  if (dragTarget === 'playhead') {
    video.currentTime = t;
  } else if (dragTarget === 'in') {
    inPoint = Math.max(0, Math.min(t, outPoint != null ? outPoint - 0.001 : duration));
    updateMarkerDisplays(); drawTimeline();
  } else if (dragTarget === 'out') {
    outPoint = Math.min(duration, Math.max(t, inPoint != null ? inPoint + 0.001 : 0));
    updateMarkerDisplays(); drawTimeline();
  }
});

window.addEventListener('mouseup', () => { isDragging = false; dragTarget = null; });

timeline.addEventListener('mousemove', e => {
  if (!duration) return;
  const rect = timeline.getBoundingClientRect();
  timeline.style.cursor = nearMarker(e.clientX - rect.left) ? 'ew-resize' : 'crosshair';
});

// ── Resize ────────────────────────────────────────────────────────────────────
const ro = new ResizeObserver(() => resizeTimeline());
ro.observe(timeline.parentElement);
resizeTimeline();

// ── Export dialog ─────────────────────────────────────────────────────────────
crfSlider.addEventListener('input', () => { crfVal.textContent = crfSlider.value; });
volBoost.addEventListener('input',  () => { volBoostVal.textContent = `${parseFloat(volBoost.value).toFixed(2)}x`; });

// VP9 cannot be written to the MOV container; switch to MP4 automatically
function enforceFormatCompatibility() {
  const codec = vCodec.value;
  const fmt = outFormat.value;
  if (codec === 'libvpx-vp9' && fmt === 'mov') {
    outFormat.value = 'mp4';
    const cur = outPathInput.value;
    if (cur) outPathInput.value = cur.replace(/\.[^.]+$/, `.${outFormat.value}`);
  }
}

vCodec.addEventListener('change', () => {
  const copy = vCodec.value === 'copy';
  rowCrf.style.opacity = copy ? '0.35' : '1';
  rowCrf.querySelector('input').disabled = copy;
  enforceFormatCompatibility();
});

outFormat.addEventListener('change', () => {
  const cur = outPathInput.value;
  if (cur) outPathInput.value = cur.replace(/\.[^.]+$/, `.${outFormat.value}`);
  enforceFormatCompatibility();
});

btnExport.addEventListener('click', () => {
  if (!currentFile || inPoint == null || outPoint == null) return;
  if (!outPathInput.value) {
    outPathInput.value = `${currentFile.replace(/\.[^.]+$/, '')}_clip.${outFormat.value}`;
  }
  progressSection.classList.add('hidden');
  progressBar.style.width = '0%';
  progressBar.style.background = '';
  exportOverlay.classList.remove('hidden');
});

btnCancelExport.addEventListener('click', () => {
  exportOverlay.classList.add('hidden');
  btnCancelExport.textContent = 'Cancel';
});

btnBrowse.addEventListener('click', async () => {
  const name = outPathInput.value ? outPathInput.value.split('/').pop() : `clip.${outFormat.value}`;
  const filePath = await window.api.saveFile(name);
  if (filePath) {
    outPathInput.value = filePath;
    const ext = filePath.split('.').pop().toLowerCase();
    const opt = outFormat.querySelector(`option[value="${ext}"]`);
    if (opt) outFormat.value = ext;
  }
});

btnCancelProxy.addEventListener('click', () => {
  if (!proxyInProgress) return;
  window.api.cancelProxy();
  window.api.offProxyProgress();
  proxyInProgress = false;
  proxyOverlay.classList.add('hidden');
  currentFile = null;
  fileLabel.textContent = 'No file loaded';
  video.src = '';
  dropOverlay.classList.remove('hidden');
  btnPlay.disabled = true;
  btnIn.disabled = true;
  btnOut.disabled = true;
  inPoint = null;
  outPoint = null;
  duration = 0;
  updateMarkerDisplays();
  drawTimeline();
});

btnRunExport.addEventListener('click', async () => {
  const outputPath = outPathInput.value.trim();
  if (!outputPath) { alert('Please choose an output file path.'); return; }

  const opts = {
    inputPath:     currentFile,   // always export from original
    outputPath,
    inPoint,
    outPoint,
    videoCodec:    vCodec.value,
    audioCodec:    aCodec.value,
    resolution:    vRes.value,
    audioBitrate:  aBitrate.value,
    crfValue:      parseInt(crfSlider.value),
    volumeFilter:  parseFloat(volBoost.value).toFixed(4),
    audioNormalize: aNormalize.checked,
    format:        outFormat.value,
  };

  btnRunExport.disabled    = true;
  btnCancelExport.disabled = true;
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Exporting…';
  progressBar.style.width   = '0%';

  window.api.onExportProgress(({ pct }) => {
    progressBar.style.width   = `${pct}%`;
    progressLabel.textContent = `Exporting… ${pct}%`;
  });

  try {
    const result = await window.api.exportClip(opts);
    progressBar.style.width   = '100%';
    progressLabel.textContent = `Done! ${result.outputPath}`;
    window.api.offExportProgress();
    btnRunExport.disabled    = false;
    btnCancelExport.disabled = false;
    btnCancelExport.textContent = 'Close';

    const reveal = confirm(`Export complete!\n${result.outputPath}\n\nShow in folder?`);
    if (reveal) window.api.showInFolder(result.outputPath);
    exportOverlay.classList.add('hidden');
    btnCancelExport.textContent = 'Cancel';
  } catch (err) {
    progressLabel.textContent    = `Error: ${err.message}`;
    progressBar.style.background = '#c62828';
    window.api.offExportProgress();
    btnRunExport.disabled    = false;
    btnCancelExport.disabled = false;
  }
});

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile:       ()       => ipcRenderer.invoke('open-file'),
  saveFile:       (name)   => ipcRenderer.invoke('save-file', name),
  probeVideo:     (p)      => ipcRenderer.invoke('probe-video', p),
  exportClip:     (opts)   => ipcRenderer.invoke('export-clip', opts),
  showInFolder:   (p)      => ipcRenderer.invoke('show-in-folder', p),
  getServerPort:  ()       => ipcRenderer.invoke('get-server-port'),
  getAppVersion:  ()       => ipcRenderer.invoke('get-app-version'),
  makeProxy:      (p)      => ipcRenderer.invoke('make-proxy', p),
  cancelProxy:    ()       => ipcRenderer.invoke('cancel-proxy'),

  getFilePath:      (file) => webUtils.getPathForFile(file),
  onOpenFilePath:   (cb)  => ipcRenderer.on('open-file-path', (_, p) => cb(p)),

  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_, d) => cb(d)),
  offExportProgress: ()  => ipcRenderer.removeAllListeners('export-progress'),
  onProxyProgress:  (cb) => ipcRenderer.on('proxy-progress', (_, d) => cb(d)),
  offProxyProgress: ()   => ipcRenderer.removeAllListeners('proxy-progress'),
});

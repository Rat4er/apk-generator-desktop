const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    generateApk: (args) => ipcRenderer.invoke('generate-apk', args)
});
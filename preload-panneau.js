// Pont du tableau de bord (météo).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('panneau', {
  getState: () => ipcRenderer.invoke('panel:state'),
  onUpdate: callback => ipcRenderer.on('panel:update', (_event, state) => callback(state)),
  setPlace: query => ipcRenderer.invoke('weather:set-place', String(query)),
  autoPlace: () => ipcRenderer.invoke('weather:auto-place'),
  close: () => ipcRenderer.send('panel:close'),
})

// Pont de l'écran de veille : une seule action, quitter (Windows verrouille alors la session).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('veille', {
  quit: () => ipcRenderer.send('veille:quit'),
})

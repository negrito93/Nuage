// Mode écran de veille : lancé par nuage.scr (Windows) avec l'argument --veille.
// Nuage dort en plein écran aux couleurs du thème ; au moindre mouvement on quitte et
// Windows verrouille la session (« À la reprise, afficher l'écran d'ouverture de session »).
const { app, BrowserWindow, screen, ipcMain, systemPreferences, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// Données séparées : le Nuage habituel peut tourner en même temps
app.setPath('userData', path.join(app.getPath('appData'), 'Nuage', 'veille'))

const windows = []
// Témoin « l'écran de veille tourne » pour le Nuage habituel (il ne le relance pas par-dessus)
const witness = path.join(app.getPath('appData'), 'Nuage', 'veille-en-cours.txt')
const beat = () => {
  try {
    fs.writeFileSync(witness, new Date().toISOString())
  } catch {
    // sans témoin, le Nuage habituel se contente du délai
  }
}
const quit = () => {
  try {
    fs.unlinkSync(witness)
  } catch {
    // déjà effacé
  }
  app.quit()
}
beat()
setInterval(beat, 5000)

app.whenReady().then(() => {
  const accent = String(systemPreferences.getAccentColor?.() || '3b82f6ff').slice(0, 6).toLowerCase()
  const dark = nativeTheme.shouldUseDarkColors
  const primary = screen.getPrimaryDisplay().id
  for (const display of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      fullscreen: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: dark ? '#06070b' : '#f5f7fb',
      title: 'Nuage : écran de veille',
      webPreferences: {
        preload: path.join(__dirname, 'preload-veille.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.once('ready-to-show', () => {
      win.show()
      win.moveTop()
      if (display.id === primary) win.focus()
    })
    win.loadFile(path.join(__dirname, 'renderer', 'veille.html'), {
      query: { accent, theme: dark ? 'dark' : 'light', principal: display.id === primary ? '1' : '0' },
    })
    windows.push(win)
  }

  if (process.env.NUAGE_AUTOTEST_DIR) {
    setTimeout(async () => {
      const image = await windows[0].webContents.capturePage()
      fs.writeFileSync(path.join(process.env.NUAGE_AUTOTEST_DIR, 'veille.png'), image.toPNG())
      quit()
    }, 4000)
  }
})

ipcMain.on('veille:quit', quit)
app.on('window-all-closed', quit)

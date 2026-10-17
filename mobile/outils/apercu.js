// Aperçus de l'interface du téléphone (mobile/www) avec le faux plugin, en PNG, à la taille d'un Pixel 7 Pro.
// Usage : node_modules\electron\dist\electron.exe mobile\outils\apercu.js <dossier de sortie>
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const www = path.join(__dirname, '..', 'www')
const out = path.resolve(process.argv[2] || path.join(__dirname, 'apercus'))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  let file = path.join(www, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(www)) return res.writeHead(403).end()
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// [nom du fichier, scénario du faux plugin, gestes avant la photo]
const SHOTS = [
  ['1-nuage', 'associe', ''],
  ['2-agents', 'agents', `document.querySelector('#tabbar [data-view="agents"]').click()`],
  ['3-session', 'agents', `document.querySelector('#tabbar [data-view="agents"]').click(); setTimeout(() => document.querySelector('#ag-sessions .ag-row').click(), 900)`],
  ['4-services', 'agents', `document.querySelector('#tabbar [data-view="services"]').click()`],
  ['5-chat', 'associe', `document.getElementById('ask-open').click()`],
  ['6-association', 'echec', ''],
]

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  for (const [name, scen, gestures] of SHOTS) {
    const win = new BrowserWindow({
      // Fenêtre affichée mais posée hors de l'écran (jamais sous les yeux ni sous la souris de l'utilisateur) : une
      // fenêtre cachée ne fait pas avancer les animations, les vues en fondu restaient à moitié transparentes
      show: true, x: -6000, y: 0, skipTaskbar: true, focusable: false, frame: false, width: 412, height: 892, useContentSize: true,
      webPreferences: { preload: path.join(__dirname, 'faux-lien-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
    })
    win.webContents.on('console-message', e => (e.level === 'error' || e.level === 3) && console.error(`${name} : ${e.message}`))
    await win.loadURL(`http://127.0.0.1:${port}/index.html?s=${scen}`)
    await pause(2600)
    if (gestures) await win.webContents.executeJavaScript(gestures)
    await pause(1400)
    fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    win.destroy()
  }
  server.close()
  console.log(`aperçus : ${out}`)
  app.exit(0)
})

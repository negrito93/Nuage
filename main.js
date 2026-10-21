// Nuage, compagnon de bureau : processus principal Electron.
// Fenêtre transparente toujours au premier plan, icône de la zone de notification,
// suivi du curseur, inactivité du PC, rappels.
const {
  app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, powerMonitor, globalShortcut, shell,
  session, desktopCapturer, systemPreferences, nativeTheme, dialog, Notification, clipboard, ClipboardItem,
} = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
// Dossiers de l'utilisateur : Windows peut ne pas en connaître un (dossier déplacé, profil neuf) et app.getPath
// lève alors une erreur, qui arrêtait tout le démarrage (19/10/2026 : essai de l'installeur sur un PC neuf)
const KNOWN_FOLDER = { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', pictures: 'Pictures', music: 'Music', videos: 'Videos' }
function userDir(name) {
  try {
    return app.getPath(name)
  } catch {
    return path.join(os.homedir(), KNOWN_FOLDER[name])
  }
}
// Écran de veille (lancé par nuage.scr) : programme à part, rien d'autre ne démarre
if (process.argv.includes('--veille')) {
  require('./veille-main')
  return
}

const meteo = require('./meteo')
const crypto = require('node:crypto')
const secrets = require('./secrets')
const { createAgentHub } = require('./agents')
const agentsPhone = require('./agents-telephone')
const { startServer, PORT } = require('./serveur')
const claudeConfig = require('./claude-config')
const extensions = require('./extensions')
const chatApi = require('./chat')
const actionsApi = require('./actions')
const abonnements = require('./abonnements')
const integrationsApi = require('./integrations')
const { createDownloadWatcher } = require('./telechargements')
const { createLink, lanAddresses, lanDetails } = require('./lien')
const voix = require('./voix')
const { createNaturalVoice, VOICES: NATURAL_VOICES, sentences } = require('./voix-naturelle')
let qrcodeLib = null // chargé à la première fenêtre « Ton téléphone » (0,4 s de moins au démarrage)
const QRCode = { toString: (...args) => (qrcodeLib ??= require('qrcode')).toString(...args) }

const SIZES = { petit: 150, moyen: 210, grand: 290 }
const MARGIN_X = 150 // place pour la bulle de part et d'autre de l'avatar
const MARGIN_TOP = 96 // place pour la bulle au-dessus
const SHORTCUT = 'Control+Alt+N'
const WEATHER_EVERY_MS = 10 * 60_000 // relevés des stations : toutes les 30 à 60 min
const PANEL_SIZE = { width: 400, height: 280 }

if (process.env.NUAGE_AUTOTEST_DIR) {
  app.setPath('userData', path.join(process.env.NUAGE_AUTOTEST_DIR, 'userdata'))
}
// Journal de diagnostic, seulement si NUAGE_DEBUG_LOG désigne un fichier
const debugLog = (...parts) => {
  if (process.env.NUAGE_DEBUG_LOG) fs.appendFileSync(process.env.NUAGE_DEBUG_LOG, `${new Date().toISOString()} ${parts.join(' ')}\n`)
}

// ---------- Réglages (%APPDATA%\Nuage\reglages.json) ----------
const DEFAULTS = {
  size: 'moyen',
  position: null,
  quiet: false,
  breakReminder: true,
  breakEveryMin: 50,
  waterReminder: true,
  waterEveryMin: 90,
  weatherOn: true,
  weatherLabel: true, // température écrite sur son ventre
  weatherPlace: null,
  downloadsOn: true, // il se remplit de vert pendant un téléchargement
  downloadToken: null, // code de l'extension de navigateur (extension-navigateur\jeton.json)
  extensionSeen: null, // date du premier contact de l'extension
  linkOn: false, // lien avec le téléphone (Nuage de poche) : serveur du réseau local ouvert
  linkAuto: false, // vrai une fois le lien allumé d'office (connexion automatique, 06/10/2026)
  clipboardShare: 'auto', // 'auto' : ce qui est copié sur le PC part vers le téléphone (sauf mots de passe) ; 'manuel'
  phoneNotifyClaude: true, // nouvelles de Claude Code (fini, attend ton accord) sur le téléphone
  phoneNotifyDownloads: true, // téléchargements terminés sur le téléphone
  voiceOn: true, // « Hey Nuage » écouté en continu (choix de l'utilisateur, 05/10/2026), hors ligne
  voiceReplies: true, // Nuage lit ses réponses à voix haute
  voiceName: 'siwis', // voix naturelle (voix-naturelle.js : siwis, jessica, pierre, tom) ; 'windows' = l'ancienne voix
  mediaOn: true,
  audioReactive: true,
  cinemaQuiet: true,
  feedOn: true,
  // Fonctions inspirées de Coucou : encoche, agents Claude Code, chat, intégrations, sons
  encocheOn: true,
  encochePos: null, // îlot déplacé : { cx, top } (centre du haut de la pilule) ; null = en haut au centre
  nuageHome: 'encoche', // où vit Nuage : 'encoche' (petit, dans la barre du haut, demande du 06/10/2026) ou 'bureau'
  autoHide: true,
  soundsOn: true,
  volume: 0.5,
  permissionsInNuage: true,
  claudeCodeWanted: false,
  claudeCodeStatusLine: null,
  nuageToken: null,
  chatProvider: 'claudecode', // Claude via l'abonnement (Claude Code), sans clé d'API
  chatModel: 'sonnet',
  chatEffort: '', // effort de réflexion (Gemini, ChatGPT par abonnement) ; '' = celui de l'IA
  lockScreenOn: false,
  lockScreenApplied: null,
  lockScreenOriginal: null,
  screensaverOn: false,
  screensaverDelay: 300,
  screensaverBefore: null,
  firstRun: true,
  shortcutsMade: false, // raccourcis du bureau et du menu Démarrer déjà créés (makeShortcuts)
  okToday: null, // autorisations données aujourd'hui (Claude Code) : { day, n } — chiffre du jour du téléphone
}
let settings = { ...DEFAULTS }
let firstLaunch = null
const settingsFile = () => path.join(app.getPath('userData'), 'reglages.json')

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    settings = { ...DEFAULTS }
  }
  if (!SIZES[settings.size]) settings.size = DEFAULTS.size
  firstLaunch ??= settings.firstRun // tout premier lancement : le choix de l'IA s'ouvre (start)
  // Auto-test : le scénario complet suit Nuage sur le bureau ; la partie « encoche » teste Nuage qui y habite
  if (process.env.NUAGE_AUTOTEST_DIR) settings.nuageHome = process.env.NUAGE_AUTOTEST_PART === 'encoche' ? 'encoche' : 'bureau'
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (error) {
    console.error('Réglages non enregistrés :', error)
  }
}
const publicSettings = () => ({
  size: settings.size,
  px: SIZES[settings.size],
  quiet: settings.quiet,
  firstRun: settings.firstRun,
  audioReactive: settings.audioReactive,
  cinemaQuiet: settings.cinemaQuiet,
  breakReminder: settings.breakReminder,
  feedOn: settings.feedOn,
  soundsOn: settings.soundsOn,
  volume: settings.volume,
  weatherLabel: settings.weatherLabel,
  home: settings.nuageHome === 'encoche' && settings.encocheOn,
})
function updateSettings(patch) {
  Object.assign(settings, patch)
  saveSettings()
  send('settings', publicSettings())
  refreshMenu()
}

// ---------- Fenêtre ----------
let win = null
let panel = null
let tray = null
let pomodoroRunning = false

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}
const fromWindow = event => win && event.sender === win.webContents
const fromPanel = event => panel && !panel.isDestroyed() && event.sender === panel.webContents
// Toutes les fenêtres de Nuage (mascotte, tableau de bord, encoche avec le chat et les réglages)
const fromApp = event => [win, panel, encoche].some(w => w && !w.isDestroyed() && event.sender === w.webContents)
const fromOne = (w, event) => Boolean(w && !w.isDestroyed() && event.sender === w.webContents)
const sendTo = (w, channel, data) => {
  if (w && !w.isDestroyed()) w.webContents.send(channel, data)
}
let encoche = null

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(40_000),
    headers: { 'User-Agent': 'Nuage-bureau/1.0' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const windowSize = () => {
  const s = SIZES[settings.size]
  return { width: s + MARGIN_X, height: s + MARGIN_TOP }
}
function defaultPosition({ width, height }) {
  const { workArea } = screen.getPrimaryDisplay()
  return { x: workArea.x + workArea.width - width - 8, y: workArea.y + workArea.height - height }
}
function startPosition(size) {
  const saved = settings.position
  if (saved) {
    const cx = saved.x + size.width / 2
    const cy = saved.y + size.height / 2
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      cx > a.x && cx < a.x + a.width && cy > a.y && cy < a.y + a.height)
    if (onScreen) return saved
  }
  return defaultPosition(size)
}
function savePosition() {
  if (!win) return
  const { x, y } = win.getBounds()
  settings.position = { x, y }
  saveSettings()
}

function createWindow() {
  const size = windowSize()
  win = new BrowserWindow({
    ...size,
    ...startPosition(size),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // un clic sur Nuage ne vole pas le focus de la fenêtre active
    title: 'Nuage',
    icon: path.join(__dirname, 'assets', 'nuage.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false, // le Pomodoro continue quand Nuage est masqué
    },
  })
  // Les zones transparentes laissent passer les clics ; le rendu réactive la souris
  // quand le curseur survole le nuage ou la bulle.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.once('ready-to-show', () => (homeInBar() ? refreshMenu() : showNuage()))
  win.on('moved', () => {
    if (!drag) savePosition() // pendant un glisser, la position est enregistrée au lâcher
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

function setWindowBounds(x, y) {
  // Taille fixe : évite les redimensionnements entre écrans de résolutions différentes
  win.setBounds({ x: Math.round(x), y: Math.round(y), ...windowSize() })
}
// Sous Windows, le niveau « floating » (celui d'alwaysOnTop: true) place la fenêtre derrière
// la barre des tâches sans la rendre vraiment « au premier plan » : Nuage passait derrière
// les autres fenêtres. Le niveau « screen-saver » la met réellement au-dessus.
// Nuage habite l'encoche (06/10/2026 : « il reste petit dans l'encoche, l'encoche sera toujours un peu
// affichée ») : la fenêtre du bureau reste cachée (elle continue de parler, de compter le Pomodoro…), ses
// bulles s'affichent dans la pilule, et « montrer Nuage » ouvre l'encoche. Le ramener sur le bureau : menu
// « Nuage vit dans l'encoche ».
const homeInBar = () => settings.nuageHome === 'encoche' && settings.encocheOn
let notchOpenPending = false
function openNotch() {
  if (!encoche || encoche.isDestroyed()) createEncoche()
  if (encocheReady) sendTo(encoche, 'encoche:open', true)
  else notchOpenPending = true
}
function setNuageHome(home) {
  updateSettings({ nuageHome: home === 'bureau' ? 'bureau' : 'encoche' })
  sendTo(encoche, 'encoche-settings', encocheSettings())
  if (homeInBar()) {
    nuageInBar = false
    if (win && !win.isDestroyed() && win.isVisible()) win.hide()
    openNotch()
  } else {
    showNuage()
  }
  refreshMenu()
}
function showNuage() {
  if (!win || win.isDestroyed()) return
  if (homeInBar()) {
    if (win.isVisible()) win.hide()
    nuageInBar = false
    openNotch()
    refreshMenu()
    return
  }
  // Rappelé (icône, Ctrl+Alt+N, menu) alors qu'il vit dans la barre : il en sort
  if (nuageInBar) {
    nuageInBar = false
    placeNuageUnderBar()
    sendTo(encoche, 'nuage:out')
    send('bar', 'leave')
  }
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
  win.moveTop()
  refreshMenu()
}
function toggleVisible() {
  if (!win) return
  if (homeInBar()) {
    if (!encoche || encoche.isDestroyed() || !encocheReady) openNotch()
    else sendTo(encoche, 'encoche:toggle', true)
    return
  }
  if (win.isVisible()) {
    win.hide()
    refreshMenu()
  } else {
    showNuage()
  }
}
function resize(key) {
  const old = win.getBounds()
  settings.size = key
  const size = windowSize()
  setWindowBounds(old.x + old.width / 2 - size.width / 2, old.y + old.height - size.height)
  savePosition()
  updateSettings({ size: key })
}
function resetPosition() {
  const { x, y } = defaultPosition(windowSize())
  setWindowBounds(x, y)
  showNuage()
  savePosition()
}

// ---------- Tableau de bord (météo) ----------
let weatherState = { place: null, current: null, error: null, updatedAt: null }
let lastWeather = null

const panelState = () => ({
  weatherOn: settings.weatherOn,
  weather: weatherState,
})
function pushPanel() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:update', panelState())
}

function togglePanel() {
  if (panel && !panel.isDestroyed()) {
    if (panel.isVisible()) {
      panel.hide()
    } else {
      foldEncoche()
      placePanel()
      panel.show()
    }
    return
  }
  foldEncoche()
  panel = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Nuage : tableau de bord',
    icon: path.join(__dirname, 'assets', 'nuage.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-panneau.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  placePanel()
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panel.webContents.on('will-navigate', event => event.preventDefault())
  panel.on('blur', () => {
    if (!process.env.NUAGE_AUTOTEST_DIR) panel.hide()
  })
  panel.once('ready-to-show', () => panel.show())
  panel.loadFile(path.join(__dirname, 'renderer', 'panneau.html'))
}
// À gauche de Nuage (à droite s'il n'y a pas la place), aligné sur son bas
function placePanel() {
  const b = win.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  const { width, height } = PANEL_SIZE
  let x = b.x - width + 40
  if (x < area.x) x = b.x + b.width - 40
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(b.y + b.height - height, area.y), area.y + area.height - height)
  panel.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
}

// ---------- Météo ----------
async function refreshWeather({ redetect = false } = {}) {
  if (!settings.weatherOn) {
    lastWeather = null
    send('weather', null)
    pushPanel()
    return
  }
  try {
    if (redetect || !settings.weatherPlace) {
      updateSettings({ weatherPlace: await meteo.detectPlace(fetchJson) })
    }
    const current = await meteo.currentWeather(fetchJson, settings.weatherPlace)
    weatherState = { place: settings.weatherPlace, current, error: null, updatedAt: new Date().toISOString() }
    lastWeather = { ...current, place: settings.weatherPlace.name }
    send('weather', lastWeather)
    sendTo(encoche, 'weather', lastWeather) // l'horizon de l'îlot prend la couleur du temps
  } catch (error) {
    // on garde la dernière couleur connue, le tableau de bord affiche l'erreur
    weatherState = { ...weatherState, place: settings.weatherPlace, error: `Météo indisponible (${error.message})` }
  }
  pushPanel()
}
async function setWeatherPlace(query) {
  const q = String(query || '').trim().slice(0, 80)
  if (!q) return { ok: false, message: 'Tapez le nom d’une ville.' }
  try {
    const hits = await meteo.geocode(fetchJson, q)
    if (!hits.length) return { ok: false, message: `Ville introuvable : « ${q} ».` }
    updateSettings({ weatherPlace: { ...hits[0], source: 'manuel' } })
    await refreshWeather()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: `Recherche impossible (${error.message}).` }
  }
}

// ---------- Musique et vidéos (contrôles multimédias de Windows) ----------
// medias.ps1 lit ce qui joue (Spotify, navigateurs, lecteurs vidéo) et le plein écran.
const BROWSERS = /chrome|msedge|firefox|opera|brave|vivaldi/i
const MUSIC_APPS = /spotify|deezer|zunemusic|music\.ui|applemusic|itunes|tidal|soundcloud|amazonmusic/i
const APP_NAMES = [
  [/spotify/i, 'Spotify'], [/deezer/i, 'Deezer'], [/chrome/i, 'Chrome'], [/msedge/i, 'Edge'], [/firefox/i, 'Firefox'],
  [/vlc/i, 'VLC'], [/zunevideo/i, 'Films et TV'], [/netflix/i, 'Netflix'], [/zunemusic|music\.ui/i, 'Lecteur multimédia'],
]
let mediaProcess = null
let mediaState = null
let mediaRestarts = 0
let quitting = false

function classifyMedia(raw) {
  const fullscreen = Boolean(raw.fullscreen)
  if (!raw.app || raw.status === 'none' || raw.status === 'closed') return { kind: null, playing: false, fullscreen }
  let kind = 'video'
  if (MUSIC_APPS.test(raw.app) || (raw.type === 'music' && !BROWSERS.test(raw.app))) kind = 'music'
  const label = APP_NAMES.find(([re]) => re.test(raw.app))?.[1] || raw.app.split('!').pop()
  return {
    kind,
    playing: raw.status === 'playing',
    status: raw.status,
    title: raw.title,
    artist: raw.artist,
    app: label,
    fullscreen,
  }
}
function startMediaWatcher() {
  if (mediaProcess || !settings.mediaOn) return
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'medias.ps1')], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  mediaProcess = child
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (!line) continue
      try {
        mediaState = classifyMedia(JSON.parse(line))
        mediaRestarts = 0
        send('media', mediaState)
      } catch (error) {
        console.error('medias.ps1, ligne illisible :', line, error.message)
      }
    }
  })
  child.stderr.on('data', data => console.error('medias.ps1 :', String(data).trim()))
  child.stdin.on('error', () => {}) // PowerShell déjà fermé : rien à écrire
  child.on('error', error => {
    debugLog('medias.ps1, lancement impossible :', error.message)
    if (mediaProcess === child) mediaProcess = null // sans cela, plus jamais relancé
  })
  child.on('exit', () => {
    if (mediaProcess === child) mediaProcess = null
    if (quitting || !settings.mediaOn) return
    mediaRestarts += 1
    setTimeout(startMediaWatcher, Math.min(60_000, 3000 * mediaRestarts))
  })
}
function stopMediaWatcher() {
  const child = mediaProcess
  mediaProcess = null
  if (child) {
    child.stdin.end()
    setTimeout(() => child.exitCode === null && child.kill(), 2000)
  }
  mediaState = null
  send('media', null)
}

// Analyse du son pour danser : seule la fenêtre de Nuage peut capter le son du PC (analysé
// sur place pour le rythme, jamais enregistré ni envoyé).
function allowAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const main = win && !win.isDestroyed() ? win.webContents.mainFrame : null
    const fromNuage = main && request.frame &&
      request.frame.processId === main.processId && request.frame.routingId === main.routingId
    if (!fromNuage || !settings.audioReactive) {
      callback({})
      return
    }
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}))
  }, { useSystemPicker: false })
}

// ---------- Nuage avale ce qu'on lui glisse : envoi à la Corbeille ----------
// shell.trashItem ne fait que déplacer vers la Corbeille (récupérable) ; si un élément ne peut
// pas y aller (clé USB, réseau…), Windows refuse au lieu de le supprimer définitivement.
let lastSwallowed = null

const norm = p => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
function protectedReason(target) {
  const resolved = path.resolve(target)
  if (resolved === path.parse(resolved).root) return 'c’est un disque entier'
  const p = norm(resolved)
  const important = [
    os.homedir(), path.dirname(os.homedir()), userDir('desktop'), userDir('documents'),
    userDir('downloads'), userDir('pictures'), userDir('music'), userDir('videos'),
    app.getPath('appData'),
  ]
  // Le dossier lui-même ou un dossier qui le contient (ex. Documents contient Nuage)
  for (const folder of [...important, __dirname]) {
    const f = norm(folder)
    if (p === f || f.startsWith(`${p}\\`)) return 'c’est un dossier important'
  }
  const system = [process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, __dirname]
  for (const folder of system.filter(Boolean)) {
    const f = norm(folder)
    if (p === f || p.startsWith(`${f}\\`)) return 'c’est un fichier du système ou de Nuage'
  }
  return null
}

async function swallow(list) {
  const result = { trashed: [], refused: [], failed: [] }
  for (const raw of list.slice(0, 200)) {
    const target = typeof raw === 'string' && raw ? path.resolve(raw) : ''
    const name = path.basename(target)
    if (!target || !fs.existsSync(target)) {
      result.failed.push({ name, reason: 'introuvable' })
      continue
    }
    const reason = protectedReason(target)
    if (reason) {
      result.refused.push({ name, reason })
      continue
    }
    try {
      await shell.trashItem(target)
      result.trashed.push({ path: target, name })
    } catch (error) {
      result.failed.push({ name, reason: error.message })
    }
  }
  lastSwallowed = result.trashed.length ? { paths: result.trashed.map(t => t.path), at: Date.now() } : null
  return {
    trashed: result.trashed.map(t => ({ name: t.name })),
    refused: result.refused,
    failed: result.failed,
  }
}

// Annuler : restaure le dernier repas (moins d'une minute) via corbeille.ps1
function restoreLastSwallowed() {
  const batch = lastSwallowed
  lastSwallowed = null
  if (!batch || Date.now() - batch.at > 60_000) return Promise.resolve({ restored: [], failed: [], expired: true })
  const names = batch.paths.map(p => path.basename(p))
  const asciiJson = JSON.stringify(batch.paths).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'corbeille.ps1')], {
      windowsHide: true,
    })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { out += data })
    child.on('error', () => resolve({ restored: [], failed: names }))
    child.on('exit', () => {
      try {
        const r = JSON.parse(out.trim())
        resolve({ restored: [].concat(r.restored || []), failed: [].concat(r.failed || []) })
      } catch {
        resolve({ restored: [], failed: names })
      }
    })
    child.stdin.end(asciiJson)
  })
}

// ---------- Écran de verrouillage : Nuage endormi aux couleurs du thème Windows ----------
// Aucune application ne peut s'afficher par-dessus l'écran de verrouillage (sécurité de
// Windows) : Nuage dessine une image plein écran et la définit comme image de verrouillage.
const LOCK_VERSION = 2
let lockTimer = null
let lockBusy = false

function currentTheme() {
  const accent = String(systemPreferences.getAccentColor?.() || '3b82f6ff').slice(0, 6).toLowerCase()
  const dark = nativeTheme.shouldUseDarkColors
  return { accent, dark, key: `${LOCK_VERSION}|${accent}|${dark ? 'sombre' : 'clair'}` }
}
function runLockHelper(image = '') {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verrouillage.ps1')]
  if (image) args.push('-Image', image)
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.on('error', reject)
    child.on('exit', code => {
      try {
        resolve(JSON.parse(out.trim()))
      } catch {
        reject(new Error(`verrouillage.ps1 (code ${code}) ${err.trim().slice(0, 200)}`))
      }
    })
  })
}
async function paintLockScreen(theme) {
  // Windows limite la fenêtre de dessin à la zone de travail (hors barre des tâches) :
  // on y loge la plus grande image aux proportions exactes de l'écran.
  const display = screen.getPrimaryDisplay()
  const ratio = display.size.width / display.size.height
  let width = display.workArea.width
  let height = Math.round(width / ratio)
  if (height > display.workArea.height) {
    height = display.workArea.height
    width = Math.round(height * ratio)
  }
  const painter = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  try {
    await painter.loadFile(path.join(__dirname, 'renderer', 'verrouillage.html'), {
      query: { accent: theme.accent, theme: theme.dark ? 'dark' : 'light' },
    })
    await painter.webContents.executeJavaScript('window.nuagePret')
    const image = await painter.webContents.capturePage()
    const file = path.join(app.getPath('userData'), 'ecran-verrouillage.png')
    fs.writeFileSync(file, image.toPNG())
    return file
  } finally {
    painter.destroy()
  }
}
async function applyLockScreen({ force = false } = {}) {
  if (!settings.lockScreenOn || lockBusy) return false
  const theme = currentTheme()
  if (!force && settings.lockScreenApplied === theme.key) return false
  lockBusy = true
  try {
    const image = await paintLockScreen(theme)
    const result = await runLockHelper(image)
    // On mémorise l'image d'origine une seule fois, pour pouvoir la remettre
    if (!settings.lockScreenOriginal && result.before && !/ecran-verrouillage/i.test(result.before)) {
      settings.lockScreenOriginal = result.before
    }
    settings.lockScreenApplied = theme.key
    saveSettings()
    debugLog('écran de verrouillage appliqué :', theme.key)
    return true
  } catch (error) {
    console.error('Écran de verrouillage :', error)
    debugLog('écran de verrouillage, erreur :', error.message)
    return false
  } finally {
    lockBusy = false
  }
}
function scheduleLockScreen() {
  clearTimeout(lockTimer)
  lockTimer = setTimeout(() => applyLockScreen(), 3000)
}
async function restoreLockScreen() {
  const original = settings.lockScreenOriginal
  settings.lockScreenApplied = null
  saveSettings()
  if (!original || !fs.existsSync(original)) return false
  try {
    await runLockHelper(original)
    return true
  } catch {
    return false
  }
}

// ---------- Écran de veille Nuage (puis verrouillage par Windows) ----------
// veille.ps1 compile le lanceur nuage.scr et règle l'écran de veille du compte ; au retour,
// c'est Windows qui verrouille (« À la reprise, afficher l'écran d'ouverture de session »).
const VEILLE_SHORTCUT = 'Control+Alt+L'

function runVeilleHelper(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'veille.ps1'), ...args], {
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.on('error', reject)
    child.on('exit', code => {
      try {
        resolve(JSON.parse(out.trim()))
      } catch {
        reject(new Error(`veille.ps1 (code ${code}) ${err.trim().slice(0, 300)}`))
      }
    })
  })
}
async function installScreensaver() {
  const result = await runVeilleHelper(['-Action', 'installer', '-Delai', String(settings.screensaverDelay)])
  // Réglages d'origine mémorisés une seule fois (et jamais ceux de Nuage lui-même)
  if (!settings.screensaverBefore && !/nuage\.scr$/i.test(result.avant?.scrnsave || '')) {
    settings.screensaverBefore = result.avant
  }
  saveSettings()
  debugLog('écran de veille installé :', JSON.stringify(result.apres))
  return result
}
async function removeScreensaver() {
  const before = settings.screensaverBefore || { scrnsave: '', active: '1', timeout: '', secure: '' }
  const encoded = Buffer.from(JSON.stringify(before), 'utf8').toString('base64')
  const result = await runVeilleHelper(['-Action', 'retirer', '-Avant', encoded])
  settings.screensaverBefore = null
  saveSettings()
  return result
}
function launchScreensaver() {
  if (!settings.screensaverOn) return
  const scr = path.join(__dirname, 'nuage.scr')
  if (fs.existsSync(scr)) spawn(scr, ['/l'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
  else runVeilleHelper(['-Action', 'lancer']).catch(() => {})
}
function registerVeilleShortcut() {
  globalShortcut.unregister(VEILLE_SHORTCUT)
  if (settings.screensaverOn) globalShortcut.register(VEILLE_SHORTCUT, launchScreensaver)
}

// ---------- Outil : lancer un script PowerShell du dossier et lire sa sortie JSON ----------
function runPowerShell(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script), ...args], { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.on('error', reject)
    child.on('exit', code => {
      try {
        resolve(JSON.parse(out.trim()))
      } catch {
        reject(new Error(`${script} (code ${code}) ${err.trim().slice(0, 300)}`))
      }
    })
  })
}
const short = (text, max = 60) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// ---------- Agents de code (Claude Code) : suivi, autorisations, limites ----------
let agentState = null
const nuageSessionIds = new Set() // sessions reprises par le chat de Nuage (copies)
const hub = createAgentHub({
  isOwnSession: id => nuageSessionIds.has(id),
  onChange: snapshot => {
    agentState = snapshot
    sendTo(encoche, 'agents', snapshot)
    pushPhoneAgents()
  },
  onEvent: event => {
    send('agent-event', event)
    if (event.type === 'done') refreshUsage() // une réponse finie : les limites ont bougé
    // Le téléphone associé est prévenu aussi (utile quand on n'est pas devant le PC)
    // (les demandes d'autorisation partent dans le résumé des agents : l'appli en fait une notification à boutons)
    if (event.type === 'done') notifyPhone(`${event.title || 'Claude'} a fini`, event.message || '', 'claude')
    else if (event.type === 'question') notifyPhone(`${event.title || 'Claude'} te pose une question`, 'Réponds sur le PC (encoche).', 'claude')
  },
})

// ---------- Agents vus du téléphone (06/10/2026, fonctions de Coucou sur iPhone) ----------
// Résumé léger (agents-telephone.js) poussé dans la boîte du téléphone : tout de suite quand ça compte (nouvelle
// demande, statut, étape), sinon au plus toutes les 20 s. L'appli en tire son écran Agents, ses widgets, sa
// notification « en direct » et les notifications d'autorisation (approuvées derrière l'empreinte).
const dayKey = () => new Date().toLocaleDateString('fr-CA') // AAAA-MM-JJ, heure du PC
function okTodayCount() {
  return settings.okToday?.day === dayKey() ? settings.okToday.n : 0
}
function countOk(choice) {
  if (choice !== 'allow' && choice !== 'always') return
  settings.okToday = { day: dayKey(), n: okTodayCount() + 1 }
  saveSettings()
  pushPhoneAgents(true)
}
function phoneAgentsSummary() {
  return agentsPhone.summarize(agentState || hub.snapshot(), { integrations: integrationState, okToday: okTodayCount(), chat: phoneChatSummary(), ia: chatAiName() })
}
// Nom court de l'IA du chat (« Gemini », « ChatGPT », « Claude ») : le téléphone écrit « Demande à Gemini… »
// (09/10/2026 : il disait « Demande à Claude » pendant une discussion avec Gemini)
const chatAiName = () => (chatState.session ? 'Claude' : chatApi.PROVIDERS[settings.chatProvider]?.label || 'Nuage').replace(/\s*\(.*\)$/, '')
// La discussion du chat avec une autre IA que Claude Code, pour l'onglet Agents du téléphone (une session Claude Code
// y est déjà, par agents.js)
function phoneChatSummary() {
  const shown = chatState.messages.filter(m => !m.past)
  if (chatState.session || !shown.length) return null
  const day = new Date().setHours(0, 0, 0, 0)
  return {
    ia: chatAiName(), at: shown.at(-1).at || Date.now(), streaming: chatState.streaming, outil: chatState.tool || '',
    tours: shown.filter(m => m.role === 'user' && m.at >= day).length,
  }
}
let phoneAgentsSig = ''
let phoneAgentsProgress = ''
let phoneAgentsAt = 0
let phoneAgentsDue = 0
let phoneAgentsTimer = null
function pushPhoneAgents(force = false) {
  if (!link || !phones().length) return
  const summary = phoneAgentsSummary()
  // Demande ou statut : 1,5 s ; une étape de plus : 8 s ; le reste : 20 s (depuis le dernier envoi)
  const gap = force || agentsPhone.signature(summary) !== phoneAgentsSig ? 1500 : agentsPhone.progress(summary) !== phoneAgentsProgress ? 8000 : 20_000
  const due = phoneAgentsAt + gap
  if (phoneAgentsTimer && phoneAgentsDue <= due) return
  clearTimeout(phoneAgentsTimer)
  phoneAgentsDue = due
  phoneAgentsTimer = setTimeout(() => {
    phoneAgentsTimer = null
    const latest = phoneAgentsSummary() // l'état a pu bouger pendant l'attente
    phoneAgentsSig = agentsPhone.signature(latest)
    phoneAgentsProgress = agentsPhone.progress(latest)
    phoneAgentsAt = Date.now()
    link?.sendAgents(latest)
  }, Math.max(0, due - Date.now()))
}

// ---------- Limites d'utilisation (5 h / 7 j), lues par Nuage lui-même ----------
// L'application Claude n'exécute pas la barre d'état : Nuage lance « claude -p /usage » (commande locale,
// 0 jeton), toutes les minutes quand Claude travaille, toutes les 5 min sinon, et à l'ouverture de l'Accueil.
let usageBusy = false
let usageAt = 0
async function refreshUsage(force = false) {
  if (usageBusy || !claudeCode.found) return
  if (!force && Date.now() - usageAt < 25_000) return
  usageBusy = true
  try {
    const usage = await chatApi.claudeCodeUsage()
    usageAt = Date.now()
    if (usage) hub.setUsage(usage)
  } catch (error) {
    debugLog('limites, lecture impossible :', error.message)
  } finally {
    usageBusy = false
  }
}
function watchUsage() {
  setTimeout(() => refreshUsage(true), 12_000)
  setInterval(() => {
    const busy = (agentState || hub.snapshot()).active > 0 || chatState.streaming
    if (Date.now() - usageAt >= (busy ? 60_000 : 5 * 60_000)) refreshUsage(true)
  }, 15_000)
}

function ensureToken() {
  if (!settings.nuageToken) {
    settings.nuageToken = crypto.randomBytes(24).toString('hex')
    saveSettings()
  }
  // Lu par nuage-statut.exe (barre d'état de Claude Code)
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(path.join(app.getPath('userData'), 'jeton.txt'), settings.nuageToken, 'utf8')
  return settings.nuageToken
}
async function installClaudeCode() {
  const token = ensureToken()
  let statusExe = ''
  try {
    statusExe = (await runPowerShell('statut.ps1')).exe
  } catch (error) {
    debugLog('barre d’état, compilation impossible :', error.message)
  }
  const { previousStatusLine } = claudeConfig.install({ token, statusExe })
  if (previousStatusLine && !settings.claudeCodeStatusLine) settings.claudeCodeStatusLine = previousStatusLine
  settings.claudeCodeWanted = true
  saveSettings()
}
function removeClaudeCode() {
  claudeConfig.uninstall({ previousStatusLine: settings.claudeCodeStatusLine })
  settings.claudeCodeWanted = false
  settings.claudeCodeStatusLine = null
  saveSettings()
}
// « Ouvrir la session » : met au premier plan l'application Claude, sinon ouvre le dossier
function openSession(cwd) {
  const script = "$p = Get-Process Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { [void](New-Object -ComObject WScript.Shell).AppActivate($p.Id); 'ok' } else { 'absent' }"
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  let out = ''
  child.stdout.on('data', data => { out += data })
  child.on('error', () => cwd && fs.existsSync(cwd) && shell.openPath(cwd))
  child.on('exit', () => {
    if (!out.includes('ok') && cwd && fs.existsSync(cwd)) shell.openPath(cwd)
  })
}

// ---------- Encoche : îlot du haut (chat, agents, intégrations) ----------
// Comme Coucou (Louis-CFM, code sous licence MIT) : la fenêtre a une taille fixe et reste
// transparente ; l'îlot noir est dessiné et animé dedans par la page. Les clics ne sont pris que
// sur l'îlot (et une petite marge) : partout ailleurs ils passent aux fenêtres en dessous.
const ENCOCHE_WINDOW = { width: 640, height: 430 }
const PILL_H = 32 // hauteur de la pilule (voir renderer\encoche.js)
const HIT_MARGIN = 14 // marge autour de l'îlot : un clic qui arrive vite n'est jamais perdu
const encocheSettings = () => ({ autoHide: settings.autoHide, soundsOn: settings.soundsOn, volume: settings.volume, home: homeInBar(), feedOn: settings.feedOn })
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
let encocheReady = false // l'encoche a demandé son état : elle reçoit les messages
let chatOpenPending = null // « ouvrir le chat » demandé avant que l'encoche soit prête
let islandRect = { x: 0, y: 0, w: 0, h: 0 } // forme de l'îlot dans la fenêtre, envoyée par la page
let islandPlace = { anchorX: ENCOCHE_WINDOW.width / 2, up: false, docked: true }
let islandDrag = null
// L'îlot se pose n'importe où (accord du 03/10/2026). settings.encochePos = centre du haut de la
// pilule à l'écran, ou null : collé en haut au centre de l'écran principal. Près du bord du haut, il
// s'y colle (encoche) ; ailleurs il flotte. Sans place en dessous, le panneau s'ouvre vers le haut.
function encocheLayout(keepUp = false) {
  const pos = settings.encochePos
  const display = pos ? screen.getDisplayNearestPoint({ x: Math.round(pos.cx), y: Math.round(pos.top) }) : screen.getPrimaryDisplay()
  const area = display.workArea
  const W = ENCOCHE_WINDOW.width
  const H = Math.min(ENCOCHE_WINDOW.height, area.height)
  const cx = clampN(pos ? pos.cx : area.x + area.width / 2, area.x + 160, area.x + area.width - 160)
  const top = clampN(pos ? pos.top : area.y, area.y, area.y + area.height - PILL_H)
  const docked = top <= area.y + 1
  // Pendant un déplacement, le sens d'ouverture ne change pas (le panneau ne saute pas)
  const up = !docked && (keepUp ? islandPlace.up : top + H > area.y + area.height)
  const x = clampN(Math.round(cx - W / 2), area.x, area.x + area.width - W)
  const y = up ? Math.round(top + PILL_H - H) : Math.round(top)
  return { bounds: { x, y, width: W, height: H }, place: { anchorX: Math.round(cx - x), up, docked }, pill: { cx, top, area } }
}
function createEncoche() {
  if (!settings.encocheOn || (encoche && !encoche.isDestroyed())) return
  encocheReady = false
  islandRect = { x: 0, y: 0, w: 0, h: 0 }
  const layout = encocheLayout()
  islandPlace = layout.place
  encoche = new BrowserWindow({
    ...layout.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Nuage : encoche',
    webPreferences: {
      preload: path.join(__dirname, 'preload-encoche.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  encoche.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  encoche.webContents.on('will-navigate', event => event.preventDefault())
  // Tant que la souris n'est pas sur l'îlot, la fenêtre laisse passer les clics
  encoche.setIgnoreMouseEvents(true, { forward: true })
  encoche.once('ready-to-show', () => {
    encoche.showInactive()
    encoche.setAlwaysOnTop(true, 'screen-saver')
  })
  encoche.on('closed', () => {
    encoche = null
    encocheReady = false
    nuageLeaveBar() // Nuage ne reste pas enfermé dans une barre qui n'existe plus
  })
  encoche.loadFile(path.join(__dirname, 'renderer', 'encoche.html'))
}
function destroyEncoche() {
  if (encoche && !encoche.isDestroyed()) encoche.destroy()
  encoche = null
  encocheReady = false
  nuageLeaveBar()
}
function placeEncoche(keepUp = false) {
  if (!encoche || encoche.isDestroyed()) return
  const { bounds, place } = encocheLayout(keepUp)
  const b = encoche.getBounds()
  if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) encoche.setBounds(bounds)
  if (place.anchorX !== islandPlace.anchorX || place.up !== islandPlace.up || place.docked !== islandPlace.docked) {
    islandPlace = place
    sendTo(encoche, 'encoche:place', place)
  }
}
// Déplacer l'îlot : la page dit quand on l'attrape et quand on le lâche, le processus principal suit
// le curseur (comme pour Nuage)
function startIslandDrag() {
  if (islandDrag) return
  const p = screen.getCursorScreenPoint()
  const { pill } = encocheLayout()
  const current = {
    dx: p.x - pill.cx,
    dy: p.y - pill.top,
    timer: setInterval(() => {
      const c = screen.getCursorScreenPoint()
      const area = screen.getDisplayNearestPoint(c).workArea
      let top = c.y - current.dy
      if (top < area.y + 24) top = area.y // près du haut : il s'y colle
      settings.encochePos = { cx: c.x - current.dx, top }
      placeEncoche(true)
    }, 10),
  }
  islandDrag = current
}
function endIslandDrag() {
  if (!islandDrag) return
  clearInterval(islandDrag.timer)
  islandDrag = null
  saveSettings()
  placeEncoche()
  refreshMenu()
}

// ---------- Nuage rentre dans la barre (lâché en haut ou sur l'îlot) ----------
// Il plonge dedans (sa fenêtre disparaît), vit et s'anime dans le panneau du chat, et ne ressort
// sur l'écran que quand on ferme la barre : juste en dessous d'elle (choix de l'utilisateur).
let nuageInBar = false
function nuageEnterBar() {
  nuageInBar = true
  send('bar', 'enter')
  setTimeout(() => {
    if (nuageInBar && win && !win.isDestroyed()) {
      win.hide()
      refreshMenu()
    }
  }, 380)
  openChat({ nuage: true })
}
// Juste sous la pilule, centré sur elle, sans sortir de l'écran
function placeNuageUnderBar() {
  const { pill } = encocheLayout()
  const size = windowSize()
  const x = clampN(pill.cx - size.width / 2, pill.area.x, pill.area.x + pill.area.width - size.width)
  const y = clampN(pill.top + PILL_H + 8 - MARGIN_TOP, pill.area.y, pill.area.y + pill.area.height - size.height)
  setWindowBounds(x, y)
  savePosition()
}
function nuageLeaveBar() {
  if (!nuageInBar) return
  nuageInBar = false
  if (!win || win.isDestroyed()) return
  placeNuageUnderBar()
  send('bar', 'leave')
  showNuage()
}
// Toutes les 30 ms : la souris est-elle sur l'îlot ? Décide si la fenêtre prend les clics et
// prévient la page (survol). Les événements de la page seuls ne suffisent pas : une fenêtre qui
// laisse passer les clics ne voit pas la souris arriver. Pendant l'auto-test, la souris est celle
// de l'utilisateur, qui se sert du PC : la fenêtre laisse tout passer et le survol est ignoré.
function watchEncoche() {
  let lastWindow = null
  let ignoring = true
  let inside = false
  setInterval(() => {
    if (!encoche || encoche.isDestroyed() || !encocheReady) return
    if (encoche !== lastWindow) {
      lastWindow = encoche
      ignoring = true
      inside = false
    }
    const autotest = Boolean(process.env.NUAGE_AUTOTEST_DIR)
    const p = screen.getCursorScreenPoint()
    const b = encoche.getBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const r = islandRect
    const near = !autotest && encoche.isVisible() && r.w > 0 &&
      x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN && y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN
    if (near === ignoring) {
      ignoring = !near
      encoche.setIgnoreMouseEvents(ignoring, { forward: true })
    }
    const over = near && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
    if (over !== inside) {
      inside = over
      sendTo(encoche, 'encoche:hover', over)
    }
  }, 30)
}

// ---------- Intégrations ----------
let integrationState = []
let integrationsBusy = false
async function refreshIntegrations() {
  if (integrationsBusy) return
  integrationsBusy = true
  try {
    integrationState = await integrationsApi.refreshAll()
    sendTo(encoche, 'integrations', integrationState)
    pushPhoneAgents()
  } finally {
    integrationsBusy = false
  }
}

// ---------- Chat ----------
// always : actions de l'IA autorisées « Toujours » jusqu'à la prochaine discussion (permitChat)
const chatState = { messages: [], attachments: [], streaming: false, abort: null, session: null, permission: null, autoSession: true, always: new Set() }
// « Claude (ton abonnement) » : Claude Code de l'application Claude, connecté une fois au compte
let claudeCode = { found: Boolean(chatApi.findClaudeCode()), loggedIn: false, checkedAt: 0 }
let loginWatch = null
const claudeLog = []
async function refreshClaudeCode() {
  const before = `${claudeCode.found}/${claudeCode.loggedIn}`
  const state = await chatApi.claudeCodeStatus()
  // Réponse illisible (claude.exe lent juste après l'allumage) : on garde ce qu'on savait
  if (state.unsure) state.loggedIn = claudeCode.loggedIn
  claudeCode = { ...state, checkedAt: Date.now() }
  // Relevé de diagnostic (30 dernières vérifications) : %APPDATA%\Nuage\etat-claude.json
  claudeLog.push({ quand: new Date().toISOString(), trouve: state.found, connecte: state.loggedIn, incertain: Boolean(state.unsure), ...state.detail })
  if (claudeLog.length > 30) claudeLog.shift()
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'etat-claude.json'), JSON.stringify(claudeLog, null, 1))
  } catch {}
  if (`${claudeCode.found}/${claudeCode.loggedIn}` !== before) {
    debugLog('Claude Code :', claudeCode.found ? 'trouvé' : 'introuvable', claudeCode.loggedIn ? 'connecté' : 'pas connecté')
    pushChat()
    pushCnx()
  }
  if (claudeCode.found && claudeCode.loggedIn) onClaudeReady()
  return claudeCode
}
// Connexion à Claude dès le lancement (05/10/2026 : « il doit se connecter automatiquement à Claude dès
// que je lance Nuage »). Avant, une seule vérification 3 s après le démarrage : si le PC ou l'application
// Claude démarraient encore, Nuage restait sur « Claude Code est introuvable » jusqu'à son redémarrage.
// Maintenant : toutes les 10 s jusqu'à être connecté (puis toutes les minutes), et toutes les 15 min ensuite.
function watchClaudeCode() {
  const started = Date.now()
  const tick = async () => {
    let ready = false
    try {
      const state = await refreshClaudeCode()
      ready = state.found && state.loggedIn
    } catch (error) {
      debugLog('Claude Code, vérification impossible :', error.message)
    }
    setTimeout(tick, ready ? 15 * 60_000 : Date.now() - started < 10 * 60_000 ? 10_000 : 60_000)
  }
  setTimeout(tick, 1500)
}
// Dès que Claude est là et connecté : la session Claude Code en cours est reprise et Claude démarre au
// chaud (il attend sans rien dépenser), la barre du haut est prête avant même qu'on l'ouvre
let claudeReadyOnce = false
function onClaudeReady() {
  if (claudeReadyOnce || process.env.NUAGE_AUTOTEST_DIR) return
  claudeReadyOnce = true
  setTimeout(() => {
    debugLog('Claude Code prêt : session reprise et Claude au chaud')
    autoContinueSession()
    prewarmChat()
    pushChat()
  }, 5000)
}
// Après « Se connecter à Claude » : on surveille la connexion pendant 5 min
function loginClaude() {
  chatApi.loginClaudeCode()
  clearInterval(loginWatch)
  const until = Date.now() + 5 * 60_000
  loginWatch = setInterval(async () => {
    const state = await refreshClaudeCode()
    if (state.loggedIn || Date.now() > until) {
      clearInterval(loginWatch)
      loginWatch = null
      if (state.loggedIn) {
        send('notice', 'C’est bon, je suis connecté à ton compte Claude : tu peux discuter en haut de l’écran !')
        pushCnx()
      }
    }
  }, 4000)
}
// Gemini (Antigravity) et ChatGPT (Codex) par l'abonnement : installé ? connecté ? (abonnements.js)
const accountState = { agy: { installed: false, loggedIn: false }, codex: { installed: false, loggedIn: false } }
async function refreshAccount(id) {
  const before = JSON.stringify(accountState[id])
  try {
    accountState[id] = { ...accountState[id], ...(await abonnements.status(id)) }
  } catch (error) {
    debugLog(`abonnement ${id}, état illisible :`, error.message)
  }
  if (JSON.stringify(accountState[id]) !== before) pushChat()
  return accountState[id]
}
const accountReady = id => accountState[id].installed && accountState[id].loggedIn
function providerNote(id, p) {
  if (p.account) {
    const t = abonnements.describe(p.account)
    return accountState[p.account].installed
      ? `Connecte Nuage à ton compte ${t.account} (une seule fois) : réglages → « Comment faire marcher Nuage ».`
      : `${p.label} : Nuage installe d’abord ${t.name}, l’outil officiel (réglages → « Comment faire marcher Nuage »).`
  }
  if (p.subscription) {
    if (!claudeCode.found) return 'Claude Code est introuvable : installe l’application Claude.'
    return claudeCode.loggedIn ? '' : 'Connecte Nuage à ton compte Claude (une seule fois, sans clé d’API).'
  }
  if (p.local) return `${p.label} n’est pas détecté sur ce PC.`
  return `Ajoute ta clé ${p.keyName || p.label} pour discuter.`
}
function chatPublic() {
  // « Introuvable » jamais figé : un coup d'œil au disque (immédiat) avant de l'afficher
  if (!claudeCode.found && chatApi.findClaudeCode()) {
    claudeCode.found = true
    refreshClaudeCode().catch(() => {})
  }
  return {
    providers: Object.entries(chatApi.PROVIDERS).map(([id, p]) => {
      const ready = p.account ? accountReady(p.account) : p.subscription ? claudeCode.found && claudeCode.loggedIn : p.local ? true : secrets.has(p.secret)
      return { id, label: p.label, local: Boolean(p.local), subscription: Boolean(p.subscription), account: Boolean(p.account), efforts: p.efforts || [], ready, note: ready ? '' : providerNote(id, p) }
    }),
    provider: settings.chatProvider,
    model: settings.chatModel,
    effort: settings.chatEffort,
    streaming: chatState.streaming,
    session: chatState.session && {
      key: chatState.session.key,
      id: chatState.session.id || chatState.session.forkId || 'nouvelle', title: chatState.session.title, project: chatState.session.project,
      model: chatState.session.model, fresh: Boolean(chatState.session.fresh),
      copy: Boolean(chatState.session.forkId && !chatState.session.fresh),
    },
    permission: chatState.permission && { id: chatState.permission.id, label: chatState.permission.label, command: chatState.permission.command, tool: chatState.permission.tool },
    sessions: recentSessions().slice(0, 6).map(s => ({ id: s.id, title: s.title, project: s.project, status: s.status, lastAt: s.lastAt })),
    messages: chatState.messages.map(m => ({
      role: m.role, text: m.text, error: m.error, past: Boolean(m.past), files: (m.attachments || []).map(a => a.name),
      images: (m.images || []).map(i => ({ name: i.name, thumb: i.thumb })),
    })),
    attachments: chatState.attachments.map(a => ({
      name: a.name, kind: a.kind, thumb: a.kind === 'image' && a.data.length < 4e6 ? `data:${a.mime};base64,${a.data}` : '',
    })),
  }
}
function pushChat() {
  sendTo(encoche, 'chat:update', chatPublic())
  pushPhoneChat() // le chat du téléphone suit (même conversation)
  pushPhoneAgents() // et son onglet Agents (discussion en cours, nom de l'IA)
}
// Le chat vit dans l'encoche : on l'ouvre sur l'onglet « Chat » (l'encoche est rallumée si besoin).
// { nuage: true } : Nuage vient de plonger dans la barre et s'y installe.
function openChat({ nuage = false } = {}) {
  if (!encoche || encoche.isDestroyed()) {
    if (!settings.encocheOn) {
      applySetting('encocheOn', true)
      send('notice', 'J’ai rallumé l’encoche : le chat vit maintenant en haut de l’écran.')
    }
    createEncoche()
  }
  autoContinueSession() // le chat reprend la session Claude Code en cours (prolongement de Claude)
  prewarmChat() // Claude se prépare pendant que tu écris : la première réponse arrive plus vite
  if (encocheReady) sendTo(encoche, 'chat:open', { nuage })
  else chatOpenPending = { nuage: nuage || Boolean(chatOpenPending?.nuage) } // transmis quand l'encoche demande son état
  pushChat()
  if (Date.now() - claudeCode.checkedAt > 30_000) refreshClaudeCode()
}

// Zone « chat » pendant un glisser de Nuage : la barre (même rentrée) et ses abords seulement.
// Avant le 04/10/2026, c'était toute la largeur du haut de l'écran : Nuage replongeait dans la barre
// dès qu'on voulait le poser en haut (« je n'arrive pas à le déplacer comme je veux »).
const CHAT_ZONE = { half: 190, above: 40, below: 44 }
function inChatZone(p) {
  if (onIsland(p, 24)) return true
  const { pill } = encocheLayout()
  return Math.abs(p.x - pill.cx) <= CHAT_ZONE.half && p.y >= pill.top - CHAT_ZONE.above && p.y <= pill.top + PILL_H + CHAT_ZONE.below
}
// Le point est-il sur l'îlot (sa forme du moment, pas toute la fenêtre transparente) ?
function onIsland(p, margin = 0) {
  if (!encoche || encoche.isDestroyed() || !encoche.isVisible() || islandRect.w <= 0) return false
  const e = encoche.getBounds()
  const r = islandRect
  return p.x >= e.x + r.x - margin && p.x <= e.x + r.x + r.w + margin &&
    p.y >= e.y + r.y - margin && p.y <= e.y + r.y + r.h + margin
}
function attachPaths(paths) {
  for (const p of paths.slice(0, 10)) {
    if (chatState.attachments.length >= 10) break
    try {
      chatState.attachments.push(chatApi.attachmentFromFile(p))
    } catch (error) {
      debugLog('pièce jointe impossible :', p, error.message)
    }
  }
  pushChat()
}
// ---------- Le chat comme prolongement d'une session Claude Code ----------
// chatState.session : la session reprise ({ id, title, cwd, model, forkId }). Le premier message crée
// une copie (forkId) : tout ce qui a été dit est repris, la session d'origine n'est pas touchée.
function recentSessions() {
  return (agentState || hub.snapshot()).sessions.filter(s => s.transcript)
}
function continueSession(id) {
  const s = recentSessions().find(x => x.id === id)
  if (!s) return false
  if (chatState.streaming) chatState.abort?.abort()
  const history = chatApi.readSessionHistory(s.transcript)
  chatState.session = {
    key: crypto.randomBytes(4).toString('hex'),
    id: s.id, title: s.title, project: s.project, cwd: history.cwd || s.cwd, model: history.model, forkId: null,
  }
  chatState.messages = history.messages.map(m => ({ ...m, past: true }))
  chatState.attachments = []
  chatState.autoSession = true
  pushChat()
  coolChat()
  prewarmChat() // Claude démarre déjà pendant que tu écris
  return true
}
// Nouvelle session Claude Code (pas une copie) : dans le dossier choisi, sinon celui de la dernière session
function newSession(folder) {
  if (chatState.streaming) chatState.abort?.abort()
  const latest = recentSessions()[0]
  const history = latest ? chatApi.readSessionHistory(latest.transcript) : {}
  const cwd = folder || history.cwd || latest?.cwd || os.homedir()
  chatState.session = {
    key: crypto.randomBytes(4).toString('hex'),
    id: null, fresh: true, title: 'Nouvelle session', project: path.basename(cwd), cwd, model: history.model || '', forkId: null,
  }
  chatState.messages = []
  chatState.attachments = []
  chatState.autoSession = true
  pushChat()
  coolChat()
  prewarmChat()
}
function leaveSession() {
  if (!chatState.session) return
  if (chatState.streaming) chatState.abort?.abort()
  coolChat()
  chatState.session = null
  chatState.messages = []
  chatState.autoSession = false // l'utilisateur a choisi une discussion sans session
  pushChat()
}
// À l'ouverture d'un chat vide : on reprend la session Claude Code la plus récente (moins de 24 h).
// Seulement si l'IA choisie est Claude (abonnement) : avec OpenRouter ou une autre, Claude ne répond jamais (07/10/2026)
function autoContinueSession() {
  if (!chatApi.PROVIDERS[settings.chatProvider]?.subscription) return
  if (!chatState.autoSession || chatState.session || chatState.messages.length || chatState.streaming) return
  const latest = recentSessions().find(s => Date.now() - s.lastAt < 24 * 3600_000)
  if (latest) continueSession(latest.id)
}
// Demande d'autorisation de la session reprise : affichée dans le chat, Nuage prévient
function askChatPermission(request) {
  return new Promise(resolve => {
    chatState.permission = { id: crypto.randomBytes(6).toString('hex'), ...request, resolve }
    pushChat()
    send('agent-event', { type: 'permission', title: chatState.session?.title || chatApi.PROVIDERS[settings.chatProvider]?.label || 'Nuage', label: request.label })
  })
}
// Action de l'IA du chat (actions.js) : accord dans le chat. « Toujours » vaut pour ce genre d'action jusqu'à la prochaine
// discussion, sauf l'ajout d'une compétence ou d'un plugin (demandé à chaque fois).
// « Toujours » : seulement la même action dans cette discussion (actions.alwaysKey)
const { alwaysKey } = actionsApi
async function permitChat(tool, label, command) {
  if (chatState.always.has(alwaysKey(tool, label, command))) return true
  const r = await askChatPermission({ tool, label, command })
  if (r.always && tool !== 'installer_extension') chatState.always.add(alwaysKey(tool, label, command))
  return r.behavior === 'allow'
}
function answerChatPermission(choice) {
  const pending = chatState.permission
  if (!pending) return
  chatState.permission = null
  pending.resolve(choice === 'deny' ? { behavior: 'deny' } : { behavior: 'allow', always: choice === 'always' })
  pushChat()
}

// ---------- Claude gardé au chaud (05/10/2026) ----------
// Un claude.exe par session, ouvert entre deux messages (chat.js createSessionWorker) : plus de démarrage
// ni de relecture de toute la session à chaque message. Lancé dès que le chat s'ouvre (prewarmChat),
// fermé quand on change de session, et après 20 min sans message (pour rendre la mémoire).
let warm = null // { key, worker }
function sessionWorker(session) {
  if (warm && warm.key === session.key && warm.worker.alive()) return warm.worker
  coolChat()
  const worker = chatApi.createSessionWorker({
    resumeId: session.forkId || session.id,
    fork: !session.forkId && !session.fresh, // la session d'origine reste intacte : on travaille sur une copie
    cwd: session.cwd,
    model: session.model,
    onInit: id => {
      nuageSessionIds.add(id) // ses autorisations passent par le chat, pas par l'encoche
      if (!session.forkId && chatState.session === session && id !== session.id) session.forkId = id
    },
  })
  warm = { key: session.key, worker }
  return worker
}
function coolChat() {
  warm?.worker.kill()
  warm = null
}
function prewarmChat() {
  const s = chatState.session
  if (!s || chatState.streaming || !claudeCode.found || process.env.NUAGE_AUTOTEST_DIR) return
  try {
    sessionWorker(s)
  } catch (error) {
    debugLog('chat, préchauffage impossible :', error.message)
  }
}
setInterval(() => {
  if (warm && warm.worker.idleFor() > 20 * 60_000) coolChat()
}, 60_000)

// spoken : question dictée (« Hey Nuage ») ; Claude répond court, sa réponse sera lue à voix haute.
// from : 'pc' ou le nom du téléphone (chat de Nuage de poche). onDone(réponse) : à la fin.
const SPOKEN_NOTE = '(Question dictée à voix haute : réponds en 2 à 4 phrases courtes, sans liste, sans code ni tableau ; ta réponse sera lue à voix haute.)'
async function sendChat(text, { spoken = false, from = 'pc', onDone = null } = {}) {
  if (chatState.streaming) return false
  const where = from === 'pc' ? 'depuis le chat de Nuage, la barre du haut de l’écran' : `depuis Nuage de poche, sur le téléphone (${from})`
  // send : ce qui part vers l'IA (avec les notes) ; text : ce qui s'affiche
  const user = { role: 'user', text, send: spoken ? `${SPOKEN_NOTE}\n\n${text}` : text, attachments: chatState.attachments, spoken, from, at: Date.now() }
  chatState.attachments = []
  chatState.messages.push(user)
  const history = chatState.messages
    .filter(m => !m.error && !m.past && (m.role === 'user' || m.text))
    .map(m => (m.role === 'user' && m.send ? { ...m, text: m.send } : m))
  const answer = { role: 'assistant', text: '', at: Date.now() }
  chatState.messages.push(answer)
  const index = chatState.messages.length - 1
  chatState.streaming = true
  chatState.abort = new AbortController()
  pushChat()
  const delta = piece => {
    answer.text += piece
    sendTo(encoche, 'chat:delta', { index, text: piece })
    pushPhoneChat()
  }
  const toolLine = label => {
    chatState.tool = label // l'onglet Agents du téléphone le montre
    pushPhoneAgents()
    delta(`${answer.text && !answer.text.endsWith('\n') ? '\n' : ''}⚙ ${label}\n`)
  }
  chatState.toolLine = toolLine // outils appelés par Antigravity / Codex (serveur local, /outil)
  try {
    const session = chatState.session
    if (session) {
      const first = !session.sent
      session.sent = true
      // Nouvelle session : son titre devient la première demande
      if (first && session.fresh) session.title = short(text, 50) || 'Nouvelle session'
      const message = {
        text: first ? `(Message envoyé ${where}.)\n\n${user.send}` : from === 'pc' ? user.send : `(Envoyé ${where}.)\n\n${user.send}`,
        attachments: user.attachments,
        signal: chatState.abort.signal,
        onText: delta,
        onTool: toolLine,
        onPermission: askChatPermission,
      }
      // Claude gardé au chaud (déjà lancé à l'ouverture du chat) ; s'il s'est fermé, on en relance un
      try {
        await sessionWorker(session).send(message)
      } catch (error) {
        if (error.code !== 'FERMEE') throw error
        coolChat()
        await sessionWorker(session).send(message)
      }
      return
    }
    if (!settings.chatModel) {
      const provider = chatApi.PROVIDERS[settings.chatProvider]
      throw new Error(provider?.local
        ? `${provider.label} ne répond pas ou n’a aucun modèle installé : lance-le d’abord sur ce PC.`
        : 'Choisis d’abord un modèle.')
    }
    await chatApi.send({
      provider: settings.chatProvider,
      model: settings.chatModel,
      effort: settings.chatEffort,
      messages: history,
      signal: chatState.abort.signal,
      onText: delta,
      // L'IA choisie agit elle-même (actions.js), avec l'accord de l'utilisateur pour chaque action sur le PC
      onTool: toolLine,
      permit: permitChat,
      trash: file => shell.trashItem(file),
    })
  } catch (error) {
    let message = chatState.session ? chatApi.explainSession(error) : error.message
    if (/no conversation found|not found/i.test(error.message)) message = 'Je n’ai pas retrouvé cette session : choisis-en une autre dans le menu.'
    if (!answer.text) answer.error = message
    else answer.text += `\n\n(${message})`
    if (chatState.session || chatApi.PROVIDERS[settings.chatProvider]?.subscription) refreshClaudeCode()
  } finally {
    if (chatState.permission) answerChatPermission('deny')
    answer.images = answerImages(answer.text)
    answer.at = Date.now()
    chatState.toolLine = null
    chatState.tool = ''
    chatState.streaming = false
    chatState.abort = null
    pushChat()
    try {
      onDone?.(answer)
    } catch (error) {
      debugLog('chat, fin :', error.message)
    }
  }
  return true
}

// Images locales citées par l'IA (« ![…](file:///…) », ex. l'image créée par Gemini) : vignettes sous sa réponse
// (08/10/2026 : le chat montrait le lien brut). Le chemin reste ici : la fenêtre ne demande qu'un numéro.
function answerImages(text) {
  const found = []
  for (const m of String(text).matchAll(/!\[[^\]]*\]\(<?((?:file:\/\/\/|[A-Za-z]:[\\/])[^)>\n]+)>?\)/g)) {
    let file = m[1]
    try {
      file = file.startsWith('file:') ? require('node:url').fileURLToPath(file) : file
      if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(file) || !fs.existsSync(file) || fs.statSync(file).size > 25e6) continue
      const image = nativeImage.createFromPath(file)
      if (image.isEmpty()) continue
      found.push({ path: file, name: path.basename(file), thumb: image.resize({ width: Math.min(480, image.getSize().width) }).toDataURL() })
    } catch {
      // chemin illisible : la réponse garde son texte
    }
    if (found.length >= 6) break
  }
  return found
}

// Lâcher Nuage sur une fenêtre (Maj enfoncée) : sa capture part dans le chat
async function giveWindowContext() {
  try {
    const found = await runPowerShell('fenetre.ps1', ['-Exclure', String(process.pid)])
    if (!found.hwnd) {
      send('notice', 'Je n’ai pas trouvé de fenêtre sous moi.')
      return
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } })
    const source = sources.find(s => s.id.startsWith(`window:${found.hwnd}:`))
    if (!source || source.thumbnail.isEmpty()) {
      send('notice', 'Je n’arrive pas à voir cette fenêtre.')
      return
    }
    if (chatState.attachments.length >= 10) chatState.attachments.shift()
    chatState.attachments.push({
      kind: 'image', name: `Fenêtre « ${short(found.title, 40)} »`, mime: 'image/png', data: source.thumbnail.toPNG().toString('base64'),
    })
    openChat()
    send('notice', `Je montre « ${short(found.title, 40)} » au chat (en haut de l’écran) : pose ta question !`)
  } catch (error) {
    debugLog('contexte fenêtre :', error.message)
    send('notice', 'Je n’ai pas réussi à capturer cette fenêtre.')
  }
}

// ---------- Connexions (clés, Claude Code, encoche, sons) ----------
const AI_SECRETS = [
  { id: 'claude', label: 'Claude (Anthropic)', secret: 'anthropic', help: 'Clé d’API Anthropic (console.anthropic.com)' },
  { id: 'openai', label: 'OpenAI', secret: 'openai', help: 'Clé d’API OpenAI (platform.openai.com)' },
  { id: 'gemini', label: 'Gemini (Google)', secret: 'gemini', help: 'Clé Google AI Studio (aistudio.google.com)' },
  { id: 'openrouter', label: 'OpenRouter', secret: 'openrouter', help: 'Clé OpenRouter (openrouter.ai/keys) : une seule clé pour Claude, GPT, Gemini, Llama, Mistral…' },
]
const SETTING_KEYS = ['permissionsInNuage', 'encocheOn', 'autoHide', 'soundsOn', 'volume']
async function detectLocal(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}
async function cnxState() {
  const [ollama, lmstudio, abonnement] = await Promise.all([
    detectLocal('http://127.0.0.1:11434/api/tags'),
    detectLocal('http://127.0.0.1:1234/v1/models'),
    refreshClaudeCode(),
    ...Object.keys(accountState).map(refreshAccount),
  ])
  // Choix de l'IA (08/10/2026) : une carte par façon de faire marcher Nuage ; kind = abo | cle | local
  const card = (id, kind, extra) => ({ id, kind, current: id === settings.chatProvider, ...extra })
  const account = id => {
    const p = chatApi.PROVIDERS[id]
    const s = accountState[p.account]
    return card(id, 'abo', {
      label: p.short, short: p.short, sub: id === 'chatgpt' ? 'ton abonnement ChatGPT (Plus, Pro…)' : 'ton compte Google (Google AI Pro, Ultra…)',
      ready: s.installed && s.loggedIn, todo: s.installed ? 'à connecter' : 'à installer',
      tool: { ...abonnements.describe(p.account), installed: s.installed, loggedIn: s.loggedIn },
    })
  }
  return {
    claudeCode: {
      installed: claudeConfig.isInstalled(settings.nuageToken),
      note: agentState?.usage ? '' : 'Les limites d’utilisation s’affichent quand Claude Code utilise sa barre d’état.',
    },
    settings: Object.fromEntries(SETTING_KEYS.map(k => [k, settings[k]])),
    ai: [
      card('claudecode', 'abo', {
        label: 'Claude', short: 'Claude', sub: 'ton abonnement Claude (Pro, Max), avec l’application Claude',
        detected: abonnement.found, loggedIn: abonnement.loggedIn, ready: abonnement.found && abonnement.loggedIn,
        todo: abonnement.found ? 'à connecter' : 'application Claude absente',
      }),
      account('antigravity'),
      account('chatgpt'),
      ...AI_SECRETS.map(p => card(p.id, 'cle', { ...p, set: secrets.has(p.secret), ready: secrets.has(p.secret), todo: 'clé à ajouter' })),
      card('ollama', 'local', { label: 'Ollama', detected: ollama, ready: ollama, todo: 'pas lancé' }),
      card('lmstudio', 'local', { label: 'LM Studio', detected: lmstudio, ready: lmstudio, todo: 'pas lancé' }),
    ],
    integrations: integrationsApi.describe(),
  }
}
// Une autre fenêtre s'ouvre (tableau de bord) : l'encoche se replie, sinon elle en cache le haut
// (07/10/2026 : « dès que la seconde fenêtre s'ouvre, la première doit se refermer »)
const foldEncoche = () => sendTo(encoche, 'encoche:fold')

// ---------- Réglages : tous dans la barre (08/10/2026 : « tous les réglages du Nuage doivent être dans la barre,
// l'utilisateur ne va pas aller ailleurs ») ----------
// Plus de fenêtre « Connexions » ni de menu plein d'options : l'onglet Réglages de l'encoche (renderer/reglages.js).
// section : ia, competences, nuage, voix, ecran, claude, integrations ; welcome : tout premier lancement
// (« Comment faire marcher Nuage ? ») ; le menu de l'icône passe son élément en premier argument : seul un texte compte.
let settingsPending = null
let welcomePending = false
function openSettings(section = '', { welcome = false } = {}) {
  const request = { section: typeof section === 'string' ? section : '', welcome }
  if (welcome) welcomePending = true
  if (!encoche || encoche.isDestroyed()) {
    if (!settings.encocheOn) applySetting('encocheOn', true)
    createEncoche()
  }
  if (encocheReady) sendTo(encoche, 'reglages:open', request)
  else settingsPending = request // transmis quand l'encoche demande son état
}
// IA, intégrations, Claude Code relus (connexion faite, clé enregistrée…) : la vue Réglages se met à jour
function pushCnx() {
  if (encocheReady && encoche && !encoche.isDestroyed()) cnxState().then(s => sendTo(encoche, 'cnx:update', s)).catch(() => {})
}
// Réglages de Nuage, par groupes : la vue Réglages les dessine (interrupteur, choix, curseur, action)
const sw = (key, label, on = settings[key], extra = {}) => ({ type: 'switch', key, label, on: Boolean(on), ...extra })
const act = (id, label, extra = {}) => ({ type: 'action', id, label, ...extra })
function barGroups() {
  const voices = Object.entries(NATURAL_VOICES).filter(([id]) => natural.installed(id)).map(([id, v]) => [id, v.label])
  return [
    { section: 'nuage', title: 'Nuage', rows: [
      sw('nuageHome', 'Nuage vit dans la barre (en haut de l’écran)', settings.nuageHome === 'encoche', { disabled: !settings.encocheOn }),
      ...(homeInBar() ? [] : [
        { type: 'choice', key: 'size', label: 'Taille sur le bureau', value: settings.size, options: Object.keys(SIZES).map(k => [k, k[0].toUpperCase() + k.slice(1)]) },
        act('resetPosition', 'Remettre Nuage en bas à droite'),
      ]),
      sw('quiet', 'Mode discret (sans bulles)'),
      sw('feedOn', 'Avaler les fichiers glissés (→ Corbeille, annulable)'),
      sw('weatherOn', 'Météo sur Nuage (couleur et effets)'),
      sw('weatherLabel', 'Température sur son ventre', undefined, { disabled: !settings.weatherOn }),
      act('dashboard', 'Tableau de bord (météo)'),
    ] },
    { section: 'nuage', title: 'Rappels', rows: [
      sw('breakReminder', `Pause toutes les ${settings.breakEveryMin} min d’activité`),
      sw('waterReminder', `Boire de l’eau toutes les ${settings.waterEveryMin} min`),
      act('pomodoro', pomodoroRunning ? 'Arrêter le Pomodoro' : 'Démarrer un Pomodoro (25 min)'),
    ] },
    { section: 'nuage', title: 'Musique, vidéos et téléchargements', rows: [
      sw('mediaOn', 'Réagir à la musique et aux vidéos'),
      sw('audioReactive', 'Danser au rythme du son (analyse sur le PC)'),
      sw('cinemaQuiet', 'Rester discret en plein écran'),
      sw('downloadsOn', 'Se remplir de vert pendant les téléchargements'),
      act('extension', settings.extensionSeen ? 'Extension du navigateur : branchée ✓' : 'Pourcentage exact des téléchargements : extension Chrome / Edge'),
    ] },
    { section: 'voix', title: 'Voix', rows: [
      sw('voiceOn', 'Écouter « Hey Nuage » (micro, hors ligne)'),
      sw('voiceReplies', 'Lire les réponses à voix haute'),
      { type: 'choice', key: 'voiceName', label: 'Voix', value: natural.installed(settings.voiceName) ? settings.voiceName : 'windows', options: [...voices, ['windows', 'Celle de Windows']] },
      act('listen', 'Parler maintenant (Ctrl+Alt+H)'),
    ] },
    { section: 'voix', title: 'Barre et sons', rows: [
      sw('autoHide', 'Rentrer la barre quand rien ne se passe (elle revient au survol)'),
      act('resetBar', 'Remettre la barre en haut au centre', { disabled: !settings.encochePos }),
      sw('soundsOn', 'Sons de Nuage'),
      { type: 'range', key: 'volume', label: 'Volume', value: settings.volume ?? 0.5 },
      sw('encocheOn', 'Afficher la barre (sinon : icône de Nuage près de l’horloge pour la rallumer)'),
    ] },
    { section: 'ecran', title: 'Écran', rows: [
      sw('lockScreenOn', 'Nuage sur l’écran de verrouillage (thème Windows)'),
      sw('screensaverOn', `Écran de veille Nuage après ${Math.round(settings.screensaverDelay / 60)} min (puis verrouillage)`),
      act('screensaver', 'Lancer l’écran de veille maintenant (Ctrl+Alt+L)', { disabled: !settings.screensaverOn }),
    ] },
    { section: 'ecran', title: 'Windows', rows: [
      sw('openAtLogin', 'Lancer Nuage au démarrage de Windows', app.getLoginItemSettings(loginOptions()).openAtLogin),
      act('restart', 'Redémarrer Nuage'),
      act('quit', 'Quitter Nuage', { danger: true }),
    ] },
  ]
}
function pushBar() {
  if (encocheReady && encoche && !encoche.isDestroyed()) sendTo(encoche, 'reglages:bar', barGroups())
}
// Un réglage changé dans la barre : même effet qu'avant dans le menu de l'icône
const BAR_SIMPLE = new Set(['quiet', 'feedOn', 'weatherLabel', 'breakReminder', 'waterReminder', 'audioReactive', 'cinemaQuiet', 'voiceReplies'])
async function setBarSetting(key, value) {
  const on = Boolean(value)
  if (BAR_SIMPLE.has(key)) updateSettings({ [key]: on })
  else if (key === 'nuageHome') setNuageHome(on ? 'encoche' : 'bureau')
  else if (key === 'size' && SIZES[value]) resize(value)
  else if (key === 'weatherOn') {
    updateSettings({ weatherOn: on })
    refreshWeather()
  } else if (key === 'mediaOn') {
    updateSettings({ mediaOn: on })
    if (on) startMediaWatcher()
    else stopMediaWatcher()
  } else if (key === 'downloadsOn') {
    updateSettings({ downloadsOn: on })
    if (on) startDownloads()
    else stopDownloads()
  } else if (key === 'voiceOn') setVoiceOn(on)
  else if (key === 'voiceName' && (value === 'windows' || NATURAL_VOICES[value])) chooseVoice(String(value))
  else if (SETTING_KEYS.includes(key)) applySetting(key, value)
  else if (key === 'lockScreenOn') await setLockScreen(on)
  else if (key === 'screensaverOn') await setScreensaver(on)
  else if (key === 'openAtLogin') app.setLoginItemSettings({ ...loginOptions(), openAtLogin: on })
  refreshMenu()
}
function barAction(id) {
  if (id === 'resetPosition') resetPosition()
  else if (id === 'resetBar') {
    settings.encochePos = null
    saveSettings()
    placeEncoche()
  } else if (id === 'pomodoro') send('pomodoro', pomodoroRunning ? 'stop' : 'start')
  else if (id === 'extension') showExtensionHelp()
  else if (id === 'dashboard') togglePanel()
  else if (id === 'listen') listenNow()
  else if (id === 'screensaver') launchScreensaver()
  else if (id === 'restart') {
    app.relaunch()
    app.quit()
  } else if (id === 'quit') app.quit()
  refreshMenu()
}
async function setLockScreen(on) {
  updateSettings({ lockScreenOn: on })
  if (on) {
    const ok = await applyLockScreen({ force: true })
    send('notice', ok ? 'C’est fait ! Verrouille ton PC (Windows + L) pour me voir en grand 😴' : 'Je n’ai pas réussi à changer l’écran de verrouillage.')
  } else {
    const ok = await restoreLockScreen()
    send('notice', ok ? 'Ton ancienne image de verrouillage est revenue.' : 'Remets ton image dans Paramètres > Personnalisation > Écran de verrouillage.')
  }
}
async function setScreensaver(on) {
  updateSettings({ screensaverOn: on })
  try {
    if (on) {
      await installScreensaver()
      send('notice', 'Écran de veille installé ! Ctrl+Alt+L pour me lancer en plein écran quand tu pars 😴')
    } else {
      await removeScreensaver()
      send('notice', 'Écran de veille retiré : tes anciens réglages sont revenus.')
    }
  } catch (error) {
    console.error('Écran de veille :', error)
    send('notice', 'Je n’ai pas réussi à régler l’écran de veille.')
  }
  registerVeilleShortcut()
}
function applySetting(key, value) {
  updateSettings({ [key]: key === 'volume' ? Math.min(1, Math.max(0, Number(value) || 0)) : Boolean(value) })
  if (key === 'permissionsInNuage') hub.setPermissionsInNuage(settings.permissionsInNuage)
  if (key === 'encocheOn') {
    if (settings.encocheOn) createEncoche()
    else destroyEncoche()
    if (settings.nuageHome === 'encoche') {
      send('settings', publicSettings())
      if (settings.encocheOn) win?.hide()
      else showNuage() // plus d'encoche : Nuage revient sur le bureau
    }
  }
  sendTo(encoche, 'encoche-settings', encocheSettings())
}

// ---------- Menu (icône de notification et clic droit sur Nuage) ----------
const loginOptions = () =>
  app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] }
// Raccourcis « Nuage » sur le bureau et dans le menu Démarrer (17/10/2026 : « il est obligé de retourner à chaque
// fois dans le dossier ? ») : faits une seule fois, sans écraser un raccourci existant ; supprimés, ils ne reviennent pas
function makeShortcuts() {
  if (process.platform !== 'win32' || settings.shortcutsMade || process.env.NUAGE_AUTOTEST_DIR) return
  const { path: target = process.execPath, args = [] } = loginOptions()
  const link = {
    target, args: args.map(a => `"${a}"`).join(' '), cwd: path.resolve(__dirname),
    icon: path.join(__dirname, 'assets', 'nuage.ico'), iconIndex: 0, description: 'Nuage, compagnon de bureau',
  }
  for (const dir of [userDir('desktop'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]) {
    const file = path.join(dir, 'Nuage.lnk')
    if (fs.existsSync(file)) continue
    if (!shell.writeShortcutLink(file, 'create', link)) debugLog('raccourci non créé :', file)
  }
  updateSettings({ shortcutsMade: true })
}

function buildMenu() {
  // Tous les réglages sont dans la barre (08/10/2026) : ici, seulement de quoi l'ouvrir (même si elle est éteinte)
  return Menu.buildFromTemplate([
    { label: 'Nuage', enabled: false },
    { type: 'separator' },
    {
      label: homeInBar() ? 'Ouvrir la barre (Nuage y habite)' : win && win.isVisible() ? 'Masquer Nuage' : 'Afficher Nuage',
      accelerator: 'Ctrl+Alt+N',
      click: toggleVisible,
    },
    { label: 'Réglages (dans la barre en haut de l’écran)', click: () => openSettings('ia') },
    { type: 'separator' },
    // Après une modification de Nuage (par exemple demandée à Claude dans le chat) : il se ferme et se rouvre
    {
      label: 'Redémarrer Nuage',
      click: () => {
        app.relaunch()
        app.quit()
      },
    },
    { label: 'Quitter Nuage', click: () => app.quit() },
  ])
}
function refreshMenu() {
  if (tray) tray.setContextMenu(buildMenu())
  pushBar() // la vue Réglages suit (Pomodoro, téléphones, réglages changés)
}

// ---------- Téléchargements : Nuage se remplit de vert, puis annonce la fin ----------
// Dossier Téléchargements (taille reçue seulement) et, si elle est installée, l'extension de
// navigateur (taille totale : pourcentage exact). Voir telechargements.js.
const EXTENSION_DIR = path.join(__dirname, 'extension-navigateur')
let downloads = null
const finishedDownloads = new Set() // fichiers annoncés : seuls ceux-là peuvent être montrés dans l'Explorateur
function onDownloadEvent(event) {
  if (event.type === 'done') {
    finishedDownloads.add(event.path)
    notifyPhone('Téléchargement terminé sur le PC', event.name, 'telechargement')
    // Nuage est caché (ou dans la barre) : il ne peut pas le dire lui-même, Windows prévient
    if ((!win || !win.isVisible()) && Notification.isSupported()) {
      const note = new Notification({ title: 'Téléchargement terminé', body: event.name, icon: path.join(__dirname, 'assets', 'nuage.png') })
      note.on('click', () => shell.showItemInFolder(event.path))
      note.show()
    }
  }
  send('download', event)
}
function startDownloads() {
  if (downloads || !settings.downloadsOn) return
  downloads = createDownloadWatcher({ folders: [userDir('downloads')], onEvent: onDownloadEvent, log: debugLog })
  downloads.start()
}
function stopDownloads() {
  downloads?.stop()
  downloads = null
  send('download', { type: 'idle' })
}
// Code d'accès de l'extension, relu par elle dans son dossier (jamais celui des hooks de Claude Code)
function writeExtensionToken() {
  if (!settings.downloadToken) {
    settings.downloadToken = crypto.randomBytes(18).toString('hex')
    saveSettings()
  }
  if (process.env.NUAGE_AUTOTEST_DIR) return // réglages de test : ne pas toucher le vrai fichier
  try {
    fs.writeFileSync(path.join(EXTENSION_DIR, 'jeton.json'), JSON.stringify({ port: 47823, jeton: settings.downloadToken }), 'utf8')
  } catch (error) {
    debugLog('extension, jeton non écrit :', error.message)
  }
}
function showExtensionHelp() {
  shell.openPath(EXTENSION_DIR)
  send('notice', 'Pour le pourcentage exact : dans Chrome ou Edge, ouvre la page des extensions, active le « mode développeur », clique « Charger l’extension non empaquetée » et choisis ce dossier.')
}
ipcMain.on('download:show', (event, file) => {
  if (fromWindow(event) && finishedDownloads.has(file) && fs.existsSync(file)) shell.showItemInFolder(file)
})

// ---------- Lien avec le téléphone (Nuage de poche, Android) ----------
// Fichiers dans les deux sens, copier-coller, notifications ; réseau local seulement, tout chiffré
// (voir lien.js). Fichiers reçus : Téléchargements\Nuage. La clé est gardée chiffrée par Windows.
const APK_FILE = path.join(__dirname, 'telephone', 'nuage-de-poche.apk')
let link = null
let lastClipboard = ''
const linkInbox = () => path.join(userDir('downloads'), 'Nuage')
const shortName = (text, max = 40) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text))
function getLink() {
  if (link) return link
  link = createLink({
    store: {
      load: () => {
        try {
          return JSON.parse(secrets.get('lien') || 'null')
        } catch {
          return null
        }
      },
      save: s => secrets.set('lien', s ? JSON.stringify(s) : ''),
    },
    inbox: linkInbox(),
    pcName: os.hostname(),
    onEvent: onLinkEvent,
    onTrace: writeLinkTrace,
    log: debugLog,
    api: phoneApi,
    // La météo du PC (sa ville, réglée ou détectée) : sur un routeur 4G, le téléphone devinait une autre
    // ville d'après son adresse Internet (« la météo du téléphone se trompe », 05/10/2026)
    extra: () => (lastWeather ? { meteo: { key: lastWeather.key, label: lastWeather.label, night: Boolean(lastWeather.night), temp: lastWeather.temp, place: lastWeather.place || '' } } : {}),
  })
  return link
}

// ---------- Chat du téléphone (05/10/2026) ----------
// Le téléphone parle au même chat que la barre du haut : ta session Claude Code du PC (ou une discussion
// simple), avec ton abonnement Claude, sans clé ni frais en plus. Il le pilote par /v1/api/chat-… (lien.js)
// et reçoit l'état du chat dans sa boîte tant que l'écran du chat est ouvert sur le téléphone.
const phoneChatOpen = new Map() // appareil → écran du chat ouvert jusqu'à (ms), renouvelé par le téléphone
let phoneChatTimer = null
const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text))
function chatForPhone() {
  const pub = chatPublic()
  const provider = pub.providers.find(p => p.id === pub.provider)
  const subscriptionReady = claudeCode.found && claudeCode.loggedIn
  const ready = chatState.session ? subscriptionReady : Boolean(provider?.ready)
  return {
    streaming: chatState.streaming,
    fournisseur: chatState.session ? 'Claude Code (ton abonnement)' : provider?.label || '',
    ia: chatAiName(),
    pret: ready,
    note: ready ? '' : chatState.session ? providerNote('claudecode', chatApi.PROVIDERS.claudecode) : provider?.note || '',
    session: chatState.session && {
      titre: chatState.session.title, projet: chatState.session.project,
      copie: Boolean(chatState.session.forkId && !chatState.session.fresh), nouvelle: Boolean(chatState.session.fresh),
    },
    sessions: recentSessions().slice(0, 8).map(s => ({ id: s.id, titre: s.title, projet: s.project, statut: s.status, at: s.lastAt })),
    messages: chatState.messages.slice(-40).map(m => ({
      // [[installer: X]] : un bouton sur le PC seulement (les réglages y sont), un simple texte sur le téléphone
      role: m.role, texte: clip(String(m.text || '').replace(/\[\[\s*installer\s*:\s*(.+?)\s*\]\]/gi, '→ $1 (à installer depuis le PC)'), 8000), erreur: m.error || '', passe: Boolean(m.past),
      fichiers: (m.attachments || []).map(a => a.name), voix: Boolean(m.spoken), de: m.from && m.from !== 'pc' ? 'telephone' : m.role === 'user' ? 'pc' : '',
    })),
    permission: chatState.permission && { id: chatState.permission.id, label: chatState.permission.label, commande: chatState.permission.command || '' },
  }
}
function pushPhoneChat() {
  if (!link || phoneChatTimer) return
  phoneChatTimer = setTimeout(() => {
    phoneChatTimer = null
    const now = Date.now()
    const targets = [...phoneChatOpen].filter(([, until]) => until > now).map(([id]) => id)
    if (!targets.length) return
    const etat = chatForPhone()
    for (const id of targets) link.sendChatState(id, etat)
  }, 350) // pendant une réponse : au plus ~3 envois par seconde
}
async function phoneApi(nom, donnees, device) {
  // Agents de code (Coucou sur iPhone, version Nuage de poche) : état, détail d'une session, réponse à une demande
  if (nom === 'agents-etat') return phoneAgentsSummary()
  if (nom === 'agents-session') {
    const detail = agentsPhone.sessionDetail(agentState || hub.snapshot(), (sid, stepId) => hub.stepDetail(sid, stepId), String(donnees.id || ''))
    if (!detail) throw new Error('Session introuvable sur le PC (trop ancienne ?).')
    return detail
  }
  if (nom === 'agents-repondre') {
    const choix = String(donnees.choix || '')
    if (!['allow', 'deny', 'always'].includes(choix)) throw new Error('Choix inconnu.')
    const request = (agentState || hub.snapshot()).permissions.find(p => p.id === String(donnees.id || ''))
    if (!hub.resolvePermission(String(donnees.id || ''), choix)) throw new Error('Cette demande n’attend plus (déjà répondue ou expirée).')
    countOk(choix)
    const how = donnees.preuve === 'biometrie' ? ' (empreinte)' : donnees.preuve === 'code' ? ' (code du téléphone)' : ''
    send('notice', choix === 'deny'
      ? `📱 ${device.nom || 'Le téléphone'} a refusé : ${request?.label || 'la demande'}.`
      : `📱 ${device.nom || 'Le téléphone'} a autorisé${how} : ${request?.label || 'la demande'}.`)
    return phoneAgentsSummary()
  }
  if (nom === 'chat-ferme') {
    phoneChatOpen.delete(device.id)
    return null
  }
  phoneChatOpen.set(device.id, Date.now() + 70_000)
  if (nom === 'chat-etat') {
    if (Date.now() - claudeCode.checkedAt > 30_000) await refreshClaudeCode()
    autoContinueSession() // comme à l'ouverture du chat sur le PC : la session Claude Code en cours
    prewarmChat()
    return chatForPhone()
  }
  if (nom === 'chat-envoyer') {
    const texte = String(donnees.texte || '').trim().slice(0, 20_000)
    if (!texte) throw new Error('Message vide.')
    if (chatState.streaming) throw new Error('Claude répond déjà : attends la fin de sa réponse.')
    autoContinueSession()
    sendChat(texte, { spoken: donnees.voix === true, from: device.nom || 'téléphone' })
    return chatForPhone()
  }
  if (nom === 'chat-session') {
    if (donnees.action === 'continuer') {
      if (!continueSession(String(donnees.id || ''))) throw new Error('Session introuvable sur le PC.')
    } else if (donnees.action === 'nouvelle') newSession('')
    else if (donnees.action === 'quitter') leaveSession()
    else throw new Error('Choix inconnu.')
    return chatForPhone()
  }
  if (nom === 'chat-permission') {
    if (chatState.permission?.id === String(donnees.id)) answerChatPermission(String(donnees.choix))
    return chatForPhone()
  }
  if (nom === 'chat-stop') {
    chatState.abort?.abort()
    if (chatState.permission) answerChatPermission('deny')
    return chatForPhone()
  }
  throw new Error('Demande inconnue : mets à jour Nuage sur le PC.')
}
async function startLink() {
  if (process.env.NUAGE_AUTOTEST_DIR) return getLink() // l'auto-test ne s'ouvre pas au réseau
  const l = getLink()
  if (!l.running()) {
    await l.start()
    refreshNetDiag()
  }
  return l
}
function stopLink() {
  link?.stop()
}
const phones = () => (link ? link.devices() : [])
// Journal du lien : %APPDATA%\Nuage\etat-lien.json (adresses, méthodes et chemins seulement, jamais de contenu ;
// reste sur ce PC). C'est ce qui dit si les paquets du téléphone arrivent jusqu'ici.
let linkTraceTimer = null
function writeLinkTrace() {
  if (linkTraceTimer || process.env.NUAGE_AUTOTEST_DIR) return
  linkTraceTimer = setTimeout(() => {
    linkTraceTimer = null
    try {
      const lines = (link?.traces() || []).map(t => `${new Date(t.at).toISOString()} ${t.type}${t.de ? ` de ${t.de}` : ''}${t.quoi ? ` : cherche ${t.quoi}${t.repond ? ' (répondu)' : ' (ignoré)'}` : ''}${t.requete ? ` : ${t.requete}` : ''}${t.statut ? ` -> ${t.statut}` : ''}${t.erreur ? ` : ERREUR ${t.erreur}` : ''}`)
      const state = { ecrit: new Date().toISOString(), adresses: lanDetails().map(x => `${x.address} (${x.card})`), port: link?.port?.() || 47824, journal: lines }
      fs.writeFileSync(path.join(app.getPath('userData'), 'etat-lien.json'), JSON.stringify(state, null, 1), 'utf8')
    } catch (error) {
      debugLog('journal du lien :', error.message)
    }
  }, 800)
}
function setLinkOn(on) {
  updateSettings({ linkOn: Boolean(on) })
  if (on) startLink().then(pushPhone)
  else stopLink()
  pushPhone()
}

// ---------- Menu « Téléphone » de la barre du haut (04/10/2026) ----------
// Tout ce qui concerne Nuage de poche au même endroit : le téléphone (batterie, version, en ligne),
// fichiers, presse-papiers, « fais-le sonner », copier-coller dans les deux sens et son historique,
// derniers transferts, nouvelles envoyées au téléphone, association. L'historique du presse-papiers
// reste en mémoire (jamais écrit sur le disque) et s'efface quand Nuage se ferme.
const phoneHistory = [] // { sens: 'recu' | 'envoye', texte, at, appareil, source }
const phoneTransfers = [] // { id, sens: 'recu' | 'envoi', nom, taille, fait, etat, chemin, at }
let phoneRinging = 0 // heure de la demande de sonnerie (0 : ne sonne pas)
let phonePushTimer = null
function remember(list, item, max) {
  list.unshift(item)
  if (list.length > max) list.length = max
}
function rememberClip(sens, texte, appareil = '', source = '') {
  remember(phoneHistory, { sens, texte: String(texte).slice(0, 200_000), at: Date.now(), appareil, source }, 12)
}
function trackTransfer(id, patch) {
  let t = phoneTransfers.find(x => x.id === id)
  if (!t) {
    t = { id, at: Date.now(), fait: 0, etat: 'en-cours' }
    remember(phoneTransfers, t, 10)
  }
  Object.assign(t, patch)
}
// ---------- Diagnostic de la connexion (05/10/2026) ----------
// « Ils sont sur le même réseau mais n'arrivent pas à communiquer. » Causes vues sur ce PC : le pare-feu de
// Windows n'autorisait Nuage que sur les réseaux « Publics » (un réseau « Privé » le bloquait sans rien
// dire), et un téléphone associé quand le PC avait une autre adresse frappait à la mauvaise porte.
// reseau.ps1 lit (sans rien changer) le type du réseau et les règles du pare-feu ; lien.js signale les
// téléphones refusés (ancien QR code, téléphone oublié, horloge fausse).
let netDiag = null // { reseaux, autorise, bloque, pareFeuActif }
let lastRefusal = null // { raison, adresse, at }
let netDiagBusy = false
async function refreshNetDiag() {
  if (netDiagBusy || process.env.NUAGE_AUTOTEST_DIR) return
  netDiagBusy = true
  try {
    netDiag = await runPowerShell('reseau.ps1', ['-Programme', process.execPath])
    pushPhone()
  } catch (error) {
    debugLog('diagnostic réseau :', error.message)
  } finally {
    netDiagBusy = false
  }
}
function diagState() {
  const net = netDiag?.reseaux?.find(r => r.internet) || netDiag?.reseaux?.[0] || null
  const category = net?.categorie // Public | Private | DomainAuthenticated
  const profile = category === 'DomainAuthenticated' ? 'Domain' : category
  const blocked = Boolean(profile && netDiag?.pareFeuActif?.[profile] !== false && (!netDiag.autorise?.[profile] || netDiag.bloque?.[profile]))
  return {
    adresses: lanAddresses(),
    cartes: lanDetails().map(x => ({ adresse: x.address, carte: x.card })),
    recherche: link?.lastSearch?.() || null,
    port: link?.port?.() || 47824,
    reseau: net ? { nom: net.nom, type: category === 'Private' ? 'Privé' : category === 'Public' ? 'Public' : category === 'DomainAuthenticated' ? 'Domaine' : category } : null,
    bloque: blocked,
    autoriseSur: netDiag ? ['Public', 'Private'].filter(p => netDiag.autorise?.[p]).map(p => (p === 'Private' ? 'Privé' : p)) : [],
    refus: lastRefusal && Date.now() - lastRefusal.at < 15 * 60_000 ? lastRefusal : null,
  }
}
function openFirewallApps() {
  // La page « Autoriser des applications via le pare-feu » : c'est l'utilisateur qui coche
  spawn('control.exe', ['/name', 'Microsoft.WindowsFirewall', '/page', 'pageConfigureApps'], { windowsHide: false, detached: true, stdio: 'ignore' })
    .on('error', () => shell.openExternal('ms-settings:windowsdefender'))
    .unref()
}

// ---------- Le téléphone charge (05/10/2026 : « une animation quand je charge le tel, donne-toi à fond ») ----------
// Branché : Nuage se remplit d'énergie jusqu'au niveau de la batterie, des éclairs autour de lui, puis une
// capsule ⚡ suit la charge sous lui ; plein : il le dit ; débranché : la capsule s'en va. Le téléphone
// prévient tout de suite (/v1/etat) et à chaque pour cent. « Plein dans ~ » : vitesse de charge mesurée.
const chargeMemory = new Map() // appareil → { charge, niveau, plein, debut: { at, niveau } }
function chargeEta(id) {
  const m = chargeMemory.get(id)
  if (!m?.charge || !m.debut || m.niveau >= 100) return null
  const gained = m.niveau - m.debut.niveau
  const minutes = (Date.now() - m.debut.at) / 60_000
  if (gained < 2 || minutes < 1) return null
  return Math.max(1, Math.round((100 - m.niveau) / (gained / minutes)))
}
function phoneChargeChanged(d) {
  const e = d.etat
  if (!e || e.batterie === null || e.batterie === undefined) return
  const before = chargeMemory.get(d.id)
  const niveau = e.batterie
  const now = { charge: e.charge, niveau, plein: Boolean(before?.plein && e.charge), debut: e.charge ? before?.debut || { at: Date.now(), niveau } : null }
  chargeMemory.set(d.id, now)
  const base = { niveau, nom: d.nom, id: d.id }
  if (!before) {
    if (e.charge) send('phone-charge', { ...base, etat: 'charge', silencieux: true }) // déjà en charge au démarrage : la capsule, sans annonce
    return
  }
  if (e.charge && !before.charge) send('phone-charge', { ...base, etat: 'branche' })
  else if (!e.charge && before.charge) send('phone-charge', { ...base, etat: 'debranche' })
  else if (e.charge && niveau >= 100 && !now.plein) {
    now.plein = true
    send('phone-charge', { ...base, etat: 'plein' })
    notifyPhone('Téléphone chargé à 100 %', 'Tu peux le débrancher.', 'charge')
  } else if (e.charge && niveau !== before.niveau) send('phone-charge', { ...base, etat: 'charge', eta: chargeEta(d.id) })
}

function phoneState() {
  if (phoneRinging && Date.now() - phoneRinging > 60_000) phoneRinging = 0 // le téléphone s'arrête seul au bout d'une minute
  return {
    diag: diagState(),
    devices: phones().map(d => ({ id: d.id, nom: d.nom, modele: d.modele, online: d.online, lastSeen: d.lastSeen, pairedAt: d.pairedAt, etat: d.etat, adresse: d.adresse, etaPlein: chargeEta(d.id) })),
    linkOn: settings.linkOn,
    running: Boolean(link?.running()),
    clipboardShare: settings.clipboardShare,
    notifyClaude: settings.phoneNotifyClaude,
    notifyDownloads: settings.phoneNotifyDownloads,
    ringing: Boolean(phoneRinging),
    // Aperçu seulement (une ligne) : le texte complet reste ici pour « recopier »
    history: phoneHistory.map(h => ({ sens: h.sens, texte: shortName(h.texte.replace(/\s+/g, ' ').trim(), 120), longueur: h.texte.length, at: h.at, appareil: h.appareil, source: h.source })),
    transfers: phoneTransfers.map(t => ({ ...t, chemin: t.chemin ? path.basename(t.chemin) : '', peutOuvrir: Boolean(t.chemin && fs.existsSync(t.chemin)) })),
    apk: fs.existsSync(APK_FILE),
  }
}
// Regroupe les mises à jour (un transfert en envoie une par morceau)
function pushPhone() {
  if (phonePushTimer) return
  phonePushTimer = setTimeout(() => {
    phonePushTimer = null
    sendTo(encoche, 'telephone', phoneState())
  }, 120)
}
let phoneTabPending = false
function openPhoneMenu() {
  if (!encoche || encoche.isDestroyed()) {
    if (!settings.encocheOn) applySetting('encocheOn', true)
    createEncoche()
  }
  if (encocheReady) sendTo(encoche, 'encoche:tab', 'telephone')
  else phoneTabPending = true // transmis quand l'encoche demande son état
}
function ringPhone(on) {
  if (!phones().length) return send('notice', '📱 Associe d’abord ton téléphone : barre du haut → Téléphone → « Associer ».')
  getLink().ring(on)
  phoneRinging = on ? Date.now() : 0
  if (on) send('notice', '🔔 Ton téléphone va sonner, même en silencieux. Touche « Je l’ai trouvé » pour l’arrêter.')
  pushPhone()
}
async function confirmForgetPhones(parent) {
  const answer = await dialog.showMessageBox(parent && !parent.isDestroyed() ? parent : undefined, {
    type: 'question', buttons: ['Oublier', 'Annuler'], defaultId: 1, cancelId: 1, title: 'Oublier les téléphones',
    message: 'Oublier tous les téléphones associés ?', detail: 'Il faudra rescanner le QR code depuis l’application.',
  })
  if (answer.response !== 0) return false
  getLink().forget()
  refreshMenu()
  pushPhone()
  return true
}
// Association par le Wi-Fi (06/10/2026) : un téléphone de ce réseau demande à se connecter. Rien ne se fait
// sans l'accord de l'utilisateur ; le code à 6 chiffres doit être le même que sur le téléphone.
let pairDialogOpen = false
async function askPairing(d) {
  if (pairDialogOpen) return
  pairDialogOpen = true
  send('notice', `📱 ${d.nom} veut se connecter à Nuage : réponds dans la fenêtre qui vient de s’ouvrir.`)
  // v1.8 : Windows ne laisse pas une appli d'arrière-plan passer devant les autres (le même piège que Nuage
  // contourne avec le niveau « screen-saver », voir showNuage) : la fenêtre « Accepter / Refuser » pouvait
  // s'ouvrir cachée derrière un navigateur ou un film, et la demande expirait sans qu'on l'ait vue. Elle est
  // donc rattachée à une fenêtre invisible (2 px, transparente) placée au milieu de l'écran, au niveau le plus
  // haut : une fenêtre fille reste au-dessus de sa mère.
  let anchor = null
  try {
    const area = screen.getPrimaryDisplay().workArea
    anchor = new BrowserWindow({
      width: 2, height: 2, x: Math.round(area.x + area.width / 2), y: Math.round(area.y + area.height / 2),
      show: false, frame: false, transparent: true, skipTaskbar: true, resizable: false, hasShadow: false,
    })
    anchor.setAlwaysOnTop(true, 'screen-saver')
    anchor.showInactive()
    anchor.moveTop()
  } catch (error) {
    debugLog('fenêtre d’ancrage de la demande :', error.message)
    if (anchor && !anchor.isDestroyed()) anchor.destroy()
    anchor = null
  }
  const options = {
    type: 'question',
    title: 'Nuage : un téléphone veut se connecter',
    message: `« ${d.nom} » veut se connecter à Nuage.`,
    detail: `Code affiché sur le téléphone : ${d.code.slice(0, 3)} ${d.code.slice(3)}\n\nAccepte seulement si c’est ton téléphone et que le même code s’affiche dessus. Il pourra ensuite échanger fichiers, copier-coller et messages avec ce PC, sur le Wi-Fi.`,
    buttons: ['Accepter', 'Refuser'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  try {
    let response
    try {
      ;({ response } = await dialog.showMessageBox(...(anchor && !anchor.isDestroyed() ? [anchor] : []), options))
    } catch (error) {
      // Le rattachement a échoué : la même fenêtre, sans parent (mieux vaut une fenêtre peut-être cachée que pas de réponse)
      debugLog('fenêtre de la demande avec ancrage impossible, essai sans :', error.message)
      ;({ response } = await dialog.showMessageBox(options))
    }
    const ok = response === 0 ? link?.acceptPairing(d.id) : link?.refusePairing(d.id)
    if (response === 0 && !ok) send('notice', '📱 La demande a expiré : relance-la depuis le téléphone.')
  } finally {
    pairDialogOpen = false
    if (anchor && !anchor.isDestroyed()) anchor.destroy()
  }
}
// Mise à jour de l'appli par le lien (06/10/2026 : « l'appli se met à jour toute seule ») : téléphone en version
// plus ancienne que l'APK du PC (telephone\nuage-de-poche.version, écrit par construire-apk.mjs) → l'APK part
// par le lien chiffré, une fois par version et par téléphone ; le téléphone affiche « Mettre à jour » (Android
// demande confirmation et vérifie que l'APK est signé comme l'appli installée).
const isNewer = (a, b) => {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}
const updateOffered = new Map() // id du téléphone → version envoyée
function offerPhoneUpdate(device) {
  const phoneVersion = device?.etat?.version
  if (!link || !phoneVersion || process.env.NUAGE_AUTOTEST_DIR) return
  let apkVersion = ''
  try {
    apkVersion = fs.readFileSync(APK_FILE.replace(/\.apk$/, '.version'), 'utf8').trim()
  } catch {
    return // APK construit avant le 06/10/2026 : version inconnue
  }
  if (!isNewer(apkVersion, phoneVersion) || updateOffered.get(device.id) === apkVersion) return
  try {
    link.sendFile(APK_FILE, { deviceId: device.id, maj: apkVersion })
    updateOffered.set(device.id, apkVersion)
    debugLog(`téléphone ${phoneVersion} → mise à jour ${apkVersion} envoyée`)
  } catch (error) {
    debugLog('mise à jour du téléphone impossible :', error.message)
  }
}
function onLinkEvent(e) {
  if (e.type === 'pair-request') {
    askPairing(e.demande)
    return
  }
  if (e.type === 'recherche') {
    pushPhone()
    return
  }
  if (e.type === 'paired') {
    send('notice', `📱 Téléphone associé : ${e.device.nom}. On peut s’échanger fichiers et copier-coller !`)
    refreshMenu()
  } else if (e.type === 'seen') {
    refreshMenu()
  } else if (e.type === 'clipboard') {
    // Copié sur le téléphone → collable sur le PC (sans afficher le contenu, qui peut être privé)
    if (e.image) {
      const image = nativeImage.createFromDataURL(e.image.startsWith('data:') ? e.image : `data:image/png;base64,${e.image}`)
      if (!image.isEmpty()) clipboard.write([pngItem(image.toPNG())]).catch(error => debugLog('presse-papiers, image :', error.message))
      send('notice', `📋 Image copiée depuis ${e.appareil} : Ctrl+V pour la coller.`)
    } else {
      // Déjà dans le presse-papiers du PC : on ne réécrit pas, mais on le dit (avant, rien ne s'affichait)
      const texte = e.texte
      lastClipboard = texte // ne repart pas vers le téléphone
      clipboard.readText().catch(() => '').then(current => {
        const already = texte === current
        if (!already) clipboard.writeText(texte)
        rememberClip('recu', texte, e.appareil, e.source)
        send('notice', already
          ? `📋 ${e.appareil} : ce texte est déjà dans le presse-papiers du PC (Ctrl+V).`
          : `📋 Copié depuis ${e.appareil} (${texte.length} caractère${texte.length > 1 ? 's' : ''}) : Ctrl+V pour le coller.`)
      })
    }
  } else if (e.type === 'state') {
    phoneChargeChanged(e.device)
    offerPhoneUpdate(e.device)
  } else if (e.type === 'refus') {
    const first = !lastRefusal || lastRefusal.raison !== e.raison
    lastRefusal = { raison: e.raison, adresse: e.adresse, at: e.at }
    if (first) {
      send('notice', e.raison === 'horloge'
        ? '📱 Le téléphone essaie de me joindre, mais son heure est fausse : règle-la sur « automatique ».'
        : '📱 Le téléphone essaie de me joindre avec un ancien QR code : dans l’appli, « Oublier ce PC », puis rescanne le QR code (menu Téléphone, Associer).')
    }
  } else if (e.type === 'signal') {
    if (e.signal === 'coucou') send('notice', `👋 Coucou de ${e.appareil} ! Le lien marche.`)
    else if (e.signal === 'trouve') {
      phoneRinging = 0
      send('notice', `📱 ${e.appareil} retrouvé !`)
    }
  } else if (e.type === 'incoming') {
    trackTransfer(e.id, {
      sens: 'recu', nom: e.nom, ...(e.taille !== undefined && { taille: e.taille }), fait: e.phase === 'done' ? e.taille : e.recu || 0,
      etat: e.phase === 'done' ? 'fini' : e.phase === 'cancel' ? 'annule' : 'en-cours', ...(e.chemin && { chemin: e.chemin }),
    })
    // Fichier du téléphone : même animation que les téléchargements (Nuage se remplit)
    if (e.phase === 'done') finishedDownloads.add(e.chemin)
    const map = { start: 'progress', progress: 'progress', done: 'done', cancel: 'cancel' }
    send('download', {
      type: map[e.phase], source: 'telephone', count: 1, name: e.nom, received: e.recu || 0, total: e.taille,
      percent: e.taille ? Math.min(100, ((e.recu || 0) / e.taille) * 100) : 100, exact: true, startedAt: Date.now(),
      path: e.chemin, size: e.taille, from: e.appareil,
    })
  } else if (e.type === 'outgoing') {
    if (e.phase === 'cancel') {
      // Jamais téléchargé par le téléphone en 24 h, ou fichier effacé entre-temps
      if (phoneTransfers.some(t => t.id === e.id)) trackTransfer(e.id, { etat: 'annule' })
    } else if (e.phase !== 'start' || e.appareils) {
      trackTransfer(e.id, {
        sens: 'envoi', nom: e.nom, ...(e.taille !== undefined && { taille: e.taille }), fait: e.phase === 'done' ? e.taille : e.envoye || 0, etat: e.phase === 'done' ? 'fini' : 'en-cours',
      })
    }
    if (e.phase === 'start' && !e.appareils) send('notice', '📱 Aucun téléphone associé : barre du haut → Téléphone → « Associer ».')
    else if (e.phase === 'done') send('download', { type: 'done', source: 'envoi', name: e.nom, size: e.taille, to: e.appareil })
    else if (e.phase === 'progress') {
      send('download', { type: 'progress', source: 'envoi', count: 1, name: e.nom, received: e.envoye, total: e.taille, percent: e.taille ? (e.envoye / e.taille) * 100 : 100, exact: true, startedAt: Date.now() })
    }
  } else if (e.type === 'error') {
    send('notice', `📱 Le lien avec le téléphone n’a pas pu démarrer (${e.message}).`)
  }
  pushPhone()
}
// Mots de passe : les gestionnaires (Bitwarden, 1Password, KeePass…) marquent leurs copies pour qu'elles
// restent hors de l'historique de Windows ; Nuage ne les envoie pas non plus
// Electron 44 (17/10/2026 : « le copier-coller PC → téléphone ne marche pas ») : le presse-papiers rend des
// promesses ; readImage, writeImage et readBuffer n'existent plus. Une promesse étant « vraie », chaque copie passait
// pour un mot de passe et ne partait jamais. Les formats Windows se lisent avec « electron application/osclipboard ».
const RAW_FORMAT = f => `electron application/osclipboard;format="${f}"`
const pngItem = png => new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })
async function readClipboardPng() {
  for (const item of await clipboard.read()) {
    if (item.types.includes('image/png')) return Buffer.from(await (await item.getType('image/png')).arrayBuffer())
  }
  return null
}
async function clipboardIsSecret() {
  try {
    for (const f of ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore']) if (await clipboard.has(RAW_FORMAT(f))) return true
    const history = RAW_FORMAT('CanIncludeInClipboardHistory')
    if (await clipboard.has(history)) {
      const item = (await clipboard.read()).find(i => i.types.includes(history))
      const flag = Buffer.from(await (await item.getType(history)).arrayBuffer())
      return flag.length >= 4 && flag.readUInt32LE(0) === 0
    }
  } catch {}
  return false
}
function watchClipboard() {
  // Le menu Téléphone suit aussi « en ligne / hors de portée » et la batterie entre deux événements
  setInterval(() => {
    if (phones().length) pushPhone()
    // Téléphone parti (hors de portée) pendant la charge : la capsule ⚡ s'en va
    for (const d of phones()) {
      if (!d.online && chargeMemory.get(d.id)?.charge) {
        chargeMemory.delete(d.id)
        send('phone-charge', { etat: 'hors-ligne', id: d.id, nom: d.nom })
      }
    }
  }, 20_000)
  // Réseau changé (autre Wi-Fi, type Public / Privé) : le diagnostic du menu Téléphone suit
  setInterval(() => {
    if (settings.linkOn) refreshNetDiag()
  }, 120_000)
  clipboard.readText().then(text => { lastClipboard = text }, () => {})
  let reading = false // une lecture à la fois (elles sont asynchrones)
  setInterval(async () => {
    if (reading || !link || settings.clipboardShare !== 'auto' || !phones().length) return
    reading = true
    try {
      const text = await clipboard.readText()
      if (!text || text === lastClipboard) return
      lastClipboard = text
      if (await clipboardIsSecret()) return
      link.sendClipboard({ texte: text.slice(0, 200_000) })
      rememberClip('envoye', text, '', 'auto')
      pushPhone()
    } catch (error) {
      debugLog('presse-papiers, lecture :', error.message)
    } finally {
      reading = false
    }
  }, 800)
}
// « Envoyer le presse-papiers au téléphone » (texte, sinon image)
async function sendClipboardToPhone() {
  if (!phones().length) return send('notice', '📱 Associe d’abord ton téléphone : barre du haut → Téléphone → « Associer ».')
  const text = await clipboard.readText().catch(() => '')
  const png = text ? null : await readClipboardPng().catch(() => null)
  if (text) {
    lastClipboard = text
    getLink().sendClipboard({ texte: text.slice(0, 200_000) })
    rememberClip('envoye', text, '', 'menu')
    pushPhone()
  } else if (png) {
    if (png.length > 8 * 1024 * 1024) return send('notice', '📋 Image trop grande pour le copier-coller : envoie-la plutôt comme fichier.')
    getLink().sendClipboard({ image: png.toString('base64') })
  } else {
    return send('notice', '📋 Le presse-papiers est vide.')
  }
  send('notice', '📋 Presse-papiers envoyé au téléphone.')
}
async function sendFilesToPhone(paths) {
  if (!phones().length) return send('notice', '📱 Associe d’abord ton téléphone : barre du haut → Téléphone → « Associer ».')
  await startLink()
  let count = 0
  for (const file of paths.slice(0, 20)) {
    try {
      getLink().sendFile(file)
      count += 1
    } catch (error) {
      send('notice', `Je ne peux pas envoyer « ${shortName(path.basename(file))} » : ${error.message}.`)
    }
  }
  if (count) send('notice', `📥 ${count === 1 ? `« ${shortName(path.basename(paths[0]))} » part` : `${count} fichiers partent`} vers le téléphone…`)
}
async function pickFilesForPhone() {
  const result = await dialog.showOpenDialog({ title: 'Envoyer au téléphone', properties: ['openFile', 'multiSelections'] })
  if (!result.canceled) sendFilesToPhone(result.filePaths)
}
// Nouvelles du PC vers le téléphone (quand un téléphone est associé), selon le menu Téléphone
function notifyPhone(titre, texte, genre) {
  if (genre === 'claude' && !settings.phoneNotifyClaude) return
  if (genre === 'telechargement' && !settings.phoneNotifyDownloads) return
  if (link && phones().length) link.notify({ titre, texte, genre })
}
// QR code d'association (clé + adresses) ou d'installation (adresse de l'APK), montré dans le menu Téléphone de la
// barre (08/10/2026 : avant, une fenêtre à part). La clé n'est jamais affichée en clair.
async function showPhoneQr(mode) {
  updateSettings({ linkOn: true })
  const l = await startLink()
  const text = mode === 'installer' ? l.offerApk(APK_FILE) : l.pairingPayload()
  const svg = text ? await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2a44', light: '#ffffff' } }) : ''
  sendTo(encoche, 'tel:qr', { mode, svg })
}
// Fichiers déposés sur la barre du haut → « Envoyer au téléphone »
ipcMain.on('drop:phone', (event, paths) => {
  if (fromOne(encoche, event) && Array.isArray(paths)) sendFilesToPhone(paths.map(String))
})
// Menu « Téléphone » de la barre du haut : chaque bouton
ipcMain.on('tel:action', async (event, name, arg) => {
  if (!fromOne(encoche, event)) return
  if (name === 'fichiers') await pickFilesForPhone()
  else if (name === 'presse-papiers') sendClipboardToPhone()
  else if (name === 'sonner') ringPhone(true)
  else if (name === 'sonner-stop') ringPhone(false)
  else if (name === 'recus') {
    fs.mkdirSync(linkInbox(), { recursive: true })
    shell.openPath(linkInbox())
  } else if (name === 'montrer') {
    const t = phoneTransfers.find(x => x.id === String(arg))
    if (t?.chemin && fs.existsSync(t.chemin)) shell.showItemInFolder(t.chemin)
  } else if (name === 'recopier') {
    const h = phoneHistory[Number(arg)]
    if (h) {
      lastClipboard = h.texte // ne repart pas tout seul vers le téléphone
      clipboard.writeText(h.texte)
      send('notice', '📋 Recopié dans le presse-papiers du PC : Ctrl+V pour le coller.')
    }
  } else if (name === 'auto-pc') updateSettings({ clipboardShare: arg ? 'auto' : 'manuel' })
  else if (name === 'notif-claude') updateSettings({ phoneNotifyClaude: Boolean(arg) })
  else if (name === 'notif-telechargements') updateSettings({ phoneNotifyDownloads: Boolean(arg) })
  else if (name === 'lien') setLinkOn(Boolean(arg))
  else if (name === 'diagnostic') await refreshNetDiag()
  else if (name === 'pare-feu') openFirewallApps()
  else if (name === 'type-reseau') shell.openExternal('ms-settings:network-wifi')
  else if (name === 'associer' || name === 'installer') await showPhoneQr(name)
  else if (name === 'qr-fermer') link?.offerApk(null) // l'APK n'est plus proposé
  else if (name === 'oublier') await confirmForgetPhones(encoche)
  pushPhone()
})

// ---------- Voix : « Hey Nuage » (05/10/2026) ----------
// Écoute en continu, hors ligne (voix.ps1 : reconnaissance vocale de Windows, rien n'est enregistré ni
// envoyé). « Hey Nuage » (ou Ctrl+Alt+H), puis une commande (ouvre le chat, fais sonner mon téléphone,
// quelle heure est-il…) ou une question : elle part dans le chat de Nuage (ton abonnement Claude) et la
// réponse est lue à voix haute. Coupée dans le menu, par le bouton micro de la barre, ou « arrête d'écouter ».
const VOICE_SHORTCUT = 'Control+Alt+H'
// Relevé de diagnostic de la voix (80 dernières étapes) : %APPDATA%\Nuage\etat-voix.json, jamais envoyé
const voiceDiagLog = []
function voiceDiag(...parts) {
  debugLog(...parts)
  voiceDiagLog.push(`${new Date().toISOString()} ${parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`.slice(0, 400))
  if (voiceDiagLog.length > 80) voiceDiagLog.shift()
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'etat-voix.json'), JSON.stringify(voiceDiagLog, null, 1), 'utf8')
  } catch {}
}
let voice = null
let voiceSpeaking = false
let voiceSpeakTimer = null
let voiceState = 'repos' // repos | ecoute | reflechit | parle | arret
function pushVoice(etat, texte = '') {
  voiceState = etat
  const data = { etat, texte, on: Boolean(settings.voiceOn && voice?.running()) }
  send('voice', data)
  sendTo(encoche, 'voice', data)
}
function startVoice() {
  voiceDiag('voix : démarrage demandé, voiceOn =', String(settings.voiceOn))
  if (!settings.voiceOn || process.env.NUAGE_AUTOTEST_DIR) return
  if (!voice) voice = voix.createVoice({ script: path.join(__dirname, 'voix.ps1'), onEvent: onVoiceEvent, log: voiceDiag })
  oneShotVoice = false
  voice.start()
}
function stopVoice() {
  voice?.stop()
  pushVoice('arret')
}
// Ctrl+Alt+H : parler tout de suite, que « Hey Nuage » soit écouté ou non
function registerVoiceShortcut() {
  if (process.env.NUAGE_AUTOTEST_DIR) return
  globalShortcut.unregister(VOICE_SHORTCUT)
  globalShortcut.register(VOICE_SHORTCUT, () => listenNow())
}
function setVoiceOn(on) {
  updateSettings({ voiceOn: Boolean(on) })
  if (on) startVoice()
  else stopVoice()
  setTimeout(() => pushVoice(voiceState === 'arret' ? 'repos' : voiceState), 600)
}
// Bouton micro du chat (comme sur le téléphone, 05/10/2026) : parler tout de suite, sans « Hey Nuage ».
// Si l'écoute est coupée, le programme d'écoute est lancé pour cette seule question, puis refermé.
let listenAfterStart = false
let oneShotVoice = false
function listenNow() {
  voiceDiag('voix : écoute immédiate (Ctrl+Alt+H ou micro), programme lancé =', String(Boolean(voice?.running())))
  if (process.env.NUAGE_AUTOTEST_DIR) return
  stopSpeaking()
  if (voice?.running()) return voice.listen()
  if (!voice) voice = voix.createVoice({ script: path.join(__dirname, 'voix.ps1'), onEvent: onVoiceEvent, log: voiceDiag })
  oneShotVoice = !settings.voiceOn
  listenAfterStart = true
  pushVoice('ecoute') // il tend l'oreille pendant que l'écoute démarre (1 à 2 s)
  voice.start()
}
function endOneShot() {
  if (!oneShotVoice || settings.voiceOn) return
  oneShotVoice = false
  voice?.stop()
}
ipcMain.on('encoche:listen', event => {
  if (fromOne(encoche, event)) listenNow()
})
// Journal local de ce que le micro entend en veille (pour régler « Hey Nuage ») : 100 dernières lignes,
// %APPDATA%\Nuage\voix-journal.txt, jamais envoyé
const voiceJournal = []
function journalVoice(e) {
  voiceJournal.push(`${new Date().toLocaleTimeString('fr-FR')} ${e.grammaire || ''} ${e.confiance ?? ''} « ${e.texte || ''} »`)
  if (voiceJournal.length > 100) voiceJournal.shift()
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'voix-journal.txt'), voiceJournal.join('\n'), 'utf8')
  } catch {}
}
let voiceQualityWarned = false
function onVoiceEvent(e) {
  voiceDiag('voix.ps1 →', e.type, e.type === 'entendu' || e.type === 'phrase' || e.type === 'partiel' ? (e.grammaire || '') + ' ' + (e.confiance ?? '') + ' « ' + String(e.texte || '').slice(0, 60) + ' »' : JSON.stringify(e).slice(0, 200))
  if (e.type === 'entendu') return journalVoice(e)
  if (e.type === 'qualite') {
    debugLog('voix, moteur récent indisponible :', e.message)
    if (!voiceQualityWarned && e.raison === 'en-ligne') {
      voiceQualityWarned = true
      send('notice', '🎙 Pour que je comprenne bien tes questions, active « Reconnaissance vocale en ligne » (Paramètres de Windows, Confidentialité et sécurité, Voix). Ta voix passe alors par Microsoft ; sinon je garde la reconnaissance hors ligne, moins précise.')
    }
    return
  }
  if (e.type === 'pret') {
    if (listenAfterStart) {
      listenAfterStart = false
      voice?.listen() // bouton micro du chat pressé avant que l'écoute soit prête
    } else pushVoice('repos')
  } else if (e.type === 'arret') pushVoice('arret')
  else if (e.type === 'erreur') {
    // Micro débranché ou refusé, reconnaissance française absente : on le dit une fois, sans relancer en boucle
    send('notice', e.code === 'micro'
      ? '🎙 Je n’entends pas : branche un micro, ou autorise les applications de bureau à l’utiliser (Paramètres de Windows, Confidentialité, Microphone).'
      : e.code === 'langue'
        ? '🎙 Aucune reconnaissance vocale sur ce PC : Paramètres de Windows → Heure et langue → Langue et région → Français → Options de langue → installe « Reconnaissance vocale ».'
        : `🎙 « Hey Nuage » n’a pas pu démarrer : ${String(e.message || 'erreur inconnue').slice(0, 200)}`)
    pushVoice('arret')
  } else if (voiceSpeaking) {
    // Pendant qu'il parle, il ne s'écoute pas lui-même
  } else if (e.type === 'reveil' || e.type === 'ecoute') {
    stopSpeaking()
    pushVoice('ecoute')
    // Pendant que tu poses ta question, Claude se prépare déjà
    if (!chatState.session && !chatState.messages.length) autoContinueSession()
    prewarmChat()
  } else if (e.type === 'partiel') pushVoice('ecoute', e.texte)
  else if (e.type === 'silence') {
    pushVoice('silence')
    endOneShot()
  } else if (e.type === 'phrase') {
    handleVoiceText(e.texte)
    endOneShot()
  }
}
function weatherSentence() {
  const w = lastWeather
  if (!w) return 'Je n’ai pas la météo pour l’instant.'
  return `Il fait ${Math.round(w.temp)} degrés${w.place ? ` à ${w.place}` : ''}${w.label ? `, ${String(w.label).toLowerCase()}` : ''}.`
}
function claudeSummary() {
  const sessions = (agentState || hub.snapshot()).sessions
  const live = sessions.find(s => s.status === 'en-cours')
  if (live) return `Claude travaille sur « ${live.title} »${live.current ? ` : ${live.current}` : ''}.`
  const waiting = sessions.find(s => s.status === 'attente' || s.status === 'permission')
  if (waiting) return `« ${waiting.title} » attend ta réponse.`
  const done = sessions.find(s => s.status === 'termine')
  if (done) return `Oui, « ${done.title} » est terminé.`
  return 'Aucune session Claude Code en cours.'
}
function handleVoiceText(text) {
  const intent = voix.understand(text)
  voiceDiag('voix : compris', intent.action, '; Claude trouvé/connecté =', String(claudeCode.found), String(claudeCode.loggedIn))
  pushVoice('compris', text)
  const say = words => speak(words)
  switch (intent.action) {
    case 'rien': return say('D’accord.')
    case 'merci': return say(['Avec plaisir !', 'De rien !', 'Toujours là pour toi.'][Math.floor(Math.random() * 3)])
    case 'taire': return stopSpeaking()
    case 'chat':
      openChat()
      return say('Voilà le chat.')
    case 'fermer-chat':
      sendTo(encoche, 'encoche:fold')
      return pushVoice('repos')
    case 'menu-telephone':
      openPhoneMenu()
      return say('Voilà ton téléphone.')
    case 'presse-papiers':
      if (!phones().length) return say('Aucun téléphone associé.')
      sendClipboardToPhone()
      return say('C’est parti vers ton téléphone.')
    case 'sonner':
      if (!phones().length) return say('Aucun téléphone associé.')
      ringPhone(true)
      return say('Je fais sonner ton téléphone.')
    case 'meteo': return say(weatherSentence())
    case 'heure': return say(`Il est ${new Date().getHours()} heures ${String(new Date().getMinutes()).padStart(2, '0')}.`)
    case 'cacher':
      if (homeInBar()) sendTo(encoche, 'encoche:fold', true)
      else win?.hide()
      refreshMenu()
      return pushVoice('repos')
    case 'montrer':
      showNuage()
      return say('Coucou !')
    case 'claude-etat': return say(claudeSummary())
    case 'nouvelle-session':
      newSession('')
      openChat()
      return say('Nouvelle session ouverte : je t’écoute.')
    case 'stop-ecoute':
      speak('D’accord, je n’écoute plus. Tu me rallumes dans mon menu, ou avec le micro de la barre du haut.')
      return setTimeout(() => setVoiceOn(false), 400)
    default:
      if (chatState.streaming) return say('Claude répond déjà : attends un peu.')
      openChat()
      pushVoice('reflechit', text)
      sendChat(intent.texte, {
        spoken: true,
        from: 'pc',
        onDone: answer => {
          voiceDiag('voix : réponse de Claude', answer.error ? `erreur : ${answer.error}` : ` caractères`)
          speak(answer.error || voix.speakable(answer.text) || 'Je n’ai pas eu de réponse.')
        },
      })
  }
}
// ---------- Nuage parle ----------
// Voix naturelle (05/10/2026 : « plus naturelle, pas de lecture mot à mot ») : Piper, hors ligne
// (voix-naturelle.js), phrase par phrase : la première se dit pendant que la suivante se prépare ; la
// fenêtre de Nuage joue le son et sa bouche suit la voix. Voix de Windows en secours (ou au choix).
// L'écoute est en pause pendant qu'il parle (il ne s'entend pas lui-même).
const natural = createNaturalVoice({ dir: path.join(__dirname, 'voix-naturelle'), log: debugLog })
let speakId = 0
const useNatural = () => settings.voiceName !== 'windows' && natural.installed(settings.voiceName) && !process.env.NUAGE_AUTOTEST_DIR
async function speak(text) {
  voiceDiag('voix : Nuage parle', ` caractères, voix , naturelle = , réponses à voix haute = `)
  if (!text) return pushVoice('repos')
  if (!settings.voiceReplies) {
    send('notice', text)
    return pushVoice('repos')
  }
  const id = ++speakId
  voiceSpeaking = true
  voice?.pause()
  pushVoice('parle', text)
  clearTimeout(voiceSpeakTimer)
  voiceSpeakTimer = setTimeout(spoken, Math.min(120_000, 4000 + text.length * 100)) // si la fin n'arrive jamais
  if (!useNatural()) return send('speak', { texte: text, id, muet: Boolean(process.env.NUAGE_AUTOTEST_DIR) }) // auto-test : sans le son
  send('speak', { texte: text, id, naturel: true })
  const parts = sentences(text)
  for (let i = 0; i < parts.length; i++) {
    if (id !== speakId || !voiceSpeaking) return // interrompu (« tais-toi », nouvelle question)
    try {
      const wav = await natural.synth(parts[i], settings.voiceName)
      if (id !== speakId) return
      send('speak-audio', { id, wav, last: i === parts.length - 1 })
    } catch (error) {
      voiceDiag('voix naturelle, erreur :', error.message)
      if (id === speakId) send('speak', { texte: parts.slice(i).join(' '), id, suite: true }) // la voix de Windows prend le relais
      return
    }
  }
}
function spoken() {
  clearTimeout(voiceSpeakTimer)
  if (!voiceSpeaking) return
  voiceSpeaking = false
  // Un court délai : l'écho du haut-parleur ne doit pas être pris pour une phrase
  setTimeout(() => voice?.resume(), 400)
  pushVoice('repos')
}
function stopSpeaking() {
  if (!voiceSpeaking) return
  speakId += 1
  send('speak', { stop: true })
  spoken()
}
// Choisir la voix (menu Voix) : il se présente avec elle
function chooseVoice(id) {
  updateSettings({ voiceName: id })
  natural.stop()
  stopSpeaking()
  const name = NATURAL_VOICES[id]?.label.split(' ')[0]
  speak(id === 'windows' ? 'D’accord, je reprends la voix de Windows.' : `Coucou, c’est Nuage ! Voici ma voix ${name}. Elle te plaît ?`)
}
ipcMain.on('voice:spoken', event => {
  if (!fromWindow(event)) return
  voiceDiag('voix : la fenêtre de Nuage a fini de parler')
  spoken()
})
ipcMain.on('encoche:voice', (event, on) => {
  if (fromOne(encoche, event)) setVoiceOn(Boolean(on))
})

// ---------- Activité du PC : inactivité et rappels ----------
let idleState = 'active'
let activeForBreak = 0
let activeForWater = 0

// Filet de sécurité de l'écran de veille (04/10/2026) : il n'avait jamais démarré, car une
// application peut empêcher Windows de le lancer (demande « écran requis »). Si rien n'a démarré
// 20 s après le délai, Nuage le lance lui-même comme Ctrl+Alt+L (Windows verrouille toujours au
// retour), sauf pendant une vidéo ou un plein écran.
let screensaverTried = false
const screensaverRunning = () => {
  try {
    return Date.now() - fs.statSync(path.join(app.getPath('appData'), 'Nuage', 'veille-en-cours.txt')).mtimeMs < 15_000
  } catch {
    return false
  }
}
function watchScreensaver(idle) {
  if (!settings.screensaverOn || process.env.NUAGE_AUTOTEST_DIR) return
  if (idle < 60) {
    screensaverTried = false
    return
  }
  if (screensaverTried || idle < settings.screensaverDelay + 20) return
  const video = mediaState?.playing && mediaState.kind === 'video'
  if (video || mediaState?.fullscreen || screensaverRunning()) return
  screensaverTried = true
  debugLog('écran de veille : Windows ne l’a pas lancé, Nuage le lance')
  launchScreensaver()
}
function watchActivity() {
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime()
    const state = idle >= 600 ? 'asleep' : idle >= 300 ? 'drowsy' : 'active'
    if (state !== idleState) {
      idleState = state
      send('idle-state', state)
    }
    watchScreensaver(idle)
  }, 2000)

  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime()
    if (idle >= 300) {
      activeForBreak = 0 // une vraie pause remet le compteur à zéro
      return
    }
    if (idle >= 60) return
    activeForBreak += 1
    activeForWater += 1
    if (settings.breakReminder && activeForBreak >= settings.breakEveryMin) {
      activeForBreak = 0
      send('remind', 'pause')
    }
    if (settings.waterReminder && activeForWater >= settings.waterEveryMin) {
      activeForWater = 0
      send('remind', 'eau')
    }
  }, 60_000)

  powerMonitor.on('lock-screen', () => send('system', 'lock'))
  powerMonitor.on('unlock-screen', () => send('system', 'unlock'))
  powerMonitor.on('resume', () => send('system', 'resume'))
}

// Position du curseur (relative à la fenêtre) pour que Nuage le suive des yeux
function watchCursor() {
  let last = ''
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const key = `${p.x},${p.y},${b.x},${b.y}`
    if (key === last) return
    last = key
    send('cursor', { x: p.x - b.x, y: p.y - b.y })
  }, 33)
}

// ---------- Messages du rendu ----------
let drag = null
ipcMain.handle('settings:get', event => (fromWindow(event) ? publicSettings() : null))
ipcMain.on('settings:first-run-done', event => {
  if (fromWindow(event)) updateSettings({ firstRun: false })
})
ipcMain.on('mouse:interactive', (event, on) => {
  if (!fromWindow(event)) return
  debugLog('souris active :', on)
  win.setIgnoreMouseEvents(!on, { forward: true })
})
ipcMain.on('debug:log', (event, message) => {
  if (fromWindow(event)) debugLog('fenêtre :', message)
})
// Pendant le glisser : l'encoche s'allume quand Nuage arrive en haut de l'écran
function setChatHint(on) {
  sendTo(encoche, 'encoche:hint', on)
  send('drag-zone', on)
}
ipcMain.on('drag:start', event => {
  if (!fromWindow(event)) return
  // Un ancien glisser jamais terminé (relâchement perdu) ne doit pas bloquer le nouveau
  if (drag) {
    clearInterval(drag.timer)
    if (drag.zone) setChatHint(false)
    drag = null
  }
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  const current = {
    dx: p.x - b.x,
    dy: p.y - b.y,
    zone: false,
    timer: setInterval(() => {
      const c = screen.getCursorScreenPoint()
      setWindowBounds(c.x - current.dx, c.y - current.dy)
      const zone = inChatZone(c)
      if (zone !== current.zone) {
        current.zone = zone
        setChatHint(zone)
      }
    }, 10),
  }
  drag = current
})
// Fin du glisser (aussi appelée par l'auto-test) : renvoie 'chat', 'context' ou ''
function finishDrag(cursor, withContext) {
  if (drag) {
    clearInterval(drag.timer)
    if (drag.zone) setChatHint(false)
    drag = null
  }
  // Lâché en haut de l'écran ou sur l'îlot : Nuage plonge dans la barre et le chat s'ouvre
  if (inChatZone(cursor)) {
    nuageEnterBar()
    return 'chat'
  }
  savePosition()
  // Lâché avec Maj enfoncée : la fenêtre en dessous part en contexte dans le chat
  if (withContext) {
    giveWindowContext()
    return 'context'
  }
  return ''
}
ipcMain.handle('drag:end', (event, withContext) => {
  if (!fromWindow(event) || !drag) return ''
  return finishDrag(screen.getCursorScreenPoint(), Boolean(withContext))
})

// ---------- Messages : encoche, agents, chat, connexions ----------
ipcMain.handle('encoche:state', event => {
  if (!fromOne(encoche, event)) return null
  encocheReady = true
  const openChatNow = chatOpenPending
  chatOpenPending = null
  const openTab = phoneTabPending ? 'telephone' : null
  phoneTabPending = false
  const openSettingsNow = settingsPending
  settingsPending = null
  const openPanelNow = notchOpenPending
  notchOpenPending = false
  return {
    agents: agentState || hub.snapshot(),
    integrations: integrationState,
    settings: encocheSettings(),
    voice: { etat: voiceState, on: Boolean(settings.voiceOn && voice?.running()), wanted: settings.voiceOn },
    chat: chatPublic(),
    openChat: openChatNow,
    openPanel: openPanelNow,
    openTab,
    openSettings: openSettingsNow,
    telephone: phoneState(),
    place: islandPlace,
    weather: lastWeather,
  }
})
// Déplacer l'îlot (attrapé par la pilule ou l'en-tête du panneau)
ipcMain.on('encoche:drag-start', event => {
  if (fromOne(encoche, event)) startIslandDrag()
})
ipcMain.on('encoche:drag-end', event => {
  if (fromOne(encoche, event)) endIslandDrag()
})
// La barre s'est refermée avec Nuage dedans : il ressort juste en dessous
ipcMain.on('encoche:nuage-out', event => {
  if (fromOne(encoche, event)) nuageLeaveBar()
})
// Bouton son de l'en-tête
ipcMain.on('encoche:sounds', (event, on) => {
  if (fromOne(encoche, event)) applySetting('soundsOn', Boolean(on))
})
// Forme de l'îlot (coordonnées dans la fenêtre), à chaque image de son animation
ipcMain.on('encoche:rect', (event, r) => {
  if (!fromOne(encoche, event) || !r) return
  islandRect = { x: Number(r.x) || 0, y: Number(r.y) || 0, w: Number(r.w) || 0, h: Number(r.h) || 0 }
})
ipcMain.on('encoche:mode', (event, mode) => {
  if (!fromOne(encoche, event) || !['cache', 'barre', 'ouvert'].includes(mode)) return
  if (mode === 'ouvert') {
    encoche.moveTop()
    // Ouverte d'un clic (sans passer par openChat) : même préparation, et Claude revérifié s'il manquait
    if (!process.env.NUAGE_AUTOTEST_DIR) autoContinueSession()
    prewarmChat()
    if (!(claudeCode.found && claudeCode.loggedIn) && Date.now() - claudeCode.checkedAt > 5000) refreshClaudeCode().catch(() => {})
  }
})
// L'encoche prend le clavier (champ du chat) ; jamais pendant l'auto-test, l'utilisateur se sert du PC
ipcMain.on('encoche:focus', event => {
  if (!fromOne(encoche, event) || process.env.NUAGE_AUTOTEST_DIR) return
  encoche.focus()
})
ipcMain.on('agents:resolve', (event, id, choice, answers) => {
  if (fromOne(encoche, event) && hub.resolvePermission(id, choice, answers)) countOk(choice)
})
ipcMain.handle('agents:diff', (event, sessionId, filePath) => (fromOne(encoche, event) ? hub.fileDiff(sessionId, filePath) : null))
// Activité en direct : tout le détail d'une étape (fichier lu, commande et sa sortie, recherche…)
ipcMain.handle('agents:step', (event, sessionId, stepId) => (fromOne(encoche, event) ? hub.stepDetail(String(sessionId), String(stepId)) : null))
// L'Accueil s'ouvre : limites relues si elles datent de plus de 25 s
ipcMain.on('agents:usage', event => {
  if (fromOne(encoche, event)) refreshUsage()
})
ipcMain.on('agents:open', (event, cwd) => {
  if (fromOne(encoche, event)) openSession(cwd)
})
// « Continuer dans le chat » : la session (ses derniers échanges) s'ouvre dans le chat de Nuage
ipcMain.handle('chat:continue-session', (event, id) => (fromOne(encoche, event) ? continueSession(String(id)) : false))
ipcMain.on('chat:leave-session', event => {
  if (fromOne(encoche, event)) leaveSession()
})
// Nouvelle session Claude Code ; « choisir » : d'abord la fenêtre de choix du dossier
ipcMain.handle('chat:new-session', async (event, choose) => {
  if (!fromOne(encoche, event)) return false
  let folder = ''
  if (choose) {
    const result = await dialog.showOpenDialog(encoche, { properties: ['openDirectory'], title: 'Dossier de la nouvelle session' })
    if (result.canceled || !result.filePaths[0]) return false
    folder = result.filePaths[0]
  }
  newSession(folder)
  return true
})
ipcMain.on('chat:permission', (event, id, choice) => {
  if (fromOne(encoche, event) && chatState.permission?.id === id) answerChatPermission(String(choice))
})
ipcMain.on('agents:permissions', (event, on) => {
  if (fromApp(event)) applySetting('permissionsInNuage', on)
})
ipcMain.on('integrations:refresh', event => {
  if (fromApp(event)) refreshIntegrations()
})
ipcMain.on('open:url', (event, url) => {
  if (fromApp(event) && /^https:\/\//i.test(url)) shell.openExternal(url)
})
ipcMain.on('drop:chat', (event, paths) => {
  if (!fromOne(encoche, event) || !Array.isArray(paths)) return
  attachPaths(paths)
  openChat()
})
ipcMain.handle('drop:email', async (event, paths) => {
  if (!fromOne(encoche, event) || !Array.isArray(paths) || !paths[0]) return null
  const file = paths[0]
  const name = path.basename(file)
  try {
    if (fs.statSync(file).isDirectory()) return { message: 'Je ne peux envoyer qu’un fichier, pas un dossier.' }
    if (secrets.has('resend') && secrets.has('resendFrom') && secrets.has('resendTo') && fs.statSync(file).size <= 20e6) {
      await integrationsApi.sendFileByEmail({ fileName: name, base64: fs.readFileSync(file).toString('base64') })
      send('notice', `✉️ « ${short(name, 40)} » est parti par e-mail.`)
      return { message: `✉️ « ${short(name, 40)} » envoyé par e-mail.` }
    }
    // Sans Resend : messagerie de Windows + fichier sélectionné dans l'Explorateur, à joindre
    shell.showItemInFolder(file)
    await shell.openExternal(`mailto:?subject=${encodeURIComponent(`Fichier : ${name}`)}&body=${encodeURIComponent(`Ci-joint : ${name}`)}`)
    return { message: 'Messagerie ouverte : joins le fichier (sélectionné dans l’Explorateur).' }
  } catch (error) {
    return { message: `E-mail impossible : ${error.message}` }
  }
})

// Chat (onglet « Chat » de l'encoche)
ipcMain.handle('chat:models', async (event, provider) => {
  if (!fromOne(encoche, event) || !chatApi.PROVIDERS[provider]) return []
  try {
    return await chatApi.listModels(provider)
  } catch {
    return chatApi.PROVIDERS[provider].models
  }
})
ipcMain.on('chat:choose', (event, provider, model) => {
  if (!fromOne(encoche, event) || !chatApi.PROVIDERS[provider]) return
  const changed = provider !== settings.chatProvider
  updateSettings({ chatProvider: provider, chatModel: model || (changed ? chatApi.PROVIDERS[provider].models[0] || '' : settings.chatModel) })
  pushChat()
})
// Clic sur une image d'une réponse : elle s'ouvre dans la visionneuse de Windows (chemin gardé par Nuage)
ipcMain.on('chat:open-image', (event, index, k) => {
  const file = fromOne(encoche, event) && chatState.messages[Number(index)]?.images?.[Number(k)]?.path
  if (file) shell.openPath(file)
})
// Effort de réflexion (menu du chat) : seulement une valeur que l'IA choisie connaît, sinon celui par défaut
ipcMain.on('chat:effort', (event, effort) => {
  if (!fromOne(encoche, event)) return
  const known = chatApi.PROVIDERS[settings.chatProvider]?.efforts || []
  updateSettings({ chatEffort: known.includes(effort) ? effort : '' })
  pushChat()
})
ipcMain.on('chat:send', (event, text) => {
  if (fromOne(encoche, event)) sendChat(String(text).slice(0, 20000))
})
ipcMain.on('chat:stop', event => {
  if (!fromOne(encoche, event)) return
  chatState.abort?.abort()
  if (chatState.permission) answerChatPermission('deny')
})
// Nouvelle discussion : page blanche, sans session (on peut en reprendre une depuis le menu)
ipcMain.on('chat:reset', event => {
  if (!fromOne(encoche, event)) return
  chatState.abort?.abort()
  coolChat()
  chatState.session = null
  chatState.autoSession = false
  chatState.messages = []
  chatState.attachments = []
  chatState.always.clear()
  pushChat()
})
// Fenêtre « Ouvrir » de Windows ; l'encoche reste ouverte tant qu'elle est affichée
ipcMain.handle('chat:pick', async event => {
  if (!fromOne(encoche, event)) return false
  const result = await dialog.showOpenDialog(encoche, { properties: ['openFile', 'multiSelections'], title: 'Joindre des fichiers' })
  if (!result.canceled) attachPaths(result.filePaths)
  return !result.canceled
})
ipcMain.on('chat:unattach', (event, index) => {
  if (!fromOne(encoche, event) || !Number.isInteger(index) || index < 0) return // -1 retirait la dernière pièce
  chatState.attachments.splice(index, 1)
  pushChat()
})
// « Se connecter à Claude » (chat ou Réglages de la barre) : connexion unique, validée par l'utilisateur
ipcMain.handle('chat:login', event => {
  if (!fromOne(encoche, event)) return null
  try {
    loginClaude()
    return { message: 'Une fenêtre s’ouvre : valide la connexion dans ton navigateur, puis reviens ici.' }
  } catch (error) {
    return { message: error.message }
  }
})

const SECRET_NAMES = new Set([
  ...AI_SECRETS.map(p => p.secret),
  ...integrationsApi.INTEGRATIONS.flatMap(i => i.fields.map(f => f.name)),
])
ipcMain.handle('cnx:state', event => (fromOne(encoche, event) ? cnxState() : null))
ipcMain.handle('cnx:secret', (event, name, value) => {
  if (!fromOne(encoche, event) || !SECRET_NAMES.has(name)) return null
  try {
    secrets.set(name, value)
    pushChat()
    if (!AI_SECRETS.some(p => p.secret === name)) refreshIntegrations()
    return { message: value ? 'Enregistré ✓ (chiffré sur ce PC)' : 'Effacé.' }
  } catch (error) {
    return { message: error.message }
  }
})
ipcMain.handle('cnx:claude-code', async (event, action) => {
  if (!fromOne(encoche, event)) return null
  try {
    if (action === 'install') {
      await installClaudeCode()
      return { message: 'Nuage est branché à Claude Code ✓ (effet dans les nouvelles sessions).' }
    }
    removeClaudeCode()
    return { message: 'Nuage est débranché de Claude Code. Tes réglages d’avant sont revenus.' }
  } catch (error) {
    return { message: `Impossible : ${error.message}` }
  }
})
// Choix de l'IA (08/10/2026) : installer l'outil officiel (avancement envoyé à la fenêtre), se connecter au compte
const accountBusy = new Set()
ipcMain.handle('cnx:account', async (event, id, action) => {
  const p = chatApi.PROVIDERS[id]
  if (!fromOne(encoche, event) || !p?.account || !['install', 'login'].includes(action)) return null
  const t = abonnements.describe(p.account)
  if (accountBusy.has(p.account)) return { message: 'C’est déjà en cours…' }
  accountBusy.add(p.account)
  try {
    if (action === 'install') {
      const version = await abonnements.install(p.account, (got, total) => sendTo(encoche, 'cnx:progress', { id, got, total }))
      await refreshAccount(p.account)
      return { message: `${t.name} ${version} installé ✓ Connecte-toi maintenant à ton compte ${t.account}.` }
    }
    await abonnements.login(p.account, chatApi.systemPrompt(true))
    await refreshAccount(p.account)
    return { message: accountReady(p.account) ? `Connecté à ton compte ${t.account} ✓ Clique sur « Utiliser ${p.short} ».` : `Connexion à ${t.account} pas confirmée : réessaie.` }
  } catch (error) {
    debugLog(`abonnement ${p.account}, ${action} :`, error.message)
    return { message: `✗ ${error.message}` }
  } finally {
    accountBusy.delete(p.account)
    sendTo(encoche, 'cnx:progress', { id, done: true })
  }
})
// Abonnement Claude sans l'application Claude : sa page de téléchargement officielle (adresse fixe, jamais venue de la page)
ipcMain.on('cnx:claude-download', event => {
  if (fromOne(encoche, event)) shell.openExternal('https://claude.ai/download')
})
// « Utiliser … » : le chat passe à cette IA ; au premier lancement, le chat s'ouvre aussitôt
ipcMain.handle('cnx:use', (event, id) => {
  const p = chatApi.PROVIDERS[id]
  if (!fromOne(encoche, event) || !p) return null
  chatState.session = null // une session Claude Code reprise ne garde pas la main
  updateSettings({ chatProvider: id, chatModel: p.models[0] || '' })
  pushChat()
  if (welcomePending) {
    welcomePending = false
    setTimeout(() => {
      openChat()
      send('notice', `C’est parti : je réponds avec ${p.short || p.label}. Pose-moi ta première question !`)
    }, 900)
  }
  return { message: `✓ Le chat utilise maintenant ${p.short || p.label}.` }
})
ipcMain.handle('cnx:test', async (event, id) => {
  if (!fromOne(encoche, event)) return null
  try {
    if (id === 'claudecode') {
      const state = await refreshClaudeCode()
      if (!state.found) return { message: '✗ Claude Code introuvable : installe l’application Claude.' }
      return { message: state.loggedIn ? 'Claude (abonnement) : ✓ connecté' : '✗ Pas encore connecté : clique sur « Se connecter à Claude ».' }
    }
    if (id.startsWith('integ:')) {
      const integ = integrationsApi.INTEGRATIONS.find(i => i.id === id.slice(6))
      const data = await integ.fetch(secrets.get)
      return { message: `${integ.label} : ✓ (${data.lines.length} élément(s))` }
    }
    const models = await chatApi.listModels(id)
    return { message: `${chatApi.PROVIDERS[id].label} : ✓ ${models.length} modèle(s) disponible(s)` }
  } catch (error) {
    return { message: `✗ ${error.message}` }
  }
})
// Plugins et compétences de Claude Code (07/10/2026) : examiner d'abord (montré à l'utilisateur), puis installer
// sur son accord ; retirer = corbeille (compétence) ou « plugin uninstall ». Voir extensions.js.
const trashDir = dir => shell.trashItem(dir)
ipcMain.handle('ext:list', event => (fromOne(encoche, event) ? { skills: extensions.listSkills() } : null))
ipcMain.handle('ext:examine', async (event, input) => {
  if (!fromOne(encoche, event)) return null
  try {
    const r = await extensions.examine(String(input || ''))
    return { ...r, plan: undefined, market: undefined, skills: r.skills?.map(s => ({ name: s.name, description: s.description, exists: s.exists })) }
  } catch (error) {
    return { error: error.message }
  }
})
ipcMain.handle('ext:install', async (event, input, choice = {}) => {
  if (!fromOne(encoche, event)) return null
  try {
    return await extensions.install(String(input || ''), { trash: trashDir, plugin: String(choice?.plugin || ''), replace: Boolean(choice?.replace) })
  } catch (error) {
    return { error: error.message, code: error.code || '' }
  }
})
ipcMain.handle('ext:remove', async (event, id) => {
  if (!fromOne(encoche, event)) return null
  try {
    return await extensions.remove(String(id), { trash: trashDir })
  } catch (error) {
    return { error: error.message }
  }
})
// Vue Réglages de la barre : ses groupes, un réglage changé, une action (Pomodoro, redémarrer…)
ipcMain.handle('reglages:bar', event => (fromOne(encoche, event) ? barGroups() : null))
ipcMain.on('reglages:set', (event, key, value) => {
  if (fromOne(encoche, event)) setBarSetting(String(key), value).catch(error => debugLog('réglage', key, ':', error.message))
})
ipcMain.on('reglages:action', (event, id) => {
  if (fromOne(encoche, event)) barAction(String(id))
})
ipcMain.on('menu:popup', event => {
  if (fromWindow(event)) buildMenu().popup({ window: win })
})
ipcMain.handle('trash:swallow', (event, list) => {
  if (!fromWindow(event) || !settings.feedOn || !Array.isArray(list)) return null
  return swallow(list)
})
ipcMain.handle('trash:undo', event => (fromWindow(event) ? restoreLastSwallowed() : null))
// Nuage habite l'encoche : ses bulles (fenêtre du bureau cachée) s'affichent dans la pilule ; un clic sur une
// bulle « à action » (annuler un repas…) revient à la fenêtre qui l'a dite
ipcMain.on('nuage:home-say', (event, line) => {
  if (!fromWindow(event) || !line || typeof line !== 'object') return
  sendTo(encoche, 'encoche:notice', {
    text: String(line.text || '').slice(0, 400),
    icon: Array.isArray(line.icon) ? line.icon.slice(0, 2).map(String) : null,
    ms: Math.min(60_000, Math.max(1500, Number(line.ms) || 4500)),
    action: line.action ? String(line.action).slice(0, 40) : null,
    important: Boolean(line.important),
  })
})
ipcMain.on('encoche:notice-action', (event, id) => {
  if (fromOne(encoche, event)) send('home-action', String(id))
})
// Fichier lâché sur l'encoche, cible « Donner à Nuage » : il l'avale (corbeille, annulable une minute)
ipcMain.handle('drop:swallow', (event, list) => {
  if (!fromOne(encoche, event) || !settings.feedOn || !Array.isArray(list)) return null
  return swallow(list)
})
ipcMain.handle('drop:undo', event => (fromOne(encoche, event) ? restoreLastSwallowed() : null))
ipcMain.on('media:command', (event, command) => {
  if (!fromApp(event) || !mediaProcess) return
  if (['toggle', 'next', 'previous'].includes(command)) mediaProcess.stdin.write(`${command}\n`)
})
ipcMain.on('panel:toggle', event => {
  if (fromApp(event)) togglePanel()
})
ipcMain.on('panel:close', event => {
  if (fromPanel(event)) panel.hide()
})
ipcMain.handle('panel:state', event => (fromPanel(event) ? panelState() : null))
ipcMain.handle('weather:set-place', (event, query) => (fromPanel(event) ? setWeatherPlace(query) : null))
ipcMain.handle('weather:auto-place', async event => {
  if (!fromPanel(event)) return null
  await refreshWeather({ redetect: true })
  return panelState()
})
ipcMain.on('pomodoro:state', (event, running) => {
  if (!fromWindow(event)) return
  pomodoroRunning = Boolean(running)
  refreshMenu()
})
let rendererReady = false
ipcMain.on('renderer:ready', event => {
  if (!fromWindow(event)) return
  if (rendererReady) {
    // rechargement de la fenêtre : on renvoie l'état connu
    if (lastWeather) send('weather', lastWeather)
    if (mediaState) send('media', mediaState)
    return
  }
  rendererReady = true
  refreshWeather()
})

// ---------- Démarrage ----------
function start() {
  app.setAppUserModelId('Nuage.CompagnonDeBureau')
  loadSettings()
  // Chat : sans clé Anthropic enregistrée, Claude passe par l'abonnement (Claude Code) si présent
  if (settings.chatProvider === 'claude' && !secrets.has('anthropic') && claudeCode.found) {
    settings.chatProvider = 'claudecode'
    settings.chatModel = 'sonnet'
    saveSettings()
  }
  watchClaudeCode()
  allowAudioCapture()
  createWindow()
  startMediaWatcher()

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')))
  tray.setToolTip('Nuage')
  tray.on('click', () => {
    // Un clic sur l'icône fait toujours apparaître Nuage (le masquer : menu ou Ctrl+Alt+N)
    showNuage()
    send('system', 'hello-again')
  })
  refreshMenu()

  globalShortcut.register(SHORTCUT, toggleVisible)
  watchActivity()
  watchCursor()
  setInterval(() => refreshWeather(), WEATHER_EVERY_MS)
  powerMonitor.on('resume', () => refreshWeather())
  // Écran de verrouillage : redessiné quand la couleur d'accent ou le mode clair/sombre change
  systemPreferences.on('accent-color-changed', scheduleLockScreen)
  nativeTheme.on('updated', scheduleLockScreen)
  setTimeout(() => applyLockScreen(), 8000)
  // Écran de veille : installé si l'option est cochée mais pas encore en place
  registerVeilleShortcut()
  if (settings.screensaverOn && !settings.screensaverBefore) {
    installScreensaver().catch(error => debugLog('écran de veille, erreur :', error.message))
  }

  // Agents de code (Claude Code), encoche, intégrations
  ensureToken()
  writeExtensionToken()
  const hookServer = startServer({
    token: settings.nuageToken,
    downloadToken: settings.downloadToken,
    onHook: body => hub.handleHook(body),
    onStatusline: body => hub.handleStatusline(body),
    onDownload: body => {
      debugLog('extension : contact,', Array.isArray(body?.items) ? body.items.length : 0, 'téléchargement(s)')
      // Premier contact de l'extension : Nuage le dit une fois, le menu l'affiche
      if (!settings.extensionSeen) {
        updateSettings({ extensionSeen: new Date().toISOString() })
        send('notice', '🔌 L’extension du navigateur est branchée : je verrai le pourcentage exact de tes téléchargements !')
      }
      if (settings.downloadsOn) downloads?.report(body)
    },
    // Outil de Nuage demandé par Gemini (Antigravity) ou ChatGPT (Codex) : seulement pendant leur réponse dans le
    // chat, avec le même accord de l'utilisateur que pour les autres IA (permitChat)
    onTool: async body => {
      if (!chatState.streaming || !chatApi.PROVIDERS[settings.chatProvider]?.account) return { text: 'Aucune discussion en cours : action refusée.' }
      const text = await actionsApi.run(String(body?.name || ''), body?.args || {}, {
        permit: permitChat, trash: file => shell.trashItem(file), signal: chatState.abort?.signal, onTool: label => chatState.toolLine?.(label),
      })
      return { text }
    },
    log: debugLog,
  })
  abonnements.configure({ token: settings.nuageToken, port: PORT })
  for (const id of Object.keys(accountState)) refreshAccount(id)
  startDownloads()
  // Connexion automatique au téléphone (06/10/2026) : le lien est allumé une fois d'office, pour que le PC
  // soit trouvable sur le Wi-Fi ; l'utilisateur peut toujours l'éteindre dans le menu (c'est alors respecté)
  if (!settings.linkAuto) updateSettings({ linkOn: true, linkAuto: true })
  if (settings.linkOn) startLink()
  watchClipboard()
  makeShortcuts()
  setTimeout(startVoice, 4000) // « Hey Nuage » (pas pendant l'auto-test : le micro est celui de l'utilisateur)
  registerVoiceShortcut()
  // Voix naturelle chargée d'avance (≈ 1 s, un peu de mémoire) : sa première phrase part tout de suite
  setTimeout(() => {
    if (useNatural() && settings.voiceReplies) natural.warm(settings.voiceName)
  }, 8000)
  setInterval(refreshMenu, 60_000) // « connecté / pas connecté » des téléphones
  // APK reconstruit pendant que le téléphone est déjà connecté (son état ne change pas forcément)
  setInterval(() => link?.devices().filter(d => d.online).forEach(offerPhoneUpdate), 60_000)
  hub.setPermissionsInNuage(settings.permissionsInNuage)
  // Activité en direct : journaux relus chaque seconde. La première lecture (≈ 0,5 s : tous les journaux)
  // attend que Nuage soit affiché et prêt à être attrapé, pour ne pas le figer au démarrage
  setTimeout(() => {
    hub.scan()
    setInterval(() => hub.scan(), 1000)
  }, 3500)
  watchUsage()
  createEncoche()
  watchEncoche()
  // Tout premier lancement (08/10/2026) : « comment veux-tu faire marcher Nuage ? » (abonnement, clé, sur ce PC)
  if (firstLaunch && !process.env.NUAGE_AUTOTEST_DIR) setTimeout(() => openSettings('ia', { welcome: true }), 2500)
  // Écran branché, débranché ou changé d'échelle : l'îlot reste en haut au centre
  for (const e of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(e, () => placeEncoche())
  setTimeout(refreshIntegrations, 10_000)
  setInterval(refreshIntegrations, 5 * 60_000)
  // Branchement Claude Code (accord de l'utilisateur) : reposé au démarrage (jeton et chemins à jour), puis
  // vérifié chaque minute. Seulement par le Nuage qui tient le port 47823, jamais en auto-test : le 06/10/2026,
  // une copie lancée par Claude (conteneur MSIX, autre jeton) avait reposé les hooks avec SON jeton ; le vrai
  // Nuage répondait 403 à tout (aucune demande d'autorisation dans l'encoche ni sur le téléphone).
  let claudeCodeChecked = false
  const healClaudeCode = () => {
    if (process.env.NUAGE_AUTOTEST_DIR || !hookServer.listening) return
    const first = !claudeCodeChecked
    claudeCodeChecked = true
    if (claudeConfig.hookState(settings.nuageToken) === 'autre' || (first && settings.claudeCodeWanted)) {
      installClaudeCode().catch(error => debugLog('Claude Code, branchement impossible :', error.message))
    }
  }
  if (hookServer.listening) healClaudeCode()
  else hookServer.once('listening', healClaudeCode)
  setInterval(healClaudeCode, 60_000)

  if (process.env.NUAGE_AUTOTEST_DIR) {
    require('./outils/autotest')({
      app, getWindow: () => win, getPanel: () => panel, togglePanel, send,
      swallow, restoreLastSwallowed, protectedReason,
      getEncoche: () => encoche, openChat, finishDrag, setChatHint, isNuageInBar: () => nuageInBar, toggleVisible,
      moveIsland: pos => {
        settings.encochePos = pos
        placeEncoche()
      },
      chatZonePoint: () => {
        const a = screen.getPrimaryDisplay().workArea
        return {
          top: { x: Math.round(a.x + a.width / 2), y: a.y + 5 },
          middle: { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) },
          corner: { x: a.x + 60, y: a.y + 5 }, // en haut à gauche, loin de la barre : il s'y pose
        }
      },
      openSettings, getToken: () => settings.nuageToken,
      getDownloadToken: () => settings.downloadToken,
      showPhoneQr,
      openPhoneMenu, phoneState, showPhoneState: data => sendTo(encoche, 'telephone', data),
      voiceEvent: onVoiceEvent, phoneApi,
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    showNuage()
    send('system', 'hello-again')
  })
  app.whenReady().then(start)
  app.on('before-quit', () => {
    quitting = true
    stopMediaWatcher()
    downloads?.stop()
    stopLink()
    voice?.stop()
    natural.stop()
    coolChat()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}

// Pont minimal et sûr entre la fenêtre de Nuage et le processus principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const listen = channel => callback => ipcRenderer.on(channel, (_event, data) => callback(data))

contextBridge.exposeInMainWorld('nuage', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  firstRunDone: () => ipcRenderer.send('settings:first-run-done'),
  ready: () => ipcRenderer.send('renderer:ready'),
  setInteractive: on => ipcRenderer.send('mouse:interactive', Boolean(on)),
  dragStart: () => ipcRenderer.send('drag:start'),
  // Renvoie 'chat' (lâché en haut de l'écran : chat ouvert), 'context' (Maj) ou ''
  dragEnd: withContext => ipcRenderer.invoke('drag:end', Boolean(withContext)),
  showMenu: () => ipcRenderer.send('menu:popup'),
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  mediaCommand: command => ipcRenderer.send('media:command', String(command)),
  // Glisser-déposer : chemin du fichier déposé, envoi à la Corbeille, annulation
  pathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  swallow: paths => ipcRenderer.invoke('trash:swallow', paths.map(String)),
  undoSwallow: () => ipcRenderer.invoke('trash:undo'),
  debug: message => ipcRenderer.send('debug:log', String(message)),
  pomodoroState: running => ipcRenderer.send('pomodoro:state', Boolean(running)),
  showDownload: file => ipcRenderer.send('download:show', String(file)),
  onSettings: listen('settings'),
  onCursor: listen('cursor'),
  onIdleState: listen('idle-state'),
  onSystem: listen('system'),
  onRemind: listen('remind'),
  onPomodoro: listen('pomodoro'),
  onWeather: listen('weather'),
  onMedia: listen('media'),
  onNotice: listen('notice'),
  onAgentEvent: listen('agent-event'),
  onDragZone: listen('drag-zone'),
  onBar: listen('bar'), // 'enter' : il plonge dans la barre ; 'leave' : il en ressort
  onDownload: listen('download'), // téléchargements : progress, done, cancel, idle
  // Voix : « Hey Nuage » (état de l'écoute) et réponses lues à voix haute
  onVoice: listen('voice'),
  onSpeak: listen('speak'),
  onSpeakAudio: listen('speak-audio'), // voix naturelle : le son de chaque phrase (WAV)
  onPhoneCharge: listen('phone-charge'), // le téléphone charge : branché, %, plein, débranché
  voiceSpoken: () => ipcRenderer.send('voice:spoken'),
  // Nuage habite l'encoche : ses bulles y sont affichées, le clic sur une bulle « à action » revient ici
  homeSay: line => ipcRenderer.send('nuage:home-say', line),
  onHomeAction: listen('home-action'),
})

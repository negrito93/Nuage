// Pont de l'encoche (barre du haut : chat, agents, autorisations, limites, intégrations).
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const listen = channel => callback => ipcRenderer.on(channel, (_event, data) => callback(data))

contextBridge.exposeInMainWorld('encoche', {
  getState: () => ipcRenderer.invoke('encoche:state'),
  onAgents: listen('agents'),
  onIntegrations: listen('integrations'),
  onSettings: listen('encoche-settings'),
  onHint: listen('encoche:hint'),
  onHover: listen('encoche:hover'),
  onPlace: listen('encoche:place'),
  onNuageOut: listen('nuage:out'),
  onWeather: listen('weather'),
  // Nuage habite l'encoche : ses bulles, ouvrir / basculer le panneau, repas (corbeille) depuis l'îlot
  onNotice: listen('encoche:notice'),
  noticeAction: id => ipcRenderer.send('encoche:notice-action', String(id)),
  onOpen: listen('encoche:open'),
  onToggle: listen('encoche:toggle'),
  dropToSwallow: paths => ipcRenderer.invoke('drop:swallow', paths.map(String)),
  undoSwallow: () => ipcRenderer.invoke('drop:undo'),
  setMode: mode => ipcRenderer.send('encoche:mode', String(mode)),
  setRect: r => ipcRenderer.send('encoche:rect', { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }),
  dragStart: () => ipcRenderer.send('encoche:drag-start'),
  dragEnd: () => ipcRenderer.send('encoche:drag-end'),
  nuageOut: () => ipcRenderer.send('encoche:nuage-out'),
  setSounds: on => ipcRenderer.send('encoche:sounds', Boolean(on)),
  focus: () => ipcRenderer.send('encoche:focus'),
  resolve: (id, choice, answers) => ipcRenderer.send('agents:resolve', String(id), String(choice), answers || null),
  fileDiff: (sessionId, filePath) => ipcRenderer.invoke('agents:diff', String(sessionId), String(filePath)),
  stepDetail: (sessionId, stepId) => ipcRenderer.invoke('agents:step', String(sessionId), String(stepId)),
  refreshUsage: () => ipcRenderer.send('agents:usage'),
  openSession: cwd => ipcRenderer.send('agents:open', String(cwd || '')),
  setPermissions: on => ipcRenderer.send('agents:permissions', Boolean(on)),
  refreshIntegrations: () => ipcRenderer.send('integrations:refresh'),
  openUrl: url => ipcRenderer.send('open:url', String(url)),
  // Réglages (08/10/2026 : « tous les réglages du Nuage doivent être dans la barre ») : vue Réglages (reglages.js).
  // Les clés ne font que passer vers le processus principal : elles ne sont jamais relues ici.
  reglages: {
    onOpen: listen('reglages:open'), // { section, prefill, welcome } demandé par Nuage (menu, premier lancement)
    onUpdate: listen('cnx:update'),
    onBar: listen('reglages:bar'),
    onProgress: listen('cnx:progress'),
    getState: () => ipcRenderer.invoke('cnx:state'),
    bar: () => ipcRenderer.invoke('reglages:bar'),
    set: (key, value) => ipcRenderer.send('reglages:set', String(key), typeof value === 'number' || typeof value === 'boolean' ? value : String(value)),
    action: id => ipcRenderer.send('reglages:action', String(id)),
    setSecret: (name, value) => ipcRenderer.invoke('cnx:secret', String(name), String(value || '')),
    claudeCode: action => ipcRenderer.invoke('cnx:claude-code', String(action)),
    test: id => ipcRenderer.invoke('cnx:test', String(id)),
    account: (id, action) => ipcRenderer.invoke('cnx:account', String(id), String(action)),
    use: id => ipcRenderer.invoke('cnx:use', String(id)),
    openClaudeDownload: () => ipcRenderer.send('cnx:claude-download'),
    extList: () => ipcRenderer.invoke('ext:list'),
    extExamine: input => ipcRenderer.invoke('ext:examine', String(input || '')),
    extInstall: (input, choice) => ipcRenderer.invoke('ext:install', String(input || ''), { plugin: String(choice?.plugin || ''), replace: Boolean(choice?.replace) }),
    extRemove: id => ipcRenderer.invoke('ext:remove', String(id)),
  },
  pathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  dropToChat: paths => ipcRenderer.send('drop:chat', paths.map(String)),
  dropToEmail: paths => ipcRenderer.invoke('drop:email', paths.map(String)),
  dropToPhone: paths => ipcRenderer.send('drop:phone', paths.map(String)),
  // Voix (« Hey Nuage ») : état de l'écoute, bouton micro, repli demandé à la voix
  onVoice: listen('voice'),
  onFold: listen('encoche:fold'),
  setVoice: on => ipcRenderer.send('encoche:voice', Boolean(on)),
  listen: () => ipcRenderer.send('encoche:listen'), // bouton micro du chat : parler tout de suite
  // Menu Téléphone (Nuage de poche)
  onPhone: listen('telephone'),
  onTab: listen('encoche:tab'),
  onPhoneQr: listen('tel:qr'), // QR code d'association ou d'installation, montré dans le menu Téléphone
  phoneAction: (name, arg) => ipcRenderer.send('tel:action', String(name), arg === undefined ? null : typeof arg === 'boolean' ? arg : String(arg)),
  // Chat
  chat: {
    onOpen: listen('chat:open'),
    onState: listen('chat:update'),
    onDelta: listen('chat:delta'),
    listModels: provider => ipcRenderer.invoke('chat:models', String(provider)),
    choose: (provider, model) => ipcRenderer.send('chat:choose', String(provider), String(model || '')),
    setEffort: effort => ipcRenderer.send('chat:effort', String(effort || '')), // '' = celui de l'IA par défaut
    openImage: (index, k) => ipcRenderer.send('chat:open-image', Number(index), Number(k)),
    send: text => ipcRenderer.send('chat:send', String(text || '')),
    stop: () => ipcRenderer.send('chat:stop'),
    reset: () => ipcRenderer.send('chat:reset'),
    pickFiles: () => ipcRenderer.invoke('chat:pick'),
    unattach: index => ipcRenderer.send('chat:unattach', Number(index)),
    login: () => ipcRenderer.invoke('chat:login'),
    continueSession: id => ipcRenderer.invoke('chat:continue-session', String(id)),
    leaveSession: () => ipcRenderer.send('chat:leave-session'),
    newSession: choose => ipcRenderer.invoke('chat:new-session', Boolean(choose)),
    permission: (id, choice) => ipcRenderer.send('chat:permission', String(id), String(choice)),
  },
})

// Branchement de Nuage dans les réglages de Claude Code (~/.claude/settings.json), avec l'accord
// de l'utilisateur : hooks HTTP vers Nuage (127.0.0.1) et barre d'état (limites d'utilisation).
// Les entrées de Nuage sont reconnaissables à leur adresse et se retirent sans toucher au reste.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PORT } = require('./serveur')

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')
const MARK = `127.0.0.1:${PORT}`
const EVENTS = { SessionStart: 5, UserPromptSubmit: 5, Notification: 5, Stop: 5, SessionEnd: 5, PermissionRequest: 60 }

function read() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Réglages Claude Code illisibles : ${error.message}`)
  }
}
function write(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
  const backup = `${SETTINGS}.avant-nuage`
  if (fs.existsSync(SETTINGS) && !fs.existsSync(backup)) fs.copyFileSync(SETTINGS, backup)
  fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
const isOurs = value => JSON.stringify(value || '').includes(MARK) || JSON.stringify(value || '').includes('nuage-statut')

function withoutNuage(settings) {
  for (const event of Object.keys(settings.hooks || {})) {
    settings.hooks[event] = settings.hooks[event].filter(group => !isOurs(group))
    if (!settings.hooks[event].length) delete settings.hooks[event]
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks
  return settings
}

// Retourne la barre d'état d'avant (pour la remettre au retrait)
function install({ token, statusExe }) {
  const settings = withoutNuage(read())
  settings.hooks = settings.hooks || {}
  for (const [event, timeout] of Object.entries(EVENTS)) {
    const group = { hooks: [{ type: 'http', url: `http://${MARK}/hook`, headers: { 'X-Nuage-Jeton': token }, timeout }] }
    if (event === 'PermissionRequest') group.matcher = '*'
    settings.hooks[event] = [...(settings.hooks[event] || []), group]
  }
  let previousStatusLine = null
  if (statusExe) {
    if (settings.statusLine && !isOurs(settings.statusLine)) previousStatusLine = settings.statusLine
    settings.statusLine = { type: 'command', command: statusExe, padding: 0 }
  }
  write(settings)
  return { previousStatusLine }
}

function uninstall({ previousStatusLine } = {}) {
  const settings = withoutNuage(read())
  if (isOurs(settings.statusLine)) {
    if (previousStatusLine) settings.statusLine = previousStatusLine
    else delete settings.statusLine
  }
  write(settings)
}

// 'absent' : pas de hooks de Nuage ; 'ok' : hooks avec ce jeton ; 'autre' : hooks posés par une autre copie
// de Nuage (autre jeton : le serveur répond 403 et Claude Code continue comme si Nuage n'était pas là)
function hookState(token) {
  try {
    const hooks = read().hooks
    if (!isOurs(hooks)) return 'absent'
    return JSON.stringify(hooks).includes(`"X-Nuage-Jeton":${JSON.stringify(String(token))}`) ? 'ok' : 'autre'
  } catch {
    return 'absent'
  }
}
const isInstalled = token => hookState(token) === 'ok'

module.exports = { install, uninstall, isInstalled, hookState, SETTINGS }

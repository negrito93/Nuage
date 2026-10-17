// Coffre des clés d'API (fournisseurs d'IA, intégrations), chiffrées par Windows (safeStorage,
// lié à la session de l'utilisateur) dans %APPDATA%\Nuage\cles.json. Les fenêtres peuvent
// enregistrer ou effacer une clé et savoir si elle existe, jamais la relire.
const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')

const file = () => path.join(app.getPath('userData'), 'cles.json')
let cache = null

function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8')
}

function set(name, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement Windows indisponible')
  const store = load()
  const clean = String(value || '').trim()
  if (clean) store[name] = safeStorage.encryptString(clean).toString('base64')
  else delete store[name]
  save()
}
function get(name) {
  const stored = load()[name]
  if (!stored) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}
const has = name => Boolean(load()[name])
const names = () => Object.keys(load())

module.exports = { set, get, has, names }

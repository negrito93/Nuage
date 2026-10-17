// Test du branchement Claude Code (claude-config.js) dans un dossier personnel temporaire, jamais le vrai.
// Usage : node outils/test-claude-config.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-claude-config-'))
process.env.USERPROFILE = home
process.env.HOME = home
const config = require('../claude-config')
assert.ok(config.SETTINGS.startsWith(home), 'réglages temporaires seulement')

assert.equal(config.hookState('a1'), 'absent')
config.install({ token: 'a1', statusExe: '' })
assert.equal(config.hookState('a1'), 'ok')
assert.equal(config.isInstalled('a1'), true)
// Incident du 06/10/2026 : hooks reposés par une autre copie de Nuage (autre jeton) → 403 sur le vrai Nuage
assert.equal(config.hookState('b2'), 'autre')
assert.equal(config.isInstalled('b2'), false)
config.install({ token: 'b2', statusExe: '' })
assert.equal(config.hookState('b2'), 'ok')
assert.equal(config.hookState('a1'), 'autre', 'l’ancien jeton est remplacé, pas ajouté')
config.uninstall()
assert.equal(config.hookState('b2'), 'absent')

fs.rmSync(home, { recursive: true, force: true })
console.log('test-claude-config : OK (absent, ok, jeton d’une autre copie, remplacement, retrait)')

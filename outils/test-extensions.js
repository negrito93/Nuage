// Test des compétences et plugins de Nuage (extensions.js), dans un dossier personnel temporaire.
// Usage : node outils/test-extensions.js   (aucun réseau, aucune modification du vrai ~/.nuage)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-extensions-'))
process.env.USERPROFILE = home
process.env.HOME = home
const ext = require('../extensions')
assert.equal(ext.skillsDir(), path.join(home, '.nuage', 'competences'), 'dossier de Nuage (pas celui de Claude Code), temporaire ici')

// 1. Commandes : comprises par Nuage lui-même (aucun claude.exe)
assert.deepEqual(ext.parse('/plugin install design@claude-plugins'), { type: 'plugin', name: 'design', catalogue: 'claude-plugins' })
assert.deepEqual(ext.parse('/plugin install x@y --scope user'), { type: 'plugin', name: 'x', catalogue: 'y' })
assert.deepEqual(ext.parse('claude plugin marketplace add owner/repo'), { type: 'github', owner: 'owner', repo: 'repo', ref: '', dir: '' })
assert.throws(() => ext.parse('/plugin install x --accept-command abc'), /inconnue/)
assert.throws(() => ext.parse('/plugin install x'), /nom@catalogue/)
assert.throws(() => ext.parse('/plugin eval x'), /comprend/)
// 2. Liens
assert.deepEqual(ext.parse('https://github.com/anthropics/skills'), { type: 'github', owner: 'anthropics', repo: 'skills', ref: '', dir: '' })
assert.deepEqual(ext.parse('https://github.com/o/r/tree/main/skills/pdf'), { type: 'github', owner: 'o', repo: 'r', ref: 'main', dir: 'skills/pdf' })
assert.deepEqual(ext.parse('https://github.com/o/r/blob/main/skills/pdf/SKILL.md'), { type: 'github', owner: 'o', repo: 'r', ref: 'main', dir: 'skills/pdf' })
assert.deepEqual(ext.parse('/skill o/r'), { type: 'github', owner: 'o', repo: 'r', ref: '', dir: '' })
assert.deepEqual(ext.parse('anthropic/skills/web-search'), { type: 'github', owner: 'anthropic', repo: 'skills', ref: '', dir: 'web-search' })
assert.deepEqual(ext.parse('anthropics/skills/pdf/SKILL.md'), { type: 'github', owner: 'anthropics', repo: 'skills', ref: '', dir: 'pdf' })
assert.equal(ext.parse('https://exemple.fr/ma-competence.zip').type, 'zip')
assert.equal(ext.parse('https://exemple.fr/x/SKILL.md').type, 'fichier')
assert.throws(() => ext.parse('https://exemple.fr/marketplace.json'), /non pris en charge/)
assert.throws(() => ext.parse('http://exemple.fr/x.zip'), /https/)
assert.throws(() => ext.parse('rm -rf /'), /ni un lien ni une commande/)
// 3. En-tête de SKILL.md (description sur plusieurs lignes)
assert.deepEqual(ext.frontmatter('---\nname: pdf\ndescription: >\n  Lit et remplit\n  des PDF.\n---\n# PDF'), { name: 'pdf', description: 'Lit et remplit des PDF.' })
// 4. Compétence trouvée dans un dossier (comme une archive décompressée), installée, protégée, retirée
const src = path.join(home, 'archive', 'dossier', 'ma-comp')
fs.mkdirSync(path.join(src, 'scripts'), { recursive: true })
fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: ma-comp\ndescription: Une compétence de test.\n---\nBonjour')
fs.writeFileSync(path.join(src, 'scripts', 'outil.txt'), 'ok')
const found = ext.localSkills(path.join(home, 'archive'))
assert.deepEqual(found.map(s => s.name), ['ma-comp'])
const trashed = []
const trash = async dir => {
  trashed.push(dir)
  fs.rmSync(dir, { recursive: true, force: true })
}
;(async () => {
  assert.equal(await ext.installSkill(found[0], { replace: false, trash }), 'ma-comp')
  assert.ok(fs.existsSync(path.join(ext.skillsDir(), 'ma-comp', 'scripts', 'outil.txt')))
  assert.deepEqual(ext.listSkills(), [{ name: 'ma-comp', description: 'Une compétence de test.' }])
  await assert.rejects(ext.installSkill(found[0], { replace: false, trash }), /existe déjà/)
  await ext.installSkill(found[0], { replace: true, trash })
  assert.equal(trashed.length, 1, 'l’ancienne version part à la corbeille avant d’être remplacée')
  await assert.rejects(ext.remove('../hors', { trash }), /invalide/)
  await ext.remove('ma-comp', { trash })
  assert.deepEqual(ext.listSkills(), [])
  fs.rmSync(home, { recursive: true, force: true })
  console.log('test-extensions : OK (commandes, liens, en-tête SKILL.md, installation dans ~/.nuage, remplacement, retrait)')
})().catch(error => {
  console.error(error)
  process.exit(1)
})

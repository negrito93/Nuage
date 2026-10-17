// Test de ce que l'IA du chat fait elle-même (actions.js) et de sa boucle d'outils (chat.js sendOpenAI), dans un dossier
// personnel temporaire, sans réseau ni vraie IA (client simulé).
// Usage : node outils/test-actions.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-actions-'))
process.env.USERPROFILE = home
process.env.HOME = home
const actions = require('../actions')
const chat = require('../chat')
const ext = require('../extensions')

const stream = chunks => (async function* () {
  for (const delta of chunks) yield { choices: [{ delta }] }
})()

;(async () => {
  const asked = []
  let allow = true
  const ctx = {
    permit: async tool => {
      asked.push(tool)
      return allow
    },
    trash: async p => fs.rmSync(p, { recursive: true, force: true }),
    onTool: () => {},
  }
  // 1. Compétence installée : lue sans rien demander, avec la liste de ses autres fichiers
  const skill = path.join(ext.skillsDir(), 'bonjour')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: bonjour\ndescription: Saluer chaleureusement.\n---\nDis bonjour avec un sourire.')
  fs.writeFileSync(path.join(skill, 'ref.md'), 'détails')
  const lu = await actions.run('utiliser_competence', '{"nom":"bonjour"}', ctx)
  assert.match(lu, /Dis bonjour/)
  assert.match(lu, /ref\.md/)
  assert.match(await actions.run('lire_fichier', { chemin: path.join(skill, 'ref.md') }, ctx), /détails/)
  assert.equal(asked.length, 0, 'lire une compétence ne demande rien')
  assert.match(await actions.run('utiliser_competence', { nom: '../x' }, ctx), /introuvable/)

  // 2. Fichiers et commandes : accord demandé à chaque fois, refus respecté
  const f = path.join(home, 'notes', 'a.txt')
  assert.match(await actions.run('ecrire_fichier', { chemin: f, contenu: 'salut' }, ctx), /créé/)
  assert.equal(fs.readFileSync(f, 'utf8'), 'salut')
  assert.equal(await actions.run('lire_fichier', { chemin: f }, ctx), 'salut')
  assert.match(await actions.run('lister_dossier', { chemin: path.dirname(f) }, ctx), /a\.txt/)
  assert.match(await actions.run('ecrire_fichier', { chemin: f, contenu: 'v2' }, ctx), /remplacé/)
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2')
  assert.deepEqual(asked, ['ecrire_fichier', 'lire_fichier', 'lister_dossier', 'ecrire_fichier'])
  allow = false
  assert.equal(await actions.run('lire_fichier', { chemin: f }, ctx), actions.REFUSED)
  assert.equal(await actions.run('executer_commande', { commande: 'Get-Date' }, ctx), actions.REFUSED)
  allow = true
  assert.match(await actions.run('executer_commande', { commande: 'Write-Output "été ok"' }, ctx), /code de sortie 0\)\nété ok/)
  assert.match(await actions.run('lire_page_web', { url: 'file:///C:/x' }, ctx), /http/)
  assert.match(await actions.run('lire_fichier', '{oups', ctx), /illisibles/)
  assert.match(await actions.run('outil_inconnu', {}, ctx), /inconnu/)

  // 3. Boucle d'outils : le modèle lit la compétence (appel découpé en morceaux), puis répond
  const replies = [
    [{ tool_calls: [{ index: 0, id: 'c1', function: { name: 'utiliser_competence', arguments: '{"nom":' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"bonjour"}' } }] }],
    [{ content: 'Bonjour !' }],
  ]
  const sent = []
  const client = { chat: { completions: { create: async body => {
    sent.push(JSON.parse(JSON.stringify(body)))
    return stream(replies.shift())
  } } } }
  let out = ''
  const tools = []
  await chat.sendOpenAI(client, 'test:modele', 'modele', [{ role: 'user', text: 'salue-moi' }], undefined, t => { out += t }, { ...ctx, onTool: l => tools.push(l) })
  assert.equal(out, 'Bonjour !')
  assert.deepEqual(tools, ['Lit la compétence « bonjour »'])
  assert.ok(sent[0].tools.some(t => t.function.name === 'installer_extension'))
  assert.match(sent[0].messages[0].content, /- bonjour : Saluer chaleureusement\./, 'les compétences installées sont dans le message système')
  assert.doesNotMatch(sent[0].messages[0].content, /Claude Code/)
  assert.equal(sent[1].messages.at(-1).role, 'tool')
  assert.match(sent[1].messages.at(-1).content, /Dis bonjour/)

  // 4. Modèle qui ne connaît pas les outils : Nuage repart sans eux (la balise [[installer: …]] est expliquée)
  const noTool = Object.assign(new Error('No endpoints found that support tool use'), { status: 404 })
  const client2 = { chat: { completions: { create: async body => {
    if (body.tools) throw noTool
    sent.push(body)
    return stream([{ content: 'ok' }])
  } } } }
  out = ''
  await chat.sendOpenAI(client2, 'test:sans-outils', 'm', [{ role: 'user', text: 'x' }], undefined, t => { out += t }, ctx)
  assert.equal(out, 'ok')
  assert.match(sent.at(-1).messages[0].content, /\[\[installer: X\]\]/)

  // « Toujours » : la même action seulement (09/10/2026) ; une autre commande, un autre fichier redemandent l'accord
  const { alwaysKey } = actions
  const cmd = c => alwaysKey('executer_commande', 'Lancer une commande PowerShell', c)
  assert.equal(cmd('Get-Date'), cmd('Get-Date'))
  assert.notEqual(cmd('Get-Date'), cmd('Copy-Item Chrome\\History $env:TEMP'))
  assert.notEqual(alwaysKey('lire_fichier', 'Lire « C:\\a.txt »', ''), alwaysKey('lire_fichier', 'Lire « C:\\b.txt »', ''))
  assert.equal(alwaysKey('lire_page_web', 'Lire la page meteo.fr', 'https://meteo.fr/a'), alwaysKey('lire_page_web', 'Lire la page meteo.fr', 'https://meteo.fr/b'))
  // La consigne de l'IA : pas de contournement ni de fouille du PC quand quelque chose bloque
  assert.match(chat.systemPrompt(true), /ne fouille jamais le PC/)

  fs.rmSync(home, { recursive: true, force: true })
  console.log('test-actions : OK (compétences, fichiers, commandes, refus, boucle d’outils, modèle sans outils, « Toujours » limité à la même action)')
})().catch(error => {
  console.error(error)
  process.exit(1)
})

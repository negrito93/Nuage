// Test d'abonnements.js et mcp-nuage.js, sans compte ni réseau : conversation mise en texte, lecture des événements
// d'Antigravity (agy) et de Codex, réglages écrits (outils de Nuage seulement), aller-retour MCP → faux Nuage.
// node outils/test-abonnements.js
const assert = require('node:assert')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-abo-'))
process.env.USERPROFILE = tmp // ~/.nuage du test
const ab = require('../abonnements')
const { TOOLS } = require('../actions')

;(async () => {
  // Conversation : un seul message tel quel ; plusieurs : l'historique puis le nouveau message ; textes joints inclus
  assert.equal(ab.transcript([{ role: 'user', text: 'Salut' }]), 'Salut')
  const t = ab.transcript([
    { role: 'user', text: 'Résume', attachments: [{ kind: 'text', name: 'a.txt', text: 'contenu' }, { kind: 'image', name: 'p.png' }] },
    { role: 'assistant', text: 'Voilà' },
    { role: 'user', text: 'Merci' },
  ])
  assert.match(t, /^Conversation jusqu’ici :\n\nUtilisateur : Résume/)
  assert.match(t, /Fichier joint « a\.txt » :\n```\ncontenu/)
  assert.match(t, /« p\.png » : non transmis/)
  assert.match(t, /Nuage : Voilà\n\nNouveau message de l’utilisateur :\nMerci$/)

  // Images jointes (09/10/2026) : écrites dans ~/.nuage/<outil>/pieces ; agy est invité à les voir (voir_image),
  // Codex les reçoit avec le message
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const withImage = [{ role: 'user', text: 'Tu vois quoi ?', attachments: [{ kind: 'image', name: 'Capture.png', mime: 'image/png', data: PNG }, { kind: 'pdf', name: 'doc.pdf' }] }]
  const names = ab.writeImages('agy', withImage)
  const pieces = path.join(tmp, '.nuage', 'agy', 'pieces')
  assert.deepEqual(fs.readdirSync(pieces), ['image-1.png'])
  assert.equal(fs.readFileSync(path.join(pieces, 'image-1.png')).toString('base64'), PNG)
  assert.match(ab.transcript(withImage, 'agy', names), /« Capture\.png » : regarde-la avec l’outil voir_image, nom « image-1\.png »/)
  assert.match(ab.transcript(withImage, 'codex', names), /« Capture\.png » : c’est l’image 1 des images jointes/)
  assert.match(ab.transcript(withImage, 'agy', names), /« doc\.pdf » : non transmis/)
  ab.writeImages('agy', [{ role: 'user', text: 'Et maintenant ?' }])
  assert.ok(!fs.existsSync(pieces), 'les images du message d’avant restent sur le disque')
  ab.writeImages('agy', withImage)

  // agy : morceaux de la réponse, puis le résultat
  let text = ''
  let r = ab.reader('agy', s => { text += s })
  r.event({ event: 'init', init: {} })
  r.event({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'mcp' } })
  r.event({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Bon' } })
  r.event({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'jour' } })
  r.event({ event: 'result', result: { status: 'SUCCESS' } })
  assert.equal(text, 'Bonjour')
  assert.deepEqual(r.state, { ok: true, failure: '' })
  r = ab.reader('agy', () => {})
  r.event({ event: 'result', result: { status: 'ERROR', error: 'quota épuisé' } })
  assert.deepEqual(r.state, { ok: false, failure: 'quota épuisé' })

  // Codex : une mise à jour redonne tout le texte (pas de doublon) ; deuxième message séparé ; reconnexion ignorée
  text = ''
  r = ab.reader('codex', s => { text += s })
  r.event({ type: 'error', message: 'Reconnecting... 1/5' })
  r.event({ type: 'item.updated', item: { id: 'a', type: 'agent_message', text: 'Je regarde' } })
  r.event({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'Je regarde.' } })
  r.event({ type: 'item.completed', item: { id: 'b', type: 'mcp_tool_call' } })
  r.event({ type: 'item.completed', item: { id: 'c', type: 'agent_message', text: 'Fini' } })
  r.event({ type: 'turn.completed' })
  assert.equal(text, 'Je regarde.\n\nFini')
  assert.deepEqual(r.state, { ok: true, failure: '' })
  r = ab.reader('codex', () => {})
  r.event({ type: 'turn.failed', error: { message: '401 Unauthorized' } })
  assert.equal(r.state.failure, '401 Unauthorized')

  // Réglages : seulement les outils de Nuage (serveur MCP « nuage »), les leurs refusés ; consignes dans AGENTS.md
  ab.configure({ token: 'jeton-test', port: 47999 })
  ab.prepare('agy', 'Tu es Nuage.')
  const g = path.join(tmp, '.nuage', 'agy', '.gemini')
  const mcp = JSON.parse(fs.readFileSync(path.join(g, 'config', 'mcp_config.json'), 'utf8')).mcpServers.nuage
  assert.equal(mcp.env.NUAGE_JETON, 'jeton-test')
  assert.equal(mcp.env.ELECTRON_RUN_AS_NODE, '1')
  assert.ok(mcp.args[0].endsWith('mcp-nuage.js'))
  const perms = JSON.parse(fs.readFileSync(path.join(g, 'antigravity-cli', 'settings.json'), 'utf8')).permissions
  assert.deepEqual(perms.allow, ['mcp(nuage/*)'])
  for (const d of ['write_file(*)', 'command(*)', 'unsandboxed(*)']) assert.ok(perms.deny.includes(d), d)
  // Lecture permise sans règle (grande image rangée par agy dans son dossier) : hors de ses dossiers, refus d'office
  // en mode -p (essai réel du 09/10/2026 : win.ini refusé) ; son dossier temporaire est à lui, pas celui du PC
  assert.ok(!perms.deny.includes('read_file(*)'))
  assert.equal(ab.env('agy').TEMP, path.join(tmp, '.nuage', 'agy', 'temp'))
  assert.match(fs.readFileSync(path.join(tmp, '.nuage', 'agy', 'travail', 'AGENTS.md'), 'utf8'), /^Tu es Nuage\./)
  ab.prepare('codex', 'Tu es Nuage.')
  const toml = fs.readFileSync(path.join(tmp, '.nuage', 'codex', 'config.toml'), 'utf8')
  for (const line of ['approval_policy = "never"', 'sandbox_mode = "read-only"', 'shell_tool = false', '[mcp_servers.nuage]', 'NUAGE_JETON = "jeton-test"']) assert.ok(toml.includes(line), line)
  assert.match(toml, /command = ".*\\\\.*"/) // chemin Windows échappé (chaîne TOML)

  // Pas installé : message clair, sans lancer quoi que ce soit
  await assert.rejects(ab.send('agy', { messages: [{ role: 'user', text: 'x' }], system: 's', onText() {} }), /pas encore installé/)
  assert.deepEqual(await ab.status('codex'), { installed: false, loggedIn: false })

  // MCP : liste des outils de Nuage, appel transmis au serveur local (jeton vérifié), réponse rendue à l'IA
  const calls = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      if (req.headers['x-nuage-jeton'] !== 'jeton-test' || req.url !== '/outil') return res.writeHead(403).end('{}')
      calls.push(JSON.parse(body))
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: 'contenu du fichier' }))
    })
  }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-nuage.js')], { env: { ...process.env, NUAGE_PORT: String(server.address().port), NUAGE_JETON: 'jeton-test', NUAGE_PIECES: pieces } })
  const replies = []
  let buf = ''
  child.stdout.on('data', d => {
    buf += d
    let end
    while ((end = buf.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buf.slice(0, end)))
      buf = buf.slice(end + 1)
    }
  })
  const ask = msg => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  ask({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  ask({ method: 'notifications/initialized' })
  ask({ id: 2, method: 'tools/list' })
  ask({ id: 3, method: 'tools/call', params: { name: 'lire_fichier', arguments: { chemin: 'Documents\\a.txt' } } })
  ask({ id: 4, method: 'tools/call', params: { name: 'voir_image', arguments: { nom: 'image-1.png' } } })
  ask({ id: 5, method: 'tools/call', params: { name: 'voir_image', arguments: { nom: '..\\..\\codex\\config.toml' } } })
  for (let i = 0; i < 50 && replies.length < 5; i++) await new Promise(resolve => setTimeout(resolve, 100))
  child.kill()
  server.close()
  const byId = Object.fromEntries(replies.map(m => [m.id, m]))
  assert.equal(byId[1].result.serverInfo.name, 'nuage')
  assert.equal(byId[2].result.tools.length, TOOLS.length + 1)
  assert.ok(byId[2].result.tools.some(x => x.name === 'voir_image'))
  assert.ok(byId[2].result.tools.every(x => x.inputSchema?.type === 'object'))
  assert.equal(byId[3].result.content[0].text, 'contenu du fichier')
  assert.deepEqual(byId[4].result.content, [{ type: 'image', data: PNG, mimeType: 'image/png' }])
  assert.equal(byId[5].result.isError, true) // rien en dehors du dossier des images jointes
  assert.deepEqual(calls, [{ name: 'lire_fichier', args: { chemin: 'Documents\\a.txt' } }]) // voir_image ne passe pas par Nuage

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('test-abonnements : OK (conversation, images jointes, événements agy et Codex, réglages « outils de Nuage seulement », pas installé, aller-retour MCP, voir_image)')
})().catch(error => {
  console.error(error)
  process.exit(1)
})

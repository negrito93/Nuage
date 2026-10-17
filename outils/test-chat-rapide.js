// Test de « Claude gardé au chaud » (chat.js createSessionWorker) avec un faux claude.exe en Node
// (outils/faux-claude.js) : rien n'est envoyé à Claude, aucun abonnement utilisé.
// Usage : node outils/test-chat-rapide.js
const assert = require('node:assert/strict')
const path = require('node:path')
const { createSessionWorker } = require('../chat')

const fake = path.join(__dirname, 'faux-claude.js')
const make = (extra = {}) => createSessionWorker({ exe: process.execPath, prefixArgs: [fake], cwd: __dirname, ...extra })
async function ask(worker, text, extra = {}) {
  let answer = ''
  const tools = []
  await worker.send({ text, attachments: [], onText: t => { answer += t }, onTool: t => tools.push(t), ...extra })
  return { answer: answer.trim(), tools }
}

;(async () => {
  let initId = null
  const worker = make({ onInit: id => { initId = id } })
  // 1. Deux messages : le même processus répond aux deux (il n'est pas relancé)
  const t0 = Date.now()
  const first = await ask(worker, 'Bonjour')
  assert.equal(first.answer, `Réponse 1 du processus ${worker.pid}`)
  assert.equal(initId, `faux-${worker.pid}`)
  const second = await ask(worker, 'Et ensuite ?')
  assert.equal(second.answer, `Réponse 2 du processus ${worker.pid}`, 'même processus pour le 2e message')
  assert.equal(worker.alive(), true)
  const elapsed = Date.now() - t0

  // 2. Outil utilisé : son libellé est montré
  const tool = await ask(worker, 'Utilise un outil')
  assert.deepEqual(tool.tools, ['Lit main.js'])

  // 3. Autorisation demandée : la réponse de l'utilisateur est transmise
  let asked = null
  const allowed = await ask(worker, 'Demande une autorisation', { onPermission: req => { asked = req; return { behavior: 'allow' } } })
  assert.equal(asked.label, 'Modifie a.txt')
  assert.equal(allowed.answer, 'permis')
  const denied = await ask(worker, 'Encore une autorisation', { onPermission: () => ({ behavior: 'deny' }) })
  assert.equal(denied.answer, 'refusé')

  // 4. Un seul message à la fois
  const busy = worker.send({ text: 'lent', attachments: [], onText: () => {} })
  await assert.rejects(worker.send({ text: 'deux', attachments: [], onText: () => {} }), /répond déjà/)
  await busy

  // 5. Arrêter une réponse : le processus se ferme ; un nouveau prend la suite
  const controller = new AbortController()
  const slow = worker.send({ text: 'Réponds lentement', attachments: [], signal: controller.signal, onText: () => {} })
  setTimeout(() => controller.abort(), 300)
  await assert.rejects(slow, err => err.name === 'AbortError')
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(worker.alive(), false)
  await assert.rejects(worker.send({ text: 'après', attachments: [], onText: () => {} }), err => err.code === 'FERMEE')
  const next = make()
  assert.notEqual(next.pid, worker.pid)
  assert.match((await ask(next, 'Re-bonjour')).answer, /^Réponse 1 du processus/)
  next.kill()

  console.log(`test-chat-rapide : OK (même processus pour les messages suivants, outils, autorisations, un message à la fois, arrêt et relance ; 2 messages en ${elapsed} ms)`)
})().catch(error => {
  console.error('ÉCHEC :', error.stack || error.message)
  process.exit(1)
})

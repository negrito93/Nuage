// Test du résumé des agents pour le téléphone (agents-telephone.js). Usage : node outils/test-agents-telephone.js
const assert = require('node:assert/strict')
const { summarize, sessionDetail, signature, progress } = require('../agents-telephone')

const now = new Date('2026-10-06T15:00:00').getTime()
const today = now - 3600_000
const yesterday = now - 30 * 3600_000
const snapshot = {
  sessions: [
    {
      id: 's1', title: 'korus', project: 'korus', status: 'en-cours', current: 'Exécute : npm test', waiting: '', lastAt: now - 5000,
      // les plus récentes d'abord (comme agents.js)
      steps: [
        { id: 'b', kind: 'commande', label: 'Exécute : npm test', done: false, error: false, at: now - 6000 },
        { id: 'a', kind: 'edition', label: 'Modifie billing.ts (+1 −1)', done: true, error: false, at: now - 9000 },
        { id: 'm0', kind: 'message', label: 'Dit : je corrige', done: true, at: now - 9500 },
        { id: 'p2', kind: 'demande', label: 'Ta demande : Fix the VAT rounding', done: true, at: today },
        { id: 'old', kind: 'lecture', label: 'Lit README.md', done: true, at: yesterday },
        { id: 'p1', kind: 'demande', label: 'Ta demande : hier', done: true, at: yesterday },
      ],
      files: [{ path: 'C:/korus/src/billing.ts', name: 'billing.ts', added: 1, removed: 1 }],
    },
    { id: 's2', title: 'portfolio', project: 'portfolio', status: 'inactif', current: '', lastAt: yesterday, steps: [{ id: 'p0', kind: 'demande', label: 'Ta demande : vieux', at: yesterday }], files: [{ path: 'x', name: 'x', added: 50, removed: 2 }] },
  ],
  permissions: [],
}

// 1. Au travail : résumé, chiffres du jour (rien d'hier), étapes de la dernière demande seulement
let r = summarize(snapshot, { okToday: 4, now, integrations: [] })
assert.equal(r.resume.etat, 'travaille')
assert.equal(r.resume.titre, '1 au travail')
assert.match(r.resume.texte, /korus · Exécute : npm test/)
assert.deepEqual(r.aujourdhui, { tours: 1, fichiers: 1, plus: 1, moins: 1, accords: 4 })
assert.equal(r.sessions[0].total, 2, 'deux étapes depuis la dernière demande (le message ne compte pas)')
assert.equal(r.sessions[0].faites, 1)
assert.deepEqual(r.sessions[0].etapes.map(e => e.label), ['Modifie billing.ts (+1 −1)', 'Exécute : npm test'])
assert.equal(r.sessions[1].mot, 'au repos')

// 2. Une demande d'autorisation : elle passe devant tout
const asking = { ...snapshot, permissions: [{ id: 'perm-1', sessionId: 's1', title: 'korus', tool: 'Bash', label: 'Lancer : git push origin main', command: 'git push origin main', always: true, expiresAt: now + 120_000 }] }
r = summarize(asking, { now })
assert.equal(r.resume.etat, 'attente')
assert.equal(r.resume.titre, '1 en attente')
assert.equal(r.demandes[0].commande, 'git push origin main')
assert.equal(r.demandes[0].toujours, true)
assert.notEqual(signature(r), signature(summarize(snapshot, { now })), 'une nouvelle demande réveille le téléphone')
// Une étape de plus : avancement changé, mais pas la signature (pas d'envoi immédiat à chaque outil)
const stepDone = { ...snapshot, sessions: [{ ...snapshot.sessions[0], steps: snapshot.sessions[0].steps.map(st => (st.id === 'b' ? { ...st, done: true } : st)) }, snapshot.sessions[1]] }
assert.equal(signature(summarize(stepDone, { now })), signature(summarize(snapshot, { now })))
assert.notEqual(progress(summarize(stepDone, { now })), progress(summarize(snapshot, { now })))

// 3. Services : seulement ceux qui sont branchés ; emojis retirés, état « à voir » si une ligne est mauvaise
r = summarize(snapshot, {
  now,
  integrations: [
    { id: 'github', label: 'GitHub', status: 'off' },
    { id: 'vercel', label: 'Vercel', status: 'ok', lines: [{ text: '❌ korus · il y a 2 min', tone: 'mauvais' }, { text: '✅ portfolio · hier' }] },
    { id: 'stripe', label: 'Stripe', status: 'erreur', error: 'clé refusée' },
  ],
})
assert.deepEqual(r.services.map(s => [s.id, s.etat]), [['vercel', 'a-voir'], ['stripe', 'erreur']])
assert.equal(r.services[0].texte, 'korus · il y a 2 min')
assert.deepEqual(r.servicesHors, ['GitHub'])

// 4. Calme, sans session
r = summarize({ sessions: [], permissions: [] }, { now })
assert.equal(r.resume.etat, 'calme')
assert.equal(r.resume.texte, 'Aucune session récente')
assert.equal(r.ia, 'Claude')

// 4 bis. Discussion du chat avec Gemini (09/10/2026 : « rien n'apparaît alors que je suis en train de taffer ») :
// au travail en tête, son nom pour « Demande à… », ses tours comptés ; finie, elle reste à sa place selon l'heure
r = summarize({ sessions: [], permissions: [] }, { now, ia: 'Gemini', chat: { ia: 'Gemini', at: now - 5000, streaming: true, outil: '', tours: 3 } })
assert.equal(r.ia, 'Gemini')
assert.equal(r.resume.etat, 'travaille')
assert.equal(r.resume.texte, 'Discussion avec Gemini · écrit sa réponse…')
assert.deepEqual([r.sessions[0].id, r.sessions[0].chat, r.sessions[0].qui, r.sessions[0].statut], ['chat', true, 'Gemini', 'en-cours'])
assert.equal(r.aujourdhui.tours, 3)
r = summarize(snapshot, { now, ia: 'Gemini', chat: { ia: 'Gemini', at: now - 3 * 3600_000, streaming: false, outil: '', tours: 0 } })
assert.deepEqual(r.sessions.map(s => s.id), ['s1', 'chat', 's2']) // selon l'heure : après korus (5 s), avant hier
assert.equal(r.sessions[1].statut, 'inactif')
assert.ok(r.sessions.length <= 8)
r = summarize(snapshot, { now, chat: null })
assert.ok(!r.sessions.some(s => s.chat))

// 5. Détail d'une session : demande et réponse complètes, réponse ignorée si elle date d'avant la demande
const texts = { p2: 'Fix the VAT rounding, then push to main', m0: 'Je corrige l’arrondi.' }
const detail = sessionDetail(snapshot, (_id, stepId) => ({ text: texts[stepId] || '' }), 's1')
assert.equal(detail.demande, 'Fix the VAT rounding, then push to main')
assert.equal(detail.reponse, 'Je corrige l’arrondi.')
assert.equal(detail.etapes.length, 2)
assert.deepEqual(detail.fichiers, [{ nom: 'billing.ts', plus: 1, moins: 1 }])
const oldAnswer = { sessions: [{ ...snapshot.sessions[0], steps: [{ id: 'p3', kind: 'demande', label: 'Ta demande : nouvelle', at: now }, { id: 'm0', kind: 'message', label: 'Dit : vieux', at: now - 10_000 }] }] }
assert.equal(sessionDetail(oldAnswer, () => ({ text: '' }), 's1').reponse, '')
assert.equal(sessionDetail(snapshot, () => ({}), 'inconnue'), null)

console.log('test-agents-telephone : OK (résumé, chiffres du jour, demande prioritaire, services, détail de session)')

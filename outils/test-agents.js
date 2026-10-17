// Test du suivi des agents avec un faux journal Claude Code (aucun appel réseau).
// Usage : node outils/test-agents.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAgentHub } = require('../agents')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-agents-'))
const project = path.join(root, 'C--Projet-Test')
fs.mkdirSync(project)
const sid = 'session-test-1'
const journal = path.join(project, `${sid}.jsonl`)
const now = new Date().toISOString()
const line = o => `${JSON.stringify({ sessionId: sid, cwd: 'C:\\Projet\\Test', timestamp: now, ...o })}\n`

fs.writeFileSync(journal, [
  line({ type: 'custom-title', customTitle: 'Ma super session' }),
  line({ type: 'user', message: { role: 'user', content: 'Corrige le bug du menu' } }),
  line({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\Projet\\Test\\menu.js' } },
  ] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '...' }] } }),
  line({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'C:\\Projet\\Test\\menu.js', old_string: 'a', new_string: 'b' } },
  ] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] },
    toolUseResult: { filePath: 'C:\\Projet\\Test\\menu.js', structuredPatch: [{ oldStart: 1, newStart: 1, oldLines: 2, newLines: 3, lines: [' x', '-a', '+b', '+c'] }] } }),
  line({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test', description: 'Lance les tests' } },
  ] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'échec' }] } }),
].join(''))

const events = []
let state = null
const hub = createAgentHub({ projectsDir: root, permissionWaitMs: 300, onChange: s => { state = s }, onEvent: e => events.push(e) })

;(async () => {
  hub.scan()
  assert.ok(state, 'un état est publié')
  const s = state.sessions[0]
  assert.equal(s.title, 'Ma super session')
  assert.equal(s.project, 'Test')
  assert.equal(s.status, 'en-cours')
  const labels = s.steps.map(st => st.label)
  assert.ok(labels.includes('Lit menu.js'))
  assert.ok(labels.includes('Modifie menu.js (+2 −1)'), labels.join(' | '))
  assert.ok(labels.some(l => l.startsWith('Exécute : Lance les tests')))
  assert.ok(s.steps.find(st => st.label.startsWith('Exécute')).error, 'la commande en échec est marquée')
  assert.deepEqual(s.files.map(f => [f.name, f.added, f.removed]), [['menu.js', 2, 1]])
  const diff = hub.fileDiff(sid, 'C:\\Projet\\Test\\menu.js')
  assert.deepEqual(diff.edits[0].hunks[0].lines, [' x', '-a', '+b', '+c'])

  // Détail de chaque étape (activité en direct) : entrée, résultat, code modifié
  const bash = hub.stepDetail(sid, 't3')
  assert.equal(bash.input.command, 'npm test')
  assert.equal(bash.result, 'échec')
  assert.equal(bash.error, true)
  assert.deepEqual(hub.stepDetail(sid, 't2').patch[0].lines, [' x', '-a', '+b', '+c'])
  assert.equal(hub.stepDetail(sid, 't1').input.file_path, 'C:\\Projet\\Test\\menu.js')

  // Ajout de lignes au journal : lues au passage suivant, même pendant que l'outil travaille
  fs.appendFileSync(journal, line({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Je cherche où le menu est défini.' },
    { type: 'tool_use', id: 't4', name: 'Grep', input: { pattern: 'menu' } },
  ] } }))
  hub.scan()
  assert.equal(state.sessions[0].current, 'Cherche « menu »')
  assert.equal(state.sessions[0].steps[0].done, false, 'recherche en cours')
  assert.equal(state.sessions[0].steps[1].label, 'Dit : Je cherche où le menu est défini.')
  fs.appendFileSync(journal, line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'menu.js\nnav.js' }] },
    toolUseResult: { mode: 'files_with_matches', filenames: ['menu.js', 'nav.js'], numFiles: 2 } }))
  hub.scan()
  const grep = hub.stepDetail(sid, 't4')
  assert.equal(grep.done, true)
  assert.deepEqual(grep.found.files, ['menu.js', 'nav.js'])

  // Demande d'autorisation : Nuage attend la réponse
  const ask = { hook_event_name: 'PermissionRequest', session_id: sid, cwd: 'C:\\Projet\\Test', tool_name: 'Bash', tool_input: { command: 'npm install lodash' } }
  const pending = hub.handleHook(ask)
  assert.equal(state.permissions.length, 1)
  assert.equal(state.sessions[0].status, 'permission')
  assert.equal(events.at(-1).type, 'permission')
  hub.resolvePermission(state.permissions[0].id, 'always')
  assert.deepEqual(await pending, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  assert.equal(state.permissions.length, 0)

  // « Toujours » : la même commande (programme npm) passe toute seule
  const again = await hub.handleHook({ ...ask, tool_input: { command: 'npm run build' } })
  assert.equal(again.hookSpecificOutput.decision.behavior, 'allow')
  assert.equal(events.at(-1).type, 'auto-allowed')

  // Question (AskUserQuestion) : réponses renvoyées dans updatedInput.answers
  const questions = [{ question: 'Quelle couleur ?', options: [{ label: 'Bleu' }, { label: 'Rouge' }], multiSelect: false }]
  const q = hub.handleHook({ hook_event_name: 'PermissionRequest', session_id: sid, tool_name: 'AskUserQuestion', tool_input: { questions } })
  assert.equal(state.permissions[0].questions.length, 1)
  hub.resolvePermission(state.permissions[0].id, 'answer', { 'Quelle couleur ?': 'Bleu' })
  const answered = await q
  assert.deepEqual(answered.hookSpecificOutput.decision.updatedInput, { questions, answers: { 'Quelle couleur ?': 'Bleu' } })

  // Refus
  const d = hub.handleHook({ ...ask, tool_name: 'WebFetch', tool_input: { url: 'https://exemple.com/x' } })
  hub.resolvePermission(state.permissions[0].id, 'deny')
  assert.equal((await d).hookSpecificOutput.decision.behavior, 'deny')

  // Sans réponse : Nuage laisse Claude Code afficher sa fenêtre
  assert.deepEqual(await hub.handleHook({ ...ask, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }), {})

  // Fin de tour et limites d'utilisation
  await hub.handleHook({ hook_event_name: 'Stop', session_id: sid, last_assistant_message: 'C’est corrigé.' })
  assert.equal(events.at(-1).type, 'done')
  assert.equal(state.sessions[0].status, 'termine')
  hub.handleStatusline({ session_id: sid, model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 42 }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1800000000 } } })
  assert.equal(state.usage.fiveHour.pct, 23.5)
  assert.equal(state.usage.sevenDay, null)
  assert.equal(state.usage.context, 42)

  fs.rmSync(root, { recursive: true, force: true })
  console.log('OK : suivi des agents (journal, diff, autorisations, toujours, question, refus, délai, fin, limites)')
})().catch(error => {
  console.error(error)
  process.exit(1)
})

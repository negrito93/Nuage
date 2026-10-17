// Faux claude.exe pour outils/test-chat-rapide.js : parle le même « stream-json » que Claude Code
// (init, morceaux de texte, outil, demande d'autorisation, résultat), sans rien envoyer à personne.
// Il reste ouvert entre deux messages, comme le vrai en mode entrée « stream-json ».
const readline = require('node:readline')

const out = obj => process.stdout.write(`${JSON.stringify(obj)}\n`)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let count = 0
let pendingPermission = null
const rl = readline.createInterface({ input: process.stdin })
out({ type: 'system', subtype: 'hook_started' }) // bavardage du démarrage, à ignorer

rl.on('line', async line => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'control_response') {
    pendingPermission?.(msg.response.response.behavior)
    return
  }
  if (msg.type !== 'user') return
  count += 1
  if (count === 1) out({ type: 'system', subtype: 'init', session_id: `faux-${process.pid}` })
  const text = (msg.message.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ')
  let words = `Réponse ${count} du processus ${process.pid}`
  if (/outil/.test(text)) out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/projet/main.js' } }] } })
  if (/autorisation/.test(text)) {
    out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: 'C:/projet/a.txt' } } })
    const behavior = await new Promise(resolve => { pendingPermission = resolve })
    words = behavior === 'allow' ? 'permis' : 'refusé'
  }
  for (const word of words.split(' ')) {
    if (/lent/.test(text)) await wait(400)
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `${word} ` } } })
  }
  out({ type: 'result', is_error: false, result: words })
})
rl.on('close', () => process.exit(0))

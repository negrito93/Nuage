// Discussion avec Claude, OpenAI, Gemini, OpenRouter (des centaines de modèles avec une seule clé) ou un modèle local (Ollama, LM Studio), avec les clés
// de l'utilisateur (secrets.js). Réponses en continu ; fichiers et captures de fenêtres joints.
// « Claude (ton abonnement) » : sans clé d'API, via le Claude Code installé avec l'application
// Claude (claude.exe -p), connecté une fois au compte de l'utilisateur.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const secrets = require('./secrets')
// Chargés à la première utilisation seulement (05/10/2026) : ils retardaient le démarrage de Nuage
// d'environ 2,3 s (OpenAI 1,6 s, Anthropic 0,7 s) alors que le chat passe surtout par l'abonnement
let anthropicLib = null
let openaiLib = null
const Anthropic = () => (anthropicLib ??= require('@anthropic-ai/sdk'))
const OpenAI = () => (openaiLib ??= require('openai'))

const extensions = require('./extensions')
const actions = require('./actions')
const abonnements = require('./abonnements')

// Message système, le même pour toutes les IA du chat (07/10/2026 : « c'est le LLM auquel je suis connecté qui doit agir,
// pas Claude ») : avec outils (actions.js), l'IA agit elle-même et se sert des compétences de Nuage ; sans outils
// (abonnement Claude sans outils, modèle qui ne les connaît pas), elle propose une installation par la balise
// [[installer: …]], dont l'encoche fait un bouton (encoche.js richText).
const BASE = "Tu es Nuage, un petit assistant de bureau sympathique qui vit sur le PC Windows de l'utilisateur. " +
  'Réponds en français, clairement et simplement, sauf demande contraire.'
const SOURCES = 'Compétences officielles : https://github.com/anthropics/skills/tree/main/skills/<nom> (pdf, docx, xlsx, pptx, ' +
  'skill-creator, frontend-design, mcp-builder, webapp-testing, canvas-design, algorithmic-art, theme-factory, doc-coauthoring, ' +
  'brand-guidelines, internal-comms, web-artifacts-builder, slack-gif-creator, claude-api) ; catalogue de plugins officiel : ' +
  '« /plugin install <nom>@claude-plugins-official ». N’invente jamais un dépôt : sans source sûre, propose ces catalogues ou demande un lien.'
function systemPrompt(tools) {
  if (!tools) {
    return `${BASE}\nNuage sait ajouter des compétences (« skills ») et des plugins. Quand l’utilisateur veut en ajouter, n’explique pas de ` +
      'démarche : écris, seule sur sa ligne, la balise [[installer: X]] (une par chose à ajouter), où X est un lien GitHub (dépôt, dossier ' +
      'ou SKILL.md), « propriétaire/dépôt », un lien .zip ou SKILL.md, ou « /plugin install nom@catalogue ». Nuage en fait un bouton ; ' +
      `l’utilisateur voit ce qui sera ajouté avant d’accepter. ${SOURCES}`
  }
  const skills = extensions.listSkills().slice(0, 60)
  return `${BASE}\nTu agis toi-même avec tes outils : fichiers, commandes PowerShell, pages web, compétences, ajout de compétences et de ` +
    'plugins. Nuage demande l’accord de l’utilisateur avant chaque action sur le PC : ne lui explique pas comment faire à la main ce que ' +
    'tu peux faire, fais-le. Chemins : relatifs au dossier personnel de l’utilisateur (Documents\\…, Desktop\\…, Downloads\\…), ' +
    'n’invente jamais un chemin complet ; une commande part déjà de ce dossier ($env:USERPROFILE). Pour écrire un fichier : ecrire_fichier ' +
    '(PowerShell 5.1 abîme les accents). Avant une tâche qui correspond à une compétence installée, lis-la avec utiliser_competence et suis ses ' +
    `consignes. Pour ajouter une compétence ou un plugin : installer_extension. ${SOURCES}\n` +
    // 09/10/2026 : Gemini, ne voyant pas une image, a fouillé le PC jusqu'à l'historique de Chrome
    'Ne fais que ce que l’utilisateur demande. Si une action échoue, t’est refusée ou si tu ne peux pas voir quelque chose, ne cherche ' +
    'pas de contournement et ne fouille jamais le PC de toi-même (historique du navigateur, mots de passe, fichiers personnels) : ' +
    'dis simplement à l’utilisateur ce qui bloque, en une phrase.\n' +
    (skills.length ? `Compétences installées dans Nuage :\n${skills.map(s => `- ${s.name} : ${s.description}`).join('\n')}` : 'Aucune compétence installée pour l’instant.')
}

const PROVIDERS = {
  claudecode: { label: 'Claude (ton abonnement)', subscription: true, models: ['sonnet', 'opus', 'haiku', 'fable'] },
  // Gemini et ChatGPT avec l'abonnement (08/10/2026) : outils officiels installés par Nuage (abonnements.js)
  // efforts : réflexion avant de répondre (agy --effort, Codex model_reasoning_effort) ; menu du chat
  antigravity: { label: 'Gemini (ton compte Google)', short: 'Gemini', account: 'agy', models: ['auto'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  chatgpt: { label: 'ChatGPT (ton abonnement)', short: 'ChatGPT', account: 'codex', models: ['auto'], efforts: ['low', 'medium', 'high', 'xhigh'] },
  claude: { label: 'Claude (clé d’API)', keyName: 'Anthropic', secret: 'anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'] },
  openai: { label: 'OpenAI', secret: 'openai', models: [] },
  gemini: { label: 'Gemini', secret: 'gemini', models: [] },
  // OpenRouter (07/10/2026) : même format que l'API d'OpenAI, une seule clé pour Claude, GPT, Gemini, Llama, Mistral…
  openrouter: { label: 'OpenRouter', secret: 'openrouter', base: 'https://openrouter.ai/api/v1', models: [] },
  ollama: { label: 'Ollama (sur le PC)', local: 'http://127.0.0.1:11434', models: [] },
  lmstudio: { label: 'LM Studio (sur le PC)', local: 'http://127.0.0.1:1234/v1', models: [] },
}
// Modèles Claude qui acceptent le repli serveur (fallbacks: "default") en cas de refus
const CLAUDE_FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const TEXT = /\.(txt|md|csv|json|js|mjs|cjs|ts|tsx|jsx|html|css|py|ps1|bat|cmd|xml|yml|yaml|ini|log|sql|java|cs|c|cpp|h|go|rs|rb|php|sh|toml)$/i

// Prépare un fichier pour l'envoyer à l'IA
function attachmentFromFile(file) {
  const stat = fs.statSync(file)
  const name = path.basename(file)
  const ext = path.extname(file).toLowerCase()
  if (stat.isDirectory()) {
    const list = fs.readdirSync(file).slice(0, 200).join('\n')
    return { kind: 'text', name: `${name} (dossier)`, text: `Contenu du dossier ${file} :\n${list}` }
  }
  if (IMAGE[ext] && stat.size <= 15e6) return { kind: 'image', name, mime: IMAGE[ext], data: fs.readFileSync(file).toString('base64') }
  if (ext === '.pdf' && stat.size <= 25e6) return { kind: 'pdf', name, mime: 'application/pdf', data: fs.readFileSync(file).toString('base64') }
  if (TEXT.test(name) && stat.size <= 300e3) return { kind: 'text', name, text: fs.readFileSync(file, 'utf8') }
  return { kind: 'text', name, text: `(Fichier « ${name} » de ${Math.round(stat.size / 1024)} Ko : format non lu directement.)` }
}

const textOf = a => `Fichier joint « ${a.name} » :\n\`\`\`\n${a.text}\n\`\`\``

// ---------- Conversion des messages pour chaque fournisseur ----------
function toClaude(messages) {
  return messages.map(m => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.text || '…' }
    const content = []
    for (const a of m.attachments || []) {
      if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } })
      else if (a.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } })
      else content.push({ type: 'text', text: textOf(a) })
    }
    content.push({ type: 'text', text: m.text || 'Que peux-tu me dire à ce sujet ?' })
    return { role: 'user', content }
  })
}
function toOpenAI(messages, system) {
  return [{ role: 'system', content: system }, ...messages.map(m => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.text || '…' }
    const content = []
    for (const a of m.attachments || []) {
      if (a.kind === 'image') content.push({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } })
      else if (a.kind === 'pdf') content.push({ type: 'text', text: `(PDF « ${a.name} » joint : ce fournisseur ne le lit pas ici.)` })
      else content.push({ type: 'text', text: textOf(a) })
    }
    content.push({ type: 'text', text: m.text || 'Que peux-tu me dire à ce sujet ?' })
    return { role: 'user', content }
  })]
}

// ---------- Claude Code (abonnement, sans clé d'API) ----------
// claude.exe installé par l'application Claude (%APPDATA%\Claude\claude-code\<version>\<id>\),
// ou installation autonome (~\.local\bin), ou trouvé dans le PATH. La version la plus récente gagne.
// Chaque dossier est lu à part : un fichier ou un dossier illisible (mise à jour de l'application Claude
// en cours) ne fait plus échouer toute la recherche (05/10/2026 : « Claude Code introuvable » au démarrage).
const versionKey = v => v.split('.').map(n => String(Number(n) || 0).padStart(6, '0')).join('.')
const listDir = dir => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
const isFile = file => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}
// L'application Claude du Microsoft Store est « empaquetée » (MSIX) : ce qu'elle écrit dans
// %APPDATA%\Claude est en réalité rangé dans %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude,
// et seuls les programmes lancés depuis l'application voient l'adresse habituelle. Nuage lancé depuis le
// bureau ne trouvait donc jamais claude.exe (05/10/2026 : « Claude Code est introuvable » à chaque lancement,
// alors que tout marchait quand Claude relançait Nuage lui-même). On cherche aux deux endroits.
function claudeCodeRoots() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const roots = [path.join(appData, 'Claude', 'claude-code')]
  const packages = path.join(localAppData, 'Packages')
  for (const name of listDir(packages)) {
    if (/^(Claude|Anthropic)/i.test(name)) roots.push(path.join(packages, name, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
  }
  return roots
}
function findClaudeCode() {
  const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe')
  if (isFile(local)) return local
  // La version la plus récente, tous emplacements confondus
  const found = []
  for (const root of claudeCodeRoots()) {
    for (const version of listDir(root)) {
      for (const id of listDir(path.join(root, version))) {
        const exe = path.join(root, version, id, 'claude.exe')
        if (isFile(exe)) found.push({ exe, key: versionKey(version) })
      }
    }
  }
  if (found.length) return found.sort((a, b) => b.key.localeCompare(a.key))[0].exe
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, 'claude.exe')
    if (isFile(exe)) return exe
  }
  return ''
}
// Environnement propre : sans les variables d'une session Claude Code qui aurait lancé Nuage
function cleanEnv() {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(name) && name !== 'CLAUDE_CONFIG_DIR') delete env[name]
  }
  return env
}
function runClaudeCode(args, { input = '', timeout = 15_000 } = {}) {
  const exe = findClaudeCode()
  if (!exe) return Promise.reject(new Error('Claude Code introuvable : installe l’application Claude.'))
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: cleanEnv(), windowsHide: true, cwd: os.tmpdir() })
    let out = ''
    child.stdin.on('error', () => {}) // claude.exe déjà sorti (EPIPE) : sans cela, Nuage entier plantait
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', data => { out += data })
    const timer = setTimeout(() => child.kill(), timeout)
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(out)
    })
    child.stdin.end(input)
  })
}
// { found, loggedIn } : « claude auth status » ne lit que l'état de connexion, sans requête payante
// unsure : la réponse n'a pas pu être lue (claude.exe lent à démarrer juste après l'allumage du PC…) :
// ce n'est pas un « non connecté », on réessaiera
// detail : ce que claude.exe a répondu (relevé de diagnostic, sans rien de secret)
async function claudeCodeStatus() {
  const exe = findClaudeCode()
  if (!exe) return { found: false, loggedIn: false, detail: { exe: '' } }
  const started = Date.now()
  let out = ''
  let err = ''
  let code = null
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(exe, ['auth', 'status', '--json'], { env: cleanEnv(), windowsHide: true, cwd: os.tmpdir() })
      child.stdin.on('error', () => {})
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { err += d })
      const timer = setTimeout(() => child.kill(), 30_000)
      child.on('error', e => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('exit', c => {
        clearTimeout(timer)
        code = c
        resolve()
      })
      child.stdin.end()
    })
    const status = JSON.parse(out)
    return {
      found: true, loggedIn: Boolean(status.loggedIn),
      detail: { exe, ms: Date.now() - started, code, authMethod: status.authMethod || '', subscription: status.subscriptionType || '' },
    }
  } catch (error) {
    return {
      found: true, loggedIn: false, unsure: true,
      detail: { exe, ms: Date.now() - started, code, error: String(error.message || error).slice(0, 200), stdout: out.slice(0, 200), stderr: err.slice(0, 300) },
    }
  }
}
// Limites d'utilisation (forfaits Pro / Max) : « claude -p /usage » est une commande locale de Claude
// Code, sans appel au modèle (0 jeton, environ 5 s ; essai du 04/10/2026). Lignes lues :
//   Current session: 54% used · resets Oct 4, 11am (Atlantic/Reykjavik)
//   Current week (all models): 50% used · resets Oct 6, 12:59am (Atlantic/Reykjavik)
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
// Décalage (ms) d'un fuseau horaire à un instant donné
function zoneOffset(ms, timeZone) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms
  } catch {
    return 0
  }
}
// « Oct 4, 11am (Atlantic/Reykjavik) », « 10:59am (UTC) »… → instant (ms), ou null
function parseReset(text, now = Date.now()) {
  const m = /^(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i.exec(String(text).trim())
  if (!m) return null
  const [, mon, day, h, min, ampm, zone] = m
  const month = mon ? MONTHS[mon.toLowerCase()] : new Date(now).getUTCMonth()
  if (month === undefined) return null
  const hour = (Number(h) % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0)
  const date = day ? Number(day) : new Date(now).getUTCDate()
  const at = year => {
    const guess = Date.UTC(year, month, date, hour, Number(min || 0))
    return guess - (zone ? zoneOffset(guess, zone) : 0)
  }
  const year = new Date(now).getUTCFullYear()
  let result = at(year)
  if (mon && result < now - 86_400_000) result = at(year + 1) // « Jan 2 » vu fin décembre
  if (!mon && result < now) result += 86_400_000
  return result
}
function parseUsage(text) {
  const windows = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*Current (session|week)(?:\s*\(([^)]+)\))?:\s*(\d+(?:\.\d+)?)\s*% used(?:\s*[·•,-]\s*resets\s+(.+))?\s*$/i.exec(line)
    if (m) windows.push({ kind: m[1].toLowerCase(), scope: m[2] || '', pct: Number(m[3]), resetsAt: m[4] ? parseReset(m[4]) : null })
  }
  if (!windows.length) return null
  const session = windows.find(w => w.kind === 'session')
  const week = windows.find(w => w.kind === 'week' && /all/i.test(w.scope)) || windows.find(w => w.kind === 'week')
  const win = w => (w ? { pct: w.pct, resetsAt: w.resetsAt } : null)
  return {
    fiveHour: win(session),
    sevenDay: win(week),
    extra: windows.filter(w => w !== session && w !== week).map(w => ({ label: `7 j, ${w.scope.replace(/\s*only$/i, '')}`, pct: w.pct, resetsAt: w.resetsAt })),
    source: 'usage',
  }
}
async function claudeCodeUsage() {
  if (!findClaudeCode()) return null
  return parseUsage(await runClaudeCode(['-p', '/usage', '--no-session-persistence'], { timeout: 30_000 }))
}

// Connexion unique au compte Claude : fenêtre de console + navigateur, c'est l'utilisateur qui valide
function loginClaudeCode() {
  const exe = findClaudeCode()
  if (!exe) throw new Error('Claude Code introuvable : installe l’application Claude.')
  spawn('cmd.exe', ['/d', '/c', `start "Connexion de Nuage a Claude" "${exe}" auth login --claudeai`], {
    env: cleanEnv(), windowsVerbatimArguments: true, detached: true, stdio: 'ignore', cwd: os.tmpdir(),
  }).unref()
}

// Sans session enregistrée : les échanges précédents sont redonnés en texte, le dernier message
// garde ses pièces jointes (images, PDF, textes).
function toClaudeCode(messages) {
  const last = messages.at(-1)
  const before = messages.slice(0, -1).map(m => {
    const files = (m.attachments || []).length ? ` [fichiers joints : ${m.attachments.map(a => a.name).join(', ')}]` : ''
    return `${m.role === 'assistant' ? 'Nuage' : 'Utilisateur'} : ${m.text || '…'}${files}`
  })
  const content = toClaude([last])[0].content
  if (before.length) content.unshift({ type: 'text', text: `Conversation jusqu’ici :\n${before.join('\n\n')}\n\nNouveau message de l’utilisateur :` })
  return { type: 'user', message: { role: 'user', content } }
}
function sendClaudeCode(model, messages, signal, onText) {
  const exe = findClaudeCode()
  if (!exe) return Promise.reject(new Error('Claude Code introuvable : installe l’application Claude.'))
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--tools', '', // aucun outil : il discute, il ne touche à rien sur le PC
    '--safe-mode', // ni hooks (pas d'écho dans l'encoche), ni CLAUDE.md, ni serveurs MCP
    '--no-session-persistence', // rien dans ~/.claude/projects (pas de fausse session « Agents »)
    '--model', model, '--system-prompt', systemPrompt(false),
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: cleanEnv(), windowsHide: true, cwd: os.tmpdir() })
    child.stdin.on('error', () => {}) // claude.exe sorti avant de lire (EPIPE) : l'erreur arrive par 'exit'
    let buffer = ''
    let streamed = false
    let result = null
    let stderr = ''
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
          streamed = true
          onText(msg.event.delta.text)
        } else if (msg.type === 'result') {
          result = msg
        }
      }
    })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', error => {
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.on('exit', code => {
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) {
        reject(Object.assign(new Error('Réponse arrêtée.'), { name: 'AbortError' }))
      } else if (result?.is_error || (!result && code)) {
        reject(new Error(String(result?.result || stderr.trim() || `Claude Code s’est arrêté (code ${code})`).slice(0, 400)))
      } else {
        if (!streamed && result?.result) onText(result.result) // réponse non découpée : on la donne d'un bloc
        if (result?.stop_reason === 'max_tokens') onText('\n\n(Réponse coupée : trop longue.)')
        resolve()
      }
    })
    child.stdin.end(`${JSON.stringify(toClaudeCode(messages))}\n`)
  })
}

// ---------- Reprendre une session Claude Code dans le chat de Nuage ----------
// Le chat devient un prolongement de la session : claude.exe -p --resume <id> --fork-session
// (une copie : la session ouverte dans l'application Claude n'est pas touchée), avec ses outils.
// Les autorisations passent par Nuage (--permission-prompt-tool stdio : demandes « can_use_tool »).
const SESSION_NOTE = 'Tu continues cette session depuis Nuage, le compagnon de bureau : l’utilisateur te parle dans la barre du haut de l’écran. ' +
  'Réponds en français, simplement. Tu tournes à l’intérieur de Nuage : ne l’arrête pas, ne le relance pas et ne lance pas son auto-test toi-même ; si c’est nécessaire, demande-le à l’utilisateur.'

// Derniers échanges lisibles d'un journal de session (.jsonl), sans les outils ni les sous-agents
function readSessionHistory(file, max = 30) {
  const result = { messages: [], model: '', cwd: '' }
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    // Dossier de départ de la session : dans les premières lignes
    const head = Buffer.alloc(Math.min(size, 64 * 1024))
    fs.readSync(fd, head, 0, head.length, 0)
    for (const line of head.toString('utf8').split('\n')) {
      try {
        const o = JSON.parse(line)
        if (o.cwd) {
          result.cwd = o.cwd
          break
        }
      } catch {
        // ligne coupée
      }
    }
    const length = Math.min(size, 4 * 1024 * 1024)
    const tail = Buffer.alloc(length)
    fs.readSync(fd, tail, 0, length, size - length)
    const lines = tail.toString('utf8').split('\n')
    if (length < size) lines.shift() // première ligne coupée
    const list = []
    for (const line of lines) {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.isSidechain || o.isMeta || !o.message) continue
      const content = o.message.content
      if (o.type === 'user') {
        const text = typeof content === 'string' ? content
          : (Array.isArray(content) ? content : []).map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n')
        if (!text.trim() || /^\s*</.test(text) || /^\[Request interrupted/.test(text)) continue
        list.push({ role: 'user', text: short(text, 2000), id: o.uuid })
      } else if (o.type === 'assistant') {
        if (o.message.model && !o.message.model.startsWith('<')) result.model = o.message.model
        const text = (Array.isArray(content) ? content : []).filter(b => b.type === 'text').map(b => b.text).join('\n')
        if (!text.trim()) continue
        const last = list.at(-1)
        if (last?.role === 'assistant' && last.mid && last.mid === o.message.id) last.text = short(`${last.text}\n${text}`, 3000)
        else list.push({ role: 'assistant', text: short(text, 3000), mid: o.message.id })
      }
    }
    result.messages = list.slice(-max).map(({ role, text }) => ({ role, text }))
  } catch {
    // journal illisible : pas d'historique affiché
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return result
}
function short(text, max) {
  const t = String(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// Libellé court d'un outil utilisé par la session (affiché dans la réponse)
function toolLabel(name, input = {}) {
  const file = p => path.basename(String(p || ''))
  if (name === 'Read') return `Lit ${file(input.file_path)}`
  if (name === 'Edit' || name === 'MultiEdit') return `Modifie ${file(input.file_path)}`
  if (name === 'Write') return `Écrit ${file(input.file_path)}`
  if (name === 'Bash' || name === 'PowerShell') return `Exécute : ${short(input.description || input.command || '', 70)}`
  if (name === 'Grep' || name === 'Glob') return `Cherche « ${short(input.pattern || '', 40)} »`
  if (name === 'WebFetch' || name === 'WebSearch') return `Consulte le web${input.query ? ` « ${short(input.query, 40)} »` : ''}`
  if (name === 'Agent' || name === 'Task') return `Lance un sous-agent : ${short(input.description || '', 50)}`
  if (name === 'TodoWrite') return 'Met à jour sa liste de tâches'
  return `Outil ${short(name, 40)}`
}

// Un message dans la session reprise. onInit(id) : identifiant de la copie ; onPermission(demande)
// renvoie une promesse { behavior: 'allow' | 'deny', always? }.
function sendSession({ resumeId, fork, cwd, model, text, attachments, signal, onText, onTool, onInit, onPermission }) {
  const exe = findClaudeCode()
  if (!exe) return Promise.reject(new Error('Claude Code introuvable : installe l’application Claude.'))
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    // Autorisations demandées à Nuage (le hook de Nuage s'efface pour ces sessions : isOwnSession).
    // Tous les réglages de l'utilisateur sont chargés : plugins, compétences, mémoire, autorisations.
    '--permission-prompt-tool', 'stdio',
    // Sans resumeId : nouvelle session Claude Code
    ...(resumeId ? ['--resume', resumeId, ...(fork ? ['--fork-session'] : [])] : []),
    ...(model ? ['--model', model] : []),
    '--append-system-prompt', SESSION_NOTE,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: cleanEnv(), windowsHide: true, cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir() })
    child.stdin.on('error', () => {}) // claude.exe sorti (EPIPE) : l'erreur arrive par 'exit'
    let buffer = ''
    let result = null
    let stderr = ''
    let afterTool = false
    // Écrire après la fin (réponse d'autorisation arrivée trop tard) levait « write after end »
    const write = obj => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(`${JSON.stringify(obj)}\n`)
    }
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          onInit?.(msg.session_id)
        } else if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
          if (afterTool) {
            onText('\n\n')
            afterTool = false
          }
          onText(msg.event.delta.text)
        } else if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type !== 'tool_use') continue
            afterTool = true // le texte suivant commence un nouveau paragraphe
            // Outils internes de Claude Code (recherche d'outils) : rien à montrer
            if (block.name !== 'ToolSearch') onTool?.(toolLabel(block.name, block.input))
          }
        } else if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
          const req = msg.request
          Promise.resolve(onPermission ? onPermission({
            tool: req.tool_name,
            label: toolLabel(req.tool_name, req.input),
            command: req.input?.command || req.input?.file_path || req.input?.url || '',
          }) : { behavior: 'deny' }).then(answer => {
            const response = answer?.behavior === 'allow'
              ? { behavior: 'allow', updatedInput: req.input, ...(answer.always && req.permission_suggestions ? { updatedPermissions: req.permission_suggestions } : {}) }
              : { behavior: 'deny', message: 'L’utilisateur a refusé dans Nuage.' }
            write({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } })
          })
        } else if (msg.type === 'result') {
          result = msg
          child.stdin.end()
        }
      }
    })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', error => {
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.on('exit', code => {
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) reject(Object.assign(new Error('Réponse arrêtée.'), { name: 'AbortError' }))
      else if (result?.is_error || (!result && code)) reject(new Error(String(result?.result || stderr.trim() || `Claude Code s’est arrêté (code ${code})`).slice(0, 400)))
      else resolve()
    })
    const content = toClaude([{ role: 'user', text, attachments }])[0].content
    write({ type: 'user', message: { role: 'user', content } })
  })
}

// ---------- Session gardée au chaud (05/10/2026 : « je le veux ultra réactif, même s'il prend plus de RAM ») ----------
// Avant : chaque message relançait claude.exe, qui redémarrait et relisait toute la session (plusieurs
// secondes, davantage pour une longue session). Désormais le processus reste ouvert entre deux messages
// (entrée « stream-json » : les messages se suivent sur la même entrée, une réponse « result » à chaque
// tour) ; il est même lancé dès que le chat s'ouvre, pour que la première réponse arrive vite.
// Arrêter une réponse ferme le processus : le message suivant en relance un (sur la même session).
// exe / prefixArgs : pour le test (outils/test-chat-rapide.js, un faux claude.exe en Node).
function createSessionWorker({ resumeId, fork, cwd, model, onInit, exe = findClaudeCode(), prefixArgs = [] }) {
  if (!exe) throw new Error('Claude Code introuvable : installe l’application Claude.')
  const args = [
    ...prefixArgs,
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-prompt-tool', 'stdio',
    ...(resumeId ? ['--resume', resumeId, ...(fork ? ['--fork-session'] : [])] : []),
    ...(model ? ['--model', model] : []),
    '--append-system-prompt', SESSION_NOTE,
  ]
  const child = spawn(exe, args, { env: cleanEnv(), windowsHide: true, cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir() })
  let alive = true
  let buffer = ''
  let stderr = ''
  let turn = null // tour en cours : { resolve, reject, onText, onTool, onPermission, afterTool, stop }
  let lastUsed = Date.now()
  child.stdin.on('error', () => {})
  const write = obj => {
    if (alive && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(`${JSON.stringify(obj)}\n`)
  }
  const finish = (error, aborted = false) => {
    const t = turn
    turn = null
    if (!t) return
    t.signal?.removeEventListener('abort', t.stop)
    if (aborted) t.reject(Object.assign(new Error('Réponse arrêtée.'), { name: 'AbortError' }))
    else if (error) t.reject(error)
    else t.resolve()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        onInit?.(msg.session_id)
      } else if (!turn) {
        continue // rien n'est attendu (bavardage du démarrage)
      } else if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
        if (turn.afterTool) {
          turn.onText('\n\n')
          turn.afterTool = false
        }
        turn.onText(msg.event.delta.text)
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type !== 'tool_use') continue
          turn.afterTool = true
          if (block.name !== 'ToolSearch') turn.onTool?.(toolLabel(block.name, block.input))
        }
      } else if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
        const req = msg.request
        const ask = turn.onPermission
        Promise.resolve(ask ? ask({
          tool: req.tool_name,
          label: toolLabel(req.tool_name, req.input),
          command: req.input?.command || req.input?.file_path || req.input?.url || '',
        }) : { behavior: 'deny' }).then(answer => {
          const response = answer?.behavior === 'allow'
            ? { behavior: 'allow', updatedInput: req.input, ...(answer.always && req.permission_suggestions ? { updatedPermissions: req.permission_suggestions } : {}) }
            : { behavior: 'deny', message: 'L’utilisateur a refusé dans Nuage.' }
          write({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } })
        })
      } else if (msg.type === 'result') {
        lastUsed = Date.now()
        finish(msg.is_error ? new Error(String(msg.result || 'Claude Code a renvoyé une erreur').slice(0, 400)) : null)
      }
    }
  })
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000) })
  child.on('error', error => {
    alive = false
    finish(error)
  })
  child.on('exit', code => {
    alive = false
    const wasStopped = turn?.stopped
    finish(new Error(String(stderr.trim() || `Claude Code s’est arrêté (code ${code})`).slice(0, 400)), wasStopped)
  })
  return {
    pid: child.pid,
    alive: () => alive,
    busy: () => Boolean(turn),
    idleFor: () => (turn ? 0 : Date.now() - lastUsed),
    // Un message ; résolu à la fin de la réponse (le processus reste ouvert pour le suivant)
    send({ text, attachments, signal, onText, onTool, onPermission }) {
      if (!alive) return Promise.reject(Object.assign(new Error('session fermée'), { code: 'FERMEE' }))
      if (turn) return Promise.reject(new Error('Claude répond déjà.'))
      return new Promise((resolve, reject) => {
        const stop = () => {
          if (turn) turn.stopped = true
          child.kill()
        }
        turn = { resolve, reject, onText, onTool, onPermission, afterTool: false, stop, signal, stopped: false }
        if (signal?.aborted) return stop()
        signal?.addEventListener('abort', stop, { once: true })
        lastUsed = Date.now()
        const content = toClaude([{ role: 'user', text, attachments }])[0].content
        write({ type: 'user', message: { role: 'user', content } })
      })
    },
    kill() {
      alive = false
      child.kill()
    },
  }
}

// ---------- Clients ----------
function keyFor(provider) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error('Fournisseur inconnu')
  if (p.local || p.subscription || p.account) return ''
  const key = secrets.get(p.secret)
  if (!key) throw new Error(`Pas encore de clé ${p.keyName || p.label} : roue dentée de la barre → Réglages → IA, colle ta clé puis « Enregistrer ».`)
  return key
}
// Tous au format de l'API d'OpenAI (Gemini et Ollama ont une adresse compatible) : une seule boucle d'outils (sendOpenAI)
const OPENAI_BASE = {
  openai: undefined, openrouter: PROVIDERS.openrouter.base, lmstudio: PROVIDERS.lmstudio.local,
  ollama: `${PROVIDERS.ollama.local}/v1`, gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
}
const openaiClient = provider => {
  const Client = OpenAI()
  return new Client({
    apiKey: PROVIDERS[provider].local ? provider : keyFor(provider),
    baseURL: OPENAI_BASE[provider],
    // OpenRouter : le nom de l'appli s'affiche dans le tableau de bord de l'utilisateur (en-tête X-Title)
    ...(provider === 'openrouter' ? { defaultHeaders: { 'X-Title': 'Nuage' } } : {}),
  })
}
async function gemini() {
  const { GoogleGenAI } = await import('@google/genai')
  return new GoogleGenAI({ apiKey: keyFor('gemini') })
}

async function listModels(provider) {
  if (PROVIDERS[provider]?.subscription || PROVIDERS[provider]?.account) return PROVIDERS[provider].models
  if (provider === 'claude') {
    try {
      const Client = Anthropic()
      const client = new Client({ apiKey: keyFor('claude') })
      const ids = []
      for await (const m of client.models.list()) ids.push(m.id)
      const preferred = PROVIDERS.claude.models.filter(id => ids.includes(id))
      return preferred.length ? [...preferred, ...ids.filter(id => !preferred.includes(id))] : PROVIDERS.claude.models
    } catch {
      return PROVIDERS.claude.models
    }
  }
  if (provider === 'openai' || provider === 'lmstudio') {
    const ids = []
    for await (const m of openaiClient(provider).models.list()) ids.push(m.id)
    return provider === 'openai' ? ids.filter(id => /^(gpt|o\d|chatgpt)/.test(id)).sort().reverse() : ids
  }
  if (provider === 'openrouter') {
    // Des centaines de modèles : les plus connus d'abord (Anthropic, OpenAI, Google…), puis les autres ; le menu a une recherche
    const res = await fetch(`${PROVIDERS.openrouter.base}/models`, { headers: { Authorization: `Bearer ${keyFor('openrouter')}` }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    const ids = ((await res.json()).data || []).map(m => m.id).filter(Boolean)
    const rank = id => { const i = ['anthropic/', 'openai/', 'google/', 'x-ai/', 'deepseek/', 'mistralai/', 'meta-llama/', 'qwen/'].findIndex(p => id.startsWith(p)); return i < 0 ? 99 : i }
    return ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  }
  if (provider === 'gemini') {
    const ai = await gemini()
    const ids = []
    for await (const m of await ai.models.list()) {
      if ((m.supportedActions || []).includes('generateContent')) ids.push(String(m.name).replace(/^models\//, ''))
    }
    return ids.filter(id => id.startsWith('gemini')).sort().reverse()
  }
  if (provider === 'ollama') {
    const res = await fetch(`${PROVIDERS.ollama.local}/api/tags`, { signal: AbortSignal.timeout(4000) })
    return ((await res.json()).models || []).map(m => m.name)
  }
  return []
}

// Envoie la conversation et appelle onText à chaque morceau de réponse.
// permit (main.js) : l'IA peut agir (actions.js), chaque action sur le PC demandée à l'utilisateur ; onTool : ligne « ⚙ … »
async function send({ provider, model, effort, messages, signal, onText, onTool, permit, trash }) {
  const ctx = permit ? { permit, trash, signal, onTool } : null
  try {
    if (provider === 'claudecode') return await sendClaudeCode(model, messages, signal, onText)
    // Ses actions passent par les outils de Nuage (mcp-nuage.js → main.js → actions.run, même accord)
    if (PROVIDERS[provider]?.account) {
      const level = PROVIDERS[provider].efforts?.includes(effort) ? effort : ''
      return await abonnements.send(PROVIDERS[provider].account, { model, effort: level, messages, signal, onText, system: systemPrompt(true) })
    }
    if (provider === 'claude') return await sendClaude(model, messages, signal, onText, ctx)
    if (provider in OPENAI_BASE) return await sendOpenAI(openaiClient(provider), `${provider}:${model}`, model, messages, signal, onText, ctx)
    throw new Error('Fournisseur inconnu')
  } catch (error) {
    throw new Error(explain(provider, error))
  }
}

// L'IA agit étape par étape : elle répond, ou appelle des outils dont les résultats lui sont rendus, puis continue
const MAX_STEPS = 16
const noTools = new Set() // « fournisseur:modèle » qui ont refusé les outils : ils discutent sans (balise [[installer: …]])
const toolError = error => [400, 404, 422].includes(error?.status) && /tool|function/i.test(String(error?.message))
const stepsDone = onText => onText(`\n\n(J’ai fait ${MAX_STEPS} étapes d’affilée : dis « continue » pour que je poursuive.)`)
async function sendOpenAI(client, key, model, messages, signal, onText, ctx) {
  const tools = Boolean(ctx) && !noTools.has(key)
  const convo = toOpenAI(messages, systemPrompt(tools))
  // OpenRouter : seulement des serveurs qui savent appeler des outils (sinon erreur 404, et on repart sans outils)
  const extra = tools ? { tools: actions.TOOLS, ...(key.startsWith('openrouter:') ? { provider: { require_parameters: true } } : {}) } : {}
  for (let step = 0; step < MAX_STEPS; step++) {
    let stream
    try {
      stream = await client.chat.completions.create({ model, messages: convo, stream: true, ...extra }, { signal })
    } catch (error) {
      if (!tools || step || !toolError(error)) throw error
      noTools.add(key)
      return sendOpenAI(client, key, model, messages, signal, onText, ctx)
    }
    let text = ''
    const calls = []
    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta
      if (d?.content) {
        text += d.content
        onText(d.content)
      }
      for (const t of d?.tool_calls || []) {
        // Sans « index » (certains serveurs) : un nouvel identifiant = un nouvel appel
        const i = t.index ?? (t.id && calls.at(-1)?.id && calls.at(-1).id !== t.id ? calls.length : Math.max(0, calls.length - 1))
        calls[i] ??= { id: '', name: '', args: '' }
        if (t.id) calls[i].id = t.id
        if (t.function?.name && !calls[i].name) calls[i].name = t.function.name
        if (t.function?.arguments) calls[i].args += typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments)
      }
    }
    const list = calls.filter(Boolean)
    if (!list.length) return
    list.forEach((c, i) => { c.id ||= `appel_${step}_${i}` })
    convo.push({ role: 'assistant', content: text || null, tool_calls: list.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) })
    for (const c of list) convo.push({ role: 'tool', tool_call_id: c.id, content: await actions.run(c.name, c.args, ctx) })
  }
  stepsDone(onText)
}

async function sendClaude(model, messages, signal, onText, ctx) {
  const Client = Anthropic()
  const client = new Client({ apiKey: keyFor('claude') })
  const convo = toClaude(messages)
  const system = systemPrompt(Boolean(ctx))
  const tools = ctx ? actions.TOOLS.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) : null
  for (let step = 0; step < MAX_STEPS; step++) {
    const params = { model, max_tokens: 16000, system, messages: convo, ...(tools ? { tools } : {}) }
    const stream = CLAUDE_FALLBACK.has(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') return onText('\n\n(Claude a refusé de répondre à cette demande.)')
    if (final.stop_reason === 'max_tokens') return onText('\n\n(Réponse coupée : trop longue.)')
    const uses = final.content.filter(b => b.type === 'tool_use')
    if (!uses.length) return
    convo.push({ role: 'assistant', content: final.content })
    const results = []
    for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await actions.run(u.name, u.input, ctx) })
    convo.push({ role: 'user', content: results })
  }
  stepsDone(onText)
}

function explain(provider, error) {
  const label = PROVIDERS[provider]?.label || provider
  // Les classes d'erreur d'Anthropic : seulement si son module a déjà servi (sinon, inutile de le charger)
  const A = anthropicLib || { APIUserAbortError: class {}, AuthenticationError: class {}, RateLimitError: class {}, APIError: class {} }
  if (error.name === 'AbortError' || error instanceof A.APIUserAbortError) return 'Réponse arrêtée.'
  const account = PROVIDERS[provider]?.account
  if (account) {
    const who = abonnements.OUTILS[account].account
    if (/not logged|sign.?in|log.?in|auth|401|unauthori[sz]ed|credential/i.test(error.message)) return `Nuage n’est pas encore connecté à ton compte ${who} : réglages de Nuage → « Comment faire marcher Nuage » → ${label} → « Se connecter ».`
    if (/quota|rate.?limit|429|usage limit|exhausted/i.test(error.message)) return `Limite de ton abonnement ${who} atteinte pour le moment : ${error.message}`
    return `${label} : ${error.message}`
  }
  if (PROVIDERS[provider]?.subscription) {
    if (/not logged in|\/login|log in/i.test(error.message)) return 'Nuage n’est pas encore connecté à ton compte Claude : clique sur « Se connecter à Claude » (une seule fois).'
    if (/limit/i.test(error.message)) return `Limite d’utilisation de ton abonnement Claude atteinte : ${error.message}`
    return `Claude (abonnement) : ${error.message}`
  }
  if (error instanceof A.AuthenticationError || error?.status === 401) return `Clé ${label} refusée : vérifie-la dans la barre (roue dentée → Réglages → IA).`
  if (error instanceof A.RateLimitError || error?.status === 429) return `${label} : trop de demandes ou crédit épuisé, réessaie plus tard.`
  if (error instanceof A.APIError && error.status) return `${label} : erreur ${error.status} (${error.message}).`
  if (/ECONNREFUSED|fetch failed|Connection error/i.test(`${error?.message} ${error?.cause?.message}`)) {
    return PROVIDERS[provider]?.local ? `${label} ne répond pas : est-il lancé sur ce PC ?` : `${label} injoignable : vérifie ta connexion Internet.`
  }
  return `${label} : ${error.message || error}`
}

module.exports = {
  PROVIDERS, listModels, send, attachmentFromFile, findClaudeCode, claudeCodeStatus, loginClaudeCode,
  readSessionHistory, sendSession, createSessionWorker, explainSession: error => explain('claudecode', error),
  claudeCodeUsage, parseUsage, parseReset, sendOpenAI, systemPrompt,
}

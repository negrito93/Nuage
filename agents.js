// Suivi des sessions Claude Code.
// - Journaux : ~/.claude/projects/<projet>/<session>.jsonl, lus au fil de l'eau (ce que l'agent
//   lit, modifie, exécute ; diffs exacts via toolUseResult.structuredPatch).
// - Hooks HTTP (serveur.js) : début/fin de session, notifications, demandes d'autorisation et
//   questions (AskUserQuestion), auxquelles l'utilisateur répond dans l'encoche.
// - Barre d'état : limites d'utilisation 5 h / 7 j (rate_limits), modèle, contexte.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const ACTIVE_MS = 2 * 60_000
const RECENT_MS = 12 * 60 * 60_000
const INITIAL_TAIL = 768 * 1024
const MAX_STEPS = 120
const MAX_PATCH_LINES = 400
const MAX_RESULT = 12_000 // texte gardé par étape (résultat d'un outil, message de Claude)
const MAX_INPUT = 4000
const PERMISSION_WAIT_MS = 45_000

const base = p => (p ? path.basename(String(p)) : '?')
const short = (text, max = 80) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const hostOf = url => {
  try {
    return new URL(url).hostname
  } catch {
    return short(url, 40)
  }
}

// Texte limité (résultats d'outils, messages) : le début et la fin, pour garder l'essentiel
function clip(text, max = MAX_RESULT) {
  const t = String(text ?? '')
  if (t.length <= max) return t
  const head = Math.round(max * 0.75)
  return `${t.slice(0, head)}\n\n… (${t.length - max} caractères non affichés) …\n\n${t.slice(-(max - head))}`
}
// Contenu d'un tool_result : texte simple ou liste de blocs { type: 'text', text }
function resultText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(b => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n')
}
// Entrée d'un outil, allégée (chaînes coupées, objets résumés en JSON)
function compactInput(input) {
  const out = {}
  for (const [k, v] of Object.entries(input || {}).slice(0, 20)) {
    out[k] = typeof v === 'string' ? clip(v, MAX_INPUT) : typeof v === 'object' && v !== null ? clip(JSON.stringify(v, null, 1), MAX_INPUT) : v
  }
  return out
}

// Libellé lisible d'un appel d'outil ; icon = nom d'icône Phosphor (renderer\icones.js)
function describeTool(name, input = {}) {
  const n = String(name || '')
  if (n === 'Read') return { kind: 'lecture', icon: 'book-open-text', label: `Lit ${base(input.file_path)}` }
  if (n === 'Edit' || n === 'MultiEdit') return { kind: 'edition', icon: 'pencil-simple', label: `Modifie ${base(input.file_path)}` }
  if (n === 'Write') return { kind: 'ecriture', icon: 'file-plus', label: `Écrit ${base(input.file_path)}` }
  if (n === 'NotebookEdit') return { kind: 'edition', icon: 'pencil-simple', label: `Modifie ${base(input.notebook_path)}` }
  if (n === 'Bash' || n === 'PowerShell') {
    return { kind: 'commande', icon: 'terminal-window', label: `Exécute : ${short(input.description || input.command, 70)}`, detail: input.command }
  }
  if (n === 'Glob') return { kind: 'recherche', icon: 'magnifying-glass', label: `Cherche des fichiers « ${short(input.pattern, 40)} »` }
  if (n === 'Grep') return { kind: 'recherche', icon: 'magnifying-glass', label: `Cherche « ${short(input.pattern, 40)} »` }
  if (n === 'WebFetch') return { kind: 'web', icon: 'globe-simple', label: `Consulte ${hostOf(input.url)}`, detail: input.url }
  if (n === 'WebSearch') return { kind: 'web', icon: 'globe-simple', label: `Recherche web « ${short(input.query, 50)} »` }
  if (n === 'Agent' || n === 'Task') return { kind: 'agent', icon: 'robot', label: `Lance un sous-agent : ${short(input.description, 60)}` }
  if (n === 'AskUserQuestion') return { kind: 'question', icon: 'question', label: 'Te pose une question' }
  if (n === 'TodoWrite') return { kind: 'taches', icon: 'list-checks', label: 'Met à jour sa liste de tâches' }
  if (n === 'Skill') return { kind: 'autre', icon: 'puzzle-piece', label: `Utilise la compétence ${short(input.skill, 40)}` }
  if (n.startsWith('mcp__')) return { kind: 'autre', icon: 'puzzle-piece', label: `Outil ${short(n.split('__').slice(1).join(' › '), 60)}` }
  return { kind: 'autre', icon: 'wrench', label: `Outil ${short(n, 50)}` }
}

// Résumé d'une demande d'autorisation et « signature » pour « Toujours (cette session) »
function permissionSummary(tool, input = {}) {
  const d = describeTool(tool, input)
  let signature = tool
  let always = `toutes les actions « ${tool} »`
  if ((tool === 'Bash' || tool === 'PowerShell') && input.command) {
    const program = String(input.command).trim().split(/\s+/)[0]
    signature = `${tool}:${program}`
    always = `les commandes « ${short(program, 30)} … »`
  } else if (tool === 'WebFetch' && input.url) {
    signature = `${tool}:${hostOf(input.url)}`
    always = `le site ${hostOf(input.url)}`
  } else if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) {
    always = 'les modifications de fichiers'
  }
  return { ...d, signature, always, command: input.command || input.url || input.file_path || '' }
}

// Détails structurés d'un résultat (toolUseResult) : fichier lu, sortie d'une commande, fichiers
// trouvés, code modifié. Le texte brut du résultat est déjà dans step.result.
function addResultDetails(step, r) {
  if (!r || typeof r !== 'object') return
  if (r.file && typeof r.file.content === 'string') {
    step.read = { path: r.file.filePath, startLine: r.file.startLine || 1, numLines: r.file.numLines, totalLines: r.file.totalLines }
    step.result = clip(r.file.content)
  }
  if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
    step.output = { stdout: clip(r.stdout || ''), stderr: clip(r.stderr || '', 4000), interrupted: Boolean(r.interrupted) }
  }
  if (Array.isArray(r.filenames)) {
    step.found = { files: r.filenames.slice(0, 200).map(String), count: r.numFiles ?? r.filenames.length, truncated: Boolean(r.truncated) }
  }
  if (Array.isArray(r.structuredPatch)) {
    step.patch = trimPatch(r.structuredPatch)
    step.created = r.type === 'create'
    if (step.created && !r.structuredPatch.length && typeof r.content === 'string') step.result = clip(r.content)
  }
}

function countPatch(patch) {
  let added = 0
  let removed = 0
  for (const hunk of patch || []) {
    for (const line of hunk.lines || []) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}
function trimPatch(patch) {
  let budget = MAX_PATCH_LINES
  const hunks = []
  for (const hunk of patch || []) {
    if (budget <= 0) break
    const lines = (hunk.lines || []).slice(0, budget).map(l => (l.length > 400 ? `${l.slice(0, 399)}…` : l))
    budget -= lines.length
    hunks.push({ oldStart: hunk.oldStart, newStart: hunk.newStart, lines })
  }
  return hunks
}

// isOwnSession(id) : session lancée par le chat de Nuage, dont les autorisations passent déjà par le chat
function createAgentHub({ onChange = () => {}, onEvent = () => {}, projectsDir = PROJECTS, permissionWaitMs = PERMISSION_WAIT_MS, isOwnSession = () => false } = {}) {
  const sessions = new Map()
  const files = new Map() // chemin du journal -> { offset, rest, sessionId }
  const permissions = new Map()
  const alwaysAllow = new Set()
  let usage = null
  let permissionsInNuage = true
  let changed = false
  let seq = 0

  function session(id, extra = {}) {
    let s = sessions.get(id)
    if (!s) {
      s = {
        id, title: '', cwd: '', prompt: '', model: '', lastAt: 0, status: 'inactif', waiting: '',
        steps: [], files: new Map(), pending: new Map(), transcript: '',
      }
      sessions.set(id, s)
    }
    Object.assign(s, Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== '')))
    return s
  }
  const touch = (s, at) => {
    s.lastAt = Math.max(s.lastAt, at || Date.now())
    changed = true
  }
  function addStep(s, step) {
    s.steps.push(step)
    if (s.steps.length > MAX_STEPS) s.steps.splice(0, s.steps.length - MAX_STEPS)
  }

  // ---------- Lecture des journaux ----------
  function handleLine(line, fileInfo, live) {
    let o
    try {
      o = JSON.parse(line)
    } catch {
      return
    }
    const id = o.sessionId || fileInfo.sessionId
    if (!id) return
    const s = session(id, { cwd: o.cwd, transcript: fileInfo.path })
    const at = o.timestamp ? Date.parse(o.timestamp) : 0
    if (o.type === 'custom-title') s.title = o.customTitle || s.title
    else if (o.type === 'agent-name' && !s.title) s.title = o.agentName || s.title
    else if (o.type === 'last-prompt') s.prompt = o.lastPrompt || s.prompt
    if (o.type === 'assistant' && o.message) {
      if (o.message.model) s.model = o.message.model
      const blocks = Array.isArray(o.message.content) ? o.message.content : []
      blocks.forEach((block, i) => {
        // Ce que Claude dit entre deux actions (visible dans l'activité en direct)
        if (block.type === 'text' && String(block.text || '').trim()) {
          addStep(s, {
            id: `m-${o.uuid || ++seq}-${i}`, at, kind: 'message', icon: 'chat-circle-text', label: `Dit : ${short(block.text, 70)}`,
            sub: Boolean(o.isSidechain), done: true, error: false, text: clip(block.text),
          })
          return
        }
        if (block.type !== 'tool_use') return
        const d = describeTool(block.name, block.input)
        const step = { id: block.id, at, ...d, tool: block.name, input: compactInput(block.input), sub: Boolean(o.isSidechain), done: false, error: false }
        addStep(s, step)
        s.pending.set(block.id, step)
        if (live && d.kind === 'edition') onEvent({ type: 'working', sessionId: id })
      })
      touch(s, at)
    } else if (o.type === 'user' && o.message) {
      const content = o.message.content
      if (typeof content === 'string' && !o.isMeta) {
        s.prompt = short(content, 200)
        addStep(s, { id: `p${++seq}`, at, kind: 'demande', icon: 'user-circle', label: `Ta demande : ${short(content, 70)}`, done: true, text: clip(content) })
        s.waiting = ''
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type !== 'tool_result') continue
        const step = s.pending.get(block.tool_use_id)
        if (step) {
          step.done = true
          step.error = Boolean(block.is_error)
          step.endedAt = at
          step.result = clip(resultText(block.content))
          addResultDetails(step, o.toolUseResult)
          s.pending.delete(block.tool_use_id)
        }
      }
      const r = o.toolUseResult
      if (r && typeof r === 'object' && r.filePath && Array.isArray(r.structuredPatch)) {
        const counts = r.type === 'create' && !r.structuredPatch.length
          ? { added: String(r.content || '').split('\n').length, removed: 0 }
          : countPatch(r.structuredPatch)
        const entry = s.files.get(r.filePath) || { path: r.filePath, name: base(r.filePath), added: 0, removed: 0, edits: [] }
        entry.added += counts.added
        entry.removed += counts.removed
        // Fichier créé d'un coup (Write) : Claude Code ne donne pas de patch, seulement le contenu ; on le montre
        // comme des lignes ajoutées (sinon la vue du code restait vide sous « Créé à … »)
        const patch = r.type === 'create' && !r.structuredPatch.length && typeof r.content === 'string'
          ? [{ oldStart: 0, newStart: 1, lines: r.content.split('\n').map(l => `+${l}`) }]
          : r.structuredPatch
        entry.edits.push({ at, created: r.type === 'create', ...counts, hunks: trimPatch(patch) })
        if (entry.edits.length > 30) entry.edits.shift()
        s.files.set(r.filePath, entry)
        // Ajoute le compte au libellé de l'étape correspondante
        const last = [...s.steps].reverse().find(st => (st.kind === 'edition' || st.kind === 'ecriture') && st.label.endsWith(base(r.filePath)))
        if (last && !last.counted) {
          last.label += ` (+${counts.added} −${counts.removed})`
          last.counted = true
        }
      }
      touch(s, at)
    }
  }

  function readFile(fileInfo, live) {
    let stat
    try {
      stat = fs.statSync(fileInfo.path)
    } catch {
      files.delete(fileInfo.path)
      return
    }
    if (stat.size < fileInfo.offset) fileInfo.offset = 0 // fichier recréé
    if (stat.size === fileInfo.offset) return
    const fd = fs.openSync(fileInfo.path, 'r')
    try {
      const length = stat.size - fileInfo.offset
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, fileInfo.offset)
      fileInfo.offset = stat.size
      const text = fileInfo.rest + buffer.toString('utf8')
      const lines = text.split('\n')
      fileInfo.rest = lines.pop()
      if (fileInfo.skipFirst) {
        lines.shift() // première ligne coupée (lecture de la fin du fichier)
        fileInfo.skipFirst = false
      }
      for (const line of lines) if (line.trim()) handleLine(line, fileInfo, live)
    } finally {
      fs.closeSync(fd)
    }
  }

  function scan() {
    const now = Date.now()
    let dirs = []
    try {
      dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory())
    } catch {
      dirs = []
    }
    for (const dir of dirs) {
      const folder = path.join(projectsDir, dir.name)
      let entries = []
      try {
        entries = fs.readdirSync(folder).filter(f => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const name of entries) {
        const full = path.join(folder, name)
        let info = files.get(full)
        if (!info) {
          let stat
          try {
            stat = fs.statSync(full)
          } catch {
            continue
          }
          if (now - stat.mtimeMs > RECENT_MS) continue
          const offset = Math.max(0, stat.size - INITIAL_TAIL)
          info = { path: full, offset, rest: '', skipFirst: offset > 0, sessionId: name.replace(/\.jsonl$/, ''), first: true }
          files.set(full, info)
        }
        readFile(info, !info.first)
        info.first = false
      }
    }
    // Statuts
    for (const s of sessions.values()) {
      const before = s.status
      if ([...permissions.values()].some(p => p.sessionId === s.id)) s.status = 'permission'
      else if (s.waiting) s.status = 'attente'
      else if (s.stopped && s.stopped >= s.lastAt) s.status = 'termine'
      // Un outil encore en cours (longue commande, sous-agent) : la session travaille, même sans nouvelle ligne
      else if ([...s.pending.values()].some(st => now - st.at < 30 * 60_000)) s.status = 'en-cours'
      else s.status = now - s.lastAt < ACTIVE_MS ? 'en-cours' : 'inactif'
      if (s.status !== before) changed = true
      if (now - s.lastAt > RECENT_MS && !permissions.size) sessions.delete(s.id)
    }
    if (changed) {
      changed = false
      onChange(snapshot())
    }
  }

  // ---------- Hooks ----------
  function decisionFor(behavior, extra = {}) {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...extra } } }
  }
  async function handleHook(body) {
    const event = body.hook_event_name
    const s = body.session_id ? session(body.session_id, { cwd: body.cwd, transcript: body.transcript_path }) : null
    if (s && body.transcript_path && !files.has(body.transcript_path)) {
      files.set(body.transcript_path, { path: body.transcript_path, offset: 0, rest: '', skipFirst: false, sessionId: body.session_id, first: true })
    }
    if (event === 'SessionStart' && s) {
      s.stopped = 0
      if (body.session_title) s.title = body.session_title
      touch(s)
    } else if (event === 'UserPromptSubmit' && s) {
      s.stopped = 0
      s.waiting = ''
      touch(s)
    } else if (event === 'Notification' && s) {
      s.waiting = short(body.message || 'Claude attend ta réponse', 120)
      touch(s)
      onEvent({ type: 'notification', sessionId: s.id, title: s.title, message: s.waiting, kind: body.notification_type })
    } else if ((event === 'Stop' || event === 'SessionEnd') && s) {
      s.stopped = Date.now()
      s.waiting = ''
      touch(s)
      if (event === 'Stop') onEvent({ type: 'done', sessionId: s.id, title: s.title, message: short(body.last_assistant_message, 140) })
    } else if (event === 'PermissionRequest' && s) {
      return requestPermission(s, body)
    }
    scan()
    return {}
  }

  function requestPermission(s, body) {
    const tool = body.tool_name
    const input = body.tool_input || {}
    const summary = permissionSummary(tool, input)
    if (!permissionsInNuage || isOwnSession(s.id)) return {}
    if (tool !== 'AskUserQuestion' && alwaysAllow.has(`${s.id}|${summary.signature}`)) {
      onEvent({ type: 'auto-allowed', sessionId: s.id, label: summary.label })
      return decisionFor('allow')
    }
    const id = `perm-${++seq}`
    return new Promise(resolve => {
      const request = {
        id, sessionId: s.id, title: s.title || base(s.cwd), tool, createdAt: Date.now(), ...summary,
        questions: tool === 'AskUserQuestion' && Array.isArray(input.questions) ? input.questions : null,
        input,
        finish: response => {
          clearTimeout(request.timer)
          permissions.delete(id)
          changed = true
          scan()
          resolve(response)
        },
      }
      // Sans réponse dans Nuage, Claude Code affiche sa propre fenêtre
      request.timer = setTimeout(() => request.finish({}), permissionWaitMs)
      permissions.set(id, request)
      changed = true
      onEvent({ type: request.questions ? 'question' : 'permission', id, sessionId: s.id, title: request.title, label: summary.label })
      scan()
    })
  }

  // choice : 'allow' | 'deny' | 'always' | 'answer' | 'defer'
  function resolvePermission(id, choice, answers) {
    const request = permissions.get(id)
    if (!request) return false
    if (choice === 'always') {
      alwaysAllow.add(`${request.sessionId}|${request.signature}`)
      request.finish(decisionFor('allow'))
    } else if (choice === 'allow') {
      request.finish(decisionFor('allow'))
    } else if (choice === 'deny') {
      request.finish(decisionFor('deny', { message: 'Refusé par l’utilisateur depuis Nuage.' }))
    } else if (choice === 'answer' && request.questions && answers && typeof answers === 'object') {
      const clean = {}
      for (const q of request.questions) {
        const value = answers[q.question]
        if (typeof value === 'string' && value.trim()) clean[q.question] = value.trim().slice(0, 2000)
      }
      request.finish(decisionFor('allow', { updatedInput: { ...request.input, answers: clean } }))
    } else {
      request.finish({}) // « Répondre dans Claude » : fenêtre habituelle
    }
    return true
  }

  // ---------- Barre d'état : limites d'utilisation ----------
  function handleStatusline(body) {
    const rl = body.rate_limits || {}
    const win = w => (w && typeof w.used_percentage === 'number' ? { pct: w.used_percentage, resetsAt: w.resets_at ? w.resets_at * 1000 : null } : null)
    usage = {
      fiveHour: win(rl.five_hour),
      sevenDay: win(rl.seven_day),
      model: body.model?.display_name || '',
      context: typeof body.context_window?.used_percentage === 'number' ? body.context_window.used_percentage : null,
      updatedAt: Date.now(),
    }
    if (body.session_id) session(body.session_id, { cwd: body.cwd || body.workspace?.current_dir })
    changed = true
    scan()
  }

  // Limites lues par Nuage lui-même (« claude -p /usage », sans appel au modèle, voir main.js) :
  // à jour même quand l'application Claude n'exécute pas la barre d'état
  function setUsage(next) {
    if (!next) return
    usage = { ...(usage || {}), ...next, updatedAt: Date.now() }
    changed = true
    scan()
  }

  // ---------- État pour l'encoche ----------
  function snapshot() {
    const now = Date.now()
    const list = [...sessions.values()]
      .filter(s => s.steps.length || s.title || permissions.size)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 12)
      .map(s => ({
        id: s.id,
        title: s.title || s.prompt || base(s.cwd) || 'Session',
        project: base(s.cwd),
        cwd: s.cwd,
        transcript: s.transcript, // journal .jsonl (pour reprendre la session dans le chat de Nuage)
        status: s.status,
        waiting: s.waiting,
        model: s.model,
        lastAt: s.lastAt,
        current: [...s.steps].reverse().find(st => st.kind !== 'demande' && st.kind !== 'message')?.label || '',
        // Les 60 dernières étapes, les plus récentes d'abord (détails : stepDetail)
        steps: s.steps.slice(-60).reverse().map(({ id: stepId, at, endedAt, icon, label, detail, done, error, sub, kind }) =>
          ({ id: stepId, at, endedAt, icon, label, detail, done, error, sub, kind })),
        files: [...s.files.values()].map(({ path: p, name, added, removed, edits }) => ({ path: p, name, added, removed, count: edits.length })),
      }))
    return {
      updatedAt: now,
      active: list.filter(s => s.status !== 'inactif' && s.status !== 'termine').length,
      sessions: list,
      permissions: [...permissions.values()].map(p => ({
        id: p.id, sessionId: p.sessionId, title: p.title, tool: p.tool, icon: p.icon, label: p.label,
        command: short(p.command, 300), always: p.always, questions: p.questions, createdAt: p.createdAt,
        expiresAt: p.createdAt + permissionWaitMs,
      })),
      usage,
      permissionsInNuage,
    }
  }
  function fileDiff(sessionId, filePath) {
    const entry = sessions.get(sessionId)?.files.get(filePath)
    return entry ? { path: entry.path, name: entry.name, added: entry.added, removed: entry.removed, edits: entry.edits } : null
  }
  // Tout ce qu'on sait d'une étape (en cours ou finie) : entrée de l'outil, résultat, fichier lu,
  // sortie d'une commande, fichiers trouvés, code modifié, ou le texte d'un message
  function stepDetail(sessionId, stepId) {
    const s = sessions.get(sessionId)
    const step = s?.steps.find(st => st.id === stepId)
    if (!step) return null
    const { id: _id, counted: _counted, ...rest } = step
    return { id: step.id, sessionId, session: s.title || s.prompt || base(s.cwd), cwd: s.cwd, ...rest }
  }
  function setPermissionsInNuage(on) {
    permissionsInNuage = Boolean(on)
    if (!permissionsInNuage) for (const p of [...permissions.values()]) p.finish({})
    changed = true
    scan()
  }

  return { scan, handleHook, handleStatusline, setUsage, resolvePermission, snapshot, fileDiff, stepDetail, setPermissionsInNuage }
}

module.exports = { createAgentHub, describeTool, permissionSummary, countPatch }

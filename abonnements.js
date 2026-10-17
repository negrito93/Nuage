// Gemini et ChatGPT avec l'abonnement de l'utilisateur, sans clé d'API (08/10/2026 : « au premier lancement, l'appli
// doit proposer comment faire marcher Nuage : abonnement Claude, Gemini, ChatGPT, ou clés d'API »). Par les
// programmes officiels, connectés une fois au compte dans le navigateur :
//   Gemini  → Antigravity CLI de Google (agy.exe). Gemini CLI ne sert plus les comptes personnels depuis le
//             18/06/2026 (« This client is no longer supported for Gemini Code Assist for individuals »).
//   ChatGPT → Codex d'OpenAI (codex.exe, « Sign in with ChatGPT »).
// Nuage les télécharge lui-même au clic de l'utilisateur, aux sources officielles, et vérifie leur empreinte
// (SHA-512) ; ils vivent dans ~/.nuage/outils. Ils tournent avec leurs propres réglages (~/.nuage/agy,
// ~/.nuage/codex) : ceux de l'utilisateur ne sont pas touchés. Leurs outils à eux (fichiers, terminal) sont
// coupés : ils n'agissent sur le PC qu'avec ceux de Nuage (mcp-nuage.js → serveur local → actions.js), après
// l'accord de l'utilisateur dans l'encoche.
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')

const ARM = process.arch === 'arm64'
const OUTILS = {
  agy: {
    name: 'Antigravity', account: 'Google', size: '≈ 180 Mo', exe: 'agy.exe',
    // Fiche de version lue par le script d'installation officiel (https://antigravity.google/cli/install.ps1)
    manifest: `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_${ARM ? 'arm64' : 'amd64'}.json`,
  },
  codex: {
    name: 'Codex', account: 'ChatGPT', size: '≈ 160 Mo', pkg: '@openai/codex', suffix: ARM ? '-win32-arm64' : '-win32-x64',
    exe: path.join('package', 'vendor', `${ARM ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'bin', 'codex.exe'),
  },
}
const root = () => path.join(os.homedir(), '.nuage')
const installDir = id => path.join(root(), 'outils', id)
const exePath = id => path.join(installDir(id), OUTILS[id].exe)
const home = id => path.join(root(), id) // réglages propres à Nuage (dossier personnel d'agy, CODEX_HOME)
const work = id => path.join(home(id), 'travail') // dossier de travail : seulement les consignes (AGENTS.md)
const connectedFlag = id => path.join(home(id), 'connecte.txt')

// Nuage (main.js) donne de quoi joindre son serveur local, pour mcp-nuage.js
let link = { token: '', port: 47823, mcp: path.join(__dirname, 'mcp-nuage.js'), node: process.execPath }
function configure(next) {
  link = { ...link, ...next }
}

// ---------- Installation (au clic de l'utilisateur) ----------
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Nuage' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Source officielle injoignable (erreur ${res.status}).`)
  return res.json()
}
// Téléchargement en continu (gros fichiers) ; l'empreinte est calculée au passage et comparée à la fin
async function download(url, file, algo, expected, encoding, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Nuage' } })
  if (!res.ok) throw new Error(`Téléchargement impossible (erreur ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash(algo)
  const out = fs.createWriteStream(file)
  let got = 0
  let shown = 0
  try {
    for await (const chunk of res.body) {
      hash.update(chunk)
      got += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      if (Date.now() - shown > 300) {
        shown = Date.now()
        onProgress(got, total)
      }
    }
  } finally {
    await new Promise(resolve => out.end(resolve))
  }
  if (hash.digest(encoding).toLowerCase() !== String(expected).toLowerCase()) {
    fs.rmSync(file, { force: true })
    throw new Error('Le fichier téléchargé ne correspond pas à l’original (empreinte différente) : rien n’a été installé.')
  }
}
async function install(id, onProgress = () => {}) {
  const t = OUTILS[id]
  fs.mkdirSync(installDir(id), { recursive: true })
  if (id === 'agy') {
    const m = await getJson(t.manifest)
    const part = `${exePath(id)}.part`
    await download(m.url, part, 'sha512', m.sha512, 'hex', onProgress)
    fs.renameSync(part, exePath(id))
    fs.writeFileSync(path.join(installDir(id), 'version.txt'), String(m.version))
    return m.version
  }
  const latest = await getJson(`https://registry.npmjs.org/${t.pkg}/latest`)
  const meta = await getJson(`https://registry.npmjs.org/${t.pkg}/${latest.version}${t.suffix}`)
  const [algo, digest] = String(meta.dist.integrity).split('-')
  const tgz = path.join(installDir(id), 'paquet.tgz')
  await download(meta.dist.tarball, tgz, algo, digest, 'base64', onProgress)
  fs.rmSync(path.join(installDir(id), 'package'), { recursive: true, force: true })
  // tar de Windows 10+ (bsdtar) : aucune dépendance de plus
  const tar = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xzf', tgz, '-C', installDir(id)], { timeout: 300_000 })
  fs.rmSync(tgz, { force: true })
  if (tar.code !== 0 || !fs.existsSync(exePath(id))) throw new Error(`Archive illisible : ${tar.out.slice(0, 200)}`)
  fs.writeFileSync(path.join(installDir(id), 'version.txt'), String(latest.version))
  return latest.version
}

// ---------- Lancer l'outil (réglages de Nuage, outils de Nuage seulement) ----------
function env(id) {
  const e = { ...process.env }
  // Pas de clé d'API d'ailleurs : on veut le compte de l'utilisateur ; pas d'ELECTRON_RUN_AS_NODE hérité
  for (const k of Object.keys(e)) if (/^(GEMINI_|GOOGLE_API_KEY|GOOGLE_GENAI|GOOGLE_CLOUD|OPENAI_|CODEX_|ELECTRON_RUN_AS_NODE$)/i.test(k)) delete e[k]
  if (id === 'agy') {
    // agy lit ~/.gemini : un dossier personnel à lui (sa connexion Google reste dans le Gestionnaire d'identification)
    e.USERPROFILE = home(id)
    e.HOME = home(id)
    // agy peut lire et écrire d'office dans le dossier temporaire du système : un dossier à lui, pas celui du PC
    e.TEMP = e.TMP = path.join(home(id), 'temp')
    fs.mkdirSync(e.TEMP, { recursive: true })
  } else {
    e.CODEX_HOME = home(id)
  }
  return e
}
function run(exe, args, { env: e = process.env, cwd, input, timeout = 30_000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: e, cwd, windowsHide: true })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', d => {
      out += d
      onLine?.(d, child)
    })
    child.stderr.on('data', d => { out += d })
    child.stdin.on('error', () => {})
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, out })
    })
    if (input !== undefined) child.stdin.end(input)
  })
}
// Images jointes au chat, écrites ici à chaque message (agy les voit par l'outil voir_image de mcp-nuage.js)
const pieces = id => path.join(home(id), 'pieces')
const mcpEnv = id => ({ ELECTRON_RUN_AS_NODE: '1', NUAGE_PORT: String(link.port), NUAGE_JETON: link.token, NUAGE_PIECES: pieces(id) })
// Écrit à chaque fois (chemins, jeton et consignes à jour)
function prepare(id, system) {
  fs.mkdirSync(work(id), { recursive: true })
  fs.writeFileSync(path.join(work(id), 'AGENTS.md'), `${system}\n\nTes outils sont ceux du serveur MCP « nuage » : sers-t’en pour toute action sur le PC.\n`, 'utf8')
  if (id === 'agy') {
    const g = path.join(home(id), '.gemini')
    fs.mkdirSync(path.join(g, 'config'), { recursive: true })
    fs.mkdirSync(path.join(g, 'antigravity-cli'), { recursive: true })
    fs.writeFileSync(path.join(g, 'config', 'mcp_config.json'), JSON.stringify({
      mcpServers: { nuage: { command: link.node, args: [link.mcp], env: mcpEnv(id) } },
    }, null, 2))
    // Outils de Nuage acceptés d'office (Nuage demande lui-même l'accord) ; les siens refusés (Refus > Demande > Accord).
    // Lecture : plus de refus général (09/10/2026) : agy range une grande image rendue par voir_image dans son propre
    // dossier (brain\…\media_0.png) et doit l'ouvrir lui-même. Sans règle, il ne lit que son dossier de travail, le
    // sien et son dossier temporaire (env) ; ailleurs, l'accord qu'il demanderait est refusé d'office (mode -p).
    fs.writeFileSync(path.join(g, 'antigravity-cli', 'settings.json'), JSON.stringify({
      permissions: { allow: ['mcp(nuage/*)'], deny: ['write_file(*)', 'command(*)', 'unsandboxed(*)', 'execute_url(*)'] },
    }, null, 2))
    return
  }
  const q = JSON.stringify // chaîne TOML (mêmes échappements que JSON)
  fs.writeFileSync(path.join(home(id), 'config.toml'), [
    '# Écrit par Nuage à chaque message : Codex n’agit qu’avec les outils de Nuage',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '[features]',
    ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'computer_use', 'browser_use', 'in_app_browser', 'image_generation', 'memories'].map(f => `${f} = false`),
    '[mcp_servers.nuage]',
    `command = ${q(link.node)}`,
    `args = [${q(link.mcp)}]`,
    'tool_timeout_sec = 900', // l'accord de l'utilisateur peut prendre du temps
    '[mcp_servers.nuage.env]',
    ...Object.entries(mcpEnv(id)).map(([k, v]) => `${k} = ${q(v)}`),
    '',
  ].join('\n'), 'utf8')
}

// ---------- État et connexion ----------
async function status(id) {
  const installed = fs.existsSync(exePath(id))
  if (!installed) return { installed, loggedIn: false }
  if (id === 'codex') {
    const r = await run(exePath(id), ['login', 'status'], { env: env(id), timeout: 15_000 }).catch(() => ({ code: 1 }))
    return { installed, loggedIn: r.code === 0 }
  }
  // agy n'a pas de commande d'état : Nuage retient la dernière réponse réussie
  return { installed, loggedIn: fs.existsSync(connectedFlag(id)) }
}
// Connexion unique : le navigateur s'ouvre, l'utilisateur se connecte à son compte (Google ou ChatGPT)
async function login(id, system = 'Tu es Nuage.') {
  if (!fs.existsSync(exePath(id))) throw new Error(`${OUTILS[id].name} n’est pas encore installé.`)
  if (id === 'codex') {
    const r = await run(exePath(id), ['login'], { env: env(id), timeout: 10 * 60_000 })
    if (r.code !== 0) throw new Error(`Connexion à ChatGPT pas terminée${lastLine(r.out)}`)
    return
  }
  // agy : sans fenêtre, il ne sait faire qu'une « connexion silencieuse » (jeton déjà enregistré) ; la première
  // connexion se fait dans SA fenêtre, qui ouvre le navigateur (« Launch the CLI without arguments to sign in »).
  // Quand l'utilisateur la ferme, un premier message vérifie que la connexion est faite.
  prepare(id, system)
  // « start /wait » : une vraie fenêtre de console pour agy, et cmd ne rend la main que quand elle est fermée
  await new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', `start "Connexion de Nuage a Google" /wait "${exePath(id)}"`], {
      env: env(id), cwd: work(id), windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  await check(id)
}
// Un message « OK » : la connexion marche ? (entrée fermée : sans jeton, agy n'attend pas qu'on colle un code)
async function check(id) {
  const r = await run(exePath(id), ['-p=Réponds seulement : OK', '--output-format', 'json'], { env: env(id), cwd: work(id), input: '', timeout: 180_000 })
  const result = parseJson(r.out)
  if (result?.status !== 'SUCCESS') {
    fs.rmSync(connectedFlag(id), { force: true })
    throw new Error(/Authentication required|sign in|silent auth failed/i.test(r.out)
      ? 'Pas encore connecté : dans la fenêtre d’Antigravity, connecte-toi à ton compte Google, puis ferme-la.'
      : `Antigravity n’a pas répondu${result?.error ? ` : ${result.error}` : lastLine(r.out)}`)
  }
  fs.writeFileSync(connectedFlag(id), new Date().toISOString())
}
const lastLine = out => {
  const l = String(out).trim().split(/\r?\n/).filter(Boolean).pop()
  return l ? ` : ${l.slice(0, 200)}` : '.'
}
const parseJson = text => {
  try {
    return JSON.parse(String(text).trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop() || 'null')
  } catch {
    return null
  }
}

// ---------- Discussion ----------
// Toute la conversation en un texte (chaque message relance l'outil). Pièces jointes : les textes dans le texte ;
// les images (09/10/2026 : Gemini répondait « je ne vois pas l'image ») écrites dans pieces(id) : Codex les
// reçoit avec le message (--image), agy les regarde avec l'outil voir_image de Nuage (mcp-nuage.js).
// ponytail: PDF pas transmis (ni agy ni Codex ne les prennent en ligne de commande)
function writeImages(id, messages) {
  fs.rmSync(pieces(id), { recursive: true, force: true })
  const names = new Map() // pièce jointe → nom du fichier
  const images = messages.flatMap(m => (m.role === 'user' ? m.attachments || [] : [])).filter(a => a.kind === 'image').slice(-6)
  if (images.length) fs.mkdirSync(pieces(id), { recursive: true })
  images.forEach((a, k) => {
    const name = `image-${k + 1}.${a.mime === 'image/jpeg' ? 'jpg' : String(a.mime).split('/')[1] || 'png'}`
    fs.writeFileSync(path.join(pieces(id), name), Buffer.from(a.data, 'base64'))
    names.set(a, name)
  })
  return names
}
function transcript(messages, id = 'agy', images = new Map()) {
  const piece = a => {
    if (a.kind === 'text') return `\n\nFichier joint « ${a.name} » :\n\`\`\`\n${a.text}\n\`\`\``
    const name = images.get(a)
    if (!name) return `\n\n(Fichier joint « ${a.name} » : non transmis à cette IA.)`
    return id === 'codex'
      ? `\n\n(Image jointe « ${a.name} » : c’est l’image ${name.match(/\d+/)[0]} des images jointes à ce message.)`
      : `\n\n(Image jointe « ${a.name} » : regarde-la avec l’outil voir_image, nom « ${name} ».)`
  }
  const files = m => (m.attachments || []).map(piece).join('')
  const say = m => `${m.role === 'assistant' ? 'Nuage' : 'Utilisateur'} : ${m.text || '…'}${m.role === 'user' ? files(m) : ''}`
  const last = messages.at(-1)
  if (messages.length < 2) return `${last.text || 'Que peux-tu me dire à ce sujet ?'}${files(last)}`
  return `Conversation jusqu’ici :\n\n${messages.slice(0, -1).map(say).join('\n\n')}\n\nNouveau message de l’utilisateur :\n${last.text || '…'}${files(last)}`
}
// Lecture des événements (une ligne JSON chacun) :
//   agy   : {event:'step_update', step_update:{step_type:'agent_response', text_delta}} … {event:'result', result:{status}}
//   Codex : {type:'item.updated'|'item.completed', item:{id, type:'agent_message', text}} … {type:'turn.completed'}
function reader(id, onText) {
  const state = { ok: false, failure: '' }
  const shown = new Map() // Codex : texte déjà affiché par élément (une mise à jour redonne tout le texte)
  const event = e => {
    if (id === 'agy') {
      const s = e.step_update
      if (e.event === 'step_update' && s?.step_type === 'agent_response' && s.text_delta) onText(s.text_delta)
      if (e.event === 'result') {
        state.ok = e.result?.status === 'SUCCESS'
        if (!state.ok) state.failure = String(e.result?.error?.message || e.result?.error || e.result?.status || 'erreur')
      }
      return
    }
    const item = e.item
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      const before = shown.get(item.id) || ''
      if (item.text.startsWith(before) && item.text.length > before.length) {
        onText(`${before || !shown.size ? '' : '\n\n'}${item.text.slice(before.length)}`)
        shown.set(item.id, item.text)
      }
    }
    if (e.type === 'turn.completed') state.ok = true
    if (e.type === 'turn.failed') state.failure = String(e.error?.message || 'erreur')
    if (e.type === 'error' && !/reconnecting/i.test(e.message || '')) state.failure = String(e.message)
  }
  return { event, state }
}
function send(id, { model, effort = '', messages, system, signal, onText }) {
  if (!fs.existsSync(exePath(id))) return Promise.reject(new Error(`${OUTILS[id].name} n’est pas encore installé : réglages de Nuage → « Comment faire marcher Nuage ».`))
  prepare(id, system)
  const images = writeImages(id, messages)
  let prompt = transcript(messages, id, images)
  // agy : la question va dans « -p=… » (ligne de commande de Windows : 32 000 caractères au plus) ; trop long, les
  // plus vieux échanges tombent
  for (let k = 1; id === 'agy' && prompt.length > 20_000 && k < messages.length; k++) prompt = transcript(messages.slice(k), id, images)
  // Codex : --image prend plusieurs valeurs, d'où sa place juste après « exec » (avant d'autres options)
  const attach = [...images.values()].flatMap(name => ['--image', path.join(pieces(id), name)])
  const args = id === 'agy'
    ? [`-p=${prompt.slice(-20_000)}`, '--output-format', 'stream-json', '--disable-slash-commands', ...(model && model !== 'auto' ? ['--model', model] : []), ...(effort ? [`--effort=${effort}`] : [])]
    : ['exec', ...attach, '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-C', work(id), ...(model && model !== 'auto' ? ['-m', model] : []),
        ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), '-']
  const input = id === 'agy' ? '' : prompt
  return new Promise((resolve, reject) => {
    const child = spawn(exePath(id), args, { env: env(id), cwd: work(id), windowsHide: true })
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    let buffer = ''
    let stderr = ''
    const read = reader(id, onText)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        try {
          read.event(JSON.parse(line))
        } catch {
          // ligne qui n'est pas du JSON (journal) : ignorée
        }
      }
    })
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000) })
    child.stdin.on('error', () => {})
    child.on('error', error => {
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.on('close', code => {
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) return reject(Object.assign(new Error('Réponse arrêtée.'), { name: 'AbortError' }))
      const { ok, failure } = read.state
      if (ok && !failure) {
        if (id === 'agy') fs.writeFileSync(connectedFlag(id), new Date().toISOString())
        return resolve()
      }
      const message = failure || stderr.trim().split(/\r?\n/).filter(Boolean).pop() || `${OUTILS[id].name} s’est arrêté (code ${code})`
      if (id === 'agy' && /auth|sign.?in|login|token|credential|401|403/i.test(message)) fs.rmSync(connectedFlag(id), { force: true })
      reject(Object.assign(new Error(message.slice(0, 400)), { account: id }))
    })
    child.stdin.end(input)
  })
}

const describe = id => ({ name: OUTILS[id].name, account: OUTILS[id].account, size: OUTILS[id].size })
module.exports = { OUTILS, configure, install, status, login, check, send, transcript, writeImages, reader, prepare, describe, exePath, home, env }

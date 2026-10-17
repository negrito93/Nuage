// Compétences (skills) et plugins de Nuage, ajoutés depuis un lien ou une commande (demande du 07/10/2026 : « un menu pour
// permettre au futur utilisateur d'ajouter des plugins ou des skills depuis une commande ou un lien »).
// Ils appartiennent à Nuage, pas à Claude Code : rangés dans ~/.nuage/competences/<nom>/, ils servent à toutes les IA du chat
// (OpenRouter, OpenAI, Gemini, Claude par clé, Ollama, LM Studio ; actions.js « utiliser_competence »). Nuage marche donc
// chez quelqu'un qui n'a pas Claude (07/10/2026 : « quand je suis connecté à un autre LLM, Claude ne doit plus agir »).
// Deux temps : examine(texte) dit ce qui serait ajouté (montré à l'utilisateur), install(texte, choix) le fait, après son
// accord (clic dans les réglages, ou « Autoriser » quand l'IA le propose dans le chat). Jamais d'installation muette.
// - Dossier GitHub (ou dépôt) avec SKILL.md, fichier SKILL.md, archive .zip : compétence(s) copiée(s).
// - Dépôt GitHub avec .claude-plugin/marketplace.json (format des catalogues de plugins de Claude Code) : catalogue ; un
//   plugin installé = ses compétences (skills/*/SKILL.md) et ses commandes (commands/*.md, devenues des compétences). Le
//   reste d'un plugin (agents, serveurs MCP, crochets) est propre à Claude Code et n'est pas repris.
// - « /plugin install nom@catalogue » : plugin d'un catalogue connu (officiels d'Anthropic, ou déjà examiné).
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const nuageDir = () => path.join(os.homedir(), '.nuage')
const skillsDir = () => path.join(nuageDir(), 'competences')
const MAX_FILES = 300
const MAX_BYTES = 25e6
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

const words = text => (String(text).match(/"[^"]*"|'[^']*'|\S+/g) || []).map(w => w.replace(/^["']|["']$/g, ''))

// ---------- Catalogues connus : les officiels d'Anthropic, puis ceux examinés (nom → propriétaire/dépôt) ----------
const OFFICIELS = { 'claude-plugins-official': 'anthropics/claude-plugins-official', 'anthropic-agent-skills': 'anthropics/skills' }
const cataloguesFile = () => path.join(nuageDir(), 'catalogues.json')
function examinedCatalogues() {
  try {
    return JSON.parse(fs.readFileSync(cataloguesFile(), 'utf8'))
  } catch {
    return {}
  }
}
const catalogues = () => ({ ...OFFICIELS, ...examinedCatalogues() })
function rememberCatalogue(name, source) {
  if (!NAME.test(name) || catalogues()[name] === source) return
  fs.mkdirSync(nuageDir(), { recursive: true })
  fs.writeFileSync(cataloguesFile(), JSON.stringify({ ...examinedCatalogues(), [name]: source }, null, 2))
}

// Ce que l'utilisateur (ou l'IA) a donné : une commande, un lien, ou « propriétaire/dépôt[/dossier…] » (GitHub)
function parse(input) {
  const text = String(input || '').trim()
  if (!text) throw new Error('Colle un lien ou une commande.')
  const cmd = /^\/?(?:claude\s+)?plugins?\s+(.+)$/is.exec(text)
  if (cmd) {
    // « --scope … » (propre à Claude Code) est ignoré ; toute autre option est refusée
    const all = words(cmd[1])
    const args = all.filter((w, i) => !['--scope', '-s'].includes(w) && !['--scope', '-s'].includes(all[i - 1]))
    const bad = args.find(w => w.startsWith('-'))
    if (bad) throw new Error(`Option « ${bad} » inconnue.`)
    const [sub = '', a = '', b = ''] = args
    if (['install', 'i'].includes(sub.toLowerCase())) {
      const m = /^([\w.-]+)@([\w.-]+)$/.exec(a)
      if (!m) throw new Error('Écris « /plugin install nom@catalogue ».')
      return { type: 'plugin', name: m[1], catalogue: m[2] }
    }
    if (sub.toLowerCase() === 'marketplace' && a.toLowerCase() === 'add' && b) return parse(b)
    throw new Error('Nuage comprend « /plugin install nom@catalogue » et « /plugin marketplace add <lien> ». Pour retirer une compétence, utilise la liste des compétences.')
  }
  const skill = /^\/?(?:skills?|comp[ée]tences?)\s+(\S+)$/i.exec(text)
  const target = skill ? skill[1] : text
  const short = /^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)\/?$/.exec(target)
  if (short) return { type: 'github', owner: short[1], repo: short[2].replace(/\.git$/, ''), ref: '', dir: short[3].slice(1).replace(/(^|\/)SKILL\.md$/i, '') }
  let url
  try {
    url = new URL(target)
  } catch {
    throw new Error('Je ne reconnais ni un lien ni une commande. Exemples : https://github.com/propriétaire/dépôt, propriétaire/dépôt, /plugin install nom@catalogue.')
  }
  if (url.protocol !== 'https:') throw new Error('Seuls les liens https:// sont acceptés.')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (url.hostname === 'github.com') {
    const [owner, repo, kind, ref, ...rest] = parts
    if (!owner || !repo) throw new Error('Lien GitHub incomplet : il faut au moins propriétaire/dépôt.')
    const base = { type: 'github', owner, repo: repo.replace(/\.git$/, ''), ref: '', dir: '' }
    if (kind === 'tree') return { ...base, ref, dir: rest.join('/') }
    if (kind === 'blob') return { ...base, ref, dir: rest.slice(0, -1).join('/') }
    return base
  }
  if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    const [owner, repo, ref, ...rest] = parts
    return { type: 'github', owner, repo, ref, dir: rest.slice(0, -1).join('/') }
  }
  if (/\.zip$/i.test(url.pathname)) return { type: 'zip', url: url.href }
  if (/(^|\/)SKILL\.md$/i.test(url.pathname)) return { type: 'fichier', url: url.href }
  throw new Error('Lien non pris en charge : un lien GitHub, une archive .zip ou un fichier SKILL.md.')
}

// Nom et description d'une compétence (en-tête YAML de SKILL.md ; « > » ou « | » : texte sur plusieurs lignes)
function frontmatter(text) {
  const head = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---/.exec(String(text))
  const lines = head ? head[1].split(/\r?\n/) : []
  const get = key => {
    const i = lines.findIndex(l => new RegExp(`^${key}:`).test(l))
    if (i < 0) return ''
    const value = lines[i].slice(key.length + 1).trim()
    if (value && !/^[>|][-+]?$/.test(value)) return value.replace(/^["']|["']$/g, '')
    const more = []
    for (const l of lines.slice(i + 1)) {
      if (!/^\s+\S/.test(l)) break
      more.push(l.trim())
    }
    return more.join(' ')
  }
  return { name: get('name'), description: get('description') }
}
const safeName = (wanted, fallback) => (NAME.test(wanted || '') ? wanted : NAME.test(fallback || '') ? fallback : null)

// ---------- GitHub (API publique : 60 requêtes par heure sans compte) ----------
async function gh(apiPath) {
  const res = await fetch(`https://api.github.com/repos/${apiPath}`, { headers: { 'User-Agent': 'Nuage', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub limite les demandes sans compte (60 par heure) : réessaie un peu plus tard.' : `GitHub : erreur ${res.status}.`)
  return res.json()
}
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const contents = (g, dir) => gh(`${g.owner}/${g.repo}/contents/${enc(dir)}${g.ref ? `?ref=${encodeURIComponent(g.ref)}` : ''}`)
const joinDir = (...parts) => path.posix.normalize(path.posix.join(...parts.map(p => String(p || '')))).replace(/^\.\/?|\/$/g, '')
async function download(url, limit = MAX_BYTES) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Nuage' }, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Téléchargement impossible (erreur ${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > limit) throw new Error('Fichier trop gros pour une compétence.')
  return buf
}
// Les compétences d'un dossier GitHub : le dossier lui-même s'il a un SKILL.md, sinon ses sous-dossiers (et skills/…)
async function githubSkills(g) {
  let list = await contents(g, g.dir)
  // « anthropics/skills/pdf » (forme courte écrite par les IA) : le dossier est en fait skills/pdf (audit OpenRouter du 08/10/2026)
  if (!list && g.dir && !g.dir.startsWith('skills/')) {
    list = await contents(g, `skills/${g.dir}`)
    if (list) g.dir = `skills/${g.dir}`
  }
  if (!Array.isArray(list)) return []
  const describe = async (dir, entries) => {
    const md = entries.find(e => e.type === 'file' && /^skill\.md$/i.test(e.name))
    if (!md) return null
    const meta = frontmatter((await download(md.download_url, 2e6)).toString('utf8'))
    return { name: safeName(meta.name, path.posix.basename(dir || g.repo)), description: meta.description, dir, g }
  }
  const self = await describe(g.dir, list)
  if (self) return [self]
  const found = []
  const dirs = list.filter(e => e.type === 'dir').slice(0, 20)
  const skillsFolder = dirs.find(d => d.name === 'skills')
  for (const d of skillsFolder ? [skillsFolder, ...dirs.filter(x => x !== skillsFolder)] : dirs) {
    const sub = await contents(g, d.path)
    if (!Array.isArray(sub)) continue
    const one = await describe(d.path, sub)
    if (one) found.push(one)
    else if (d === skillsFolder) {
      for (const s of sub.filter(e => e.type === 'dir').slice(0, 30)) {
        const inner = await contents(g, s.path)
        const skill = Array.isArray(inner) ? await describe(s.path, inner) : null
        if (skill) found.push(skill)
      }
    }
    if (found.length >= 30) break
  }
  return found.filter(s => s.name)
}
async function githubFiles(g, dir, out = [], root = dir) {
  const list = await contents(g, dir)
  for (const e of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_FILES) throw new Error('Trop de fichiers dans cette compétence.')
    if (e.type === 'dir') await githubFiles(g, e.path, out, root)
    else if (e.type === 'file') out.push({ rel: path.posix.relative(root, e.path), url: e.download_url, size: e.size })
  }
  return out
}

// ---------- Catalogues de plugins (.claude-plugin/marketplace.json) ----------
async function readMarket(g) {
  const file = await contents(g, '.claude-plugin/marketplace.json')
  return file?.content ? { json: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), g: { ...g, dir: '' } } : null
}
// Où est rangé un plugin : dans le dépôt du catalogue (« ./plugins/x ») ou dans un autre dépôt GitHub (github, url, git-subdir)
function pluginHome(entry, cat, root) {
  const s = entry.source
  if (typeof s === 'string') return { ...cat, dir: joinDir(root, s) }
  let repo = s?.repo || ''
  try {
    const u = new URL(s?.url)
    if (u.hostname === 'github.com') repo = u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
  } catch {}
  const [owner, name] = String(repo).split('/')
  if (!owner || !name) return null
  return { type: 'github', owner, repo: name.replace(/\.git$/, ''), ref: s.ref || '', dir: joinDir(s.path) }
}
// Les commandes d'un plugin (commands/*.md : des consignes pour l'IA) deviennent des compétences « plugin-commande »
async function pluginCommands(plugin, home) {
  const list = await contents(home, joinDir(home.dir, 'commands'))
  const out = []
  for (const f of (Array.isArray(list) ? list : []).filter(e => e.type === 'file' && /\.md$/i.test(e.name)).slice(0, 20)) {
    const command = f.name.replace(/\.md$/i, '')
    const name = safeName(`${plugin}-${command}`.toLowerCase().slice(0, 64), null)
    if (!name) continue
    const body = (await download(f.download_url, 2e5)).toString('utf8')
    const description = (frontmatter(body).description || `Commande « /${command} » du plugin ${plugin}.`).replace(/\s+/g, ' ')
    out.push({ name, description, text: `---\nname: ${name}\ndescription: ${description}\n---\n${body.replace(/^\uFEFF?---[\s\S]*?\r?\n---\r?\n?/, '')}` })
  }
  return out
}
async function pluginSkills(entry, cat, root) {
  const home = pluginHome(entry, cat, root)
  if (!home) throw new Error(`Le plugin « ${entry.name} » vient d’une source que Nuage ne sait pas lire (GitHub seulement).`)
  const found = []
  if (Array.isArray(entry.skills)) {
    for (const s of entry.skills.slice(0, 30)) found.push(...await githubSkills({ ...home, dir: joinDir(home.dir, s) }))
  } else {
    found.push(...await githubSkills({ ...home, dir: joinDir(home.dir, 'skills') }), ...await pluginCommands(entry.name, home))
  }
  if (!found.length) throw new Error(`Le plugin « ${entry.name} » n’a ni compétence (SKILL.md) ni commande : le reste (agents, serveurs, crochets) est propre à Claude Code.`)
  return markExisting(found)
}
// Les compétences d'un plugin d'un catalogue examiné (gardées : l'installation qui suit ne refait pas les demandes à GitHub)
async function pluginOf(result, plugin) {
  const entry = result.market.json.plugins?.find(p => p.name === plugin)
  if (!entry) throw new Error(plugin ? `Pas de plugin « ${plugin} » dans ce catalogue.` : 'Choisis un plugin du catalogue.')
  result.pluginCache ??= {}
  result.pluginCache[plugin] ??= await pluginSkills(entry, result.market.g, result.market.json.metadata?.pluginRoot)
  return result.pluginCache[plugin]
}

// ---------- Archive .zip ----------
// Windows 10+ a « tar » (bsdtar), qui sait ouvrir les .zip : aucune dépendance de plus
function run(exe, args, { timeout = 120_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, shell: false })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => child.kill(), timeout)
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, out: out.trim() })
    })
  })
}
function localSkills(root, depth = 0, found = []) {
  if (depth > 4 || found.length >= 30) return found
  const entries = fs.readdirSync(root, { withFileTypes: true })
  const md = entries.find(e => e.isFile() && /^skill\.md$/i.test(e.name))
  if (md) {
    const meta = frontmatter(fs.readFileSync(path.join(root, md.name), 'utf8'))
    found.push({ name: safeName(meta.name, path.basename(root)), description: meta.description, local: root })
    return found
  }
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) localSkills(path.join(root, e.name), depth + 1, found)
  return found
}
async function unzip(url) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-competence-'))
  const file = path.join(work, 'archive.zip')
  fs.writeFileSync(file, await download(url))
  const out = path.join(work, 'contenu')
  fs.mkdirSync(out)
  const r = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', out])
  if (r.code !== 0) throw new Error(`Archive illisible : ${r.out.slice(0, 200)}`)
  return out
}

// ---------- Examiner : ce qui serait ajouté ----------
const cache = new Map() // texte → examen (l'archive téléchargée sert à l'installation qui suit)
function markExisting(skills) {
  const installed = new Set(listSkills().map(s => s.name.toLowerCase()))
  for (const s of skills) s.exists = installed.has(s.name.toLowerCase())
  return skills
}
const skillsTitle = skills => (skills.length > 1 ? `${skills.length} compétences` : `Compétence « ${skills[0].name} »`)
async function examine(input) {
  const plan = parse(input)
  let result
  if (plan.type === 'plugin') {
    const source = catalogues()[plan.catalogue]
    if (!source) throw new Error(`Catalogue « ${plan.catalogue} » inconnu : colle d’abord son lien GitHub pour que Nuage le connaisse.`)
    const [owner, repo] = source.split('/')
    const market = await readMarket({ type: 'github', owner, repo, ref: '', dir: '' })
    if (!market) throw new Error(`Le catalogue « ${plan.catalogue} » (${source}) est introuvable sur GitHub.`)
    const skills = await pluginOf({ market }, plan.name)
    result = { kind: 'competences', title: `Plugin « ${plan.name} » : ${skillsTitle(skills).toLowerCase()}`, source: `github.com/${source}`, skills, plan }
  } else if (plan.type === 'github') {
    const source = `${plan.owner}/${plan.repo}`
    const market = !plan.dir ? await readMarket(plan) : null
    if (market) {
      const name = String(market.json.name || '')
      rememberCatalogue(name, source)
      result = {
        kind: 'catalogue', title: `Catalogue de plugins « ${name || source} »`, source: `github.com/${source}`, catalogue: name,
        plugins: (market.json.plugins || []).slice(0, 400).map(p => ({ name: String(p.name || ''), description: String(p.description || '').slice(0, 200) })).filter(p => p.name),
        market, plan,
      }
    } else {
      const skills = await githubSkills(plan)
      if (!skills.length) throw new Error(`Rien trouvé dans ${source}${plan.dir ? `/${plan.dir}` : ''} : ni compétence (SKILL.md), ni catalogue de plugins. Vérifie le nom (les compétences officielles sont dans anthropics/skills).`)
      result = { kind: 'competences', title: skillsTitle(skills), source: `github.com/${source}${plan.dir ? `/${plan.dir}` : ''}`, skills: markExisting(skills), plan }
    }
  } else if (plan.type === 'fichier') {
    const text = (await download(plan.url, 2e6)).toString('utf8')
    const meta = frontmatter(text)
    const name = safeName(meta.name, null)
    if (!name) throw new Error('Ce SKILL.md n’a pas de nom valide (« name: » dans son en-tête).')
    result = { kind: 'competences', title: `Compétence « ${name} »`, source: plan.url, skills: markExisting([{ name, description: meta.description, text }]), plan }
  } else {
    const root = await unzip(plan.url)
    const skills = localSkills(root).filter(s => s.name)
    if (!skills.length) throw new Error('Aucune compétence (SKILL.md) dans cette archive.')
    result = { kind: 'competences', title: skillsTitle(skills), source: plan.url, skills: markExisting(skills), plan }
  }
  cache.set(String(input).trim(), result)
  return result
}

// ---------- Installer (après l'accord de l'utilisateur) ----------
function writeInside(dir, rel, data) {
  const target = path.resolve(dir, rel)
  if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Chemin refusé dans la compétence : ${rel}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, data)
}
async function installSkill(skill, { replace, trash }) {
  const dir = path.join(skillsDir(), skill.name)
  if (fs.existsSync(dir)) {
    if (!replace) throw Object.assign(new Error(`La compétence « ${skill.name} » existe déjà.`), { code: 'existe' })
    await trash(dir)
  }
  fs.mkdirSync(dir, { recursive: true })
  if (skill.text !== undefined) {
    writeInside(dir, 'SKILL.md', skill.text)
  } else if (skill.local) {
    let n = 0
    const walk = (from, rel) => {
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue
        const relPath = path.join(rel, e.name)
        if (e.isDirectory()) walk(path.join(from, e.name), relPath)
        else if (e.isFile()) {
          if (++n > MAX_FILES) throw new Error('Trop de fichiers dans cette compétence.')
          writeInside(dir, relPath, fs.readFileSync(path.join(from, e.name)))
        }
      }
    }
    walk(skill.local, '')
  } else {
    let total = 0
    for (const f of await githubFiles(skill.g, skill.dir)) {
      total += f.size || 0
      if (total > MAX_BYTES) throw new Error('Compétence trop grosse.')
      writeInside(dir, f.rel, await download(f.url))
    }
  }
  return skill.name
}
async function install(input, { trash, plugin = '', replace = false } = {}) {
  const key = String(input).trim()
  const result = cache.get(key) || (await examine(key))
  const skills = result.kind === 'catalogue' ? await pluginOf(result, plugin) : result.skills
  // Rien n'est écrit si l'une d'elles existe déjà et que le remplacement n'a pas été accepté
  const clash = skills.find(s => fs.existsSync(path.join(skillsDir(), s.name)))
  if (clash && !replace) throw Object.assign(new Error(`La compétence « ${clash.name} » existe déjà.`), { code: 'existe' })
  const done = []
  for (const s of skills) done.push(await installSkill(s, { replace, trash }))
  if (result.kind !== 'catalogue') cache.delete(key)
  const what = done.length > 1 ? `Compétences ${done.map(n => `« ${n} »`).join(', ')} installées` : `Compétence « ${done[0]} » installée`
  return { message: `${what} : toutes les IA du chat de Nuage peuvent s’en servir.`, installed: done }
}

// ---------- Ce qui est installé ----------
function listSkills() {
  const root = skillsDir()
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    const file = path.join(root, e.name, 'SKILL.md')
    if (!fs.existsSync(file)) return null
    const meta = frontmatter(fs.readFileSync(file, 'utf8'))
    return { name: e.name, description: meta.description.slice(0, 160) }
  }).filter(Boolean)
}
async function remove(id, { trash }) {
  if (!NAME.test(id)) throw new Error('Nom de compétence invalide.')
  const dir = path.join(skillsDir(), id)
  if (!fs.existsSync(dir)) throw new Error('Compétence introuvable.')
  await trash(dir)
  return { message: `Compétence « ${id} » mise à la corbeille.` }
}

module.exports = { parse, frontmatter, examine, install, pluginOf, listSkills, remove, localSkills, installSkill, skillsDir, NAME }

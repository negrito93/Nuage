// Ce que l'IA connectée au chat (OpenRouter, OpenAI, Gemini, Claude par clé, Ollama, LM Studio) fait elle-même
// (07/10/2026 : « quand je suis connecté à un autre LLM, c'est lui qui doit agir, pas Claude ; déployé chez quelqu'un
// sans Claude, ça doit marcher »). Outils au format « function calling » d'OpenAI (chat.js les traduit pour Anthropic).
// Tout ce qui touche au PC passe par permit(outil, libellé, détail) : l'accord de l'utilisateur dans le chat (main.js).
// Lire une compétence installée (~/.nuage/competences, extensions.js) ne demande rien.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const extensions = require('./extensions')

const fn = (name, description, props, required = Object.keys(props)) => ({
  type: 'function',
  function: {
    name, description,
    parameters: { type: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: 'string', description: d }])), required },
  },
})
const TOOLS = [
  fn('utiliser_competence', 'Lit les consignes d’une compétence installée dans Nuage. À faire avant toute tâche qui correspond à sa description ; suis ensuite ces consignes.', { nom: 'Nom exact de la compétence' }),
  // Chemins relatifs au dossier personnel (full) : avec « chemin complet, ex. C:\Users\moi\… », un modèle gratuit
  // inventait C:\Users\moi\… puis fouillait le disque (audit OpenRouter du 08/10/2026)
  fn('lire_fichier', 'Lit un fichier texte du PC.', { chemin: 'Chemin du fichier, relatif au dossier personnel (ex. Documents\\notes.txt), ou complet si l’utilisateur l’a donné' }),
  fn('lister_dossier', 'Liste les fichiers et dossiers d’un dossier du PC.', { chemin: 'Chemin du dossier, relatif au dossier personnel (ex. Documents), ou complet si l’utilisateur l’a donné' }),
  fn('ecrire_fichier', 'Crée ou remplace un fichier texte sur le PC (l’ancienne version part à la corbeille). À préférer à une commande pour écrire un fichier.', { chemin: 'Chemin du fichier, relatif au dossier personnel (ex. Desktop\\liste.txt), ou complet si l’utilisateur l’a donné', contenu: 'Texte complet du fichier' }),
  fn('executer_commande', 'Lance une commande PowerShell sur le PC (Windows) et rend ce qu’elle affiche. Dossier de départ : le dossier personnel. Limite : 2 minutes.', { commande: 'Commande PowerShell' }),
  fn('lire_page_web', 'Lit le texte d’une page web.', { url: 'Adresse complète (https://…)' }),
  fn('installer_extension',
    'Ajoute à Nuage une compétence, ou les compétences d’un plugin. Source : lien GitHub (dépôt, dossier ou SKILL.md), « propriétaire/dépôt », lien vers un .zip ou un SKILL.md, ou « /plugin install nom@catalogue ». Sur un catalogue sans « plugin » : rend la liste de ses plugins.',
    { source: 'Lien, propriétaire/dépôt ou commande', plugin: 'Plugin à prendre dans le catalogue (facultatif)' }, ['source']),
]
const LIMIT = { lire: 200e3, sortie: 20e3, page: 40e3, liste: 300 }
const REFUSED = 'L’utilisateur a refusé cette action. Ne la relance pas : demande-lui ce qu’il préfère.'
const clipText = (s, max) => (s.length > max ? `${s.slice(0, max)}\n[… coupé : ${s.length - max} caractères de plus]` : s)
const full = p => path.resolve(os.homedir(), String(p || '').trim().replace(/^~(?=[\\/]|$)/, os.homedir()))
const inside = (dir, p) => {
  const rel = path.relative(dir, p)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}
const lower = s => s[0].toLowerCase() + s.slice(1)

function listFiles(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (out.length >= 80 || e.name.startsWith('.')) continue
    const r = path.join(rel, e.name)
    if (e.isDirectory()) listFiles(dir, r, out)
    else out.push(r)
  }
  return out
}
function readHead(file, max) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size))
    fs.readSync(fd, buf, 0, buf.length, 0)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}
// -EncodedCommand : la commande arrive intacte (guillemets, accents), sortie en UTF-8
function powershell(command, signal) {
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n${command}`
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: os.homedir(), windowsHide: true })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const stop = () => child.kill()
    const timer = setTimeout(stop, 120_000)
    signal?.addEventListener('abort', stop, { once: true })
    const done = text => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve(text)
    }
    child.on('error', error => done(`Erreur : ${error.message}`))
    child.on('close', code => done(`(code de sortie ${code})\n${clipText(out.trim(), LIMIT.sortie) || '(rien affiché)'}`))
  })
}
async function pageText(url, signal) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Nuage', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
  })
  const type = (res.headers.get('content-type') || '').split(';')[0]
  if (type && !/text|json|xml|javascript/i.test(type)) return `(HTTP ${res.status}) Contenu non textuel (${type}).`
  const raw = await res.text()
  const text = /html/i.test(type)
    ? raw.replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, '\'').replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : raw
  return `(HTTP ${res.status}${type ? `, ${type}` : ''}, ${res.url})\n${clipText(text, LIMIT.page)}`
}

// Exécute un appel d'outil ; rend toujours un texte pour l'IA (résultat, refus ou erreur).
// ctx : { permit(outil, libellé, détail) → booléen, trash(chemin), signal, onTool(libellé affiché dans le chat) }
async function run(name, rawArgs, { permit, trash, signal, onTool = () => {} }) {
  let a
  try {
    a = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : { ...rawArgs }
  } catch {
    return 'Erreur : arguments illisibles (un objet JSON est attendu).'
  }
  const ask = (label, detail = '') => permit(name, label, detail)
  try {
    if (name === 'utiliser_competence') {
      const nom = String(a.nom || '').trim()
      const file = extensions.NAME.test(nom) ? path.join(extensions.skillsDir(), nom, 'SKILL.md') : ''
      if (!file || !fs.existsSync(file)) return `Compétence « ${nom} » introuvable. Installées : ${extensions.listSkills().map(s => s.name).join(', ') || 'aucune'}.`
      onTool(`Lit la compétence « ${nom} »`)
      const dir = path.dirname(file)
      const others = listFiles(dir).filter(f => f !== 'SKILL.md')
      return `${clipText(fs.readFileSync(file, 'utf8'), LIMIT.lire)}\n\n---\nDossier de la compétence : ${dir}${others.length ? `\nSes autres fichiers (lire_fichier avec le chemin complet si les consignes en parlent) :\n${others.join('\n')}` : ''}`
    }
    if (name === 'lire_fichier') {
      const p = full(a.chemin)
      if (!inside(extensions.skillsDir(), p) && !(await ask(`Lire « ${p} »`))) return REFUSED
      onTool(`Lit ${path.basename(p)}`)
      const size = fs.statSync(p).size
      const buf = readHead(p, LIMIT.lire)
      if (buf.includes(0)) return `Fichier binaire (${size} octets) : il ne se lit pas comme du texte.`
      return `${buf.toString('utf8')}${size > buf.length ? `\n[… coupé : ${size - buf.length} octets de plus]` : ''}`
    }
    if (name === 'lister_dossier') {
      const p = full(a.chemin)
      if (!(await ask(`Voir le contenu du dossier « ${p} »`))) return REFUSED
      onTool(`Regarde ${p}`)
      const entries = fs.readdirSync(p, { withFileTypes: true })
      const lines = entries.slice(0, LIMIT.liste).map(e => {
        if (e.isDirectory()) return `[dossier] ${e.name}`
        try {
          return `${e.name} (${Math.ceil(fs.statSync(path.join(p, e.name)).size / 1024)} Ko)`
        } catch {
          return e.name
        }
      })
      return `${p} : ${entries.length} élément(s)\n${lines.join('\n')}${entries.length > LIMIT.liste ? '\n[… liste coupée]' : ''}`
    }
    if (name === 'ecrire_fichier') {
      const p = full(a.chemin)
      const contenu = String(a.contenu ?? '')
      const exists = fs.existsSync(p)
      if (!(await ask(`${exists ? 'Remplacer' : 'Créer'} « ${p} »`, clipText(contenu, 600)))) return REFUSED
      onTool(`Écrit ${path.basename(p)}`)
      if (exists && trash) await trash(p) // l'ancienne version reste récupérable
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, contenu, 'utf8')
      return `Fichier ${exists ? 'remplacé' : 'créé'} : ${p} (${Buffer.byteLength(contenu)} octets).`
    }
    if (name === 'executer_commande') {
      const commande = String(a.commande || '').trim()
      if (!commande) return 'Erreur : commande vide.'
      if (!(await ask('Lancer une commande PowerShell', commande))) return REFUSED
      onTool(`Lance : ${commande.split('\n')[0].slice(0, 70)}`)
      return await powershell(commande, signal)
    }
    if (name === 'lire_page_web') {
      const u = new URL(String(a.url || ''))
      if (!['https:', 'http:'].includes(u.protocol)) return 'Erreur : seules les adresses http(s) se lisent.'
      if (!(await ask(`Lire la page ${u.hostname}`, u.href))) return REFUSED
      onTool(`Lit ${u.hostname}`)
      return await pageText(u.href, signal)
    }
    if (name === 'installer_extension') {
      const source = String(a.source || '').trim()
      const plugin = String(a.plugin || '').trim()
      const r = await extensions.examine(source)
      if (r.kind === 'catalogue' && !plugin) {
        return `Catalogue « ${r.catalogue || r.source} » (${r.plugins.length} plugins). Rappelle installer_extension avec la même source et « plugin » :\n${r.plugins.slice(0, 150).map(p => `- ${p.name} : ${p.description}`).join('\n')}`
      }
      const skills = r.kind === 'catalogue' ? await extensions.pluginOf(r, plugin) : r.skills
      const what = r.kind === 'catalogue' ? `le plugin « ${plugin} »` : lower(r.title)
      const detail = `Source : ${r.source}\n${skills.map(s => `• ${s.name}${s.exists ? ' (remplace celle déjà installée)' : ''}`).join('\n')}`
      if (!(await ask(`Ajouter à Nuage ${what}`, detail))) return REFUSED
      onTool(`Installe ${what}`)
      const out = await extensions.install(source, { plugin, replace: true, trash })
      return `${out.message} Pour t’en servir : utiliser_competence avec ${out.installed.map(n => `« ${n} »`).join(', ')}.`
    }
    return `Outil inconnu : ${name}.`
  } catch (error) {
    return `Erreur : ${error.message}`
  }
}

// « Toujours » (accord dans le chat) ne vaut que pour la même action : même commande, même fichier, même dossier, même
// site (09/10/2026 : « Toujours » sur une commande en autorisait toutes les suivantes, et Gemini a enchaîné
// 60 commandes jusqu'à lire l'historique de Chrome). Le libellé contient déjà le chemin ou le site ; pas la commande.
const alwaysKey = (tool, label, command) => `${tool}\n${label}${tool === 'executer_commande' ? `\n${command}` : ''}`

module.exports = { TOOLS, run, REFUSED, alwaysKey }

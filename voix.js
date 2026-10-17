// Voix de Nuage sur le PC (05/10/2026) : « Hey Nuage », puis la question ou une commande.
// - voix.ps1 écoute, hors ligne (reconnaissance vocale de Windows, français) : rien n'est enregistré ni
//   envoyé sur Internet. Il renvoie des lignes JSON : pret, reveil, partiel, phrase, silence, erreur, fin.
// - understand(texte) : les commandes de Nuage (ouvrir le chat, faire sonner le téléphone, météo…) ;
//   le reste est une question pour Claude (le chat de Nuage, avec ton abonnement).
// Test : node outils/test-voix.js (commandes, et voix.ps1 sur des phrases dites par Windows, sans micro).
const { spawn } = require('node:child_process')

const normalize = text => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`-]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// Ce que veut dire une phrase : { action, texte }
function understand(text) {
  const t = normalize(text)
  const words = t ? t.split(' ').length : 0
  const phone = /(telephone|portable|mobile|smartphone)/
  if (!t) return { action: 'rien' }
  if (/^(rien|annule|laisse tomber|non merci|non rien|c est bon|oublie)\b/.test(t)) return { action: 'rien' }
  if (/(arrete|coupe|desactive|stop).*(ecout|micro)/.test(t)) return { action: 'stop-ecoute' }
  if (/^(tais toi|chut|silence|stop)\b|arrete de parler/.test(t)) return { action: 'taire' }
  if (/(ferme|cache|replie|range).*(chat|barre|discussion)/.test(t)) return { action: 'fermer-chat' }
  if (/(ouvre|affiche|montre|lance).*(chat|discussion|conversation)/.test(t)) return { action: 'chat' }
  if (/(menu|gere|gerer|reglages?).*(telephone|portable)/.test(t)) return { action: 'menu-telephone' }
  if (/(envoie|envoyer|passe|transfere|copie).*(presse papiers?|ce que j ai copie|copie).*/.test(t) && phone.test(t)) return { action: 'presse-papiers' }
  if ((/sonner/.test(t) && phone.test(t)) || /(ou est|retrouve|cherche) (mon|le) (telephone|portable)/.test(t)) return { action: 'sonner' }
  if (/nouvelle session/.test(t)) return { action: 'nouvelle-session' }
  if (/claude/.test(t) && /(fini|termine|travaille|en est|avance|occupe|fait quoi)/.test(t)) return { action: 'claude-etat' }
  // Météo d'aujourd'hui : Nuage la connaît ; demain, la semaine… c'est une question pour Claude
  if (/(meteo|quel temps|temperature|il fait (chaud|froid|beau)|va t il pleuvoir)/.test(t) && !/(demain|semaine|week end|ce soir|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi)/.test(t)) return { action: 'meteo' }
  if (/(quelle heure|l heure qu il est|heure est il)/.test(t)) return { action: 'heure' }
  if (/^(cache toi|va t en|disparais|masque toi)/.test(t)) return { action: 'cacher' }
  if (/^(montre toi|reviens|apparais)/.test(t)) return { action: 'montrer' }
  if (/^merci\b/.test(t) && words <= 4) return { action: 'merci' }
  return { action: 'question', texte: String(text).trim() }
}

// Lisible à voix haute : sans code, sans lignes d'outils, sans liens ni symboles, 700 caractères au plus
function speakable(text) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' Le code est dans le chat. ')
    .replace(/^⚙.*$/gm, '')
    .replace(/https?:\/\/\S+/g, 'un lien')
    .replace(/[*_#`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > 700) {
    const cut = t.slice(0, 700)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    t = `${end > 200 ? cut.slice(0, end + 1) : cut}… La suite est dans le chat.`
  }
  return t
}

// Le programme d'écoute (voix.ps1), relancé s'il s'arrête (au plus 5 fois de suite)
function createVoice({ script, onEvent = () => {}, log = () => {} }) {
  let child = null
  let wanted = false
  let restarts = 0
  let restartTimer = null
  function start() {
    wanted = true
    if (child) return
    clearTimeout(restartTimer)
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child = proc
    let buffer = ''
    let fatal = false
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (!line) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'pret') restarts = 0
          if (event.type === 'erreur') fatal = true // micro absent, langue absente : pas de relance en boucle
          onEvent(event)
        } catch {
          log('voix.ps1, ligne illisible :', line)
        }
      }
    })
    proc.stderr.on('data', data => log('voix.ps1 :', String(data).trim()))
    proc.stdin.on('error', () => {})
    proc.on('error', error => {
      log('voix.ps1, lancement impossible :', error.message)
      if (child === proc) child = null
    })
    proc.on('exit', code => {
      if (child === proc) child = null
      onEvent({ type: 'arret', code })
      if (!wanted || fatal || restarts >= 5) return
      restarts += 1
      restartTimer = setTimeout(start, 3000 * restarts)
    })
  }
  function send(command) {
    if (child && !child.stdin.destroyed) child.stdin.write(`${command}\n`)
  }
  function stop() {
    wanted = false
    clearTimeout(restartTimer)
    const proc = child
    if (!proc) return
    send('stop')
    setTimeout(() => proc.exitCode === null && proc.kill(), 2000)
  }
  return {
    start,
    stop,
    listen: () => send('ecoute'), // question tout de suite (raccourci clavier)
    pause: () => send('pause'), // pendant que Nuage parle : il ne s'entend pas lui-même
    resume: () => send('reprendre'),
    running: () => Boolean(child),
  }
}

module.exports = { createVoice, understand, speakable, normalize }

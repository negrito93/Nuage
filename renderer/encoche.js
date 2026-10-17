// Encoche : îlot noir (collé en haut de l'écran ou posé n'importe où) avec le chat (Claude,
// OpenAI, Gemini, Ollama, LM Studio), ce que font les agents (Claude Code), leurs demandes
// d'autorisation et questions, les limites d'utilisation, les intégrations et le téléphone.
// Refonte du 06/10/2026 : mise en page, couleurs et mouvements repris de Coucou (Louis-CFM, code sous
// licence MIT : docs/SPEC.md, design/captures, windows/src) : au survol seule la pilule sort (Nuage à gauche,
// la grille des pastilles actives à droite) ; un clic ouvre le panneau ; l'Accueil montre la session suivie
// (défilé de ses étapes) et des pastilles (autres sessions, téléphone, intégrations) avec des mini-Nuages
// colorés ; autorisation, question, fin de session et « trop de clics » ont chacune leur carte. Un seul
// Nuage glisse d'une vue à l'autre. Le personnage, ses sons et ses dessins restent ceux de Nuage.
import { play, setSounds } from './sons.js'
import { icon } from './icones.js'
import { createSkin } from './peau.js'
import { createReglages } from './reglages.js'

const api = window.encoche
const chatApi = api.chat
const $ = id => document.getElementById(id)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const pick = list => list[Math.floor(Math.random() * list.length)]
const time = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
function ago(ms) {
  if (!ms) return ''
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`
  return `il y a ${Math.round(s / 3600)} h`
}
function button(className, text, onClick, type = 'button') {
  const b = el('button', className, text)
  b.type = type
  if (onClick) b.addEventListener('click', onClick)
  return b
}
// Mini-Nuage coloré (pastilles, grille de la pilule) : la forme est dans encoche.html (<symbol id="mini">)
const SVG = 'http://www.w3.org/2000/svg'
function miniNuage(color) {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 32 22')
  svg.setAttribute('class', 'mini')
  const use = document.createElementNS(SVG, 'use')
  use.setAttribute('href', '#mini')
  svg.append(use)
  svg.style.setProperty('--c', color)
  svg.style.setProperty('--vie', `-${(Math.random() * 5).toFixed(2)}s`) // chacun respire et cligne à son rythme
  return svg
}
const colored = (node, color) => {
  node.style.setProperty('--c', color)
  return node
}
// Couleur fixe d'une session (comme les agents de Coucou), d'une intégration, du téléphone
const PALETTE = ['#ff6b5b', '#2dd4a7', '#f7b32b', '#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#e879f9']
function colorFor(key) {
  let h = 0
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const INTEG_COLOR = { github: '#f4505e', vercel: '#8b7cff', stripe: '#3b82f6', n8n: '#fb923c', resend: '#2dd4a7', notion: '#c0c4cc', calcom: '#c9956a' }
const STATE_COLOR = { 'en-cours': '#3b9eff', attente: '#f5a524', permission: '#f5a524', termine: '#34d399', inactif: '#6b7079' }

let agents = { sessions: [], permissions: [], usage: null, active: 0, permissionsInNuage: true }
let integrations = []
let settings = { autoHide: true, soundsOn: true, volume: 0.5 }
let chat = { providers: [], provider: 'claudecode', model: '', messages: [], attachments: [], streaming: false }
let models = [] // modèles du fournisseur choisi
let place = { anchorX: innerWidth / 2, up: false, docked: true } // où est posé l'îlot (envoyé par le processus principal)
let state = 'barre' // cache (rentré dans le bord) | barre (petite pilule) | ouvert (panneau)
let hovering = false // souris sur l'îlot (lu par le processus principal)
let dragging = false // fichier glissé au-dessus de l'îlot
let gulping = false // Nuage avale le fichier lâché : la zone de dépôt reste affichée le temps de l'animation
let picking = false // fenêtre « Ouvrir » de Windows affichée (📎)
let hint = false // Nuage glissé vers la barre
let unread = false // réponse arrivée pendant que tu regardais ailleurs
let peeked = false // pilule sortie seulement parce que la souris est passée sur le trait
let holdUntil = 0 // ouvert sur commande : reste ouvert un moment même sans la souris
let closeAt = 0
let celebrateUntil = 0
let calmSince = Date.now()
let lastActivity = Date.now()
let tab = 'chat'
let diffView = null
let selectedSession = null
let homeDetail = null // carte de gauche de l'Accueil : null (session), 'plan' (limites) ou 'integ:<id>'
let renderedMessages = 0
let voice = { etat: 'repos', texte: '', on: false, wanted: false } // « Hey Nuage » (voir plus bas)
let chargeFlash = { until: 0, text: '' } // téléphone branché à l'instant : la pilule le dit
// Nuage habite l'encoche (06/10/2026) : la pilule ne rentre plus dans le bord, son petit portrait vit à gauche ;
// ses bulles s'affichent dans la pilule (toast)
let homeMode = false
let buddyAvatar = null // Nuage dans la pilule (startBuddy)
let buddySkin = null
let compact = false // pilule réduite : rien à lire
let toast = null // bulle de Nuage dans la pilule : { text, icon, until, action (numéro ou fonction), lines, w }
let pillWeather = null
let phone = { devices: [], history: [], transfers: [], ringing: false, linkOn: false, clipboardShare: 'auto', notifyClaude: true, notifyDownloads: true, apk: true }
let phoneQr = null // QR code affiché dans le menu Téléphone : { mode: 'associer' | 'installer', svg }
// Cartes d'alerte (comme les vues approval / question / finished / confused de Coucou)
let finished = null // { sessionId, title, summary, color, until }
let confusedUntil = 0
const prevStatus = new Map() // statut d'avant de chaque session (pour voir « terminé »)
let firstAgents = true
const questionDraft = new Map() // réponses en cours d'une question à plusieurs volets : id → { index, answers }
const knownRequests = new Set()

// ---------- Mouvement de l'îlot : ressort à l'ouverture, courbe de 340 ms à la fermeture ----------
// Mêmes réglages que Coucou (ressort de 0,5 s, amortissement 0,72 ; courbe .45,0,.2,1).
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  return x => {
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 14; i++) {
      if (at(t, x1, x2) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return at(t, y1, y2)
  }
}
const closeCurve = bezier(0.45, 0, 0.2, 1)
class Motion {
  constructor(value) {
    this.value = value
    this.target = value
    this.velocity = 0
    this.mode = 'idle'
  }
  springTo(target) {
    this.target = target
    this.mode = 'spring'
  }
  curveTo(target, ms = 340) {
    this.from = this.value
    this.target = target
    this.start = performance.now()
    this.ms = ms
    this.velocity = 0
    this.mode = 'curve'
  }
  jump(value) {
    this.value = value
    this.target = value
    this.velocity = 0
    this.mode = 'idle'
  }
  step(dt, now) {
    if (this.mode === 'spring') {
      const omega = (2 * Math.PI) / 0.5
      const zeta = 0.72
      const steps = Math.max(1, Math.ceil(dt * 240))
      const h = dt / steps
      for (let i = 0; i < steps; i++) {
        const acc = omega * omega * (this.target - this.value) - 2 * zeta * omega * this.velocity
        this.velocity += acc * h
        this.value += this.velocity * h
      }
      if (Math.abs(this.target - this.value) < 0.05 && Math.abs(this.velocity) < 0.5) this.jump(this.target)
    } else if (this.mode === 'curve') {
      const p = Math.min(1, (now - this.start) / this.ms)
      this.value = this.from + (this.target - this.from) * closeCurve(p)
      if (p >= 1) this.jump(this.target)
    }
  }
}

const OPEN_W = 600
const PILL = { w: 300, h: 32 } // pilule avec un texte (voix, Nuage glissé, réponse arrivée)
const PILL_SMALL = { w: 190, h: 32 } // pilule au calme : Nuage à gauche, pastilles ou météo à droite
const TOAST_MAX_W = 470
const toastOn = () => Boolean(toast && Date.now() < toast.until)
function pillSize() {
  if (toastOn()) return { w: toast.w, h: PILL.h + (toast.lines - 1) * 17 }
  return { w: compact ? PILL_SMALL.w : PILL.w, h: PILL.h }
}
const WAKE = { w: 240, h: 8 } // zone du trait (îlot rentré) qui fait sortir la pilule au survol
const islandEl = $('island')
const width = new Motion(PILL.w)
const height = new Motion(PILL.h)
const radius = new Motion(14)
let running = false
let lastFrame = 0
let sentRect = ''

// Hauteur du panneau selon la vue (Coucou : 196 l'accueil, ~200 une alerte, le chat grandit avec la conversation)
function openHeight() {
  if (dragging || gulping) return 176
  const view = document.body.dataset.view
  let h
  if (view === 'alert') h = 34 + 10 + Math.max(150, ($('alert-card').firstElementChild?.offsetHeight || 140) + 12)
  else if (view === 'diff') h = diffView?.tall ? 400 : 360
  else if (view === 'phone') h = Math.max(196, 44 + $('telephone').scrollHeight)
  else if (view === 'reglages') h = 400 // beaucoup de réglages : la vue défile
  else if (view === 'home') h = 236 // assez haut pour que les trois boutons passent sous les fichiers
  else {
    const extra = (chat.attachments.length ? 30 : 0) + ($('keyhint').hidden ? 0 : 40) + (chat.permission ? 110 : 0)
    h = Math.min(chat.permission ? 400 : 340, 196 + 34 * Math.min(chat.messages.length, 3) + extra)
    if (!$('model-menu').hidden) h = Math.max(h, 320)
  }
  if (nuageInside) h = Math.max(h, 216)
  return Math.min(400, h)
}
function targetSize() {
  if (state === 'cache') return { w: 200, h: 0, r: 14 }
  if (state === 'barre') {
    const p = pillSize()
    return { w: p.w, h: p.h, r: place.docked ? 14 : 16 }
  }
  return { w: OPEN_W, h: openHeight(), r: 22 }
}
function animateTo() {
  const t = targetSize()
  const shrinking = t.w * t.h < width.value * height.value - 1
  for (const [motion, value] of [[width, t.w], [height, t.h], [radius, t.r]]) {
    if (reduceMotion) motion.jump(value)
    else if (shrinking) motion.curveTo(value)
    else motion.springTo(value)
  }
  if (!running) {
    running = true
    lastFrame = performance.now()
    requestAnimationFrame(frame)
  }
}
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now
  for (const motion of [width, height, radius]) motion.step(dt, now)
  draw()
  if ([width, height, radius].some(m => m.mode !== 'idle')) requestAnimationFrame(frame)
  else {
    running = false
    markOverflow()
  }
}
// Fondu en bas des listes quand il reste du contenu à faire défiler
function markOverflow() {
  for (const box of document.querySelectorAll('.scroll')) box.classList.toggle('more', box.scrollHeight - box.scrollTop - box.clientHeight > 4)
}
document.addEventListener('scroll', markOverflow, true)
function draw() {
  const w = Math.max(0, width.value)
  const h = Math.max(0, height.value)
  const r = Math.max(0, Math.min(radius.value, h / 2 + 2))
  // Centré sur la pilule, sans sortir de la fenêtre ; vers le haut s'il n'y a pas la place dessous
  const cx = Math.min(Math.max(place.anchorX, w / 2 + 6), innerWidth - w / 2 - 6)
  const x = cx - w / 2
  const y = place.up ? innerHeight - h : 0
  islandEl.style.left = `${x}px`
  islandEl.style.top = `${y}px`
  islandEl.style.width = `${w}px`
  islandEl.style.height = `${h}px`
  islandEl.style.borderRadius = place.docked ? `0 0 ${r}px ${r}px` : `${r}px`
  $('wake').style.left = `${place.anchorX}px`
  // Zone qui prend la souris : l'îlot, ou le trait quand il est rentré dans le bord
  const rect = h < WAKE.h
    ? { x: place.anchorX - WAKE.w / 2, y: 0, w: WAKE.w, h: WAKE.h }
    : { x, y, w, h }
  const key = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`
  if (key !== sentRect) {
    sentRect = key
    api.setRect(rect)
  }
}
function applyPlace(next) {
  if (!next) return
  place = next
  document.body.classList.toggle('floating', !place.docked)
  document.body.classList.toggle('up', place.up)
  if (!place.docked && state === 'cache') setState('barre')
  animateTo()
  draw()
}
api.onPlace(applyPlace)

// ---------- États : rentré, pilule (survol), ouvert (clic) ----------
// Demandes en attente : celles de Claude Code (hooks) et celle de la session reprise dans le chat
const hasRequests = () => agents.permissions.length > 0 || Boolean(chat.permission)
// Champ du chat (ou d'une question) en cours d'utilisation, fenêtre active
const typing = () => document.hasFocus() && Boolean(document.activeElement?.matches('textarea, input[type="text"]'))
// Nuage dans l'encoche : seul ce qui travaille vraiment la retient ; une session qui attend ta réponse ou une réponse
// pas lue ne l'empêchent pas de rentrer au bout de 2 min (elles la gardaient sortie jusqu'à 12 h)
const working = () => hasRequests() || chat.streaming || agents.sessions.some(s => s.status === 'en-cours') || ['ecoute', 'compris', 'parle', 'reflechit'].includes(voice.etat)
const busy = () => working() || (!homeMode && (agents.active > 0 || unread))
function setState(next) {
  if (next === state) return
  // Fermer la barre avec Nuage dedans : il saute d'abord dehors
  if (state === 'ouvert' && nuageInside && !homeMode) {
    nuageExit(() => setState(next))
    return
  }
  state = next
  calmSince = Date.now() // refermée ou ressortie : la pilule attend son délai complet avant de rentrer
  document.body.dataset.mode = state
  api.setMode(state)
  if (homeMode && !nuageInside) homeAvatar(state === 'ouvert')
  if (state === 'ouvert') {
    peeked = false
    if (tab === 'chat' && unread) {
      unread = false
      renderBar()
    }
    renderToastLine()
    requestAnimationFrame(scrollMessages)
  } else {
    closeMenu()
  }
  animateTo()
}
// Nuage habite l'encoche : elle rentre dans le bord après 2 min sans aucune action (demande du 08/10/2026)
const HOME_IDLE_MS = 120_000
function evaluate() {
  const now = Date.now()
  renderMood()
  // Fin d'une alerte passagère (session terminée, « trop de clics ») : la vue d'avant revient
  if ((finished && now >= finished.until) || (confusedUntil && now >= confusedUntil)) {
    const wasFinished = Boolean(finished && now >= finished.until)
    if (wasFinished) finished = null
    if (confusedUntil && now >= confusedUntil) confusedUntil = 0
    renderAlert()
    renderBar()
    if (wasFinished && state === 'ouvert' && !hasRequests() && now >= holdUntil - 1 && !typing()) holdUntil = 0
  }
  // Demande de Claude Code, fichier glissé, fenêtre « Ouvrir » : toujours ouvert
  if (hasRequests() || dragging || picking || gulping) {
    closeAt = 0
    setState('ouvert')
    return
  }
  if (state === 'ouvert') {
    // Champ du chat resté actif mais plus rien depuis 2 min : elle rentre quand même
    if (homeMode && !hovering && !busy() && now >= holdUntil && now - lastActivity > HOME_IDLE_MS) {
      closeAt = 0
      setState('cache')
      return
    }
    // Nuage vit dans la barre : elle reste ouverte jusqu'à ce que tu la fermes
    if (nuageInside || hovering || typing() || now < holdUntil || moving) {
      closeAt = 0
      return
    }
    if (!closeAt) closeAt = now + 4000
    if (now >= closeAt) {
      closeAt = 0
      setState('barre')
    }
    return
  }
  // Le survol ne fait que sortir la pilule : seul un clic ouvre le panneau
  if (hint || hovering || busy() || !settings.autoHide || !place.docked || moving) {
    calmSince = now
    if (state === 'cache') {
      peeked = hovering && !hint && !busy()
      setState('barre')
    }
    return
  }
  if (state === 'barre' && now - calmSince > (peeked ? 2500 : homeMode ? HOME_IDLE_MS : 30_000)) setState('cache')
}
setInterval(evaluate, 400)

function openPanel(hold = 0) {
  holdUntil = hold ? Date.now() + hold : 0
  closeAt = 0
  if (state !== 'ouvert') play('pop')
  setState('ouvert')
  if (tab === 'chat' && !currentAlert()) setTimeout(() => $('input').focus(), 30)
}
function fold() {
  holdUntil = 0
  closeAt = 0
  document.activeElement?.blur?.()
  setState('barre')
}

// Clic sur la pilule : ouvre. Attraper la pilule (ou l'en-tête du panneau) et glisser : déplace l'îlot.
let press = null
let moving = false
islandEl.addEventListener('pointerdown', e => {
  if (e.button !== 0) return
  if (state === 'ouvert' && !e.target.closest('.head')) return
  if (e.target.closest('button, input, textarea, a, .menu')) return
  press = { x: e.screenX, y: e.screenY, moved: false }
  try {
    islandEl.setPointerCapture(e.pointerId)
  } catch {
    // pointeur simulé (auto-test) : pas de capture, le clic fonctionne quand même
  }
})
islandEl.addEventListener('pointermove', e => {
  if (!press || press.moved) return
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < 5) return
  press.moved = true
  moving = true
  document.body.classList.add('moving')
  api.dragStart()
})
function endPress() {
  if (!press) return
  const wasMoved = press.moved
  press = null
  if (wasMoved) {
    moving = false
    document.body.classList.remove('moving')
    api.dragEnd()
  } else if (state !== 'ouvert') {
    if (toastOn() && toast.action) runToastAction()
    else openPanel()
  }
}
islandEl.addEventListener('pointerup', endPress)
islandEl.addEventListener('lostpointercapture', endPress)

api.onHover(inside => {
  hovering = Boolean(inside)
  lastActivity = Date.now() // la souris qui sort compte aussi : le délai de 2 min repart de là
  if (hovering) closeAt = 0
  evaluate()
})
// Clic ailleurs : le panneau se replie (sauf si Nuage y vit)
addEventListener('blur', () => {
  holdUntil = 0
  if (state === 'ouvert' && !nuageInside && !hovering && !picking && !hasRequests()) setState('barre')
})
addEventListener('focus', evaluate)
addEventListener('keydown', e => {
  lastActivity = Date.now()
  // Autorisation affichée : Y autorise, N refuse (comme Coucou), sauf pendant une saisie
  const a = currentAlert()
  if (a?.kind === 'approval' && !e.target.closest?.('textarea, input') && !e.ctrlKey && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'y' || key === 'n') {
      e.preventDefault()
      answer(a.req, key === 'y' ? 'allow' : 'deny')
      return
    }
  }
  if (e.key !== 'Escape') return
  if (!$('model-menu').hidden) closeMenu()
  else if (homeDetail && tab === 'agents') {
    homeDetail = null
    renderHome()
  } else fold()
})
// Roue dentée : les Réglages (tous dans la barre) ; un deuxième clic revient où on était
$('cnx-btn').addEventListener('click', () => (tab === 'reglages' ? showTab(beforeSettings) : openReglages()))
$('sound-btn').addEventListener('click', () => api.setSounds(!settings.soundsOn))
$('usage-head').addEventListener('click', () => {
  homeDetail = homeDetail === 'plan' && tab === 'agents' ? null : 'plan'
  showTab('agents')
  api.refreshUsage()
})
// ＋ : nouvelle session Claude Code (dans le dossier de la dernière session, ou un autre)
async function startNewSession(chooseFolder = false) {
  showTab('chat')
  closeMenu()
  if (chooseFolder) {
    picking = true // la fenêtre de choix du dossier ne doit pas refermer l'îlot
    evaluate()
  }
  try {
    await chatApi.newSession(chooseFolder)
  } finally {
    if (chooseFolder) {
      picking = false
      holdUntil = Math.max(holdUntil, Date.now() + 15_000)
      api.focus()
    }
    $('input').focus()
    evaluate()
  }
}
$('new-chat').addEventListener('click', () => startNewSession(false))

// ---------- Nuage dans la barre ----------
let avatarLib = null
let nuageAvatar = null
let nuageInside = false
let exiting = false
let moodNow = ''
let moodTemp = ''
let moodUntil = 0
function insideMood() {
  if (Date.now() < moodUntil) return moodTemp
  if (Date.now() < confusedUntil) return 'confused'
  if (hasRequests()) return 'curious'
  if (chat.streaming) return chat.messages.at(-1)?.text ? 'working' : 'thinking'
  if (finished || Date.now() < celebrateUntil) return chat.messages.at(-1)?.error ? 'confused' : 'happy'
  if (typing() && $('input').value.trim()) return 'listening'
  if (agents.sessions.some(s => s.status === 'en-cours')) return 'working'
  if (Date.now() - lastActivity > 120_000) return 'drowsy'
  return 'idle'
}
function renderMood() {
  if (!nuageAvatar && !buddyAvatar) return
  const mood = insideMood()
  if (mood === moodNow) return
  moodNow = mood
  nuageAvatar?.play(mood)
  buddyAvatar?.play(mood)
}

// ---------- Nuage dans la pilule (07/10/2026) ----------
// Le même avatar que sur le bureau, petit, à gauche de la pilule, avec sa peau (peau.js : la couleur du temps qu'il
// fait, les gouttes, le soleil qui le chauffe) ; la température est écrite à droite de la pilule. Créé une fois.
async function startBuddy() {
  if (buddyAvatar) return
  try {
    avatarLib ||= await import('./vendor/avatar-web.js')
    if (buddyAvatar) return
    const holder = $('buddy-avatar')
    buddyAvatar = avatarLib.createAvatar(holder, {
      definition: structuredClone(window.NUAGE_AVATAR), defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage',
    })
    buddySkin = createSkin({ defs: $('skin-defs'), reduceMotion })
    buddySkin.setLabel(false)
    buddySkin.attach(holder.querySelector('svg'))
    buddySkin.setWeather(pillWeather)
    moodNow = ''
    renderMood()
  } catch (error) {
    console.error('Nuage dans la pilule :', error)
  }
}
function tempMood(key, ms) {
  moodTemp = key
  moodUntil = Date.now() + ms
  renderMood()
  setTimeout(renderMood, ms + 30)
}
function squash() {
  islandEl.classList.remove('squash')
  void islandEl.offsetWidth
  islandEl.classList.add('squash')
  setTimeout(() => islandEl.classList.remove('squash'), 600)
}
// Bouffées de nuage sous Nuage : elles s'écartent sur les côtés, comme quand on se pose sur un nuage
function sparkle(count = 10) {
  if (reduceMotion) return
  const box = $('sparkles')
  const bot = $('bot').getBoundingClientRect()
  const deck = $('deck').getBoundingClientRect()
  const cx = bot.left - deck.left + bot.width / 2
  const cy = bot.top - deck.top + bot.height * 0.78
  for (let i = 0; i < count; i++) {
    const puff = el('i', 'puff')
    const side = i % 2 ? 1 : -1
    const dist = 18 + Math.random() * 46
    puff.style.left = `${cx + side * Math.random() * 10}px`
    puff.style.top = `${cy}px`
    puff.style.setProperty('--s', `${10 + Math.random() * 16}px`)
    puff.style.setProperty('--dx', `${side * dist}px`)
    puff.style.setProperty('--dy', `${-4 - Math.random() * 16}px`)
    puff.style.animationDelay = `${Math.random() * 0.12}s`
    box.append(puff)
    setTimeout(() => puff.remove(), 1200)
  }
}
async function nuageEnter() {
  nuageInside = true
  lastActivity = Date.now()
  document.body.classList.add('nuage-in')
  const holder = $('bot-avatar')
  try {
    avatarLib ||= await import('./vendor/avatar-web.js')
    if (!nuageAvatar) {
      nuageAvatar = avatarLib.createAvatar(holder, {
        definition: structuredClone(window.NUAGE_AVATAR), defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage',
      })
    }
  } catch (error) {
    console.error('Nuage dans la barre :', error)
  }
  holder.classList.remove('leaving', 'entering')
  void holder.offsetWidth
  holder.classList.add('entering')
  setTimeout(() => holder.classList.remove('entering'), 950)
  // Le moment fort : il se pose (vers 40 % de son arrivée), la barre l'encaisse, le nuage s'écarte
  setTimeout(() => {
    squash()
    sparkle(12)
  }, 380)
  moodNow = ''
  tempMood('surprised', 520)
  setTimeout(() => tempMood('excited', 1600), 540)
  play('etincelle')
  animateTo()
}
function nuageExit(then) {
  if (!nuageInside || exiting) {
    then?.()
    return
  }
  exiting = true
  const holder = $('bot-avatar')
  tempMood('playful', 600)
  holder.classList.add('leaving')
  play('whoosh')
  setTimeout(() => {
    nuageAvatar?.destroy()
    nuageAvatar = null
    moodNow = ''
    nuageInside = false
    exiting = false
    holder.classList.remove('leaving')
    document.body.classList.remove('nuage-in')
    api.nuageOut()
    then?.()
  }, 420)
}
// Rappelé ailleurs (icône, Ctrl+Alt+N) : il est déjà ressorti
api.onNuageOut(() => {
  if (!nuageInside) return
  nuageAvatar?.destroy()
  nuageAvatar = null
  moodNow = ''
  nuageInside = false
  document.body.classList.remove('nuage-in')
})
// Nuage habite l'encoche : à l'ouverture il apparaît dans le panneau, à côté des onglets ; à la fermeture il
// rentre dans la pilule, où son petit portrait l'attend. Il est recréé à chaque ouverture (rien ne tourne
// pour rien quand l'encoche est fermée).
let homeTimer = null
async function homeAvatar(on) {
  const holder = $('bot-avatar')
  clearTimeout(homeTimer)
  if (on) {
    document.body.classList.add('nuage-in')
    holder.classList.remove('homing')
    if (nuageAvatar) return
    try {
      avatarLib ||= await import('./vendor/avatar-web.js')
      if (state !== 'ouvert' || nuageAvatar) return // refermé (ou déjà créé) pendant le chargement
      nuageAvatar = avatarLib.createAvatar(holder, {
        definition: structuredClone(window.NUAGE_AVATAR), defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage',
      })
    } catch (error) {
      console.error('Nuage dans l’encoche :', error)
      return
    }
    holder.classList.remove('entering', 'popping')
    void holder.offsetWidth
    holder.classList.add('popping')
    setTimeout(() => holder.classList.remove('popping'), 700)
    moodNow = ''
    tempMood(pick(['happy', 'excited', 'playful']), 900)
    animateTo()
    return
  }
  if (!nuageAvatar) {
    document.body.classList.remove('nuage-in')
    return
  }
  holder.classList.add('homing')
  homeTimer = setTimeout(() => {
    holder.classList.remove('homing')
    if (state === 'ouvert') return // rouvert entre-temps
    nuageAvatar?.destroy()
    nuageAvatar = null
    moodNow = ''
    document.body.classList.remove('nuage-in')
  }, 320)
}
// Un clic : il rit ; trop de clics d'affilée : la tête lui tourne (carte « confused » de Coucou, à la Nuage)
let pokes = []
$('bot-avatar').addEventListener('click', () => {
  if (!nuageAvatar) return
  lastActivity = Date.now()
  const now = Date.now()
  pokes = [...pokes.filter(t => now - t < 2500), now]
  if (pokes.length >= 6) {
    pokes = []
    confusedUntil = now + 3300
    tempMood('confused', 3300)
    play('whoosh')
    renderAlert()
    renderBar()
    return
  }
  tempMood(pick(['laughing', 'playful', 'happy', 'winking']), 1800)
  play(pick(['rire', 'gazouillis', 'pop']))
  sparkle(6)
})

// ---------- Pilule ----------
const chatLabel = () => chat.providers.find(p => p.id === chat.provider)?.label || 'L’IA'
function buddyState() {
  const req = agents.permissions[0]
  if (Date.now() < confusedUntil) return 'dizzy'
  if (req) return req.questions ? 'question' : 'approval'
  if (chat.permission) return 'approval'
  if (chat.streaming) return chat.messages.at(-1)?.text ? 'working' : 'thinking'
  if (finished || Date.now() < celebrateUntil || unread) return chat.messages.at(-1)?.error && !finished ? 'error' : 'finished'
  if (agents.sessions.some(s => s.status === 'en-cours')) return 'working'
  if (agents.sessions.some(s => s.status === 'attente')) return 'question'
  return 'idle'
}
// La pilule ne montre du texte que s'il y a quelque chose à lire : ce que Nuage entend, une bulle, une réponse
// arrivée. Sinon (comme Coucou) : Nuage à gauche, avec la pastille de son état, et à droite la grille des
// pastilles actives, ou la météo de ta ville.
function renderBar() {
  const status = $('status')
  let text = ''
  let ico = ''
  let shimmer = false
  if (hint) {
    text = 'Lâche Nuage ici : il rentre dans la barre'
    ico = 'chat-circle-dots'
  } else if (voice.etat === 'ecoute' || voice.etat === 'compris') {
    // « Hey Nuage » : ce qu'il entend, en direct
    text = voice.texte ? `« ${voice.texte} »` : 'Je t’écoute…'
    ico = 'microphone'
    shimmer = !voice.texte
  } else if (voice.etat === 'parle') {
    text = 'Nuage te répond à voix haute'
    ico = 'waveform'
  } else if (Date.now() < chargeFlash.until) {
    text = chargeFlash.text
    ico = 'lightning'
  } else if (unread) {
    text = `${chatLabel()} a répondu`
    ico = 'chat-circle-dots'
  }
  const bubbleNow = toastOn()
  const wasCompact = compact
  compact = !text && !bubbleNow
  document.body.classList.toggle('compact', compact)
  document.body.classList.toggle('talking', bubbleNow)
  document.body.classList.toggle('toast', bubbleNow)
  $('bar').classList.toggle('toast', bubbleNow)
  $('bar').classList.toggle('voice', Boolean(text))
  $('bar').classList.toggle('clickable', bubbleNow && Boolean(toast.action))
  if (bubbleNow) {
    status.replaceChildren(...(toast.icon ? [icon(toast.icon[0], `ico st-ico tone-${toast.icon[1] || 'ciel'}`)] : []), toast.text)
    status.title = toast.text
    status.classList.remove('live')
  } else {
    status.replaceChildren(...(text ? [...(ico ? [icon(ico, 'ico st-ico')] : []), text] : []))
    status.title = ''
    status.classList.toggle('live', shimmer)
  }
  renderPillRight()
  if (state === 'barre' && compact !== wasCompact) animateTo()
  // En-tête : limites de Claude (pastille colorée) et « N en cours »
  const u = agents.usage
  const plan = $('usage-head')
  plan.hidden = !u?.fiveHour
  if (u?.fiveHour) {
    const pct = Math.round(u.fiveHour.pct)
    plan.className = `plan${pct >= 90 ? ' high' : pct >= 70 ? ' warn' : ''}${homeDetail === 'plan' && tab === 'agents' ? ' on' : ''}`
    plan.replaceChildren(el('i'), `5 h · ${pct} %`)
  }
  const live = agents.sessions.filter(s => s.status === 'en-cours').length
  $('running').textContent = live ? `${live} en cours` : ''
  document.body.dataset.buddy = buddyState()
  renderMood()
}
// À droite de la pilule : jusqu'à 4 mini-Nuages des pastilles actives (sessions qui travaillent ou attendent,
// téléphone en ligne, intégration qui a un souci) ; rien d'actif : la météo
function renderPillRight() {
  const box = $('pill-right')
  const active = homePills().filter(p => p.active).slice(0, 4)
  const w = pillWeather
  // Redessinée seulement si elle change (sinon les mini-Nuages rejoueraient leur apparition à chaque nouvelle)
  const key = JSON.stringify(active.length ? active.map(p => [p.c, p.busy, p.wait]) : [w?.key, w?.night, w?.temp])
  if (box.dataset.key === key) return
  box.dataset.key = key
  if (active.length) {
    const grid = el('span', `minis${active.length === 1 ? ' one' : ''}`)
    active.forEach((p, i) => {
      const slot = el('i', p.busy ? 'busy' : p.wait ? 'wait' : '')
      slot.style.animationDelay = `${i * 35}ms`
      slot.append(miniNuage(p.c))
      grid.append(slot)
    })
    box.replaceChildren(grid)
    box.title = active.map(p => p.label).join(', ')
    return
  }
  if (!w || w.temp === undefined || w.temp === null) {
    box.replaceChildren()
    return
  }
  const clearNight = w.night && ['soleil', 'eclaircies'].includes(w.key)
  box.replaceChildren(icon(clearNight ? 'moon-stars' : SKY_ICON[w.key] || 'cloud', 'ico'), el('span', '', `${Math.round(w.temp)}°`))
  box.title = w.place ? `${w.label || w.key} à ${w.place}` : w.label || w.key
}
const SKY_ICON = { soleil: 'sun', eclaircies: 'cloud-sun', couvert: 'cloud', brouillard: 'cloud-fog', bruine: 'cloud-rain', pluie: 'cloud-rain', orage: 'cloud-lightning', neige: 'snowflake' }

// ---------- Bulles de Nuage dans la pilule (il habite l'encoche) ----------
// Ce que Nuage disait dans sa bulle sur le bureau (notifications du PC, téléphone, rappels…) s'affiche ici :
// la pilule s'élargit (jusqu'à 3 lignes), son petit portrait parle, puis elle redevient petite. Bulle à action
// (annuler un repas…) : un clic sur la pilule la déclenche. Panneau ouvert : la même bulle dans l'en-tête.
const measureCtx = document.createElement('canvas').getContext('2d')
function textWidth(text) {
  measureCtx.font = '500 12.5px "Segoe UI Variable Text", "Segoe UI", sans-serif'
  return measureCtx.measureText(text).width
}
let toastTimer = null
function showToast({ text, icon: ico = null, ms = 4500, action = null } = {}) {
  if (!text) return
  // 13 (marge) + 22 (portrait) + 9 + 20 (icône) + texte + 12 (marge) ; au-delà de la largeur maxi : jusqu'à 3 lignes
  const room = TOAST_MAX_W - 76
  const wide = textWidth(text) * 1.04 + 6
  const lines = Math.min(3, Math.max(1, Math.ceil(wide / room)))
  const w = lines > 1 ? TOAST_MAX_W : Math.round(Math.max(PILL_SMALL.w, 76 + wide))
  toast = { text, icon: ico, action, lines, w, until: Date.now() + ms }
  calmSince = Date.now()
  if (state === 'cache') setState('barre')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(endToast, ms)
  renderBar()
  renderToastLine()
  animateTo()
}
function endToast() {
  toast = null
  renderBar()
  renderToastLine()
  animateTo()
}
function runToastAction() {
  const action = toast?.action
  endToast()
  if (typeof action === 'function') action()
  else if (action) api.noticeAction(action)
}
function renderToastLine() {
  const line = $('toast-line')
  const on = toastOn() && state === 'ouvert'
  line.hidden = !on
  if (!on) return
  const parts = [...(toast.icon ? [icon(toast.icon[0], `ico tone-${toast.icon[1] || 'ciel'}`)] : []), el('span', '', toast.text)]
  if (toast.action) parts.push(button('btn secondary', 'Annuler', runToastAction))
  line.replaceChildren(...parts)
  line.title = toast.text
}
api.onNotice(n => showToast(n))

// ---------- Alertes : autorisation, question, fin de session, « trop de clics » ----------
// Une carte à la fois, à la place de la vue (Coucou : approval, question, finished, confused). Les
// demandes passent avant tout ; une fin de session reste 5,2 s ; « trop de clics » 3,3 s.
function currentAlert() {
  if (Date.now() < confusedUntil) return { kind: 'confused', key: 'confused' }
  const req = agents.permissions[0]
  if (req) return { kind: req.questions ? 'question' : 'approval', req, key: `req:${req.id}` }
  if (finished) return { kind: 'finished', key: `fin:${finished.sessionId}:${finished.until}` }
  return null
}
const sessionOf = id => agents.sessions.find(s => s.id === id)
function whoRow(color, name, words, step = '') {
  const row = el('div', 'who-row')
  row.append(colored(el('i', 'dot'), color), el('b', '', name || 'Claude'), el('span', '', words))
  if (step) row.append(el('span', 'step', step))
  return row
}
function keyButton(cls, text, kbd, onClick) {
  const b = button(`btn ${cls}`, '', onClick)
  b.append(text)
  if (kbd) b.append(el('span', 'kbd', kbd))
  return b
}
// Ce que Claude veut faire, en une phrase (comme « Claude Code veut lancer une commande »)
function wantWords(req) {
  const t = req.tool || ''
  if (t === 'Bash' || t === 'PowerShell') return 'Claude Code veut lancer une commande'
  if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(t)) return 'Claude Code veut modifier un fichier'
  if (t === 'Write') return 'Claude Code veut écrire un fichier'
  if (t === 'Read') return 'Claude Code veut lire un fichier'
  if (t === 'WebFetch' || t === 'WebSearch') return 'Claude Code veut aller sur le web'
  return 'Claude Code demande ton accord'
}
function answer(req, choice, answers) {
  api.resolve(req.id, choice, answers)
  play(choice === 'deny' ? 'boum' : 'pop')
}
function approvalCard(req) {
  const s = sessionOf(req.sessionId)
  const body = el('div', 'alert-body')
  body.append(whoRow(colorFor(s?.project || req.title), req.title, wantWords(req)))
  body.append(el('div', 'code', req.command || req.label))
  const actions = el('div', 'actions')
  const always = keyButton('secondary', 'Toujours autoriser', '', () => answer(req, 'always'))
  always.title = `Autoriser ${req.always} pour toute cette session`
  const defer = button('link-btn', 'Répondre dans Claude', () => answer(req, 'defer'))
  defer.title = 'Laisser Claude Code poser la question dans sa propre fenêtre'
  actions.append(
    keyButton('secondary', 'Refuser', 'N', () => answer(req, 'deny')),
    always,
    keyButton('primary', 'Autoriser', 'Y', () => answer(req, 'allow')),
    defer,
  )
  body.append(actions)
  return [body, requestTimer(req)]
}
// Question de Claude (AskUserQuestion) : un volet à la fois, les choix en boutons ; « Autre… » pour écrire
function questionCard(req) {
  const qs = req.questions.slice(0, 4)
  const draft = questionDraft.get(req.id) || { index: 0, answers: {}, picked: [] }
  questionDraft.set(req.id, draft)
  const q = qs[draft.index]
  const s = sessionOf(req.sessionId)
  const body = el('div', 'alert-body')
  body.append(whoRow(colorFor(s?.project || req.title), req.title, 'Claude Code te pose une question', qs.length > 1 ? `${draft.index + 1}/${qs.length}` : ''))
  body.append(el('div', 'title', q.question))
  const next = text => {
    draft.answers[q.question] = text
    draft.picked = []
    if (draft.index < qs.length - 1) {
      draft.index += 1
      renderAlert(true)
      animateTo()
    } else {
      questionDraft.delete(req.id)
      answer(req, 'answer', draft.answers)
    }
  }
  const options = el('div', 'actions')
  for (const opt of q.options || []) {
    const b = button(`btn secondary${draft.picked.includes(opt.label) ? ' picked' : ''}`, opt.label, () => {
      if (!q.multiSelect) return next(opt.label)
      draft.picked = draft.picked.includes(opt.label) ? draft.picked.filter(x => x !== opt.label) : [...draft.picked, opt.label]
      b.classList.toggle('picked', draft.picked.includes(opt.label))
      send.disabled = !draft.picked.length
    })
    if (opt.description) b.title = opt.description
    options.append(b)
  }
  const send = keyButton('primary', draft.index < qs.length - 1 ? 'Suivant' : 'Envoyer', '', () => next(draft.picked.join(', ')))
  send.disabled = !draft.picked.length
  if (q.multiSelect) options.append(send)
  body.append(options)
  const other = el('input', 'q-other')
  other.type = 'text'
  other.placeholder = 'Autre réponse… (Entrée)'
  other.hidden = true
  other.addEventListener('keydown', e => {
    if (e.key === 'Enter' && other.value.trim()) next(other.value.trim())
  })
  const extra = el('div', 'actions')
  extra.append(
    button('link-btn', 'Autre…', () => {
      other.hidden = false
      other.focus()
      animateTo()
    }),
    other,
    button('link-btn', 'Répondre dans Claude', () => {
      questionDraft.delete(req.id)
      answer(req, 'defer')
    }),
  )
  body.append(extra)
  return [body, requestTimer(req)]
}
// Temps qu'il reste avant que Claude Code reprenne la main (trait en bas, comme le compte à rebours de Coucou)
function requestTimer(req) {
  const timer = el('div', 'timer')
  const bar = el('span')
  timer.append(bar)
  const total = Math.max(1000, req.expiresAt - (req.createdAt || Date.now() - 45_000))
  const tick = () => {
    const left = Math.max(0, req.expiresAt - Date.now())
    bar.style.width = `${(left / total) * 100}%`
    if (left > 0 && timer.isConnected) setTimeout(tick, 1000)
  }
  requestAnimationFrame(tick)
  return timer
}
function finishedCard() {
  const f = finished
  const body = el('div', 'alert-body')
  body.append(whoRow(f.color, f.title, 'Claude Code a terminé'))
  body.append(el('div', 'title', f.summary || 'C’est fini.'))
  const actions = el('div', 'actions')
  actions.append(
    button('btn primary', 'Continuer dans le chat', async () => {
      const id = f.sessionId
      finished = null
      if (await chatApi.continueSession(id)) {
        showTab('chat')
        $('input').focus()
      }
      renderAlert()
    }),
    button('btn secondary', 'OK', () => {
      finished = null
      renderAlert()
      renderBar()
      if (!hovering) fold()
    }),
  )
  body.append(actions)
  return [body]
}
function confusedCard() {
  const body = el('div', 'alert-body')
  body.append(el('div', 'title', 'La tête me tourne.'), el('div', 'sub', 'Trop de clics d’un coup : je reprends mes esprits et je reviens dans trois secondes.'))
  return [body]
}
let alertKey = ''
function renderAlert(force = false) {
  const a = currentAlert()
  const key = a ? `${a.key}:${a.req ? questionDraft.get(a.req.id)?.index ?? 0 : ''}` : ''
  if (key !== alertKey || force) {
    alertKey = key
    const card = $('alert-card')
    if (a?.kind === 'approval') card.replaceChildren(...approvalCard(a.req))
    else if (a?.kind === 'question') card.replaceChildren(...questionCard(a.req))
    else if (a?.kind === 'finished') card.replaceChildren(...finishedCard())
    else if (a?.kind === 'confused') card.replaceChildren(...confusedCard())
    else card.replaceChildren()
    if (a?.req && !knownRequests.has(a.req.id)) {
      knownRequests.add(a.req.id)
      play('ding')
      if (nuageAvatar) tempMood('surprised', 900)
    }
  }
  syncView()
}

// ---------- Accueil : la session suivie (carte de gauche) et les pastilles (carte de droite) ----------
function currentSession() {
  return agents.sessions.find(s => s.id === selectedSession) ||
    agents.sessions.find(s => s.status === 'permission' || s.status === 'attente') ||
    agents.sessions.find(s => s.status === 'en-cours') || agents.sessions[0] || null
}
const isOnline = d => Boolean(d) && Date.now() - (d.lastSeen || 0) < 60_000
// Toutes les pastilles : autres sessions, téléphone, intégrations branchées
function homePills() {
  const focus = currentSession()
  const list = []
  // Sessions récentes ou en cours, une seule par nom (les copies d'une session reprise dans le chat portent le même)
  const seen = new Set()
  const recent = agents.sessions.filter(s => {
    const key = s.title || s.id
    if (seen.has(key) && s.id !== focus?.id) return false
    if (s.status === 'inactif' && Date.now() - s.lastAt > 30 * 60_000 && s.id !== focus?.id) return false
    seen.add(key)
    return true
  })
  for (const s of recent.slice(0, 5)) {
    const live = s.status === 'en-cours'
    const wait = s.status === 'attente' || s.status === 'permission'
    const fresh = s.status === 'termine' && Date.now() - s.lastAt < 10 * 60_000
    list.push({
      kind: 'session', id: s.id, label: s.title, c: colorFor(s.project || s.title), on: s.id === focus?.id && !homeDetail,
      badge: live || wait || fresh ? STATE_COLOR[s.status] : '', busy: live, wait, active: live || wait,
      title: `${s.project} · ${ago(s.lastAt)}`,
    })
  }
  const d = phone.devices[0]
  if (d) {
    const online = isOnline(d)
    const charging = online && d.etat?.charge
    list.push({
      kind: 'phone', cls: `phone${online ? ' online' : ''}${phone.ringing ? ' ringing' : ''}${charging ? ' charging' : ''}`,
      label: d.nom || 'Téléphone', c: online ? '#34d399' : '#8e939c', badge: charging ? '#ffd23f' : '',
      active: Boolean(phone.ringing || charging), busy: Boolean(phone.ringing), on: tab === 'telephone',
      title: online ? `${d.nom} en ligne${d.etat?.batterie !== undefined ? ` · ${d.etat.batterie} %` : ''}` : `${d.nom} hors ligne`,
    })
  } else {
    // Pas encore de téléphone : la pastille mène quand même au menu (installer l'appli, associer) ; avant, ce menu
    // n'était accessible que par l'icône près de l'horloge (08/10/2026 : « le menu téléphone est où ? »)
    list.push({ kind: 'phone', cls: 'phone', label: 'Téléphone', c: '#8e939c', on: tab === 'telephone', title: 'Associer ton téléphone Android (Nuage de poche)', none: true })
  }
  for (const i of integrations.filter(x => x.status !== 'off')) {
    const bad = i.status === 'erreur' || (i.lines || []).some(l => l.tone === 'mauvais')
    list.push({
      kind: 'integ', id: i.id, label: i.label, c: INTEG_COLOR[i.id] || '#38bdf8', badge: bad ? '#f4505e' : '', active: bad, wait: bad,
      on: homeDetail === `integ:${i.id}`, title: i.status === 'erreur' ? i.error : i.badge || i.label,
    })
  }
  return list
}
function renderPills() {
  const box = $('home-right')
  const pills = homePills()
  // Reconstruites seulement si elles changent : sinon leurs animations (téléphone qui vibre, respiration) repartiraient
  // de zéro à chaque nouvelle de Claude (plusieurs fois par seconde)
  const key = JSON.stringify(pills.map(p => [p.kind, p.id, p.label, p.c, p.cls, p.on, p.busy, p.wait, p.badge, p.title]))
  if (box.dataset.key === key) return
  box.dataset.key = key
  // Rien d'autre que le téléphone pas encore associé : le message, avec un bouton vers son menu (installer, associer)
  if (pills.every(p => p.none)) {
    const empty = el('div', 'pills-empty')
    empty.append(el('span', '', 'Ton téléphone, GitHub, Stripe, Vercel… : ils apparaîtront ici.'),
      button('btn secondary', 'Téléphone', () => showTab('telephone')), button('btn secondary', 'Intégrations', () => openReglages({ section: 'integrations' })))
    box.replaceChildren(empty)
    return
  }
  const grid = el('div', 'pills')
  for (const p of pills) {
    const b = button(`pill${p.cls ? ` ${p.cls}` : ''}${p.on ? ' on' : ''}${p.busy ? ' busy' : ''}${p.wait ? ' wait' : ''}`, '', () => {
      if (p.kind === 'session') {
        selectedSession = p.id
        homeDetail = null
        renderHome()
      } else if (p.kind === 'phone') {
        showTab('telephone')
      } else {
        homeDetail = homeDetail === `integ:${p.id}` ? null : `integ:${p.id}`
        renderHome()
      }
      play('pop')
    })
    colored(b, p.c)
    b.title = p.title || p.label
    const mini = el('span', 'mini')
    mini.append(miniNuage(p.c))
    if (p.kind === 'phone') mini.append(el('i', 'ph-glyph')) // le petit téléphone que tient son mini-Nuage
    b.append(mini, el('span', 'lbl', p.label))
    if (p.badge) {
      const badge = el('i', `badge${p.busy ? ' live' : ''}`)
      badge.style.setProperty('--b', p.badge)
      b.append(badge)
    }
    grid.append(b)
  }
  box.replaceChildren(grid)
}
// Étapes de la dernière demande (pour « 3/4 ») et défilé : les 3 dernières, la plus récente en bas
const turnSteps = s => {
  const list = []
  for (const st of s.steps) {
    if (st.kind === 'demande') break
    if (st.kind !== 'message') list.push(st)
  }
  return list
}
// « Modifie billing.ts (+1 −1) » : le bilan en couleur
function stepText(node, label) {
  const m = /^(.*?)\s*\(\+(\d+) [−-](\d+)\)$/.exec(label)
  if (!m) {
    node.textContent = label
    return
  }
  node.replaceChildren(m[1], el('span', 'plus', `+${m[2]}`), el('span', 'minus', `−${m[3]}`))
}
function renderTicker(box, s) {
  const steps = s.steps.filter(st => st.kind !== 'demande').slice(0, 3).reverse()
  const old = new Map([...box.children].map(n => [n.dataset.id, n]))
  steps.forEach((st, i) => {
    let row = old.get(st.id)
    if (!row) {
      row = button('tick-row', '', () => showStep(s.id, st.id))
      row.dataset.id = st.id
      row.append(el('span', 'tick-icon'), el('span', 'tick-text'))
      row.style.top = `${8 + 3 * 26}px`
      row.style.opacity = '0'
      box.append(row)
      void row.offsetWidth
    }
    old.delete(st.id)
    const isNow = i === steps.length - 1
    row.className = `tick-row${isNow ? ' now' : ''}${st.done ? ' done' : ''}${st.error ? ' err' : ''}`
    row.title = `${st.detail || st.label} (clic : le détail)`
    row.firstChild.replaceChildren(icon(st.icon || 'wrench'))
    const text = row.lastChild
    stepText(text, st.label)
    text.classList.toggle('shimmer', isNow && !st.done && s.status === 'en-cours')
    row.style.top = `${8 + (3 - steps.length + i) * 26}px`
    row.style.opacity = isNow ? '1' : i === steps.length - 2 ? '.85' : '.6'
  })
  for (const row of old.values()) {
    row.style.top = '-24px'
    row.style.opacity = '0'
    setTimeout(() => row.remove(), 460)
  }
}
let leftMode = ''
function renderHomeLeft() {
  const box = $('home-left')
  const s = currentSession()
  const mode = homeDetail || (s ? `s:${s.id}` : 'vide')
  if (mode === 'plan') {
    leftMode = mode
    box.replaceChildren(planCard())
    return
  }
  if (mode.startsWith('integ:')) {
    const i = integrations.find(x => `integ:${x.id}` === mode)
    if (!i) {
      homeDetail = null
      return renderHomeLeft()
    }
    leftMode = mode
    box.replaceChildren(integCard(i))
    return
  }
  if (!s) {
    leftMode = mode
    // L'IA du chat, par son nom court (« Gemini », « ChatGPT », « OpenRouter »…) ; Claude Code seulement s'il est là
    const ai = (chat.providers.find(p => p.id === chat.provider)?.label || 'l’IA').replace(/\s*\(.*\)$/, '')
    const claude = chat.providers.find(p => p.id === 'claudecode')?.ready
    const openChat = () => {
      showTab('chat')
      $('input').focus()
    }
    const empty = el('div', 'empty-home')
    const actions = el('div', 'actions')
    if (!chat.session && chat.messages.length) {
      // Discussion en cours dans le chat (08/10/2026 : « pourtant je suis en pleine session avec Gemini »)
      const cut = t => { const one = String(t || '…').replace(/\s+/g, ' ').trim(); return one.length > 70 ? `${one.slice(0, 69)}…` : one }
      const asked = cut([...chat.messages].reverse().find(m => m.role === 'user')?.text)
      empty.append(el('div', 'title', `Discussion avec ${ai}`), el('div', 'sub', chat.streaming ? `${ai} répond à « ${asked} »…` : `Dernière question : « ${asked} »`))
      actions.append(button('btn primary', 'Ouvrir le chat', openChat), button('btn secondary', 'Nouvelle discussion', () => {
        chatApi.reset()
        openChat()
      }))
    } else {
      empty.append(el('div', 'title', 'Rien ne tourne pour l’instant.'), el('div', 'sub', claude ? 'Lance une session : je te montre chaque étape.' : 'Pose une question dans le chat, ou glisse un fichier sur la barre.'))
      actions.append(button('btn primary', `Demander à ${ai}`, openChat))
      if (claude) actions.append(button('btn secondary', 'Nouvelle session', () => startNewSession(false)))
    }
    empty.append(actions)
    box.replaceChildren(empty)
    return
  }
  if (mode !== leftMode) {
    leftMode = mode
    const jump = el('div', 'jump')
    const goOn = button('icon-btn', '', async () => {
      if (await chatApi.continueSession(s.id)) {
        showTab('chat')
        $('input').focus()
      }
    })
    goOn.title = 'Continuer cette session dans le chat (Nuage reprend tout ce qui s’y est dit)'
    goOn.append(icon('chat-circle-dots'))
    const all = button('icon-btn', '', () => showActivity(s.id))
    all.title = 'Toute l’activité de la session'
    all.append(icon('list-checks'))
    const inApp = button('icon-btn', '', () => api.openSession(s.cwd))
    inApp.title = 'Ouvrir dans l’application Claude'
    inApp.append(icon('arrow-up-right'))
    jump.append(goOn, all, inApp)
    box.replaceChildren(el('div', 'who'), jump, el('div', 'ticker'), el('div', 'files-line'), el('div', 'waiting-line'))
  }
  const live = s.status === 'en-cours'
  const turn = turnSteps(s)
  const count = live && turn.length ? `${turn.filter(st => st.done).length}/${turn.length}` : { attente: 'attend ta réponse', permission: 'attend ton accord', termine: 'terminé', inactif: 'au repos' }[s.status] || ''
  const who = box.querySelector('.who')
  who.replaceChildren(colored(el('i', `dot${live ? ' live' : ''}`), colorFor(s.project || s.title)), el('span', 'name', s.title), el('span', 'tool', 'Claude Code'), el('span', 'count', count))
  who.title = `${s.project} · ${ago(s.lastAt)}`
  renderTicker(box.querySelector('.ticker'), s)
  const files = box.querySelector('.files-line')
  files.replaceChildren(...s.files.slice(0, 4).map(f => {
    const chip = button('file-chip', '', () => showDiff(s.id, f.path))
    chip.title = f.path
    chip.append(f.name, el('span', 'plus', `+${f.added}`), el('span', 'minus', `−${f.removed}`))
    return chip
  }))
  files.hidden = !s.files.length
  const wait = box.querySelector('.waiting-line')
  wait.textContent = s.waiting || ''
  wait.hidden = !s.waiting
}
// Limites d'utilisation (pastille « 5 h · 80 % » de l'en-tête), lues par Nuage lui-même (claude -p /usage)
function meter(label, w) {
  const row = el('div', 'meter')
  const track = el('div', 'track')
  const fill = el('div', `fill${w.pct >= 90 ? ' high' : w.pct >= 70 ? ' warn' : ''}`)
  fill.style.width = `${Math.min(100, Math.max(0, w.pct))}%`
  track.append(fill)
  const reset = w.resetsAt ? `repart ${new Date(w.resetsAt).toLocaleString('fr-FR', { weekday: w.resetsAt - Date.now() > 86_400_000 ? 'short' : undefined, hour: '2-digit', minute: '2-digit' })}` : ''
  row.append(el('span', '', label), track, el('small', '', `${Math.round(w.pct)} %${reset ? ` · ${reset}` : ''}`))
  return row
}
function planCard() {
  const u = agents.usage
  const card = el('div', 'plan-card')
  const head = el('div', 'card-head')
  head.append(colored(el('i', 'dot'), '#d97757'), el('b', '', 'Limites de Claude'), el('span', '', u?.updatedAt ? `à jour ${ago(u.updatedAt)}` : 'lecture…'), closeButton())
  card.append(head)
  if (u?.fiveHour) card.append(meter('5 h', u.fiveHour))
  if (u?.sevenDay) card.append(meter('7 j', u.sevenDay))
  for (const extra of u?.extra || []) card.append(meter(extra.label.replace('7 j, ', ''), extra))
  if (!u?.fiveHour && !u?.sevenDay) card.append(el('div', 'sub', u ? 'Réservées aux forfaits Claude Pro / Max.' : 'Lecture en cours…'))
  else if (u.context !== null && u.context !== undefined) card.append(el('div', 'q-desc', `${u.model || 'Claude'} : ${Math.round(u.context)} % du contexte utilisé`))
  return card
}
function closeButton() {
  const b = button('icon-btn', '', () => {
    homeDetail = null
    renderHome()
  })
  b.title = 'Fermer (Échap)'
  b.append(icon('x'))
  return b
}
function integCard(i) {
  const card = el('div', 'integ-card')
  const head = el('div', 'card-head')
  const refresh = button('icon-btn', '', () => api.refreshIntegrations())
  refresh.title = 'Actualiser'
  refresh.append(icon('arrows-clockwise'))
  head.append(colored(el('i', 'dot'), INTEG_COLOR[i.id] || '#38bdf8'), el('b', '', i.label), el('span', '', i.status === 'erreur' ? i.error : i.badge || (i.updatedAt ? `à ${time(i.updatedAt)}` : '')), refresh, closeButton())
  head.lastChild.style.marginLeft = '0'
  const rows = el('div', 'integ-rows')
  for (const line of i.lines || []) {
    const row = el(line.url ? 'button' : 'div', `integ-row${line.url ? ' link' : ''}${line.tone ? ` ${line.tone}` : ''}`)
    if (line.url) {
      row.type = 'button'
      row.addEventListener('click', () => api.openUrl(line.url))
    }
    row.append(colored(el('i', 'dot'), line.tone === 'mauvais' ? '#f4505e' : line.tone === 'bon' ? '#34d399' : '#5f646d'), el('span', '', line.text))
    rows.append(row)
  }
  if (!(i.lines || []).length) rows.append(el('div', 'sub', 'Rien de neuf.'))
  card.append(head, rows)
  return card
}
function renderHome() {
  renderHomeLeft()
  renderPills()
  renderSideInfo()
  renderBar()
  if (state === 'ouvert') animateTo()
}

// ---------- Détail : code modifié, liste de l'activité, une étape ----------
function stepIcon(st, isNow) {
  if (st.error) return el('i', 'st err')
  if (!st.done || isNow) return el('i', `st ${st.done ? 'done' : 'run'}`)
  return el('i', 'st done')
}
// Sous Nuage dans le détail : la session et ses dernières étapes (comme la colonne de Coucou)
function renderSideInfo() {
  const box = $('side-info')
  const s = currentSession()
  if (!s) {
    box.replaceChildren()
    return
  }
  const list = el('ul', 'steps')
  const steps = s.steps.filter(st => st.kind !== 'demande' && st.kind !== 'message').slice(0, 5).reverse()
  steps.forEach((st, i) => {
    const isNow = i === steps.length - 1 && s.status === 'en-cours' && !st.done
    const li = el('li', isNow ? 'now' : '')
    li.title = `${st.detail || st.label} (clic : voir le détail)`
    li.append(stepIcon(st, isNow), el('span', 'lbl', st.label.replace(/^(Exécute|Lit|Modifie|Écrit|Cherche)\b.*/, '$1')))
    li.addEventListener('click', () => showStep(s.id, st.id))
    list.append(li)
  })
  if (s.status === 'termine') {
    const li = el('li', 'now')
    li.append(el('i', 'st done'), el('span', 'lbl', 'Terminé'))
    list.append(li)
  }
  box.replaceChildren(el('div', 'name', s.title), el('div', 'agent', 'Claude Code'), list)
}
// Code modifié, comme un petit éditeur (numéros de ligne, ajouts en vert, retraits en rouge)
async function showDiff(sessionId, filePath) {
  const view = await api.fileDiff(sessionId, filePath)
  if (!view) return
  diffView = view
  const code = el('div', 'code-card')
  const tabRow = el('div', 'code-tab')
  const file = el('span', 'file', view.name)
  file.append(el('i'))
  const back = button('back', '', () => showTab('agents'))
  back.title = 'Retour (Échap)'
  back.append(icon('caret-left'))
  tabRow.append(back, file, el('span', 'plus', `+${view.added}`), el('span', 'minus', `−${view.removed}`), el('span', 'path', view.path || ''))
  const body = el('div', 'code-body')
  for (const edit of [...view.edits].reverse()) {
    const block = el('div', 'code-edit')
    block.append(el('div', 'code-when', `${edit.created ? 'Créé' : 'Modifié'} à ${time(edit.at)} (+${edit.added} −${edit.removed})`))
    renderHunks(block, edit.hunks)
    body.append(block)
  }
  code.append(tabRow, body)
  openCodePane(code)
}
// Lignes d'un diff (numéros, ajouts en vert, retraits en rouge)
function renderHunks(block, hunks) {
  for (const h of hunks || []) {
    let oldNo = h.oldStart || 1
    let newNo = h.newStart || 1
    for (const line of h.lines) {
      const sign = line[0]
      const kind = sign === '+' ? 'add' : sign === '-' ? 'del' : 'ctx'
      let no = ''
      if (sign === '+') no = newNo++
      else if (sign === '-') no = oldNo++
      else if (sign === ' ') {
        no = newNo++
        oldNo++
      }
      const row = el('div', `ln ${kind}`)
      row.append(el('span', 'no', String(no)), el('span', 'sg', sign === ' ' ? '' : sign), el('span', 'tx', line.slice(1) || ' '))
      block.append(row)
    }
  }
}
function openCodePane(node) {
  $('diff').replaceChildren(node)
  syncView()
  if (state === 'ouvert') animateTo()
}

// ---------- Activité en direct : chaque étape de Claude Code, cliquable (04/10/2026) ----------
// « Quand Claude travaille, je dois pouvoir cliquer et voir en temps réel les fichiers, les
// recherches… bref tout. » Les étapes viennent des journaux (relus chaque seconde) ; le détail
// (agents.js stepDetail) se met à jour tant qu'il est ouvert.
const KIND_WORD = {
  lecture: 'Lecture', edition: 'Modification', ecriture: 'Nouveau fichier', commande: 'Commande', recherche: 'Recherche',
  web: 'Web', agent: 'Sous-agent', question: 'Question', taches: 'Tâches', message: 'Claude dit', demande: 'Ta demande', autre: 'Outil',
}
let stepView = null // détail ouvert : { sessionId, stepId, sig, from }
let activityOf = null // liste complète ouverte : id de la session
const seconds = ms => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace('.', ',')} s`
function kindIcon(st) {
  const box = el('span', `k-ico k-${st.kind}`)
  box.append(icon(st.icon || 'wrench'))
  return box
}
function stepRow(s, st, from) {
  const row = button(`act${st.done ? '' : ' run'}${st.error ? ' err' : ''}${st.sub ? ' sub' : ''}`, '', () => showStep(s.id, st.id, from))
  const when = st.done ? time(st.at) : 'en cours'
  row.append(kindIcon(st), el('span', 'act-lbl', st.label), el('span', 'act-when', when))
  row.title = st.detail || st.label
  return row
}
function activityList(s, max, from) {
  const list = el('div', 'activity')
  for (const st of s.steps.slice(0, max)) list.append(stepRow(s, st, from))
  return list
}
function backButton(onClick, cls = 'back') {
  const b = button(cls, '', onClick)
  b.title = 'Retour (Échap)'
  b.append(icon('caret-left'))
  return b
}
// Liste complète de l'activité d'une session (60 dernières étapes)
function showActivity(sessionId) {
  const s = agents.sessions.find(x => x.id === sessionId)
  if (!s) return
  activityOf = sessionId
  stepView = null
  diffView = { tall: true }
  const code = el('div', 'code-card activity-view')
  const tabRow = el('div', 'code-tab')
  const live = s.status === 'en-cours'
  tabRow.append(backButton(() => {
    activityOf = null
    showTab('agents')
  }), el('span', 'title', `Activité · ${s.title}`), el('span', `state ${live ? 'run' : 'ok'}`, live ? 'en direct' : `${s.steps.length} étapes`))
  const body = el('div', 'code-body prose-body')
  body.append(s.steps.length ? activityList(s, 60, 'activity') : el('div', 'sub', 'Rien pour l’instant.'))
  code.append(tabRow, body)
  const keepScroll = $('diff').querySelector('.activity-view .code-body')?.scrollTop || 0
  openCodePane(code)
  if (keepScroll) body.scrollTop = keepScroll
}
// Détail d'une étape, selon son genre
async function showStep(sessionId, stepId, from = 'agents', refresh = false) {
  const d = await api.stepDetail(sessionId, stepId)
  if (!d) return
  const sig = JSON.stringify([d.done, d.error, d.result?.length, d.output?.stdout?.length, d.output?.stderr?.length, d.patch?.length, d.found?.count, d.text?.length])
  if (refresh) {
    if (!stepView || stepView.stepId !== stepId) return
    if (stepView.sig === sig) return
  }
  stepView = { sessionId, stepId, sig, from }
  diffView = { tall: true }
  const keepScroll = refresh ? $('diff').querySelector('.code-body')?.scrollTop || 0 : 0
  const code = el('div', 'code-card step-view')
  const tabRow = el('div', 'code-tab')
  const status = d.error ? el('span', 'state err', 'erreur')
    : d.done ? el('span', 'state ok', d.endedAt && d.at ? `fini en ${seconds(Math.max(0, d.endedAt - d.at))}` : 'fini')
      : el('span', 'state run', 'en cours')
  if (!d.done) status.dataset.since = d.at || Date.now()
  const back = () => {
    stepView = null
    if (from === 'activity' && activityOf) showActivity(activityOf)
    else showTab('agents')
  }
  tabRow.append(backButton(back), kindIcon(d), el('span', 'kind', KIND_WORD[d.kind] || 'Étape'), status, el('span', 'path', d.at ? time(d.at) : ''))
  const body = el('div', 'code-body prose-body')
  body.append(el('div', 'step-title', d.label))
  renderStepBody(body, d)
  code.append(tabRow, body)
  openCodePane(code)
  if (keepScroll) code.querySelector('.code-body').scrollTop = keepScroll
}
// Bloc de texte à chasse fixe (commande, sortie, résultat), avec numéros de ligne si demandé
function codeBlock(text, { start = 0, cls = '' } = {}) {
  const block = el('div', `blk${cls ? ` ${cls}` : ''}`)
  const lines = String(text ?? '').replace(/\r/g, '').split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  for (const [i, line] of lines.entries()) {
    const row = el('div', start ? 'ln ctx' : 'ln plain')
    if (start) row.append(el('span', 'no', String(start + i)), el('span', 'sg', ''))
    row.append(el('span', 'tx', line || ' '))
    block.append(row)
  }
  return block
}
function meta(pairs) {
  const box = el('dl', 'meta')
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === '') continue
    box.append(el('dt', '', k), el('dd', '', String(v)))
  }
  return box
}
const waitingLine = () => el('div', 'waiting', 'Claude y travaille… le résultat s’affichera ici dès qu’il arrive.')
function renderStepBody(body, d) {
  const input = d.input || {}
  if (d.kind === 'message' || d.kind === 'demande') {
    const p = el('div', 'prose')
    richText(p, d.text || '')
    body.append(p)
    return
  }
  if (d.kind === 'lecture') {
    const r = d.read
    body.append(meta([['Fichier', input.file_path], ['Lignes', r ? `${r.startLine} à ${r.startLine + Math.max(0, (r.numLines || 1) - 1)}${r.totalLines ? ` sur ${r.totalLines}` : ''}` : input.offset ? `à partir de ${input.offset}` : '']]))
    body.append(d.done ? codeBlock(d.result, { start: r?.startLine || 0 }) : waitingLine())
    return
  }
  if (d.kind === 'edition' || d.kind === 'ecriture') {
    body.append(meta([['Fichier', input.file_path || input.notebook_path]]))
    if (d.patch?.length) {
      const block = el('div', 'blk')
      renderHunks(block, d.patch)
      body.append(block)
    } else if (d.created && d.result) {
      body.append(codeBlock(d.result, { start: 1 }))
    } else if (!d.done) {
      if (input.new_string) {
        const block = el('div', 'blk')
        renderHunks(block, [{ oldStart: 1, newStart: 1, lines: [...String(input.old_string || '').split('\n').map(l => `-${l}`), ...String(input.new_string).split('\n').map(l => `+${l}`)] }])
        body.append(block)
      }
      body.append(waitingLine())
    } else if (d.result) {
      body.append(codeBlock(d.result))
    }
    return
  }
  if (d.kind === 'commande') {
    body.append(meta([['But', input.description], ['Dossier', d.cwd]]))
    body.append(codeBlock(`> ${input.command || ''}`, { cls: 'cmd' }))
    if (!d.done) body.append(waitingLine())
    else if (d.output) {
      if (d.output.stdout) body.append(el('div', 'blk-label', 'Sortie'), codeBlock(d.output.stdout))
      if (d.output.stderr) body.append(el('div', 'blk-label', 'Erreurs'), codeBlock(d.output.stderr, { cls: 'err' }))
      if (!d.output.stdout && !d.output.stderr) body.append(el('div', 'sub', d.result || 'Aucune sortie.'))
      if (d.output.interrupted) body.append(el('div', 'sub', 'Commande interrompue.'))
    } else {
      body.append(el('div', 'blk-label', 'Résultat'), codeBlock(d.result || 'Aucune sortie.', { cls: d.error ? 'err' : '' }))
    }
    return
  }
  if (d.kind === 'recherche') {
    body.append(meta([['Motif', input.pattern], ['Dans', input.path], ['Filtre', input.glob || input.type], ['Mode', input.output_mode]]))
    if (!d.done) body.append(waitingLine())
    else if (d.found?.files?.length) {
      body.append(el('div', 'blk-label', `${d.found.count} fichier${d.found.count > 1 ? 's' : ''} trouvé${d.found.count > 1 ? 's' : ''}${d.found.truncated ? ' (liste coupée)' : ''}`))
      body.append(codeBlock(d.found.files.join('\n')))
    } else body.append(codeBlock(d.result || 'Rien trouvé.'))
    return
  }
  if (d.kind === 'web') {
    if (input.url) {
      const link = button('url', input.url, () => /^https?:\/\//i.test(input.url) && api.openUrl(input.url))
      body.append(link)
    }
    body.append(meta([['Recherche', input.query], ['Question', input.prompt]]))
    body.append(d.done ? codeBlock(d.result || '—') : waitingLine())
    return
  }
  if (d.kind === 'taches') {
    let todos = []
    try {
      todos = JSON.parse(input.todos || '[]')
    } catch {}
    const list = el('ul', 'todo')
    for (const t of todos) {
      const li = el('li', t.status || '')
      li.append(el('i', `st ${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'run' : 'todo'}`), el('span', '', t.content || t.activeForm || ''))
      list.append(li)
    }
    body.append(todos.length ? list : codeBlock(input.todos || ''))
    return
  }
  if (d.kind === 'agent') {
    body.append(meta([['Tâche', input.description], ['Type', input.subagent_type]]))
    if (input.prompt) body.append(el('div', 'blk-label', 'Consigne donnée'), codeBlock(input.prompt))
    body.append(el('div', 'blk-label', 'Résultat'), d.done ? codeBlock(d.result || '—') : waitingLine())
    return
  }
  // Question, compétence, outils MCP, autres : l'entrée telle quelle, puis le résultat
  const pairs = Object.entries(input).filter(([, v]) => typeof v !== 'object')
  if (pairs.length) body.append(meta(pairs.map(([k, v]) => [k, String(v).length > 300 ? `${String(v).slice(0, 300)}…` : v])))
  body.append(el('div', 'blk-label', 'Résultat'), d.done ? codeBlock(d.result || '—', { cls: d.error ? 'err' : '' }) : waitingLine())
}
// « en cours » : le temps écoulé avance chaque seconde
setInterval(() => {
  for (const node of document.querySelectorAll('.state.run[data-since]')) node.textContent = `en cours, ${seconds(Date.now() - Number(node.dataset.since))}`
}, 1000)

// ---------- Téléphone : Nuage de poche (clic sur sa pastille) ----------
// Le téléphone (en ligne, batterie, version), les gestes (fichiers, presse-papiers, faire sonner, reçus), le
// copier-coller dans les deux sens et son historique (clic : recopier), les transferts, les nouvelles envoyées
// au téléphone, l'association.
const SOURCE_WORD = { auto: 'copié', menu: 'texte sélectionné', bulle: 'bulle', tuile: 'réglages rapides', notif: 'notification', appli: 'appli', partage: 'partage' }
function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  for (const [unit, size] of [['Go', 1e9], ['Mo', 1e6], ['Ko', 1e3]]) {
    if (bytes >= size) return `${(bytes / size).toFixed(bytes / size >= 100 ? 0 : 1).replace('.', ',').replace(/,0$/, '')} ${unit}`
  }
  return `${bytes} o`
}
const FILE_ICON = [[/\.(jpe?g|png|gif|webp|heic|bmp)$/i, 'image'], [/\.(mp4|mov|mkv|avi|webm)$/i, 'file-video'], [/\.(mp3|m4a|wav|ogg|flac)$/i, 'file-audio'], [/\.pdf$/i, 'file-pdf'], [/\.(zip|rar|7z)$/i, 'file-zip']]
function phoneAct(ico, tone, label, onClick, on = false) {
  const b = button(`ph-act${on ? ' on' : ''}`, '', onClick)
  b.style.setProperty('--t', tone)
  b.append(icon(ico), el('b', '', label))
  return b
}
function phoneSwitch(label, checked, onChange) {
  const row = el('label', 'switch-row')
  const input = el('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  row.append(input, el('i', 'switch'), el('span', '', label))
  return row
}
// Petite batterie qui se remplit jusqu'au niveau, avec un flux d'énergie et un éclair (téléphone en charge)
function chargeGlyph(level) {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 14 26')
  svg.setAttribute('class', 'ph-cbat')
  svg.setAttribute('aria-hidden', 'true')
  const node = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    svg.append(n)
    return n
  }
  const h = Math.max(1.5, Math.min(1, level / 100) * 19)
  node('rect', { class: 'cap', x: 4.5, y: 0.5, width: 5, height: 2.4, rx: 1 })
  node('rect', { class: 'shell', x: 1, y: 2.5, width: 12, height: 22.5, rx: 3 })
  node('rect', { class: 'level', x: 2.9, y: 23.1 - h, width: 8.2, height: h, rx: 1.6 })
  for (const [cx, d] of [[5, '0s'], [9, '.6s'], [7, '1.2s']]) node('circle', { class: 'bubble', cx, cy: 22, r: 0.9 }).style.setProperty('--d', d) // pas d'attribut style : la CSP le bloque
  node('path', { class: 'bolt', d: 'M8.2 7.5 4.4 14h2.8l-1.1 5 4.1-6.8H7.4z' })
  return svg
}
// Connexion : pourquoi le téléphone ne joint pas le PC, et quoi faire (pare-feu, ancien QR code, Wi-Fi)
const REFUS = {
  cle: 'essaie de joindre le PC avec un ancien QR code. Dans l’appli : « Oublier ce PC », puis « scanner le QR code » (bouton Associer ci-dessous).',
  inconnu: 'a été oublié par le PC. Dans l’appli : « scanner le QR code » (bouton Associer ci-dessous).',
  horloge: 'a une heure fausse : règle l’heure du téléphone sur « automatique ».',
}
function phoneDiag(d, online) {
  const g = phone.diag
  if (!g) return null
  const box = el('div', 'ph-diag')
  const line = el('div', 'ph-diag-line')
  // Aucune adresse affichée (09/10/2026 : « tout ce qui est adresse ne doit plus être visible ») : le nom du réseau suffit
  line.append(icon('wifi-high'), g.reseau ? `PC sur le réseau « ${g.reseau.nom} » (${g.reseau.type})` : g.adresses.length ? 'PC connecté au réseau local' : 'PC sans réseau')
  line.append(button('link-btn', 'Revérifier', () => api.phoneAction('diagnostic')))
  box.append(line)
  // Ce que le PC a reçu : une recherche du téléphone arrivée ici prouve que le réseau passe (reste à accepter)
  if (g.recherche && Date.now() - g.recherche.at < 15 * 60_000) {
    box.append(el('div', 'ph-diag-line', `recherche du téléphone reçue à ${time(g.recherche.at)} : le réseau passe`))
  } else if (!d || !online) {
    box.append(el('div', 'ph-diag-line', 'aucune recherche du téléphone reçue : il doit être sur le même Wi-Fi que le PC'))
  }
  if (g.bloque) {
    const warn = el('div', 'ph-warn')
    warn.append(icon('warning'), el('span', '', `Windows bloque le téléphone sur ce réseau (type « ${g.reseau?.type} »)${g.autoriseSur.length ? ` : Nuage n’y est autorisé que sur les réseaux ${g.autoriseSur.join(' et ')}` : ''}. Dans la page qui s’ouvre : « Modifier les paramètres », puis coche Privé et Public sur la ligne electron.exe.`))
    warn.append(button('btn secondary', 'Ouvrir le pare-feu', () => api.phoneAction('pare-feu')))
    box.append(warn)
  }
  if (g.refus) {
    const warn = el('div', 'ph-warn amber')
    warn.append(icon('device-mobile'), el('span', '', `Un téléphone ${REFUS[g.refus.raison] || 'est refusé.'}`))
    box.append(warn)
  } else if (d && !online && !g.bloque) {
    const hint = el('div', 'ph-warn soft')
    hint.append(icon('question'), el('span', '', 'Le téléphone ne frappe pas à la porte du PC. Même Wi-Fi des deux côtés ? Si l’adresse du PC a changé : dans l’appli, touche « hors de portée » (il cherche le PC), ou rescanne le QR code. Évite les réseaux « invités » de la box, qui isolent les appareils.'))
    box.append(hint)
  }
  return box
}
function renderPhone() {
  const box = $('telephone')
  if (phoneQr) {
    // À scanner : association (dans Nuage de poche) ou installation (appareil photo du téléphone)
    const install = phoneQr.mode === 'installer'
    const head = el('div', 'ph-head')
    const words = el('div', 'who-text')
    words.append(el('b', '', install ? 'Installer Nuage de poche' : 'Associer ton téléphone'),
      el('small', '', install ? 'Vise ce QR code avec l’appareil photo du téléphone : l’appli se télécharge depuis ce PC.' : 'Dans Nuage de poche : « scanner le QR code », puis vise celui-ci.'))
    head.append(words, backButton(closePhoneQr, 'icon-btn'))
    const img = el('img', 'ph-qr')
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(phoneQr.svg)}`
    img.alt = 'QR code'
    const parts = [head, img]
    if (install) parts.push(el('div', 'ph-diag-line', 'Valable 15 min, sur le même Wi-Fi que le PC.'))
    box.replaceChildren(...parts)
    return
  }
  const d = phone.devices[0]
  const online = isOnline(d)
  const parts = []
  const head = el('div', 'ph-head')
  const words = el('div', 'who-text')
  if (!d) {
    words.append(el('b', '', 'Nuage de poche'), el('small', '', 'Ton téléphone Android et ton PC s’échangent fichiers et copier-coller, sur ton Wi-Fi, tout chiffré.'))
    head.append(words, backButton(() => showTab('agents'), 'icon-btn'))
    parts.push(head)
    const steps = el('div', 'actions')
    const install = button('btn primary', 'Installer l’appli', () => api.phoneAction('installer'))
    install.disabled = !phone.apk
    steps.append(install, button('btn secondary', 'Associer', () => api.phoneAction('associer')))
    parts.push(steps)
    // Appli Android absente de ce dossier (copie sans telephone\) : on dit pourquoi le bouton est grisé et quoi faire
    if (!phone.apk) {
      const why = el('div', 'ph-warn soft')
      why.append(icon('question'), el('span', '', 'L’appli Android n’est pas dans ce dossier de Nuage (telephone\\nuage-de-poche.apk). Récupère la version complète de Nuage, ou construis l’appli : « npm run apk » dans le dossier mobile.'))
      parts.push(why)
    }
    const diag = phoneDiag(null, false)
    if (diag) parts.push(diag)
  } else {
    const charging = Boolean(online && d.etat?.charge)
    const meta = [d.etat?.android && `Android ${d.etat.android}`, d.etat?.version && `appli ${d.etat.version}`].filter(Boolean)
    const state = el('span', `ph-state${online ? ' on' : ''}`, online ? 'en ligne' : d.lastSeen ? `vu ${ago(d.lastSeen)}` : 'pas encore vu')
    const small = el('small')
    small.append(state, meta.length ? ` · ${meta.join(' · ')}` : '')
    words.append(el('b', '', d.nom || 'Téléphone'), small)
    head.append(words)
    const level = d.etat?.batterie
    if (level !== null && level !== undefined) {
      const bat = el('div', `ph-bat${charging ? ' charging' : level <= 15 ? ' low' : ''}`)
      bat.title = `Batterie du téléphone : ${level} %${charging ? `, en charge${d.etaPlein ? `, plein dans ~${d.etaPlein} min` : ''}` : ''}`
      if (charging) bat.append(chargeGlyph(level))
      bat.append(`${level} %`)
      if (charging) bat.append(el('small', '', level >= 100 ? 'chargé' : d.etaPlein ? `plein dans ~${d.etaPlein >= 60 ? `${Math.floor(d.etaPlein / 60)} h ${String(d.etaPlein % 60).padStart(2, '0')}` : `${d.etaPlein} min`}` : 'en charge'))
      head.append(bat)
    }
    head.append(backButton(() => showTab('agents'), 'icon-btn'))
    parts.push(head)
    if (!phone.linkOn) {
      const off = el('div', 'ph-warn')
      off.append(icon('wifi-slash'), el('span', '', 'Le lien est coupé : le téléphone ne peut plus joindre le PC.'), button('btn secondary', 'Rallumer', () => api.phoneAction('lien', true)))
      parts.push(off)
    } else {
      const diag = phoneDiag(d, online)
      if (diag && (!online || phone.diag?.bloque || phone.diag?.refus)) parts.push(diag)
    }
    const acts = el('div', 'ph-actions')
    acts.append(
      phoneAct('upload-simple', '#34d399', 'Fichiers', () => api.phoneAction('fichiers')),
      phoneAct('clipboard-text', '#8ec5ff', 'Presse-papiers', () => api.phoneAction('presse-papiers')),
      phone.ringing
        ? phoneAct('speaker-high', '#f5a524', 'Arrêter', () => api.phoneAction('sonner-stop'), true)
        : phoneAct('bell-ringing', '#f5a524', 'Faire sonner', () => api.phoneAction('sonner')),
      phoneAct('folder-open', '#a78bfa', 'Reçus', () => api.phoneAction('recus')),
    )
    parts.push(acts)

    // Copier-coller : réglage PC → téléphone, gestes téléphone → PC, historique (clic : recopier)
    parts.push(el('div', 'ph-sec', 'Copier-coller'))
    parts.push(phoneSwitch('PC → téléphone, tout seul dès que tu copies (sauf mots de passe)', phone.clipboardShare === 'auto', on => api.phoneAction('auto-pc', on)))
    const ways = el('div', 'ph-ways')
    for (const [ico, text] of [['cursor-text', 'texte sélectionné › Copier sur le PC'], ['hand-tap', 'appui long sur la bulle'], ['lightning', 'tuile des réglages rapides']]) {
      const chip = el('span', 'ph-way')
      chip.append(icon(ico), text)
      ways.append(chip)
    }
    parts.push(ways)
    if (phone.history.length) {
      const list = el('div', 'ph-list')
      phone.history.slice(0, 6).forEach((h, i) => {
        const row = button('ph-row', '', () => {
          api.phoneAction('recopier', i)
          play('pop')
        })
        row.title = 'Clic : le remettre dans le presse-papiers du PC'
        const dir = el('span', `ph-dir ${h.sens}`)
        dir.append(icon(h.sens === 'recu' ? 'arrow-down-left' : 'arrow-up-right'))
        row.append(dir, el('span', 'ph-text', h.texte || '(vide)'), el('span', 'ph-meta', `${h.sens === 'recu' ? SOURCE_WORD[h.source] || 'téléphone' : 'du PC'} · ${time(h.at)}`))
        list.append(row)
      })
      parts.push(list)
    }

    // Derniers transferts (clic : montrer le fichier dans l'Explorateur)
    if (phone.transfers.length) {
      parts.push(el('div', 'ph-sec', 'Transferts'))
      const list = el('div', 'ph-list')
      for (const t of phone.transfers.slice(0, 5)) {
        const row = button(`ph-row ph-tr ${t.etat}`, '', t.peutOuvrir ? () => api.phoneAction('montrer', t.id) : null)
        if (t.peutOuvrir) row.title = 'Clic : le montrer dans l’Explorateur'
        else row.disabled = true
        const dir = el('span', `ph-dir ${t.sens === 'recu' ? 'recu' : 'envoye'}`)
        dir.append(icon(FILE_ICON.find(([re]) => re.test(t.nom || ''))?.[1] || 'file'))
        let metaText = t.sens === 'recu' ? 'du téléphone' : 'vers le téléphone'
        if (t.etat === 'en-cours') metaText = `${t.taille ? Math.floor((t.fait / t.taille) * 100) : 0} %`
        else if (t.etat === 'annule') metaText = 'annulé'
        else metaText = `${metaText} · ${sizeText(t.taille)}`
        row.append(dir, el('span', 'ph-text', t.nom || 'fichier'), el('span', 'ph-meta', metaText))
        if (t.etat === 'en-cours') {
          const bar = el('i', 'ph-progress')
          bar.style.setProperty('--p', `${t.taille ? (t.fait / t.taille) * 100 : 0}%`)
          row.append(bar)
        }
        list.append(row)
      }
      parts.push(list)
    }

    parts.push(el('div', 'ph-sec', 'Nouvelles sur le téléphone'))
    parts.push(
      phoneSwitch('Claude Code a fini, ou attend ton accord', phone.notifyClaude, on => api.phoneAction('notif-claude', on)),
      phoneSwitch('Un téléchargement est terminé sur le PC', phone.notifyDownloads, on => api.phoneAction('notif-telechargements', on)),
    )
    const links = el('div', 'actions')
    links.append(
      button('btn secondary', 'Mettre à jour l’appli', () => api.phoneAction('installer')),
      button('btn secondary', 'Associer un autre téléphone', () => api.phoneAction('associer')),
      button('link-btn', 'Oublier ce téléphone', () => api.phoneAction('oublier')),
    )
    parts.push(links)
  }
  box.replaceChildren(...parts)
  requestAnimationFrame(markOverflow)
}
function onPhone(next) {
  if (!next) return
  const wasRinging = phone.ringing
  const before = new Map(phone.devices.map(d => [d.id, d.etat?.charge]))
  phone = { ...phone, ...next }
  // Téléphone associé pendant que son QR code était affiché : le QR code s'efface, le téléphone apparaît
  if (phoneQr?.mode === 'associer' && phone.devices.some(d => !before.has(d.id))) phoneQr = null
  if (phone.ringing && !wasRinging) play('ding')
  // Branché à l'instant : la pilule sort et le dit quelques secondes
  for (const d of phone.devices) {
    if (before.has(d.id) && !before.get(d.id) && d.etat?.charge) {
      chargeFlash = { until: Date.now() + 6000, text: `${d.nom} en charge · ${d.etat.batterie} %` }
      calmSince = Date.now()
      if (state === 'cache') setState('barre')
      setTimeout(renderBar, 6100)
    }
  }
  renderPhone()
  renderPills()
  renderBar()
}
api.onPhone(onPhone)
// QR code d'association ou d'installation (08/10/2026 : dans la barre, plus dans une fenêtre à part)
api.onPhoneQr(q => {
  phoneQr = q?.svg ? q : null
  showTab('telephone')
  openPanel(180_000)
  renderPhone()
  animateTo() // la hauteur suit le QR code (sinon il était coupé)
})
function closePhoneQr() {
  phoneQr = null
  api.phoneAction('qr-fermer')
  renderPhone()
  if (state === 'ouvert') animateTo()
}
api.onTab(name => {
  showTab(name === 'integrations' ? 'agents' : String(name))
  openPanel(20_000)
})

// ---------- Voix : « Hey Nuage » (05/10/2026) ----------
// La pilule montre ce que Nuage entend ; le bouton micro de l'en-tête coupe ou rallume l'écoute.
let voiceTimer = null
function onVoice(next) {
  if (!next) return
  voice = { ...voice, ...next, wanted: next.on || (next.etat !== 'arret' && voice.wanted) }
  document.body.classList.toggle('voice-on', Boolean(voice.on))
  const listening = voice.etat === 'ecoute' || voice.etat === 'compris'
  document.body.classList.toggle('voice-listening', listening)
  $('mic-btn').title = voice.on ? '« Hey Nuage » : je t’écoute (clic pour couper)' : 'Écoute coupée : clic pour que j’entende « Hey Nuage »'
  // La pilule sort pendant qu'il écoute, puis l'état revient au calme
  if (listening || voice.etat === 'parle') {
    calmSince = Date.now()
    if (state === 'cache') setState('barre')
  }
  clearTimeout(voiceTimer)
  if (voice.etat === 'compris' || voice.etat === 'silence') voiceTimer = setTimeout(() => onVoice({ etat: 'repos', texte: '' }), 3500)
  renderBar()
  if (state === 'barre') animateTo()
}
api.onVoice(onVoice)
// Bouton micro du chat (comme sur le téléphone) : ce que tu dis s'écrit dans la case en direct, puis part
// à Claude ; la réponse est lue à voix haute
let talkTyping = false
api.onVoice(v => {
  const input = $('input')
  if (v?.etat === 'ecoute' && talkTyping) {
    input.value = v.texte || ''
    input.placeholder = v.texte ? '' : 'Je t’écoute…'
    autosize()
  } else if (talkTyping && v && v.etat !== 'ecoute') {
    talkTyping = false
    input.value = ''
    input.placeholder = 'Demande-moi n’importe quoi…'
    autosize()
  }
})
$('talk').addEventListener('click', () => {
  talkTyping = true
  $('input').value = ''
  $('input').placeholder = 'Je t’écoute…'
  holdUntil = Math.max(holdUntil, Date.now() + 20_000) // la barre reste ouverte pendant que tu parles
  api.listen()
  play('ding')
})
api.onFold(() => fold())
$('mic-btn').addEventListener('click', () => {
  api.setVoice(!voice.on)
  play('pop')
})

// ---------- Chat ----------
// Texte de l'IA, jamais interprété comme du HTML : blocs ```, titres #, listes -, **gras**, `code`.
// [[installer: X]] (chat.js systemPrompt, IA sans outils) devient un bouton : les réglages s'ouvrent sur l'examen de X, l'installation
// attend le clic de l'utilisateur là-bas (07/10/2026).
const INSTALL_TAG = /^\s*\[\[\s*installer\s*:\s*(.+?)\s*\]\]\s*$/i
function inline(text) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((p, k) => (k % 2 ? (p[0] === '`' ? el('code', '', p.slice(1, -1)) : el('b', '', p.slice(2, -2))) : p))
}
function richText(node, text) {
  node.replaceChildren()
  String(text).split(/```[a-zA-Z0-9]*\n?/).forEach((part, i) => {
    if (!part) return
    if (i % 2) return node.append(el('pre', '', part.replace(/\n$/, '')))
    part.split('\n').forEach((line, j) => {
      if (j) node.append('\n')
      const tag = line.match(INSTALL_TAG)
      if (tag) {
        // Libellé court (« pdf », « nom » d'un /plugin install nom@catalogue) ; le lien entier au survol
        const name = tag[1].match(/install\s+([^\s@]+)/)?.[1] || tag[1].replace(/\/(SKILL\.md)?$/i, '').split('/').pop().replace(/\.zip$/i, '')
        const b = button('install-btn', `Ajouter « ${name} »…`, () => openReglages({ prefill: tag[1] }))
        b.title = tag[1]
        return node.append(b)
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return
      if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) return // image : montrée en vignette sous le message
      const head = line.match(/^#{1,6}\s+(.*)/)
      if (head) return node.append(el('b', '', head[1].replace(/\*\*/g, '')))
      const item = line.match(/^(\s*)[-*]\s+(.*)/)
      node.append(...(item ? [`${item[1]}• `, ...inline(item[2])] : inline(line)))
    })
  })
}
function typingDots() {
  const dots = el('div', 'typing')
  dots.append(el('i'), el('i'), el('i'))
  return dots
}
function scrollMessages() {
  const box = $('messages')
  box.scrollTop = box.scrollHeight
}
function renderMessages() {
  const box = $('messages')
  if (!chat.messages.length) {
    renderedMessages = 0
    box.replaceChildren(el('div', 'empty', chat.session?.fresh
      ? `Nouvelle session Claude Code dans « ${chat.session.project} ». Écris ta première demande : je peux lire, modifier et exécuter, toujours avec ton accord.`
      : chat.session
        ? `Session « ${chat.session.title} » : écris pour la continuer, je reprends tout ce qui s’y est dit.`
        : homeMode
          ? 'Écris ta question, ou dis « Hey Nuage ». Pour me montrer un fichier ou un dossier, glisse-le sur la barre.'
          : 'Écris ta question. Pour montrer un fichier, glisse-le sur la barre ; pour montrer une fenêtre, lâche Nuage dessus en tenant Maj.'))
    return
  }
  const nodes = []
  chat.messages.forEach((m, i) => {
    const node = el('div', `msg ${m.role}${m.error ? ' error' : ''}${m.past ? ' past' : ''}${i >= renderedMessages && !m.past ? ' appear' : ''}`)
    node.dataset.index = String(i)
    if (m.files?.length) {
      const files = el('div', 'files with-ico')
      files.append(icon('paperclip'), m.files.join(', '))
      node.append(files)
    }
    const writing = chat.streaming && i === chat.messages.length - 1 && m.role === 'assistant'
    if (writing && !m.text) {
      node.append(typingDots())
    } else {
      const body = el('div', `text${writing ? ' caret' : ''}`)
      richText(body, m.error || m.text || '')
      node.append(body)
    }
    // Images de la réponse (ex. créée par Gemini) : un clic l'ouvre en grand
    if (m.images?.length) {
      const row = el('div', 'chat-imgs')
      m.images.forEach((im, k) => {
        const img = el('img', 'chat-img')
        img.src = im.thumb
        img.alt = im.name
        img.title = `${im.name} : clique pour l’ouvrir`
        img.addEventListener('click', () => chatApi.openImage(i, k))
        row.append(img)
      })
      node.append(row)
    }
    nodes.push(node)
    // Fin de l'historique de la session reprise
    if (m.past && !chat.messages[i + 1]?.past) nodes.push(el('div', 'divider', chat.messages[i + 1] ? 'Nuage reprend ici' : 'Écris pour continuer la session'))
  })
  box.replaceChildren(...nodes)
  renderedMessages = chat.messages.length
  scrollMessages()
}
// Autorisation demandée par la session reprise (lire, modifier, exécuter…)
function renderPermission() {
  const box = $('chat-perm')
  const p = chat.permission
  box.hidden = !p
  if (!p) {
    box.dataset.id = ''
    return
  }
  if (box.dataset.id === p.id) return
  box.dataset.id = p.id
  const always = button('btn secondary', 'Toujours', () => chatApi.permission(p.id, 'always'))
  always.title = 'Autoriser encore exactement cette action (même commande, même fichier ou même site) dans cette discussion'
  const actions = el('div', 'actions')
  actions.append(
    button('btn secondary', 'Refuser', () => {
      chatApi.permission(p.id, 'deny')
      play('boum')
    }),
    always,
    button('btn primary', 'Autoriser', () => {
      chatApi.permission(p.id, 'allow')
      play('pop')
    }),
  )
  const title = el('b', 'with-ico')
  title.append(icon('lock-key'), p.label)
  box.replaceChildren(title, ...(p.command ? [el('div', 'code', p.command)] : []), actions)
  play('ding')
  if (nuageAvatar) tempMood('surprised', 900)
}
function renderAttachments() {
  const row = $('attachments')
  const key = chat.attachments.map(a => a.name).join('|')
  if (row.dataset.key === key) return
  row.dataset.key = key
  row.replaceChildren(...chat.attachments.map((a, i) => {
    const chip = el('span', 'chip')
    if (a.thumb) {
      const img = el('img')
      img.src = a.thumb
      img.alt = ''
      chip.append(img)
    } else {
      chip.append(el('i', 'chip-dot'))
    }
    chip.append(el('span', '', a.name))
    const remove = button('', '✕', () => chatApi.unattach(i))
    remove.title = 'Retirer'
    chip.append(remove)
    // Contour blanc qui s'efface : le fichier « se pose » dans la conversation
    requestAnimationFrame(() => requestAnimationFrame(() => chip.classList.add('settled')))
    return chip
  }))
}
function renderModelButton() {
  const dot = document.querySelector('.model-dot')
  const s = chat.session
  $('leave-session').hidden = !s
  if (s) {
    // Le chat prolonge une session Claude Code
    $('model-label').replaceChildren(`Session : ${s.title} `, el('span', 'sub', s.fresh ? `dans ${s.project}` : s.model ? s.model.replace(/^claude-/, '') : ''))
    $('model-btn').title = s.fresh
      ? `Nouvelle session Claude Code dans « ${s.project} ». Clic : changer.`
      : `Session Claude Code « ${s.title} » (${s.project}) : Nuage reprend tout ce qui s’y est dit${s.copy ? ', dans une copie' : ''}. Clic : changer.`
    dot.className = 'model-dot session'
    return
  }
  const current = chat.providers.find(p => p.id === chat.provider)
  const effort = current?.efforts?.includes(chat.effort) ? ` · ${EFFORT_LABEL[chat.effort]}` : ''
  $('model-label').replaceChildren(`${current?.label || 'IA'} `, el('span', 'sub', `${chat.model || 'aucun modèle'}${effort}`))
  $('model-btn').title = 'Changer de session, d’IA ou de modèle'
  dot.className = `model-dot${current?.ready ? ' ready' : ''}`
}
function renderKeyhint() {
  // Une session reprise passe par Claude Code : il faut être connecté au compte Claude
  const current = chat.providers.find(p => p.id === (chat.session ? 'claudecode' : chat.provider))
  const hintBox = $('keyhint')
  const wasHidden = hintBox.hidden
  hintBox.hidden = Boolean(current?.ready)
  if (!current?.ready) {
    hintBox.replaceChildren(el('span', '', current?.note || ''))
    if (current?.subscription && !/introuvable/.test(current.note || '')) {
      // Connexion unique au compte Claude (fenêtre + navigateur), sans clé d'API
      hintBox.append(button('', 'Se connecter à Claude', async () => {
        const r = await chatApi.login()
        hintBox.replaceChildren(el('span', '', r?.message || ''))
      }))
    } else if (current?.account) {
      // Gemini (Antigravity) / ChatGPT (Codex) : installation et connexion dans « Comment faire marcher Nuage »
      hintBox.append(button('', 'Configurer', () => openReglages({ section: 'ia', focus: current.id })))
    } else if (current && !current.local && !current.subscription) {
      hintBox.append(button('', 'Ajouter ma clé', () => openReglages({ section: 'ia', focus: current.id })))
    }
  }
  if (wasHidden !== hintBox.hidden && state === 'ouvert') animateTo()
}
// Changement de fournisseur : liste de ses modèles
async function renderChoices() {
  renderKeyhint()
  const provider = chat.provider
  const list = await chatApi.listModels(provider).catch(() => [])
  if (provider !== chat.provider) return
  models = [...new Set([chat.model, ...list].filter(Boolean))]
  if (!chat.model && models[0]) chatApi.choose(provider, models[0])
  if (!$('model-menu').hidden) renderMenu()
}
// Menu « changer d'IA ou de modèle » (clic sur le nom du modèle, comme chez Coucou)
function renderMenu() {
  // Sessions Claude Code : le chat les continue (prolongement de Claude)
  const sessions = (chat.sessions || []).map(s => {
    const b = button(`sess${chat.session?.id === s.id ? ' on' : ''}`, '', async () => {
      closeMenu()
      await chatApi.continueSession(s.id)
      $('input').focus()
    })
    b.title = `${s.project}, ${ago(s.lastAt)}`
    b.append(colored(el('span', 'dot'), STATE_COLOR[s.status] || '#6b7079'), el('span', 'name', s.title), el('span', 'state', ago(s.lastAt)))
    return b
  })
  const provs = chat.providers.map(p => {
    const b = button(`prov${!chat.session && p.id === chat.provider ? ' on' : ''}`, '', () => {
      if (chat.session) chatApi.leaveSession()
      if (p.id !== chat.provider) chatApi.choose(p.id, '')
    })
    const label = p.subscription || p.account ? (p.ready ? '✓ connecté' : 'à connecter') : p.local ? 'sur le PC' : p.ready ? '✓ clé' : 'clé manquante'
    b.append(el('span', 'name', p.label), el('span', `state${p.ready && !p.local ? ' ok' : ''}`, label))
    return b
  })
  const list = el('div', 'models')
  // Beaucoup de modèles (OpenRouter : plusieurs centaines) : une recherche au-dessus de la liste
  const fill = () => {
    const shown = models.filter(id => id.toLowerCase().includes(modelFilter)).slice(0, 150)
    list.replaceChildren(...shown.map(id => button(id === chat.model ? 'on' : '', id, () => {
      chatApi.choose(chat.provider, id)
      modelFilter = ''
      closeMenu()
      $('input').focus()
    })))
    if (!shown.length) list.append(el('span', 'note', models.length ? 'Aucun modèle ne correspond.' : 'Aucun modèle trouvé.'))
  }
  fill()
  let search = null
  if (models.length > 24) {
    search = el('input', 'model-search')
    search.type = 'text'
    search.placeholder = `Chercher parmi ${models.length} modèles (ex. claude, gpt, llama)…`
    search.value = modelFilter
    search.addEventListener('input', () => {
      modelFilter = search.value.trim().toLowerCase()
      fill()
    })
  }
  const grid = el('div', 'provs')
  grid.append(...provs)
  // Nouvelle session Claude Code : ici (dossier de la dernière session) ou dans un autre dossier
  const fresh = button('sess new', '', () => startNewSession(false))
  fresh.append(el('span', 'plus-icon', '+'), el('span', 'name', 'Nouvelle session'))
  const elsewhere = button('sess new', '', () => startNewSession(true))
  elsewhere.append(el('span', 'plus-icon', '+'), el('span', 'name', 'Nouvelle session dans un autre dossier…'))
  // Effort de réflexion (Gemini, ChatGPT par abonnement) : plus haut = réponse plus réfléchie, plus lente
  const current = chat.providers.find(p => p.id === chat.provider)
  const efforts = el('div', 'models')
  if (current?.efforts?.length) {
    efforts.append(...['', ...current.efforts].map(e => button((chat.effort || '') === e ? 'on' : '', EFFORT_LABEL[e] || e, () => {
      chatApi.setEffort(e)
      closeMenu()
      $('input').focus()
    })))
  }
  $('model-menu').replaceChildren(
    el('div', 'sec', 'Sessions Claude Code'), fresh, elsewhere, ...sessions,
    el('div', 'sec', chat.session ? 'Ou discuter sans session avec' : 'Intelligence artificielle'), grid,
    ...(chat.session ? [] : [el('div', 'sec', 'Modèle'), ...(search ? [search] : []), list]),
    ...(chat.session || !efforts.children.length ? [] : [el('div', 'sec', 'Effort'), efforts]),
  )
  if (search && modelFilter) search.focus()
}
let modelFilter = '' // texte de la recherche de modèles (gardé si le menu se redessine)
const EFFORT_LABEL = { '': 'Auto', low: 'Faible', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max' }
$('leave-session').addEventListener('click', () => {
  chatApi.leaveSession()
  $('input').focus()
})
function toggleMenu(open) {
  const menu = $('model-menu')
  if (menu.hidden === !open) return
  menu.hidden = !open
  $('model-btn').classList.toggle('open', open)
  if (open) renderMenu()
  if (state === 'ouvert') animateTo() // le panneau s'agrandit un peu pour le menu
}
function closeMenu() {
  toggleMenu(false)
}
$('model-btn').addEventListener('click', () => toggleMenu($('model-menu').hidden))
document.addEventListener('mousedown', e => {
  if (!$('model-menu').hidden && !e.target.closest?.('#model-menu, #model-btn')) closeMenu()
})

function onChat(next) {
  if (!next) return
  const choices = next.provider !== chat.provider || next.providers.length !== chat.providers.length ||
    next.providers.some((p, i) => p.ready !== chat.providers[i]?.ready)
  const sessionChanged = (next.session?.key || '') !== (chat.session?.key || '')
  const wasStreaming = chat.streaming
  if (sessionChanged) renderedMessages = 0
  chat = next
  $('send').hidden = chat.streaming
  $('stop').hidden = !chat.streaming
  renderMessages()
  renderPermission()
  renderAttachments()
  renderModelButton()
  if (tab === 'agents') renderHomeLeft() // l'accueil montre la discussion en cours
  if (choices) renderChoices()
  else if (sessionChanged) renderKeyhint()
  if (!$('model-menu').hidden) renderMenu()
  if (chat.streaming) calmSince = Date.now()
  if (wasStreaming && !chat.streaming) {
    // Réponse arrivée : Nuage saute de joie ; si tu regardais ailleurs, la pilule te prévient
    const failed = Boolean(chat.messages.at(-1)?.error)
    celebrateUntil = Date.now() + 2600
    setTimeout(renderBar, 2700)
    if (nuageAvatar && !failed) {
      tempMood(pick(['celebrate', 'proud', 'happy']), 1700)
      sparkle(8)
    }
    if (state !== 'ouvert' || !document.hasFocus()) {
      unread = true
      if (!failed) play('pop')
    }
  }
  renderBar()
  if (state === 'ouvert') animateTo() // la hauteur suit la conversation
  evaluate()
}
chatApi.onState(onChat)
chatApi.onDelta(({ index, text }) => {
  const m = chat.messages[index]
  if (!m) return
  m.text = (m.text || '') + text
  const node = document.querySelector(`.msg[data-index="${index}"]`)
  if (!node) return
  const box = $('messages')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  let body = node.querySelector('.text')
  if (!body) {
    node.querySelector('.typing')?.remove()
    body = el('div', 'text caret')
    node.append(body)
    renderBar() // il réfléchissait, maintenant il écrit
  }
  richText(body, m.text)
  if (atBottom) scrollMessages() // ne pas te ramener en bas si tu relis plus haut
})
// Ouvrir le chat sur commande (menu, Nuage lâché dans la barre, fichier déposé, Maj+lâcher)
function openChatHere(opts = {}) {
  showTab('chat')
  openPanel(20_000)
  if (opts?.nuage) nuageEnter()
  api.focus()
  $('input').focus()
}
chatApi.onOpen(openChatHere)

function autosize() {
  const input = $('input')
  input.style.height = 'auto'
  input.style.height = `${Math.min(92, input.scrollHeight)}px`
}
$('input').addEventListener('input', () => {
  lastActivity = Date.now()
  autosize()
  renderMood()
})
$('input').addEventListener('focus', evaluate)
$('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    $('composer').requestSubmit()
  }
})
$('composer').addEventListener('submit', e => {
  e.preventDefault()
  const text = $('input').value.trim()
  // « /plugin … » ou « /skill <lien> » : ce n'est pas une question pour l'IA, les Réglages (Compétences) l'examinent
  // (Nuage montre ce qui serait ajouté ; rien ne s'installe sans un clic)
  if (/^\/(plugins?|skills?|comp[ée]tences?)\b/i.test(text)) {
    openReglages({ prefill: text })
    $('input').value = ''
    autosize()
    return
  }
  if ((!text && !chat.attachments.length) || chat.streaming) return
  chatApi.send(text)
  $('input').value = ''
  autosize()
  play('pop')
})
$('stop').addEventListener('click', () => chatApi.stop())
$('pick').addEventListener('click', async () => {
  picking = true
  evaluate()
  try {
    await chatApi.pickFiles()
  } finally {
    picking = false
    holdUntil = Math.max(holdUntil, Date.now() + 15_000)
    api.focus()
    $('input').focus()
    evaluate()
  }
})

// Icônes posées dans la page (data-icon) : zone de dépôt
for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon))

// ---------- Vues ----------
// Onglets : accueil (agents), chat ; le téléphone s'ouvre par sa pastille. Une alerte passe devant tout, puis
// le détail (code, étape, activité), puis l'onglet. body[data-view] place Nuage (élément partagé).
const PANES = { chat: 'pane-chat', agents: 'pane-agents', telephone: 'pane-telephone', reglages: 'pane-reglages' }
function syncView() {
  const a = currentAlert()
  const view = dragging || gulping ? 'drop' : a ? 'alert' : diffView ? 'diff' : { agents: 'home', chat: 'chat', telephone: 'phone', reglages: 'reglages' }[tab] || 'chat'
  $('cnx-btn').classList.toggle('on', tab === 'reglages')
  const changed = document.body.dataset.view !== view
  document.body.dataset.view = view
  $('pane-alert').classList.toggle('on', view === 'alert')
  $('diff').classList.toggle('on', view === 'diff')
  for (const [key, id] of Object.entries(PANES)) $(id).classList.toggle('on', !a && !diffView && key === tab)
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === (tab === 'telephone' ? 'agents' : tab) && view !== 'alert')
  if (changed && state === 'ouvert') animateTo()
}
function showTab(name) {
  tab = name
  diffView = null
  stepView = null
  activityOf = null
  document.body.dataset.tab = name
  if (name === 'chat') {
    unread = false
    renderBar()
    scrollMessages()
  }
  if (name === 'agents') {
    renderHome()
    api.refreshUsage() // limites relues si elles datent de plus de 25 s
  }
  if (name === 'telephone') {
    renderPhone()
    api.phoneAction('diagnostic') // réseau et pare-feu relus à l'ouverture
  }
  renderBar()
  syncView()
  if (state === 'ouvert') animateTo()
}
for (const b of document.querySelectorAll('.tabs button[data-tab]')) {
  b.addEventListener('click', () => {
    if (b.dataset.tab === 'agents') homeDetail = null
    showTab(b.dataset.tab)
  })
}

// ---------- Réglages : tous dans la barre (08/10/2026 : « l'utilisateur ne va pas aller ailleurs ») ----------
// Roue dentée, « Ajouter ma clé », « /plugin … », premier lancement, menu de l'icône : tout ouvre cette vue.
const reglages = createReglages({
  root: $('reglages'),
  api: api.reglages,
  loginClaude: () => chatApi.login(),
  isOpen: () => tab === 'reglages',
  layout: () => { if (state === 'ouvert') animateTo() },
  goPhone: () => showTab('telephone'),
  onLater: () => showTab('chat'),
})
let beforeSettings = 'chat' // onglet d'avant (un deuxième clic sur la roue dentée y revient)
function openReglages(request = {}) {
  if (tab !== 'reglages') beforeSettings = tab
  showTab('reglages')
  openPanel(request.welcome ? 600_000 : 20_000)
  reglages.open(request)
}
api.reglages.onOpen(openReglages)

// ---------- Fichier glissé sur l'îlot : demander à l'IA, envoyer par e-mail, donner à Nuage, au téléphone ----------
// (07/10/2026 : « le nuage vient là-bas, il essaie de l'avaler ; quand il avale, c'est la fonction de la case qui
// s'exécute ») : Nuage glouton vole vers la case survolée, la bouche ouverte, les yeux sur le fichier ; au lâcher, le
// fichier file dans sa bouche, il l'avale (écrasement, joues roses), puis l'action de la case part.
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')
let dragDepth = 0
const eater = $('eater')
const eaterAt = { x: 0, y: 0 }
function eaterTo(targetEl, e = null, jump = false) {
  const box = $('drop').getBoundingClientRect()
  let x = box.width / 2
  let y = box.height / 2
  if (targetEl) {
    const r = targetEl.getBoundingClientRect()
    x = r.left - box.left + r.width / 2
    y = r.top - box.top + r.height * 0.3 // à la place de l'icône de la case, son nom reste lisible dessous
  }
  eaterAt.x = x
  eaterAt.y = y
  eater.classList.toggle('jump', jump)
  eater.style.setProperty('--ex', `${x}px`)
  eater.style.setProperty('--ey', `${y}px`)
  eater.classList.toggle('hungry', Boolean(targetEl))
  // Les yeux suivent le fichier (le curseur)
  if (e) {
    const dx = Math.max(-1, Math.min(1, (e.clientX - box.left - x) / 90))
    const dy = Math.max(-1, Math.min(1, (e.clientY - box.top - y) / 60))
    $('eater-eyes').style.transform = `translate(${(dx * 1.3).toFixed(2)}px, ${(dy * 1).toFixed(2)}px)`
  }
}
// Le fichier part du point de lâcher vers la bouche ; Nuage l'avale ; la promesse se résout quand c'est avalé
function swallowAnimation(e, targetEl, count) {
  return new Promise(resolve => {
    if (reduceMotion) return resolve()
    const box = $('drop').getBoundingClientRect()
    const morsel = $('morsel')
    morsel.dataset.n = count > 1 ? String(count) : ''
    morsel.className = 'morsel show'
    morsel.style.transform = `translate(${e.clientX - box.left}px, ${e.clientY - box.top}px)`
    eaterTo(targetEl, e)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      morsel.classList.add('flying')
      morsel.style.transform = `translate(${eaterAt.x}px, ${eaterAt.y + 7}px) scale(.18) rotate(-24deg)`
    }))
    setTimeout(() => {
      morsel.className = 'morsel'
      eater.classList.remove('hungry')
      eater.classList.add('gulp')
      targetEl.classList.add('done')
      play('glouglou')
    }, 360)
    setTimeout(() => eater.classList.add('happy'), 620)
    setTimeout(resolve, 760)
  })
}
function closeDrop() {
  gulping = false
  $('drop').hidden = true
  eater.className = 'eater'
  $('eater-eyes').style.transform = ''
  for (const t of document.querySelectorAll('.drop-target')) t.classList.remove('over', 'done')
  syncView()
}
addEventListener('dragenter', e => {
  if (!hasFiles(e) || gulping) return
  e.preventDefault()
  dragDepth += 1
  if (!dragging) {
    dragging = true
    $('drop').hidden = false
    syncView()
    requestAnimationFrame(() => eaterTo(null, e, true)) // il apparaît au milieu, sans glisser depuis le coin
  }
  evaluate()
})
addEventListener('dragover', e => {
  if (!hasFiles(e) || gulping) return
  e.preventDefault()
  const over = e.target.closest?.('.drop-target') || null
  for (const t of document.querySelectorAll('.drop-target')) t.classList.toggle('over', t === over)
  eaterTo(over, e)
})
addEventListener('dragleave', () => {
  if (gulping) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) {
    dragging = false
    closeDrop()
    evaluate()
  }
})
addEventListener('drop', async e => {
  e.preventDefault()
  dragDepth = 0
  dragging = false
  const targetEl = e.target.closest?.('.drop-target')
  const target = targetEl?.dataset.target
  const paths = [...(e.dataTransfer?.files || [])].map(f => api.pathForFile(f)).filter(Boolean)
  if (!target || !paths.length) {
    closeDrop()
    evaluate()
    return
  }
  gulping = true
  holdUntil = Math.max(holdUntil, Date.now() + 3000)
  await swallowAnimation(e, targetEl, paths.length) // c'est en l'avalant qu'il lance l'action de la case
  closeDrop()
  if (target === 'chat') {
    holdUntil = Date.now() + 20_000 // le chat s'ouvre avec le fichier joint
    api.dropToChat(paths)
  } else if (target === 'phone') {
    api.dropToPhone(paths)
    showToast({ text: paths.length > 1 ? `Je file au téléphone avec ${paths.length} fichiers !` : 'Je file au téléphone avec ton fichier !', icon: ['device-mobile', 'pelouse'], ms: 3500 })
  } else if (target === 'swallow') {
    await feedNuage(paths)
  } else {
    const result = await api.dropToEmail(paths)
    if (result?.message) showToast({ text: result.message, icon: ['envelope-simple', 'ciel'] })
  }
  evaluate()
})
// Fichiers donnés à Nuage (cible « Donner à Nuage ») : il les avale, ils vont à la corbeille ; une minute pour
// annuler (clic sur la bulle). Mêmes protections que sur le bureau (dossiers importants, système : refusés).
const shortName = (text, max = 40) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text))
async function feedNuage(paths) {
  document.body.classList.add('gulp')
  setTimeout(() => document.body.classList.remove('gulp'), 700)
  if (nuageAvatar) tempMood('excited', 900)
  const result = (await api.dropToSwallow(paths)) || { trashed: [], refused: [], failed: [] }
  const eaten = result.trashed.length
  const refused = result.refused[0]
  if (eaten) {
    play('glouglou')
    const what = eaten === 1 ? `« ${shortName(result.trashed[0].name)} » est` : `${eaten} éléments sont`
    const note = refused ? ` Je recrache « ${shortName(refused.name, 30)} » : ${refused.reason}.` : ''
    showToast({ text: `Miam ! ${what} dans la corbeille.${note} Clique pour annuler.`, icon: ['trash', 'pelouse'], ms: 15_000, action: undoFeed })
  } else if (refused) {
    if (nuageAvatar) tempMood('confused', 1800)
    showToast({ text: `Beurk ! Je ne mange pas « ${shortName(refused.name)} » : ${refused.reason}.`, icon: ['x-circle', 'alerte'], ms: 6000 })
  } else {
    showToast({ text: `Je n’ai pas réussi à avaler « ${shortName(result.failed[0]?.name || '?')} » (ouvert ailleurs ou introuvable).`, icon: ['warning', 'alerte'], ms: 6000 })
  }
}
async function undoFeed() {
  showToast({ text: 'Beurk, je recrache tout…', icon: ['arrow-u-up-left', 'ciel'], ms: 2500 })
  const r = await api.undoSwallow()
  if (r?.restored?.length && !r.failed?.length) {
    showToast({ text: `C’est revenu à sa place : ${r.restored.length === 1 ? `« ${shortName(r.restored[0])} »` : `${r.restored.length} éléments`}.`, icon: ['arrow-u-up-left', 'pelouse'], ms: 4000 })
  } else {
    showToast({ text: r?.expired ? 'Trop tard pour annuler (plus d’une minute) : regarde dans la corbeille.' : 'Je n’ai pas pu tout recracher : regarde dans la corbeille.', icon: ['warning', 'alerte'], ms: 6000 })
  }
}

// ---------- Réception ----------
api.onHint(on => {
  hint = Boolean(on)
  document.body.classList.toggle('hint', hint)
  renderBar()
  evaluate()
  if (hint && state !== 'ouvert') squash()
})
// Une session vient de finir (elle travaillait) : carte « Claude Code a terminé » 5,2 s, comme chez Coucou
function noticeFinished(next) {
  if (firstAgents) {
    firstAgents = false
    for (const s of next.sessions) prevStatus.set(s.id, s.status)
    return
  }
  for (const s of next.sessions) {
    const before = prevStatus.get(s.id)
    prevStatus.set(s.id, s.status)
    if (s.status !== 'termine' || !['en-cours', 'permission', 'attente'].includes(before)) continue
    if (Date.now() < celebrateUntil || chat.streaming) continue // le chat de Nuage vient de répondre : il le fête déjà
    const said = s.steps.find(st => st.kind === 'message')
    finished = {
      sessionId: s.id, title: s.title, color: colorFor(s.project || s.title), until: Date.now() + 5200,
      summary: said ? shortName(said.label.replace(/^Dit : /, ''), 90) : '',
    }
    play('succes')
    if (state !== 'ouvert') openPanel(5200)
    else holdUntil = Math.max(holdUntil, Date.now() + 5200)
  }
}
function onAgents(next) {
  if (!next) return
  noticeFinished(next)
  agents = next
  if (busy()) calmSince = Date.now()
  renderHome()
  renderAlert()
  // Activité en direct : le détail ou la liste ouverts suivent ce que fait Claude
  if (diffView && stepView) showStep(stepView.sessionId, stepView.stepId, stepView.from, true)
  else if (diffView && activityOf) showActivity(activityOf)
  evaluate()
  if (state === 'ouvert') animateTo()
}
function onIntegrations(next) {
  integrations = next || []
  renderPills()
  if (homeDetail?.startsWith('integ:')) renderHomeLeft()
  renderBar()
}
function onWeather(w) {
  pillWeather = w || null
  renderPillRight()
  buddySkin?.setWeather(pillWeather)
}
api.onWeather(onWeather)
function onSettings(next) {
  settings = { ...settings, ...next }
  setSounds(settings.soundsOn, settings.volume)
  document.body.classList.toggle('muted', !settings.soundsOn)
  const wasHome = homeMode
  homeMode = Boolean(settings.home)
  document.body.classList.toggle('home', homeMode)
  startBuddy()
  const swallowTarget = document.querySelector('.drop-target[data-target="swallow"]')
  if (swallowTarget) swallowTarget.hidden = settings.feedOn === false
  if (homeMode !== wasHome) {
    if (homeMode && state === 'cache') setState('barre')
    if (!nuageInside) homeAvatar(homeMode && state === 'ouvert')
    renderBar()
    animateTo()
  }
  evaluate()
}
api.onOpen(() => openPanel(15_000))
api.onToggle(() => (state === 'ouvert' ? fold() : openPanel(15_000)))

// Pour l'auto-test (partie « encoche ») : bulle, repas, repli, fin de session, « trop de clics »
globalThis.encocheTest = {
  toast: showToast, feed: feedNuage, fold,
  // Réponse d'IA affichée telle quelle (Markdown, balise [[installer: …]]) ; rend le HTML obtenu
  reply: text => {
    chat.messages.push({ role: 'assistant', text })
    renderMessages()
    return $('messages').lastElementChild.innerHTML
  },
  finished: (title = 'korus', summary = 'Migration appliquée, 14 tests passés.') => {
    finished = { sessionId: 'test', title, summary, color: colorFor(title), until: Date.now() + 5200 }
    renderAlert()
    renderBar()
    openPanel(5200)
  },
  dizzy: () => {
    confusedUntil = Date.now() + 3300
    renderAlert()
    renderBar()
    openPanel(3300)
  },
  // Nuage glouton sans vrai glisser (la souris de l'utilisateur n'est jamais utilisée) : survol d'une case, puis il avale
  // (l'action de la case n'est pas lancée)
  dropDemo: async (name = 'email') => {
    const box = document.querySelector(`.drop-target[data-target="${name}"]`)
    dragging = true
    $('drop').hidden = false
    syncView()
    evaluate()
    await new Promise(resolve => setTimeout(resolve, 500))
    const r = box.getBoundingClientRect()
    const file = { clientX: r.right - 18, clientY: r.bottom - 22 }
    eaterTo(null, file, true)
    await new Promise(resolve => setTimeout(resolve, 250))
    for (const t of document.querySelectorAll('.drop-target')) t.classList.toggle('over', t === box)
    eaterTo(box, file)
    return name
  },
  dropDemoSwallow: async (name = 'email') => {
    const box = document.querySelector(`.drop-target[data-target="${name}"]`)
    const r = box.getBoundingClientRect()
    dragging = false
    gulping = true
    await swallowAnimation({ clientX: r.right - 18, clientY: r.bottom - 22 }, box, 2)
    closeDrop()
    evaluate()
  },
}
// Pour l'auto-test : pourquoi l'îlot est ouvert ou replié
globalThis.etatEncoche = () => ({
  state, view: document.body.dataset.view, hovering, typing: typing(), hold: Math.max(0, Math.round((holdUntil - Date.now()) / 1000)),
  unread, hint, picking, dragging, requests: hasRequests(), streaming: chat.streaming,
  island: `${Math.round(width.value)}x${Math.round(height.value)}`, buddy: document.body.dataset.buddy,
  home: homeMode, compact, toast: toastOn() ? toast.text : '', pill: state === 'barre' ? `${pillSize().w}x${pillSize().h}` : '',
  nuage: nuageInside ? moodNow || 'idle' : homeMode ? (nuageAvatar ? moodNow || 'idle' : 'dans la pilule') : 'dehors', place: `${place.docked ? 'collée' : 'flottante'}${place.up ? ' (vers le haut)' : ''}`,
})

api.onAgents(onAgents)
api.onIntegrations(onIntegrations)
api.onSettings(onSettings)
syncView()
draw()
const initial = await api.getState()
applyPlace(initial.place)
onWeather(initial.weather)
onSettings(initial.settings || {})
onIntegrations(initial.integrations)
onChat(initial.chat)
onAgents(initial.agents)
onPhone(initial.telephone)
onVoice(initial.voice)
if (initial.openSettings) openReglages(initial.openSettings) // premier lancement : « Comment faire marcher Nuage ? »
else if (initial.openChat) openChatHere(initial.openChat)
else if (initial.openTab) {
  showTab(initial.openTab === 'integrations' ? 'agents' : initial.openTab)
  openPanel(20_000)
} else if (initial.openPanel) openPanel(15_000)
setInterval(() => {
  renderBar()
  if (!diffView && tab === 'agents' && state === 'ouvert' && !document.activeElement?.matches('input')) renderHome() // « il y a 2 min »
  if (tab === 'telephone' && state === 'ouvert') renderPhone() // « vu il y a… », en ligne / hors de portée
}, 15_000)

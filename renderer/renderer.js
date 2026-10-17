// Nuage : comportement de l'avatar dans sa fenêtre transparente.
import { createAvatar } from './vendor/avatar-web.js'
import { play, setSounds } from './sons.js'
import { createSkin } from './peau.js'
import { createLife } from './vie.js'
import { icon } from './icones.js'

const api = window.nuage
const $ = id => document.getElementById(id)
const stage = $('stage')
const follow = $('follow')
const avatarEl = $('avatar')
const lifeEl = $('life')
const dlArrow = $('dl-arrow')
const bubble = $('bubble')
const timerEl = $('timer')
const fx = $('fx')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const pick = list => list[Math.floor(Math.random() * list.length)]
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const pad = n => String(n).padStart(2, '0')

// ---------- Réglages ----------
let settings = await api.getSettings()
function applySettings(next) {
  settings = next
  setSounds(next.soundsOn ?? true, next.volume ?? 0.5)
  document.documentElement.style.setProperty('--size', `${next.px}px`)
  skin.setLabel(next.weatherLabel !== false)
  if (next.quiet) hideBubble()
  document.body.classList.toggle('cinema', cinemaQuietNow())
  if (!next.audioReactive && audio) {
    stopAudio()
    if (playingMusic() || watching()) startAudio() // passe en rythme simulé
  }
}

// ---------- Humeurs : une humeur de fond + des réactions passagères ----------
const GLOW = {
  sleeping: 'dim', drowsy: 'dim', sad: 'dim',
  happy: 'strong', excited: 'strong', proud: 'strong', winking: 'strong', laughing: 'strong', playful: 'strong',
}
let base = 'idle'
let current = ''
let reactTimer = null

// Joues roses selon l'humeur (la chaleur en ajoute un peu, voir peau.js)
const BLUSH = { shy: 0.95, happy: 0.45, laughing: 0.55, excited: 0.4, winking: 0.5, playful: 0.4, proud: 0.4, celebrate: 0.5 }
function show(key) {
  if (key === current) return
  current = key
  document.body.dataset.mood = key
  document.body.dataset.glow = GLOW[key] || ''
  if (key.startsWith('expr:')) avatar?.setExpression(key.slice(5))
  else avatar?.play(key)
  skin.setBlush(BLUSH[key] || 0)
  life.sleeping(key === 'sleeping')
}

// L'avatar est créé une seule fois : la couleur et la météo passent par sa peau (peau.js), sans le
// reconstruire (une reconstruction pendant un glisser lui faisait lâcher la souris)
const avatar = createAvatar(avatarEl, { definition: window.NUAGE_AVATAR, defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage' })
const skin = createSkin({ defs: $('skin-defs'), reduceMotion })
skin.attach(avatarEl.querySelector('svg'))
document.fonts.load('800 20px Nunito').then(() => skin.setLabel(settings.weatherLabel !== false)).catch(() => {})
const life = createLife({ bodyEl: $('body'), lifeEl, emotesEl: $('emotes'), trailEl: $('trail'), reduceMotion })

function setBase(key) {
  base = key
  if (!reactTimer) show(key)
}
// Petit signe au-dessus de sa tête pour certaines réactions
const MOOD_EMOTE = { surprised: 'surprise', confused: 'question', shy: 'coeur', scared: 'goutte', celebrate: 'etoiles', proud: 'etoiles', angry: 'colere' }
function react(key, ms = 2600) {
  if (MOOD_EMOTE[key]) life.emote(MOOD_EMOTE[key])
  show(key)
  clearTimeout(reactTimer)
  reactTimer = setTimeout(() => {
    reactTimer = null
    show(base)
  }, ms)
}
const asleep = () => base === 'sleeping'

// ---------- Musique / vidéo en cours (rempli par la section « Musique et vidéos ») ----------
let media = null
function playingMusic() {
  return Boolean(media?.playing && media.kind === 'music')
}
function watching() {
  return Boolean(media?.playing && media.kind === 'video')
}
function cinemaQuietNow() {
  return Boolean(media?.fullscreen && settings.cinemaQuiet)
}

// ---------- Bulle ----------
let bubbleTimer = null
let bubbleAction = null
// Les phrases gardent un emoji comme repère (ex. « ⚽ But de… », ou les messages du processus
// principal) ; la bulle le remplace par une icône dessinée (icones.js, Phosphor) dans une pastille
// de couleur, et retire les autres emojis (04/10/2026 : « les petites icônes sont vilaines »).
const EMOJI_ICONS = new Map([
  ['⚽', ['soccer-ball', 'pelouse']], ['✅', ['check-circle', 'pelouse']], ['🎉', ['confetti', 'soleil']],
  ['🏁', ['flag-checkered', 'ardoise']], ['⏱', ['timer', 'ardoise']], ['🔁', ['arrows-clockwise', 'ardoise']],
  ['⛔', ['prohibit', 'alerte']], ['❌', ['x-circle', 'alerte']], ['🎵', ['music-notes', 'amethyste']],
  ['🍿', ['popcorn', 'grenadine']], ['🎬', ['film-slate', 'grenadine']], ['⏸', ['popcorn', 'grenadine']],
  ['☀', ['sun', 'soleil']], ['⛅', ['cloud-sun', 'soleil']], ['☁', ['cloud', 'ardoise']], ['🌫', ['cloud-fog', 'ardoise']],
  ['🌦', ['cloud-rain', 'pluie']], ['🌧', ['cloud-rain', 'pluie']], ['❄', ['snowflake', 'pluie']], ['⛈', ['cloud-lightning', 'nuit']],
  ['🌙', ['moon-stars', 'nuit']], ['😴', ['moon', 'nuit']], ['📥', ['download-simple', 'pelouse']], ['🔌', ['plug', 'pelouse']],
  ['🔐', ['lock-key', 'ciel']], ['❓', ['question', 'ciel']], ['💤', ['hourglass-medium', 'ciel']], ['💬', ['chat-circle-dots', 'ciel']],
  ['☕', ['coffee', 'cafe']], ['💧', ['drop', 'pluie']], ['👋', ['hand-waving', 'rose']], ['✉', ['envelope-simple', 'ciel']],
  ['📱', ['device-mobile', 'ciel']], ['📋', ['clipboard-text', 'ciel']], ['📤', ['upload-simple', 'pelouse']],
  ['⚡', ['lightning', 'soleil']], ['🔋', ['lightning', 'pelouse']],
])
const EMOJI = /(?:[←-⯿]|[\u{1F000}-\u{1FAFF}])️?/gu
function iconize(text, forced) {
  let found = forced || null
  const clean = String(text).replace(EMOJI, match => {
    const key = match.replace('️', '')
    if (!found && EMOJI_ICONS.has(key)) found = EMOJI_ICONS.get(key)
    return ''
  }).replace(/\s{2,}/g, ' ').replace(/\s+([.,…])/g, '$1').trim() // garde l'espace avant « : ! ? »
  return { icon: found, text: clean }
}
// Nuage habite l'encoche (06/10/2026) : cette fenêtre reste cachée et ses bulles s'affichent dans la pilule
// du haut ; un clic sur une bulle « à action » (annuler un repas…) revient ici par son numéro
const homeActions = new Map()
let homeActionSeq = 0
function say(text, { ms = 4500, action = null, important = false, icon: forced = null, voice = false } = {}) {
  if (settings.quiet && !important) return
  if (cinemaQuietNow() && !important) return // plein écran : seules les alertes importantes passent
  const line = iconize(text, forced)
  if (settings.home) {
    if (voice) return // la pilule montre déjà l'écoute en direct
    let id = null
    if (action) {
      id = `a${++homeActionSeq}`
      homeActions.set(id, action)
      if (homeActions.size > 20) homeActions.delete(homeActions.keys().next().value)
    }
    api.homeSay({ text: line.text, icon: line.icon, ms, important, action: id })
    return
  }
  const words = document.createElement('span')
  words.className = 'b-text'
  words.textContent = line.text
  if (line.icon) {
    const chip = document.createElement('span')
    chip.className = `b-ico tone-${line.icon[1]}`
    chip.append(icon(line.icon[0]))
    bubble.replaceChildren(chip, words)
  } else {
    bubble.replaceChildren(words)
  }
  bubble.classList.toggle('with-icon', Boolean(line.icon))
  bubbleAction = action
  bubble.classList.toggle('action', Boolean(action))
  bubble.classList.toggle('important', important)
  bubble.classList.add('show')
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(hideBubble, ms)
}
function hideBubble() {
  bubble.classList.remove('show', 'action')
  bubbleAction = null
}
bubble.addEventListener('click', () => {
  const action = bubbleAction
  hideBubble()
  action?.()
})
api.onHomeAction(id => {
  const action = homeActions.get(id)
  homeActions.delete(id)
  action?.()
})

// ---------- Souris : zones cliquables, clic, glisser, caresse ----------
let interactive = false
let down = null
let dragging = false
let hoverSince = 0
let lastPet = 0
let clicks = []

function setInteractive(on) {
  if (on === interactive) return
  interactive = on
  api.setInteractive(on)
}
// Le corps de Nuage : ses formes peintes, plus un ovale un peu plus petit que lui, pour qu'on
// l'attrape aussi entre deux bouffées (correctif du 04/10/2026 : « des fois je n'arrive pas à le
// déplacer »)
function onBody(x, y) {
  const el = document.elementFromPoint(x, y)
  if (el?.tagName === 'path' && el.closest('#avatar')) return true
  const r = avatarEl.getBoundingClientRect()
  if (!r.width) return false
  const cx = r.left + r.width / 2
  const cy = r.top + r.height * 0.5
  const rx = r.width * 0.36
  const ry = r.height * 0.26
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}
function onControl(x, y) {
  const el = document.elementFromPoint(x, y)
  return Boolean(el && (el.closest('.bubble.show') || el.closest('.np:not([hidden])')))
}
const isHit = (x, y) => onControl(x, y) || onBody(x, y)

addEventListener('mousemove', e => {
  if (dragging || down) return
  setInteractive(isHit(e.clientX, e.clientY))
  hoverSince = onBody(e.clientX, e.clientY) ? hoverSince || Date.now() : 0
})
document.documentElement.addEventListener('mouseleave', () => {
  hoverSince = 0
  if (!dragging && !down) setInteractive(false)
})
addEventListener('contextmenu', e => {
  e.preventDefault()
  if (isHit(e.clientX, e.clientY)) api.showMenu()
})

// Glisser : la capture est posée sur la page entière (élément qui ne disparaît jamais) et les
// événements sont écoutés sur la fenêtre ; un bouton relâché sans « pointerup » reçu (bouton = 0
// pendant un mouvement) termine aussi le glisser, sinon Nuage restait collé au curseur.
addEventListener('pointerdown', e => {
  if (e.button !== 0 || onControl(e.clientX, e.clientY) || !onBody(e.clientX, e.clientY)) return
  down = { x: e.screenX, y: e.screenY }
  try {
    document.documentElement.setPointerCapture(e.pointerId)
  } catch {}
})
addEventListener('pointermove', e => {
  if (!down) return
  if (dragging && e.buttons === 0) {
    release(e)
    return
  }
  if (dragging || Math.hypot(e.screenX - down.x, e.screenY - down.y) < 5) return
  dragging = true
  document.body.classList.add('dragging')
  api.dragStart()
  clearTimeout(reactTimer)
  reactTimer = null
  show('scared')
  play('whoosh')
  say(pick(['Wouah !', 'Où on va ?', 'Doucement !']), { ms: 2000 })
})
function release(e) {
  if (!down) return
  down = null
  if (dragging) {
    dragging = false
    document.body.classList.remove('dragging')
    // Lâché sur la barre du haut : le chat s'ouvre dans l'encoche et Nuage y entre.
    // Maj enfoncée : la fenêtre sous Nuage part en contexte dans le chat.
    const shift = Boolean(e.shiftKey)
    api.dragEnd(shift).then(where => {
      if (where === 'chat') return // il plonge dans la barre (événement « bar »)
      life.action('land')
      play('boum')
      react('confused', 1800)
      if (!shift) say(pick(['Ça tourne…', 'Bon, ici c’est bien.', 'Joli coin !']), { ms: 2200 })
    })
  } else if (e.type === 'pointerup') {
    onClick()
  }
  setInteractive(isHit(e.clientX, e.clientY))
}
addEventListener('pointerup', release)
addEventListener('pointercancel', release)
document.documentElement.addEventListener('lostpointercapture', release)

function onClick() {
  if (asleep()) {
    wakeUp('Hein ? Je dormais…')
    return
  }
  if (bubbleAction) {
    const action = bubbleAction
    hideBubble()
    action()
    return
  }
  const now = Date.now()
  life.action('jelly')
  clicks = clicks.filter(t => now - t < 3000)
  clicks.push(now)
  if (clicks.length >= 5) {
    clicks = []
    react('angry', 2400)
    say(pick(['Hé ! Ça chatouille !', 'Stop, stop, j’ai le tournis !']))
    return
  }
  react(pick(['happy', 'laughing', 'playful', 'excited']), 2600)
  play(pick(['pop', 'rire', 'gazouillis']))
  const time = new Date()
  say(pick([
    'Coucou !',
    'Hihi !',
    'Je flotte, je flotte…',
    'Mes réglages sont dans la barre du haut : la roue dentée.',
    `Il est ${pad(time.getHours())} h ${pad(time.getMinutes())}.`,
    'Tu peux me déplacer en me faisant glisser.',
    'Glisse-moi sur la barre du haut pour discuter avec une IA.',
  ]), { ms: 3000 })
}

// Pendant un glisser, arrivé en haut de l'écran ou sur la barre : lâcher ici l'y fait entrer
api.onDragZone(on => {
  if (!on || !dragging) return
  react('excited', 1500)
  say('Lâche-moi ici : je rentre dans la barre ! 💬', { ms: 2500 })
})

// Il plonge dans la barre (sa fenêtre disparaît ensuite) ; il en ressort en atterrissant
api.onBar(what => {
  if (what === 'enter') {
    hideBubble()
    document.body.classList.remove('landing')
    document.body.classList.add('diving')
    show('excited')
    play('whoosh')
    return
  }
  document.body.classList.remove('diving')
  document.body.classList.add('landing')
  setTimeout(() => document.body.classList.remove('landing'), 800)
  react('happy', 2400)
  play('pop')
  setTimeout(() => say(pick(['Me revoilà !', 'Hop, je ressors !', 'Ah, l’air frais !'])), 450)
})

// Caresse : survol prolongé du nuage
setInterval(() => {
  if (!hoverSince || dragging || asleep()) return
  const now = Date.now()
  if (now - hoverSince > 1500 && now - lastPet > 30_000) {
    lastPet = now
    react('shy', 2200)
    say(pick(['Hihi, ça chatouille.', 'Tu me fais des câlins ?', 'Rrrr…']), { ms: 2200 })
  }
}, 250)

// ---------- Suivi du curseur (sur tout l'écran) ----------
const pointer = { x: 0, y: 0, known: false }
let cx = 0
let cy = 0
let lastPeek = Date.now()
let lastPointerMove = 0
api.onCursor(p => {
  if (p.x !== pointer.x || p.y !== pointer.y) lastPointerMove = performance.now()
  pointer.x = p.x
  pointer.y = p.y
  pointer.known = true
  // Aussi pendant un glisser-déposer depuis l'Explorateur (pas d'événement souris dans ce cas)
  if (!dragging && !down) setInteractive(isHit(p.x, p.y))
})

// ---------- Rythme d'affichage (05/10/2026 : « il est hyper lent, je le veux ultra réactif ») ----------
// Mesuré sur ce PC portable (puce graphique Intel intégrée, écran 60 Hz) : la fenêtre transparente était
// redessinée 60 fois par seconde en permanence (flottement, respiration, halo en animations CSS, deux
// ombres floues), soit près d'un cœur et demi de processeur rien que pour la carte graphique. Désormais :
// 60 images/s dès qu'il se passe quelque chose (souris, clic, glisser, réaction, parole, téléchargement),
// 30 quand il danse, 24 au repos ; ces mouvements lents sont menés ici, dans une seule boucle.
const FPS = { actif: 60, danse: 30, repos: 24 }
const floatEl = document.querySelector('.stage .float')
const haloEl = document.querySelector('.stage .halo')
let lastDraw = 0
let stageRect = null
let stageRectAt = 0
if (!reduceMotion) document.body.classList.add('motion-js')
function frameRate(now) {
  const b = document.body.classList
  if (dragging || down || hoverSince || reactTimer || now - lastPointerMove < 1500 || life.busy() ||
      b.contains('talking') || b.contains('downloading') || b.contains('hungry') || b.contains('diving') || b.contains('landing') ||
      b.contains('charging-burst')) return FPS.actif
  if (playingMusic() || watching()) return FPS.danse
  return FPS.repos
}
// Flottement (5 s), respiration (4,6 s), halo (4,5 s ; 2,2 s quand il est très content), soleil (6 s)
function idleMotion(t) {
  const wave = period => (1 - Math.cos((2 * Math.PI * t) / period)) / 2
  floatEl.style.transform = `translate3d(0, ${(-8 * wave(5)).toFixed(2)}px, 0)`
  const s = wave(4.6)
  lifeEl.style.transform = `scale(${(1 + 0.022 * s).toFixed(4)}, ${(1 + 0.03 * s).toFixed(4)})` // une action CSS passe devant
  const glow = document.body.dataset.glow
  if (glow === 'dim') {
    haloEl.style.transform = ''
    haloEl.style.opacity = ''
  } else {
    const p = wave(glow === 'strong' ? 2.2 : 4.5)
    haloEl.style.transform = `scale(${(0.9 + 0.14 * p).toFixed(3)})`
    haloEl.style.opacity = (0.55 + 0.35 * p).toFixed(3)
  }
  const sun = fx.firstElementChild?.classList.contains('sun') ? fx.firstElementChild : null
  if (sun) sun.style.transform = `scale(${(1 + 0.08 * wave(6)).toFixed(3)})`
  // Téléphone en charge : un reflet d'énergie glisse dans la petite batterie, l'éclair respire
  const charge = document.getElementById('charge')
  if (charge && !charge.hidden) {
    charge.style.setProperty('--sheen', ((t % 1.6) / 1.6).toFixed(3))
    charge.style.setProperty('--bolt', (0.6 + 0.4 * wave(1.2)).toFixed(3))
  }
}
addEventListener('resize', () => { stageRectAt = 0 })
// Centre de l'écran (là où passe la vidéo), dans les coordonnées de la fenêtre
const screenCenter = () => ({
  x: (screen.availLeft || 0) + screen.availWidth / 2 - window.screenX,
  y: (screen.availTop || 0) + screen.availHeight / 2 - window.screenY,
})
function tick(now) {
  requestAnimationFrame(tick)
  // Au repos, on saute des images : rien ne change à l'écran, la carte graphique n'a rien à refaire
  if (now - lastDraw < 1000 / frameRate(now) - 2) return
  lastDraw = now
  mediaFrame()
  life.frame(now, { dragging, hover: Boolean(hoverSince) && !down })
  idleMotion(now / 1000)
  lipSync()
  // La place de Nuage dans sa fenêtre : relue deux fois par seconde (la lire à chaque image forçait un calcul de mise en page)
  if (!stageRect || now - stageRectAt > 500) {
    stageRect = stage.getBoundingClientRect()
    stageRectAt = now
  }
  const r = stageRect
  const ox = r.left + r.width / 2
  const oy = r.top + r.height / 2
  let tx = 0
  let ty = 0
  const target = watching() ? screenCenter() : pointer.known ? pointer : null
  if (target && !asleep() && !dragging) {
    tx = clamp((target.x - ox) / (screen.width * 0.5), -1, 1)
    ty = clamp((target.y - oy) / (screen.height * 0.5), -1, 1)
    // Le curseur rôde tout près sans toucher : Nuage l'épie d'un œil
    const distance = Math.hypot(target.x - ox, target.y - oy)
    const now = Date.now()
    if (target === pointer && distance < r.width * 0.9 && distance > r.width * 0.45 && base === 'idle' &&
        !reactTimer && now - lastPeek > 45_000) {
      lastPeek = now
      react('peeking', 2400)
    }
  }
  // Le regard suit le curseur avec la même douceur quel que soit le rythme d'affichage
  const ease = 1 - Math.pow(1 - 0.08, Math.min(4, (now - (tick.prev || now)) / (1000 / 60) || 1))
  tick.prev = now
  cx += (tx - cx) * ease
  cy += (ty - cy) * ease
  const transform = `translate3d(${(cx * 20).toFixed(2)}px, ${(cy * 14).toFixed(2)}px, 0) rotateY(${(cx * 18).toFixed(2)}deg) rotateX(${(-cy * 14).toFixed(2)}deg)`
  if (transform !== follow.style.transform) follow.style.transform = transform
}
if (!reduceMotion) requestAnimationFrame(tick)

// ---------- Présence : inactivité, verrouillage, salutations ----------
let idleState = 'active'
function restingMood() {
  if (pomodoro) return pomodoro.phase === 'focus' ? 'working' : 'happy'
  if (playingMusic()) return 'happy'
  if (watching()) return 'listening'
  return 'idle'
}
function wakeUp(text) {
  setBase(restingMood())
  react('surprised', 1400)
  play('reveil')
  if (text) say(text)
}
function greeting(back) {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return back ? 'Re-bonjour ! Bonne matinée.' : 'Bonjour ! Je suis là si besoin.'
  if (h >= 12 && h < 18) return back ? 'Re-bonjour !' : 'Bon après-midi !'
  if (h >= 18 && h < 23) return back ? 'Re-bonsoir !' : 'Bonsoir !'
  return 'Encore debout ? Il se fait tard…'
}

function applyIdleState(state, was) {
  if (state === 'drowsy') {
    if (!pomodoro) {
      setBase('drowsy')
      say('Tu es là ? Je m’assoupis…', { ms: 3500 })
    }
  } else if (state === 'asleep') {
    if (base !== 'sleeping') play('baillement')
    setBase('sleeping')
    hideBubble()
  } else if (was !== 'active' && (base === 'sleeping' || base === 'drowsy')) {
    wakeUp(was === 'asleep' ? pick(['Oh ! Te revoilà 👋', 'Re-bonjour !', 'Tu m’as manqué !']) : null)
  }
}
api.onIdleState(state => {
  const was = idleState
  idleState = state
  // On écoute ou on regarde sans toucher au clavier : Nuage reste éveillé
  if (state !== 'active' && (playingMusic() || watching())) return
  applyIdleState(state, was)
})
api.onSystem(event => {
  if (event === 'lock') {
    setBase('sleeping')
    hideBubble()
  } else if (event === 'unlock' || event === 'resume') {
    wakeUp(greeting(true))
  } else if (event === 'hello-again') {
    react('surprised', 1400)
    say('Je suis déjà là ! 😉')
  }
})

// Une fois par nuit : rappel d'aller dormir
let nightWarned = ''
setInterval(() => {
  const now = new Date()
  const h = now.getHours()
  const day = now.toDateString()
  if ((h >= 23 || h < 5) && idleState === 'active' && nightWarned !== day && !asleep()) {
    nightWarned = day
    react('drowsy', 4000)
    say('Il est tard… pense à aller dormir 🌙', { ms: 7000 })
  }
}, 60_000)

// ---------- Rappels pause et eau ----------
api.onRemind(kind => {
  if (asleep()) return
  if (kind === 'pause') {
    if (pomodoro) return // le Pomodoro gère déjà les pauses
    react('curious', 4000)
    say(pick([
      'Ça fait un moment que tu travailles. Une petite pause ? Étire-toi !',
      'Pause ! Lève-toi et regarde au loin pendant 20 secondes.',
      'Tes yeux méritent une pause.',
    ]), { ms: 9000, icon: ['coffee', 'cafe'] })
  } else {
    react('happy', 3000)
    say(pick(['Pense à boire un verre d’eau 💧', 'Hydratation ! Un verre d’eau ?']), { ms: 7000 })
  }
})

// ---------- Pomodoro 25 / 5 ----------
const FOCUS_MIN = 25
const PAUSE_MIN = 5
let pomodoro = null

const chime = () => play('carillon')
function startPomodoro() {
  pomodoro = { phase: 'focus', endsAt: Date.now() + FOCUS_MIN * 60_000 }
  setBase('working')
  react('excited', 1500)
  say('C’est parti : 25 minutes de concentration !', { important: true, icon: ['timer', 'ardoise'] })
  api.pomodoroState(true)
  tickPomodoro()
}
function stopPomodoro() {
  pomodoro = null
  timerEl.hidden = true
  setBase('idle')
  say('Pomodoro arrêté.', { ms: 2500 })
  api.pomodoroState(false)
}
function tickPomodoro() {
  if (!pomodoro) return
  const left = Math.max(0, Math.ceil((pomodoro.endsAt - Date.now()) / 1000))
  timerEl.hidden = false
  timerEl.classList.toggle('pause', pomodoro.phase === 'pause')
  timerEl.replaceChildren(icon(pomodoro.phase === 'focus' ? 'timer' : 'coffee'), `${pomodoro.phase === 'focus' ? 'Focus' : 'Pause'} ${pad(Math.floor(left / 60))}:${pad(left % 60)}`)
  if (left > 0) return
  chime()
  if (pomodoro.phase === 'focus') {
    pomodoro = { phase: 'pause', endsAt: Date.now() + PAUSE_MIN * 60_000 }
    setBase('happy')
    react('winking', 3000)
    say('Bravo, 25 minutes ! Pause de 5 minutes ☕', { ms: 9000, important: true })
  } else {
    pomodoro = { phase: 'focus', endsAt: Date.now() + FOCUS_MIN * 60_000 }
    setBase('working')
    say('Fin de la pause, on reprend !', { ms: 7000, important: true })
  }
}
setInterval(tickPomodoro, 1000)
api.onPomodoro(command => (command === 'start' ? startPomodoro() : stopPomodoro()))

// ---------- Batterie faible ----------
navigator.getBattery?.().then(battery => {
  let warned = false
  const check = () => {
    if (battery.charging) {
      warned = false
      return
    }
    if (battery.level <= 0.2 && !warned) {
      warned = true
      react('sad', 5000)
      say(`Batterie à ${Math.round(battery.level * 100)} %… Branche le chargeur !`, { ms: 9000, important: true, icon: ['battery-warning', 'alerte'] })
    }
  }
  battery.addEventListener('levelchange', check)
  battery.addEventListener('chargingchange', check)
  check()
}).catch(() => {})

// ---------- File d'annonces (météo…) : une bulle après l'autre ----------
const queue = []
let queueBusy = false
// Au démarrage, Nuage récupère tout en silence (météo, musique) : seules les
// alertes importantes s'affichent pendant les 20 premières secondes.
const startedAt = Date.now()
function enqueue(item) {
  if (!item.important && Date.now() - startedAt < 20_000) return
  queue.push(item)
  if (!queueBusy) nextAnnouncement()
}
function nextAnnouncement() {
  const item = queue.shift()
  if (!item) {
    queueBusy = false
    return
  }
  queueBusy = true
  if (item.important && asleep()) setBase(restingMood())
  if (item.mood) react(item.mood, item.moodMs || 3500)
  if (item.chime) chime()
  const ms = item.ms || 6000
  say(item.text, { ms, important: item.important, action: item.action || null })
  setTimeout(nextAnnouncement, settings.quiet && !item.important ? 0 : ms + 400)
}

// ---------- Météo : sur son corps (peau.js) et petits effets autour de lui ----------
const WEATHER_LINE = {
  soleil: (p, t) => `☀️ Grand soleil à ${p} (${t} °C) !`,
  eclaircies: (p, t) => `⛅ Quelques nuages à ${p} (${t} °C).`,
  couvert: (p, t) => `☁️ Ciel couvert à ${p} (${t} °C) : je me fonds dans le décor.`,
  brouillard: p => `🌫️ Brouillard à ${p}… on n’y voit rien !`,
  bruine: (p, t) => `🌦️ Un peu de bruine à ${p} (${t} °C).`,
  pluie: (p, t) => `🌧️ Il pleut à ${p} (${t} °C) : je prends la couleur du ciel.`,
  neige: p => `❄️ Il neige à ${p} !`,
  orage: p => `⛈️ Orage à ${p} : reste à l’abri !`,
}

function renderFx(w) {
  fx.replaceChildren()
  if (!w || reduceMotion) return
  const rand = (a, b) => a + Math.random() * (b - a)
  const add = (className, style) => {
    const node = document.createElement('span')
    node.className = className
    Object.assign(node.style, style)
    fx.append(node)
  }
  const drops = { bruine: 6, pluie: 14, orage: 18 }[w.key]
  for (let i = 0; i < (drops || 0); i++) {
    add('drop', { left: `${rand(30, 70)}%`, animationDuration: `${rand(0.7, 1.1)}s`, animationDelay: `${rand(0, 1.2)}s`, opacity: '0' })
  }
  if (w.key === 'neige') {
    for (let i = 0; i < 10; i++) {
      add('flake', { left: `${rand(28, 72)}%`, animationDuration: `${rand(2.6, 4)}s`, animationDelay: `${rand(0, 3)}s`, opacity: '0' })
    }
  }
  if (!w.night && (w.key === 'soleil' || w.key === 'eclaircies')) add(w.key === 'soleil' ? 'sun' : 'sun small', {})
  if (w.night && (w.key === 'soleil' || w.key === 'eclaircies')) {
    for (let i = 0; i < 5; i++) add('star', { left: `${rand(8, 92)}%`, top: `${rand(4, 30)}%`, animationDelay: `${rand(0, 3)}s` })
  }
  if (w.key === 'brouillard') {
    add('mist', { top: '52%' })
    add('mist', { top: '68%', animationDelay: '-5s' })
  }
}

let weather = null
api.onWeather(w => {
  const previous = weather
  weather = w
  document.body.dataset.weather = w ? w.key : ''
  document.body.toggleAttribute('data-night', Boolean(w?.night))
  skin.setWeather(w)
  renderFx(w)
  // Première météo : couleur seulement ; une bulle seulement quand le temps change ensuite
  if (w && previous && (previous.key !== w.key || previous.night !== w.night)) {
    const line = w.night && (w.key === 'soleil' || w.key === 'eclaircies')
      ? `🌙 Belle nuit à ${w.place} (${w.temp} °C).`
      : WEATHER_LINE[w.key](w.place, w.temp)
    enqueue({ text: line, ms: 5000 })
  }
})

// ---------- Musique et vidéos ----------
const npEl = $('np')
const npTextBox = npEl.querySelector('.np-text')
const npText = $('np-text')
const npToggle = $('np-toggle')
const eqBars = [...npEl.querySelectorAll('.eq i')]
const notesEl = $('notes')
const danceEl = $('dance')
const shorten = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const npKind = npEl.querySelector('.np-kind')
const NP_ICONS = { previous: 'skip-back-fill', toggle: 'pause-fill', next: 'skip-forward-fill' }

for (const button of npEl.querySelectorAll('[data-cmd]')) {
  button.replaceChildren(icon(NP_ICONS[button.dataset.cmd]))
  button.addEventListener('click', e => {
    e.stopPropagation()
    api.mediaCommand(button.dataset.cmd)
  })
}
npEl.addEventListener('click', () => api.mediaCommand('toggle'))

// Son du PC capté et analysé sur place (rythme seulement, rien n'est enregistré ni envoyé).
// Sans autorisation ou en cas d'échec : rythme simulé.
let audio = null
let audioMode = 'off'
let audioStarting = false
let audioStopTimer = null
async function startAudio() {
  clearTimeout(audioStopTimer)
  if (audio || audioStarting) return
  if (!settings.audioReactive) {
    audioMode = 'simule'
    document.body.dataset.audio = audioMode
    return
  }
  audioStarting = true
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 64, height: 36, frameRate: 1 } })
    const track = stream.getAudioTracks()[0]
    if (!track) {
      stream.getTracks().forEach(t => t.stop())
      throw new Error('aucune piste audio')
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.55
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser) // jamais vers les haut-parleurs
    audio = { ctx, analyser, stream, bins: new Uint8Array(analyser.frequencyBinCount) }
    audioMode = 'direct'
  } catch (error) {
    console.warn('Analyse du son indisponible, rythme simulé :', error.message)
    audioMode = 'simule'
  } finally {
    audioStarting = false
    document.body.dataset.audio = audioMode
  }
}
function stopAudio() {
  clearTimeout(audioStopTimer)
  if (audio) {
    audio.stream.getTracks().forEach(t => t.stop())
    audio.ctx.close()
    audio = null
  }
  audioMode = 'off'
  document.body.dataset.audio = audioMode
}
function stopAudioSoon() {
  clearTimeout(audioStopTimer)
  audioStopTimer = setTimeout(stopAudio, 20_000)
}

// Niveau global, basses (le « boum ») et 5 bandes pour l'égaliseur
const BANDS = [2, 5, 10, 20, 40]
let silentSince = 0
function readSound(now) {
  if (audio) {
    const b = audio.bins
    audio.analyser.getByteFrequencyData(b)
    let bass = 0
    for (let i = 1; i < 7; i++) bass += b[i]
    let level = 0
    for (let i = 0; i < b.length; i++) level += b[i]
    level /= b.length * 255
    // Son coupé ou envoyé ailleurs : après 4 s de silence, Nuage garde un rythme simulé
    if (level > 0.01) silentSince = 0
    else silentSince ||= now
    if (!silentSince || now - silentSince < 4000) {
      return { bass: bass / (6 * 255), level, bands: BANDS.map(i => b[i] / 255), simulated: false }
    }
  }
  const t = now / 1000
  const pulse = Math.exp(-((t * 118 / 60) % 1) * 6) // environ 118 battements par minute
  return {
    bass: 0.3 + 0.55 * pulse,
    level: 0.35,
    bands: BANDS.map((_, i) => 0.35 + 0.45 * Math.abs(Math.sin(t * (2.1 + i * 0.7) + i))),
    simulated: true,
  }
}

let bassAvg = 0.3
let levelAvg = 0.2
let musicLevel = 0.3
let lastBeat = 0
let beatCount = 0
let bounce = 0
let lastNote = 0
let lastSpike = 0
function spawnNote() {
  if (reduceMotion) return
  const note = document.createElement('span')
  note.className = 'note'
  note.append(icon(pick(['music-note-fill', 'music-notes-simple-fill', 'music-note-fill'])))
  note.style.left = `${30 + Math.random() * 40}%`
  note.style.color = pick(['#7a5af8', '#2f74d0', '#e0537a', '#1f9d5c'])
  note.style.setProperty('--dx', `${Math.round(Math.random() * 60 - 30)}px`)
  note.style.setProperty('--rot', `${Math.round(Math.random() * 40 - 20)}deg`)
  note.addEventListener('animationend', () => note.remove())
  notesEl.append(note)
}
function mediaFrame(now = performance.now()) {
  const music = playingMusic()
  if (!music && !watching()) {
    if (bounce) {
      bounce = 0
      danceEl.style.transform = ''
    }
    return
  }
  const sound = readSound(now)
  eqBars.forEach((bar, i) => {
    bar.style.transform = `scaleY(${clamp(0.18 + sound.bands[i] * 1.1, 0.18, 1).toFixed(2)})`
  })
  if (music) {
    // Danse : rebond sur chaque « boum » des basses, balancement selon le volume
    bassAvg += (sound.bass - bassAvg) * 0.04
    musicLevel += (sound.level - musicLevel) * 0.01
    if (sound.bass > bassAvg * 1.3 && sound.bass > 0.22 && now - lastBeat > 280) {
      lastBeat = now
      bounce = 1
      beatCount += 1
      if (beatCount % 2 === 0 && now - lastNote > 650) {
        lastNote = now
        spawnNote()
      }
    }
    bounce *= 0.88
    const sway = Math.sin((now / 1000) * Math.PI * 1.9) * (4 + sound.level * 8)
    danceEl.style.transform =
      `translateY(${(-bounce * 9).toFixed(1)}px) rotate(${sway.toFixed(1)}deg) scale(${(1 + bounce * 0.04).toFixed(3)}, ${(1 - bounce * 0.03).toFixed(3)})`
  } else {
    danceEl.style.transform = ''
    // Vidéo : un pic de son soudain (explosion, cri, but…) fait sursauter Nuage
    levelAvg += (sound.level - levelAvg) * 0.02
    if (!sound.simulated && sound.level > 0.45 && sound.level > levelAvg * 2 && now - lastSpike > 45_000) {
      lastSpike = now
      react(pick(['surprised', 'scared']), 1800)
      say(pick(['Woah ! 😮', 'Aïe ! 😱', 'Oh là là !']), { ms: 1800 })
    }
  }
}

function showNowPlaying() {
  const text = media.kind === 'music'
    ? [media.title, media.artist].filter(Boolean).join(' — ')
    : media.title || media.app
  const kind = media.kind === 'music' ? 'music-notes' : 'film-slate'
  if (npKind.dataset.icon !== kind) {
    npKind.dataset.icon = kind
    npKind.replaceChildren(icon(kind))
  }
  if (npText.textContent !== text) {
    npText.textContent = text
    npTextBox.classList.remove('scroll')
    requestAnimationFrame(() => {
      const overflow = npText.scrollWidth - npTextBox.clientWidth
      if (overflow > 4) {
        npTextBox.style.setProperty('--shift', `${-overflow - 30}px`)
        npTextBox.style.setProperty('--marquee', `${Math.max(6, overflow / 18)}s`)
        npTextBox.classList.add('scroll')
      }
    })
  }
  npEl.classList.toggle('video', media.kind === 'video')
  npEl.classList.toggle('paused', !media.playing)
  const toggleIcon = media.playing ? 'pause-fill' : 'play-fill'
  if (npToggle.dataset.icon !== toggleIcon) {
    npToggle.dataset.icon = toggleIcon
    npToggle.replaceChildren(icon(toggleIcon))
  }
  npEl.title = `${media.app} : clic pour lecture / pause`
  npEl.hidden = false
}

const HUMS = ['🎵 La la la…', '🎵 Hmm hmm hmm…', '🎵 Ça me fait bouger !', '🎵 J’adore ce son.', '🎵 Dou bi dou wa…', '🎵 Monte le son !']
const VIDEO_LINES = ['🍿 Je ne rate pas une miette.', '🍿 Captivant…', '🍿 Hmm hmm…', '🍿 Ça se regarde bien !']
let trackKey = ''
let pauseTimer = null
let barTimer = null
let videoSince = 0
let videoWatched = 0
let videoReminded = false
let lastHum = Date.now()
let lastSwap = 0
let lastComment = Date.now()

api.onMedia(next => {
  const before = media
  const wasMusic = playingMusic()
  const wasVideo = watching()
  media = next?.kind ? next : next ? { fullscreen: next.fullscreen } : null
  document.body.classList.toggle('cinema', cinemaQuietNow())
  document.body.classList.toggle('dancing', playingMusic())

  const key = media?.kind ? `${media.kind}|${media.title}|${media.artist}` : ''
  const newTrack = key && key !== trackKey
  if (media?.kind) trackKey = key

  if (playingMusic() || watching()) {
    clearTimeout(pauseTimer)
    clearTimeout(barTimer)
    showNowPlaying()
    startAudio()
    if (asleep()) setBase(restingMood())
    if (playingMusic()) {
      if (!wasMusic) setBase(restingMood())
      if (newTrack || !wasMusic) {
        react('excited', 2500)
        for (let i = 0; i < 3; i++) setTimeout(spawnNote, i * 250)
      }
      if (newTrack) enqueue({ text: `🎵 ${shorten([media.title, media.artist].filter(Boolean).join(' — '), 70)}`, ms: 4500 })
    } else {
      if (!wasVideo) {
        setBase('listening')
        videoSince = videoSince || Date.now()
      }
      if (newTrack) enqueue({ text: `🍿 On regarde « ${shorten(media.title || media.app)} » ? Je m’installe !`, mood: 'excited', ms: 5000 })
    }
    return
  }

  // Plus rien ne joue (pause, arrêt, fermeture)
  if (media?.kind) showNowPlaying()
  if (wasMusic || wasVideo) {
    stopAudioSoon()
    clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => {
      if (playingMusic() || watching()) return
      setBase(restingMood())
      if (wasVideo) {
        if (media?.kind) say('⏸️ Pause ! Je garde ta place 🍿', { ms: 3500 })
        else if (Date.now() - videoSince > 10 * 60_000) say('🎬 C’était bien ?', { ms: 4000 })
      } else {
        react('curious', 1500)
      }
      if (!media?.kind) videoSince = 0
      if (idleState !== 'active') applyIdleState(idleState, 'active') // on dormait pendant le film
    }, 3000)
  }
  clearTimeout(barTimer)
  barTimer = setTimeout(() => {
    if (!playingMusic() && !watching()) npEl.hidden = true
  }, media?.kind ? 30_000 : 0)
  if (!before?.kind && !media?.kind) npEl.hidden = true
})

// Fredonnements, commentaires de film et pause écran
setInterval(() => {
  const now = Date.now()
  if (playingMusic()) {
    if (!pomodoro && !reactTimer && now - lastSwap > 9_000) {
      lastSwap = now
      setBase(musicLevel > 0.3 ? pick(['happy', 'playful', 'excited']) : pick(['listening', 'happy']))
    }
    if (now - lastHum > 120_000 + Math.random() * 120_000) {
      lastHum = now
      for (let i = 0; i < 4; i++) setTimeout(spawnNote, i * 300)
      say(pick(HUMS), { ms: 3500 })
    }
  }
  if (watching()) {
    videoWatched = now - videoSince
    if (now - lastComment > 6 * 60_000 + Math.random() * 4 * 60_000) {
      lastComment = now
      react(pick(['curious', 'surprised', 'laughing']), 2500)
      say(pick(VIDEO_LINES), { ms: 3500 })
    }
    if (settings.breakReminder && !videoReminded && videoWatched > 90 * 60_000) {
      videoReminded = true
      enqueue({ text: '🎬 Ça fait 1 h 30 d’écran : une petite pause pour les yeux ?', mood: 'curious', ms: 7000 })
    }
  } else if (!media?.kind) {
    videoReminded = false
  }
}, 10_000)

// ---------- Glisser-déposer : Nuage avale fichiers et dossiers (→ Corbeille) ----------
const mouth = $('mouth')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')
let dragDepth = 0
let eating = false
let undoUntil = 0

function openMouth() {
  if (document.body.classList.contains('hungry')) return
  if (asleep()) setBase(restingMood())
  document.body.classList.add('hungry')
  skin.setMuted(true) // la bouche passe là où est écrite la température
  clearTimeout(reactTimer)
  reactTimer = null
  show('expr:hungry')
  say(pick(['Miam ? Donne ! 😋', 'J’ai faim ! 😋', 'Aaah… ouvre grand !']), { ms: 2500, important: true })
}
function closeMouth(disappointed) {
  document.body.classList.remove('hungry', 'gulp')
  skin.setMuted(false)
  if (disappointed) {
    react('sad', 1500)
    say('Oh… dommage.', { ms: 1500 })
  } else {
    show(base)
  }
}

const KIND_ICONS = [[/^image\//, 'image'], [/^video\//, 'file-video'], [/^audio\//, 'file-audio'], [/pdf$/, 'file-pdf'], [/zip|rar|7z|compressed/, 'file-zip']]
function morselFor(file) {
  const el = document.createElement('div')
  el.className = 'morsel'
  if (file.type.startsWith('image/') && file.size < 25_000_000) {
    const img = document.createElement('img')
    img.src = URL.createObjectURL(file)
    img.alt = ''
    el.append(img)
  } else {
    // Un dossier glissé arrive comme un « fichier » vide sans type
    el.classList.add('tile')
    el.append(icon(!file.type && file.size === 0 ? 'folder' : KIND_ICONS.find(([re]) => re.test(file.type))?.[1] || 'file'))
  }
  return el
}
function mouthCenter() {
  const r = mouth.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
function flyIntoMouth(file, from, index) {
  const el = morselFor(file)
  el.style.left = `${from.x}px`
  el.style.top = `${from.y}px`
  document.body.append(el)
  const to = mouthCenter()
  const turn = index % 2 ? 25 : -25
  el.animate([
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
    { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(.12) rotate(${turn}deg)`, opacity: 0.3 },
  ], { duration: 650, delay: index * 120, easing: 'cubic-bezier(.5, 0, .75, 0)', fill: 'forwards' })
    .finished.then(() => {
      const img = el.querySelector('img')
      if (img) URL.revokeObjectURL(img.src)
      el.remove()
    })
}
// name : icône recrachée (x-circle : refusé, arrow-u-up-left : annulation)
function spitOut(name) {
  const el = document.createElement('div')
  el.className = `morsel tile spit-${name}`
  el.append(icon(name))
  const from = mouthCenter()
  el.style.left = `${from.x}px`
  el.style.top = `${from.y}px`
  document.body.append(el)
  el.animate([
    { transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 },
    { transform: 'translate(calc(-50% + 70px), calc(-50% + 60px)) scale(1) rotate(160deg)', opacity: 0 },
  ], { duration: 900, easing: 'ease-out', fill: 'forwards' }).finished.then(() => el.remove())
}
const gulpSound = () => play('glouglou')

async function swallow(files, point) {
  const items = files.map(file => ({ file, path: api.pathForFile(file) })).filter(item => item.path)
  if (!items.length) {
    closeMouth(false)
    react('confused', 1800)
    say('Je ne peux pas avaler ça…', { ms: 2500, important: true })
    return
  }
  eating = true
  items.slice(0, 4).forEach((item, i) => flyIntoMouth(item.file, point, i))
  const pending = api.swallow(items.map(item => item.path))
  await sleep(650 + Math.min(items.length, 4) * 120)
  document.body.classList.add('gulp')
  show('expr:gulp')
  gulpSound()
  avatarEl.classList.remove('gulping')
  void avatarEl.offsetWidth
  avatarEl.classList.add('gulping')
  const result = (await pending) || { trashed: [], refused: [], failed: [] }
  await sleep(450)
  document.body.classList.remove('hungry', 'gulp')
  skin.setMuted(false)
  eating = false

  const eaten = result.trashed.length
  const spat = result.refused.length
  if (spat) spitOut('x-circle')
  if (eaten) {
    react(spat ? 'confused' : 'happy', 2500)
    const what = eaten === 1 ? `« ${shorten(result.trashed[0].name, 40)} » est` : `${eaten} éléments sont`
    const refusedNote = spat ? ` Mais je recrache « ${shorten(result.refused[0].name, 30)} » : ${result.refused[0].reason}.` : ''
    undoUntil = Date.now() + 15_000
    say(`Miam ! ${what} dans la corbeille.${refusedNote} Clique ici pour annuler.`, { ms: 15_000, action: undoSwallow, important: true })
  } else if (spat) {
    react('angry', 2200)
    say(`Beurk ! Je ne mange pas « ${shorten(result.refused[0].name, 40)} » : ${result.refused[0].reason}.`, { ms: 5000, important: true })
  } else {
    react('sad', 2000)
    const failed = result.failed[0]
    say(`Je n’ai pas réussi à avaler « ${shorten(failed?.name || '?', 40)} » (ouvert ailleurs ou introuvable).`, { ms: 5000, important: true })
  }
}
async function undoSwallow() {
  if (Date.now() > undoUntil) return
  undoUntil = 0
  spitOut('arrow-u-up-left')
  react('surprised', 1500)
  say('Beurk, je recrache tout…', { ms: 2500, important: true })
  const result = await api.undoSwallow()
  if (result?.restored?.length && !result.failed.length) {
    say(`C’est revenu à sa place : ${result.restored.length === 1 ? `« ${shorten(result.restored[0], 40)} »` : `${result.restored.length} éléments`}.`, { ms: 4000, important: true })
  } else {
    react('sad', 2000)
    say('Je n’ai pas pu tout recracher : regarde dans la corbeille.', { ms: 5000, important: true })
  }
}

addEventListener('dragenter', e => {
  api.debug(`dragenter types=${[...(e.dataTransfer?.types || [])].join(',')} à ${e.clientX},${e.clientY}`)
  if (!settings.feedOn || !hasFiles(e) || eating) return
  e.preventDefault()
  dragDepth += 1
  openMouth()
})
addEventListener('dragover', e => {
  if (!hasFiles(e)) return
  e.preventDefault() // sans ça, Chromium ouvrirait le fichier dans la fenêtre
  e.dataTransfer.dropEffect = settings.feedOn && !eating ? 'move' : 'none'
})
addEventListener('dragleave', e => {
  if (!hasFiles(e) || eating || !dragDepth) return
  dragDepth -= 1
  if (dragDepth === 0) closeMouth(true)
})
addEventListener('drop', e => {
  e.preventDefault()
  api.debug(`drop de ${e.dataTransfer?.files?.length ?? 0} élément(s)`)
  dragDepth = 0
  if (!settings.feedOn || eating || !hasFiles(e)) return
  swallow([...e.dataTransfer.files], { x: e.clientX, y: e.clientY })
})

// ---------- Agents de code (Claude Code) : Nuage réagit à ce qu'ils font ----------
const lastDone = new Map()
let lastWorking = 0
api.onAgentEvent(e => {
  const who = e.title || 'Claude'
  // Nuage habite l'encoche : elle montre elle-même la demande, la question ou la fin (cartes à la Coucou)
  if (settings.home && ['permission', 'question', 'done'].includes(e.type)) return
  if (e.type === 'permission') {
    react('curious', 3000)
    say(`🔐 ${who} demande : ${e.label}. Réponds en haut de l’écran.`, { ms: 8000, important: true })
  } else if (e.type === 'question') {
    react('curious', 3000)
    say(`❓ ${who} te pose une question (en haut de l’écran).`, { ms: 8000, important: true })
  } else if (e.type === 'notification') {
    say(`💤 ${who} attend ta réponse.`, { ms: 5000 })
  } else if (e.type === 'done') {
    const now = Date.now()
    if (now - (lastDone.get(e.sessionId) || 0) < 60_000) return
    lastDone.set(e.sessionId, now)
    react('happy', 2500)
    play('succes')
    say(`✅ ${who} a fini.`, { ms: 4500 })
  } else if (e.type === 'working') {
    const now = Date.now()
    if (now - lastWorking < 45_000 || reactTimer || playingMusic() || watching() || asleep()) return
    lastWorking = now
    react('working', 3000)
    play('tic')
  }
})

// ---------- Téléchargements : il se remplit d'eau verte, la flèche tombe dedans, il annonce la fin ----------
// Sans l'extension de navigateur, la taille finale est inconnue : l'eau monte doucement (sans jamais
// finir) et le ventre affiche les Mo reçus ; avec elle, le vrai pourcentage.
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Ko'
  for (const [unit, size] of [['Go', 1e9], ['Mo', 1e6], ['Ko', 1e3]]) {
    if (bytes < size) continue
    const v = bytes / size
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace('.', ',').replace(/,0$/, '')} ${unit}`
  }
  return `${bytes} o`
}
let download = null // { since, lastBytes, lastChange }
const announcedDownloads = new Set()
let drainTimer = null
dlArrow.addEventListener('animationiteration', () => {
  if (download && !document.body.classList.contains('dl-stalled')) life.action('sip', 400)
})
// (la flèche est un <svg> : « hidden » s'y pose comme attribut, pas comme propriété)
function endDownloadLook() {
  dlArrow.setAttribute('hidden', '')
  document.body.classList.remove('downloading', 'dl-stalled', 'dl-up')
}
function showDownloadProgress(e) {
  const now = Date.now()
  if (e.received !== download.lastBytes) {
    download.lastBytes = e.received
    download.lastChange = now
  }
  const exact = e.percent !== null && e.percent !== undefined
  const level = exact ? e.percent / 100 : 0.85 * (1 - Math.exp(-(now - download.since) / 30_000))
  skin.setDownload({ on: true, level, text: exact ? `${Math.floor(e.percent)} %` : formatSize(e.received) })
  document.body.classList.toggle('dl-stalled', Boolean(e.paused) || now - download.lastChange > 6000)
}
let lastProgress = null
api.onDownload(e => {
  if (!e) return
  if (e.type === 'progress') {
    clearTimeout(drainTimer)
    const now = Date.now()
    if (!download) {
      download = { since: Math.min(now, e.startedAt || now), lastBytes: e.received, lastChange: now }
      if (asleep()) setBase(restingMood())
      react('excited', 1600)
      play('pop')
    }
    lastProgress = e
    // Annoncé une seule fois par fichier, dès que son nom est connu (Chrome commence par « Unconfirmed »)
    const key = `${e.source || ''}|${e.name || ''}`
    if (!announcedDownloads.has(key) && (e.name || now - download.since > 2500)) {
      announcedDownloads.add(key)
      const name = shorten(e.name || '', 40)
      say(e.source === 'telephone' ? `📱 Je reçois « ${name} » de ton téléphone…`
        : e.source === 'envoi' ? `📤 J’envoie « ${name} » à ton téléphone…`
          : e.name ? `📥 Je télécharge « ${name} »…` : '📥 Un téléchargement commence…', { ms: 3500 })
    }
    dlArrow.removeAttribute('hidden')
    document.body.classList.add('downloading')
    document.body.classList.toggle('dl-up', e.source === 'envoi') // envoi : la flèche part vers le haut
    showDownloadProgress(e)
    return
  }
  if (e.type === 'done') {
    endDownloadLook()
    download = null
    skin.setDownload({ on: false, done: true })
    if (asleep()) setBase(restingMood())
    life.action('cheer', 1700)
    react('celebrate', 2600)
    play('succes')
    if (e.source === 'envoi') say(`📤 « ${shorten(e.name, 40)} » est arrivé sur ${e.to || 'ton téléphone'}.`, { ms: 6000, important: true })
    else {
      const what = e.source === 'telephone' ? `📱 Reçu de ${e.from || 'ton téléphone'}` : '✅ Téléchargement terminé'
      say(`${what} : « ${shorten(e.name, 40)} » (${formatSize(e.size)}). Clique ici pour le voir.`,
        { ms: 10_000, important: true, action: () => api.showDownload(e.path) })
    }
    clearTimeout(drainTimer)
    drainTimer = setTimeout(() => {
      if (!download) skin.setDownload({ on: false }) // l'eau se vide, il reprend sa couleur
    }, 2800)
    return
  }
  if (e.type === 'cancel') {
    endDownloadLook()
    download = null
    skin.setDownload({ on: false })
    react('sad', 1800)
    say(e.name ? `Téléchargement annulé : « ${shorten(e.name, 40)} ».` : 'Téléchargement annulé.', { ms: 3500 })
    return
  }
  // idle : plus rien en cours
  announcedDownloads.clear()
  if (download) {
    endDownloadLook()
    download = null
    skin.setDownload({ on: false })
  }
})
// Sans nouvelles depuis un moment : l'eau continue de monter doucement, la flèche se met en attente
setInterval(() => {
  if (download && lastProgress) showDownloadProgress(lastProgress)
}, 1500)

// ---------- Désœuvrement : petites actions quand rien ne se passe ----------
function doIdle(name) {
  switch (name) {
    case 'regard':
      react('expr:far-right-glance', 1000)
      setTimeout(() => {
        if (current === 'expr:far-right-glance') react('expr:attentive-left', 1000)
      }, 950)
      break
    case 'saut':
      life.action('hop')
      react('happy', 1100)
      break
    case 'pirouette':
      life.action('spin')
      react('playful', 1400)
      break
    case 'etirement':
      life.action('stretch')
      react('expr:eyes-closed', 1300)
      break
    case 'souffle':
      life.blow()
      react('expr:joyful-wide', 900)
      break
    case 'clin':
      react('winking', 1500)
      break
    case 'ebroue':
      life.action('shake')
      life.splash()
      react('expr:eyes-closed', 900)
      break
    case 'chaleur':
      life.emote('goutte')
      react('expr:sleepy-squint', 1800)
      break
    case 'baille':
      react('drowsy', 2600)
      break
  }
}
setInterval(() => {
  const eligible = !dragging && !down && !reactTimer && !eating && !download && !pomodoro &&
    (base === 'idle' || base === 'happy') && !playingMusic() && !watching() && !cinemaQuietNow() &&
    idleState === 'active' && !document.hidden
  const h = new Date().getHours()
  const name = life.pickIdle({
    eligible,
    wet: ['pluie', 'bruine', 'orage'].includes(weather?.key),
    hot: Boolean(weather && !weather.night && weather.temp >= 31),
    late: h >= 22 || h < 6,
  })
  if (name) doIdle(name)
}, 1000)

// Pour l'auto-test (aucune vraie souris) : état de la peau et de la physique, actions à la demande
globalThis.nuageDebug = {
  skin: () => skin.debug(),
  life: () => life.state(),
  simulate: v => life.simulate(v),
  idle: doIdle,
  emote: kind => life.emote(kind),
}

// ---------- Le téléphone charge (05/10/2026 : « une animation quand je charge le tel, donne-toi à fond ») ----------
// Branché : Nuage se remplit d'énergie jusqu'au niveau de la batterie, des éclairs jaillissent autour de
// lui, puis il se vide et une capsule ⚡ (petite batterie qui se remplit) suit la charge sous lui.
// Plein : il fête ça ; débranché : la capsule s'en va. La capsule ne bouge qu'avec la boucle d'affichage
// (24 images/s au repos), jamais avec une animation CSS infinie (voir « Rythme d'affichage »).
const chargeEl = $('charge')
const chargeFill = $('charge-fill')
const charges = new Map() // téléphone → { niveau, nom, eta }
let chargeBurstTimer = null
function renderCharge() {
  const list = [...charges.values()]
  chargeEl.hidden = !list.length
  if (!list.length) return
  const c = list.sort((a, b) => a.niveau - b.niveau)[0]
  const width = (Math.max(0.06, Math.min(1, c.niveau / 100)) * 20.5).toFixed(2)
  chargeFill.setAttribute('width', width)
  $('charge-clip-rect').setAttribute('width', width) // le reflet ne passe que sur la partie remplie
  chargeEl.classList.toggle('low', c.niveau < 20)
  chargeEl.classList.toggle('full', c.niveau >= 100)
  $('charge-text').textContent = `${c.niveau} %`
  chargeEl.title = `${c.nom} en charge : ${c.niveau} %${c.eta ? `, plein dans ~${c.eta} min` : ''}`
}
function chargeBurst(niveau) {
  // Il se remplit d'énergie jusqu'au niveau du téléphone… sauf s'il montre déjà un vrai téléchargement
  if (document.body.classList.contains('downloading')) return
  clearTimeout(chargeBurstTimer)
  document.body.classList.add('charging-burst')
  skin.setDownload({ on: true, level: Math.max(0.08, niveau / 100), text: `${niveau} %` })
  chargeBurstTimer = setTimeout(() => {
    document.body.classList.remove('charging-burst')
    if (!document.body.classList.contains('downloading')) skin.setDownload({ on: false })
  }, 3200)
}
api.onPhoneCharge(c => {
  const name = c.nom || 'Ton téléphone'
  if (c.etat === 'debranche' || c.etat === 'hors-ligne') {
    const had = charges.delete(c.id)
    renderCharge()
    if (c.etat === 'debranche' && had) {
      life.action('jelly')
      react('surprised', 1200)
      say(`🔌 ${name} débranché à ${c.niveau} %.`, { ms: 4500 })
    }
    return
  }
  charges.set(c.id, { niveau: c.niveau, nom: name, eta: c.eta ?? charges.get(c.id)?.eta ?? null })
  renderCharge()
  chargeEl.classList.remove('bump')
  void chargeEl.offsetWidth
  chargeEl.classList.add('bump') // petit sursaut à chaque pour cent
  if (c.etat === 'branche') {
    play('pop')
    life.action('hop')
    life.emote('eclair')
    react('excited', 3000)
    chargeBurst(c.niveau)
    say(`⚡ ${name} branché : ${c.niveau} %. Je surveille la charge !`, { ms: 5500, icon: ['lightning', 'soleil'] })
  } else if (c.etat === 'plein') {
    life.action('cheer', 1700)
    life.emote('etoiles')
    react('celebrate', 2600)
    play('succes')
    say(`🔋 ${name} est chargé à 100 % : tu peux le débrancher.`, { ms: 8000, important: true, icon: ['lightning', 'pelouse'] })
  }
})

// Messages ponctuels du processus principal (ex. écran de verrouillage mis à jour)
api.onNotice(text => {
  react('happy', 2000)
  say(text, { ms: 6000, important: true })
})

// ---------- Voix : « Hey Nuage » (05/10/2026) ----------
// L'écoute se fait dans le processus principal (voix.ps1, hors ligne) ; ici, Nuage réagit (il tend
// l'oreille, montre ce qu'il comprend, réfléchit) et lit les réponses avec la synthèse vocale de Windows,
// la bouche en mouvement. Une fois fini, il le dit au processus principal (l'écoute reprend).
const MIC = ['microphone', 'ciel']
api.onVoice(v => {
  if (v.etat === 'ecoute') {
    react('listening', 9000)
    if (!v.texte) play('ding')
    say(v.texte ? `« ${v.texte} »` : 'Je t’écoute…', { ms: 9000, important: true, icon: MIC, voice: true })
  } else if (v.etat === 'compris') {
    say(`« ${v.texte} »`, { ms: 4000, important: true, icon: MIC, voice: true })
  } else if (v.etat === 'reflechit') {
    react('thinking', 60_000)
    say('Je demande à Claude…', { ms: 60_000, important: true, icon: ['chat-circle-dots', 'ciel'], voice: true })
  } else if (v.etat === 'silence') {
    react('confused', 1600)
    say('Je n’ai rien entendu.', { ms: 2500, important: true, icon: ['ear', 'ardoise'], voice: true })
  } else if (v.etat === 'repos' && /^(listening|thinking)$/.test(current)) {
    show(base)
  }
})
function frenchVoice() {
  const voices = speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang))
  return voices.find(v => /julie|hortense|denise|paul|henri/i.test(v.name)) || voices[0] || null
}
function stopTalking() {
  document.body.classList.remove('talking', 'lipsync')
  document.body.style.removeProperty('--parole')
  clearTimeout(reactTimer)
  reactTimer = null
  show(base)
}

// Voix naturelle (Piper, 05/10/2026) : chaque phrase arrive en WAV, jouée à la suite des autres ; la
// bouche suit le volume de la voix (au lieu de s'ouvrir et se fermer en boucle)
let speechId = 0
let audioCtx = null
let speechAnalyser = null
let speechLevels = null
let playHead = 0
const speechSources = new Set()
function stopSpeechAudio() {
  for (const src of speechSources) {
    try {
      src.stop()
    } catch {}
  }
  speechSources.clear()
  playHead = 0
}
// Appelé par la boucle d'affichage (60 images/s pendant qu'il parle)
function lipSync() {
  if (!speechAnalyser || !document.body.classList.contains('lipsync')) return
  speechAnalyser.getByteTimeDomainData(speechLevels)
  let sum = 0
  for (const v of speechLevels) sum += (v - 128) ** 2
  const level = Math.min(1, Math.sqrt(sum / speechLevels.length) / 38)
  document.body.style.setProperty('--parole', level.toFixed(2))
}
api.onSpeakAudio(async ({ id, wav, last }) => {
  if (id !== speechId) return // une réponse plus ancienne, interrompue
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
      speechAnalyser = audioCtx.createAnalyser()
      speechAnalyser.fftSize = 512
      speechLevels = new Uint8Array(speechAnalyser.fftSize)
      speechAnalyser.connect(audioCtx.destination)
    }
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav)
    const buffer = await audioCtx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    if (id !== speechId) return
    const src = audioCtx.createBufferSource()
    src.buffer = buffer
    src.connect(speechAnalyser)
    const at = Math.max(audioCtx.currentTime + 0.03, playHead)
    src.start(at)
    playHead = at + buffer.duration
    speechSources.add(src)
    src.onended = () => {
      speechSources.delete(src)
      if (last && id === speechId && !speechSources.size) {
        stopTalking()
        api.voiceSpoken()
      }
    }
  } catch (error) {
    api.debug(`voix naturelle, lecture impossible : ${error.message}`)
    if (last && id === speechId) {
      stopTalking()
      api.voiceSpoken()
    }
  }
})
api.onSpeak(({ texte, stop, muet, id, naturel, suite }) => {
  speechSynthesis.cancel()
  if (stop) {
    speechId = -1
    stopSpeechAudio()
    return stopTalking()
  }
  if (naturel) {
    speechId = id
    stopSpeechAudio()
    react('happy', 120_000)
    document.body.classList.add('talking', 'lipsync')
    say(texte, { ms: Math.min(30_000, 3000 + texte.length * 65), important: true, icon: ['waveform', 'ciel'] })
    return
  }
  if (suite) {
    // La voix naturelle a calé : la voix de Windows finit la réponse (la bulle est déjà affichée)
    document.body.classList.remove('lipsync')
    const u = new SpeechSynthesisUtterance(texte)
    u.lang = 'fr-FR'
    const voice = frenchVoice()
    if (voice) u.voice = voice
    u.onend = u.onerror = () => {
      stopTalking()
      api.voiceSpoken()
    }
    speechSynthesis.speak(u)
    return
  }
  speechId = id ?? speechId
  const ms = Math.min(25_000, 2500 + texte.length * 60)
  react('happy', 60_000)
  document.body.classList.add('talking')
  say(texte, { ms, important: true, icon: ['waveform', 'ciel'] })
  const done = () => {
    stopTalking()
    api.voiceSpoken()
  }
  if (muet) return setTimeout(done, 1200) // auto-test : sans le son
  const u = new SpeechSynthesisUtterance(texte)
  u.lang = 'fr-FR'
  const voice = frenchVoice()
  if (voice) u.voice = voice
  u.rate = 1.03
  u.onend = done
  u.onerror = done
  speechSynthesis.speak(u)
})
speechSynthesis.getVoices() // charge la liste des voix tout de suite

// ---------- Démarrage ----------
applySettings(settings)
api.onSettings(applySettings)
show('idle')
if (settings.firstRun) {
  const tour = settings.home
    ? [
        'Salut, je suis Nuage ! J’habite l’encoche, en haut de l’écran. 👋',
        'Clique sur moi pour ouvrir le chat, ce que font tes agents et ton téléphone.',
        'Glisse un fichier sur l’encoche : je le montre à l’IA, je l’envoie, ou je l’avale.',
        'Ctrl+Alt+N m’ouvre ; tous mes réglages sont dans la barre (roue dentée).',
      ]
    : [
        'Salut, je suis Nuage ! 👋',
        'Fais-moi glisser où tu veux sur l’écran.',
        'Glisse-moi sur la barre du haut : le chat s’y ouvre.',
        'Mes réglages : la roue dentée de la barre du haut.',
        'Ctrl+Alt+N pour me cacher ou me rappeler.',
      ]
  tour.forEach((text, i) => setTimeout(() => say(text, { ms: 3800, important: true }), 600 + i * 4000))
  setTimeout(() => react('winking', 2500), 600)
  api.firstRunDone()
} else {
  react('surprised', 1200)
  setTimeout(() => say(greeting(false)), 400)
}
// Les annonces (météo…) attendent la fin de la salutation ou de la visite
queueBusy = true
setTimeout(nextAnnouncement, settings.firstRun ? 21_000 : 5_000)
api.ready()

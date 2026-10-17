// Nuage de poche : Nuage sur le téléphone Android, lié au PC (fichiers dans les deux sens, copier-coller,
// nouvelles du PC, « où est mon téléphone ? »). Même moteur, même peau et même vie que sur le PC (dossier
// partage/, copié depuis ../renderer).
// Le lien (réseau, chiffrement, service en arrière-plan) est en Java : plugin « Lien » (LienPlugin.java).
// Refonte du 06/10/2026 : mise en page de l'appli iPhone de Coucou (Louis-CFM, MIT), adaptée à Android.
import { createAvatar } from './partage/vendor/avatar-web.js'
import { createSkin } from './partage/peau.js'
import { createLife } from './partage/vie.js'
import { icon } from './partage/icones.js'
import { play } from './partage/sons.js'

const $ = id => document.getElementById(id)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const pick = list => list[Math.floor(Math.random() * list.length)]
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const shorten = (text, max = 40) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text))
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Ko'
  for (const [unit, size] of [['Go', 1e9], ['Mo', 1e6], ['Ko', 1e3]]) {
    if (bytes >= size) return `${(bytes / size).toFixed(bytes / size >= 100 ? 0 : 1).replace('.', ',').replace(/,0$/, '')} ${unit}`
  }
  return `${bytes} o`
}
const when = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

// Plugin natif (absent dans un navigateur : mode démonstration avec ?demo)
const cap = window.Capacitor
const Lien = cap?.registerPlugin ? cap.registerPlugin('Lien') : cap?.Plugins?.Lien || null

// ---------- Nuage ----------
const avatarEl = $('avatar')
const avatar = createAvatar(avatarEl, { definition: window.NUAGE_AVATAR, defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage' })
const skin = createSkin({ defs: $('skin-defs'), reduceMotion })
skin.attach(avatarEl.querySelector('svg'))
document.fonts.load('800 20px Nunito').then(() => skin.setLabel(true)).catch(() => {})
const life = createLife({ bodyEl: $('body'), lifeEl: $('life'), emotesEl: $('emotes'), trailEl: $('trail'), reduceMotion })

let base = 'idle'
let current = ''
let reactTimer = null
const BLUSH = { shy: 0.95, happy: 0.45, laughing: 0.55, excited: 0.4, winking: 0.5, playful: 0.4, celebrate: 0.5 }
const MOOD_EMOTE = { surprised: 'surprise', confused: 'question', shy: 'coeur', celebrate: 'etoiles', sad: 'goutte' }
function show(key) {
  if (key === current) return
  current = key
  if (key.startsWith('expr:')) avatar.setExpression(key.slice(5))
  else avatar.play(key)
  skin.setBlush(BLUSH[key] || 0)
}
function react(key, ms = 2400) {
  if (MOOD_EMOTE[key]) life.emote(MOOD_EMOTE[key])
  show(key)
  clearTimeout(reactTimer)
  reactTimer = setTimeout(() => {
    reactTimer = null
    show(base)
  }, ms)
}
show('idle')

// Bulle de parole (mêmes pastilles d'icônes que sur le PC)
const bubble = $('bubble')
let bubbleTimer = null
function say(text, { ms = 4000, icon: chip = null } = {}) {
  const words = el('span', 'b-text', text)
  if (chip) {
    const box = el('span', `b-ico tone-${chip[1]}`)
    box.append(icon(chip[0]))
    bubble.replaceChildren(box, words)
  } else {
    bubble.replaceChildren(words)
  }
  bubble.classList.toggle('with-icon', Boolean(chip))
  bubble.classList.add('show')
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms)
}

// Ce que fait Nuage : une pastille allumée (calme, reçoit, envoie, copie, nouvelle, sonne) et la couleur du halo
let moodTimer = null
let ringing = false
let battery = null // { niveau, charge } : la batterie du téléphone (voir « Le téléphone charge »)
function setMood(mood, ms = 0) {
  clearTimeout(moodTimer)
  // Au calme pendant la charge : la pastille « charge » reste allumée
  document.body.dataset.mood = ringing ? 'sonne' : mood === 'calme' && battery?.charge ? 'charge' : mood
  if (ms) moodTimer = setTimeout(() => setMood(transferring ? transferDir : 'calme'), ms)
}

// Toucher : il gigote ; appui long : câlin
let pressTimer = null
let longPress = false
avatarEl.addEventListener('pointerdown', () => {
  longPress = false
  pressTimer = setTimeout(() => {
    longPress = true
    react('shy', 2400)
    say(pick(['Hihi, ça chatouille.', 'Tu me fais un câlin ?', 'Rrrr…']), { ms: 2400 })
  }, 650)
})
avatarEl.addEventListener('pointerup', () => {
  clearTimeout(pressTimer)
  if (longPress) return
  life.action('jelly')
  react(pick(['happy', 'laughing', 'playful', 'excited']), 2200)
  play(pick(['pop', 'rire', 'gazouillis']))
  say(pick(['Coucou !', 'Hihi !', 'Je flotte, je flotte…', 'Appui long sur moi pour un câlin.', 'Je surveille ton PC pour toi.']), { ms: 2600 })
})
avatarEl.addEventListener('pointercancel', () => clearTimeout(pressTimer))

// Petites actions quand rien ne se passe (comme sur le PC)
let weather = null
setInterval(() => {
  const name = life.pickIdle({
    eligible: !reactTimer && !document.hidden && !transferring && !ringing,
    wet: ['pluie', 'bruine', 'orage'].includes(weather?.key),
    hot: Boolean(weather && !weather.night && weather.temp >= 31),
    late: new Date().getHours() >= 22 || new Date().getHours() < 6,
  })
  if (name) (IDLE[name] || IDLE.regard)()
}, 1000)
const IDLE = {
  regard: () => react('expr:far-right-glance', 1000),
  saut: () => {
    life.action('hop')
    react('happy', 1100)
  },
  pirouette: () => {
    life.action('spin')
    react('playful', 1400)
  },
  etirement: () => {
    life.action('stretch')
    react('expr:eyes-closed', 1300)
  },
  souffle: () => {
    life.blow()
    react('expr:joyful-wide', 900)
  },
  ebroue: () => {
    life.action('shake')
    life.splash()
    react('expr:eyes-closed', 900)
  },
  chaleur: () => {
    life.emote('goutte')
    react('expr:sleepy-squint', 1800)
  },
  baille: () => react('drowsy', 2600),
  clin: () => react('winking', 1500),
}

// ---------- Grand nombre sous Nuage : température, ou progression d'un transfert, ou la batterie ----------
function readout(digits, line1, line2) {
  $('digits').textContent = digits.replace(/%$/, ' %')
  $('cap-1').textContent = line1
  $('cap-2').textContent = line2
}
const CONDITION = { soleil: 'soleil', eclaircies: 'éclaircies', couvert: 'couvert', brouillard: 'brouillard', bruine: 'bruine', pluie: 'pluie', neige: 'neige', orage: 'orage' }
function weatherReadout() {
  if (transferring) return
  // En charge : le grand nombre montre la batterie, avec une vague d'énergie
  if (battery?.charge) return readout(`${battery.niveau}%`, battery.niveau >= 100 ? 'batterie pleine' : 'en charge', battery.niveau >= 100 ? 'tu peux débrancher' : 'énergie qui monte')
  if (!weather) return readout('', 'Météo', 'hors ligne')
  const sky = weather.night && ['soleil', 'eclaircies'].includes(weather.key) ? 'nuit claire' : CONDITION[weather.key] || weather.key
  readout(`${weather.temp}°`, weather.place || 'ici', sky)
}

// ---------- Le téléphone charge (05/10/2026 : « une animation quand je charge le tel, donne-toi à fond ») ----------
// Branché : des éclairs jaillissent, Nuage se remplit d'énergie jusqu'au niveau de la batterie et y reste
// tant que ça charge (le pourcentage écrit sur son front), étincelles qui montent, pastille « charge », grand
// nombre en points avec une vague d'énergie ; plein : il fête ça ; débranché : il se vide. Un transfert de
// fichier passe devant, puis la batterie reprend.
const sparksEl = $('sparks')
for (let i = 0; i < 9; i++) {
  const s = el('i')
  s.style.setProperty('--x', `${18 + i * 8 + Math.round(Math.random() * 6)}%`)
  s.style.setProperty('--d', `${(i * 0.29).toFixed(2)}s`)
  sparksEl.append(s)
}
function applyBattery() {
  const charging = Boolean(battery?.charge && battery.niveau >= 0)
  document.body.classList.toggle('charging', charging)
  if (transferring) return
  if (charging) skin.setDownload({ on: true, level: Math.max(0.06, battery.niveau / 100), text: `${battery.niveau} %` })
  else skin.setDownload({ on: false })
  if (charging || document.body.dataset.mood === 'charge') setMood('calme')
  weatherReadout()
}
function onBattery(b) {
  if (!b || b.niveau < 0) return
  const was = battery
  battery = { niveau: b.niveau, charge: Boolean(b.charge) }
  if (was && battery.charge && !was.charge) {
    // Branché !
    life.emote('eclair')
    life.action('hop')
    react('excited', 2600)
    play('pop')
    say(pick([`Miam, de l’énergie ! ${b.niveau} %`, `Ça charge ! ${b.niveau} %, je me remplis.`, `Branché ! Je fais le plein : ${b.niveau} %.`]), { ms: 4500, icon: ['lightning', 'soleil'] })
  } else if (was && !battery.charge && was.charge) {
    life.action('jelly')
    react('surprised', 1400)
    say(`Débranché à ${b.niveau} %.`, { ms: 3500, icon: ['plug', 'pelouse'] })
  } else if (was && battery.charge && battery.niveau >= 100 && was.niveau < 100) {
    life.action('cheer', 1700)
    life.emote('etoiles')
    react('celebrate', 2600)
    play('succes')
    say('Batterie pleine ! Tu peux me débrancher.', { ms: 6000, icon: ['lightning', 'pelouse'] })
  }
  applyBattery()
}

// ---------- Météo sur son corps (Open-Meteo, ville approximative par l'adresse IP, comme sur le PC) ----------
function conditionFromCode(code) {
  if (code === 0) return 'soleil'
  if (code === 1 || code === 2) return 'eclaircies'
  if (code === 3) return 'couvert'
  if (code === 45 || code === 48) return 'brouillard'
  if (code >= 51 && code <= 57) return 'bruine'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'pluie'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neige'
  if (code >= 95) return 'orage'
  return 'eclaircies'
}
// Météo du PC (sa ville, réglée sur le PC) : prioritaire. Deviner la ville par l'adresse Internet se trompe
// sur un routeur 4G (l'adresse est celle de l'opérateur, souvent dans une autre ville) — 05/10/2026
let pcWeather = false
function applyPcWeather(w) {
  if (!w || typeof w.temp !== 'number') return
  pcWeather = true
  applyWeather({ key: w.key, night: Boolean(w.night), temp: Math.round(w.temp), place: w.place || '' })
}
async function refreshWeather() {
  if (pcWeather) return // le PC envoie la sienne à chaque relève
  try {
    const ip = await (await fetch('https://get.geojs.io/v1/ip/geo.json')).json()
    const url = `https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,is_day&timezone=auto&latitude=${Number(ip.latitude)}&longitude=${Number(ip.longitude)}`
    const c = (await (await fetch(url)).json()).current
    applyWeather({ key: conditionFromCode(c.weather_code), night: c.is_day === 0, temp: Math.round(c.temperature_2m), place: ip.city || ip.country || '' })
    Lien?.meteo({ meteo: weather }) // la bulle flottante prend la même peau
  } catch {
    weatherReadout() // hors ligne : Nuage garde sa couleur
  }
}
function applyWeather(w) {
  weather = w
  skin.setWeather(weather)
  document.body.dataset.weather = weather.key
  document.body.toggleAttribute('data-night', weather.night)
  $('weather-line').textContent = `${weather.place ? `${weather.place} · ` : ''}${weather.temp} °C`
  weatherReadout()
}

// ---------- Lien avec le PC ----------
let state = { associe: false, pc: null, connecte: false, recus: [], nouvelles: [] }
// Association (v1.8) : déclarées ICI, avant le premier render() du fichier. Dans la v1.7, `pairingNow` et `stateLoaded`
// étaient déclarées bien plus bas : render() → autoPair() les lisait avant leur déclaration (ReferenceError), le
// script s'arrêtait au démarrage et les boutons « Trouver mon PC », chat et micro n'étaient jamais branchés.
let pairingNow = false // une association est en cours
let autoPairTried = false // la recherche automatique a eu lieu (une fois par ouverture)
let refusedAsked = false // « le PC ne te reconnaît plus » a déjà été proposé
let stateLoaded = false // l'état vient du service (avant : valeurs par défaut, « pas associé »)
let searching = false // « hors de portée » touché : recherche du PC habituel en cours
let localNets = [] // réseaux du téléphone : [{ nom, moi, prefixe }]
// Agents de code du PC (06/10/2026), déclarés ici pour la même raison : render() les lit dès le démarrage
let view = 'nuage' // onglet : nuage | agents | services
let agentsState = null // dernier résumé du PC (agents-telephone.js)
let sessionOpen = null // session affichée en détail
let transferring = false
let transferDir = 'recoit'
const arrow = $('dl-arrow')
const KIND = [[/^image\//, 'image'], [/^video\//, 'file-video'], [/^audio\//, 'file-audio'], [/pdf$/, 'file-pdf'], [/zip|rar|7z/, 'file-zip']]

function render() {
  const chip = $('pc-chip')
  chip.classList.toggle('online', Boolean(state.connecte))
  chip.classList.toggle('away', Boolean(state.associe && !state.connecte))
  $('pc-name').textContent = !state.associe ? 'aucun PC' : state.connecte ? state.pc?.nom || 'PC' : 'hors de portée'
  chip.title = state.connecte ? 'PC connecté' : 'Touche pour chercher le PC sur le Wi-Fi'
  document.body.classList.toggle('offline', Boolean(state.associe && !state.connecte))
  $('version').textContent = `${state.version ? `v${state.version} · ` : ''}android`
  $('float-on').checked = Boolean(state.bulle)
  $('way-bubble').classList.toggle('off', !state.bulle)
  $('add-tile').hidden = !state.tuile || !Lien
  for (const id of ['ask-zone', 'tiles', 'wake-group', 'instant', 'feed']) $(id).hidden = !state.associe
  $('pair').hidden = state.associe
  $('forget').hidden = !state.associe
  $('tabbar').hidden = !state.associe
  document.body.classList.toggle('has-tabbar', Boolean(state.associe))
  if (!state.associe && view !== 'nuage') showView('nuage')
  autoPair()
  setRinging(Boolean(state.sonne))
  const rows = [
    ...(state.recus || []).map(r => ({ at: r.at, kind: 'fichier', ...r })),
    ...(state.nouvelles || []).map(n => ({ at: n.at, kind: 'nouvelle', ...n })),
  ].sort((a, b) => b.at - a.at).slice(0, 25)
  $('feed-count').textContent = rows.length ? plural(rows.length, 'élément') : ''
  $('items').replaceChildren(...rows.map(row => {
    const li = el('li', `item k-${row.kind}`)
    const ico = el('span', 'i-ico')
    ico.append(icon(row.kind === 'fichier' ? KIND.find(([re]) => re.test(row.type || ''))?.[1] || 'file' : row.genre === 'claude' ? 'robot' : 'bell-ringing'))
    const text = el('div', 'i-text')
    text.append(
      el('b', '', row.kind === 'fichier' ? row.nom : row.titre),
      el('small', '', row.kind === 'fichier' ? `reçu · ${formatSize(row.taille)} · ${when(row.at)}` : `${row.texte ? `${shorten(row.texte, 40)} · ` : ''}${when(row.at)}`),
    )
    li.append(ico, text)
    if (row.kind === 'fichier' && Lien) {
      const open = el('button', 'i-act', 'Ouvrir')
      open.type = 'button'
      open.addEventListener('click', () => Lien.ouvrir({ uri: row.uri, type: row.type || '' }))
      li.append(open)
    }
    return li
  }))
  $('empty').hidden = rows.length > 0
}

// Le PC fait sonner le téléphone : bandeau « Je l'ai trouvé », Nuage s'agite
function setRinging(on) {
  if (on === ringing) return
  ringing = on
  $('ring').hidden = !on
  if (on) {
    setMood('sonne')
    react('surprised', 3000)
    life.action('shake')
    say('Ton PC te cherche ! Je suis là !', { ms: 5000, icon: ['bell-ringing', 'soleil'] })
  } else {
    setMood('calme')
  }
}

function onTransfer(t) {
  // t : { sens: 'recu' | 'envoi', nom, taille, fait, fini, annule }
  if (t.annule || t.fini) {
    transferring = false
    arrow.setAttribute('hidden', '')
    document.body.classList.remove('downloading', 'dl-up')
    $('send-files').classList.remove('busy')
  }
  if (t.annule) {
    skin.setDownload({ on: false })
    react('sad', 1800)
    setMood('calme')
    weatherReadout()
    applyBattery()
    say(`Transfert annulé : « ${shorten(t.nom)} ».`, { icon: ['x-circle', 'alerte'] })
    return
  }
  if (t.fini) {
    skin.setDownload({ on: false, done: true })
    life.action('cheer', 1700)
    react('celebrate', 2600)
    play('succes')
    readout('100%', t.sens === 'recu' ? 'reçu' : 'envoyé', t.nom)
    setMood(t.sens === 'recu' ? 'recoit' : 'envoie', 3000)
    setTimeout(weatherReadout, 3200)
    say(t.sens === 'recu' ? `Reçu du PC : « ${shorten(t.nom)} » (${formatSize(t.taille)}).` : `« ${shorten(t.nom)} » est arrivé sur le PC.`,
      { ms: 6000, icon: t.sens === 'recu' ? ['download-simple', 'pelouse'] : ['upload-simple', 'pelouse'] })
    setTimeout(() => {
      if (!transferring) {
        skin.setDownload({ on: false })
        applyBattery() // en charge : il se remplit de nouveau au niveau de la batterie
      }
    }, 2800)
    return
  }
  transferDir = t.sens === 'envoi' ? 'envoie' : 'recoit'
  if (!transferring) {
    transferring = true
    react('excited', 1500)
    play('pop')
    say(t.sens === 'recu' ? `Je reçois « ${shorten(t.nom)} » du PC…` : `J’envoie « ${shorten(t.nom)} » au PC…`,
      { ms: 3000, icon: t.sens === 'recu' ? ['download-simple', 'pelouse'] : ['upload-simple', 'pelouse'] })
  }
  setMood(transferDir)
  if (t.sens === 'envoi') $('send-files').classList.add('busy')
  arrow.removeAttribute('hidden')
  document.body.classList.add('downloading')
  document.body.classList.toggle('dl-up', t.sens === 'envoi')
  const level = t.taille ? t.fait / t.taille : 1
  const pct = Math.floor(level * 100)
  skin.setDownload({ on: true, level, text: `${pct} %` })
  readout(`${pct}%`, t.sens === 'recu' ? 'reçoit' : 'envoie', t.nom)
}
arrow.addEventListener('animationiteration', () => transferring && life.action('sip', 400))

async function refreshState() {
  if (!Lien) return
  try {
    state = await Lien.etat()
    stateLoaded = true
    if (state.meteoPc) applyPcWeather(state.meteoPc)
    if (state.batterie !== undefined && !battery) onBattery({ niveau: state.batterie, charge: Boolean(state.charge) })
    render()
  } catch {}
}

if (Lien) {
  Lien.addListener('etat', next => {
    state = next
    stateLoaded = true
    render()
  })
  Lien.addListener('transfert', onTransfer)
  Lien.addListener('meteo', applyPcWeather)
  Lien.addListener('batterie', onBattery)
  // Copié sur le PC → arrivé ici (tout seul)
  Lien.addListener('pressePapiers', p => {
    react('happy', 1600)
    setMood('copie', 3000)
    say(`Copié depuis le PC (${plural(p.longueur, 'caractère')}) : colle où tu veux.`, { icon: ['clipboard-text', 'ciel'] })
  })
  // Copié ici → parti vers le PC (menu du texte, tuile, bulle, notification…)
  Lien.addListener('copie', c => {
    life.emote('etoiles')
    setMood('copie', 3000)
    if (!document.hidden) say(`Sur le PC : Ctrl+V pour le coller (${plural(c.longueur, 'caractère')}).`, { icon: ['clipboard-text', 'ciel'] })
  })
  Lien.addListener('nouvelle', n => {
    react(n.genre === 'claude' ? 'excited' : 'curious', 2000)
    setMood('nouvelle', 5000)
    play('ding')
    say(`${n.titre}${n.texte ? ` : ${shorten(n.texte, 60)}` : ''}`, { ms: 6000, icon: n.genre === 'claude' ? ['robot', 'amethyste'] : ['bell-ringing', 'ciel'] })
  })
  Lien.addListener('sonnerie', s => {
    state = { ...state, sonne: Boolean(s.active) }
    setRinging(Boolean(s.active))
  })
  refreshState()
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    refreshState()
    if (!state.associe) refreshNet()
  })
  refreshNet()
} else {
  // Démonstration hors téléphone (auto-test de l'interface) : ?demo, ?demo=vide, ?demo=sonne
  const demo = new URLSearchParams(location.search).get('demo')
  if (demo !== null) {
    state = demo === 'vide'
      ? { associe: false, version: '1.1' }
      : {
          associe: true, connecte: true, pc: { nom: 'PC-DE-MAISON' }, version: '1.1', bulle: true, tuile: true, sonne: demo === 'sonne',
          recus: [{ nom: 'rapport.pdf', taille: 2_300_000, type: 'application/pdf', at: Date.now() - 600_000 }, { nom: 'photo-plage.jpg', taille: 3_800_000, type: 'image/jpeg', at: Date.now() - 3_600_000 }],
          nouvelles: [{ titre: 'Claude a fini', texte: 'nuage-bureau', genre: 'claude', at: Date.now() - 120_000 }],
        }
    applyWeather({ key: 'eclaircies', night: false, temp: 27, place: 'Lyon' })
    globalThis.demo = { onTransfer, onBattery, say, render, setMood, readout, setState: s => { state = { ...state, ...s }; render() } }
  }
}
render()
weatherReadout()
if (Lien || !globalThis.demo) refreshWeather()
setInterval(refreshWeather, 15 * 60_000)

// ---------- Chat avec Claude, par le PC (05/10/2026) ----------
// Le même chat que dans la barre du haut du PC : ta session Claude Code (ou une discussion simple), avec ton
// abonnement Claude. Le téléphone écrit (ou dicte) ; le PC pose la question et renvoie la réponse en direct.
let chat = null
let chatOpen = false
let chatTimer = null
let speakAnswer = false // la question a été dite à voix haute : la réponse sera lue
const chatEl = $('chat')
const chatLog = $('chat-log')
const chatInput = $('chat-input')
const norm = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
// Ce qui se lit bien à voix haute : sans code, sans lignes d'outils, sans liens ni symboles
function speakable(text) {
  let t = String(text)
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
// Texte d'un message : blocs de code et lignes d'outils (« ⚙ Lit main.js »), jamais interprété comme du HTML
function richText(node, text) {
  node.replaceChildren()
  String(text).split(/```[a-zA-Z0-9]*\n?/).forEach((part, i) => {
    if (!part) return
    if (i % 2) {
      node.append(el('pre', '', part.replace(/\n$/, '')))
      return
    }
    for (const [j, line] of part.split('\n').entries()) {
      if (j) node.append('\n')
      if (line.startsWith('⚙ ')) {
        const tool = el('span', 'tool')
        tool.append(icon('wrench'), line.slice(2))
        node.append(tool)
      } else node.append(line)
    }
  })
}
function renderChat() {
  const c = chat
  const s = c?.session
  const ia = c?.ia || agentsState?.ia || 'Claude' // l'IA choisie sur le PC (Claude, Gemini, ChatGPT…)
  $('chat-sub').textContent = !c ? 'par ton PC' : s ? `${s.projet || s.titre}${s.copie ? ' · copie de session' : s.nouvelle ? ' · nouvelle session' : ''}` : c.fournisseur || 'discussion simple'
  const banner = !state.connecte && Lien ? 'Le PC est hors de portée : le chat passe par ton PC (même Wi-Fi, Nuage ouvert dessus).'
    : c && !c.pret ? c.note || `${ia} n’est pas prêt sur le PC.` : ''
  $('chat-banner').textContent = banner
  $('chat-banner').hidden = !banner
  const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80
  const nodes = []
  const messages = c?.messages || []
  if (!messages.length) nodes.push(el('p', 'chat-empty', s ? `Tu continues « ${s.titre} » (Claude Code, sur ton PC). Écris ou dicte ta demande.` : `Pose ta question à ${ia} : la réponse vient de ton PC.`))
  messages.forEach((m, i) => {
    const last = i === messages.length - 1
    if (m.role === 'assistant' && !m.texte && !m.erreur && last && c.streaming) {
      const dots = el('div', 'typing')
      dots.append(el('i'), el('i'), el('i'))
      nodes.push(dots)
      return
    }
    const bubbleEl = el('div', `msg ${m.role}${m.passe ? ' past' : ''}${m.erreur ? ' error' : ''}`)
    if (m.erreur) bubbleEl.textContent = m.erreur
    else richText(bubbleEl, m.texte || '…')
    nodes.push(bubbleEl)
    const meta = [m.voix && 'dit à voix haute', m.role === 'user' && (m.de === 'telephone' ? 'téléphone' : m.de === 'pc' ? 'PC' : ''), m.fichiers?.length && `${m.fichiers.length} fichier${m.fichiers.length > 1 ? 's' : ''}`].filter(Boolean)
    if (meta.length) nodes.push(el('span', `msg-meta${m.role === 'assistant' ? ' left' : ''}`, meta.join(' · ')))
  })
  chatLog.replaceChildren(...nodes)
  if (nearBottom || c?.streaming) chatLog.scrollTop = chatLog.scrollHeight
  // Autorisation demandée par la session (modifier un fichier, lancer une commande…)
  const perm = $('chat-perm')
  perm.hidden = !c?.permission
  if (c?.permission) {
    const row = el('div', 'row')
    for (const [label, choix, cls] of [['Autoriser', 'allow', 'yes'], ['Refuser', 'deny', ''], ['Toujours', 'always', '']]) {
      const b = el('button', cls, label)
      b.type = 'button'
      b.addEventListener('click', () => chatCall('chatPermission', { id: c.permission.id, choix }))
      row.append(b)
    }
    perm.replaceChildren(el('b', '', `${ia} demande : ${c.permission.label}`), ...(c.permission.commande ? [el('code', '', c.permission.commande)] : []), row)
  }
  $('chat-send').hidden = Boolean(c?.streaming)
  $('chat-stop').hidden = !c?.streaming
}
async function chatCall(method, args = {}) {
  if (!Lien) return globalThis.demoChat?.[method]?.(args)
  try {
    chat = await Lien[method](args)
    renderChat()
    return chat
  } catch (error) {
    $('chat-banner').textContent = error.message
    $('chat-banner').hidden = false
    throw error
  }
}
async function openChat({ listen = false, fromSession = false } = {}) {
  if (!state.associe && Lien) return say('Associe d’abord ton PC.', { icon: ['device-mobile', 'ciel'] })
  chatEl.hidden = false
  $('session-menu').hidden = true
  if (!chatOpen) {
    chatOpen = true
    // Le bouton « retour » d'Android ferme le chat. Venu de l'écran d'une session : le chat prend sa place dans
    // l'historique (un history.back() de la session arriverait après et refermerait le chat)
    if (fromSession && history.state?.session) history.replaceState({ chat: true }, '')
    else history.pushState({ chat: true }, '')
    renderChat()
    chatCall('chatEtat').catch(() => {})
    clearInterval(chatTimer)
    chatTimer = setInterval(() => chatCall('chatEtat').catch(() => {}), 30_000) // le PC sait que l'écran est ouvert
  }
  if (listen) startListening()
}
function closeChat(fromBack = false) {
  if (!chatOpen) return
  chatEl.hidden = true
  chatOpen = false
  clearInterval(chatTimer)
  Lien?.chatFerme().catch(() => {})
  if (!fromBack && history.state?.chat) history.back()
}
async function sendToClaude(texte, { voix = false } = {}) {
  const text = String(texte).trim()
  if (!text) return
  if (!chatOpen) await openChat()
  try {
    await chatCall('chatEnvoyer', { texte: text, voix })
    speakAnswer = voix
    chatInput.value = ''
    autosizeInput()
    play('pop')
  } catch (error) {
    if (voix) Lien?.voixParler({ texte: error.message })
  }
}
function onChat(next) {
  const wasStreaming = chat?.streaming
  chat = next
  if (chatOpen) renderChat()
  // Réponse finie : on la lit si la question a été dite à voix haute
  if (wasStreaming && !next.streaming && speakAnswer) {
    speakAnswer = false
    const last = [...(next.messages || [])].reverse().find(m => m.role === 'assistant')
    const words = last?.erreur || speakable(last?.texte || '')
    if (words) Lien?.voixParler({ texte: words })
  }
}
// Menu des sessions : celles du PC (Claude Code), une nouvelle, ou une discussion simple
function renderSessionMenu() {
  const menu = $('session-menu')
  const item = (ico, title, sub, onClick, on = false) => {
    const b = el('button', on ? 'on' : '')
    b.type = 'button'
    const i = el('span', 's-ico')
    i.append(icon(ico))
    const words = el('span')
    words.append(el('b', '', title), el('small', '', sub))
    b.append(i, words)
    b.addEventListener('click', () => {
      menu.hidden = true
      onClick()
    })
    return b
  }
  const nodes = [
    item('plus', 'Nouvelle session', 'Claude Code, dans le dossier de la dernière', () => chatCall('chatSession', { action: 'nouvelle' }).catch(() => {})),
    item('chat-circle-dots', 'Discussion simple', 'sans session, sans outils', () => chatCall('chatSession', { action: 'quitter' }).catch(() => {}), chat && !chat.session),
  ]
  if (chat?.sessions?.length) nodes.push(el('div', 'sep'))
  for (const s of chat?.sessions || []) {
    const ago = Math.round((Date.now() - s.at) / 60_000)
    nodes.push(item('folder', s.titre, `${s.projet} · ${ago < 60 ? `${ago} min` : `${Math.round(ago / 60)} h`}`, () => chatCall('chatSession', { action: 'continuer', id: s.id }).catch(() => {})))
  }
  menu.replaceChildren(...nodes)
}
function autosizeInput() {
  chatInput.style.height = 'auto'
  chatInput.style.height = `${Math.min(120, chatInput.scrollHeight)}px`
}

// ---------- Voix : « Hey Nuage » quand l'appli est ouverte, et le micro (05/10/2026) ----------
let wakeOn = false
function renderWake(paused = false) {
  $('wake-on').checked = wakeOn
  document.body.classList.toggle('wake-on', wakeOn && !paused)
  document.body.classList.toggle('wake-paused', wakeOn && paused)
  $('wake-state').textContent = !wakeOn ? 'quand l’appli est ouverte' : paused ? 'en pause : touche l’écran' : 'à l’écoute'
}
async function startListening() {
  if (!Lien) return
  try {
    const r = await Lien.voixPhrase()
    if (r.refuse) say('Autorise le micro pour me parler (Réglages d’Android, Nuage de poche, Autorisations).', { ms: 7000, icon: ['microphone-slash', 'alerte'] })
  } catch (error) {
    say(error.message, { icon: ['warning', 'alerte'] })
  }
}
// Petites commandes comprises sur le téléphone ; le reste part à Claude
function handleSpoken(text) {
  const t = norm(text)
  const reply = (words, chip = ['waveform', 'ciel']) => {
    say(words, { ms: 5000, icon: chip })
    Lien?.voixParler({ texte: words })
  }
  if (/^(rien|annule|laisse tomber|non merci|c'?est bon)\b/.test(t)) return reply('D’accord.')
  if (/(tais.toi|arrete de parler|chut)/.test(t)) return Lien?.voixTaire()
  if (/(colle|copie|envoie|passe).*(pc|ordi)/.test(t) && /(presse|copi|colle)/.test(t)) return $('paste-pc').click()
  if (/coucou/.test(t) && /(pc|ordi)/.test(t)) return $('wave').click()
  if (/(ferme|quitte).*(chat|discussion)/.test(t)) return closeChat()
  if (/(ouvre|affiche|montre).*(chat|discussion|conversation)/.test(t)) return openChat()
  if (/nouvelle session/.test(t)) return openChat().then(() => chatCall('chatSession', { action: 'nouvelle' })).catch(() => {})
  if (/(meteo|quel temps|temperature|il fait (chaud|froid|beau))/.test(t)) {
    return reply(weather ? `Il fait ${weather.temp} degrés${weather.place ? ` à ${weather.place}` : ''}, ${weather.night && ['soleil', 'eclaircies'].includes(weather.key) ? 'nuit claire' : CONDITION[weather.key] || weather.key}.` : 'Je n’ai pas la météo pour l’instant.', ['cloud-sun', 'soleil'])
  }
  if (/quelle heure|l'?heure qu'?il est/.test(t)) return reply(`Il est ${new Date().toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(':', ' heures ')}.`, ['clock', 'ciel'])
  sendToClaude(text, { voix: true })
}
function onVoice(v) {
  switch (v.type) {
    case 'ecoute':
      if (v.texte === 'phrase') {
        document.body.classList.add('listening')
        if (chatOpen) chatInput.placeholder = 'Je t’écoute…'
        else say('Je t’écoute…', { ms: 8000, icon: ['microphone', 'ciel'] })
      } else renderWake(false)
      break
    case 'reveil':
      play('ding')
      life.action('hop')
      react('surprised', 1200)
      break
    case 'partiel':
      if (chatOpen) chatInput.value = v.texte
      else say(`« ${shorten(v.texte, 70)} »`, { ms: 8000, icon: ['microphone', 'ciel'] })
      break
    case 'phrase':
      document.body.classList.remove('listening')
      chatInput.placeholder = 'Écris, ou touche le micro…'
      if (chatOpen) chatInput.value = ''
      say(`« ${shorten(v.texte, 70)} »`, { ms: 3000, icon: ['microphone', 'ciel'] })
      handleSpoken(v.texte)
      break
    case 'silence':
      document.body.classList.remove('listening')
      chatInput.placeholder = 'Écris, ou touche le micro…'
      say('Je n’ai rien entendu.', { ms: 2500, icon: ['ear', 'ardoise'] })
      break
    case 'niveau':
      for (const b of [$('ask-mic'), $('chat-mic')]) b.style.setProperty('--niveau', v.texte)
      break
    case 'parle':
      $('chat-speaking').hidden = false
      react('happy', 60_000)
      break
    case 'fini':
      $('chat-speaking').hidden = true
      show(base)
      break
    case 'erreur':
      document.body.classList.remove('listening')
      // Chat ouvert : la bulle de Nuage est cachée, l'erreur s'affiche dans le champ (avant : « Je t'écoute… » restait)
      chatInput.placeholder = v.texte || 'Écris, ou touche le micro…'
      if (v.texte) say(v.texte, { ms: 6000, icon: ['warning', 'alerte'] })
      if (/micro/i.test(v.texte)) {
        wakeOn = false
        renderWake()
      }
      break
    case 'pause':
      renderWake(true)
      break
    case 'demande': // double toucher sur la bulle
      openChat({ listen: true })
      break
  }
}
if (Lien) {
  Lien.addListener('chat', onChat)
  Lien.addListener('voix', onVoice)
  Lien.addListener('copieRatee', () => say('Le PC ne répond pas : copie non envoyée.', { icon: ['warning', 'alerte'] }))
  Lien.voixEtat().then(r => {
    wakeOn = Boolean(r.veille)
    $('wake-row').hidden = !r.disponible
    renderWake()
  }).catch(() => {})
  // Un toucher relance l'écoute si elle s'était mise en pause (au plus une fois toutes les 5 s)
  let lastTouch = 0
  document.addEventListener('pointerdown', () => {
    if (Date.now() - lastTouch < 5000) return
    lastTouch = Date.now()
    Lien.voixActivite().catch(() => {})
  }, { passive: true })
}
$('wake-on').addEventListener('change', async e => {
  if (!Lien) return
  try {
    const r = await Lien.voixVeille({ actif: e.target.checked })
    wakeOn = Boolean(r.actif)
    if (e.target.checked && r.refuse) say('Sans le micro, je ne peux pas t’entendre. Tu peux l’autoriser dans les réglages d’Android.', { ms: 7000, icon: ['microphone-slash', 'alerte'] })
    else if (wakeOn) say('Dis « Hey Nuage » quand l’appli est ouverte : je t’écoute.', { ms: 5000, icon: ['ear', 'ciel'] })
  } catch {
    wakeOn = false
  }
  renderWake()
})
$('ask-open').addEventListener('click', () => openChat())
$('ask-mic').addEventListener('click', () => (Lien ? startListening() : openChat()))
$('chat-back').addEventListener('click', () => closeChat())
$('chat-mic').addEventListener('click', startListening)
$('chat-stop').addEventListener('click', () => chatCall('chatStop').catch(() => {}))
$('chat-session-btn').addEventListener('click', () => {
  const menu = $('session-menu')
  if (menu.hidden) renderSessionMenu()
  menu.hidden = !menu.hidden
})
chatInput.addEventListener('input', autosizeInput)
$('composer').addEventListener('submit', e => {
  e.preventDefault()
  sendToClaude(chatInput.value)
})
// Bouton « retour » d'Android : ferme le chat au lieu de quitter l'appli
window.addEventListener('popstate', () => closeChat(true))
if (globalThis.demo) {
  // Démonstration (auto-test) : une conversation par le PC
  globalThis.demoChat = {
    chatEtat: () => {
      chat = {
        streaming: false, pret: true, fournisseur: 'Claude Code (ton abonnement)',
        session: { titre: 'Nuage : voix et chat mobile', projet: 'nuage-bureau', copie: true },
        sessions: [{ id: 'a', titre: 'Nuage : voix et chat mobile', projet: 'nuage-bureau', statut: 'en-cours', at: Date.now() - 300_000 }, { id: 'b', titre: 'Site vitrine', projet: 'mon-site', statut: 'termine', at: Date.now() - 7_200_000 }],
        messages: [
          { role: 'user', texte: 'Où en est la version mobile ?', passe: true, de: 'pc' },
          { role: 'assistant', texte: 'Le chat et la voix sont branchés.\n⚙ Lit app.js\nIl reste à essayer sur ton téléphone.', passe: true },
          { role: 'user', texte: 'Quel temps fait-il demain à Lyon ?', voix: true, de: 'telephone' },
          { role: 'assistant', texte: 'Demain à Lyon : soleil le matin, quelques nuages l’après-midi, environ 29 degrés.' },
        ],
        permission: null,
      }
      renderChat()
    },
  }
  globalThis.demo.openChat = openChat
  globalThis.demo.onVoice = onVoice
  globalThis.demo.chatState = s => {
    chat = { ...chat, ...s }
    renderChat()
  }
}

// « Hors de portée » touché : on cherche le PC sur le Wi-Fi (son adresse a pu changer), sinon on explique
$('pc-chip').addEventListener('click', async () => {
  if (!Lien || !state.associe || state.connecte || searching) return
  searching = true
  life.action('spin')
  say('Je cherche ton PC sur le Wi-Fi…', { ms: 4000, icon: ['wifi-high', 'ciel'] })
  try {
    const r = await Lien.chercherPc()
    if (r.adresse) {
      react('celebrate', 2000)
      say('Je l’ai retrouvé : je me reconnecte.', { ms: 5000, icon: ['check', 'pelouse'] })
    } else {
      // Le PC habituel ne répond pas (autre PC, Nuage réinstallé, nouvelle clé) : on cherche Nuage sur ce
      // Wi-Fi pour s'y reconnecter avec un code, sans QR code
      searching = false
      if (confirm('Je ne trouve pas ton PC habituel. Chercher Nuage sur ce Wi-Fi et s’y reconnecter ?')) {
        if (await pairOverWifi()) return
      }
      react('sad', 2000)
      say('Pas de réponse du PC. Vérifie que Nuage est ouvert sur le PC et regarde son menu Téléphone, partie Connexion : il dit ce qui bloque (souvent le pare-feu de Windows).', { ms: 11_000, icon: ['wifi-slash', 'alerte'] })
    }
  } catch (error) {
    say(error.message, { icon: ['warning', 'alerte'] })
  } finally {
    searching = false
  }
})
// ---------- Association par le Wi-Fi, sans QR code (06/10/2026 : « connecter automatiquement le PC au
// téléphone dès qu'ils sont sur le même réseau ») ----------
// Le téléphone cherche Nuage sur le Wi-Fi, demande à se connecter ; le PC affiche « … veut se connecter » avec un
// code à 6 chiffres, le même qu'ici ; l'utilisateur accepte sur le PC, et c'est fait (voir LienProtocole.java).
function showPairCode(code, pcName) {
  $('pair-code-label').textContent = `accepte sur « ${pcName} » : même code des deux côtés`
  $('pair-digits').textContent = `${code.slice(0, 3)} ${code.slice(3)}`
  $('pair-code').hidden = false
}
const hidePairCode = () => {
  $('pair-code').hidden = true
}
// Réseaux de ce téléphone (v1.8), par leur nom seulement (09/10/2026 : « tout ce qui est adresse ne doit plus être
// visible, sur le mobile comme sur le PC »)
async function refreshNet() {
  if (!Lien?.reseaux) return
  try {
    localNets = (await Lien.reseaux()).reseaux || []
  } catch {
    localNets = []
  }
  $('net-line').textContent = localNets.length
    ? `ce téléphone : ${localNets.map(n => n.nom).join(' · ')}`
    : 'ce téléphone : aucun Wi-Fi connecté'
}
// Rapport d'une recherche qui n'a rien trouvé : ce qui a été essayé, et quoi faire (le QR code du PC en dernier recours)
function showSearchReport(report) {
  const nets = report?.reseaux || []
  $('pair-diag-list').replaceChildren(...nets.map(n => el('li', 'mono',
    `${n.nom} : ${n.erreur ? `erreur (${n.erreur})` : `${plural(n.envoyes, 'message')} envoyé${n.envoyes > 1 ? 's' : ''}, ${n.reponses ? plural(n.reponses, 'réponse') : 'aucune réponse'}`}`)))
  $('pair-diag-help').textContent = !nets.some(n => n.moi)
    ? 'Ce téléphone n’est connecté à aucun Wi-Fi. Connecte-le au même Wi-Fi que le PC, puis réessaie.'
    : 'Aucun PC n’a répondu. Vérifie que Nuage est ouvert sur le PC et qu’il est sur le même Wi-Fi que ce téléphone. Sinon, sur le PC : barre du haut → Téléphone → « Associer », puis ici « scanner le QR code ».'
  $('pair-diag').hidden = false
}
async function choosePc(pcs) {
  if (pcs.length === 1) return pcs[0]
  for (const pc of pcs) if (confirm(`Connecter ce téléphone à « ${pc.nom} » ?`)) return pc
  return null
}
// Demande envoyée à ce PC (trouvé par la recherche) : code des deux côtés, accord sur le PC
async function pairWith(pc) {
  const d = await Lien.demanderAssociation({ adresse: pc.adresse, port: pc.port || 47824 })
  showPairCode(d.code, d.pc || pc.nom)
  react('curious', 4000)
  say(`Sur le PC, clique « Accepter » : il affiche le code ${d.code.slice(0, 3)} ${d.code.slice(3)}, le même qu’ici.`, { ms: 30_000, icon: ['device-mobile', 'ciel'] })
  const r = await Lien.attendreAssociation({ demande: d.demande })
  hidePairCode()
  $('pair-diag').hidden = true
  react('celebrate', 2400)
  play('succes')
  say(`Connecté à ${r.pc?.nom || 'ton PC'} ! Dès que vous serez sur le même Wi-Fi, je me reconnecte tout seul.`, { ms: 7000, icon: ['check', 'pelouse'] })
  refreshState()
  return true
}
async function pairOverWifi({ auto = false } = {}) {
  if (!Lien || pairingNow) return false
  pairingNow = true
  try {
    if (!auto) {
      life.action('spin')
      say('Je cherche Nuage sur ton Wi-Fi…', { ms: 4000, icon: ['wifi-high', 'ciel'] })
    }
    $('find-pc').classList.add('busy')
    const report = await Lien.chercherPcsReseau()
    const pcs = report.pcs || []
    refreshNet()
    if (!pcs.length) {
      showSearchReport(report)
      if (!auto) {
        react('sad', 2000)
        say('Je ne trouve pas Nuage sur ce Wi-Fi. Regarde le rapport sous les boutons : il dit pourquoi.', { ms: 9000, icon: ['wifi-slash', 'alerte'] })
      }
      return false
    }
    $('pair-diag').hidden = true
    const pc = auto ? (confirm(`Nuage est ouvert sur « ${pcs[0].nom} », sur ce Wi-Fi. Connecter ce téléphone ?`) ? pcs[0] : null) : await choosePc(pcs)
    if (!pc) return false
    return await pairWith(pc)
  } catch (error) {
    hidePairCode()
    react('sad', 2000)
    say(`Connexion impossible : ${error.message}`, { ms: 8000, icon: ['warning', 'alerte'] })
    return false
  } finally {
    pairingNow = false
    $('find-pc').classList.remove('busy')
  }
}
$('find-pc').addEventListener('click', () => pairOverWifi())
// Pas encore associé : à l'ouverture de l'appli, Nuage cherche tout seul un PC sur le Wi-Fi et propose de s'y
// connecter (une fois par ouverture)
function autoPair() {
  if (!Lien || pairingNow || !stateLoaded) return
  // Associé, mais le PC refuse la clé (Nuage réinstallé sur le PC, autre PC) : se reconnecter avec un code
  if (state.associe && state.refuse && !refusedAsked) {
    refusedAsked = true
    setTimeout(() => {
      if (confirm('Ton PC ne reconnaît plus ce téléphone (Nuage a été réinstallé ou changé). Te reconnecter sur le Wi-Fi avec un code ?')) pairOverWifi()
    }, 600)
    return
  }
  if (autoPairTried || state.associe === undefined || state.associe) return
  autoPairTried = true
  setTimeout(() => pairOverWifi({ auto: true }), 1200)
}
$('scan').addEventListener('click', async () => {
  if (!Lien) return
  try {
    const r = await Lien.associer()
    react('celebrate', 2400)
    play('succes')
    say(`Associé à ${r.pc?.nom || 'ton PC'} ! Envoie-moi des fichiers, je les garde au chaud.`, { ms: 6000, icon: ['device-mobile', 'ciel'] })
    refreshState()
  } catch (error) {
    if (!/annul/i.test(error.message || '')) say(`Association impossible : ${error.message}`, { ms: 6000, icon: ['warning', 'alerte'] })
  }
})
$('send-files').addEventListener('click', async () => {
  try {
    await Lien?.envoyerFichiers()
  } catch (error) {
    if (!/annul/i.test(error.message || '')) say(error.message, { icon: ['warning', 'alerte'] })
  }
})
$('paste-pc').addEventListener('click', async () => {
  try {
    const r = await Lien?.collerSurPc()
    if (r) {
      react('happy', 1500)
      setMood('copie', 3000)
      say(`Envoyé au PC : Ctrl+V pour le coller (${plural(r.longueur, 'caractère')}).`, { icon: ['clipboard-text', 'ciel'] })
    }
  } catch (error) {
    say(error.message, { icon: ['warning', 'alerte'] })
  }
})
// Coucou : Nuage du PC salue à son tour (et on sait que le lien marche)
$('wave').addEventListener('click', async () => {
  life.action('hop')
  react('happy', 1600)
  play('pop')
  try {
    await Lien?.coucou()
    say('Coucou envoyé : regarde ton PC !', { ms: 3500, icon: ['hand-waving', 'rose'] })
  } catch (error) {
    react('sad', 1600)
    say(error.message, { ms: 5000, icon: ['warning', 'alerte'] })
  }
})
$('found').addEventListener('click', () => {
  Lien?.arreterSonnerie()
  state = { ...state, sonne: false }
  setRinging(false)
  react('celebrate', 2400)
  say('Retrouvé ! Je préviens le PC.', { ms: 3500, icon: ['check', 'pelouse'] })
})
$('add-tile').addEventListener('click', async () => {
  try {
    const r = await Lien?.ajouterTuile()
    if (r?.ajoutee) say('La tuile est dans le volet du haut : un toucher envoie ta copie au PC.', { ms: 5000, icon: ['lightning', 'soleil'] })
  } catch (error) {
    say(error.message, { ms: 7000, icon: ['lightning', 'soleil'] })
  }
})
// Bulle flottante : la première fois, Android ouvre ses réglages (« Afficher par-dessus d'autres applis »)
$('float-on').addEventListener('change', async e => {
  if (!Lien) return
  const r = await Lien.bulle({ active: e.target.checked })
  if (e.target.checked && !r.permission) {
    e.target.checked = false
    say('Active « Nuage de poche » dans la page qui s’ouvre, puis reviens ici.', { ms: 7000, icon: ['sparkle', 'rose'] })
  } else if (r.active) {
    life.action('hop')
    say('Ferme l’appli : je t’attends au bord de l’écran ! Appui long sur moi : ta copie part au PC.', { ms: 5500, icon: ['sparkle', 'rose'] })
  }
})
$('forget').addEventListener('click', async () => {
  if (!confirm('Oublier ce PC ? Il faudra rescanner son QR code.')) return
  await Lien?.oublier()
  refreshState()
})
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon))

say(pick(['Coucou ! Je suis Nuage, version poche.', 'Me voilà dans ta poche !', 'Bonjour !']), { ms: 3500, icon: ['hand-waving', 'rose'] })

// ---------- Agents de code et services du PC (Coucou sur iPhone, version Nuage de poche, 06/10/2026) ----------
// Onglet Agents : l'état en un coup d'œil (calme, au travail, en attente), les chiffres du jour, les demandes
// d'autorisation (Approuver derrière l'empreinte), les sessions ; un toucher sur une session : ce que Claude a fait,
// sa réponse, et un champ pour lui dire quoi faire ensuite (le message part dans cette session, par le PC).
// Onglet Services : GitHub, Stripe, Vercel, n8n… tels que le PC les voit. Le même résumé nourrit le widget et la
// notification « en direct » (LienService.java).
function showView(name) {
  view = ['agents', 'services'].includes(name) && state.associe ? name : 'nuage'
  document.body.dataset.view = view
  $('top-title').textContent = { nuage: 'Nuage', agents: 'Agents', services: 'Services' }[view]
  for (const b of document.querySelectorAll('#tabbar button')) b.classList.toggle('on', b.dataset.view === view)
  $('view-agents').hidden = view !== 'agents'
  $('view-services').hidden = view !== 'services'
  if (view !== 'nuage') {
    renderAgents()
    refreshAgents()
  }
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
}
async function refreshAgents() {
  if (!Lien?.agentsEtat || !state.associe) return
  try {
    onAgents(await Lien.agentsEtat())
  } catch {
    renderAgents() // PC hors de portée : le dernier résumé reste affiché
  }
}
function onAgents(next) {
  if (!next?.resume) return
  const before = agentsState
  agentsState = next
  // L'IA du chat du PC (09/10/2026 : « Demande à Claude » pendant une discussion avec Gemini)
  document.querySelector('#ask-open .ask-text').textContent = `Demande à ${next.ia || 'Claude'}…`
  renderAgents()
  if (sessionOpen && next.sessions.some(s => s.id === sessionOpen)) refreshSession()
  // Nuage réagit : une nouvelle demande, une session qui finit
  const newAsk = next.demandes.find(d => !before?.demandes.some(x => x.id === d.id))
  if (before && newAsk) {
    react('curious', 2500)
    play('ding')
    say(`${newAsk.titre} attend ton accord : ${shorten(newAsk.label, 60)}`, { ms: 6000, icon: ['lock-key', 'soleil'] })
  } else if (before && next.sessions.some(s => s.statut === 'termine' && before.sessions.find(b => b.id === s.id)?.statut === 'en-cours')) {
    react('celebrate', 2400)
    play('succes')
  }
}
function ago(ms) {
  if (!ms) return ''
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 50) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`
  return 'hier ou avant'
}
function statCell(n, label, parts = null) {
  const c = el('div', 'ag-stat')
  const b = el('b')
  if (parts) b.append(...parts)
  else b.textContent = String(n)
  c.append(b, el('small', '', label))
  return c
}
// Vignette colorée avec un mini-Nuage (comme les tuiles de Coucou), une couleur fixe par projet (la même que sur le PC)
const PALETTE = ['#ff6b5b', '#2dd4a7', '#f7b32b', '#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#e879f9']
const SVC_COLOR = { github: '#f4505e', vercel: '#8b7cff', stripe: '#3b82f6', n8n: '#fb923c', resend: '#2dd4a7', notion: '#8e8e93', calcom: '#c9956a' }
function colorFor(key) {
  let h = 0
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function tileMini(color) {
  const tile = el('span', 'tile-mini')
  tile.style.setProperty('--t', color)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 32 22')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', '#mini')
  svg.append(use)
  tile.append(svg)
  return tile
}
// Comment se lit une session (Coucou : « working · 3/4 », « waiting for your OK », « ✓ done », « idle »)
function sessionWords(s) {
  if (s.statut === 'en-cours') return { text: `au travail${s.total ? ` · ${Math.min(s.faites + 1, s.total)}/${s.total}` : ''}`, ico: 'circle-notch', tone: 'bleu' }
  if (s.statut === 'permission') return { text: 'attend ton accord', ico: 'lock-key', tone: 'ambre' }
  if (s.statut === 'attente') return { text: 'attend ta réponse', ico: 'hourglass-medium', tone: 'ambre' }
  if (s.statut === 'termine') return { text: '✓ terminé', ico: '', tone: 'vert' }
  return { text: 'au repos', ico: 'moon', tone: 'gris' }
}
function renderAgents() {
  const a = agentsState
  const waiting = a ? a.demandes.length : 0
  $('ag-badge').hidden = !waiting
  $('ag-badge').textContent = waiting ? String(waiting) : ''
  if (view === 'services') return renderServices()
  if (view !== 'agents') return
  $('ag-card').dataset.etat = a?.resume.etat || 'calme'
  $('ag-titre').textContent = a ? a.resume.titre : 'En attente du PC'
  $('ag-texte').textContent = a ? a.resume.texte : 'Ouvre Nuage sur le PC, sur le même Wi-Fi que ce téléphone.'
  const j = a?.aujourdhui || { tours: 0, fichiers: 0, plus: 0, moins: 0, accords: 0 }
  $('ag-stats').replaceChildren(
    statCell(j.tours, 'tours'),
    statCell(j.fichiers, 'fichiers'),
    statCell(0, 'lignes', [el('span', 'plus', `+${j.plus}`), ' ', el('span', 'moins', `−${j.moins}`)]),
    statCell(j.accords, 'accords'),
  )
  // Reconstruite seulement si les demandes changent (sinon la carte rejouerait son entrée à chaque résumé)
  const asks = $('ag-demandes')
  const askKey = (a?.demandes || []).map(d => d.id).join(',')
  if (asks.dataset.key !== askKey) {
    asks.dataset.key = askKey
    asks.replaceChildren(...(a?.demandes || []).map(demandeCard))
  }
  for (const node of asks.querySelectorAll('.ag-exp[data-expire]')) node.textContent = expiryText(Number(node.dataset.expire))
  const list = a?.sessions || []
  $('ag-sessions').replaceChildren(...(list.length ? list.map(sessionRow) : [el('li', 'ag-empty', 'Aucune session ni discussion récente sur le PC.')]))
  $('ag-note').textContent = !Lien ? '' : !state.connecte ? `PC hors de portée : nouvelles de ${a ? when(a.maj) : '—'}.` : a ? `Mis à jour à ${when(a.maj)}.` : ''
}
// La demande sort de l'îlot (Coucou : ApprovalPanel) : qui demande, la commande exacte, Refuser / Approuver
function demandeCard(d) {
  const card = el('div', `ag-req${d.question ? ' question' : ''}`)
  const head = el('div', 'ag-req-head')
  head.append(el('i'), el('b', '', d.question ? `${d.titre} te pose une question` : `${d.titre} demande`), el('span', '', d.outil || ''))
  card.append(head)
  card.append(el('code', '', d.commande && d.commande !== d.label ? d.commande : d.label))
  if (d.question) {
    card.append(el('p', '', 'Réponds dans l’encoche du PC.'))
    return card
  }
  const row = el('div', 'ag-req-row')
  const no = el('button', 'ghost-btn no', 'Refuser')
  no.type = 'button'
  no.addEventListener('click', () => answerRequest(d, 'deny'))
  const ok = el('button', 'white-btn')
  ok.type = 'button'
  ok.append(icon('fingerprint'), el('span', '', 'Approuver'))
  ok.addEventListener('click', () => answerRequest(d, 'allow'))
  row.append(no, ok)
  card.append(row)
  if (d.toujours) {
    const always = el('button', 'always-link', 'Toujours autoriser pour cette session')
    always.type = 'button'
    always.addEventListener('click', () => answerRequest(d, 'always'))
    card.append(always)
  }
  const exp = el('small', 'ag-exp', expiryText(d.expire))
  exp.dataset.expire = String(d.expire || 0)
  card.append(exp)
  return card
}
function expiryText(expire) {
  const left = Math.round((expire - Date.now()) / 1000)
  return `Approuver demande ton empreinte.${left > 0 ? ` Sans réponse, Claude demandera sur le PC dans ${left >= 60 ? `${Math.round(left / 60)} min` : `${left} s`}.` : ''}`
}
async function answerRequest(d, choix) {
  if (!Lien?.agentsRepondre) return
  try {
    await Lien.agentsRepondre({ id: d.id, choix, label: d.label })
    if (choix === 'deny') say('Refusé : Claude ne le fera pas.', { ms: 3500, icon: ['x-circle', 'alerte'] })
  } catch (error) {
    say(error.message, { icon: ['warning', 'alerte'] })
  }
}
function sessionRow(s) {
  const w = sessionWords(s)
  const li = el('li', `ag-row t-${w.tone}${s.statut === 'en-cours' ? ' working' : ''}`)
  const words = el('div', 'ag-words')
  words.append(el('b', '', s.titre), el('small', '', s.statut === 'en-cours' && s.actuel ? s.actuel : s.agent || 'Claude Code'))
  const right = el('div', 'ag-right')
  const mot = el('span', 'ag-mot')
  if (w.ico) mot.append(icon(w.ico))
  mot.append(w.text)
  right.append(mot, el('small', '', ago(s.depuis)))
  li.append(tileMini(colorFor(s.projet || s.titre)), words, right)
  // La discussion du chat du PC (Gemini, ChatGPT…) s'ouvre dans le chat du téléphone : c'est la même conversation
  li.addEventListener('click', () => (s.chat ? openChat() : openSession(s.id)))
  return li
}
function renderServices() {
  const a = agentsState
  const list = a?.services || []
  $('svc-list').replaceChildren(...(list.length ? list.map(serviceCard) : [el('li', 'svc ag-empty', a ? 'Aucun service branché sur le PC.' : 'En attente du PC.')]))
  $('svc-note').textContent = a?.servicesHors?.length ? `À brancher sur le PC (réglages de l’encoche) : ${a.servicesHors.join(', ')}.` : ''
}
function serviceCard(s) {
  const tone = s.etat === 'ok' ? 'vert' : s.etat === 'a-voir' ? 'ambre' : 'rouge'
  const li = el('li', `svc t-${tone}`)
  const head = el('div', 'svc-head')
  const words = el('div', 'ag-words')
  const name = el('b', '', s.nom)
  if (s.badge) name.append(el('span', 'svc-badge', s.badge))
  words.append(name, el('small', '', s.texte || ''))
  head.append(tileMini(SVC_COLOR[s.id] || colorFor(s.nom)), words, el('span', 'svc-state', s.etat === 'ok' ? 'tout va bien' : s.etat === 'a-voir' ? 'à regarder' : 'erreur'))
  li.append(head)
  const lines = s.lignes?.length ? s.lignes : [{ texte: s.texte, ton: s.etat === 'erreur' ? 'mauvais' : '' }]
  const ul = el('ul', 'svc-lines')
  for (const l of lines.filter(x => x.texte)) ul.append(el('li', l.ton === 'mauvais' ? 'bad' : '', l.texte))
  li.append(ul)
  return li
}

// Une session en détail
async function openSession(id) {
  sessionOpen = id
  $('session').hidden = false
  history.pushState({ session: true }, '')
  const s = agentsState?.sessions.find(x => x.id === id)
  $('sess-title').textContent = s?.titre || 'Session'
  $('session').style.setProperty('--agent', colorFor(s?.projet || s?.titre || ''))
  $('sess-body').replaceChildren(el('p', 'chat-empty', 'Je demande au PC…'))
  await refreshSession()
}
async function refreshSession() {
  const id = sessionOpen
  if (!id || !Lien?.agentsSession) return
  try {
    const d = await Lien.agentsSession({ id })
    if (sessionOpen === id) renderSession(d)
  } catch (error) {
    if (sessionOpen === id) $('sess-body').replaceChildren(el('p', 'chat-empty', error.message))
  }
}
function sessCard(title, cls = '') {
  const box = el('div', `sess-card ${cls}`)
  box.append(el('b', 'sess-h', title))
  return box
}
// Coucou : SessionDetailView — la vignette, le nom, l'état ; ta demande ; « Ce qu'il a fait · N » ; la réponse
function renderSession(d) {
  $('sess-title').textContent = d.titre
  const color = colorFor(d.projet || d.titre)
  $('session').style.setProperty('--agent', color)
  const w = sessionWords({ statut: d.statut, faites: d.etapes.filter(e => e.fait).length, total: d.etapes.length })
  const top = el('div', 'sess-top')
  const words = el('div')
  words.append(el('b', '', d.titre), el('span', `st t-${w.tone}`, w.text), el('small', '', `${d.agent}${d.projet ? ` · ${d.projet}` : ''} · ${ago(d.depuis)}`))
  top.append(tileMini(color), words)
  const nodes = [top]
  if (d.demande) nodes.push(el('div', 'sess-ask', d.demande), el('span', 'sess-ask-meta', 'Toi'))
  if (d.attente) nodes.push(el('p', 'sess-wait', d.attente))
  if (d.etapes.length) {
    const box = sessCard(`Ce qu’il a fait · ${d.etapes.length}`)
    const ul = el('ul', 'sess-steps')
    for (const e of d.etapes) {
      const li = el('li', e.erreur ? 'err' : e.fait ? 'ok' : 'now')
      li.append(icon(e.erreur ? 'x-circle' : e.fait ? 'check-circle' : 'circle-notch'), el('span', '', e.label))
      ul.append(li)
    }
    box.append(ul)
    nodes.push(box)
  }
  if (d.reponse) {
    const box = sessCard('Réponse de Claude', 'answer')
    const text = el('div', 'sess-text')
    richText(text, d.reponse)
    box.append(text)
    nodes.push(box)
  }
  if (d.fichiers.length) {
    const box = sessCard(`Fichiers modifiés · ${d.fichiers.length}`)
    const ul = el('ul', 'sess-files')
    for (const f of d.fichiers) {
      const li = el('li')
      li.append(el('span', 'mono', f.nom), el('span', 'plus mono', `+${f.plus}`), el('span', 'moins mono', `−${f.moins}`))
      ul.append(li)
    }
    box.append(ul)
    nodes.push(box)
  }
  if (nodes.length === 1) nodes.push(el('p', 'chat-empty', 'Rien à montrer pour l’instant.'))
  $('sess-body').replaceChildren(...nodes)
}
// L'écran de la session laisse sa place au chat (sans revenir en arrière dans l'historique : voir openChat)
function leaveSessionForChat() {
  sessionOpen = null
  $('session').hidden = true
}
function closeSession(fromBack = false) {
  if (!sessionOpen) return
  sessionOpen = null
  $('session').hidden = true
  if (!fromBack && history.state?.session) history.back()
}
// Le message part dans cette session (par le PC : la même conversation que la barre du haut), le chat s'ouvre
async function sendToSession(text) {
  const id = sessionOpen
  const words = String(text || '').trim()
  if (!id || !words) return
  try {
    await chatCall('chatSession', { action: 'continuer', id })
    leaveSessionForChat()
    await openChat({ fromSession: true })
    await sendToClaude(words)
    $('sess-input').value = ''
  } catch (error) {
    say(error.message, { icon: ['warning', 'alerte'] })
  }
}
for (const b of document.querySelectorAll('#tabbar button')) b.addEventListener('click', () => showView(b.dataset.view))
$('sess-back').addEventListener('click', () => closeSession())
$('sess-refresh').addEventListener('click', refreshSession)
for (const chip of document.querySelectorAll('#sess-chips .qchip')) chip.addEventListener('click', () => sendToSession(chip.textContent))
$('sess-composer').addEventListener('submit', e => {
  e.preventDefault()
  sendToSession($('sess-input').value)
})
$('sess-mic').addEventListener('click', () => {
  const id = sessionOpen
  if (!id) return
  chatCall('chatSession', { action: 'continuer', id }).then(() => {
    leaveSessionForChat()
    openChat({ listen: true, fromSession: true })
  }).catch(error => say(error.message, { icon: ['warning', 'alerte'] }))
})
window.addEventListener('popstate', () => closeSession(true))
$('add-widget').addEventListener('click', async () => {
  try {
    await Lien?.ajouterWidget()
  } catch (error) {
    say(error.message, { ms: 7000, icon: ['squares-four', 'ciel'] })
  }
})
if (Lien) {
  Lien.addListener('agents', onAgents)
  Lien.addListener('onglet', o => showView(o.onglet))
  Lien.addListener('autorisation', r => {
    if (!r.ok) return say(r.message || 'Le PC ne répond pas.', { ms: 6000, icon: ['warning', 'alerte'] })
    if (r.choix !== 'deny') {
      react('celebrate', 2200)
      play('succes')
      say('Autorisé ✓ Claude continue sur le PC.', { ms: 4000, icon: ['check-circle', 'pelouse'] })
    }
  })
  Lien.agentsMemo?.().then(r => r?.etat && onAgents(r.etat)).catch(() => {})
  // Les demandes affichent le temps restant : on le recompte, et le résumé se relit tant que l'onglet est ouvert
  setInterval(() => {
    if (view === 'agents' && agentsState?.demandes.length) renderAgents()
  }, 10_000)
}
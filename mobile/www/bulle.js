// Bulle flottante : Nuage par-dessus les autres applis (fenêtre Android de Bulle.java). Le glisser est géré
// en Java (la fenêtre suit le doigt) ; ici, il penche selon la vitesse, se pose en rebondissant, et réagit
// à ce qui arrive du PC (fichier, copier-coller, nouvelle). Mêmes modules que sur le PC (partage/).
import { createAvatar } from './partage/vendor/avatar-web.js'
import { createSkin } from './partage/peau.js'
import { createLife } from './partage/vie.js'

const $ = id => document.getElementById(id)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const avatar = createAvatar($('avatar'), { definition: window.NUAGE_AVATAR, defaultAnimation: 'idle', size: '100%', ariaLabel: 'Nuage' })
const skin = createSkin({ defs: $('skin-defs'), reduceMotion })
skin.attach($('avatar').querySelector('svg'))
const life = createLife({ bodyEl: $('body'), lifeEl: $('life'), emotesEl: $('emotes'), trailEl: $('trail'), reduceMotion })
const arrow = $('dl-arrow')
let timer = null
function react(key, ms = 2000) {
  if (key.startsWith('expr:')) avatar.setExpression(key.slice(5))
  else avatar.play(key)
  clearTimeout(timer)
  timer = setTimeout(() => avatar.play('idle'), ms)
}
let dragging = false
function frame(now) {
  life.frame(now, { dragging })
  requestAnimationFrame(frame)
}
if (!reduceMotion) requestAnimationFrame(frame)

// Appelé par Bulle.java (evaluateJavascript)
globalThis.bulle = {
  prise() {
    dragging = true
    react('scared', 60_000)
  },
  vitesse(vx, vy) {
    life.simulate({ vx, vy })
  },
  lache() {
    dragging = false
    life.simulate(null)
    life.action('land')
    react('happy', 1400)
  },
  meteo(w) {
    skin.setWeather(w)
  },
  // Appui long : ce qui vient d'être copié part vers le PC (CopieActivity)
  copie() {
    life.action('jelly')
    life.emote('etoiles')
    react('excited', 1400)
  },
  evenement(nom, d) {
    if (nom === 'transfert') {
      if (d.annule || d.fini) {
        arrow.setAttribute('hidden', '')
        document.body.classList.remove('downloading', 'dl-up')
        skin.setDownload(d.fini ? { on: false, done: true } : { on: false })
        if (d.fini) {
          life.action('cheer', 1700)
          react('celebrate', 2400)
          setTimeout(() => skin.setDownload({ on: false }), 2600)
        } else react('sad', 1600)
        return
      }
      arrow.removeAttribute('hidden')
      document.body.classList.add('downloading')
      document.body.classList.toggle('dl-up', d.sens === 'envoi')
      const level = d.taille ? d.fait / d.taille : 1
      skin.setDownload({ on: true, level, text: `${Math.floor(level * 100)} %` })
    } else if (nom === 'meteo') {
      skin.setWeather(d) // la météo du PC (sa ville)
    } else if (nom === 'pressePapiers' || nom === 'copie') {
      life.emote('etoiles')
      react('happy', 1500)
    } else if (nom === 'sonnerie') {
      if (d.active) {
        life.action('shake')
        react('surprised', 3000)
      }
    } else if (nom === 'nouvelle') {
      life.emote('surprise')
      life.action('hop')
      react('excited', 1800)
    } else if (nom === 'batterie') {
      // Branché : des éclairs jaillissent et il se remplit d'énergie un instant (05/10/2026)
      if (d.charge && !charging) {
        life.emote('eclair')
        life.action('hop')
        react('excited', 2500)
        skin.setDownload({ on: true, level: Math.max(0.08, d.niveau / 100), text: `${d.niveau} %` })
        setTimeout(() => skin.setDownload({ on: false }), 3200)
      }
      charging = Boolean(d.charge)
    }
  },
}
let charging = false
// Petites actions de temps en temps, comme sur le PC (sans jamais gêner)
setInterval(() => {
  const name = life.pickIdle({ eligible: !dragging })
  if (name === 'saut') life.action('hop')
  else if (name === 'pirouette') life.action('spin')
  else if (name === 'etirement') life.action('stretch')
  else if (name === 'souffle') life.blow()
  else if (name === 'clin') react('winking', 1400)
  else if (name) react('expr:far-right-glance', 1000)
}, 1000)

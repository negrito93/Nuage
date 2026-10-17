// Écran de veille Nuage : Nuage dort en plein écran aux couleurs du thème Windows.
// Au moindre mouvement ou appui, on quitte : Windows verrouille alors la session.
import { createAvatar } from './vendor/avatar-web.js'
import { applyScreenTheme, sleepyDefinition, sprinkleStars } from './theme-ecran.js'

const api = window.veille
const { dark, params } = applyScreenTheme()
sprinkleStars(document.getElementById('stars'), { count: dark ? 90 : 0, maxTop: 70, twinkle: true })

if (params.get('principal') === '0') {
  // Écrans secondaires : seulement le fond
  document.body.classList.add('secondaire')
} else {
  createAvatar('#avatar', { definition: sleepyDefinition(dark), defaultAnimation: 'sleeping', size: '100%', ariaLabel: 'Nuage endormi' })
}

// Horloge
const timeEl = document.getElementById('time')
const dateEl = document.getElementById('date')
function tickClock() {
  const now = new Date()
  timeEl.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  dateEl.textContent = date.charAt(0).toUpperCase() + date.slice(1) // « Samedi 3 octobre »
}
tickClock()
setInterval(tickClock, 1000)

// Sortie au moindre signe de vie (les entrées de la première seconde sont ignorées :
// Windows peut en envoyer au démarrage de l'écran de veille)
const startedAt = performance.now()
let origin = null
const wake = () => {
  if (performance.now() - startedAt > 1000) api.quit()
}
addEventListener('mousemove', e => {
  if (!origin) {
    origin = { x: e.screenX, y: e.screenY }
    return
  }
  if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 10) wake()
})
for (const type of ['mousedown', 'keydown', 'wheel', 'touchstart', 'contextmenu']) addEventListener(type, wake)
addEventListener('blur', wake)

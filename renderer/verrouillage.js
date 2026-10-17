// Dessine Nuage endormi aux couleurs du thème Windows (couleur d'accent, clair ou sombre),
// pour l'image de l'écran de verrouillage. Paramètres : ?accent=RRGGBB&theme=dark|light
import { createAvatar } from './vendor/avatar-web.js'
import { applyScreenTheme, sleepyDefinition, sprinkleStars } from './theme-ecran.js'

const { dark } = applyScreenTheme()
if (dark) sprinkleStars(document.getElementById('stars'))
createAvatar('#avatar', { definition: sleepyDefinition(dark), defaultExpression: 'eyes-closed', size: '100%', ariaLabel: 'Nuage endormi' })

// Le processus principal attend cette promesse avant de photographier la page
window.nuagePret = new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), 300)))
})

// Tableau de bord : météo de la ville (et choix de la ville).
import { icon } from './icones.js'

const api = window.panneau
const $ = id => document.getElementById(id)
const time = iso => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Icônes Phosphor (icones.js) selon le ciel
const SKY_ICON = { soleil: 'sun', eclaircies: 'cloud-sun', couvert: 'cloud', brouillard: 'cloud-fog', bruine: 'cloud-rain', pluie: 'cloud-rain', neige: 'snowflake', orage: 'cloud-lightning' }

function render(state) {
  if (!state) return
  const box = $('weather')
  box.replaceChildren()
  if (!state.weatherOn) {
    box.textContent = 'Couleur selon la météo désactivée (barre : Réglages → Nuage).'
    return
  }
  const { place, current, error } = state.weather
  if (current) {
    const sky = el('span', `sky ${current.key || ''}${current.night ? ' night' : ''}`)
    sky.append(icon(current.night && ['soleil', 'eclaircies'].includes(current.key) ? 'moon-stars' : SKY_ICON[current.key] || 'cloud'))
    box.append(sky, el('span', 'temp', `${current.temp} °C`), el('span', 'label', `${current.label}${current.night ? ', nuit' : ''}`))
  }
  if (place) {
    const where = [place.name, place.admin, place.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ')
    box.append(el('small', 'where', `${where} (${place.source === 'manuel' ? 'ville choisie' : 'détectée automatiquement'})`))
  }
  // D'où vient la météo : relevé réel d'une station, ou estimation du modèle
  if (current?.source === 'releve') {
    box.append(el('small', 'where', `Relevé réel : station ${current.station} (${current.km} km), à ${time(current.time)}.`))
  } else if (current?.source === 'modele') {
    box.append(el('small', 'where', 'Estimation Open-Meteo (pas de station météo proche).'))
  }
  if (error) box.append(el('div', 'alert', error))
  if (!place && !error) box.textContent = 'Recherche de votre position…'
}

// ---------- Actions ----------
$('close').replaceChildren(icon('x'))
$('close').addEventListener('click', () => api.close())
addEventListener('keydown', e => {
  if (e.key === 'Escape') api.close()
})
$('place-form').addEventListener('submit', async e => {
  e.preventDefault()
  const input = $('place')
  if (!input.value.trim()) return
  $('place-msg').textContent = 'Recherche…'
  const result = await api.setPlace(input.value)
  $('place-msg').textContent = result?.ok ? 'Ville enregistrée.' : result?.message || 'Erreur.'
  if (result?.ok) input.value = ''
})
$('auto').addEventListener('click', async () => {
  $('place-msg').textContent = 'Détection…'
  render(await api.autoPlace())
  $('place-msg').textContent = ''
})

api.onUpdate(render)
render(await api.getState())

// Génère renderer/icones.js à partir de Phosphor Icons (https://phosphoricons.com, licence MIT),
// paquet npm @phosphor-icons/core servi par unpkg. Usage : node outils/icones.mjs
// Style « duotone » (couche pleine à 20 % + trait arrondi) pour tout, « fill » pour les commandes de lecture.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '2.1.1'
const ROOT = `https://unpkg.com/@phosphor-icons/core@${VERSION}`
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'renderer', 'icones.js')

const DUOTONE = [
  // Sport, musique, vidéos
  'soccer-ball', 'check-circle', 'trophy', 'flag-checkered', 'timer', 'x-circle', 'prohibit', 'arrows-clockwise',
  'music-notes', 'film-slate', 'popcorn', 'eye',
  // Météo
  'sun', 'cloud-sun', 'cloud', 'cloud-fog', 'cloud-rain', 'cloud-lightning', 'snowflake', 'moon-stars', 'moon',
  // Téléchargements, rappels, présence
  'download-simple', 'plug', 'coffee', 'drop', 'battery-warning', 'bell-ringing', 'hand-waving', 'sparkle', 'confetti', 'heart',
  // Agents de code et demandes
  'lock-key', 'question', 'hourglass-medium', 'chat-circle-dots', 'chat-circle-text', 'user-circle', 'book-open-text',
  'pencil-simple', 'file-plus', 'terminal-window', 'magnifying-glass', 'globe-simple', 'robot', 'list-checks',
  'puzzle-piece', 'wrench', 'key', 'warning', 'paperclip', 'envelope-simple', 'clock', 'x',
  // Lien avec le téléphone
  'device-mobile', 'clipboard-text', 'upload-simple', 'qr-code', 'wifi-high', 'share-network', 'copy', 'link',
  // Menu Téléphone et Nuage de poche
  'speaker-high', 'folder-open', 'lightning', 'arrow-down-left', 'arrow-up-right', 'cursor-text', 'hand-tap', 'wifi-slash',
  'gear-six', 'check', 'arrows-left-right',
  // Voix (« Hey Nuage ») et chat du téléphone
  'microphone', 'microphone-slash', 'paper-plane-tilt', 'caret-left', 'caret-down', 'stop', 'plus', 'waveform', 'ear',
  // Fichiers avalés
  'trash', 'arrow-u-up-left', 'file', 'folder', 'image', 'file-pdf', 'file-zip', 'file-audio', 'file-video',
  // Agents et services sur le téléphone (Coucou sur iPhone, version Nuage de poche, 06/10/2026)
  'squares-four', 'fingerprint', 'circle-notch', 'caret-right', 'arrow-clockwise',
]
const FILL = ['play', 'pause', 'skip-back', 'skip-forward', 'music-note', 'music-notes-simple']

async function get(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`)
  return response.text()
}
function parse(name, svg) {
  const shapes = []
  for (const m of svg.matchAll(/<(\w+)\s([^>]*?)\/?>/g)) {
    const [, tag, attrs] = m
    if (tag === 'svg') continue
    if (tag !== 'path') throw new Error(`${name} : élément <${tag}> non prévu`)
    const d = /\sd="([^"]+)"/.exec(` ${attrs}`)?.[1]
    const opacity = /opacity="([^"]+)"/.exec(attrs)?.[1]
    if (d) shapes.push(opacity ? [d, Number(opacity)] : [d])
  }
  if (!shapes.length) throw new Error(`${name} : aucun tracé`)
  return shapes
}

const icons = {}
for (const name of DUOTONE) icons[name] = parse(name, await get(`${ROOT}/assets/duotone/${name}-duotone.svg`))
for (const name of FILL) icons[`${name}-fill`] = parse(name, await get(`${ROOT}/assets/fill/${name}-fill.svg`))
const licence = await get(`${ROOT}/LICENSE`)
fs.writeFileSync(path.join(here, '..', 'renderer', 'icones-LICENCE.txt'), `Icônes : Phosphor Icons ${VERSION} (https://phosphoricons.com)\n\n${licence}`, 'utf8')

const body = Object.entries(icons).map(([name, shapes]) => `  ${JSON.stringify(name)}: ${JSON.stringify(shapes)},`).join('\n')
fs.writeFileSync(out, `// Icônes de Nuage : Phosphor Icons ${VERSION} (https://phosphoricons.com), licence MIT (icones-LICENCE.txt).
// Style « duotone » (couche pleine à 20 % + trait), « -fill » pour les commandes de lecture.
// Généré par outils/icones.mjs : ne pas modifier à la main.
export const ICONS = {
${body}
}

const NS = 'http://www.w3.org/2000/svg'
// Une icône SVG (couleur : currentColor), prête à insérer
export function icon(name, className = 'ico') {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 256 256')
  svg.setAttribute('class', className)
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const [d, opacity] of ICONS[name] || ICONS.sparkle) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    if (opacity !== undefined) p.setAttribute('opacity', String(opacity))
    svg.append(p)
  }
  return svg
}
`, 'utf8')
console.log(`renderer/icones.js : ${Object.keys(icons).length} icônes (${Math.round(fs.statSync(out).size / 1024)} Ko)`)

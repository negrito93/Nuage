// Chiffres en points lumineux (grille 5 × 7, comme un petit panneau LED), pour la batterie du téléphone
// dans la barre du haut et les grands nombres de Nuage de poche (température, progression d'un transfert).
// Idée reprise des visuels « 01, 02… » en points du post Instagram de Coucou (04/10/2026), dessin maison.
// Couleurs : --m1 (haut) et --m2 (bas) sur l'élément ou un parent ; points éteints très discrets.
const NS = 'http://www.w3.org/2000/svg'
const GLYPHS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
  '°': ['0110', '1001', '1001', '0110', '0000', '0000', '0000'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
}
let uid = 0

// text : « 82% », « 24° »… ; dot : diamètre d'un point ; gap : espace entre deux points (unités du dessin)
export function dotMatrix(text, { dot = 4, gap = 1.8, className = 'matrix', label = text } = {}) {
  const glyphs = [...String(text)].map(c => GLYPHS[c] || GLYPHS[' '])
  const pitch = dot + gap
  const cells = []
  let col = 0
  glyphs.forEach((g, i) => {
    const w = g[0].length
    for (let y = 0; y < 7; y++) for (let x = 0; x < w; x++) cells.push({ x: col + x, y, on: g[y][x] === '1' })
    col += w
    if (i < glyphs.length - 1) {
      for (let y = 0; y < 7; y++) cells.push({ x: col, y, on: false }) // colonne d'espace, éteinte
      col += 1
    }
  })
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${col * pitch - gap} ${7 * pitch - gap}`)
  svg.setAttribute('class', className)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', String(label))
  const id = `m${++uid}`
  const defs = document.createElementNS(NS, 'defs')
  const grad = document.createElementNS(NS, 'linearGradient')
  grad.setAttribute('id', id)
  grad.setAttribute('gradientUnits', 'userSpaceOnUse') // un seul dégradé sur toute la hauteur, pas un par point
  grad.setAttribute('x1', '0')
  grad.setAttribute('y1', '0')
  grad.setAttribute('x2', '0')
  grad.setAttribute('y2', String(7 * pitch - gap))
  for (const [offset, color] of [['0', 'var(--m1, #fff)'], ['1', 'var(--m2, var(--m1, #fff))']]) {
    const stop = document.createElementNS(NS, 'stop')
    stop.setAttribute('offset', offset)
    stop.style.setProperty('stop-color', color) // par le CSSOM : un attribut style serait bloqué par la CSP des pages
    grad.append(stop)
  }
  defs.append(grad)
  svg.append(defs)
  for (const c of cells) {
    const circle = document.createElementNS(NS, 'circle')
    circle.setAttribute('cx', String(c.x * pitch + dot / 2))
    circle.setAttribute('cy', String(c.y * pitch + dot / 2))
    circle.setAttribute('r', String(dot / 2))
    if (c.on) {
      circle.setAttribute('class', 'on')
      circle.setAttribute('fill', `url(#${id})`)
      circle.style.setProperty('--i', String(c.x + c.y * 0.5)) // les points s'allument de gauche à droite
    } else {
      circle.setAttribute('class', 'off')
    }
    svg.append(circle)
  }
  return svg
}

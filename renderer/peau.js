// Peau de Nuage (04/10/2026) : un motif SVG posé sur toutes les formes de son corps, jamais sur ses
// yeux (règle CSS « #avatar svg > path { fill: url(#nuage-skin) } » : les yeux sont dans un groupe).
// Le motif reprend le repère de l'avatar (viewBox -150 -150 300 300), si bien que toutes les bouffées
// partagent la même peau : la météo se passe dans le nuage (soleil qui le chauffe, gouttes qui glissent,
// éclairs qui l'illuminent de l'intérieur, brume, givre, étoiles la nuit), la température s'écrit sur
// son ventre, et un téléchargement le remplit d'eau verte avec des vagues et des bulles.
const NS = 'http://www.w3.org/2000/svg'
function node(name, attrs = {}, parent = null) {
  const el = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  parent?.append(el)
  return el
}
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const rand = (a, b) => a + Math.random() * (b - a)
const rgb = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))
export function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const isLight = hex => {
  const [r, g, b] = rgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.58
}

const BASE = '#f5f8fd'
const WEATHER_BODY = {
  soleil: '#fffdf4', eclaircies: '#f5f8fd', couvert: '#d6dce5', brouillard: '#e3e6ea',
  bruine: '#c8d5e3', pluie: '#aab9ca', neige: '#ffffff', orage: '#7c8595',
}
const NIGHT_TINT = '#8e9bc6'
const GREEN = { deep: '#1d9558', main: '#36c47c', foam: '#d4f9e4', ink: '#0e6a3c', tint: '#dcf5e6' }
const FONT = 'Nunito, "Segoe UI", sans-serif'

// Petites icônes de la météo, dessinées autour de (0, 0), environ 18 unités de large
const ICONS = {
  soleil(g) {
    node('circle', { r: 4.4, fill: '#f4a31c' }, g)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      node('line', {
        x1: (Math.cos(a) * 6.8).toFixed(2), y1: (Math.sin(a) * 6.8).toFixed(2),
        x2: (Math.cos(a) * 9.2).toFixed(2), y2: (Math.sin(a) * 9.2).toFixed(2),
        stroke: '#f4a31c', 'stroke-width': 1.8, 'stroke-linecap': 'round',
      }, g)
    }
  },
  lune(g) {
    node('path', { d: 'M1.6,-8.2 A8.4,8.4 0 1 0 8.6,3.6 A6.6,6.6 0 1 1 1.6,-8.2 Z', fill: '#f1c24a' }, g)
  },
  nuage(g, fill = '#8592a8') {
    node('path', { d: 'M-8.5,5 H6.5 A4.6,4.6 0 0 0 6.5,-4.2 A6.2,6.2 0 0 0 -5.2,-5 A5,5 0 0 0 -8.5,5 Z', fill }, g)
  },
  eclaircies(g) {
    const sun = node('g', { transform: 'translate(3.5 -3.5) scale(.72)' }, g)
    ICONS.soleil(sun)
    ICONS.nuage(node('g', { transform: 'translate(-1.5 2.5) scale(.85)' }, g))
  },
  brouillard(g) {
    for (const [y, w] of [[-4.5, 15], [0, 18], [4.5, 12]]) {
      node('line', { x1: -w / 2, y1: y, x2: w / 2, y2: y, stroke: '#8a95a7', 'stroke-width': 2, 'stroke-linecap': 'round' }, g)
    }
  },
  goutte(g, x = 0, s = 1) {
    node('path', { d: 'M0,-8 C3.4,-3 5,-0.2 5,2.6 A5,5 0 0 1 -5,2.6 C-5,-0.2 -3.4,-3 0,-8 Z', fill: '#3d7fd0', transform: `translate(${x} 0) scale(${s})` }, g)
  },
  bruine(g) {
    ICONS.goutte(g)
  },
  pluie(g) {
    ICONS.goutte(g, -4, 0.78)
    ICONS.goutte(g, 4.5, 0.78)
  },
  neige(g) {
    for (let i = 0; i < 3; i++) {
      node('line', { x1: 0, y1: -8, x2: 0, y2: 8, stroke: '#4f98e3', 'stroke-width': 1.9, 'stroke-linecap': 'round', transform: `rotate(${i * 60})` }, g)
    }
  },
  orage(g) {
    node('path', { d: 'M1.8,-9 L-5.2,1.6 H-0.6 L-2.6,9 L5.2,-2 H0.6 Z', fill: '#f2b21b' }, g)
  },
}

export function createSkin({ defs, reduceMotion = false }) {
  // ---------- Dégradés partagés ----------
  const gradient = (tag, id, attrs, stops) => {
    const g = node(tag, { id, ...attrs }, defs)
    for (const [offset, color, opacity] of stops) node('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }, g)
    return g
  }
  const vertical = { x1: 0, y1: 0, x2: 0, y2: 1 }
  gradient('linearGradient', 'peau-volume', vertical, [[0, '#ffffff', 0.5], [0.42, '#ffffff', 0], [0.68, '#30405e', 0], [1, '#30405e', 0.16]])
  gradient('radialGradient', 'peau-soleil', {}, [[0, '#ffc657', 0.62], [0.55, '#ffd98a', 0.22], [1, '#ffe7b0', 0]])
  gradient('radialGradient', 'peau-ombre', {}, [[0, '#46567a', 0.17], [1, '#46567a', 0]])
  gradient('linearGradient', 'peau-ventre', vertical, [[0, '#33415e', 0], [0.45, '#33415e', 0], [1, '#33415e', 1]])
  gradient('linearGradient', 'peau-brume', { x1: 0, y1: 0, x2: 1, y2: 0 }, [[0, '#ffffff', 0], [0.5, '#ffffff', 0.85], [1, '#ffffff', 0]])
  gradient('radialGradient', 'peau-eclair', {}, [[0, '#fffbe8', 1], [0.4, '#fff1b0', 0.7], [1, '#fff1b0', 0]])
  gradient('linearGradient', 'peau-givre', vertical, [[0, '#ffffff', 1], [0.34, '#eef6ff', 0.6], [0.6, '#ffffff', 0]])
  gradient('linearGradient', 'peau-nuit', vertical, [[0, '#1f2f78', 0.34], [0.65, '#1f2f78', 0]])
  gradient('radialGradient', 'peau-joue', {}, [[0, '#ff8aa5', 0.75], [1, '#ff8aa5', 0]])
  gradient('linearGradient', 'peau-eau', vertical, [[0, GREEN.main, 1], [1, GREEN.deep, 1]])

  // ---------- Le motif : couches de la peau ----------
  // Le contenu d'un motif part du coin de sa tuile : le viewBox le remet dans le repère de l'avatar
  const pattern = node('pattern', { id: 'nuage-skin', patternUnits: 'userSpaceOnUse', x: -150, y: -150, width: 300, height: 300, viewBox: '-150 -150 300 300' }, defs)
  const base = node('rect', { x: -150, y: -150, width: 300, height: 300, fill: BASE }, pattern)
  const volume = node('rect', { fill: 'url(#peau-volume)' }, pattern)
  const weatherG = node('g', {}, pattern)
  const blushG = node('g', { opacity: 0 }, pattern)
  const cheeks = [0, 1].map(() => node('ellipse', { rx: 13, ry: 7.5, fill: 'url(#peau-joue)' }, blushG))
  const liquidG = node('g', { visibility: 'hidden' }, pattern)
  const back = node('path', { fill: GREEN.deep, opacity: 0.85 }, liquidG)
  const front = node('path', { fill: 'url(#peau-eau)' }, liquidG)
  const foam = node('path', { fill: 'none', stroke: GREEN.foam, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.9 }, liquidG)
  const bubblesG = node('g', { fill: '#ffffff' }, liquidG)
  const labelG = node('g', { visibility: 'hidden' }, pattern)
  const iconG = node('g', {}, labelG)
  const text = node('text', { 'font-family': FONT, 'font-weight': 800, 'text-anchor': 'start' }, labelG)
  text.id = 'skin-label'
  const checkG = node('g', { visibility: 'hidden' }, pattern)
  node('path', { d: 'M-12,1 L-3.5,9.5 L13,-9', fill: 'none', stroke: GREEN.ink, 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, checkG)
  node('path', { d: 'M-12,1 L-3.5,9.5 L13,-9', fill: 'none', stroke: '#ffffff', 'stroke-width': 6.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, checkG)

  // ---------- État ----------
  let svg = null
  let box = { x: -118, y: -86, width: 230, height: 168 } // tout le corps (repère de l'avatar)
  let head = { x: -80, y: -80, width: 160, height: 160 } // la grosse boule du milieu
  let measuredAt = -10
  let weather = null
  let labelOn = true
  let muted = false
  let bodyColor = BASE
  let animators = []
  let blush = { now: 0, target: 0, heat: 0 }
  const liquid = { on: false, target: 0, level: 0, tint: 0, done: false, text: '', check: 0 }
  let bubbles = []
  let paintedBase = ''

  function measure() {
    if (!svg?.isConnected) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const paths = [...svg.querySelectorAll(':scope > path')]
    for (const p of paths) {
      const b = p.getBBox()
      if (!b.width || !b.height) continue
      x0 = Math.min(x0, b.x)
      y0 = Math.min(y0, b.y)
      x1 = Math.max(x1, b.x + b.width)
      y1 = Math.max(y1, b.y + b.height)
    }
    if (!Number.isFinite(x0)) return
    const next = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    // La boule du milieu est le chemin posé juste avant le groupe des yeux
    const eyes = svg.querySelector(':scope > g')
    const headPath = eyes?.previousElementSibling
    if (headPath?.tagName === 'path') {
      const b = headPath.getBBox()
      if (b.width && b.height) head = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    const moved = Math.abs(next.x - box.x) + Math.abs(next.y - box.y) + Math.abs(next.width - box.width) + Math.abs(next.height - box.height) > 6
    box = next
    volume.setAttribute('x', box.x - 4)
    volume.setAttribute('y', box.y - 4)
    volume.setAttribute('width', box.width + 8)
    volume.setAttribute('height', box.height + 8)
    if (moved) buildWeather()
    renderLabel()
  }

  // ---------- Couleur du corps ----------
  function paintBase() {
    const color = liquid.tint > 0.01 ? mix(bodyColor, GREEN.tint, clamp(liquid.tint, 0, 1)) : bodyColor
    if (color === paintedBase) return
    paintedBase = color
    base.setAttribute('fill', color)
  }

  // ---------- Météo dans le nuage ----------
  function buildWeather() {
    weatherG.replaceChildren()
    animators = []
    if (!weather) return
    const { key, night } = weather
    const b = box
    const clear = key === 'soleil' || key === 'eclaircies'
    const cover = (fill, opacity = 1) => node('rect', { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20, fill, opacity }, weatherG)
    const inside = () => {
      // Un point du corps, loin des yeux (au centre de la tête)
      for (let i = 0; i < 30; i++) {
        const x = rand(b.x + 12, b.x + b.width - 12)
        const y = rand(b.y + 8, b.y + b.height * 0.8)
        const cx = head.x + head.width / 2
        const cy = head.y + head.height / 2
        if (Math.abs(x - cx) > 34 || Math.abs(y - cy) > 34) return { x, y }
      }
      return { x: b.x + 20, y: b.y + 20 }
    }
    const twinkle = (el, speed, phase, low = 0.2) => t => {
      const s = 0.5 + 0.5 * Math.sin(t * speed + phase)
      el.setAttribute('opacity', (low + (1 - low) * s * s).toFixed(3))
    }

    if (night) cover('url(#peau-nuit)', clear ? 1 : 0.6)
    if (!night && clear) {
      // Le soleil le chauffe par le haut, à droite
      const sun = node('circle', { cx: b.x + b.width * 0.8, cy: b.y + 6, r: b.height * (key === 'soleil' ? 0.85 : 0.6), fill: 'url(#peau-soleil)' }, weatherG)
      animators.push(t => sun.setAttribute('opacity', (0.78 + 0.22 * Math.sin(t * 0.8)).toFixed(3)))
    }
    if (key === 'eclaircies' || key === 'couvert') {
      // Ombres d'autres nuages qui passent sur lui
      const shades = key === 'couvert' ? [[0.62, 9, 0], [0.38, 6, 0.5]] : [[0.64, 10, 0]]
      for (const [at, speed, offset] of shades) {
        const shade = node('ellipse', { rx: 64, ry: 24, cy: b.y + b.height * at, fill: 'url(#peau-ombre)' }, weatherG)
        const span = b.width + 160
        animators.push(t => shade.setAttribute('cx', (b.x - 80 + ((t * speed + offset * span) % span)).toFixed(1)))
      }
    }
    const belly = { couvert: 0.2, bruine: 0.18, pluie: 0.3, orage: 0.45 }[key]
    if (belly) cover('url(#peau-ventre)', belly)
    if (key === 'brouillard') {
      ;[0.3, 0.52, 0.74].forEach((at, i) => {
        const band = node('rect', { y: b.y + b.height * at, width: 210, height: 14, rx: 7, fill: 'url(#peau-brume)' }, weatherG)
        animators.push(t => band.setAttribute('x', (b.x + b.width / 2 - 105 + Math.sin(t * 0.22 + i * 2.1) * 48).toFixed(1)))
      })
    }
    if (key === 'bruine' || key === 'pluie' || key === 'orage') {
      // Gouttes qui glissent sur son corps
      const count = { bruine: 7, pluie: 14, orage: 11 }[key]
      const speed = key === 'bruine' ? 28 : 64
      const color = key === 'orage' ? '#d7e6ff' : '#3c78c4'
      const drops = Array.from({ length: count }, () => {
        const len = key === 'bruine' ? rand(4, 6) : rand(7, 11)
        const el = node('line', { x1: 0, y1: 0, x2: -0.9, y2: len, stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.62 }, weatherG)
        return { el, x: rand(b.x + 8, b.x + b.width - 8), y: rand(b.y, b.y + b.height), v: speed * rand(0.75, 1.25) }
      })
      animators.push((_t, dt) => {
        for (const d of drops) {
          d.y += d.v * dt
          if (d.y > b.y + b.height + 6) {
            d.y = b.y - rand(4, 40)
            d.x = rand(b.x + 8, b.x + b.width - 8)
          }
          d.el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`)
        }
      })
    }
    if (key === 'orage') {
      // Éclairs qui l'illuminent de l'intérieur, comme un vrai cumulonimbus
      const flash = node('circle', { r: 100, fill: 'url(#peau-eclair)', opacity: 0 }, weatherG)
      const bolt = node('path', { fill: 'none', stroke: '#fff6c6', 'stroke-width': 3.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0 }, weatherG)
      let next = rand(1.5, 4)
      let startedAt = -10
      animators.push(t => {
        if (t > next) {
          startedAt = t
          next = t + rand(3.5, 8.5)
          const p = inside()
          flash.setAttribute('cx', p.x.toFixed(1))
          flash.setAttribute('cy', (p.y - 10).toFixed(1))
          let x = p.x + rand(-10, 10)
          let y = b.y + 6
          let d = `M${x.toFixed(1)},${y.toFixed(1)}`
          for (let i = 0; i < 5; i++) {
            x += rand(-13, 13)
            y += b.height * 0.15
            d += ` L${x.toFixed(1)},${y.toFixed(1)}`
          }
          bolt.setAttribute('d', d)
        }
        const e = t - startedAt
        const o = e < 0.06 ? e / 0.06
          : e < 0.14 ? 1 - ((e - 0.06) / 0.08) * 0.75
            : e < 0.2 ? 0.25 + ((e - 0.14) / 0.06) * 0.6
              : e < 0.6 ? 0.85 * (1 - (e - 0.2) / 0.4) : 0
        flash.setAttribute('opacity', o.toFixed(3))
        bolt.setAttribute('opacity', (o > 0.45 ? o : 0).toFixed(3))
      })
    }
    if (key === 'neige') {
      cover('url(#peau-givre)')
      for (let i = 0; i < 8; i++) {
        const p = inside()
        const dot = node('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rand(1.1, 1.8).toFixed(2), fill: '#86bdfc' }, weatherG)
        animators.push(twinkle(dot, rand(1.2, 2.4), rand(0, 6), 0.1))
      }
    }
    if (night && clear) {
      // Ciel de nuit sur sa peau : de petites étoiles qui scintillent
      for (let i = 0; i < 10; i++) {
        const p = inside()
        const s = rand(0.7, 1.15)
        const star = node('path', {
          d: 'M0,-3.4 L0.85,-0.85 L3.4,0 L0.85,0.85 L0,3.4 L-0.85,0.85 L-3.4,0 L-0.85,-0.85 Z',
          fill: '#fff3c2', transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${s.toFixed(2)})`,
        }, weatherG)
        animators.push(twinkle(star, rand(0.8, 1.8), rand(0, 6)))
      }
    }
    if (reduceMotion) for (const a of animators) a(0, 0)
  }

  // ---------- Écriture sur le corps ----------
  // La température s'écrit sur le ventre, juste sous les yeux (qui grandissent avec certaines humeurs) ;
  // l'avancement du téléchargement et la coche finale sur le front, au-dessus de l'eau qui monte. Jamais
  // trop bas : la barre « en cours de lecture » passe sous lui.
  let labelSize = 21
  let labelY = null
  let labelBlocked = false // de grands yeux (danse, fou rire) passent dessus : la température s'efface
  let labelAlpha = 1
  const onForehead = () => liquid.on || liquid.done
  function labelTarget() {
    let eyes = null
    try {
      const e = svg?.querySelector(':scope > g')?.getBBox()
      if (e?.height) eyes = e
    } catch {}
    if (onForehead()) {
      labelBlocked = false
      const top = eyes ? eyes.y : head.y + head.height * 0.35
      return clamp(top - 6, head.y + head.height * 0.21, head.y + head.height * 0.4)
    }
    const bottom = eyes ? eyes.y + eyes.height : head.y + head.height * 0.64
    const low = head.y + head.height * 0.88
    labelBlocked = bottom + labelSize * 0.86 > low + 3
    return clamp(bottom + labelSize * 0.86, head.y + head.height * 0.84, low)
  }
  function placeLabel(target = labelTarget(), smooth = 1) {
    labelY = labelY === null || smooth >= 1 ? target : labelY + (target - labelY) * smooth
    const cx = head.x + head.width / 2
    labelG.setAttribute('transform', `translate(${cx.toFixed(1)} ${labelY.toFixed(1)})`)
    checkG.setAttribute('transform', `translate(${cx.toFixed(1)} ${(labelY - 8).toFixed(1)}) scale(${(liquid.check * 1.1).toFixed(3)})`)
  }
  function renderLabel() {
    const downloading = liquid.on || liquid.done
    checkG.setAttribute('visibility', liquid.done && !muted ? 'visible' : 'hidden')
    let label = ''
    let icon = null
    if (downloading && !liquid.done) {
      label = liquid.text
    } else if (!downloading && weather && labelOn && Number.isFinite(weather.temp)) {
      label = `${weather.temp}°`
      icon = weather.night && (weather.key === 'soleil' || weather.key === 'eclaircies') ? 'lune' : weather.key
    }
    const size = downloading ? 22 : 20
    labelSize = size
    placeLabel()
    if (!label || muted) {
      labelG.setAttribute('visibility', 'hidden')
      return
    }
    const width = size * (0.56 * label.replace(/\D/g, '').length + 0.5 * label.replace(/\d/g, '').length)
    const iconWidth = icon ? 20 : 0
    const start = -(width + iconWidth) / 2
    iconG.replaceChildren()
    if (icon && ICONS[icon]) {
      iconG.setAttribute('transform', `translate(${(start + 9).toFixed(1)} ${(-size * 0.36).toFixed(1)})`)
      ICONS[icon](iconG)
    }
    text.textContent = label
    text.setAttribute('x', (start + iconWidth).toFixed(1))
    text.setAttribute('font-size', size)
    if (downloading) {
      text.setAttribute('fill', '#ffffff')
      text.setAttribute('stroke', GREEN.ink)
      text.setAttribute('stroke-width', 4.5)
      text.setAttribute('stroke-linejoin', 'round')
      text.setAttribute('paint-order', 'stroke')
      text.setAttribute('opacity', 1)
    } else {
      const light = isLight(bodyColor)
      text.setAttribute('fill', light ? '#33415c' : '#f5f8fd')
      text.removeAttribute('stroke')
      text.setAttribute('opacity', light ? 0.74 : 0.9)
    }
    labelG.setAttribute('visibility', 'visible')
  }

  // ---------- Eau verte du téléchargement ----------
  function wave(y, amp, length, phase, close = true) {
    let d = ''
    for (let x = -156; x <= 156; x += 6) d += `${d ? 'L' : 'M'}${x},${(y + Math.sin((x / length) * Math.PI * 2 + phase) * amp).toFixed(1)}`
    return close ? `${d}L156,156L-156,156Z` : d
  }
  function stepLiquid(t, dt) {
    const speed = liquid.done ? 5 : liquid.on ? 2.2 : 1.6
    liquid.level += (liquid.target - liquid.level) * (1 - Math.exp(-dt * speed))
    liquid.tint += ((liquid.on || liquid.done ? 1 : 0) - liquid.tint) * (1 - Math.exp(-dt * 2.5))
    liquid.check += ((liquid.done ? 1 : 0) - liquid.check) * (1 - Math.exp(-dt * 9))
    paintBase()
    const visible = liquid.on || liquid.done || liquid.level > 0.004
    liquidG.setAttribute('visibility', visible ? 'visible' : 'hidden')
    if (!visible) return
    const top = box.y - 9
    const bottom = box.y + box.height + 9
    const y = bottom - clamp(liquid.level, 0, 1) * (bottom - top)
    const calm = 0.35 + Math.sin(Math.PI * clamp(liquid.level, 0, 1))
    back.setAttribute('d', wave(y - 2.5, 4.4 * calm, 96, t * 1.7 + 1.2))
    front.setAttribute('d', wave(y, 5.4 * calm, 74, -t * 2.3))
    foam.setAttribute('d', wave(y, 5.4 * calm, 74, -t * 2.3, false))
    // Bulles qui montent dans l'eau
    if (bubbles.length === 0) {
      bubbles = Array.from({ length: 6 }, () => ({ el: node('circle', { r: rand(1.6, 3.6).toFixed(2) }, bubblesG), x: 0, y: bottom + rand(0, 60), v: rand(18, 34), w: rand(0, 6) }))
    }
    for (const bubble of bubbles) {
      bubble.y -= bubble.v * dt
      if (bubble.y < y + 5) {
        bubble.y = bottom + rand(0, 40)
        bubble.x = rand(box.x + 18, box.x + box.width - 18)
      }
      const x = bubble.x + Math.sin(t * 2 + bubble.w) * 2.5
      bubble.el.setAttribute('cx', x.toFixed(1))
      bubble.el.setAttribute('cy', bubble.y.toFixed(1))
      bubble.el.setAttribute('opacity', liquid.level > 0.08 && bubble.y > y + 5 ? 0.5 : 0)
    }
  }

  // ---------- Joues roses (timide, content, ou quand il fait chaud) ----------
  function stepBlush(dt) {
    const target = Math.max(blush.target, blush.heat)
    blush.now += (target - blush.now) * (1 - Math.exp(-dt * 3))
    blushG.setAttribute('opacity', blush.now.toFixed(3))
    if (blush.now < 0.02 || !svg) return
    const eyes = svg.querySelector(':scope > g')
    if (!eyes) return
    const e = eyes.getBBox()
    if (!e.width) return
    const y = e.y + e.height * 0.86
    cheeks[0].setAttribute('cx', (e.x - 13).toFixed(1))
    cheeks[1].setAttribute('cx', (e.x + e.width + 13).toFixed(1))
    for (const c of cheeks) c.setAttribute('cy', y.toFixed(1))
  }

  // ---------- Boucle (20 images/s pour la météo, 40 pendant un téléchargement) ----------
  let raf = 0
  let last = 0
  const busy = () => animators.length || liquid.on || liquid.done || liquid.level > 0.004 || Math.abs(liquid.tint) > 0.01 ||
    blush.now > 0.02 || blush.target > 0 || blush.heat > 0 || liquid.check > 0.01
  function step(now) {
    raf = 0
    // Téléchargement : 40 images/s (l'eau bouge) ; sinon la météo de la peau, lente, à 12 (avant : 20)
    const fps = liquid.on || liquid.done || liquid.level > 0.004 ? 40 : Math.abs(blush.now - Math.max(blush.target, blush.heat)) > 0.01 ? 30 : 12
    if (now - last >= 1000 / fps - 3) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps
      last = now
      const t = now / 1000
      if (t - measuredAt > 3) {
        measuredAt = t
        measure()
      }
      for (const a of animators) a(t, dt)
      stepLiquid(t, dt)
      stepBlush(dt)
      if (labelG.getAttribute('visibility') === 'visible' || liquid.check > 0.01) {
        placeLabel(labelTarget(), 1 - Math.exp(-dt * 8))
        const alpha = labelAlpha + ((labelBlocked ? 0 : 1) - labelAlpha) * (1 - Math.exp(-dt * 6))
        if (Math.abs(alpha - labelAlpha) > 0.005) {
          labelAlpha = alpha
          labelG.setAttribute('opacity', alpha.toFixed(3))
        }
      }
    }
    if (busy()) raf = requestAnimationFrame(step)
    else last = 0
  }
  function wake() {
    if (reduceMotion) {
      // Mouvement réduit : une seule image, sans animation
      liquid.level = liquid.target
      liquid.tint = liquid.on || liquid.done ? 1 : 0
      liquid.check = liquid.done ? 1 : 0
      blush.now = Math.max(blush.target, blush.heat)
      stepLiquid(0, 0)
      stepBlush(0)
      renderLabel()
      return
    }
    if (!raf) raf = requestAnimationFrame(step)
  }

  return {
    // À appeler une fois l'avatar créé (son <svg>)
    attach(element) {
      svg = element
      measuredAt = -10
      measure()
      wake()
    },
    setWeather(w) {
      weather = w || null
      bodyColor = w ? (w.night ? mix(WEATHER_BODY[w.key] || BASE, NIGHT_TINT, 0.3) : WEATHER_BODY[w.key] || BASE) : BASE
      blush.heat = w && !w.night && w.temp >= 31 ? 0.32 : 0
      paintedBase = ''
      paintBase()
      buildWeather()
      renderLabel()
      wake()
    },
    setLabel(on) {
      labelOn = Boolean(on)
      renderLabel()
    },
    // Bouche ouverte (il mange un fichier) : rien d'écrit sur le ventre
    setMuted(on) {
      muted = Boolean(on)
      renderLabel()
    },
    setBlush(amount) {
      blush.target = clamp(amount, 0, 1)
      wake()
    },
    // on : téléchargement en cours ; level : 0 à 1 ; text : « 42 % » ou « 12 Mo » ; done : rempli + coche
    setDownload({ on = false, level = 0, text = '', done = false } = {}) {
      liquid.on = on
      liquid.done = done
      liquid.target = done ? 1 : on ? clamp(level, 0, 1) : 0
      if (text !== liquid.text || !on) {
        liquid.text = text
        renderLabel()
      }
      if (!on && !done) renderLabel()
      wake()
    },
    get bodyColor() {
      return bodyColor
    },
    debug: () => ({ box, head, level: liquid.level, tint: liquid.tint, label: labelG.getAttribute('visibility') === 'visible' ? text.textContent : '', weather: weather?.key || null, animators: animators.length }),
  }
}

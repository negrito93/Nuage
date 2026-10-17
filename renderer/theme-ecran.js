// Thème Windows pour les écrans plein format (image de verrouillage, écran de veille).
// Paramètres d'URL : ?accent=RRGGBB&theme=dark|light

export function mix(a, b, t) {
  const rgb = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

export function applyScreenTheme() {
  const params = new URLSearchParams(location.search)
  const accent = /^[0-9a-f]{6}$/i.test(params.get('accent') || '') ? `#${params.get('accent')}` : '#3b82f6'
  const dark = params.get('theme') !== 'light'
  const root = document.documentElement.style
  root.setProperty('--accent', accent)
  root.setProperty('--bg-1', dark ? mix(accent, '#05060a', 0.8) : mix(accent, '#ffffff', 0.86))
  root.setProperty('--bg-2', dark ? '#06070b' : '#f5f7fb')
  root.setProperty('--bg-3', dark ? mix(accent, '#05060a', 0.66) : mix(accent, '#ffffff', 0.74))
  root.setProperty('--ink', dark ? 'rgba(255,255,255,.7)' : 'rgba(17,24,39,.6)')
  root.setProperty('--ink-strong', dark ? 'rgba(255,255,255,.92)' : 'rgba(17,24,39,.85)')
  document.body.classList.toggle('dark', dark)
  return { accent, dark, params }
}

// Étoiles placées de façon stable (même tirage à chaque fois)
export function sprinkleStars(container, { count = 70, maxTop = 58, twinkle = false } = {}) {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    const star = document.createElement('span')
    const size = 0.15 + random() * 0.35
    Object.assign(star.style, {
      left: `${random() * 100}%`,
      top: `${random() * maxTop}%`,
      width: `${size}vh`,
      height: `${size}vh`,
      opacity: String(0.25 + random() * 0.6),
    })
    if (twinkle) star.style.animationDelay = `${(random() * 4).toFixed(2)}s`
    container.append(star)
  }
}

// Nuage endormi, corps adapté au thème
export function sleepyDefinition(dark) {
  const definition = structuredClone(window.NUAGE_AVATAR)
  definition.colors = { ...definition.colors, body: dark ? '#eef2fb' : '#ffffff' }
  return definition
}

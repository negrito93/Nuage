// Vie de Nuage (04/10/2026) : ce qui le rend vivant entre deux événements.
// Repris des compagnons de bureau et des principes d'animation (Shimeji : il penche selon la direction
// du glisser et rebondit en se posant ; mascottes : respiration, coups d'œil, anticipation,
// compression-étirement, mouvement secondaire) :
//  - physique du glisser : il penche dans le sens inverse du mouvement, s'étire, gigote au lâcher
//    (ressorts amortis), et laisse une traînée de petites bouffées ;
//  - actions de désœuvrement (le choix et les humeurs sont faits par renderer.js) : saut, pirouette,
//    étirement, souffle d'un petit nuage, ébrouement après la pluie… ;
//  - émotes au-dessus de sa tête : « ! », « ? », cœurs, goutte, étoiles, « z » quand il dort.
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const rand = (a, b) => a + Math.random() * (b - a)

const ACTIONS = ['hop', 'spin', 'stretch', 'shake', 'jelly', 'land', 'sip', 'cheer']

export function createLife({ bodyEl, lifeEl, emotesEl, trailEl, reduceMotion = false }) {
  // ---------- Ressorts amortis (inclinaison, étirement, soulèvement) ----------
  const spring = (stiff, damp) => ({ x: 0, v: 0, stiff, damp })
  const tilt = spring(170, 11) // degrés
  const stretch = spring(260, 16)
  const lift = spring(220, 18)
  const stepSpring = (s, target, dt) => {
    s.v += ((target - s.x) * s.stiff - s.v * s.damp) * dt
    s.x += s.v * dt
  }
  let lastX = window.screenX
  let lastY = window.screenY
  let lastT = 0
  let vx = 0
  let vy = 0
  let lastPuff = 0
  let painted = ''
  const puffs = []
  let test = null // vitesse imposée par l'auto-test (aucune vraie souris)

  function frame(now, { dragging = false, hover = false } = {}) {
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60
    lastT = now
    const x = window.screenX
    const y = window.screenY
    const dx = x - lastX
    const dy = y - lastY
    lastX = x
    lastY = y
    const k = Math.min(1, dt * 14)
    const forced = test && !test.window // vitesse imposée ; sinon celle de la fenêtre
    vx += ((forced ? test.vx : dx / dt) - vx) * k
    vy += ((forced ? test.vy : dy / dt) - vy) * k
    const moving = dragging || Boolean(test)
    if (!moving) {
      vx *= 0.8
      vy *= 0.8
    }
    stepSpring(tilt, moving ? clamp(vx * 0.02, -24, 24) : 0, dt)
    stepSpring(stretch, moving ? clamp(-vy * 0.00013, -0.1, 0.12) : 0, dt)
    stepSpring(lift, moving ? 0.06 : hover ? 0.035 : 0, dt)
    const sx = 1 + lift.x - stretch.x * 0.5
    const sy = 1 + lift.x + stretch.x
    const css = `rotate(${tilt.x.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
    if (css !== painted) {
      painted = css
      bodyEl.style.transform = css
    }
    // Traînée de bouffées : elles restent là où il est passé (repère de l'écran)
    const speed = Math.hypot(vx, vy)
    if (moving && speed > 380 && now - lastPuff > 55) {
      lastPuff = now
      spawnPuff()
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]
      if (!p.el.isConnected) {
        puffs.splice(i, 1)
        continue
      }
      p.el.style.transform = `translate(${(p.sx - window.screenX).toFixed(1)}px, ${(p.sy - window.screenY).toFixed(1)}px)`
    }
  }
  function spawnPuff() {
    const r = lifeEl.getBoundingClientRect()
    const size = rand(12, 22)
    const el = document.createElement('span')
    el.className = 'puff'
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    el.style.left = `${-size / 2}px`
    el.style.top = `${-size / 2}px`
    const p = {
      el,
      sx: window.screenX + r.left + r.width * rand(0.3, 0.7),
      sy: window.screenY + r.top + r.height * rand(0.55, 0.8),
    }
    el.style.transform = `translate(${(p.sx - window.screenX).toFixed(1)}px, ${(p.sy - window.screenY).toFixed(1)}px)`
    el.addEventListener('animationend', () => el.remove())
    trailEl.append(el)
    puffs.push(p)
  }

  // ---------- Actions (classes CSS sur .life ; la respiration reprend ensuite) ----------
  let actionTimer = null
  function action(name, ms = 1600) {
    if (reduceMotion || !ACTIONS.includes(name)) return
    lifeEl.classList.remove(...ACTIONS)
    void lifeEl.offsetWidth // relance l'animation même si c'est la même
    lifeEl.classList.add(name)
    clearTimeout(actionTimer)
    actionTimer = setTimeout(() => lifeEl.classList.remove(name), ms)
  }
  lifeEl.addEventListener('animationend', e => {
    if (e.target === lifeEl && e.animationName !== 'breathe') lifeEl.classList.remove(...ACTIONS)
  })

  // ---------- Émotes au-dessus de la tête ----------
  const lastEmote = new Map()
  function emote(kind) {
    if (reduceMotion && kind !== 'zzz') return
    const now = performance.now()
    if (now - (lastEmote.get(kind) || 0) < (kind === 'zzz' ? 900 : 1800)) return
    lastEmote.set(kind, now)
    const el = document.createElement('span')
    el.className = `emote emote-${kind}`
    el.setAttribute('aria-hidden', 'true')
    if (kind === 'surprise') el.textContent = '!'
    else if (kind === 'question') el.textContent = '?'
    else if (kind === 'zzz') {
      el.textContent = 'z'
      el.style.setProperty('--zs', rand(0.75, 1.25).toFixed(2))
    } else if (kind === 'coeur') {
      for (let i = 0; i < 3; i++) {
        const heart = document.createElement('i')
        heart.style.setProperty('--d', `${i * 0.18}s`)
        heart.style.setProperty('--dx', `${Math.round(rand(-16, 16))}px`)
        el.append(heart)
      }
    } else if (kind === 'etoiles') {
      for (let i = 0; i < 4; i++) {
        const star = document.createElement('i')
        star.style.setProperty('--d', `${i * 0.12}s`)
        star.style.setProperty('--dx', `${Math.round(rand(-34, 34))}px`)
        star.style.setProperty('--dy', `${Math.round(rand(-30, -6))}px`)
        el.append(star)
      }
    } else if (kind === 'colere') {
      el.append(document.createElement('i'))
    } else if (kind === 'eclair') {
      // Branché à la prise : des éclairs jaillissent tout autour de lui
      const n = 8
      for (let i = 0; i < n; i++) {
        const bolt = document.createElement('i')
        bolt.style.setProperty('--a', `${Math.round((360 / n) * i + rand(-14, 14))}deg`)
        bolt.style.setProperty('--d', `${(i % 4) * 0.07 + rand(0, 0.06)}s`)
        el.append(bolt)
      }
    }
    el.style.setProperty('--jx', `${Math.round(rand(-6, 6))}px`)
    el.addEventListener('animationend', e => {
      if (e.target === el) el.remove() // les émotes faites de plusieurs pièces partent avec le minuteur
    })
    setTimeout(() => el.remove(), 3200)
    emotesEl.append(el)
  }
  let zzzTimer = null
  function sleeping(on) {
    clearInterval(zzzTimer)
    zzzTimer = null
    if (on) {
      emote('zzz')
      zzzTimer = setInterval(() => emote('zzz'), 1900)
    }
  }

  // ---------- Petits effets ----------
  // Il souffle un tout petit nuage qui s'envole
  function blow() {
    if (reduceMotion) return
    const el = document.createElement('span')
    el.className = 'cloudlet'
    el.style.setProperty('--side', Math.random() < 0.5 ? '-1' : '1')
    el.addEventListener('animationend', () => el.remove())
    emotesEl.append(el)
  }
  // Il s'ébroue : des gouttes s'envolent tout autour
  function splash() {
    if (reduceMotion) return
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('span')
      el.className = 'droplet'
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05) + (i % 2 ? 0 : Math.PI * 0.15)
      const d = rand(40, 70)
      el.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`)
      el.style.setProperty('--dy', `${Math.round(Math.sin(a) * d)}px`)
      el.style.setProperty('--d', `${(i * 0.03).toFixed(2)}s`)
      el.addEventListener('animationend', () => el.remove())
      emotesEl.append(el)
    }
  }

  // ---------- Désœuvrement : quelle petite action, et quand ----------
  let nextIdle = performance.now() + rand(18_000, 30_000)
  function pickIdle({ eligible, wet = false, hot = false, late = false }) {
    const now = performance.now()
    if (reduceMotion || !eligible) {
      nextIdle = Math.max(nextIdle, now + 8000)
      return null
    }
    if (now < nextIdle) return null
    nextIdle = now + rand(22_000, 55_000)
    const pool = [['regard', 3], ['saut', 2], ['pirouette', 1], ['etirement', 2], ['souffle', 2], ['clin', 1]]
    if (wet) pool.push(['ebroue', 3])
    if (hot) pool.push(['chaleur', 2])
    if (late) pool.push(['baille', 3])
    let roll = Math.random() * pool.reduce((s, [, w]) => s + w, 0)
    for (const [name, weight] of pool) {
      roll -= weight
      if (roll <= 0) return name
    }
    return pool[0][0]
  }

  // Quelque chose bouge encore (ressorts pas posés, traînée, action en cours) : le rendu reste à pleine vitesse
  const busy = () => ACTIONS.some(a => lifeEl.classList.contains(a)) || puffs.length > 0 || Boolean(test) ||
    Math.abs(tilt.x) + Math.abs(tilt.v) * 0.05 > 0.05 || Math.abs(stretch.x) + Math.abs(lift.x) > 0.002 || Math.abs(lift.v) + Math.abs(stretch.v) > 0.01

  return {
    frame,
    busy,
    action,
    emote,
    sleeping,
    blow,
    splash,
    pickIdle,
    // Auto-test : simule un glisser, sans toucher la souris : { vx, vy } (px/s) imposés, ou
    // { window: true } (la vitesse vient des déplacements de la fenêtre, faits par le processus principal)
    simulate(v) {
      test = v || null
    },
    state: () => ({ tilt: tilt.x, stretch: stretch.x, lift: lift.x, transform: painted }),
  }
}

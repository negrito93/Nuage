// Boîte à sons originale de Nuage, synthétisée à la volée (Web Audio, aucun fichier).
let ctx = null
let enabled = true
let volume = 0.5

export function setSounds(on, level = volume) {
  enabled = Boolean(on)
  volume = Math.min(1, Math.max(0, level))
}

function audio() {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// Une note : fréquence de départ -> d'arrivée, forme d'onde, enveloppe
function tone({ from, to = from, at = 0, dur = 0.15, type = 'sine', gain = 0.25 }) {
  const c = audio()
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain * volume, t + Math.min(0.02, dur / 4))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}
// Souffle (bruit filtré), pour les glissements
function breath({ at = 0, dur = 0.3, from = 400, to = 1600, gain = 0.15 }) {
  const c = audio()
  const t = c.currentTime + at
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain * volume, t + dur * 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t)
}

const SOUNDS = {
  pop: () => tone({ from: 520, to: 880, dur: 0.09, gain: 0.3 }),
  rire: () => [0, 0.09, 0.18].forEach((at, i) => tone({ from: 700 + i * 90, to: 900 + i * 90, at, dur: 0.07, type: 'triangle', gain: 0.22 })),
  gazouillis: () => { tone({ from: 1200, to: 1800, dur: 0.08 }); tone({ from: 1500, to: 2200, at: 0.1, dur: 0.08 }) },
  whoosh: () => breath({ dur: 0.35 }),
  boum: () => tone({ from: 160, to: 60, dur: 0.18, gain: 0.35 }),
  glouglou: () => tone({ from: 320, to: 70, dur: 0.22, gain: 0.3 }),
  carillon: () => { tone({ from: 880, dur: 0.6 }); tone({ from: 1320, at: 0.18, dur: 0.6 }) },
  ding: () => { tone({ from: 1046, dur: 0.35, type: 'triangle', gain: 0.25 }); tone({ from: 1568, at: 0.12, dur: 0.4, type: 'triangle', gain: 0.18 }) },
  succes: () => [523, 659, 784, 1046].forEach((f, i) => tone({ from: f, at: i * 0.09, dur: 0.25, type: 'triangle', gain: 0.22 })),
  erreur: () => { tone({ from: 220, dur: 0.15, type: 'square', gain: 0.12 }); tone({ from: 180, at: 0.17, dur: 0.2, type: 'square', gain: 0.12 }) },
  baillement: () => tone({ from: 420, to: 180, dur: 0.9, type: 'sine', gain: 0.18 }),
  reveil: () => tone({ from: 300, to: 900, dur: 0.25, type: 'triangle', gain: 0.2 }),
  etincelle: () => [1760, 2093, 2637].forEach((f, i) => tone({ from: f, at: i * 0.06, dur: 0.12, gain: 0.12 })),
  tic: () => tone({ from: 2400, dur: 0.03, type: 'square', gain: 0.05 }),
}

export function play(name) {
  if (!enabled || !SOUNDS[name]) return
  try {
    SOUNDS[name]()
  } catch {
    // pas de sortie audio disponible
  }
}

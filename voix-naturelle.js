// Voix naturelle de Nuage (05/10/2026 : « une voix plus naturelle, pas de lecture mot à mot »).
// Piper (synthèse vocale neuronale, logiciel libre, licence MIT, github.com/rhasspy/piper), installé avec
// l'accord de l'utilisateur dans voix-naturelle\piper, et des voix françaises (huggingface.co/rhasspy/
// piper-voices) dans voix-naturelle\voix. Tout se fait sur le PC, hors ligne : rien n'est envoyé.
// Un programme Piper reste ouvert par voix (le modèle n'est chargé qu'une fois) ; chaque phrase devient
// un petit fichier WAV, lu par la fenêtre de Nuage pendant que la phrase suivante se prépare.
// Test : node outils/test-voix-naturelle.js
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Licences des voix : voix-naturelle\voix\*.MODEL_CARD.txt
const VOICES = {
  siwis: { label: 'Siwis (féminine, douce)', model: 'fr_FR-siwis-medium', speaker: null },
  jessica: { label: 'Jessica (féminine, claire)', model: 'fr_FR-upmc-medium', speaker: 'jessica' },
  pierre: { label: 'Pierre (masculine)', model: 'fr_FR-upmc-medium', speaker: 'pierre' },
  tom: { label: 'Tom (masculine, posée)', model: 'fr_FR-tom-medium', speaker: null },
}

// Découpe en phrases (la première se dit pendant que la suivante se prépare) ; les très courtes sont groupées
function sentences(text, min = 20) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const raw = clean.match(/[^.!?…]+[.!?…]+["»)]*\s*|[^.!?…]+$/g) || [clean]
  const out = []
  for (const piece of raw.map(s => s.trim()).filter(Boolean)) {
    if (out.length && (out.at(-1).length < min || piece.length < 12)) out[out.length - 1] += ` ${piece}`
    else out.push(piece)
  }
  return out
}

function createNaturalVoice({ dir, log = () => {}, exe = path.join(dir, 'piper', 'piper.exe') }) {
  const outDir = path.join(os.tmpdir(), 'nuage-voix')
  let proc = null
  let procVoice = ''
  let waiting = [] // { resolve, reject } dans l'ordre des phrases envoyées
  let buffer = ''

  const modelPath = id => path.join(dir, 'voix', `${VOICES[id]?.model}.onnx`)
  function installed(id) {
    return Boolean(VOICES[id]) && fs.existsSync(exe) && fs.existsSync(modelPath(id)) && fs.existsSync(`${modelPath(id)}.json`)
  }
  function speakerId(id) {
    const name = VOICES[id].speaker
    if (name === null) return null
    try {
      const map = JSON.parse(fs.readFileSync(`${modelPath(id)}.json`, 'utf8')).speaker_id_map || {}
      return map[name] ?? null
    } catch {
      return null
    }
  }
  function stop() {
    const p = proc
    proc = null
    procVoice = ''
    for (const w of waiting) w.reject(new Error('voix arrêtée'))
    waiting = []
    if (p) {
      p.stdin.end()
      setTimeout(() => p.exitCode === null && p.kill(), 1500)
    }
  }
  function ensure(id) {
    if (proc && procVoice === id) return proc
    stop()
    fs.mkdirSync(outDir, { recursive: true })
    // Restes d'une session précédente
    for (const f of fs.readdirSync(outDir)) {
      try {
        fs.unlinkSync(path.join(outDir, f))
      } catch {}
    }
    const speaker = speakerId(id)
    const args = ['--model', modelPath(id), '--output_dir', outDir, '--sentence_silence', '0.18', '--length_scale', '0.98', ...(speaker !== null ? ['--speaker', String(speaker)] : [])]
    const p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    proc = p
    procVoice = id
    buffer = ''
    p.stdin.on('error', () => {})
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (line.toLowerCase().endsWith('.wav')) waiting.shift()?.resolve(line)
      }
    })
    p.stderr.on('data', data => {
      const text = String(data)
      if (/error|exception/i.test(text)) log('piper :', text.trim().slice(0, 300))
    })
    const fail = error => {
      if (proc !== p) return
      proc = null
      procVoice = ''
      for (const w of waiting) w.reject(error)
      waiting = []
    }
    p.on('error', fail)
    p.on('exit', code => fail(new Error(`piper s’est arrêté (code ${code})`)))
    return p
  }
  // Une phrase → le son WAV (Buffer)
  function synth(text, id) {
    if (!installed(id)) return Promise.reject(new Error('voix naturelle non installée'))
    const p = ensure(id)
    const line = String(text).replace(/[\r\n]+/g, ' ').trim()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('piper ne répond pas')), 30_000)
      waiting.push({
        resolve: file => {
          clearTimeout(timer)
          try {
            const wav = fs.readFileSync(file)
            fs.unlink(file, () => {})
            resolve(wav)
          } catch (error) {
            reject(error)
          }
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      p.stdin.write(`${line}\n`, 'utf8')
    })
  }
  return {
    installed,
    available: () => Object.keys(VOICES).filter(installed),
    synth,
    // Préparer la voix à l'avance (le modèle se charge une fois, ~1 s)
    warm: id => {
      if (installed(id)) ensure(id)
    },
    stop,
  }
}

module.exports = { createNaturalVoice, VOICES, sentences }

// Test de la voix naturelle (voix-naturelle.js) : découpe en phrases, puis Piper fabrique le son de deux
// phrases avec chaque voix installée (fichiers WAV valides, temps de fabrication). Rien n'est joué ni envoyé.
// Usage : node outils/test-voix-naturelle.js [dossier pour garder des extraits à écouter]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createNaturalVoice, VOICES, sentences } = require('../voix-naturelle')

assert.deepEqual(sentences('Bonjour ! Il est 21 heures. Voici une phrase un peu plus longue pour voir comment elle se coupe. Et une autre ?'),
  ['Bonjour ! Il est 21 heures.', 'Voici une phrase un peu plus longue pour voir comment elle se coupe.', 'Et une autre ?'])
assert.deepEqual(sentences(''), [])
assert.deepEqual(sentences('Sans ponctuation finale'), ['Sans ponctuation finale'])

const keep = process.argv[2] || ''
const voice = createNaturalVoice({ dir: path.join(__dirname, '..', 'voix-naturelle'), log: (...a) => console.log(...a) })
const ms = t0 => Date.now() - t0
const seconds = wav => (wav.readUInt32LE(40) / wav.readUInt32LE(28)) // octets de données / octets par seconde

;(async () => {
  const installed = voice.available()
  assert.ok(installed.length > 0, 'aucune voix naturelle installée (voix-naturelle\\voix)')
  const lines = []
  for (const id of installed) {
    let t0 = Date.now()
    const first = await voice.synth('Coucou, c’est Nuage ! Voici ma voix.', id)
    const cold = ms(t0)
    t0 = Date.now()
    const second = await voice.synth('Il fait vingt-huit degrés à Lyon, avec un grand soleil.', id)
    const warm = ms(t0)
    for (const wav of [first, second]) {
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
      assert.ok(seconds(wav) > 0.8, 'son trop court')
    }
    lines.push(`${id} : ${cold} ms (chargement compris), puis ${warm} ms pour ${seconds(second).toFixed(1)} s de voix`)
    if (keep) {
      fs.mkdirSync(keep, { recursive: true })
      const sample = await voice.synth(`Coucou, c’est Nuage ! Voici ma voix ${VOICES[id].label.split(' ')[0]}. Il fait vingt-huit degrés à Lyon, avec un grand soleil. Tu veux que je te lise la réponse de Claude ?`, id)
      fs.writeFileSync(path.join(keep, `voix-${id}.wav`), sample)
    }
  }
  voice.stop()
  console.log(`test-voix-naturelle : OK\n  ${lines.join('\n  ')}`)
})().catch(error => {
  voice.stop()
  console.error('ÉCHEC :', error.stack || error.message)
  process.exit(1)
})

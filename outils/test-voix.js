// Test de la voix du PC : les commandes comprises (voix.js), puis voix.ps1 sur des phrases dites par la
// synthèse vocale de Windows dans un fichier son (aucun micro, rien n'est envoyé). Usage : node outils/test-voix.js
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { understand, speakable } = require('../voix')

// 1. Commandes
const cases = [
  ['ouvre le chat', 'chat'], ['Affiche la discussion', 'chat'], ['ferme le chat', 'fermer-chat'],
  ['fais sonner mon téléphone', 'sonner'], ['où est mon portable', 'sonner'],
  ['envoie le presse-papiers au téléphone', 'presse-papiers'], ['ouvre le menu téléphone', 'menu-telephone'],
  ['quelle heure est-il', 'heure'], ['quel temps fait-il', 'meteo'], ['quelle est la météo', 'meteo'],
  ['cache-toi', 'cacher'], ['montre-toi', 'montrer'], ['est-ce que Claude a fini', 'claude-etat'], ['où en est Claude', 'claude-etat'],
  ["arrête d'écouter", 'stop-ecoute'], ['tais-toi', 'taire'], ['nouvelle session', 'nouvelle-session'],
  ['merci', 'merci'], ['rien', 'rien'], ['laisse tomber', 'rien'], ['', 'rien'],
  ['quel temps fera-t-il demain à Lyon', 'question'], ['explique-moi comment fonctionne une batterie', 'question'],
  ['merci de résumer ce document pour moi', 'question'], ['le chat du voisin est noir', 'question'],
]
for (const [text, action] of cases) assert.equal(understand(text).action, action, `« ${text} »`)
assert.equal(understand('Explique-moi les nuages').texte, 'Explique-moi les nuages')
assert.equal(speakable('Voici :\n```js\nconst a = 1\n```\n⚙ Lit main.js\nVoir https://exemple.fr **ici**.'), 'Voici : Le code est dans le chat. Voir un lien ici.')
assert.ok(speakable('Une phrase. '.repeat(100)).endsWith('La suite est dans le chat.'))

// 2. voix.ps1 sur un fichier son : le mot de réveil, une commande, une question d'une traite, une phrase sans
// réveil (ignorée), une question libre
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-voix-'))
const wav = path.join(dir, 'essai.wav')
const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'fr-FR' } | Select-Object -First 1
if (-not $v) { Write-Output 'pas de voix francaise'; exit 4 }
$s.SelectVoice($v.VoiceInfo.Name)
$s.Rate = -1
$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}')
$p = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($t in @('Hey Nuage.', 'Ouvre le chat.', 'Salut Nuage, quelle heure est-il ?', 'Les nuages passent dans le ciel bleu.', 'Hey Nuage.', 'Explique-moi comment fonctionne une batterie.')) {
  $p.AppendText($t)
  $p.AppendBreak([TimeSpan]::FromMilliseconds(1300))
}
$s.Speak($p)
$s.Dispose()`
try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true })
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, '..', 'voix.ps1'), '-Fichier', wav], { windowsHide: true, encoding: 'utf8', timeout: 90_000 })
  const events = out.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(e => e.type !== 'partiel')
  const phrases = events.filter(e => e.type === 'phrase').map(e => e.texte.toLowerCase())
  assert.equal(events[0].type, 'pret')
  assert.equal(events.filter(e => e.type === 'reveil').length, 3, 'trois réveils, pas la phrase sur les nuages')
  assert.equal(phrases[0], 'ouvre le chat')
  assert.equal(understand(phrases[0]).action, 'chat')
  assert.equal(understand(phrases[1]).action, 'heure')
  assert.match(phrases[2], /batterie/)
  assert.equal(understand(phrases[2]).action, 'question')
  assert.equal(events.at(-1).type, 'fin')
  console.log(`test-voix : OK (${cases.length} commandes ; voix.ps1 : ${phrases.map(p => `« ${p} »`).join(', ')})`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

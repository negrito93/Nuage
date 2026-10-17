// Serveur de test pour le protocole Java du téléphone (mobile/.../LienProtocoleTest.java) : le vrai lien.js
// sur 127.0.0.1, avec un presse-papiers et un fichier préparés. Écrit le QR code dans <dossier>/qr.txt et,
// à la fin, le bilan dans <dossier>/bilan.json. Usage : node outils/serveur-test-lien.js <dossier>
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createLink } = require('../lien')

const dir = process.argv[2]
fs.mkdirSync(dir, { recursive: true })
const inbox = path.join(dir, 'recus')
let saved = null
const bilan = { associe: false, presse: '', source: '', etat: null, signal: '', recu: null }
const link = createLink({
  store: { load: () => saved, save: s => { saved = s } },
  inbox, pcName: 'PC-TEST-JAVA', host: '127.0.0.1', port: 0, udpPort: 0,
  api: async (nom, donnees) => {
    bilan.api = nom
    if (!donnees.texte) throw new Error('message vide')
    return { texte: donnees.texte }
  },
  onEvent: e => {
    if (e.type === 'paired') {
      bilan.associe = true
      link.sendClipboard({ texte: 'Bonjour depuis le PC (é ☁)' })
      link.sendFile(source)
    }
    if (e.type === 'clipboard') {
      bilan.presse = e.texte
      bilan.source = e.source
    }
    if (e.type === 'state') bilan.etat = e.device.etat
    if (e.type === 'signal') bilan.signal = e.signal
    // Association par le Wi-Fi : le code du PC (comparé à celui du téléphone Java), puis « Accepter »
    if (e.type === 'pair-request') {
      bilan.code = e.demande.code
      setTimeout(() => link.acceptPairing(e.demande.id), 300)
    }
    if (e.type === 'incoming' && e.phase === 'done') {
      bilan.recu = { nom: e.nom, sha256: crypto.createHash('sha256').update(fs.readFileSync(e.chemin)).digest('hex') }
    }
    fs.writeFileSync(path.join(dir, 'bilan.json'), JSON.stringify(bilan))
  },
})
const source = path.join(dir, 'a-envoyer.bin')
const data = crypto.randomBytes(1024 * 1024 + 4321)
fs.writeFileSync(source, data)
fs.writeFileSync(path.join(dir, 'envoye.sha256'), crypto.createHash('sha256').update(data).digest('hex'))

link.start().then(async () => {
  for (let i = 0; i < 50 && !link.discoveryPort(); i++) await new Promise(r => setTimeout(r, 50))
  fs.writeFileSync(path.join(dir, 'udp.txt'), String(link.discoveryPort()))
  fs.writeFileSync(path.join(dir, 'qr.txt'), link.pairingPayload(['127.0.0.1']))
  console.log('serveur de test prêt')
})
setTimeout(() => process.exit(0), 10 * 60_000) // garde-fou

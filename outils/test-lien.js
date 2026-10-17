// Test du lien PC ↔ téléphone : un faux téléphone (en Node, sur 127.0.0.1) s'associe, échange le
// presse-papiers, envoie et reçoit des fichiers ; mauvaise clé et rejeu refusés. Aucun réseau extérieur.
// Usage : node outils/test-lien.js
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const dgram = require('node:dgram')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createLink, seal, open, fromB64url, CHUNK } = require('../lien')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-lien-'))
const inbox = path.join(dir, 'recus')
let saved = null
const events = []
let skew = 0 // horloge avancée pour vérifier le nettoyage des transferts abandonnés
const apiCalls = []
const link = createLink({
  store: { load: () => saved, save: s => { saved = JSON.parse(JSON.stringify(s)) } },
  inbox, pcName: 'PC-TEST', host: '127.0.0.1', port: 0, udpPort: 0, wakePort: 47926, onEvent: e => events.push(e), now: () => Date.now() + skew,
  api: async (nom, donnees, device) => {
    apiCalls.push({ nom, donnees, device: device.id })
    if (nom === 'chat-envoyer' && !donnees.texte) throw new Error('message vide')
    return { recu: nom, texte: donnees.texte || '' }
  },
})
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

// Faux téléphone : même protocole que nuage-mobile (LienProtocole.java)
function phone(payload, { id = 'telephone-test', badKey = false } = {}) {
  const info = JSON.parse(payload.replace(/^NUAGE1:/, ''))
  const key = badKey ? crypto.randomBytes(32) : fromB64url(info.k)
  const base = `http://127.0.0.1:${info.p}`
  async function call(method, route, body, raw = false) {
    const headers = { 'X-Nuage-Appareil': id }
    let data
    if (method === 'POST') {
      const plain = raw ? body : Buffer.from(JSON.stringify({ ...body, t: Date.now(), n: crypto.randomBytes(12).toString('hex') }))
      data = seal(key, plain, `POST ${route}`)
    }
    const res = await fetch(base + route, { method, headers, body: data })
    if (!res.ok) return { status: res.status }
    const bytes = open(key, Buffer.from(await res.arrayBuffer()), `REP ${method} ${route}`)
    return { status: res.status, body: raw || method === 'GET' ? bytes : JSON.parse(bytes.toString('utf8')) }
  }
  return { info, key, call }
}

;(async () => {
  await link.start()
  const payload = link.pairingPayload(['127.0.0.1'])
  assert.match(payload, /^NUAGE1:\{/)
  const p = phone(payload)
  assert.equal(p.info.n, 'PC-TEST')

  // 1. Association
  const hello = await p.call('POST', '/v1/bonjour', { appareil: { id: 'telephone-test', nom: 'Pixel de test', modele: 'Pixel 9' } })
  assert.equal(hello.status, 200)
  assert.equal(hello.body.pc.nom, 'PC-TEST')
  assert.equal(events.at(-1).type, 'paired')
  assert.equal(link.devices()[0].nom, 'Pixel de test')
  assert.equal(link.devices()[0].online, true)

  // 2. Mauvaise clé, rejeu, appareil inconnu : refusés
  const intrus = phone(payload, { badKey: true })
  assert.equal((await intrus.call('POST', '/v1/boite', {})).status, 401)
  const plain = Buffer.from(JSON.stringify({ t: Date.now(), n: 'nonce-fixe', attente: 0 }))
  const box = seal(p.key, plain, 'POST /v1/boite')
  const send = () => fetch(`http://127.0.0.1:${p.info.p}/v1/boite`, { method: 'POST', headers: { 'X-Nuage-Appareil': 'telephone-test' }, body: box })
  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 409, 'rejeu refusé')
  assert.equal((await phone(payload, { id: 'inconnu' }).call('POST', '/v1/boite', {})).status, 403)
  // Les refus sont signalés (menu Téléphone : « ancien QR code », « téléphone oublié »)
  assert.ok(events.some(e => e.type === 'refus' && e.raison === 'cle' && e.adresse === '127.0.0.1'), 'refus pour mauvaise clé signalé')
  assert.ok(events.some(e => e.type === 'refus' && e.raison === 'inconnu'), 'refus pour téléphone oublié signalé')

  // 3. Presse-papiers PC → téléphone (seul le dernier compte), accusé de réception
  link.sendClipboard({ texte: 'premier' })
  link.sendClipboard({ texte: 'Bonjour depuis le PC ☁' })
  let mail = await p.call('POST', '/v1/boite', { attente: 0 })
  assert.equal(mail.body.elements.length, 1)
  assert.ok(Array.isArray(mail.body.pc.adresses), 'le PC donne ses adresses à chaque relève')
  assert.equal(link.devices()[0].adresse, '127.0.0.1')
  assert.equal(mail.body.elements[0].texte, 'Bonjour depuis le PC ☁')
  mail = await p.call('POST', '/v1/boite', { attente: 0, vus: [mail.body.elements[0].id] })
  assert.equal(mail.body.elements.length, 0, 'accusé de réception pris en compte')

  // 4. Attente longue : une notification arrive pendant que le téléphone attend
  const t0 = Date.now()
  setTimeout(() => link.notify({ titre: 'Claude a fini', texte: 'nuage-bureau', genre: 'claude' }), 300)
  mail = await p.call('POST', '/v1/boite', { attente: 5000 })
  assert.equal(mail.body.elements[0].titre, 'Claude a fini')
  assert.ok(Date.now() - t0 < 2000, 'réponse dès l’arrivée')
  await p.call('POST', '/v1/boite', { attente: 0, vus: [mail.body.elements[0].id] })

  // 4 bis. Courrier pas relevé 1,5 s plus tard (attente longue morte) : annoncé au téléphone par UDP ; relevé à temps : rien
  const annonces = []
  const reveil = dgram.createSocket('udp4')
  reveil.on('message', m => annonces.push(String(m)))
  await new Promise(resolve => reveil.bind(47926, '127.0.0.1', resolve))
  link.sendClipboard({ texte: 'annoncé' })
  await new Promise(resolve => setTimeout(resolve, 1900))
  assert.deepEqual(annonces, [`NUAGE-COURRIER ${p.info.id}`])
  mail = await p.call('POST', '/v1/boite', { attente: 0 })
  await p.call('POST', '/v1/boite', { attente: 0, vus: mail.body.elements.map(e => e.id) })
  link.sendClipboard({ texte: 'relevé tout de suite' })
  mail = await p.call('POST', '/v1/boite', { attente: 0 })
  await p.call('POST', '/v1/boite', { attente: 0, vus: mail.body.elements.map(e => e.id) })
  await new Promise(resolve => setTimeout(resolve, 1800))
  assert.equal(annonces.length, 1, 'relevé à temps : pas d’annonce')
  reveil.close()

  // 5. Presse-papiers téléphone → PC (copie automatique : la source suit)
  assert.equal((await p.call('POST', '/v1/presse-papiers', { texte: 'copié sur le téléphone', source: 'auto' })).status, 200)
  assert.equal(events.at(-1).type, 'clipboard')
  assert.equal(events.at(-1).texte, 'copié sur le téléphone')
  assert.equal(events.at(-1).source, 'auto')

  // 5 bis. État du téléphone à la relève (batterie, version…), nettoyé ; un événement seulement s'il change
  const etat = { batterie: 82.4, charge: true, version: '1.1.0', android: '14', auto: 'actif', bulle: false, intrus: 'x'.repeat(5000) }
  await p.call('POST', '/v1/boite', { attente: 0, etat })
  assert.deepEqual(link.devices()[0].etat, { batterie: 82, charge: true, version: '1.1.0', android: '14', auto: 'actif', bulle: false, chat: false })
  assert.equal(events.at(-1).type, 'state')
  const count = events.length
  await p.call('POST', '/v1/boite', { attente: 0, etat })
  assert.equal(events.length, count, 'même état : pas de nouvel événement')
  await p.call('POST', '/v1/boite', { attente: 0, etat: { ...etat, auto: 'pirate' } })
  assert.equal(link.devices()[0].etat.auto, 'inactif', 'valeur inconnue refusée')
  // Branché / débranché : signalé tout de suite (/v1/etat), sans attendre la relève
  assert.equal((await p.call('POST', '/v1/etat', { etat: { ...etat, batterie: 13, charge: false } })).status, 200)
  assert.equal(link.devices()[0].etat.charge, false)
  assert.equal(events.at(-1).type, 'state')
  assert.equal((await p.call('POST', '/v1/etat', {})).status, 400)

  // 5 ter. Coucou du téléphone ; signal inconnu refusé
  assert.equal((await p.call('POST', '/v1/signal', { signal: 'coucou' })).status, 200)
  assert.equal(events.at(-1).type, 'signal')
  assert.equal(events.at(-1).signal, 'coucou')
  assert.equal((await p.call('POST', '/v1/signal', { signal: 'formater' })).status, 400)

  // 5 quater. Faire sonner puis arrêter : seul le dernier ordre reste dans la boîte
  link.ring()
  link.ring(false)
  mail = await p.call('POST', '/v1/boite', { attente: 0 })
  assert.deepEqual(mail.body.elements.map(e => e.type), ['sonner-stop'])
  await p.call('POST', '/v1/boite', { attente: 0, vus: mail.body.elements.map(e => e.id) })

  // 5 quinquies. Chat du téléphone : demandes /v1/api/<nom> traitées par main.js, erreurs renvoyées en clair
  let r = await p.call('POST', '/v1/api/chat-envoyer', { donnees: { texte: 'Bonjour Claude' } })
  assert.deepEqual(r.body, { ok: true, resultat: { recu: 'chat-envoyer', texte: 'Bonjour Claude' } })
  assert.equal(apiCalls.at(-1).device, 'telephone-test')
  r = await p.call('POST', '/v1/api/chat-envoyer', { donnees: {} })
  assert.deepEqual(r.body, { ok: false, erreur: 'message vide' })
  // L'état du chat ne s'empile pas : seul le dernier reste dans la boîte
  link.sendChatState('telephone-test', { messages: 1 })
  link.sendChatState('telephone-test', { messages: 2 })
  mail = await p.call('POST', '/v1/boite', { attente: 0 })
  assert.deepEqual(mail.body.elements.map(e => [e.type, e.etat.messages]), [['chat', 2]])
  await p.call('POST', '/v1/boite', { attente: 0, vus: mail.body.elements.map(e => e.id) })

  // 5 sexies. Découverte sur le Wi-Fi : le PC répond à son identifiant, et seulement à lui
  const probe = dgram.createSocket('udp4')
  const answer = new Promise(resolve => probe.once('message', m => resolve(m.toString())))
  probe.send(`NUAGE-OU autre-pc`, link.discoveryPort(), '127.0.0.1')
  probe.send(`NUAGE-OU ${p.info.id}`, link.discoveryPort(), '127.0.0.1')
  assert.equal(await answer, `NUAGE-ICI ${p.info.id} ${p.info.p}`)
  // Recherche ouverte (téléphone pas encore associé) : le PC donne aussi son nom
  const open2 = new Promise(resolve => probe.once('message', m => resolve(m.toString())))
  probe.send('NUAGE-OU *', link.discoveryPort(), '127.0.0.1')
  assert.equal(await open2, `NUAGE-ICI ${p.info.id} ${p.info.p} PC-TEST`)
  // v1.8 : le PC note chaque recherche reçue (journal), et prévient l'interface (au plus une fois toutes les 3 s)
  const searched = events.filter(e => e.type === 'recherche')
  assert.equal(searched.length, 1, 'un seul événement « recherche » par rafale')
  assert.equal(searched[0].adresse, '127.0.0.1')
  assert.equal(link.lastSearch().adresse, '127.0.0.1')
  const udpTraces = link.traces().filter(t => t.type === 'udp')
  assert.deepEqual(udpTraces.map(t => [t.quoi, t.repond]), [['un autre PC', false], ['ce PC', true], ['tous les PC', true]])
  assert.ok(udpTraces.every(t => /^127\.0\.0\.1:\d+$/.test(t.de)), 'adresse et port de l’expéditeur notés')
  // v1.8 : une réponse impossible (adresse inaccessible) ne tue plus la découverte (avant : socket fermé pour toujours)
  probe.send('NUAGE-OU *', link.discoveryPort(), '127.0.0.1') // répond normalement
  await new Promise(resolve => probe.once('message', resolve))
  const hostile = dgram.createSocket('udp4')
  hostile.send('NUAGE-OU *', link.discoveryPort(), '127.0.0.1', () => hostile.close()) // port source fermé aussitôt : réponse sans destinataire
  await new Promise(resolve => setTimeout(resolve, 250))
  const probe2 = dgram.createSocket('udp4')
  const stillAnswers = new Promise(resolve => probe2.once('message', m => resolve(m.toString())))
  probe2.send('NUAGE-OU *', link.discoveryPort(), '127.0.0.1')
  assert.equal(await stillAnswers, `NUAGE-ICI ${p.info.id} ${p.info.p} PC-TEST`, 'la découverte répond encore après une réponse sans destinataire')
  probe2.close()
  // v1.8 : les requêtes HTTP sont notées sans identifiant ni contenu
  await fetch(`http://127.0.0.1:${p.info.p}/v1/inconnu/123e4567-e89b-12d3-a456-426614174000`)
  const httpTrace = link.traces().filter(t => t.type === 'http').at(-1)
  assert.equal(httpTrace.requete, 'GET /v1/inconnu/:id')
  assert.equal(httpTrace.de, '127.0.0.1')
  probe.close()

  // 5 septies. Association par le Wi-Fi, sans QR code (06/10/2026) : demande, même code des deux côtés,
  // accord sur le PC, clé du lien reçue chiffrée par la clé commune, puis le téléphone se présente
  const { pairCode, pairKey } = require('../lien')
  const base = `http://127.0.0.1:${p.info.p}`
  const tel = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pubTel = tel.publicKey.export({ type: 'spki', format: 'der' })
  const ask = () => fetch(`${base}/v1/appairage`, { method: 'POST', body: JSON.stringify({ appareil: { id: 'telephone-wifi', nom: 'Pixel Wi-Fi', modele: 'Pixel 7 Pro' }, pub: pubTel.toString('base64') }) })
  let rp = await ask()
  assert.equal(rp.status, 200)
  const demande = await rp.json()
  const pubPc = Buffer.from(demande.pub, 'base64')
  const request = events.findLast(e => e.type === 'pair-request')
  assert.equal(request.demande.nom, 'Pixel Wi-Fi')
  assert.equal(request.demande.code, pairCode(pubTel, pubPc), 'même code sur le PC et le téléphone')
  assert.equal((await ask()).status, 429, 'une demande toutes les 10 s au plus')
  setTimeout(() => assert.equal(link.acceptPairing(demande.demande), true), 150)
  r = await fetch(`${base}/v1/appairage/${demande.demande}`) // attente longue jusqu'à l'accord
  const accord = await r.json()
  assert.equal(accord.statut, 'accepte')
  const commune = pairKey(crypto.diffieHellman({ privateKey: tel.privateKey, publicKey: crypto.createPublicKey({ key: pubPc, format: 'der', type: 'spki' }) }), pubTel, pubPc)
  const recu = JSON.parse(open(commune, Buffer.from(accord.boite, 'base64'), 'NUAGE-APPAIRAGE').toString('utf8'))
  assert.equal(recu.k, p.info.k, 'la clé du lien est bien arrivée')
  assert.equal(recu.id, p.info.id)
  const pw = phone(`NUAGE1:${JSON.stringify({ ...recu, p: p.info.p })}`, { id: 'telephone-wifi' })
  assert.equal((await pw.call('POST', '/v1/bonjour', { appareil: { id: 'telephone-wifi', nom: 'Pixel Wi-Fi', modele: 'Pixel 7 Pro' } })).status, 200)
  assert.ok(link.devices().some(d => d.id === 'telephone-wifi'))
  // Refus sur le PC, puis demande oubliée : expirée au bout de 2 min
  skew = 11_000
  r = await ask()
  const refusee = await r.json()
  link.refusePairing(refusee.demande)
  assert.equal((await (await fetch(`${base}/v1/appairage/${refusee.demande}`)).json()).statut, 'refuse')
  skew = 22_000
  const oubliee = await (await ask()).json()
  skew = 22_000 + 130_000
  assert.equal((await (await fetch(`${base}/v1/appairage/${oubliee.demande}`)).json()).statut, 'expire')
  assert.equal(link.acceptPairing(oubliee.demande), false, 'trop tard pour accepter')
  skew = 0

  // 6. Fichier téléphone → PC (2,5 Mo, 3 morceaux), nom déjà pris → « (1) »
  fs.mkdirSync(inbox, { recursive: true })
  fs.writeFileSync(path.join(inbox, 'photo.jpg'), 'ancien')
  const data = crypto.randomBytes(Math.round(CHUNK * 2.5))
  const start = await p.call('POST', '/v1/fichier/debut', { nom: 'photo.jpg', taille: data.length, type: 'image/jpeg' })
  assert.equal(start.status, 200)
  for (let i = 0; i * CHUNK < data.length; i++) {
    const r = await p.call('POST', `/v1/fichier/${start.body.id}/${i}`, data.subarray(i * CHUNK, (i + 1) * CHUNK), true)
    assert.equal(r.status, 200)
  }
  const end = await p.call('POST', `/v1/fichier/${start.body.id}/fin`, {})
  assert.equal(end.body.nom, 'photo (1).jpg')
  assert.equal(sha(fs.readFileSync(path.join(inbox, 'photo (1).jpg'))), sha(data))
  assert.equal(events.filter(e => e.type === 'incoming' && e.phase === 'done').length, 1)

  // 6 bis. Morceau hors du fichier refusé ; envoi coupé (téléphone parti) nettoyé au bout de 2 min,
  // et il ne bloque plus les envois suivants (avant : 3 coupures = plus aucun envoi possible)
  for (let n = 0; n < 3; n++) {
    const s = await p.call('POST', '/v1/fichier/debut', { nom: `coupe-${n}.bin`, taille: CHUNK * 2, type: '' })
    assert.equal(s.status, 200)
    if (n === 0) assert.equal((await p.call('POST', `/v1/fichier/${s.body.id}/5`, crypto.randomBytes(CHUNK), true)).status, 400)
  }
  assert.equal((await p.call('POST', '/v1/fichier/debut', { nom: 'refuse.bin', taille: 10, type: '' })).status, 429)
  assert.equal(fs.readdirSync(inbox).filter(f => f.endsWith('.nuage-part')).length, 3)
  skew = 3 * 60_000
  link.sweep()
  assert.equal(fs.readdirSync(inbox).filter(f => f.endsWith('.nuage-part')).length, 0, 'restes effacés')
  assert.equal(events.filter(e => e.type === 'incoming' && e.phase === 'cancel').length, 3)
  assert.equal((await p.call('POST', '/v1/fichier/debut', { nom: 'apres.bin', taille: 10, type: '' })).status, 200, 'les envois repartent')
  skew = 0

  // 7. Fichier PC → téléphone : annoncé dans la boîte, téléchargé par morceaux, accusé → terminé
  const source = path.join(dir, 'rapport.pdf')
  const pdf = crypto.randomBytes(CHUNK + 1234)
  fs.writeFileSync(source, pdf)
  link.sendFile(source)
  mail = await p.call('POST', '/v1/boite', { attente: 0 })
  const item = mail.body.elements.find(e => e.type === 'fichier')
  assert.equal(item.nom, 'rapport.pdf')
  const parts = []
  for (let i = 0; i < item.morceaux; i++) parts.push((await p.call('GET', `/v1/envoi/${item.transfert}/${i}`)).body)
  assert.equal(sha(Buffer.concat(parts)), sha(pdf))
  await p.call('POST', '/v1/boite', { attente: 0, vus: [item.id] })
  assert.ok(events.some(e => e.type === 'outgoing' && e.phase === 'done'))

  // 8. Oublier les téléphones : nouvelle clé, l'ancienne ne marche plus
  link.forget()
  assert.equal((await p.call('POST', '/v1/boite', {})).status, 401)

  link.stop()
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('test-lien : OK (association, refus, presse-papiers, attente longue, courrier annoncé par UDP, état du téléphone, coucou, sonnerie, chat, découverte, association par le Wi-Fi, fichiers dans les deux sens, envois coupés nettoyés, oubli)')
})().catch(error => {
  link.stop()
  fs.rmSync(dir, { recursive: true, force: true })
  console.error('ÉCHEC :', error.stack || error.message)
  process.exit(1)
})

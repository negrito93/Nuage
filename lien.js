// Lien PC ↔ téléphone (demande du 04/10/2026) : fichiers dans les deux sens, copier-coller et
// notifications vers l'application Android « Nuage de poche ».
// - Réseau local seulement (Wi-Fi) : serveur HTTP sur le port 47824, ouvert quand le lien est activé.
//   Rien ne passe par Internet.
// - Association par QR code : il contient la clé (32 octets) et les adresses du PC. Chaque message est
//   chiffré et authentifié (AES-256-GCM, données associées = méthode + chemin) : sans la clé, on ne
//   peut ni lire ni envoyer. Messages JSON : horodatage + nonce (rejeu refusé).
// - Le téléphone vient chercher son courrier (« boîte », attente longue de 25 s) : presse-papiers,
//   fichiers à télécharger par morceaux de 1 Mo, notifications, « fais sonner le téléphone ». Il dépose
//   ses fichiers de la même façon. À chaque relève, il donne son état (batterie, version, chat ouvert),
//   gardé en mémoire seulement : c'est ce qu'affiche le menu Téléphone de la barre du haut.
// - Chat du téléphone (05/10/2026) : routes /v1/api/<nom> (chiffrées comme le reste), traitées par main.js
//   (le chat de Nuage et ton abonnement Claude) ; l'état du chat revient par la boîte (élément « chat »).
// - Découverte : si l'adresse du PC change (box), le téléphone le retrouve par une diffusion UDP sur le
//   Wi-Fi (« NUAGE-OU <id du PC> » → « NUAGE-ICI <id> <port> », rien de secret dans ces messages).
// - Association par le Wi-Fi, sans QR code (06/10/2026 : « connecter automatiquement le PC au téléphone dès
//   qu'ils sont sur le même réseau ») : « NUAGE-OU * » → « NUAGE-ICI <id> <port> <nom> » ; le téléphone
//   demande (/v1/appairage, clé publique ECDH P-256), le PC montre « X veut se connecter » avec un code à
//   6 chiffres (empreinte des deux clés, le même s'affiche sur le téléphone) ; l'utilisateur accepte et la
//   clé du lien part chiffrée par la clé commune (ECDH + HKDF-SHA256 + AES-256-GCM) : rien de lisible sur
//   le Wi-Fi, et un intrus au milieu changerait le code. Une demande à la fois, 2 min au plus.
// - Courrier annoncé (08/10/2026 : « le copier-coller doit être instantané dès que le PC est connecté au mobile ») :
//   l'attente longue peut mourir sans bruit (Wi-Fi en économie d'énergie, veille) et le téléphone ne s'en
//   apercevait qu'au bout de 35 s. Un élément pas relevé 1,5 s après son arrivée est donc annoncé par un paquet
//   UDP « NUAGE-COURRIER <id du PC> » (rien de secret) vers le port 47825 du téléphone, qui relève aussitôt.
// Le protocole est reproduit à l'identique par nuage-mobile (LienProtocole.java) ; test : outils/test-lien.js.
const http = require('node:http')
const dgram = require('node:dgram')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PORT = 47824
const CHUNK = 1024 * 1024
const MAX_FILE = 4 * 1024 ** 3
const MAX_JSON = 12 * 1024 * 1024 // une image copiée, en base64
const SKEW_MS = 10 * 60_000
const WAIT_MS = 25_000
const ONLINE_MS = 60_000
const STALE_IN_MS = 2 * 60_000 // envoi du téléphone sans nouveau morceau depuis 2 min : abandonné
const STALE_OUT_MS = 24 * 3600_000 // fichier pour le téléphone jamais téléchargé en 24 h : abandonné
const APK_NAME = 'nuage-de-poche.apk'
const PAIR_TTL_MS = 2 * 60_000 // une demande d'association par le Wi-Fi attend 2 min au plus
const PAIR_INFO = 'nuage-appairage-v1'
const WAKE_PORT = 47825 // le téléphone y attend l'annonce du courrier (LienService.java)
const WAKE_AFTER_MS = 1500

// Code à 6 chiffres montré des deux côtés : empreinte des deux clés publiques (SPKI DER)
function pairCode(pubTel, pubPc) {
  const h = crypto.createHash('sha256').update(pubTel).update(pubPc).digest()
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
// Clé commune de l'association : ECDH P-256, puis HKDF-SHA256 (sel = empreinte des deux clés publiques)
function pairKey(shared, pubTel, pubPc) {
  const salt = crypto.createHash('sha256').update(pubTel).update(pubPc).digest()
  return Buffer.from(crypto.hkdfSync('sha256', shared, salt, PAIR_INFO, 32))
}

// ---------- Chiffrement : IV (12 octets) | texte chiffré | étiquette (16 octets) ----------
function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()])
}
function open(key, box, aad) {
  if (!Buffer.isBuffer(box) || box.length < 28) throw new Error('message trop court')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, box.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(box.subarray(box.length - 16))
  return Buffer.concat([decipher.update(box.subarray(12, box.length - 16)), decipher.final()])
}
const b64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = text => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

// Adresses IPv4 du PC sur le réseau local (Wi-Fi, Ethernet), cartes virtuelles en dernier
function lanDetails() {
  const list = []
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const a of addresses || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      const virtual = /vethernet|virtual|vmware|vbox|hyper-v|wsl|loopback|tailscale|zerotier/i.test(name)
      const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      list.push({ address: a.address, card: name, score: (lan ? 2 : 0) + (virtual ? 0 : 1) })
    }
  }
  return list.sort((x, y) => y.score - x.score)
}
const lanAddresses = () => lanDetails().map(x => x.address)

// Nom libre pour un fichier reçu : « photo.jpg », puis « photo (1).jpg »…
function freeName(folder, name) {
  const safe = path.basename(String(name || 'fichier')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'fichier'
  const ext = path.extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let candidate = safe
  for (let i = 1; fs.existsSync(path.join(folder, candidate)); i++) candidate = `${stem} (${i})${ext}`
  return path.join(folder, candidate)
}

// store : { load() → état | null, save(état) } (clé gardée chiffrée par Windows dans main.js)
// api(nom, données, appareil) : demandes du téléphone traitées par main.js (chat) ; renvoie un objet ou lève
// une erreur dont le message est montré sur le téléphone. udpPort : découverte (0 : choisi par le système).
// extra() : ce que le PC ajoute à chaque relève (sa météo : le téléphone prend la même, voir main.js)
function createLink({ store, inbox, pcName = os.hostname(), onEvent = () => {}, onTrace = () => {}, log = () => {}, port = PORT, udpPort = PORT, wakePort = WAKE_PORT, host = '0.0.0.0', now = Date.now, api = null, extra = () => ({}) }) {
  let state = store.load() || null
  const queues = new Map() // appareil → éléments en attente
  const waiters = new Map() // appareil → réponse en attente (attente longue)
  const seen = new Map() // nonces déjà vus → heure
  const incoming = new Map() // transferts téléphone → PC
  const outgoing = new Map() // transferts PC → téléphone
  const live = new Map() // appareil → état donné à la dernière relève (en mémoire seulement)
  let server = null
  let udp = null
  let sweeper = null
  let apk = null // { file, until } : APK proposé au téléchargement (sans clé), pour 15 min au plus

  function ensureState() {
    if (!state?.key) {
      state = { pcId: crypto.randomUUID(), key: b64url(crypto.randomBytes(32)), devices: [] }
      store.save(state)
    }
    return state
  }
  const key = () => fromB64url(ensureState().key)
  const deviceOf = id => state?.devices.find(d => d.id === id)
  const emit = event => {
    try {
      onEvent(event)
    } catch (error) {
      log('lien, événement :', error.message)
    }
  }

  // ---------- Journal de ce qui arrive du téléphone (v1.8, 06/10/2026) ----------
  // « Je reste bloqué : le téléphone ne trouve pas le PC. » Sans trace côté PC, impossible de savoir si ses
  // paquets arrivent (pare-feu, routeur qui isole, autre réseau). Chaque recherche UDP et chaque requête
  // (adresse, méthode, chemin sans identifiant, statut) est notée : jamais de contenu, 80 entrées en mémoire.
  const traces = []
  let lastSearch = null // { adresse, at } : dernière recherche « NUAGE-OU » reçue
  const searchSeen = new Map() // adresse → dernier événement « recherche » envoyé (au plus un toutes les 3 s)
  function trace(entry) {
    const full = { at: now(), ...entry }
    traces.push(full)
    if (traces.length > 80) traces.splice(0, traces.length - 80)
    try {
      onTrace(full)
    } catch (error) {
      log('lien, journal :', error.message)
    }
  }
  const cleanPath = url => String(url || '').split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+$/, '/:n').slice(0, 80)

  // ---------- File d'attente de chaque téléphone ----------
  function queueFor(id) {
    if (!queues.has(id)) queues.set(id, [])
    return queues.get(id)
  }
  // Presse-papiers, sonnerie, état du chat : seul le dernier compte (« sonner » et « arrêter » s'annulent)
  const FAMILY = { 'presse-papiers': 'presse-papiers', sonner: 'sonner', 'sonner-stop': 'sonner', chat: 'chat', agents: 'agents' }
  function push(item, only = null) {
    const targets = (state?.devices || []).filter(d => !only || d.id === only)
    for (const d of targets) {
      const q = queueFor(d.id)
      const family = FAMILY[item.type]
      if (family) for (let i = q.length - 1; i >= 0; i--) if (FAMILY[q[i].type] === family) q.splice(i, 1)
      const entry = { id: crypto.randomUUID(), at: now(), ...item }
      q.push(entry)
      if (q.length > 200) q.splice(0, q.length - 200)
      wake(d.id)
      announce(d.id, entry.id)
    }
    return targets.length
  }
  // Pas relevé 1,5 s plus tard (attente longue morte, téléphone qui patiente entre deux essais) : annoncé par UDP
  function announce(id, itemId) {
    setTimeout(() => {
      const adresse = live.get(id)?.adresse
      if (!udp || !adresse || !state?.pcId || !queueFor(id).some(q => q.id === itemId)) return
      udp.send(Buffer.from(`NUAGE-COURRIER ${state.pcId}`), wakePort, adresse, error => {
        trace({ type: 'reveil', vers: adresse, ...(error ? { erreur: error.message } : {}) })
      })
    }, WAKE_AFTER_MS).unref?.()
  }
  // État du téléphone (batterie, version, copier-coller automatique…), nettoyé : rien d'autre n'est gardé
  function cleanState(raw) {
    const level = Number(raw.batterie)
    return {
      batterie: raw.batterie !== null && raw.batterie !== undefined && Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : null,
      charge: raw.charge === true,
      version: String(raw.version || '').slice(0, 20),
      android: String(raw.android || '').slice(0, 10),
      auto: ['actif', 'a-ouvrir', 'inactif'].includes(raw.auto) ? raw.auto : 'inactif',
      bulle: raw.bulle === true,
      chat: raw.chat === true,
    }
  }
  function updateLive(device, raw) {
    const etat = cleanState(raw)
    const previous = live.get(device.id) || {}
    live.set(device.id, { ...previous, etat, at: now() })
    if (JSON.stringify(previous.etat) !== JSON.stringify(etat)) emit({ type: 'state', device: { ...device, etat } })
  }
  const clientAddress = req => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  // Un téléphone frappe à la porte mais est refusé (clé d'un ancien QR code, téléphone oublié, horloge
  // déréglée) : signalé au menu Téléphone pour dire quoi faire, au plus une fois par minute et par adresse
  const refusals = new Map()
  function refuse(req, raison) {
    const adresse = clientAddress(req)
    const key = `${adresse}|${raison}`
    if (now() - (refusals.get(key) || 0) < 60_000) return
    refusals.set(key, now())
    emit({ type: 'refus', raison, adresse, at: now() })
  }
  function wake(id) {
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    clearTimeout(waiter.timer)
    waiter.flush()
  }

  // ---------- Réponses ----------
  function reply(res, req, status, body) {
    const plain = Buffer.from(JSON.stringify(body || {}), 'utf8')
    const box = seal(key(), plain, `REP ${req.method} ${req.pathname}`)
    res.writeHead(status, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(box)
  }
  function fail(res, status) {
    res.writeHead(status, { 'Content-Type': 'text/plain' })
    res.end()
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > limit) {
          reject(Object.assign(new Error('trop gros'), { status: 413 }))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }
  // Message JSON : déchiffré, horodatage récent, nonce jamais vu
  function readMessage(req, body) {
    let message
    try {
      message = JSON.parse(open(key(), body, `${req.method} ${req.pathname}`).toString('utf8'))
    } catch {
      throw Object.assign(new Error('clé incorrecte'), { status: 401 })
    }
    const t = now()
    if (typeof message.t !== 'number' || Math.abs(t - message.t) > SKEW_MS) throw Object.assign(new Error('horloge'), { status: 401 })
    if (typeof message.n !== 'string' || seen.has(message.n)) throw Object.assign(new Error('rejeu'), { status: 409 })
    seen.set(message.n, t)
    if (seen.size > 5000) for (const [n, at] of seen) if (t - at > SKEW_MS) seen.delete(n)
    return message
  }

  // ---------- Association par le Wi-Fi (sans QR code) ----------
  let pairing = null // une seule demande à la fois
  const pairTries = new Map() // adresse → dernière demande (une toutes les 10 s au plus)
  function settlePairing(statut) {
    const p = pairing
    if (!p || p.statut !== 'attente') return false
    p.statut = statut
    for (const w of p.waiters.splice(0)) w()
    setTimeout(() => {
      if (pairing === p) pairing = null
    }, 30_000).unref?.()
    return true
  }
  function pairAnswer(p) {
    if (p.statut !== 'accepte') return { statut: p.statut }
    const s = ensureState()
    const shared = crypto.diffieHellman({ privateKey: p.keys.privateKey, publicKey: p.pubTelKey })
    const info = { id: s.pcId, k: s.key, h: lanAddresses(), p: server?.address()?.port || port, n: pcName }
    const boite = seal(pairKey(shared, p.pubTel, p.pubPc), Buffer.from(JSON.stringify(info), 'utf8'), 'NUAGE-APPAIRAGE')
    return { statut: 'accepte', boite: boite.toString('base64') }
  }
  async function pairRoute(req, res, parts) {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (pairing?.statut === 'attente' && now() - pairing.at > PAIR_TTL_MS) settlePairing('expire')
    if (req.method === 'POST' && parts.length === 2) {
      const ip = clientAddress(req)
      if (now() - (pairTries.get(ip) || 0) < 10_000) return json(429, { erreur: 'Patiente quelques secondes avant de redemander.' })
      pairTries.set(ip, now())
      if (pairing?.statut === 'attente') return json(409, { erreur: 'Une autre demande attend déjà une réponse sur le PC.' })
      let body
      try {
        body = JSON.parse((await readBody(req, 8192)).toString('utf8'))
      } catch {
        return json(400, { erreur: 'Demande illisible.' })
      }
      const a = body?.appareil || {}
      const id = String(a.id || '').slice(0, 64)
      const pubTel = Buffer.from(String(body?.pub || ''), 'base64')
      let pubTelKey
      try {
        pubTelKey = crypto.createPublicKey({ key: pubTel, format: 'der', type: 'spki' })
        if (pubTelKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('courbe')
      } catch {
        return json(400, { erreur: 'Clé du téléphone illisible.' })
      }
      if (!id) return json(400, { erreur: 'Téléphone sans identifiant.' })
      const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      const pubPc = keys.publicKey.export({ type: 'spki', format: 'der' })
      pairing = {
        id: crypto.randomUUID(), at: now(), statut: 'attente', waiters: [], ip,
        appareil: { id, nom: String(a.nom || 'Téléphone').slice(0, 60), modele: String(a.modele || '').slice(0, 60) },
        pubTel, pubTelKey, keys, pubPc, code: pairCode(pubTel, pubPc),
      }
      emit({ type: 'pair-request', demande: { id: pairing.id, nom: pairing.appareil.nom, modele: pairing.appareil.modele, code: pairing.code, adresse: ip } })
      return json(200, { demande: pairing.id, pub: pubPc.toString('base64'), pc: { nom: pcName } })
    }
    if (req.method === 'GET' && parts.length === 3) {
      const p = pairing
      if (!p || p.id !== parts[2]) return json(404, { statut: 'inconnue' })
      if (p.statut === 'attente') {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, WAIT_MS)
          const done = () => {
            clearTimeout(timer)
            resolve()
          }
          p.waiters.push(done)
          req.on('close', done)
        })
      }
      if (p.statut === 'attente' && now() - p.at > PAIR_TTL_MS) settlePairing('expire')
      if (res.writableEnded || res.destroyed) return
      return json(200, pairAnswer(p))
    }
    return fail(res, 405)
  }

  // ---------- Routes ----------
  async function route(req, res) {
    const url = new URL(req.url, 'http://nuage')
    req.pathname = url.pathname
    const deviceId = String(req.headers['x-nuage-appareil'] || '')
    const parts = url.pathname.split('/').filter(Boolean)
    // Installation de l'application : le fichier APK, seulement pendant que son QR code « Installer » est proposé
    if (req.method === 'GET' && url.pathname === `/${APK_NAME}` && apk && now() < apk.until) {
      const stat = fs.statSync(apk.file)
      res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${APK_NAME}"` })
      fs.createReadStream(apk.file).pipe(res)
      emit({ type: 'apk', taille: stat.size })
      return
    }
    if (parts[0] !== 'v1') return fail(res, 404)
    // Association par le Wi-Fi : en clair (pas encore de clé commune), accord de l'utilisateur sur le PC
    if (parts[1] === 'appairage') return pairRoute(req, res, parts)

    // Morceau de fichier PC → téléphone (GET, réponse chiffrée)
    if (req.method === 'GET' && parts[1] === 'envoi' && parts.length === 4) {
      const transfer = outgoing.get(parts[2])
      const index = Number(parts[3])
      if (!transfer || !deviceOf(deviceId) || !Number.isInteger(index) || index < 0 || index >= transfer.chunks) return fail(res, 404)
      const length = Math.min(CHUNK, transfer.size - index * CHUNK)
      const buffer = Buffer.alloc(length)
      const fd = fs.openSync(transfer.file, 'r')
      try {
        fs.readSync(fd, buffer, 0, length, index * CHUNK)
      } finally {
        fs.closeSync(fd)
      }
      transfer.sent = Math.max(transfer.sent, index * CHUNK + length)
      emit({ type: 'outgoing', phase: 'progress', id: transfer.id, nom: transfer.name, taille: transfer.size, envoye: transfer.sent })
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(seal(key(), buffer, `REP GET ${req.pathname}`))
      return
    }
    if (req.method !== 'POST') return fail(res, 405)

    // Morceau de fichier téléphone → PC (corps : octets chiffrés)
    if (parts[1] === 'fichier' && parts.length === 4 && /^\d+$/.test(parts[3])) {
      const transfer = incoming.get(parts[2])
      if (!transfer || transfer.device !== deviceId) return fail(res, 404)
      const body = await readBody(req, CHUNK + 64)
      let bytes
      try {
        bytes = open(key(), body, `POST ${req.pathname}`)
      } catch {
        return fail(res, 401)
      }
      const index = Number(parts[3])
      // Un morceau hors du fichier, ou de la mauvaise taille, est refusé (il écrirait au-delà de la fin)
      if (index >= transfer.chunks || bytes.length !== Math.min(CHUNK, transfer.size - index * CHUNK)) return fail(res, 400)
      const fd = fs.openSync(transfer.temp, 'r+')
      try {
        fs.writeSync(fd, bytes, 0, bytes.length, index * CHUNK)
      } finally {
        fs.closeSync(fd)
      }
      transfer.lastAt = now()
      transfer.received.add(index)
      transfer.bytes = Math.min(transfer.size, transfer.received.size * CHUNK)
      emit({ type: 'incoming', phase: 'progress', id: transfer.id, nom: transfer.name, taille: transfer.size, recu: transfer.bytes })
      return reply(res, req, 200, { recu: transfer.received.size })
    }

    const body = await readBody(req, MAX_JSON)
    const message = readMessage(req, body)

    // Association : le téléphone se présente (la clé du QR code prouve qu'il l'a scanné)
    if (parts[1] === 'bonjour') {
      const a = message.appareil || {}
      const id = String(a.id || '').slice(0, 64)
      if (!id) return fail(res, 400)
      let device = deviceOf(id)
      const fresh = !device
      if (!device) {
        device = { id, pairedAt: now() }
        state.devices.push(device)
      }
      device.nom = String(a.nom || 'Téléphone').slice(0, 60)
      device.modele = String(a.modele || '').slice(0, 60)
      device.lastSeen = now()
      store.save(state)
      if (fresh) emit({ type: 'paired', device: { ...device } })
      return reply(res, req, 200, { pc: { id: state.pcId, nom: pcName } })
    }
    const device = deviceOf(deviceId)
    if (!device) {
      refuse(req, 'inconnu') // clé bonne, mais ce téléphone a été oublié : il doit se représenter
      return fail(res, 403)
    }
    const wasOnline = now() - (device.lastSeen || 0) < ONLINE_MS
    device.lastSeen = now()
    const where = clientAddress(req)
    const before = live.get(device.id) || {}
    live.set(device.id, { ...before, adresse: where })
    if (!wasOnline) emit({ type: 'seen', device: { ...device } })

    // Boîte aux lettres : accusés de réception, puis ce qui attend (ou attente longue)
    if (parts[1] === 'boite') {
      if (message.etat && typeof message.etat === 'object') updateLive(device, message.etat)
      const q = queueFor(device.id)
      const acked = new Set(Array.isArray(message.vus) ? message.vus.map(String) : [])
      for (let i = q.length - 1; i >= 0; i--) {
        if (!acked.has(q[i].id)) continue
        const done = q[i]
        q.splice(i, 1)
        if (done.type === 'fichier') {
          const transfer = outgoing.get(done.transfert)
          if (transfer) {
            outgoing.delete(transfer.id)
            emit({ type: 'outgoing', phase: 'done', id: transfer.id, nom: transfer.name, taille: transfer.size, appareil: device.nom })
          }
        }
      }
      const flush = () => {
        if (res.writableEnded) return
        // Les adresses actuelles du PC : le téléphone les retient (le PC peut changer de réseau ou d'adresse)
        reply(res, req, 200, { elements: queueFor(device.id).map(({ at: _at, ...item }) => item), pc: { ...extra(), adresses: lanAddresses(), port: server?.address()?.port || port } })
      }
      const wait = Math.min(WAIT_MS, Math.max(0, Number(message.attente) || 0))
      if (q.length || !wait) return flush()
      wake(device.id) // une ancienne attente du même téléphone répond tout de suite
      const timer = setTimeout(() => {
        if (waiters.get(device.id)?.timer === timer) waiters.delete(device.id)
        flush()
      }, wait)
      waiters.set(device.id, { timer, flush })
      req.on('close', () => {
        if (waiters.get(device.id)?.timer === timer) {
          clearTimeout(timer)
          waiters.delete(device.id)
        }
      })
      return
    }
    // Presse-papiers du téléphone → PC
    if (parts[1] === 'presse-papiers') {
      const texte = typeof message.texte === 'string' ? message.texte.slice(0, 2_000_000) : ''
      const image = typeof message.image === 'string' ? message.image : ''
      if (!texte && !image) return fail(res, 400)
      // source : auto (copié n'importe où), menu (texte sélectionné), bulle, tuile, appli, partage
      emit({ type: 'clipboard', texte, image, appareil: device.nom, source: String(message.source || '').slice(0, 20) })
      return reply(res, req, 200, { ok: true })
    }
    // État du téléphone tout de suite (branché / débranché, chaque % pendant la charge), sans attendre la relève
    if (parts[1] === 'etat') {
      if (!message.etat || typeof message.etat !== 'object') return fail(res, 400)
      updateLive(device, message.etat)
      return reply(res, req, 200, { ok: true })
    }
    // Demandes traitées par main.js (chat avec Claude) : réponse { ok, resultat } ou { ok: false, erreur }
    if (parts[1] === 'api' && parts.length === 3) {
      if (!api) return reply(res, req, 200, { ok: false, erreur: 'Cette version de Nuage ne connaît pas cette demande.' })
      try {
        const resultat = await api(parts[2], message.donnees && typeof message.donnees === 'object' ? message.donnees : {}, { ...device })
        return reply(res, req, 200, { ok: true, resultat: resultat ?? null })
      } catch (error) {
        return reply(res, req, 200, { ok: false, erreur: String(error.message || error).slice(0, 300) })
      }
    }
    // Petit signe du téléphone : « coucou » (Nuage du PC salue), « trouvé » (la sonnerie s'est arrêtée)
    if (parts[1] === 'signal') {
      const signal = ['coucou', 'trouve'].includes(message.signal) ? message.signal : ''
      if (!signal) return fail(res, 400)
      emit({ type: 'signal', signal, appareil: device.nom })
      return reply(res, req, 200, { ok: true })
    }
    // Fichier téléphone → PC : début, fin, abandon
    if (parts[1] === 'fichier' && parts[2] === 'debut') {
      const size = Number(message.taille)
      if (!Number.isFinite(size) || size < 0 || size > MAX_FILE) return fail(res, 413)
      if ([...incoming.values()].filter(t => t.device === device.id).length >= 3) return fail(res, 429)
      fs.mkdirSync(inbox, { recursive: true })
      const id = crypto.randomUUID()
      const temp = path.join(inbox, `.${id}.nuage-part`)
      fs.writeFileSync(temp, '')
      if (size) fs.truncateSync(temp, size)
      const transfer = { id, device: device.id, name: path.basename(String(message.nom || 'fichier')), size, temp, received: new Set(), bytes: 0, chunks: Math.ceil(size / CHUNK), lastAt: now() }
      incoming.set(id, transfer)
      emit({ type: 'incoming', phase: 'start', id, nom: transfer.name, taille: size, appareil: device.nom })
      return reply(res, req, 200, { id, morceau: CHUNK })
    }
    if (parts[1] === 'fichier' && parts.length === 4 && (parts[3] === 'fin' || parts[3] === 'annule')) {
      const transfer = incoming.get(parts[2])
      if (!transfer || transfer.device !== device.id) return fail(res, 404)
      incoming.delete(transfer.id)
      if (parts[3] === 'annule' || transfer.received.size < transfer.chunks) {
        try {
          fs.unlinkSync(transfer.temp)
        } catch {}
        emit({ type: 'incoming', phase: 'cancel', id: transfer.id, nom: transfer.name })
        return reply(res, req, parts[3] === 'annule' ? 200 : 409, { ok: false, manque: transfer.chunks - transfer.received.size })
      }
      const final = freeName(inbox, transfer.name)
      fs.renameSync(transfer.temp, final)
      emit({ type: 'incoming', phase: 'done', id: transfer.id, nom: path.basename(final), taille: transfer.size, chemin: final, appareil: device.nom })
      return reply(res, req, 200, { ok: true, nom: path.basename(final) })
    }
    return fail(res, 404)
  }

  // Transferts abandonnés (téléphone parti en cours de route, fichier jamais téléchargé) : nettoyés.
  // Avant le 05/10/2026, un envoi coupé laissait un fichier « .nuage-part » et comptait toujours parmi
  // les 3 envois permis : au bout de 3 coupures, le téléphone ne pouvait plus rien envoyer.
  function sweep() {
    const t = now()
    for (const transfer of [...incoming.values()]) {
      if (t - transfer.lastAt < STALE_IN_MS) continue
      incoming.delete(transfer.id)
      try {
        fs.unlinkSync(transfer.temp)
      } catch {}
      emit({ type: 'incoming', phase: 'cancel', id: transfer.id, nom: transfer.name })
    }
    for (const transfer of [...outgoing.values()]) {
      if (t - transfer.createdAt < STALE_OUT_MS && fs.existsSync(transfer.file)) continue
      outgoing.delete(transfer.id)
      for (const q of queues.values()) for (let i = q.length - 1; i >= 0; i--) if (q[i].transfert === transfer.id) q.splice(i, 1)
      emit({ type: 'outgoing', phase: 'cancel', id: transfer.id, nom: transfer.name })
    }
  }
  // Restes d'un envoi interrompu avant un redémarrage de Nuage
  function cleanInbox() {
    try {
      for (const name of fs.readdirSync(inbox)) {
        if (!/^\..+\.nuage-part$/.test(name)) continue
        const file = path.join(inbox, name)
        if (now() - fs.statSync(file).mtimeMs > STALE_IN_MS) fs.unlinkSync(file)
      }
    } catch {
      // dossier pas encore créé
    }
  }
  // Découverte sur le Wi-Fi : « NUAGE-OU <id> » → « NUAGE-ICI <id> <port> » ; « NUAGE-OU * » (téléphone
  // pas encore associé) → « NUAGE-ICI <id> <port> <nom du PC> ».
  // v1.8 : une erreur d'ENVOI (téléphone parti, réseau changé) ne ferme plus la découverte pour toujours (avant,
  // le premier « réseau injoignable » l'éteignait jusqu'au redémarrage de Nuage) ; si le socket tombe, il se rouvre.
  let discoveryRetry = null
  function startDiscovery() {
    if (udp) return
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    udp = socket
    socket.on('message', (data, rinfo) => {
      const [word, id] = data.toString('utf8').trim().split(/\s+/)
      if (word !== 'NUAGE-OU') return
      const quoi = id === '*' ? 'tous les PC' : id === state?.pcId ? 'ce PC' : 'un autre PC'
      trace({ type: 'udp', de: `${rinfo.address}:${rinfo.port}`, quoi, repond: Boolean(state?.pcId) && quoi !== 'un autre PC' })
      if (!state?.pcId) return
      lastSearch = { adresse: rinfo.address, at: now() }
      if (now() - (searchSeen.get(rinfo.address) || 0) > 3000) {
        searchSeen.set(rinfo.address, now())
        emit({ type: 'recherche', adresse: rinfo.address, at: now() })
      }
      const here = `NUAGE-ICI ${state.pcId} ${server?.address()?.port || port}`
      const answer = id === '*' ? `${here} ${encodeURIComponent(pcName)}` : id === state.pcId ? here : null
      if (answer) {
        socket.send(answer, rinfo.port, rinfo.address, error => {
          if (error) trace({ type: 'udp', de: `${rinfo.address}:${rinfo.port}`, erreur: `réponse impossible : ${error.message}` })
        })
      }
    })
    socket.on('error', error => {
      log('lien, découverte :', error.message)
      trace({ type: 'udp', erreur: error.message })
      try {
        socket.close()
      } catch {}
      if (udp === socket) udp = null
      // Le serveur tourne toujours : on rouvre la découverte dans 5 s
      clearTimeout(discoveryRetry)
      if (server) discoveryRetry = setTimeout(startDiscovery, 5000)
      discoveryRetry?.unref?.()
    })
    socket.bind(udpPort, host)
  }
  function start() {
    if (server) return Promise.resolve()
    ensureState()
    cleanInbox()
    startDiscovery()
    clearInterval(sweeper)
    sweeper = setInterval(sweep, 30_000)
    sweeper.unref?.()
    return new Promise(resolve => {
      server = http.createServer((req, res) => {
        // Journal : qui frappe à la porte (les relèves de la boîte, toutes les 25 s, ne sont notées qu'à l'échec)
        const where = clientAddress(req)
        const quiet = req.method === 'POST' && /^\/v1\/boite$/.test(String(req.url || '').split('?')[0])
        if (!quiet) trace({ type: 'http', de: where, requete: `${req.method} ${cleanPath(req.url)}` })
        res.on('close', () => {
          if (res.statusCode >= 400 || (quiet && !res.writableFinished)) trace({ type: 'http', de: where, requete: `${req.method} ${cleanPath(req.url)}`, statut: res.statusCode, fini: res.writableFinished })
        })
        route(req, res).catch(error => {
          log('lien, requête refusée :', error.message)
          if (error.status === 401) refuse(req, error.message === 'horloge' ? 'horloge' : 'cle')
          if (!res.headersSent) fail(res, error.status || 500)
        })
      })
      server.requestTimeout = 0 // les attentes longues et les gros morceaux ne sont pas coupés
      server.on('error', error => {
        log('lien, serveur impossible :', error.message)
        emit({ type: 'error', message: error.message })
        server = null
        resolve()
      })
      server.listen(port, host, () => resolve())
    })
  }
  function stop() {
    for (const id of [...waiters.keys()]) wake(id)
    server?.close()
    server = null
    clearTimeout(discoveryRetry)
    udp?.close()
    udp = null
    clearInterval(sweeper)
    sweeper = null
  }

  return {
    start,
    stop,
    running: () => Boolean(server?.listening),
    traces: () => traces.slice(),
    lastSearch: () => lastSearch,
    port: () => server?.address()?.port || port,
    // Contenu du QR code d'association
    pairingPayload(addresses = lanAddresses()) {
      const s = ensureState()
      return `NUAGE1:${JSON.stringify({ id: s.pcId, k: s.key, h: addresses, p: server?.address()?.port || port, n: pcName })}`
    },
    devices: () => (state?.devices || []).map(d => ({ ...d, online: now() - (d.lastSeen || 0) < ONLINE_MS, etat: live.get(d.id)?.etat || null, adresse: live.get(d.id)?.adresse || '' })),
    // Oublier tous les téléphones : nouvelle clé, il faudra rescanner le QR code
    forget() {
      state = null
      queues.clear()
      live.clear()
      for (const id of [...waiters.keys()]) wake(id)
      outgoing.clear()
      ensureState()
    },
    // Proposer l'application au téléchargement (null : arrêter) ; renvoie l'adresse pour le QR code
    offerApk(file, minutes = 15) {
      apk = file && fs.existsSync(file) ? { file, until: now() + minutes * 60_000 } : null
      const address = lanAddresses()[0]
      return apk && address ? `http://${address}:${server?.address()?.port || port}/${APK_NAME}` : ''
    },
    // Association par le Wi-Fi : réponse de l'utilisateur à « X veut se connecter » (faux si expirée)
    acceptPairing: id => pairing?.id === id && settlePairing('accepte'),
    refusePairing: id => pairing?.id === id && settlePairing('refuse'),
    sendClipboard: content => push({ type: 'presse-papiers', ...content }),
    // « Où est mon téléphone ? » : il sonne fort (même en silencieux) jusqu'à ce qu'on l'arrête
    ring: (on = true) => push({ type: on ? 'sonner' : 'sonner-stop' }),
    // État du chat pour un téléphone (seul le dernier compte dans sa boîte)
    sendChatState: (deviceId, etat) => push({ type: 'chat', etat }, deviceId),
    // Agents de code (résumé pour l'appli, ses widgets et sa notification en direct) : seul le dernier compte
    sendAgents: etat => push({ type: 'agents', etat }),
    sweep,
    discoveryPort: () => {
      try {
        return udp?.address().port || 0
      } catch {
        return 0 // pas encore prête
      }
    },
    notify: ({ titre, texte, genre = '' }) => push({ type: 'notif', titre: String(titre).slice(0, 120), texte: String(texte || '').slice(0, 400), genre }),
    // Fichier PC → téléphone : le téléphone le télécharge par morceaux
    // { deviceId, maj } : un seul téléphone ; maj = version de l'appli (l'APK est installé, pas rangé)
    sendFile(file, { deviceId, maj } = {}) {
      const stat = fs.statSync(file)
      if (!stat.isFile()) throw new Error('ce n’est pas un fichier')
      if (stat.size > MAX_FILE) throw new Error('fichier trop gros (4 Go au plus)')
      const id = crypto.randomUUID()
      const transfer = { id, file, name: path.basename(file), size: stat.size, chunks: Math.ceil(stat.size / CHUNK), sent: 0, createdAt: now() }
      outgoing.set(id, transfer)
      const count = push({ type: 'fichier', transfert: id, nom: transfer.name, taille: transfer.size, morceaux: transfer.chunks, morceau: CHUNK, ...(maj ? { maj: String(maj) } : {}) }, deviceId)
      emit({ type: 'outgoing', phase: 'start', id, nom: transfer.name, taille: transfer.size, appareils: count })
      return { id, appareils: count }
    },
  }
}

module.exports = { createLink, seal, open, lanAddresses, lanDetails, b64url, fromB64url, pairCode, pairKey, PORT, CHUNK }

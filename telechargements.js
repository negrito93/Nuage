// Téléchargements en cours (Chrome, Edge, Firefox…), pour l'animation de Nuage (demande du 04/10/2026).
// Deux sources, rien n'est lu dans l'historique ni dans les données du navigateur :
//  - le dossier Téléchargements : Chromium y écrit « nom.crdownload » (d'abord « Unconfirmed 123456.crdownload »),
//    Firefox « nom.part », puis les renomme à la fin. On voit la taille reçue, pas la taille finale ;
//  - l'extension facultative (extension-navigateur\) : nom, taille reçue et taille totale (pourcentage exact),
//    envoyés au serveur local de Nuage (127.0.0.1).
// Événements : progress (tout ce qui est en cours, regroupé), done (un fichier fini), cancel, idle.
const fs = require('node:fs')
const path = require('node:path')

const TEMP = /\.(crdownload|part|partial|opdownload)$/i
const UNCONFIRMED = /^(unconfirmed|non confirm[ée]) \d+\.crdownload$/i
const STALE_MS = 30_000 // fichier temporaire immobile depuis 30 s au démarrage : ancien, ignoré
const EXT_TIMEOUT_MS = 6000 // l'extension n'a plus rien dit : on oublie ses téléchargements

function createDownloadWatcher({ folders, onEvent, log = () => {}, now = Date.now, scanMs = 500, idleScanMs = 5000 }) {
  const items = new Map() // clé (chemin final en minuscules) → téléchargement suivi
  const recentTemp = new Map() // fichier temporaire vu passer (même très court) → heure
  const announced = new Map() // fichiers déjà annoncés « terminé » → heure (évite les doublons des deux sources)
  const watchers = []
  let timer = null
  let lastSlowScan = 0
  let lastSent = ''
  let started = false
  let wasActive = false

  const keyOf = p => path.resolve(p).toLowerCase()
  const finalOf = temp => temp.replace(TEMP, '')
  const nameOf = item => (item.unconfirmed ? '' : path.basename(item.final))

  function emit(event) {
    try {
      onEvent(event)
    } catch (error) {
      log('téléchargements, envoi impossible :', error.message)
    }
  }
  function announceDone(final, size) {
    const key = keyOf(final)
    const t = now()
    if (t - (announced.get(key) || 0) < 60_000) return
    announced.set(key, t)
    emit({ type: 'done', name: path.basename(final), path: final, size })
  }

  // ---------- Source 1 : le dossier Téléchargements ----------
  function scanFolder(folder, first) {
    let names
    try {
      names = fs.readdirSync(folder)
    } catch {
      return
    }
    const t = now()
    const present = new Set()
    for (const name of names) {
      if (!TEMP.test(name)) continue
      const temp = path.join(folder, name)
      let stat
      try {
        stat = fs.statSync(temp)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      const unconfirmed = UNCONFIRMED.test(name)
      const final = unconfirmed ? temp : finalOf(temp)
      const key = keyOf(final)
      present.add(key)
      let item = items.get(key)
      if (!item) {
        // Au démarrage, un vieux fichier temporaire immobile (téléchargement abandonné) n'est pas suivi
        const stale = first && t - stat.mtimeMs > STALE_MS
        item = { key, final, temp, unconfirmed, folder, received: stat.size, total: null, startedAt: t, speed: 0, lastBytes: stat.size, lastAt: t, active: !stale, fromFolder: true }
        items.set(key, item)
        // Chrome renomme « Unconfirmed 123.crdownload » en « vrai-nom.crdownload » : on garde l'heure de départ
        if (!unconfirmed) {
          for (const other of items.values()) {
            if (other !== item && other.unconfirmed && other.folder === folder && !fs.existsSync(other.temp)) {
              item.startedAt = other.startedAt
              item.active = item.active || other.active
              items.delete(other.key)
            }
          }
        }
      }
      item.fromFolder = true
      item.temp = temp
      item.seenAt = t
      if (stat.size !== item.received) {
        if (!item.active) item.active = true // il s'est remis à grossir
        item.received = Math.max(item.received, stat.size)
      }
    }
    // Disparus du dossier : terminés (le fichier final est là) ou annulés
    for (const item of [...items.values()]) {
      if (!item.fromFolder || item.folder !== folder || present.has(item.key)) continue
      if (item.extSeenAt && t - item.extSeenAt < EXT_TIMEOUT_MS) {
        item.fromFolder = false // l'extension le suit encore (elle dira la fin)
        continue
      }
      items.delete(item.key)
      if (!item.active || item.unconfirmed) continue // renommé par Chrome, ou jamais suivi
      let size = -1
      try {
        const stat = fs.statSync(item.final)
        if (stat.isFile()) size = stat.size
      } catch {}
      if (size > 0) announceDone(item.final, size)
      else emit({ type: 'cancel', name: nameOf(item) })
    }
    // Téléchargements très courts : le fichier temporaire est apparu puis a disparu entre deux lectures
    for (const [final, seen] of [...recentTemp]) {
      if (t - seen > 60_000) {
        recentTemp.delete(final)
        continue
      }
      if (path.dirname(final) !== folder || items.has(keyOf(final))) continue
      if (fs.existsSync(final + '.crdownload') || fs.existsSync(final + '.part')) continue
      try {
        const stat = fs.statSync(final)
        if (stat.isFile() && stat.size > 0 && t - stat.mtimeMs < 60_000) {
          recentTemp.delete(final)
          announceDone(final, stat.size)
        }
      } catch {}
    }
  }

  // ---------- Source 2 : l'extension du navigateur ----------
  // body = { items: [{ id, path, received, total, state: 'in_progress' | 'complete' | 'interrupted', paused }] }
  function report(body) {
    const list = Array.isArray(body?.items) ? body.items.slice(0, 50) : []
    const t = now()
    for (const d of list) {
      const final = typeof d.path === 'string' && path.isAbsolute(d.path) ? d.path : ''
      if (!final) continue
      const key = keyOf(final)
      const received = Math.max(0, Number(d.received) || 0)
      const total = Number(d.total) > 0 ? Number(d.total) : null
      if (d.state === 'complete') {
        items.delete(key)
        let size = Number(d.size) > 0 ? Number(d.size) : total || received
        try {
          size = fs.statSync(final).size || size
        } catch {}
        announceDone(final, size)
        continue
      }
      if (d.state === 'interrupted') {
        const item = items.get(key)
        items.delete(key)
        if (t - (announced.get(key) || 0) > 60_000) emit({ type: 'cancel', name: path.basename(final) })
        if (item) item.active = false
        continue
      }
      let item = items.get(key)
      if (!item) {
        item = { key, final, temp: '', unconfirmed: false, folder: path.dirname(final), received, total, startedAt: t, speed: 0, lastBytes: received, lastAt: t, active: true, fromFolder: false }
        items.set(key, item)
      }
      item.active = true
      item.extSeenAt = t
      item.paused = Boolean(d.paused)
      item.received = Math.max(item.received, received)
      if (total) item.total = total
    }
    tick()
  }

  // ---------- Regroupement et envoi ----------
  function tick() {
    const t = now()
    for (const item of [...items.values()]) {
      // L'extension s'est tue et le dossier ne le voit pas : on l'oublie
      if (!item.fromFolder && item.extSeenAt && t - item.extSeenAt > EXT_TIMEOUT_MS) items.delete(item.key)
    }
    const active = [...items.values()].filter(i => i.active)
    for (const item of active) {
      const dt = (t - item.lastAt) / 1000
      if (dt >= 0.4) {
        const instant = Math.max(0, item.received - item.lastBytes) / dt
        item.speed = item.speed ? item.speed * 0.6 + instant * 0.4 : instant
        item.lastBytes = item.received
        item.lastAt = t
      }
    }
    if (!active.length) {
      if (wasActive) {
        wasActive = false
        lastSent = ''
        emit({ type: 'idle' })
      }
      return
    }
    wasActive = true
    const received = active.reduce((s, i) => s + i.received, 0)
    const known = active.every(i => i.total)
    const total = known ? active.reduce((s, i) => s + i.total, 0) : null
    const percent = total ? Math.min(100, (received / total) * 100) : null
    const named = active.find(i => nameOf(i))
    const event = {
      type: 'progress',
      count: active.length,
      name: active.length > 1 ? `${active.length} fichiers` : named ? nameOf(named) : '',
      received,
      total,
      percent: percent === null ? null : Math.round(percent * 10) / 10,
      speed: Math.round(active.reduce((s, i) => s + (i.paused ? 0 : i.speed), 0)),
      paused: active.every(i => i.paused),
      startedAt: Math.min(...active.map(i => i.startedAt)),
      exact: known,
    }
    const signature = JSON.stringify([event.count, event.name, event.received, event.total, event.paused])
    if (signature === lastSent) return
    lastSent = signature
    emit(event)
  }

  function scan(first = false) {
    for (const folder of folders) scanFolder(folder, first)
    tick()
  }
  function loop() {
    const t = now()
    const busy = [...items.values()].some(i => i.active) || recentTemp.size
    if (busy || t - lastSlowScan >= idleScanMs) {
      lastSlowScan = t
      scan()
    }
  }

  function start() {
    if (started) return
    started = true
    for (const folder of folders) {
      try {
        const watcher = fs.watch(folder, { persistent: false }, (_type, name) => {
          if (name && TEMP.test(String(name)) && !UNCONFIRMED.test(String(name))) {
            recentTemp.set(path.join(folder, finalOf(String(name))), now())
          }
          clearTimeout(watcher.soon)
          watcher.soon = setTimeout(() => scan(), 120)
        })
        watcher.on('error', error => log('téléchargements, surveillance interrompue :', folder, error.message))
        watchers.push(watcher)
      } catch (error) {
        log('téléchargements, dossier non surveillé :', folder, error.message)
      }
    }
    scan(true)
    lastSlowScan = now()
    timer = setInterval(loop, scanMs)
  }
  function stop() {
    started = false
    clearInterval(timer)
    timer = null
    for (const watcher of watchers.splice(0)) {
      clearTimeout(watcher.soon)
      watcher.close()
    }
    items.clear()
    recentTemp.clear()
    wasActive = false
    lastSent = ''
  }

  return { start, stop, scan, report, tick, state: () => [...items.values()].map(i => ({ ...i })) }
}

module.exports = { createDownloadWatcher, TEMP }

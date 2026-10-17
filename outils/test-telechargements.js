// Test du suivi des téléchargements avec de faux fichiers temporaires (aucun navigateur, aucun réseau).
// Usage : node outils/test-telechargements.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDownloadWatcher } = require('../telechargements')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-telechargements-'))
const at = name => path.join(dir, name)
const events = []
const w = createDownloadWatcher({ folders: [dir], onEvent: e => events.push(e) })
const take = () => events.splice(0)
const last = type => take().filter(e => e.type === type).pop()

;(async () => {
  // 1. Un vieux fichier temporaire immobile (téléchargement abandonné) n'est pas annoncé
  fs.writeFileSync(at('vieux.zip.crdownload'), 'x'.repeat(100))
  const old = new Date(Date.now() - 10 * 60_000)
  fs.utimesSync(at('vieux.zip.crdownload'), old, old)
  w.scan(true)
  assert.equal(take().length, 0, 'ancien fichier temporaire ignoré')

  // 2. Un téléchargement qui grossit puis se termine (Chrome renomme le .crdownload)
  fs.writeFileSync(at('film.mp4.crdownload'), Buffer.alloc(1000))
  w.scan()
  let p = last('progress')
  assert.equal(p.name, 'film.mp4')
  assert.equal(p.received, 1000)
  assert.equal(p.percent, null, 'taille finale inconnue sans l’extension')
  fs.appendFileSync(at('film.mp4.crdownload'), Buffer.alloc(5000))
  w.scan()
  assert.equal(last('progress').received, 6000)
  fs.renameSync(at('film.mp4.crdownload'), at('film.mp4'))
  w.scan()
  const after = take()
  const done = after.find(e => e.type === 'done')
  assert.ok(done, 'terminé annoncé')
  assert.equal(done.name, 'film.mp4')
  assert.equal(done.size, 6000)
  assert.ok(after.some(e => e.type === 'idle'), 'plus rien en cours')

  // 3. « Unconfirmed 123456.crdownload » renommé par Chrome, puis annulé
  fs.writeFileSync(at('Unconfirmed 123456.crdownload'), Buffer.alloc(500))
  w.scan()
  assert.equal(last('progress').name, '', 'nom pas encore connu')
  fs.renameSync(at('Unconfirmed 123456.crdownload'), at('doc.pdf.crdownload'))
  w.scan()
  const renamed = take()
  assert.ok(!renamed.some(e => e.type === 'cancel'), 'un renommage n’est pas une annulation')
  assert.equal(renamed.filter(e => e.type === 'progress').pop().name, 'doc.pdf')
  fs.unlinkSync(at('doc.pdf.crdownload'))
  w.scan()
  const cancel = last('cancel')
  assert.equal(cancel?.name, 'doc.pdf', 'annulation annoncée')

  // 4. L'extension donne la taille totale : pourcentage exact, puis fin
  w.report({ items: [{ id: 1, path: at('jeu.iso'), received: 25, total: 100, state: 'in_progress' }] })
  p = last('progress')
  assert.equal(p.percent, 25)
  assert.equal(p.exact, true)
  w.report({ items: [{ id: 1, path: at('jeu.iso'), received: 100, total: 100, state: 'complete', size: 100 }] })
  assert.equal(last('done')?.name, 'jeu.iso')

  // 5. Même téléchargement vu par le dossier et par l'extension : un seul, avec le pourcentage
  fs.writeFileSync(at('gros.bin.crdownload'), Buffer.alloc(300))
  w.scan()
  w.report({ items: [{ id: 2, path: at('gros.bin'), received: 300, total: 1200, state: 'in_progress' }] })
  p = last('progress')
  assert.equal(p.count, 1)
  assert.equal(p.percent, 25)
  fs.unlinkSync(at('gros.bin.crdownload'))
  w.report({ items: [{ id: 2, path: at('gros.bin'), state: 'interrupted' }] })
  w.scan()
  assert.equal(take().filter(e => e.type === 'cancel').length, 1, 'une seule annulation')

  // 6. L'ancien fichier se remet à grossir : il est suivi
  fs.appendFileSync(at('vieux.zip.crdownload'), Buffer.alloc(50))
  w.scan()
  assert.equal(last('progress')?.name, 'vieux.zip')
  fs.unlinkSync(at('vieux.zip.crdownload'))
  w.scan()
  take()

  // 7. Téléchargement éclair (apparu et fini entre deux lectures) : vu grâce à la surveillance du dossier
  w.start()
  await new Promise(resolve => setTimeout(resolve, 200))
  fs.writeFileSync(at('image.png.crdownload'), Buffer.alloc(2000))
  fs.renameSync(at('image.png.crdownload'), at('image.png'))
  await new Promise(resolve => setTimeout(resolve, 900))
  w.stop()
  assert.equal(last('done')?.name, 'image.png', 'téléchargement éclair annoncé')

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('test-telechargements : OK (7 scénarios)')
})().catch(error => {
  fs.rmSync(dir, { recursive: true, force: true })
  console.error('ÉCHEC :', error.message)
  process.exit(1)
})

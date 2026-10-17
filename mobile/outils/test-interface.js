// Test de l'interface du téléphone (mobile/www) avec un FAUX plugin « Lien », dans Electron (fenêtre cachée).
// Attrape ce que le mode démonstration ne voit pas : une erreur au démarrage quand le plugin existe (v1.7 : une
// variable lue avant sa déclaration arrêtait tout le script, les boutons n'étaient jamais branchés).
// Usage : node_modules\electron\dist\electron.exe mobile\outils\test-interface.js   (code 0 = tout va bien)
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const www = path.join(__dirname, '..', 'www')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let file = path.join(www, decodeURIComponent(url.pathname))
  if (!file.startsWith(www)) return res.writeHead(403).end()
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) return res.writeHead(404).end('introuvable')
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})

const problems = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (condition, message) => {
  if (!condition) problems.push(message)
}

async function scenario(port, name, run) {
  const win = new BrowserWindow({
    show: false, width: 375, height: 812,
    webPreferences: { preload: path.join(__dirname, 'faux-lien-preload.js'), contextIsolation: false, sandbox: false },
  })
  const errors = []
  win.webContents.on('console-message', event => {
    const level = event.level ?? 0
    if (level === 'error' || level === 3) errors.push(String(event.message))
  })
  win.webContents.on('render-process-gone', (_e, details) => errors.push(`processus de la page arrêté : ${details.reason}`))
  // Un chargement peut échouer par accident (ERR_FAILED vu une fois) : une seconde tentative avant de conclure
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadURL(`http://127.0.0.1:${port}/index.html?s=${name}`)
      break
    } catch (error) {
      if (attempt >= 3) throw error
      await pause(300)
    }
  }
  await pause(2500) // la recherche automatique part 1,2 s après l'ouverture
  const js = code => win.webContents.executeJavaScript(code)
  try {
    await run(js)
  } catch (error) {
    problems.push(`${name} : ${error.message}`)
  }
  check(!errors.length, `${name} : erreurs dans la page : ${errors.join(' | ')}`)
  // 09/10/2026 : « tout ce qui est adresse ne doit plus être visible » : aucune adresse IP à l'écran
  const seen = (await js('document.body.innerText')).match(/\b\d{1,3}(\.\d{1,3}){3}\b/)
  check(!seen, `${name} : une adresse est visible (« ${seen?.[0]} »)`)
  win.destroy()
}

app.on('window-all-closed', () => {}) // sans cela, Electron quitte avec le code 0 dès que la dernière fenêtre est détruite
process.on('unhandledRejection', error => {
  console.error(`test-interface : ÉCHEC (erreur inattendue) : ${error?.message || error}`)
  app.exit(1)
})

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  // 1. Pas encore associé, recherche sans résultat : rapport lisible (sans adresse), conseil du QR code, boutons vivants
  await scenario(port, 'echec', async js => {
    const s = await js(`JSON.stringify({
      appels: globalThis.__appels,
      rapport: !document.getElementById('pair-diag').hidden,
      reseau: document.getElementById('net-line').textContent,
      liste: [...document.querySelectorAll('#pair-diag-list li')].map(l => l.textContent),
      aide: document.getElementById('pair-diag-help').textContent,
      version: document.getElementById('version').textContent,
    })`)
    const r = JSON.parse(s)
    check(r.appels.includes('chercherPcsReseau'), 'echec : la recherche automatique ne part pas')
    check(r.rapport, 'echec : le rapport de recherche ne s’affiche pas')
    check(/Wi-Fi/.test(r.reseau), `echec : réseau du téléphone absent (« ${r.reseau} »)`)
    check(r.liste.some(l => /259 messages envoyés, aucune réponse/.test(l)), `echec : détail de la recherche absent (${r.liste})`)
    check(/QR code/.test(r.aide), `echec : le conseil ne propose pas le QR code (« ${r.aide} »)`)
    check(/v1\.8/.test(r.version), `echec : version affichée « ${r.version} »`)
    // Le bouton « Trouver mon PC » répond (en v1.7 il n'était jamais branché)
    await js(`globalThis.__appels.length = 0; document.getElementById('find-pc').click()`)
    await pause(700)
    check((await js('globalThis.__appels')).includes('chercherPcsReseau'), 'echec : le bouton « Trouver mon PC » ne fait rien')
    check(await js(`!document.getElementById('manual')`), 'echec : la saisie manuelle d’adresse ne doit plus exister')
  })

  // 2. Un PC répond : pas de rapport d'échec, et rien n'est demandé au PC tant qu'on n'a pas confirmé
  await scenario(port, 'trouve', async js => {
    check(await js(`document.getElementById('pair-diag').hidden`), 'trouve : le rapport d’échec ne doit pas s’afficher')
    const appels = await js('globalThis.__appels')
    check(appels.includes('chercherPcsReseau'), 'trouve : la recherche automatique ne part pas')
    check(!appels.some(a => a.startsWith('demanderAssociation')), 'trouve : une demande est partie sans confirmation')
    // « Trouver mon PC » : un seul PC trouvé → demande d'association, code des deux côtés, accord sur le PC
    await js(`globalThis.__appels.length = 0; document.getElementById('find-pc').click()`)
    await pause(550)
    check(await js(`!document.getElementById('pair-code').hidden`), 'trouve : le code à 6 chiffres ne s’affiche pas')
    await pause(900)
    const apres = await js('globalThis.__appels')
    check(apres.some(a => a.startsWith('demanderAssociation') && a.includes('47824')), `trouve : demande d’association mal envoyée (${apres})`)
    check(apres.includes('attendreAssociation'), 'trouve : l’attente de l’accord ne part pas')
    check(await js(`document.getElementById('pair-code').hidden`), 'trouve : le code reste affiché après l’accord')
  })

  // 3. Déjà associé : tuiles, fil d'activité, chat, coucou
  await scenario(port, 'associe', async js => {
    const r = JSON.parse(await js(`JSON.stringify({
      puce: document.getElementById('pc-name').textContent,
      tuiles: !document.getElementById('tiles').hidden,
      fil: !document.getElementById('feed').hidden,
      appairage: document.getElementById('pair').hidden,
    })`))
    check(r.puce === 'PC-TEST', `associe : nom du PC « ${r.puce} »`)
    check(r.tuiles && r.fil && r.appairage, `associe : écran incomplet (${JSON.stringify(r)})`)
    await js(`document.getElementById('ask-open').click()`)
    await pause(600)
    check(await js(`!document.getElementById('chat').hidden`), 'associe : le chat ne s’ouvre pas')
    const messages = await js(`[...document.querySelectorAll('#chat-log .msg')].map(m => m.textContent)`)
    check(messages.join('|') === 'Salut|Bonjour !', `associe : messages du chat (${messages})`)
    await js(`document.getElementById('chat-back').click()`)
    await pause(300)
    check(await js(`document.getElementById('chat').hidden`), 'associe : le chat ne se ferme pas')
    await js(`globalThis.__appels.length = 0; document.getElementById('wave').click()`)
    await pause(300)
    check((await js('globalThis.__appels')).includes('coucou'), 'associe : « Coucou au PC » ne fait rien')
  })

  // 4. Agents de code (v1.9) : onglets, demande approuvée, détail d'une session, message dans la session, services
  await scenario(port, 'agents', async js => {
    check(!(await js(`document.getElementById('tabbar').hidden`)), 'agents : la barre d’onglets n’apparaît pas')
    await js(`document.querySelector('#tabbar [data-view="agents"]').click()`)
    await pause(700)
    const r = JSON.parse(await js(`JSON.stringify({
      vue: document.body.dataset.view,
      nuageCache: getComputedStyle(document.getElementById('scene')).display === 'none',
      titre: document.getElementById('ag-titre').textContent,
      chiffres: [...document.querySelectorAll('#ag-stats .ag-stat b')].map(b => b.textContent),
      demandes: document.querySelectorAll('#ag-demandes .ag-req').length,
      sessions: [...document.querySelectorAll('#ag-sessions .ag-row b')].map(b => b.textContent),
      pastille: document.getElementById('ag-badge').textContent,
    })`))
    check(r.vue === 'agents' && r.nuageCache, `agents : l’onglet ne s’affiche pas (${JSON.stringify(r)})`)
    check(r.titre === '1 en attente', `agents : titre « ${r.titre} »`)
    check(r.chiffres.join('|') === '27|2|+3 −0|43', `agents : chiffres du jour (${r.chiffres})`)
    check(r.demandes === 1 && r.pastille === '1', `agents : demande ou pastille (${r.demandes}, « ${r.pastille} »)`)
    check(r.sessions.join('|') === 'korus|Discussion avec Gemini|portfolio', `agents : sessions (${r.sessions})`)
    await js(`globalThis.__appels.length = 0; document.querySelector('#ag-demandes .white-btn').click()`)
    await pause(200)
    check((await js('globalThis.__appels')).includes('agentsRepondre perm-1 allow'), 'agents : « Approuver » ne part pas')
    // Détail d'une session
    await js(`document.querySelector('#ag-sessions .ag-row').click()`)
    await pause(600)
    const s = JSON.parse(await js(`JSON.stringify({
      ouvert: !document.getElementById('session').hidden,
      texte: document.getElementById('sess-body').innerText,
    })`))
    check(s.ouvert, 'session : la feuille ne s’ouvre pas')
    check(/Fix the VAT rounding/.test(s.texte) && /Ce qu’il a fait · 2/.test(s.texte) && /Réponse de Claude/.test(s.texte) && /billing\.ts/.test(s.texte), `session : contenu (${s.texte.slice(0, 160)})`)
    // Puce « Lance les tests » : le message part dans cette session, le chat s'ouvre
    await js(`globalThis.__appels.length = 0; [...document.querySelectorAll('#sess-chips .qchip')].find(b => b.textContent === 'Lance les tests').click()`)
    await pause(900)
    const sent = await js('globalThis.__appels')
    check(sent.includes('chatSession continuer s1') && sent.includes('chatEnvoyer Lance les tests'), `session : message mal envoyé (${sent})`)
    check(await js(`document.getElementById('session').hidden && !document.getElementById('chat').hidden`), 'session : le chat ne prend pas le relais')
    await js(`document.getElementById('chat-back').click()`)
    await pause(400)
    // Discussion du chat du PC avec Gemini (09/10/2026) : son nom sur « Demande à… », sa ligne ouvre le chat
    const ask = await js(`document.querySelector('#ask-open .ask-text').textContent`)
    check(ask === 'Demande à Gemini…', `agents : « ${ask} » au lieu de « Demande à Gemini… »`)
    await js(`globalThis.__appels.length = 0; document.querySelectorAll('#ag-sessions .ag-row')[1].click()`)
    await pause(500)
    check(await js(`!document.getElementById('chat').hidden && document.getElementById('session').hidden`), 'discussion : sa ligne n’ouvre pas le chat')
    check(!(await js('globalThis.__appels')).some(a => a.startsWith('agentsSession')), 'discussion : demandée comme une session de Claude Code')
    await js(`document.getElementById('chat-back').click()`)
    await pause(400)
    // Services
    await js(`document.querySelector('#tabbar [data-view="services"]').click()`)
    await pause(600)
    const v = JSON.parse(await js(`JSON.stringify({ cartes: [...document.querySelectorAll('#svc-list .svc b')].map(b => b.textContent), note: document.getElementById('svc-note').textContent })`))
    check(v.cartes.join('|') === 'Vercel' && /GitHub, Stripe/.test(v.note), `services : ${JSON.stringify(v)}`)
    // Retour à Nuage
    await js(`document.querySelector('#tabbar [data-view="nuage"]').click()`)
    await pause(300)
    check(await js(`getComputedStyle(document.getElementById('scene')).display !== 'none'`), 'retour à l’onglet Nuage : Nuage ne revient pas')
  })

  server.close()
  if (problems.length) {
    console.error(`test-interface : ÉCHEC\n - ${problems.join('\n - ')}`)
    app.exit(1)
  } else {
    console.log('test-interface : OK (démarrage sans erreur avec le plugin, recherche et rapport sans adresse, association par « Trouver mon PC », aucune adresse visible, écran associé, chat, coucou, onglets Agents et Services, demande approuvée, détail de session, message dans la session, discussion Gemini et « Demande à Gemini »)')
    app.exit(0)
  }
})

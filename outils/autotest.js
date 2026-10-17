// Auto-test : déclenche les principaux événements, capture la fenêtre, puis quitte.
// Usage (PowerShell) : $env:NUAGE_AUTOTEST_DIR = '<dossier>'; npx electron .
// Résultats : <dossier>\resultats.txt et des captures PNG. Réglages isolés dans <dossier>\userdata.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

module.exports = function autotest({
  app, getWindow, getPanel, togglePanel, send, swallow, restoreLastSwallowed, protectedReason,
  getEncoche, openChat, finishDrag, setChatHint, isNuageInBar, toggleVisible, moveIsland, chatZonePoint, openSettings, getToken,
  getDownloadToken, showPhoneQr, openPhoneMenu, phoneState, showPhoneState, voiceEvent, phoneApi,
}) {
  const dir = process.env.NUAGE_AUTOTEST_DIR
  const lines = []
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const web = () => getWindow().webContents

  const state = () => web().executeJavaScript(`({
    mood: document.body.dataset.mood || '-',
    glow: document.body.dataset.glow || '-',
    bubble: (document.querySelector('.bubble.show')?.textContent ?? '') +
      (document.body.classList.length ? '  [' + document.body.className + ' | son=' + (document.body.dataset.audio || '-') + ']' : ''),
    timer: !document.getElementById('np').hidden ? 'barre: ' + document.getElementById('np-text').textContent
      : document.getElementById('timer').hidden ? '' : document.getElementById('timer').textContent,
  })`)
  const shot = async name => {
    const image = await web().capturePage()
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG())
  }
  const step = async (label, action, ms = 1200) => {
    if (action) await action()
    await wait(ms)
    const s = await state()
    lines.push(`${label.padEnd(20)} | ${s.mood.padEnd(10)} | glow=${s.glow.padEnd(6)} | ${s.timer.padEnd(11)} | ${s.bubble}`)
  }
  const clickAvatar = async () => {
    const { x, y } = await web().executeJavaScript(`(() => {
      const r = document.getElementById('stage').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    web().sendInputEvent({ type: 'mouseMove', x, y })
    web().sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    web().sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  const errors = []
  // Erreurs de Nuage et de l'encoche (où vit le chat)
  for (const [who, contents] of [['nuage', web()], ['encoche', getEncoche()?.webContents]]) {
    if (!contents) continue
    contents.on('console-message', (event, legacyLevel, legacyMessage) => {
      const level = event.level ?? legacyLevel
      if (level === 'error' || level === 3) errors.push(`${who} : ${event.message ?? legacyMessage}`)
    })
    contents.on('did-fail-load', (_e, code, description) => errors.push(`${who}, chargement : ${code} ${description}`))
    contents.on('render-process-gone', (_e, details) => errors.push(`${who}, rendu arrêté : ${details.reason}`))
  }

  // NUAGE_AUTOTEST_PART=vie : seulement la météo sur le corps, la vie et les téléchargements (rapide)
  const quick = process.env.NUAGE_AUTOTEST_PART === 'vie'
  // Refonte à la Coucou (06/10/2026) : accueil (session + pastilles), autorisation, question, fin, « tête qui
  // tourne », téléphone, avec de fausses données envoyées à l'encoche (les vraies reviennent au prochain changement)
  async function designShots(enc, shotE, etat) {
    const now = Date.now()
    const step = (id, kind, iconName, label, done = true, ago = 0) => ({ id, kind, icon: iconName, label, done, error: false, at: now - ago })
    const sessions = [
      {
        id: 'k1', title: 'korus', project: 'korus', status: 'en-cours', lastAt: now - 4000, cwd: 'C:\\korus', waiting: '',
        steps: [step('s5', 'commande', 'terminal-window', 'Exécute : npm test', false), step('s4', 'edition', 'pencil-simple', 'Modifie billing.ts (+1 −1)', true, 9000), step('s3', 'lecture', 'book-open-text', 'Lit billing.ts', true, 15000), step('s0', 'demande', 'chat-circle-text', 'Ta demande : corrige l’arrondi de la TVA', true, 20000)],
        files: [{ path: 'C:\\korus\\src\\billing.ts', name: 'billing.ts', added: 1, removed: 1 }],
      },
      { id: 'p1', title: 'portfolio', project: 'portfolio', status: 'termine', lastAt: now - 120_000, cwd: 'C:\\portfolio', waiting: '', steps: [], files: [] },
      { id: 'b1', title: 'sbe-hub', project: 'sbe-hub', status: 'attente', lastAt: now - 30_000, cwd: 'C:\\sbe', waiting: 'Claude attend ta réponse', steps: [], files: [] },
    ]
    const usage = { fiveHour: { pct: 62, resetsAt: now + 2 * 3600_000 }, sevenDay: { pct: 19, resetsAt: now + 4 * 86_400_000 }, updatedAt: now - 60_000 }
    enc.send('integrations', [
      { id: 'github', label: 'GitHub', status: 'ok', badge: '2 PR', lines: [{ text: 'korus#42 · Corrige la TVA', tone: 'bon' }, { text: 'CI de main : verte', tone: 'bon' }] },
      { id: 'vercel', label: 'Vercel', status: 'ok', lines: [{ text: 'korus · prêt · il y a 2 min', tone: 'bon' }, { text: 'portfolio · échoué', tone: 'mauvais' }] },
    ])
    enc.send('telephone', { devices: [{ id: 'tel', nom: 'Pixel 7 Pro', lastSeen: now, etat: { batterie: 82, charge: false, android: '17', version: '1.9.1' } }], history: [{ sens: 'recu', texte: 'https://maps.example/restaurant', source: 'menu', at: now - 300_000 }], transfers: [], linkOn: true, clipboardShare: 'auto', notifyClaude: true, notifyDownloads: true, apk: true })
    const snap = permissions => ({ sessions, permissions, usage, active: 1, permissionsInNuage: true })
    enc.send('encoche:hover', true) // la souris « reste » sur l'îlot : il ne se replie pas pendant les captures
    enc.send('agents', snap([]))
    await enc.executeJavaScript(`document.querySelector('.tabs button[data-tab="agents"]').click()`)
    await wait(900)
    await etat('accueil (session + pastilles)')
    lines.push(`accueil, carte de gauche : ${(await enc.executeJavaScript(`document.getElementById('home-left').innerText.replace(/\\s+/g, ' ')`)).slice(0, 140)}`)
    lines.push(`accueil, pastilles : ${await enc.executeJavaScript(`[...document.querySelectorAll('#home-right .pill .lbl')].map(l => l.textContent).join(' | ')`)}`)
    await shotE('d1-accueil')
    // Clic sur la pastille « korus » : elle devient la session suivie (défilé de ses étapes)
    await enc.executeJavaScript(`[...document.querySelectorAll('#home-right .pill')].find(p => p.textContent === 'korus')?.click()`)
    await wait(900)
    // Les trois boutons (chat, activité, appli) sous la rangée des fichiers, sans la toucher
    lines.push(`boutons de la session : ${await enc.executeJavaScript(`(() => {
      const f = document.querySelector('#home-left .files-line').getBoundingClientRect()
      const j = document.querySelector('#home-left .jump').getBoundingClientRect()
      const c = document.getElementById('home-left').getBoundingClientRect()
      return 'fichiers ' + Math.round(f.top) + '–' + Math.round(f.bottom) + ', boutons ' + Math.round(j.top) + '–' + Math.round(j.bottom) + ', carte jusqu’à ' + Math.round(c.bottom) + (j.top >= f.bottom + 4 ? ' : séparés' : ' : SE TOUCHENT')
    })()`)}`)
    await enc.executeJavaScript(`document.querySelector('#home-left .jump').style.opacity = '1'`) // visibles pour la capture (sinon au survol)
    await shotE('d1b-accueil-korus')
    await enc.executeJavaScript(`document.querySelector('#home-left .jump').style.opacity = ''`)
    await enc.executeJavaScript(`document.getElementById('usage-head').click()`)
    await wait(700)
    await shotE('d2-limites')
    await enc.executeJavaScript(`[...document.querySelectorAll('#home-right .pill')].find(p => p.textContent === 'Vercel')?.click()`)
    await wait(700)
    await shotE('d3-integration')
    const perm = { id: 'perm-test', sessionId: 'k1', title: 'korus', tool: 'Bash', label: 'Exécute : npx prisma migrate deploy', command: 'npx prisma migrate deploy', always: 'les commandes « npx … »', createdAt: now, expiresAt: now + 45_000 }
    enc.send('agents', snap([perm]))
    await wait(1100)
    await etat('autorisation')
    lines.push(`autorisation : ${(await enc.executeJavaScript(`document.getElementById('alert-card').innerText.replace(/\\s+/g, ' ')`)).slice(0, 160)}`)
    await shotE('d4-autorisation')
    const question = { ...perm, id: 'q-test', tool: 'AskUserQuestion', label: 'Te pose une question', command: '', questions: [{ question: 'Quel moteur pour la recherche de cours ?', options: [{ label: 'Postgres full-text' }, { label: 'Meilisearch' }, { label: 'Algolia' }] }] }
    enc.send('agents', snap([question]))
    await wait(1100)
    await shotE('d5-question')
    enc.send('agents', snap([]))
    await wait(400)
    await enc.executeJavaScript(`encocheTest.finished()`)
    await wait(1100)
    await etat('fin de session')
    await shotE('d6-termine')
    await enc.executeJavaScript(`encocheTest.dizzy()`)
    await wait(900)
    await shotE('d7-tete-qui-tourne')
    await wait(3500)
    await enc.executeJavaScript(`document.querySelector('.tabs button[data-tab="agents"]').click()`)
    await wait(500)
    await enc.executeJavaScript(`[...document.querySelectorAll('#home-right .pill')].find(p => p.textContent === 'Pixel 7 Pro')?.click()`)
    await wait(900)
    await etat('téléphone')
    await shotE('d8-telephone')
    // Nuage glouton : il vole vers la case « Par e-mail », bouche ouverte, puis avale le fichier (sans lancer l'action)
    await enc.executeJavaScript(`encocheTest.dropDemo('email')`)
    await wait(800)
    await etat('dépôt : Nuage au-dessus de « Par e-mail »')
    lines.push(`dépôt, Nuage : ${await enc.executeJavaScript(`document.getElementById('eater').className + ' | bouche ouverte : ' + getComputedStyle(document.querySelector('.e-mouth')).transform`)}`)
    await shotE('d10-depot-survol')
    await enc.executeJavaScript(`encocheTest.dropDemoSwallow('email'); 1`)
    await wait(440)
    await shotE('d11-depot-avale')
    await wait(900)
    await etat('dépôt fini')
    enc.send('encoche:hover', false)
    await enc.executeJavaScript(`encocheTest.fold()`)
    await wait(900)
    enc.send('agents', snap([]))
    await wait(600)
    await etat('pilule : pastilles actives')
    await shotE('d9-pilule-pastilles')
    enc.send('agents', { sessions: [], permissions: [], usage: null, active: 0, permissionsInNuage: true })
    enc.send('integrations', [])
    await enc.executeJavaScript(`document.querySelector('.tabs button[data-tab="chat"]').click()`)
    await wait(400)
  }

  // NUAGE_AUTOTEST_PART=encoche : Nuage habite l'encoche (06/10/2026) — pilule réduite toujours là, météo,
  // bulles relayées par la fenêtre du bureau (cachée), Nuage qui apparaît à l'ouverture, repas, Ctrl+Alt+N
  async function encocheHome() {
    const enc = getEncoche().webContents
    const shotE = async name => fs.writeFileSync(path.join(dir, `${name}.png`), (await enc.capturePage()).toPNG())
    const etat = async label => lines.push(`${label.padEnd(36)} | ${JSON.stringify(await enc.executeJavaScript('etatEncoche()'))}`)
    const clickPill = () => enc.executeJavaScript(`(() => {
      const at = { bubbles: true, cancelable: true, button: 0, pointerId: 7, screenX: 10, screenY: 10 }
      document.getElementById('status').dispatchEvent(new PointerEvent('pointerdown', at))
      document.getElementById('status').dispatchEvent(new PointerEvent('pointerup', at))
    })()`)
    lines.push(`fenêtre de Nuage sur le bureau visible : ${getWindow().isVisible()} (attendu : false, il habite l'encoche)`)
    enc.send('weather', { key: 'pluie', label: 'Pluie', night: false, temp: 24, place: 'Lyon' })
    // Aucune session Claude Code en cours (le PC de test en a souvent une : celle qui lance ce test)
    enc.send('agents', { sessions: [], permissions: [], usage: null, active: 0, permissionsInNuage: true })
    await wait(1500)
    await etat('repos : pilule réduite + météo')
    await shotE('h1-pilule-reduite')
    lines.push(`à droite de la pilule : « ${await enc.executeJavaScript(`document.getElementById('pill-right').textContent`)} »`)
    // Une notification du PC : envoyée à la fenêtre du bureau, qui la relaie à l'encoche
    send('notice', '📱 Coucou depuis l’auto-test : cette bulle passe par l’encoche.')
    await wait(1000)
    await etat('bulle courte')
    await shotE('h2-bulle')
    send('notice', '📱 Le téléphone essaie de me joindre avec un ancien QR code : dans l’appli, « Oublier ce PC », puis rescanne le QR code (menu Téléphone, Associer).')
    await wait(1000)
    await etat('bulle longue (plusieurs lignes)')
    await shotE('h3-bulle-longue')
    await wait(6500)
    await etat('bulle finie : de nouveau réduite')
    // Clic sur la pilule : le panneau s'ouvre, Nuage apparaît dans la colonne, à côté des onglets
    await clickPill()
    await wait(1400)
    await etat('ouvert au clic')
    lines.push(`Nuage dans la colonne : ${await enc.executeJavaScript(`document.querySelector('#bot-avatar svg') ? 'oui' : 'non'`)}`)
    await shotE('h4-ouvert-nuage')
    send('notice', '✅ Une bulle pendant que le panneau est ouvert.')
    await wait(900)
    lines.push(`bulle dans le panneau ouvert : « ${await enc.executeJavaScript(`document.getElementById('toast-line').hidden ? '(cachée)' : document.getElementById('toast-line').textContent`)} »`)
    await shotE('h5-bulle-panneau')
    await designShots(enc, shotE, etat)
    // Repli (Échap) : il rentre dans la pilule
    await enc.executeJavaScript(`encocheTest.fold()`)
    await wait(1200)
    await etat('fermé (Échap)')
    lines.push(`Nuage dans la colonne après fermeture : ${await enc.executeJavaScript(`document.querySelector('#bot-avatar svg') ? 'encore là' : 'rentré dans la pilule'`)}`)
    // Ctrl+Alt+N : ouvre l'encoche, puis la referme
    toggleVisible()
    await wait(1200)
    await etat('Ctrl+Alt+N (ouvre)')
    toggleVisible()
    await wait(1200)
    await etat('Ctrl+Alt+N (referme)')
    // Repas depuis l'encoche (cible « Donner à Nuage ») : un fichier de test va à la corbeille, puis revient
    const food = path.join(dir, 'a-manger-encoche.txt')
    fs.writeFileSync(food, 'miam')
    await enc.executeJavaScript(`encocheTest.feed(${JSON.stringify([food])})`)
    await wait(900)
    await etat('repas')
    await shotE('h6-repas')
    lines.push(`fichier encore là : ${fs.existsSync(food)} (attendu : false, dans la corbeille)`)
    await clickPill() // clic sur la bulle « Clique pour annuler »
    await wait(4000)
    lines.push(`après annulation, fichier revenu : ${fs.existsSync(food)} | pilule : ${await enc.executeJavaScript(`document.getElementById('status').textContent`)}`)
    try {
      fs.unlinkSync(food)
    } catch {}
    // Zone de dépôt : quatre cibles (avec « Donner à Nuage »)
    await enc.executeJavaScript(`document.getElementById('drop').hidden = false`)
    await wait(400)
    lines.push(`cibles de dépôt : ${await enc.executeJavaScript(`[...document.querySelectorAll('.drop-target')].filter(t => !t.hidden).map(t => t.querySelector('b').textContent).join(' | ')`)}`)
    await shotE('h7-depot')
    await enc.executeJavaScript(`document.getElementById('drop').hidden = true`)
    // 32 s sans rien : la pilule ne rentre plus dans le bord de l'écran
    enc.send('encoche:hover', false)
    await wait(32_000)
    await etat('32 s plus tard (toujours là)')
    await shotE('h8-toujours-la')
    // Agents vus du téléphone (v1.9) : résumé, détail inconnu, réponse à une demande qui n'existe plus
    const tel = { id: 'telephone-autotest', nom: 'Pixel de test' }
    const resume = await phoneApi('agents-etat', {}, tel)
    lines.push(`téléphone, agents-etat : ${resume.resume.titre} · ${resume.resume.texte} | aujourd’hui ${JSON.stringify(resume.aujourdhui)} | ${resume.sessions.length} session(s)`)
    for (const [nom, donnees] of [['agents-session', { id: 'inconnue' }], ['agents-repondre', { id: 'perm-0', choix: 'allow' }], ['agents-repondre', { id: 'perm-0', choix: 'n-importe' }]]) {
      try {
        await phoneApi(nom, donnees, tel)
        lines.push(`téléphone, ${nom} : accepté (inattendu)`)
      } catch (error) {
        lines.push(`téléphone, ${nom} ${JSON.stringify(donnees)} → refusé : ${error.message}`)
      }
    }
    // Tout est calme (aucune session, aucune bulle) : la pilule réduite, portrait à gauche, météo à droite
    enc.send('agents', { sessions: [], permissions: [], usage: null, active: 0, permissionsInNuage: true })
    await wait(500)
    await etat('calme : pilule réduite')
    await shotE('h9-pilule-calme')
    // 2 min sans aucune action (08/10/2026) : elle rentre dans le bord ; la souris sur le trait la ressort
    await enc.executeJavaScript(`{ const vrai = Date.now; Date.now = () => vrai() + 121_000; 1 }`)
    await wait(1200)
    await etat('2 min sans rien : rentrée')
    enc.send('encoche:hover', true)
    await wait(900)
    await etat('souris sur le trait : ressortie')
  }
  app.whenReady().then(async () => {
    try {
      await wait(5000)
      if (process.env.NUAGE_AUTOTEST_PART === 'encoche') {
        await encocheHome()
        throw Object.assign(new Error('fin de la partie encoche'), { quickDone: true })
      }
      await step('démarrage', null, 0)
      await shot('1-demarrage')
      if (quick) await step('clic sur Nuage', clickAvatar)
      if (quick) await shot('2-clic')
      if (!quick) {
      await step('clic sur Nuage', clickAvatar)
      await shot('2-clic')
      await step('rappel pause', () => send('remind', 'pause'))
      await step('rappel eau', () => send('remind', 'eau'))
      await step('pomodoro démarré', () => send('pomodoro', 'start'), 2500)
      await shot('3-pomodoro')
      await step('pomodoro arrêté', () => send('pomodoro', 'stop'))
      await step('somnolent', () => send('idle-state', 'drowsy'))
      await step('endormi', () => send('idle-state', 'asleep'), 1500)
      await shot('4-endormi')
      await step('retour', () => send('idle-state', 'active'))
      await step('verrouillage', () => send('system', 'lock'))
      await step('déverrouillage', () => send('system', 'unlock'))
      await step('curseur à gauche', () => send('cursor', { x: -900, y: 120 }), 1800)
      await shot('6-curseur')
      }
      send('cursor', { x: 200, y: 200 })

      // Météo : sur son corps (peau.js : couleur, effets, température sur le ventre)
      const sky = (key, night, temp) => () => send('weather', { key, label: key, night, temp, place: 'Lyon' })
      const skinLine = async label => {
        const s = await web().executeJavaScript('JSON.stringify(nuageDebug.skin())')
        lines.push(`${''.padEnd(20)} | peau (${label}) : ${s}`)
      }
      await step('météo pluie', sky('pluie', false, 24), 2500)
      await skinLine('pluie')
      await shot('7-pluie')
      await step('météo orage', sky('orage', false, 23), 2500)
      await shot('8-orage')
      await step('météo neige', sky('neige', false, -2), 2500)
      await shot('9-neige')
      await step('météo brouillard', sky('brouillard', false, 19), 2000)
      await shot('9b-brouillard')
      await step('météo nuit claire', sky('soleil', true, 22), 2500)
      await shot('10-nuit')
      await step('météo soleil', sky('soleil', false, 31), 2500)
      await skinLine('soleil')
      await shot('11-soleil')
      // Vie : il penche quand on le glisse (vitesse simulée, aucune vraie souris), petites actions
      await web().executeJavaScript('nuageDebug.simulate({ vx: 1400, vy: -350 })')
      await wait(700)
      lines.push(`glisser simulé : ${await web().executeJavaScript('JSON.stringify(nuageDebug.life())')}`)
      await shot('11b-glisse-penche')
      await web().executeJavaScript('nuageDebug.simulate(null)')
      await wait(1500)
      lines.push(`après le lâcher : ${await web().executeJavaScript('JSON.stringify(nuageDebug.life())')}`)
      // Vraie fenêtre déplacée vers la gauche par le processus principal : il doit pencher dans l'autre sens
      await web().executeJavaScript('nuageDebug.simulate({ window: true })')
      const home = getWindow().getBounds()
      for (let i = 1; i <= 14; i++) {
        getWindow().setPosition(home.x - i * 18, home.y)
        await wait(16)
      }
      lines.push(`fenêtre glissée à gauche : ${await web().executeJavaScript('JSON.stringify(nuageDebug.life())')}`)
      getWindow().setPosition(home.x, home.y)
      await web().executeJavaScript('nuageDebug.simulate(null)')
      await wait(1200)
      for (const [action, ms, name] of [['saut', 380, '11c-saut'], ['pirouette', 700, '11d-pirouette'], ['souffle', 900, '11e-souffle'], ['etirement', 600, '11f-etirement']]) {
        await web().executeJavaScript(`nuageDebug.idle(${JSON.stringify(action)})`)
        await wait(ms)
        await shot(name)
        await wait(1800)
      }
      await web().executeJavaScript(`nuageDebug.emote('coeur')`)
      await wait(500)
      await shot('11g-coeurs')
      await wait(1500)

      if (!quick) {
      // Musique (Nuage danse) puis vidéo en plein écran (mode cinéma), pause et arrêt
      const play = (kind, title, artist, app, fullscreen, status = 'playing') => () =>
        send('media', { kind, playing: status === 'playing', status, title, artist, app, fullscreen })
      await step('musique', play('music', 'Morceau de test', 'Artiste de test', 'Spotify', false), 4000)
      await shot('14-musique')
      await step('musique (danse)', null, 1500)
      await shot('15-danse')
      await step('musique en pause', play('music', 'Morceau de test', 'Artiste de test', 'Spotify', false, 'paused'), 4000)
      await step('vidéo', play('video', 'Bande-annonce de test', 'Chaîne', 'Chrome', false), 6000)
      await shot('16-video')
      await step('vidéo plein écran', play('video', 'Bande-annonce de test', 'Chaîne', 'Chrome', true), 2000)
      await shot('17-cinema')
      await step('vidéo en pause', play('video', 'Bande-annonce de test', 'Chaîne', 'Chrome', false, 'paused'), 4500)
      await step('plus de média', () => send('media', null), 1500)
      }

      // Téléchargements : comme les enverrait l'extension du navigateur (serveur local, vrai chemin),
      // puis sans taille finale (dossier Téléchargements seul)
      const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-dl-'))
      const dlFile = path.join(dlDir, 'film-de-test.mp4')
      const postDownload = (items, token = getDownloadToken()) => fetch('http://127.0.0.1:47823/telechargement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nuage-Jeton': token },
        body: JSON.stringify({ items }),
      })
      lines.push(`téléchargement, jeton de Claude Code refusé : HTTP ${(await postDownload([], getToken())).status}`)
      const dlLine = async label => {
        const s = await state()
        const skinState = JSON.parse(await web().executeJavaScript('JSON.stringify(nuageDebug.skin())'))
        const arrow = await web().executeJavaScript(`getComputedStyle(document.getElementById('dl-arrow')).display === 'none' ? 'cachée' : 'visible'`)
        lines.push(`${label.padEnd(20)} | ${s.mood.padEnd(10)} | eau ${Math.round(skinState.level * 100)} % | ventre « ${skinState.label} » | flèche ${arrow} | ${s.bubble}`)
      }
      await postDownload([{ id: 1, path: dlFile, received: 25_000_000, total: 100_000_000, state: 'in_progress' }])
      await wait(1800)
      await dlLine('téléchargement 25 %')
      await shot('30-telechargement-25')
      // La flèche figée à mi-chute (bulle cachée) pour la voir sur la capture
      await web().executeJavaScript(`(() => {
        document.querySelector('.bubble').classList.remove('show')
        const a = document.getElementById('dl-arrow').getAnimations()[0]
        if (a) { a.pause(); a.currentTime = 560 }
      })()`)
      await wait(150)
      await shot('30b-fleche')
      await web().executeJavaScript(`document.getElementById('dl-arrow').getAnimations()[0]?.play()`)
      await postDownload([{ id: 1, path: dlFile, received: 72_000_000, total: 100_000_000, state: 'in_progress' }])
      await wait(1800)
      await dlLine('téléchargement 72 %')
      await shot('31-telechargement-72')
      fs.writeFileSync(dlFile, 'film')
      await postDownload([{ id: 1, path: dlFile, received: 100_000_000, total: 100_000_000, state: 'complete', size: 100_000_000 }])
      await wait(900)
      await dlLine('téléchargement fini')
      await shot('32-telechargement-fini')
      await wait(3500)
      await dlLine('fini + 4 s')
      send('download', { type: 'progress', count: 1, name: 'archive.zip', received: 12_400_000, total: null, percent: null, speed: 900_000, startedAt: Date.now() })
      await wait(1800)
      await dlLine('sans taille finale')
      await shot('33-telechargement-sans-total')
      send('download', { type: 'cancel', name: 'archive.zip' })
      send('download', { type: 'idle' })
      await wait(1500)
      await dlLine('annulé')
      fs.rmSync(dlDir, { recursive: true, force: true })
      if (quick) {
        // Capsules de verre et icônes : musique (avec bulle icône), puis vidéo
        send('media', { kind: 'music', playing: true, status: 'playing', title: 'Morceau de test', artist: 'Artiste de test', app: 'Spotify', fullscreen: false })
        send('notice', '🎵 « Morceau de test » : je danse !')
        await wait(2500)
        await step('capsules musique', null, 0)
        await shot('12b-capsules-musique')
        send('media', { kind: 'video', playing: true, status: 'playing', title: 'Bande-annonce de test', artist: '', app: 'Chrome', fullscreen: false })
        send('notice', '🍿 On regarde « Bande-annonce de test » ? Je m’installe !')
        await wait(2000)
        await step('capsule vidéo', null, 0)
        await shot('12c-capsule-video')
        send('media', null)
        await wait(800)
        // Lien avec le téléphone : fichier reçu (même animation), puis envoi (flèche vers le haut)
        send('download', { type: 'progress', source: 'telephone', count: 1, name: 'photo-du-tel.jpg', received: 600_000, total: 1_500_000, percent: 40, exact: true, startedAt: Date.now() })
        await wait(1500)
        await dlLine('reçu du téléphone')
        await shot('34-recu-du-telephone')
        send('download', { type: 'done', source: 'telephone', name: 'photo-du-tel.jpg', size: 1_500_000, path: path.join(os.tmpdir(), 'inexistant.jpg'), from: 'Pixel de test' })
        await wait(900)
        await dlLine('reçu, fini')
        await wait(3000)
        send('download', { type: 'progress', source: 'envoi', count: 1, name: 'rapport.pdf', received: 300_000, total: 1_000_000, percent: 30, exact: true, startedAt: Date.now() })
        await wait(1500)
        await dlLine('envoi au téléphone')
        await shot('35-envoi-au-telephone')
        send('download', { type: 'done', source: 'envoi', name: 'rapport.pdf', size: 1_000_000, to: 'Pixel de test' })
        await wait(900)
        await dlLine('envoi fini')
        // QR codes du téléphone, dans le menu Téléphone de la barre (08/10/2026 : plus de fenêtre à part)
        const encQr = getEncoche().webContents
        await showPhoneQr('associer')
        await wait(1500)
        fs.writeFileSync(path.join(dir, '36-qr-associer.png'), (await encQr.capturePage()).toPNG())
        lines.push(`QR d’association dans la barre : ${await encQr.executeJavaScript(`document.getElementById('telephone').innerText.replace(/\\s+/g, ' ').slice(0, 160) + (document.querySelector('.ph-qr') ? ' [QR affiché]' : ' [PAS de QR]')`)}`)
        await showPhoneQr('installer')
        await wait(1200)
        fs.writeFileSync(path.join(dir, '37-qr-installer.png'), (await encQr.capturePage()).toPNG())
        lines.push(`QR d’installation dans la barre : ${await encQr.executeJavaScript(`document.querySelector('.ph-qr') ? 'QR affiché' : 'PAS de QR'`)}`)
        await encQr.executeJavaScript(`document.querySelector('#telephone .ph-head .icon-btn')?.click()`)
        // Aperçu de l'écran du téléphone (Nuage de poche, mode démonstration), à la taille d'un téléphone
        const { BrowserWindow } = require('electron')
        // Rendu hors écran : les animations tournent (une fenêtre cachée n'en joue aucune)
        const phone = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { sandbox: true, offscreen: true } })
        phone.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
          const level = event.level ?? legacyLevel
          if (level === 'error' || level === 3) errors.push(`téléphone : ${event.message ?? legacyMessage}`)
        })
        await phone.loadFile(path.join(__dirname, '..', 'mobile', 'www', 'index.html'), { query: { demo: '1' } })
        await wait(3500)
        fs.writeFileSync(path.join(dir, '38-telephone-accueil.png'), (await phone.webContents.capturePage()).toPNG())
        await phone.webContents.executeJavaScript(`demo.onTransfer({ sens: 'recu', nom: 'rapport.pdf', taille: 2000000, fait: 900000 })`)
        await wait(1500)
        fs.writeFileSync(path.join(dir, '39-telephone-reception.png'), (await phone.webContents.capturePage()).toPNG())
        await phone.webContents.executeJavaScript(`demo.setState({ associe: false, connecte: false })`)
        await wait(500)
        fs.writeFileSync(path.join(dir, '40-telephone-associer.png'), (await phone.webContents.capturePage()).toPNG())
        phone.close()
        await step('endormi', () => send('idle-state', 'asleep'), 2600)
        await shot('4-endormi')
        await step('retour', () => send('idle-state', 'active'))
        throw Object.assign(new Error('partie « vie » terminée'), { quickDone: true })
      }

      // Glisser-déposer : bouche ouverte au survol, puis dépôt d'un faux fichier (sans chemin réel)
      const dragEvent = (type, extra = '') => () => web().executeJavaScript(`(() => {
        const dt = new DataTransfer()
        dt.items.add(new File(['x'], 'photo-test.jpg', { type: 'image/jpeg' }))
        dispatchEvent(new DragEvent('${type}', { dataTransfer: dt, bubbles: true, cancelable: true ${extra} }))
      })()`)
      await step('fichier survolé', dragEvent('dragenter'), 1200)
      await shot('18-bouche')
      await step('faux fichier lâché', dragEvent('drop', ', clientX: 60, clientY: 200'), 2500)

      // Corbeille réelle sur un fichier temporaire créé pour le test, puis annulation
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuage-repas-'))
      const food = path.join(tmpDir, 'à-manger.txt')
      fs.writeFileSync(food, 'miam')
      const eaten = await swallow([food])
      lines.push(`corbeille : ${JSON.stringify(eaten)} | fichier encore là : ${fs.existsSync(food)}`)
      const undone = await restoreLastSwallowed()
      lines.push(`annulation : ${JSON.stringify(undone)} | fichier revenu : ${fs.existsSync(food)}`)
      fs.rmSync(tmpDir, { recursive: true, force: true })
      const appDir = path.resolve(__dirname, '..')
      for (const p of [os.homedir(), 'C:\\', path.dirname(appDir), path.join(process.env.windir, 'notepad.exe'),
        path.join(appDir, 'main.js'), path.join(os.homedir(), 'Desktop', 'une-photo.jpg')]) {
        lines.push(`protégé ? ${p} -> ${protectedReason(p) || 'non'}`)
      }

      // Tableau de bord avec les vraies données (météo)
      togglePanel()
      await wait(8000)
      const panelImage = await getPanel().webContents.capturePage()
      fs.writeFileSync(path.join(dir, '13-tableau-de-bord.png'), panelImage.toPNG())
      const panelText = await getPanel().webContents.executeJavaScript('document.querySelector(".card").innerText')
      lines.push('--- tableau de bord ---', panelText)
      // ---------- Encoche et agents : requêtes comme celles de Claude Code ----------
      const post = (url, body, token = getToken()) => fetch(`http://127.0.0.1:47823${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nuage-Jeton': token },
        body: JSON.stringify(body),
      })
      lines.push(`serveur, mauvais jeton : HTTP ${(await post('/hook', {}, 'faux-jeton')).status}`)
      const soon = Math.round(Date.now() / 1000) + 3600
      await post('/statusline', {
        model: { display_name: 'Opus 5.5' },
        context_window: { used_percentage: 42 },
        rate_limits: { five_hour: { used_percentage: 23.5, resets_at: soon }, seven_day: { used_percentage: 41.2, resets_at: soon + 86400 * 3 } },
      })
      const permission = post('/hook', {
        hook_event_name: 'PermissionRequest', session_id: 'session-autotest', cwd: 'C:\\Projet\\Demo',
        tool_name: 'Bash', tool_input: { command: 'npm install --save-dev vitest', description: 'Installe vitest' },
      })
      await wait(2500)
      const encoche = getEncoche()
      fs.writeFileSync(path.join(dir, '19-encoche-autorisation.png'), (await encoche.webContents.capturePage()).toPNG())
      lines.push('--- encoche (extrait) ---', (await encoche.webContents.executeJavaScript('document.body.innerText')).slice(0, 900))
      await encoche.webContents.executeJavaScript(`document.querySelector('#alert-card .btn.primary')?.click()`)
      lines.push(`réponse renvoyée à Claude Code : ${JSON.stringify(await (await permission).json())}`)

      // ---------- Chat dans l'encoche : Nuage glissé vers le haut, sans clé, Ollama absent ----------
      // (fonctions du processus principal : la vraie souris n'est jamais utilisée)
      const enc = encoche.webContents
      const encLine = async label => {
        const s = await enc.executeJavaScript(`({
          mode: document.body.dataset.mode,
          tab: document.querySelector('.tabs button.on')?.dataset.tab || '-',
          chat: document.getElementById('pane-chat').classList.contains('on'),
          bar: document.getElementById('status').textContent,
          why: JSON.stringify(etatEncoche()),
        })`)
        lines.push(`${label.padEnd(30)} | mode=${s.mode} onglet=${s.tab} chat visible=${s.chat} | pilule « ${s.bar} »`)
        lines.push(`${''.padEnd(30)} | ${s.why}`)
      }
      const encShot = async name => fs.writeFileSync(path.join(dir, `${name}.png`), (await enc.capturePage()).toPNG())
      // Survol simulé (message du processus principal, sans souris) : la pilule ne doit PAS s'ouvrir
      await wait(5000) // après l'autorisation, l'îlot se replie de lui-même (4 s)
      await encLine('avant survol')
      await encShot('19b-pilule')
      enc.send('encoche:hover', true)
      await wait(1500)
      await encLine('survol seul (doit rester fermé)')
      // Clic sur la pilule (appui puis relâchement sans bouger) : le panneau s'ouvre
      const clickPill = () => enc.executeJavaScript(`(() => {
        const island = document.getElementById('island')
        const at = { bubbles: true, cancelable: true, button: 0, pointerId: 7, screenX: 10, screenY: 10 }
        document.getElementById('status').dispatchEvent(new PointerEvent('pointerdown', at))
        document.getElementById('status').dispatchEvent(new PointerEvent('pointerup', at))
      })()`)
      await clickPill()
      await wait(900)
      await encLine('clic sur la pilule')
      await encShot('19c-ouvert-au-clic')
      // La souris s'en va (rien n'est en cours de saisie) : il se replie au bout de 4 s
      enc.send('encoche:hover', false)
      await wait(6000)
      await encLine('souris partie depuis 6 s')
      setChatHint(true)
      await wait(800)
      await encLine('Nuage glissé vers la barre')
      fs.writeFileSync(path.join(dir, '20-encoche-lache-ici.png'), (await enc.capturePage()).toPNG())
      setChatHint(false)
      const zone = chatZonePoint()
      lines.push(`lâché au milieu de l'écran → « ${finishDrag(zone.middle, false)} »`)
      await wait(1200)
      await encLine('après lâcher au milieu')
      // En haut à gauche, loin de la barre : il s'y pose (avant le 04/10/2026, il replongeait dans la barre)
      lines.push(`lâché en haut à gauche → « ${finishDrag(zone.corner, false)} » (attendu : vide, il se pose)`)
      await wait(800)
      // Lâché en haut : Nuage plonge dans la barre (sa fenêtre disparaît) et s'y anime
      lines.push(`lâché en haut de l'écran → « ${finishDrag(zone.top, false)} »`)
      await wait(180)
      await shot('21a-nuage-plonge')
      await wait(1600)
      await encLine('Nuage dans la barre')
      lines.push(`fenêtre de Nuage visible : ${getWindow().isVisible()} | dans la barre : ${isNuageInBar()}`)
      await encShot('21-nuage-dans-la-barre')
      // Horizon de la carte : couleur de la météo (pluie simulée) quand tout est calme
      enc.send('weather', { key: 'pluie', label: 'Pluie', night: false, temp: 24, place: 'Lyon' })
      await wait(2500)
      await encShot('21d-nuage-dans-la-barre-repos')
      lines.push(`vue : ${await enc.executeJavaScript(`document.body.dataset.view + ' | état : ' + document.body.dataset.buddy + ' | pilule à droite : ' + document.getElementById('pill-right').textContent`)}`)
      // La souris part : la barre reste ouverte tant que Nuage y vit
      enc.send('encoche:hover', false)
      await wait(5500)
      await encLine('Nuage dedans, souris partie')
      // Fermer la barre (▴) : il saute dehors et atterrit juste sous la barre
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(1200)
      await encLine('barre fermée')
      const nuage = getWindow().getBounds()
      lines.push(`fenêtre de Nuage visible : ${getWindow().isVisible()} | dans la barre : ${isNuageInBar()} | position : x ${nuage.x}, y ${nuage.y}`)
      await wait(600)
      await shot('22-nuage-ressorti')
      // Déplacer la barre : posée au milieu de l'écran (flottante), puis en bas (s'ouvre vers le haut)
      moveIsland({ cx: zone.middle.x - 250, top: zone.middle.y - 120 })
      await wait(900)
      await encLine('barre posée au milieu')
      await encShot('23a-barre-flottante')
      await clickPill()
      await wait(1100)
      await encLine('flottante, ouverte au clic')
      await encShot('23b-barre-flottante-ouverte')
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(800)
      moveIsland({ cx: zone.middle.x + 250, top: zone.middle.y * 2 - 80 })
      await wait(900)
      await clickPill()
      await wait(1100)
      await encLine('en bas, ouverte (vers le haut)')
      await encShot('23c-barre-en-bas-ouverte')
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(800)
      moveIsland(null)
      await wait(900)
      await encLine('remise en haut au centre')
      // Menu Téléphone (04/10/2026) : sans téléphone, puis un téléphone de démonstration (rien n'est envoyé)
      openPhoneMenu()
      await wait(1400)
      await encShot('29a-telephone-aucun')
      const phoneText = () => enc.executeJavaScript(`document.getElementById('telephone').innerText.replace(/\\s+/g, ' ')`)
      lines.push(`menu téléphone (aucun) : ${(await phoneText()).slice(0, 160)}`)
      const demoDevice = { id: 'demo', nom: 'Galaxy A55', modele: 'SM-A556B', online: true, lastSeen: Date.now(), pairedAt: Date.now() - 86_400_000, etat: { batterie: 82, charge: true, version: '1.1', android: '15', bulle: true } }
      const demoPhone = {
        ...phoneState(), devices: [demoDevice], linkOn: true, running: true,
        history: [
          { sens: 'recu', texte: 'https://maps.example/restaurant-du-port', longueur: 38, at: Date.now() - 60_000, appareil: 'Galaxy A55', source: 'menu' },
          { sens: 'envoye', texte: 'Rendez-vous à 18 h devant la gare', longueur: 33, at: Date.now() - 300_000, source: 'auto' },
        ],
        transfers: [
          { id: 't1', sens: 'recu', nom: 'photo-plage.jpg', taille: 3_800_000, fait: 1_600_000, etat: 'en-cours', at: Date.now() },
          { id: 't2', sens: 'envoi', nom: 'rapport.pdf', taille: 2_300_000, fait: 2_300_000, etat: 'fini', at: Date.now() - 600_000 },
        ],
      }
      showPhoneState(demoPhone)
      await wait(1300)
      await encShot('29b-telephone-gestion')
      lines.push(`menu téléphone : ${(await phoneText()).slice(0, 300)}`)
      lines.push(`menu téléphone, largeur : ${await enc.executeJavaScript(`(() => { const b = document.getElementById('telephone'); return b.scrollWidth <= b.clientWidth ? 'rien ne dépasse' : 'DÉPASSE de ' + (b.scrollWidth - b.clientWidth) + ' px' })()`)}`)
      showPhoneState({ ...demoPhone, ringing: true, devices: [{ ...demoDevice, online: false, lastSeen: Date.now() - 5 * 60_000, etat: { ...demoDevice.etat, batterie: 12, charge: false } }] })
      await wait(1000)
      await encShot('29c-telephone-sonne-hors-portee')
      // En charge (05/10/2026) : carte illuminée, vague dans les chiffres, petite batterie, « plein dans ~ »
      showPhoneState({ ...demoPhone, devices: [{ ...demoDevice, nom: 'Google Pixel 7 Pro', etat: { ...demoDevice.etat, batterie: 13, charge: false } }] })
      await wait(500)
      showPhoneState({ ...demoPhone, devices: [{ ...demoDevice, nom: 'Google Pixel 7 Pro', etaPlein: 72, etat: { ...demoDevice.etat, batterie: 13, charge: true } }] })
      await wait(1300)
      await encShot('29d-telephone-en-charge')
      lines.push(`en charge : ${(await phoneText()).slice(0, 90)} | pilule : ${await enc.executeJavaScript(`document.getElementById('status').textContent`)}`)
      // Nuage : il se remplit d'énergie, éclairs, puis la capsule ⚡ ; plein ; débranché
      send('phone-charge', { etat: 'branche', niveau: 13, nom: 'Google Pixel 7 Pro', id: 'demo' })
      await wait(450)
      await shot('31a-charge-branche')
      lines.push(`charge, branché : ${await web().executeJavaScript(`document.querySelector('.bubble.show')?.textContent || '(rien)'`)} | capsule : ${await web().executeJavaScript(`document.getElementById('charge').hidden ? 'cachée' : document.getElementById('charge').textContent.trim()`)}`)
      await wait(3600)
      send('phone-charge', { etat: 'charge', niveau: 14, nom: 'Google Pixel 7 Pro', id: 'demo', eta: 70 })
      await wait(700)
      await shot('31b-charge-capsule')
      send('phone-charge', { etat: 'plein', niveau: 100, nom: 'Google Pixel 7 Pro', id: 'demo' })
      await wait(900)
      await shot('31c-charge-plein')
      lines.push(`charge, plein : ${await web().executeJavaScript(`document.querySelector('.bubble.show')?.textContent || '(rien)'`)}`)
      send('phone-charge', { etat: 'debranche', niveau: 100, nom: 'Google Pixel 7 Pro', id: 'demo' })
      await wait(600)
      lines.push(`charge, débranché : capsule ${await web().executeJavaScript(`document.getElementById('charge').hidden ? 'cachée' : 'visible'`)}`)
      showPhoneState(phoneState()) // retour au vrai état (aucun téléphone dans l'auto-test)
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(800)
      // Voix (05/10/2026), simulée : pas de micro (celui de l'utilisateur) ni de son pendant l'auto-test
      voiceEvent({ type: 'reveil' })
      await wait(700)
      voiceEvent({ type: 'partiel', texte: 'quelle heure' })
      await wait(500)
      await shot('30a-voix-ecoute')
      await encShot('30b-voix-pilule')
      lines.push(`voix, écoute : ${await web().executeJavaScript(`document.querySelector('.bubble.show')?.textContent || '(rien)'`)} | pilule : ${await enc.executeJavaScript(`document.getElementById('status').textContent`)}`)
      voiceEvent({ type: 'phrase', texte: 'quelle heure est-il' })
      await wait(500)
      lines.push(`voix, réponse : ${await web().executeJavaScript(`(document.body.classList.contains('talking') ? '[parle] ' : '') + (document.querySelector('.bubble.show')?.textContent || '(rien)')`)}`)
      await shot('30c-voix-reponse')
      await wait(1800)
      lines.push(`voix, après : ${await web().executeJavaScript(`document.body.classList.contains('talking') ? 'parle encore' : 'a fini de parler'`)}`)
      voiceEvent({ type: 'phrase', texte: 'ouvre le menu téléphone' })
      await wait(1500)
      lines.push(`voix, « ouvre le menu téléphone » : onglet ${await enc.executeJavaScript(`document.body.dataset.tab`)}`)
      await wait(1500)
      // Chat du téléphone (demandé au PC par le lien) : l'état seulement, aucun message envoyé à Claude
      const forPhone = await phoneApi('chat-etat', {}, { id: 'autotest', nom: 'Téléphone de test' })
      lines.push(`chat du téléphone : prêt=${forPhone.pret} session=${forPhone.session ? 'oui' : 'non'} sessions=${forPhone.sessions.length} messages=${forPhone.messages.length}`)
      await phoneApi('chat-ferme', {}, { id: 'autotest', nom: 'Téléphone de test' })
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(800)
      // Accueil (agents) et code modifié, façon Coucou
      openChat()
      await wait(900)
      await enc.executeJavaScript(`document.querySelector('.tabs button[data-tab="agents"]').click()`)
      await wait(1200)
      await encShot('26-accueil-agents')
      // Rien ne doit dépasser sous le bord de l'îlot (bug du 04/10/2026 : panneau coupé)
      lines.push(`accueil, débordement : ${await enc.executeJavaScript(`(() => {
        const island = document.getElementById('island').getBoundingClientRect()
        const deck = document.getElementById('deck').getBoundingClientRect()
        const left = document.getElementById('home-left')
        return 'carte ' + Math.round(deck.bottom) + ' / îlot ' + Math.round(island.bottom) + (deck.bottom <= island.bottom ? ' (dans l’îlot)' : ' (DÉPASSE)') +
          ' | carte de gauche : ' + (left.scrollHeight - left.clientHeight) + ' px cachés | îlot ' + Math.round(island.height) + ' px'
      })()`)}`)
      lines.push(`accueil : ${(await enc.executeJavaScript(`document.getElementById('home-left').innerText.replace(/\\s+/g, ' ')`)).slice(0, 160)}`)
      // Activité en direct : liste, détail d'une étape (genre, état, nombre de blocs ; pas le contenu), liste complète
      const acts = await enc.executeJavaScript(`document.querySelectorAll('#home-left .tick-row').length`)
      lines.push(`défilé des étapes : ${acts} étape(s) affichée(s) | pastilles : ${await enc.executeJavaScript(`[...document.querySelectorAll('#home-right .pill .lbl')].map(l => l.textContent).join(' | ')`)}`)
      if (await enc.executeJavaScript(`!document.getElementById('usage-head').hidden`)) {
        await enc.executeJavaScript(`document.getElementById('usage-head').click()`)
        await wait(700)
        lines.push(`limites : ${await enc.executeJavaScript(`[...document.querySelectorAll('#home-left .meter')].map(m => m.innerText.replace(/\\s+/g, ' ')).join(' / ')`)}`)
        await encShot('26a-limites')
        await enc.executeJavaScript(`document.getElementById('usage-head').click()`)
        await wait(500)
      }
      if (acts) {
        await enc.executeJavaScript(`document.querySelector('#home-left .tick-row:last-child').click()`)
        await wait(1000)
        lines.push(`détail d'une étape : ${await enc.executeJavaScript(`(document.querySelector('.step-view .kind')?.textContent || 'absent') + ' | ' + (document.querySelector('.step-view .state')?.textContent || '') + ' | ' + document.querySelectorAll('.step-view .blk, .step-view .prose, .step-view .meta, .step-view .waiting').length + ' bloc(s)'`)}`)
        await encShot('26b-detail-etape')
        const more = await enc.executeJavaScript(`Boolean(document.querySelector('.code-tab .back'))`)
        if (more) await enc.executeJavaScript(`document.querySelector('.code-tab .back').click()`)
        await wait(600)
        if (await enc.executeJavaScript(`Boolean(document.querySelector('#home-left .jump .icon-btn:nth-child(2)'))`)) {
          await enc.executeJavaScript(`document.querySelector('#home-left .jump .icon-btn:nth-child(2)').click()`)
          await wait(900)
          lines.push(`activité complète : ${await enc.executeJavaScript(`document.querySelectorAll('.activity-view .act').length`)} étape(s)`)
          await encShot('26c-activite-complete')
          await enc.executeJavaScript(`document.querySelector('.code-tab .back')?.click()`)
          await wait(600)
        }
      }
      const hasFile = await enc.executeJavaScript(`Boolean(document.querySelector('#home-left .file-chip'))`)
      if (hasFile) {
        await enc.executeJavaScript(`document.querySelector('#home-left .file-chip').click()`)
        await wait(1200)
        await encShot('27-code-modifie')
        lines.push(`code modifié : ${await enc.executeJavaScript(`document.querySelectorAll('#diff .ln').length`)} lignes affichées`)
      }
      // « Continuer dans le chat » : la session suivie s'ouvre dans le chat (aucun message n'est envoyé)
      await enc.executeJavaScript(`document.querySelector('.tabs button[data-tab="agents"]').click()`)
      await wait(800)
      await enc.executeJavaScript(`document.querySelector('#home-left .jump .icon-btn')?.click()`)
      await wait(1500)
      lines.push(`session reprise : ${await enc.executeJavaScript(`document.getElementById('model-label').textContent + ' | ' + document.querySelectorAll('.msg.past').length + ' messages repris | ' + (document.querySelector('.divider')?.textContent || 'pas de séparateur')`)}`)
      await encShot('28-session-reprise')
      // ＋ : nouvelle session Claude Code (aucun message envoyé)
      await enc.executeJavaScript(`document.getElementById('new-chat').click()`)
      await wait(1200)
      lines.push(`nouvelle session : ${await enc.executeJavaScript(`document.getElementById('model-label').textContent + ' | ' + document.getElementById('messages').innerText.slice(0, 90)`)}`)
      await encShot('28b-nouvelle-session')
      // Quitter la session (avant tout envoi : le test ne parle jamais à une vraie session)
      await enc.executeJavaScript(`document.getElementById('leave-session').click()`)
      await wait(900)
      lines.push(`après « quitter la session » : ${await enc.executeJavaScript(`document.getElementById('model-label').textContent + ' | ' + document.querySelectorAll('.msg').length + ' message(s)'`)}`)
      const ask = async text => {
        await enc.executeJavaScript(`(() => { const i = document.getElementById('input'); i.value = ${JSON.stringify(text)}; document.getElementById('composer').requestSubmit() })()`)
        await wait(2500)
        return enc.executeJavaScript(`[...document.querySelectorAll('.msg')].map(m => m.innerText).join(' || ')`)
      }
      const choose = async provider => {
        await enc.executeJavaScript(`window.encoche.chat.choose(${JSON.stringify(provider)}, '')`)
        await wait(1500)
      }
      const lastMessage = async text => (await ask(text)).split(' || ').slice(-1)[0]
      // Fournisseur par défaut : Claude avec l'abonnement (Claude Code de l'application Claude)
      lines.push(`fournisseur par défaut : ${await enc.executeJavaScript(`document.getElementById('model-label').textContent + ' | ' + document.getElementById('keyhint').innerText`)}`)
      // Connecté : aucun vrai message pendant le test (il compterait dans le forfait de l'utilisateur)
      const connected = await enc.executeJavaScript(`document.getElementById('keyhint').hidden`)
      lines.push(`chat abonnement : ${connected ? 'connecté, aucun message envoyé pendant le test' : await ask('Réponds seulement : OK')}`)
      await encLine('après la réponse')
      await encShot('21b-chat-abonnement')
      // Menu « changer d'IA ou de modèle » (clic sur le nom du modèle)
      await enc.executeJavaScript(`document.getElementById('model-btn').click()`)
      await wait(700)
      lines.push(`menu des modèles : ${await enc.executeJavaScript(`document.getElementById('model-menu').innerText.replace(/\\s+/g, ' ')`)}`)
      await encShot('21c-menu-modeles')
      await enc.executeJavaScript(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      // Aspect d'une conversation en cours (état simulé, affichage seulement), puis retour au vrai état
      enc.send('chat:update', {
        providers: [{ id: 'claudecode', label: 'Claude (ton abonnement)', subscription: true, ready: true, note: '' }],
        provider: 'claudecode',
        model: 'sonnet',
        streaming: true,
        attachments: [{ name: 'rapport.pdf', kind: 'pdf', thumb: '' }],
        messages: [
          { role: 'user', text: 'Salut Nuage ! Tu peux m’aider à préparer ma journée ?', files: [] },
          { role: 'assistant', text: 'Bien sûr ! Dis-moi ce que tu as de prévu et je t’aide à tout organiser.', files: [] },
          { role: 'user', text: 'Résume ce fichier en trois points.', files: ['rapport.pdf'] },
          { role: 'assistant', text: '', files: [] },
        ],
      })
      await wait(900)
      await encLine('conversation simulée (réfléchit)')
      await encShot('24-chat-reflechit')
      enc.send('chat:delta', { index: 3, text: 'Voici le résumé :\n1. Le projet avance bien.\n2. Deux réunions sont prévues à 14 h.' })
      await wait(700)
      await encLine('conversation simulée (écrit)')
      await encShot('25-chat-ecrit')
      openChat() // renvoie le vrai état du chat
      await wait(800)
      await choose('claude')
      lines.push(`chat clé d’API absente : ${await lastMessage('Bonjour')}`)
      await choose('ollama')
      lines.push(`chat Ollama : ${await lastMessage('Salut')}`)
      // Toute IA peut proposer un plugin ou une compétence : Markdown léger + balise [[installer: …]] → bouton (07/10/2026)
      await wait(1500) // l'état du chat (réponse d'Ollama) arrive d'abord, sinon il efface la réponse ajoutée
      const reply = '### Compétence PDF\n- **Lire** et `remplir` des PDF\n[[installer: https://github.com/anthropics/skills/tree/main/skills/pdf]]'
      lines.push(`chat, Markdown et bouton d’installation : ${await enc.executeJavaScript(`encocheTest.reply(${JSON.stringify(reply)})`)}`)
      await wait(700) // fin de l'apparition du message (.msg.appear)
      await encShot('25b-chat-installer')
      await enc.executeJavaScript(`document.querySelector('#messages .install-btn').click()`)
      await wait(4500)
      lines.push(`bouton d’installation → réglages de la barre : ${(await enc.executeJavaScript(`document.getElementById('reglages').innerText.replace(/\\s+/g, ' ')`)).slice(0, 300)}`)
      openChat()
      await wait(800)
      // Fichier déposé sur l'encoche (« Demander à l'IA ») : joint au chat
      const joint = path.join(dir, 'piece-jointe-test.txt')
      fs.writeFileSync(joint, 'Fichier de test de Nuage.')
      await enc.executeJavaScript(`window.encoche.dropToChat(${JSON.stringify([joint])})`)
      await wait(1200)
      lines.push(`pièce jointe : ${await enc.executeJavaScript(`document.getElementById('attachments').innerText.replace(/\\s+/g, ' ')`)}`)
      fs.writeFileSync(path.join(dir, '23-chat-piece-jointe.png'), (await enc.capturePage()).toPNG())
      await enc.executeJavaScript(`document.querySelector('.chip button')?.click()`)
      // Échap : l'encoche se replie ; menu « Chat avec une IA » : elle se rouvre sur le chat
      await enc.executeJavaScript(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      await wait(1000)
      await encLine('après Échap')
      openChat()
      await wait(1000)
      await encLine('menu « Chat avec une IA »')
      await enc.executeJavaScript(`encocheTest.fold()`)
      await wait(1000)
      await encLine('après repli')

      // ---------- Réglages : tous dans la barre (08/10/2026) ----------
      openSettings('ia')
      await wait(2500)
      fs.writeFileSync(path.join(dir, '21-reglages-ia.png'), (await enc.capturePage()).toPNG())
      lines.push('--- réglages de la barre, IA (extrait) ---', (await enc.executeJavaScript('document.getElementById(\'reglages\').innerText')).slice(0, 700))
      lines.push(`OpenRouter parmi les IA : ${await enc.executeJavaScript(`document.getElementById('reglages').innerText.includes('OpenRouter') ? 'oui' : 'NON'`)}`)
      // « Tester » sans clé : le message pointe le champ juste au-dessus (07/10/2026)
      lines.push(`OpenRouter, Tester sans clé : ${await enc.executeJavaScript(`(async () => {
        const find = () => [...document.querySelectorAll('#reglages .rg-opt')].find(o => o.querySelector('b').textContent === 'OpenRouter')
        find().querySelector('.rg-opt-head').click()
        await new Promise(r => setTimeout(r, 800))
        const box = find()
        if (box.querySelector('input').dataset.set) return '(clé déjà enregistrée, non testé)'
        ;[...box.querySelectorAll('button')].find(b => b.textContent === 'Tester').click()
        await new Promise(r => setTimeout(r, 300))
        return document.querySelector('#reglages .rg-msg').textContent
      })()`)}`)
      // Chaque rubrique des réglages de Nuage (ceux de l'ancien menu de l'icône) : capture et extrait
      for (const section of ['nuage', 'voix', 'ecran', 'claude', 'integrations']) {
        openSettings(section)
        await wait(1500)
        fs.writeFileSync(path.join(dir, `21-reglages-${section}.png`), (await enc.capturePage()).toPNG())
        lines.push(`réglages, ${section} : ${(await enc.executeJavaScript(`document.getElementById('reglages').innerText.replace(/\\s+/g, ' ')`)).slice(0, 320)}`)
      }
      // Un interrupteur de la barre change bien le réglage (mode discret), puis il revient
      lines.push(`interrupteur « Mode discret » : ${await enc.executeJavaScript(`(async () => {
        window.encoche.reglages.set('quiet', true)
        await new Promise(r => setTimeout(r, 600))
        const on = (await window.encoche.reglages.bar()).flatMap(g => g.rows).find(r => r.key === 'quiet').on
        window.encoche.reglages.set('quiet', false)
        await new Promise(r => setTimeout(r, 600))
        const off = (await window.encoche.reglages.bar()).flatMap(g => g.rows).find(r => r.key === 'quiet').on
        return on && !off ? 'allumé puis éteint ✓' : \`ÉCHEC (\${on}/\${off})\`
      })()`)}`)
      // Compétences et plugins : un plugin officiel examiné (rien n'est installé sans clic), puis la liste
      openSettings('competences')
      await wait(1500)
      await enc.executeJavaScript(`(() => { const f = document.querySelector('#reglages .rg-form'); f.querySelector('input').value = '/plugin install document-skills@anthropic-agent-skills'; f.requestSubmit() })()`)
      await wait(6000)
      lines.push(`plugins, examen d’une commande : ${await enc.executeJavaScript(`((document.querySelector('#reglages .rg-card') || document.querySelector('#reglages .rg-err'))?.innerText || 'rien').replace(/\\s+/g, ' ')`)}`)
      fs.writeFileSync(path.join(dir, '21b-plugins-competences.png'), (await enc.capturePage()).toPNG())

      lines.push(`erreurs console : ${errors.length ? errors.join(' / ') : 'aucune'}`)
    } catch (error) {
      if (error.quickDone) lines.push(`erreurs console : ${errors.length ? errors.join(' / ') : 'aucune'}`)
      else lines.push(`ERREUR : ${error.stack || error}`)
    }
    fs.writeFileSync(path.join(dir, 'resultats.txt'), lines.join('\n'), 'utf8')
    app.quit()
  })
}

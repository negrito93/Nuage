// Agents de code vus du téléphone (06/10/2026 : « ajoute à la version mobile les fonctions de Coucou sur iPhone ») :
// état en un coup d'œil, chiffres du jour, sessions et leurs étapes, demandes d'autorisation, services (GitHub,
// Stripe…). Tout est en français, prêt à afficher, et léger : ni résultats d'outils ni code (le détail d'une
// session se demande à part : sessionDetail). Fonctions pures, testées par outils/test-agents-telephone.js.
const STATUS_WORD = {
  'en-cours': 'au travail', attente: 'attend ta réponse', permission: 'attend ton accord', termine: 'a fini', inactif: 'au repos',
}
const EMOJI = /(?:[←-⯿]|[\u{1F000}-\u{1FAFF}])️?/gu
const clean = text => String(text || '').replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim()
const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text))

function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Étapes de la dernière demande, dans l'ordre (le résumé du PC les donne les plus récentes d'abord) : outils seulement
function turnSteps(session) {
  const list = []
  for (const step of session.steps || []) {
    if (step.kind === 'demande') break
    if (step.kind !== 'message') list.push(step)
  }
  return list.reverse()
}

// La discussion du chat de Nuage avec une autre IA que Claude Code (09/10/2026 : « rien n'apparaît alors que je
// suis en train de taffer » avec Gemini) : une ligne comme une session. chat = { ia, at, streaming, outil, tours }
// (main.js), null sans discussion. Le téléphone l'ouvre dans son chat (id 'chat').
function chatRow(chat, now) {
  const statut = chat.streaming ? 'en-cours' : now - chat.at < 10 * 60_000 ? 'termine' : 'inactif'
  return {
    id: 'chat', chat: true, titre: `Discussion avec ${chat.ia}`, projet: 'chat', agent: `Chat de Nuage · ${chat.ia}`, qui: chat.ia, statut,
    mot: STATUS_WORD[statut], actuel: clip(chat.outil || 'écrit sa réponse…', 90), attente: '', depuis: chat.at, faites: 0, total: 0, etapes: [],
  }
}

// ia : nom court de l'IA du chat (« Gemini », « ChatGPT », « Claude ») : le téléphone écrit « Demande à Gemini… »
function summarize(snapshot, { integrations = [], okToday = 0, chat = null, ia = 'Claude', now = Date.now() } = {}) {
  const all = snapshot?.sessions || []
  const day = startOfDay(now)
  let tours = chat?.tours || 0
  let plus = 0
  let moins = 0
  const fichiers = new Set()
  for (const s of all) {
    for (const step of s.steps || []) if (step.kind === 'demande' && step.at >= day) tours += 1
    if (s.lastAt >= day) {
      for (const f of s.files || []) {
        fichiers.add(f.path)
        plus += f.added || 0
        moins += f.removed || 0
      }
    }
  }
  const demandes = (snapshot?.permissions || []).map(p => ({
    id: p.id, sessionId: p.sessionId, titre: clip(p.title || 'Claude', 60), outil: p.tool || '', label: clip(p.label || '', 160),
    commande: clip(p.command || '', 300), question: Boolean(p.questions), toujours: p.always !== false, expire: p.expiresAt || 0,
  }))
  const sessions = all.slice(0, 8).map(s => {
    const etapes = turnSteps(s)
    return {
      id: s.id, titre: clip(s.title || 'Session', 70), projet: s.project || '', agent: 'Claude Code', qui: 'Claude', statut: s.status,
      mot: STATUS_WORD[s.status] || s.status, actuel: clip(s.current || '', 90), attente: clip(s.waiting || '', 120), depuis: s.lastAt || 0,
      faites: etapes.filter(e => e.done).length, total: etapes.length,
      etapes: etapes.slice(-6).map(e => ({ label: clip(e.label, 90), fait: Boolean(e.done), erreur: Boolean(e.error) })),
    }
  })
  // La discussion prend sa place selon l'heure (au travail : en tête) ; 8 lignes au plus
  if (chat?.at) {
    const row = chatRow(chat, now)
    const at = sessions.findIndex(s => row.statut === 'en-cours' || s.depuis < row.depuis)
    sessions.splice(at < 0 ? sessions.length : at, 0, row)
    sessions.length = Math.min(sessions.length, 8)
  }
  const waiting = demandes.length + sessions.filter(s => s.statut === 'attente').length
  const working = sessions.filter(s => s.statut === 'en-cours')
  let resume
  if (waiting) {
    const first = demandes[0]
    const asking = sessions.find(s => s.statut === 'attente')
    resume = { etat: 'attente', titre: `${waiting} en attente`, texte: first ? `${first.titre} · ${first.label}` : `${asking.titre} · ${asking.attente || 'attend ta réponse'}` }
  } else if (working.length) {
    resume = { etat: 'travaille', titre: `${working.length} au travail`, texte: `${working[0].titre} · ${working[0].actuel || 'travaille…'}` }
  } else {
    resume = { etat: 'calme', titre: 'Tout est calme', texte: sessions[0] ? `${sessions[0].titre} · ${sessions[0].mot}` : 'Aucune session récente' }
  }
  const services = integrations.filter(i => i.status !== 'off').map(i => {
    const lignes = (i.lines || []).slice(0, 5).map(l => ({ texte: clip(clean(l.text), 120), ton: l.tone || '' }))
    const etat = i.status === 'erreur' ? 'erreur' : lignes.some(l => l.ton === 'mauvais' || l.ton === 'attention') ? 'a-voir' : 'ok'
    return { id: i.id, nom: i.label, etat, texte: i.status === 'erreur' ? clip(clean(i.error), 120) : lignes[0]?.texte || '', badge: clean(i.badge || ''), lignes }
  })
  return {
    maj: now, resume, ia,
    aujourdhui: { tours, fichiers: fichiers.size, plus, moins, accords: okToday },
    sessions, demandes, services,
    servicesHors: integrations.filter(i => i.status === 'off').map(i => i.label),
  }
}

// Une session en détail (écran du téléphone) : ta dernière demande, ce que Claude a fait, sa réponse, les fichiers.
// stepDetail(sessionId, stepId) → { text } : le texte complet d'une demande ou d'un message (agents.js).
function sessionDetail(snapshot, stepDetail, id) {
  const s = (snapshot?.sessions || []).find(x => x.id === id)
  if (!s) return null
  const steps = s.steps || [] // les plus récentes d'abord
  const ask = steps.find(st => st.kind === 'demande')
  const said = steps.find(st => st.kind === 'message')
  const full = st => (st ? String(stepDetail(id, st.id)?.text || '').trim() : '')
  const etapes = turnSteps(s)
  return {
    id: s.id, titre: s.title || 'Session', projet: s.project || '', agent: 'Claude Code', statut: s.status,
    mot: STATUS_WORD[s.status] || s.status, depuis: s.lastAt || 0, attente: s.waiting || '',
    demande: clip(full(ask) || String(ask?.label || '').replace(/^Ta demande : /, ''), 1500),
    etapes: etapes.slice(-30).map(e => ({ label: clip(e.label, 120), fait: Boolean(e.done), erreur: Boolean(e.error) })),
    // La réponse ne compte que si elle vient après la demande (sinon c'est celle de la fois d'avant)
    reponse: said && (!ask || said.at >= ask.at) ? clip(full(said), 4000) : '',
    fichiers: (s.files || []).slice(0, 12).map(f => ({ nom: f.name, plus: f.added || 0, moins: f.removed || 0 })),
  }
}

// Ce qui compte pour réveiller le téléphone tout de suite : nouvelle demande, changement de statut
function signature(summary) {
  return JSON.stringify([summary.resume.etat, summary.demandes.map(d => d.id), summary.sessions.map(s => [s.id, s.statut])])
}
// L'avancement (une étape de plus) : envoyé moins vite, la notification « en direct » suit sans réveiller le
// téléphone à chaque outil (mesuré le 06/10/2026 sur le Pixel : un envoi toutes les 1,5 à 7 s)
const progress = summary => JSON.stringify(summary.sessions.map(s => [s.faites, s.total]))

module.exports = { summarize, sessionDetail, signature, progress, turnSteps, STATUS_WORD }

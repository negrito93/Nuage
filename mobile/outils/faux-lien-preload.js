// Faux plugin « Lien » (Capacitor) pour tester l'interface du téléphone (www/app.js) hors du téléphone.
// Chargé avant la page par test-interface.js : window.Capacitor.registerPlugin('Lien') renvoie ce faux plugin.
// Scénarios (?s=...) : echec (recherche sans résultat), trouve (un PC répond), associe (déjà associé au PC).
// Pourquoi : en v1.7 une variable lue avant sa déclaration arrêtait tout le script dans l'appli réelle (le
// plugin existe) mais jamais en mode démonstration (sans plugin) : le bug est passé à travers tous les tests.
const scen = new URLSearchParams(location.search).get('s') || 'echec'
const ecouteurs = {}
const appels = (globalThis.__appels = [])
const attendre = ms => new Promise(resolve => setTimeout(resolve, ms))
const reseau = { nom: 'Wi-Fi', moi: '192.168.1.23', prefixe: 24 }
const etatAssocie = {
  associe: true, connecte: true, pc: { nom: 'PC-TEST' }, version: '1.8', bulle: false, tuile: true, batterie: 80, charge: false,
  recus: [{ nom: 'rapport.pdf', taille: 2_300_000, type: 'application/pdf', uri: 'x', at: Date.now() - 600_000 }],
  nouvelles: [{ titre: 'Claude a fini', texte: 'nuage-bureau', genre: 'claude', at: Date.now() - 120_000 }],
}
const fake = {
  addListener: async (nom, fn) => {
    ;(ecouteurs[nom] ||= []).push(fn)
    return { remove() {} }
  },
  etat: async () => (scen === 'associe' || scen === 'agents' ? etatAssocie : { associe: false, connecte: false, version: '1.8', recus: [], nouvelles: [], batterie: 80, charge: false }),
  reseaux: async () => ({ reseaux: [reseau] }),
  chercherPcsReseau: async () => {
    appels.push('chercherPcsReseau')
    await attendre(300)
    if (scen === 'trouve') return { pcs: [{ id: 'x', nom: 'PC-TEST', adresse: '192.168.1.20', port: 47824 }], reseaux: [{ ...reseau, envoyes: 3, reponses: 1 }], balayage: false, ms: 300 }
    return { pcs: [], reseaux: [{ ...reseau, envoyes: 259, reponses: 0, balayees: 253 }], balayage: true, ms: 3600 }
  },
  demanderAssociation: async arg => {
    appels.push(`demanderAssociation ${JSON.stringify(arg)}`)
    await attendre(100)
    return { demande: 'd1', code: '184377', pc: 'PC-TEST' }
  },
  attendreAssociation: async () => {
    appels.push('attendreAssociation')
    await attendre(400)
    return { pc: { nom: 'PC-TEST' } }
  },
  chatEtat: async () => ({ streaming: false, pret: true, fournisseur: 'Claude Code (ton abonnement)', session: null, sessions: [], messages: [{ role: 'user', texte: 'Salut', de: 'telephone' }, { role: 'assistant', texte: 'Bonjour !' }], permission: null }),
  chatFerme: async () => {},
  chatEnvoyer: async () => ({ streaming: false, pret: true, session: null, sessions: [], messages: [], permission: null }),
  coucou: async () => {
    appels.push('coucou')
  },
  voixEtat: async () => ({ micro: false, disponible: true, veille: false }),
  voixActivite: async () => {},
  voixParler: async () => {},
  meteo: async () => {},
  oublier: async () => {},
  // Agents de code du PC (v1.9) : un résumé comme celui d'agents-telephone.js
  agentsMemo: async () => ({ etat: scen === 'agents' ? agents : undefined }),
  agentsEtat: async () => {
    appels.push('agentsEtat')
    return agents
  },
  agentsSession: async ({ id }) => {
    appels.push(`agentsSession ${id}`)
    return {
      id, titre: 'korus', projet: 'korus', agent: 'Claude Code', statut: 'en-cours', mot: 'au travail', depuis: Date.now() - 30_000, attente: '',
      demande: 'Fix the VAT rounding, then push to main',
      etapes: [{ label: 'Lit billing.ts', fait: true, erreur: false }, { label: 'Exécute : npm test', fait: false, erreur: false }],
      reponse: 'Arrondi corrigé, 48 tests passent.', fichiers: [{ nom: 'billing.ts', plus: 1, moins: 1 }],
    }
  },
  agentsRepondre: async arg => {
    appels.push(`agentsRepondre ${arg.id} ${arg.choix}`)
    return { envoye: true }
  },
  ajouterWidget: async () => {
    appels.push('ajouterWidget')
  },
  chatSession: async arg => {
    appels.push(`chatSession ${arg.action} ${arg.id || ''}`)
    return { streaming: false, pret: true, session: { titre: 'korus', projet: 'korus' }, sessions: [], messages: [], permission: null }
  },
  chatEnvoyer: async arg => {
    appels.push(`chatEnvoyer ${arg.texte}`)
    return { streaming: true, pret: true, session: { titre: 'korus', projet: 'korus' }, sessions: [], messages: [{ role: 'user', texte: arg.texte }], permission: null }
  },
}
const agents = {
  maj: Date.now(),
  ia: 'Gemini', // l'IA du chat du PC (09/10/2026)
  resume: { etat: 'attente', titre: '1 en attente', texte: 'korus · Lancer : git push origin main' },
  aujourdhui: { tours: 27, fichiers: 2, plus: 3, moins: 0, accords: 43 },
  demandes: [{ id: 'perm-1', sessionId: 's1', titre: 'korus', outil: 'Bash', label: 'Lancer : git push origin main', commande: 'git push origin main', question: false, toujours: true, expire: Date.now() + 90_000 }],
  sessions: [
    { id: 's1', titre: 'korus', projet: 'korus', agent: 'Claude Code', statut: 'en-cours', mot: 'au travail', actuel: 'Exécute : npm test', attente: '', depuis: Date.now() - 20_000, faites: 3, total: 4, etapes: [] },
    { id: 'chat', chat: true, titre: 'Discussion avec Gemini', projet: 'chat', agent: 'Chat de Nuage · Gemini', qui: 'Gemini', statut: 'termine', mot: 'a fini', actuel: '', attente: '', depuis: Date.now() - 600_000, faites: 0, total: 0, etapes: [] },
    { id: 's2', titre: 'portfolio', projet: 'portfolio', agent: 'Claude Code', statut: 'inactif', mot: 'au repos', actuel: '', attente: '', depuis: Date.now() - 7_200_000, faites: 0, total: 0, etapes: [] },
  ],
  services: [{ id: 'vercel', nom: 'Vercel', etat: 'a-voir', texte: 'korus · il y a 2 min', badge: '', lignes: [{ texte: 'korus · il y a 2 min', ton: 'mauvais' }, { texte: 'portfolio · hier', ton: '' }] }],
  servicesHors: ['GitHub', 'Stripe'],
}
window.Capacitor = { registerPlugin: () => fake }
// Pas de réseau pendant le test : la météo du téléphone (fetch) échoue proprement, comme hors ligne
window.fetch = () => Promise.reject(new Error('hors ligne (test)'))
// Aucune vraie boite de dialogue pendant le test : « Connecter ce téléphone ? » est refusée d'office
window.confirm = () => false

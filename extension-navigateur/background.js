// Extension « Nuage : téléchargements » (Chrome, Edge).
// Envoie à Nuage, sur ce PC uniquement (127.0.0.1), le chemin du fichier, la taille reçue et la taille
// totale de chaque téléchargement en cours : Nuage se remplit au bon pourcentage. Jamais l'adresse des
// pages ni des fichiers. Le code d'accès (jeton.json) est écrit par Nuage à chaque démarrage.
let config = null
let timer = null
const finished = new Map() // téléchargements terminés ou interrompus, envoyés une fois

async function loadConfig() {
  if (!config) config = await (await fetch(chrome.runtime.getURL('jeton.json'))).json()
  return config
}

const describe = d => ({
  id: d.id,
  path: d.filename,
  received: d.bytesReceived,
  total: d.totalBytes > 0 ? d.totalBytes : null,
  paused: Boolean(d.paused),
  state: d.state,
  size: d.fileSize > 0 ? d.fileSize : null,
})

async function push(hello = false) {
  const active = (await chrome.downloads.search({ state: 'in_progress' })).filter(d => d.filename)
  const items = [...active.map(describe), ...finished.values()]
  finished.clear()
  if (items.length || hello) {
    try {
      const { port, jeton } = await loadConfig()
      await fetch(`http://127.0.0.1:${port}/telechargement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nuage-Jeton': jeton },
        body: JSON.stringify({ items }),
      })
    } catch {
      config = null // Nuage fermé ou relancé (nouveau jeton) : on relira le fichier
    }
  }
  if (!active.length && timer) {
    clearInterval(timer)
    timer = null
  }
}

function follow() {
  if (!timer) timer = setInterval(push, 700)
  push()
}

chrome.downloads.onCreated.addListener(follow)
chrome.downloads.onChanged.addListener(async delta => {
  const state = delta.state?.current
  if (state === 'complete' || state === 'interrupted') {
    const [d] = await chrome.downloads.search({ id: delta.id })
    if (d?.filename) finished.set(d.id, describe(d))
  }
  follow()
})
// Au démarrage du navigateur et à l'installation : un « bonjour » (liste vide), pour que Nuage sache
// que l'extension est branchée, puis le suivi de ce qui serait déjà en cours
const hello = () => push(true).then(follow)
chrome.runtime.onStartup.addListener(hello)
chrome.runtime.onInstalled.addListener(hello)

// Outils de Nuage pour les IA « par abonnement » qui tournent dans leur propre programme (Antigravity pour Gemini,
// Codex pour ChatGPT ; 08/10/2026) : petit serveur MCP (stdio, JSON-RPC une ligne par message), lancé par ce
// programme avec le Node d'Electron (ELECTRON_RUN_AS_NODE). Chaque appel repart vers Nuage (serveur local,
// jeton secret) : mêmes outils (actions.js) et même carte d'accord dans l'encoche que pour les autres IA.
// Leurs propres outils (fichiers, terminal) sont coupés : ils n'agissent sur le PC que par ici.
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const readline = require('node:readline')
const { TOOLS } = require('./actions')

const PORT = Number(process.env.NUAGE_PORT) || 47823
const TOKEN = process.env.NUAGE_JETON || ''
const PIECES = process.env.NUAGE_PIECES || '' // images jointes au chat (abonnements.js les y écrit à chaque message)

// voir_image (09/10/2026) : agy ne prend pas d'image en ligne de commande, mais lit celle qu'un outil MCP lui rend
const VOIR_IMAGE = {
  name: 'voir_image',
  description: 'Montre une image que l’utilisateur a jointe au chat de Nuage (le nom est indiqué dans son message, ex. « image-1.png »).',
  inputSchema: { type: 'object', properties: { nom: { type: 'string', description: 'Nom de l’image, ex. image-1.png' } }, required: ['nom'] },
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
function seeImage(args) {
  // Seulement un fichier du dossier des pièces jointes (basename : ni « .. » ni autre dossier)
  const file = path.join(PIECES, path.basename(String(args?.nom || '')))
  const mimeType = MIME[path.extname(file).toLowerCase()]
  if (!PIECES || !mimeType || !fs.existsSync(file)) {
    return { content: [{ type: 'text', text: `Image « ${args?.nom || ''} » introuvable : seules les images jointes à la conversation existent.` }], isError: true }
  }
  return { content: [{ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType }], isError: false }
}

const write = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)

// Nuage exécute l'outil (après l'accord de l'utilisateur) et rend le texte pour l'IA
function callNuage(name, args) {
  const body = JSON.stringify({ name, args })
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/outil', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Nuage-Jeton': TOKEN },
    }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', d => { data += d })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).text || `Nuage n’a rien rendu (HTTP ${res.statusCode}).`)
        } catch {
          resolve(`Nuage n’a pas répondu correctement (HTTP ${res.statusCode}).`)
        }
      })
    })
    req.on('error', error => resolve(`Nuage est injoignable : ${error.message}`))
    req.end(body)
  })
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // notification (initialized, cancelled…) : rien à répondre
  if (method === 'initialize') {
    return write({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nuage', version: '1.0.0' } } })
  }
  if (method === 'ping') return write({ id, result: {} })
  if (method === 'tools/list') {
    const tools = TOOLS.map(t => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }))
    return write({ id, result: { tools: PIECES ? [...tools, VOIR_IMAGE] : tools } })
  }
  if (method === 'tools/call' && params?.name === VOIR_IMAGE.name) return write({ id, result: seeImage(params.arguments) })
  if (method === 'tools/call') {
    const text = await callNuage(String(params?.name || ''), params?.arguments || {})
    return write({ id, result: { content: [{ type: 'text', text }], isError: false } })
  }
  write({ id, error: { code: -32601, message: `Méthode inconnue : ${method}` } })
}

readline.createInterface({ input: process.stdin }).on('line', raw => {
  const line = raw.replace(/^﻿/, '') // marque BOM en tête (entrée écrite par PowerShell)
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return write({ id: null, error: { code: -32700, message: 'JSON illisible' } })
  }
  handle(msg).catch(error => write({ id: msg.id ?? null, error: { code: -32603, message: error.message } }))
})

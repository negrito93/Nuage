// Petit serveur local (127.0.0.1 uniquement) qui reçoit les hooks HTTP et la barre d'état de
// Claude Code, et l'avancement des téléchargements (extension de navigateur facultative).
// Chaque requête doit porter un code secret (en-tête X-Nuage-Jeton) : celui de Nuage, ou pour
// /telechargement seulement, celui de l'extension (écrit dans extension-navigateur\jeton.json).
const http = require('node:http')
const crypto = require('node:crypto')

const PORT = 47823
const MAX_BODY = 8 * 1024 * 1024

const same = (given, expected) => given.length === expected.length && crypto.timingSafeEqual(given, expected)

// onTool : outil de Nuage appelé par une IA « par abonnement » (mcp-nuage.js) → { text }
function startServer({ token, downloadToken = '', onHook, onStatusline, onDownload = () => {}, onTool = async () => ({ text: 'Indisponible.' }), log = () => {} }) {
  const expected = Buffer.from(token)
  const expectedDownload = downloadToken ? Buffer.from(downloadToken) : null
  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const given = Buffer.from(String(req.headers['x-nuage-jeton'] || ''))
    const allowed = req.url === '/telechargement' && expectedDownload ? same(given, expectedDownload) : same(given, expected)
    if (req.method !== 'POST' || !allowed) {
      reply(403, {})
      return
    }
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reply(413, {})
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', async () => {
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        reply(400, {})
        return
      }
      try {
        if (req.url === '/hook') reply(200, (await onHook(body)) || {})
        else if (req.url === '/statusline') {
          onStatusline(body)
          reply(200, {})
        } else if (req.url === '/telechargement') {
          onDownload(body)
          reply(200, {})
        } else if (req.url === '/outil') reply(200, await onTool(body))
        else reply(404, {})
      } catch (error) {
        log('serveur, erreur :', error.message)
        reply(200, {}) // en cas de souci, Claude Code continue normalement
      }
    })
  })
  server.on('error', error => log('serveur, démarrage impossible :', error.message))
  server.listen(PORT, '127.0.0.1')
  return server
}

module.exports = { startServer, PORT }

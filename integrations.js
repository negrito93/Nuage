// Intégrations (clés de l'utilisateur dans secrets.js) : un résumé court de chaque service.
// Chaque entrée : { id, label, fields, fetch(get) -> { lines: [{ text, url?, tone? }], badge? } }.
const secrets = require('./secrets')

const TIMEOUT = 15_000
async function api(url, { headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': 'Nuage-bureau/1.0', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (res.status === 401 || res.status === 403) throw new Error('clé refusée')
  if (!res.ok) throw new Error(`erreur ${res.status}`)
  return res.json()
}
const money = (amount, currency) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: String(currency).toUpperCase() }).format(amount / 100)
const when = iso => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const INTEGRATIONS = [
  {
    id: 'github',
    label: 'GitHub',
    fields: [{ name: 'github', label: 'Jeton d’accès personnel (lecture)', secret: true }],
    async fetch(get) {
      const h = { Authorization: `Bearer ${get('github')}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
      const me = await api('https://api.github.com/user', { headers: h })
      const search = q => api(`https://api.github.com/search/issues?per_page=10&q=${encodeURIComponent(q)}`, { headers: h })
      const [mine, reviews] = await Promise.all([
        search(`is:pr is:open author:${me.login}`),
        search(`is:pr is:open review-requested:${me.login}`),
      ])
      const lines = []
      for (const pr of reviews.items.slice(0, 5)) lines.push({ text: `👀 Revue demandée : ${pr.title}`, url: pr.html_url, tone: 'attention' })
      for (const pr of mine.items.slice(0, 5)) {
        const repo = pr.repository_url.replace('https://api.github.com/repos/', '')
        let ci = ''
        try {
          const full = await api(`https://api.github.com/repos/${repo}/pulls/${pr.number}`, { headers: h })
          const runs = await api(`https://api.github.com/repos/${repo}/commits/${full.head.sha}/check-runs?per_page=50`, { headers: h })
          const list = runs.check_runs || []
          if (list.some(r => ['failure', 'timed_out', 'cancelled'].includes(r.conclusion))) ci = ' · ❌ tests'
          else if (list.some(r => r.status !== 'completed')) ci = ' · ⏳ tests'
          else if (list.length) ci = ' · ✅ tests'
        } catch {
          ci = ''
        }
        lines.push({ text: `🔀 ${repo.split('/')[1]} #${pr.number} : ${pr.title}${ci}`, url: pr.html_url, tone: ci.includes('❌') ? 'mauvais' : '' })
      }
      if (!lines.length) lines.push({ text: 'Aucune PR ouverte ni revue demandée.' })
      return { lines, badge: reviews.total_count ? `${reviews.total_count} revue(s)` : '' }
    },
  },
  {
    id: 'stripe',
    label: 'Stripe',
    fields: [{ name: 'stripe', label: 'Clé secrète restreinte (lecture seule conseillée)', secret: true }],
    async fetch(get) {
      const h = { Authorization: `Bearer ${get('stripe')}` }
      const [balance, charges] = await Promise.all([
        api('https://api.stripe.com/v1/balance', { headers: h }),
        api('https://api.stripe.com/v1/charges?limit=5', { headers: h }),
      ])
      const lines = (balance.available || []).map(b => ({ text: `💰 Disponible : ${money(b.amount, b.currency)}` }))
      for (const p of balance.pending || []) lines.push({ text: `⏳ En attente : ${money(p.amount, p.currency)}` })
      for (const c of charges.data || []) {
        const ok = c.status === 'succeeded' && !c.refunded
        lines.push({ text: `${ok ? '✅' : '⚠️'} ${money(c.amount, c.currency)} · ${c.billing_details?.name || c.description || 'paiement'} · ${when(c.created * 1000)}`, tone: ok ? '' : 'mauvais' })
      }
      return { lines }
    },
  },
  {
    id: 'vercel',
    label: 'Vercel',
    fields: [{ name: 'vercel', label: 'Jeton Vercel', secret: true }],
    async fetch(get) {
      const data = await api('https://api.vercel.com/v6/deployments?limit=6', { headers: { Authorization: `Bearer ${get('vercel')}` } })
      const icon = { READY: '✅', ERROR: '❌', BUILDING: '⏳', QUEUED: '⏳', CANCELED: '⛔' }
      const lines = (data.deployments || []).map(d => ({
        text: `${icon[d.state || d.readyState] || '•'} ${d.name} · ${when(d.created)}`,
        url: d.url ? `https://${d.url}` : undefined,
        tone: (d.state || d.readyState) === 'ERROR' ? 'mauvais' : '',
      }))
      return { lines: lines.length ? lines : [{ text: 'Aucun déploiement récent.' }] }
    },
  },
  {
    id: 'resend',
    label: 'Resend (e-mails)',
    fields: [
      { name: 'resend', label: 'Clé d’API Resend', secret: true },
      { name: 'resendFrom', label: 'Adresse d’envoi (domaine vérifié)', secret: false },
      { name: 'resendTo', label: 'Destinataire par défaut', secret: false },
    ],
    async fetch(get) {
      const data = await api('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${get('resend')}` } })
      const lines = (data.data || []).map(d => ({ text: `${d.status === 'verified' ? '✅' : '⏳'} Domaine ${d.name} (${d.status})` }))
      return { lines: lines.length ? lines : [{ text: 'Aucun domaine configuré.' }] }
    },
  },
  {
    id: 'notion',
    label: 'Notion',
    fields: [{ name: 'notion', label: 'Jeton d’intégration Notion', secret: true }],
    async fetch(get) {
      const data = await api('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${get('notion')}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: { page_size: 6, sort: { direction: 'descending', timestamp: 'last_edited_time' } },
      })
      const titleOf = r => {
        const prop = Object.values(r.properties || {}).find(p => p.type === 'title')
        return (prop?.title || r.title || []).map(t => t.plain_text).join('') || 'Sans titre'
      }
      const lines = (data.results || []).map(r => ({ text: `📄 ${titleOf(r)} · ${when(r.last_edited_time)}`, url: r.url }))
      return { lines: lines.length ? lines : [{ text: 'Aucune page partagée avec l’intégration.' }] }
    },
  },
  {
    id: 'n8n',
    label: 'n8n',
    fields: [
      { name: 'n8nUrl', label: 'Adresse de votre n8n (ex. https://n8n.mondomaine.com)', secret: false },
      { name: 'n8n', label: 'Clé d’API n8n', secret: true },
    ],
    async fetch(get) {
      const base = get('n8nUrl').replace(/\/+$/, '')
      if (!/^https?:\/\//.test(base)) throw new Error('adresse n8n manquante')
      const data = await api(`${base}/api/v1/executions?limit=20`, { headers: { 'X-N8N-API-KEY': get('n8n') } })
      const runs = data.data || []
      const failed = runs.filter(r => r.status === 'error' || r.status === 'crashed')
      const lines = [{ text: `${failed.length ? '❌' : '✅'} ${runs.length} exécution(s) récentes, ${failed.length} en échec` , tone: failed.length ? 'mauvais' : '' }]
      for (const r of failed.slice(0, 4)) lines.push({ text: `❌ Workflow ${r.workflowId} · ${when(r.startedAt)}`, tone: 'mauvais' })
      return { lines, badge: failed.length ? `${failed.length} échec(s)` : '' }
    },
  },
  {
    id: 'calcom',
    label: 'Cal.com',
    fields: [{ name: 'calcom', label: 'Clé d’API Cal.com', secret: true }],
    async fetch(get) {
      const data = await api('https://api.cal.com/v2/bookings?status=upcoming&take=5', {
        headers: { Authorization: `Bearer ${get('calcom')}`, 'cal-api-version': '2024-08-13' },
      })
      const lines = (data.data || []).map(b => ({ text: `📅 ${when(b.start)} · ${b.title}` }))
      return { lines: lines.length ? lines : [{ text: 'Aucun rendez-vous à venir.' }] }
    },
  },
]

const configured = integ => integ.fields.filter(f => f.secret).every(f => secrets.has(f.name)) &&
  integ.fields.filter(f => !f.secret).every(f => secrets.has(f.name) || f.name === 'resendTo' || f.name === 'resendFrom')

async function refreshAll() {
  const results = []
  for (const integ of INTEGRATIONS) {
    if (!configured(integ)) {
      results.push({ id: integ.id, label: integ.label, status: 'off' })
      continue
    }
    try {
      const data = await integ.fetch(secrets.get)
      results.push({ id: integ.id, label: integ.label, status: 'ok', ...data, updatedAt: Date.now() })
    } catch (error) {
      results.push({ id: integ.id, label: integ.label, status: 'erreur', error: error.message })
    }
  }
  return results
}

// Envoi d'un fichier par e-mail via Resend (pièce jointe)
async function sendFileByEmail({ fileName, base64, to }) {
  const key = secrets.get('resend')
  const from = secrets.get('resendFrom')
  const dest = to || secrets.get('resendTo')
  if (!key || !from || !dest) throw new Error('Resend n’est pas configuré (clé, adresse d’envoi, destinataire).')
  return api('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: { from, to: [dest], subject: `Fichier : ${fileName}`, text: `Envoyé depuis Nuage : ${fileName}`, attachments: [{ filename: fileName, content: base64 }] },
  })
}

// Description des champs pour les Réglages de la barre (sans les valeurs secrètes)
const describe = () => INTEGRATIONS.map(integ => ({
  id: integ.id,
  label: integ.label,
  fields: integ.fields.map(f => ({ ...f, set: secrets.has(f.name), value: f.secret ? '' : secrets.get(f.name) })),
}))

module.exports = { refreshAll, sendFileByEmail, describe, INTEGRATIONS }

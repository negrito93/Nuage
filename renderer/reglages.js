// Vue « Réglages » de la barre (08/10/2026 : « tous les réglages du Nuage doivent être dans la barre, l'utilisateur ne
// va pas aller ailleurs »). Elle remplace la fenêtre « Connexions » et le menu de l'icône près de l'horloge :
//   IA (comment faire marcher Nuage : abonnement, clé d'API, sur ce PC), Compétences et plugins, Nuage, Voix et sons,
//   Écran et Windows, Claude Code, Intégrations ; « Téléphone » mène à son menu (déjà dans la barre).
// Les réglages de Nuage arrivent de main.js en groupes (barGroups : interrupteurs, choix, curseur, actions) : la liste
// est écrite une seule fois, ici on la dessine. Les clés ne sont jamais relues : elles ne font que passer vers main.js.
import { icon } from './icones.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(className, text, onClick) {
  const b = el('button', className, text)
  b.type = 'button'
  if (onClick) b.addEventListener('click', onClick)
  return b
}
function toggle(label, checked, onChange, disabled = false) {
  const row = el('label', `switch-row${disabled ? ' off' : ''}`)
  const input = el('input')
  input.type = 'checkbox'
  input.checked = Boolean(checked)
  input.disabled = disabled
  input.addEventListener('change', () => onChange(input.checked))
  row.append(input, el('i', 'switch'), el('span', '', label))
  return row
}

const SECTIONS = [
  ['ia', 'IA'], ['competences', 'Compétences'], ['nuage', 'Nuage'], ['voix', 'Voix et sons'],
  ['telephone', 'Téléphone'], ['ecran', 'Écran et Windows'], ['claude', 'Claude Code'], ['integrations', 'Intégrations'],
]

// root : conteneur de la vue ; api : window.encoche.reglages ; isOpen() : la vue est affichée ; layout() : la barre
// recalcule sa hauteur ; goPhone() : onglet Téléphone ; onLater() : « Plus tard » au premier lancement
export function createReglages({ root, api, loginClaude, isOpen, layout, goPhone, onLater }) {
  let section = 'ia'
  let welcome = false
  let state = null // IA, intégrations, Claude Code (cnx:state)
  let groups = [] // réglages de Nuage (main.js barGroups)
  let skills = []
  let opened = '' // carte d'IA dépliée
  let examined = '' // lien ou commande examiné (compétences)
  let preview = null // ce que l'examen a trouvé
  let message = ''
  const progress = {} // id → { got, total } pendant un téléchargement

  const say = text => {
    message = text || ''
    const line = root.querySelector('.rg-msg')
    if (line) line.textContent = message
  }
  async function act(b, promise) {
    if (b) b.disabled = true
    const r = await promise
    if (b) b.disabled = false
    say(r?.message || r?.error && `✗ ${r.error}` || '')
    await refresh()
    return r
  }
  async function refresh() {
    ;[state, groups] = await Promise.all([api.getState(), api.bar()])
    if (section === 'competences') skills = (await api.extList())?.skills || []
    render()
  }

  // ---------- IA : une carte par façon de faire marcher Nuage ----------
  const step = (text, done, action) => {
    const row = el('div', 'rg-step')
    row.append(el('span', done ? 'done' : '', `${done ? '✓ ' : ''}${text}`))
    if (action) row.append(action)
    return row
  }
  // Champ d'une clé secrète (jamais relue) ou d'une valeur simple
  function field(f) {
    const box = el('div', 'rg-field')
    const input = el('input')
    input.type = f.secret ? 'password' : 'text'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.dataset.name = f.name
    input.dataset.set = f.set ? '1' : ''
    input.placeholder = f.secret ? (f.set ? '•••••• enregistrée (taper pour remplacer)' : 'Colle ta clé ici') : ''
    if (!f.secret) input.value = f.value || ''
    box.append(el('label', '', f.label), input,
      button('btn primary', 'Enregistrer', async () => {
        if (f.secret && !input.value.trim()) return
        await act(null, api.setSecret(f.name, input.value))
      }),
      button('btn secondary', 'Effacer', () => act(null, api.setSecret(f.name, ''))))
    box.lastChild.disabled = !f.set
    return box
  }
  // Champs + « Tester » (une clé collée sans « Enregistrer » est enregistrée d'abord)
  function keysBox(fields, testId) {
    const box = el('div', 'rg-keys')
    box.append(...fields.map(field))
    if (testId) {
      box.append(button('btn secondary', 'Tester', async () => {
        const keys = [...box.querySelectorAll('input[type=password]')]
        const missing = keys.find(i => !i.dataset.set && !i.value.trim())
        if (missing) {
          say('Colle d’abord ta clé dans le champ juste au-dessus, puis clique sur « Tester ».')
          missing.focus()
          return
        }
        for (const i of keys.filter(k => k.value.trim())) await api.setSecret(i.dataset.name, i.value)
        say('Test en cours…')
        await act(null, api.test(testId))
      }))
    }
    return box
  }
  function option(p) {
    const using = p.current && p.ready // « utilisée » seulement si elle marche (l'IA par défaut n'est souvent pas là)
    const box = el('div', `rg-opt${using ? ' on' : ''}${p.ready ? ' ready' : ''}`)
    const head = button('rg-opt-head', '', () => {
      opened = opened === p.id ? '' : p.id
      render()
    })
    head.append(el('b', '', p.label), el('span', `rg-st${p.ready ? ' ok' : ''}`, using ? 'utilisée par le chat' : p.ready ? 'prête' : p.todo || ''))
    if (p.sub) head.append(el('small', '', p.sub))
    box.append(head)
    if (opened !== p.id) return box
    const body = el('div', 'rg-opt-body')
    if (p.tool) {
      // Outil officiel à installer (Antigravity pour Gemini, Codex pour ChatGPT), puis connexion au compte
      const t = p.tool
      const prog = progress[p.id]
      const install = step(t.installed ? `${t.name} installé` : `Installer ${t.name}, l’outil officiel (${t.size})`, t.installed,
        t.installed ? null : button('btn primary', prog ? '…' : 'Installer', ev => {
          say(`Téléchargement de ${t.name} depuis sa source officielle…`)
          return act(ev.currentTarget, api.account(p.id, 'install'))
        }))
      if (prog && !t.installed) {
        const bar = el('div', 'rg-bar')
        const fill = el('i')
        fill.style.setProperty('--p', `${prog.total ? Math.round((prog.got / prog.total) * 100) : 0}%`)
        bar.append(fill)
        install.append(bar, el('small', '', `${Math.round(prog.got / 1048576)}${prog.total ? ` / ${Math.round(prog.total / 1048576)}` : ''} Mo`))
      }
      body.append(install, step(t.loggedIn ? `Connecté à ton compte ${t.account}` : `Te connecter avec ton compte ${t.account}`, t.loggedIn,
        t.installed && !t.loggedIn ? button('btn primary', 'Se connecter', ev => {
          // Antigravity se connecte dans sa propre fenêtre (elle ouvre le navigateur) ; Codex directement dans le navigateur
          say(t.name === 'Antigravity'
            ? 'Une fenêtre Antigravity s’ouvre, puis ton navigateur : connecte-toi à Google, puis ferme la fenêtre Antigravity.'
            : `Ton navigateur s’ouvre : connecte-toi à ton compte ${t.account}, puis reviens ici.`)
          return act(ev.currentTarget, api.account(p.id, 'login'))
        }) : null))
    } else if (p.id === 'claudecode') {
      // Nuage passe par le Claude Code installé avec l'application Claude : sans elle, on propose de la télécharger
      if (!p.detected) {
        body.append(step('L’application Claude n’est pas installée sur ce PC', false, button('btn primary', 'La télécharger', () => api.openClaudeDownload())),
          step('Une fois installée et ouverte une fois, reviens ici', false, button('btn secondary', 'Vérifier', ev => act(ev.currentTarget, Promise.resolve({})))))
      } else {
        body.append(step('Application Claude trouvée', true), step(p.loggedIn ? 'Connecté à ton compte Claude' : 'Te connecter à ton compte Claude', p.loggedIn,
          p.loggedIn ? null : button('btn primary', 'Se connecter', ev => act(ev.currentTarget, loginClaude()))))
      }
    } else if (p.kind === 'cle') {
      body.append(keysBox([{ name: p.secret, label: p.help, secret: true, set: p.set }], p.id))
    } else {
      body.append(step(p.detected ? 'Détecté sur ce PC' : `${p.label} n’est pas lancé sur ce PC`, p.detected))
    }
    if (p.ready && !using) body.append(button('btn primary rg-use', `Utiliser ${p.short || p.label}`, ev => act(ev.currentTarget, api.use(p.id))))
    box.append(body)
    return box
  }
  function iaSection() {
    const out = [el('p', 'rg-note', 'L’IA choisie répond dans le chat et agit elle-même sur le PC (fichiers, commandes, pages web, compétences), toujours avec ton accord.')]
    for (const [kind, title, sub] of [['abo', 'Avec ton abonnement', 'sans clé : tu te connectes une fois'], ['cle', 'Avec une clé d’API', 'paiement à l’usage ; OpenRouter a des modèles gratuits'], ['local', 'Sur ce PC', 'sans Internet']]) {
      const sec = el('div', 'rg-sec', title)
      sec.append(el('small', '', sub))
      out.push(sec, ...(state?.ai || []).filter(p => p.kind === kind).map(option))
    }
    out.push(el('p', 'rg-note small', 'Tes clés sont chiffrées par Windows sur ce PC et ne sont jamais réaffichées. Ne les colle jamais dans une conversation.'))
    return out
  }

  // ---------- Compétences et plugins (rien ne s'installe sans un clic) ----------
  async function examine(text) {
    const input = String(text || '').trim()
    if (!input) return
    examined = input
    preview = { loading: true }
    render()
    say('Je regarde ce lien…')
    preview = await api.extExamine(input)
    say('')
    render()
  }
  async function install(b, choice = {}) {
    say('Installation…')
    let r = await act(b, api.extInstall(examined, choice))
    if (r?.code === 'existe' && confirm(`${r.error}\nLa remplacer ? (l’ancienne version part à la corbeille)`)) r = await act(b, api.extInstall(examined, { ...choice, replace: true }))
    if (!r?.error && !choice.plugin) preview = null
    skills = (await api.extList())?.skills || []
    render()
  }
  const item = (title, sub, tag, label, onClick, primary = false) => {
    const row = el('div', 'rg-item')
    const b = el('b', '', title)
    if (tag) b.append(' ', el('span', 'tag', tag))
    row.append(b)
    if (label) row.append(button(primary ? 'btn primary' : 'btn secondary', label, ev => onClick(ev.currentTarget)))
    if (sub) row.append(el('small', '', sub))
    return row
  }
  function skillsSection() {
    const form = el('form', 'rg-form')
    const input = el('input')
    input.type = 'text'
    input.spellcheck = false
    input.placeholder = 'https://github.com/… ou /plugin install …'
    input.value = examined
    form.append(input, button('btn primary', 'Examiner'))
    form.lastChild.type = 'submit'
    form.addEventListener('submit', ev => {
      ev.preventDefault()
      examine(input.value)
    })
    const out = [el('p', 'rg-note', 'Des savoir-faire pour Nuage, utilisés par toutes les IA du chat : colle un lien (GitHub, SKILL.md, .zip) ou une commande (/plugin install nom@catalogue), ou demande-le dans le chat. Nuage te montre d’abord ce qui sera ajouté.'), form]
    if (preview?.loading) out.push(el('p', 'rg-note', 'Examen en cours…'))
    else if (preview?.error) out.push(el('p', 'rg-err', preview.error))
    else if (preview) {
      const card = el('div', 'rg-card')
      card.append(el('b', '', preview.title))
      if (preview.source) card.append(el('small', 'rg-src', `Source : ${preview.source}`))
      card.append(el('p', 'rg-warn', 'Une compétence donne des consignes à l’IA du chat : elle peut lui faire lire, écrire ou lancer des commandes (toujours avec ton accord). N’installe que ce qui vient d’une source de confiance.'))
      if (preview.kind === 'competences') {
        for (const s of preview.skills) card.append(item(s.name, s.description, s.exists ? 'déjà installée' : ''))
        const row = el('div', 'rg-row')
        row.append(button('btn primary', preview.skills.length > 1 ? `Installer les ${preview.skills.length}` : 'Installer', ev => install(ev.currentTarget)),
          button('btn secondary', 'Annuler', () => {
            preview = null
            render()
          }))
        card.append(row)
      } else {
        for (const p of preview.plugins || []) card.append(item(p.name, p.description, '', 'Installer', b => install(b, { plugin: p.name })))
        if (!preview.plugins?.length) card.append(el('p', 'rg-note', 'Ce catalogue est vide.'))
      }
      out.push(card)
    }
    out.push(el('div', 'rg-sec', `Compétences installées (${skills.length})`))
    for (const s of skills) {
      out.push(item(s.name, s.description, '', 'Retirer', async b => {
        if (!confirm(`Retirer la compétence « ${s.name} » ? Elle part à la corbeille.`)) return
        await act(b, api.extRemove(s.name))
        skills = (await api.extList())?.skills || []
        render()
      }))
    }
    if (!skills.length) out.push(el('p', 'rg-note', 'Aucune pour l’instant. Exemple : demande dans le chat « ajoute la compétence pdf ».'))
    return out
  }

  // ---------- Réglages de Nuage (groupes de main.js) ----------
  function row(r) {
    if (r.type === 'switch') return toggle(r.label, r.on, on => api.set(r.key, on), r.disabled)
    if (r.type === 'range') {
      const line = el('label', 'rg-range')
      const input = el('input')
      input.type = 'range'
      input.min = '0'
      input.max = '1'
      input.step = '0.05'
      input.value = String(r.value)
      input.addEventListener('change', () => api.set(r.key, Number(input.value)))
      line.append(el('span', '', r.label), input)
      return line
    }
    if (r.type === 'choice') {
      const line = el('div', 'rg-choice')
      line.append(el('span', '', r.label))
      const opts = el('div', 'rg-chips')
      opts.append(...r.options.map(([value, label]) => button(`rg-chip${value === r.value ? ' on' : ''}`, label, () => api.set(r.key, value))))
      line.append(opts)
      return line
    }
    const b = button(`btn ${r.danger ? 'secondary danger' : 'secondary'}`, r.label, () => api.action(r.id))
    b.disabled = Boolean(r.disabled)
    const line = el('div', 'rg-action')
    line.append(b)
    return line
  }
  const groupBox = g => {
    const box = el('div', 'rg-group')
    box.append(el('div', 'rg-sec', g.title), ...g.rows.map(row))
    return box
  }

  // ---------- Claude Code et intégrations ----------
  function claudeSection() {
    const cc = state?.claudeCode || {}
    const row = el('div', 'rg-row')
    const on = button('btn primary', 'Brancher Nuage à Claude Code', ev => act(ev.currentTarget, api.claudeCode('install')))
    const off = button('btn secondary', 'Débrancher', ev => act(ev.currentTarget, api.claudeCode('remove')))
    on.disabled = Boolean(cc.installed)
    off.disabled = !cc.installed
    row.append(on, off)
    return [
      el('p', `rg-note${cc.installed ? ' ok' : ''}`, `${cc.installed ? 'Nuage est branché à Claude Code : ses sessions apparaissent dans l’accueil.' : 'Nuage n’est pas branché à Claude Code.'} ${cc.note || ''}`),
      row,
      toggle('Afficher les autorisations et questions de Claude dans la barre', state?.settings?.permissionsInNuage, v => api.set('permissionsInNuage', v)),
    ]
  }
  function integrationsSection() {
    const out = [el('p', 'rg-note', 'Branche tes services : leurs nouvelles apparaissent en pastilles dans l’accueil.')]
    for (const i of state?.integrations || []) {
      const ready = i.fields.filter(f => f.secret).every(f => f.set)
      const head = el('div', 'rg-sec', i.label)
      head.append(el('small', ready ? 'ok' : '', ready ? 'configurée' : 'non configurée'))
      out.push(head, keysBox(i.fields, `integ:${i.id}`))
    }
    return out
  }

  // ---------- Dessin ----------
  function render() {
    if (!isOpen()) return
    const head = el('div', 'rg-head')
    const title = el('div', 'rg-title')
    title.append(el('b', '', welcome ? 'Bienvenue !' : 'Réglages'), el('small', '', welcome ? 'Comment veux-tu faire marcher Nuage ?' : 'tout Nuage, ici'))
    head.append(title)
    if (welcome) {
      head.append(button('btn secondary', 'Plus tard', () => {
        welcome = false
        onLater()
      }))
    }
    const parts = [head]
    if (!welcome) {
      const chips = el('div', 'rg-tabs')
      chips.append(...SECTIONS.map(([id, label]) => button(`rg-chip${id === section ? ' on' : ''}`, label, () => (id === 'telephone' ? goPhone() : show(id)))))
      parts.push(chips)
    }
    parts.push(el('div', 'rg-msg', message))
    const body = section === 'ia' ? iaSection()
      : section === 'competences' ? skillsSection()
        : section === 'claude' ? claudeSection()
          : section === 'integrations' ? integrationsSection()
            : groups.filter(g => g.section === section).map(groupBox)
    parts.push(...body)
    const scroll = root.scrollTop
    root.replaceChildren(...parts)
    root.scrollTop = scroll
    layout()
  }
  async function show(id) {
    if (id !== section) {
      section = id
      root.scrollTop = 0
      message = ''
    }
    if (id === 'competences') skills = (await api.extList())?.skills || []
    render()
  }

  api.onUpdate(next => {
    state = next
    render()
  })
  api.onBar(next => {
    groups = next || []
    render()
  })
  // Avancement d'un téléchargement : redessiné avec l'état déjà connu
  api.onProgress(({ id, got, total, done }) => {
    if (done) delete progress[id]
    else progress[id] = { got, total }
    render()
  })

  return {
    // Ouvrir sur une rubrique ; prefill : lien ou commande à examiner (Compétences) ; focus : carte d'IA à déplier
    async open({ section: next = '', prefill = '', welcome: first = false, focus = '' } = {}) {
      welcome = Boolean(first)
      if (welcome) next = 'ia'
      if (next) section = next
      if (focus) opened = focus
      message = ''
      await refresh()
      if (prefill) {
        section = 'competences'
        examine(prefill)
      }
    },
    refresh,
    endWelcome() {
      welcome = false
    },
  }
}

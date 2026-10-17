// Test de la météo (05/10/2026 : relevés réels des stations plutôt que le seul modèle).
// Usage : node outils/test-meteo.js [--reseau]   (--reseau : essai réel sur Lyon, deux appels publics)
const assert = require('node:assert/strict')
const meteo = require('../meteo')

const c = (wxString, cover = 'SCT', clouds = []) => meteo.conditionFromMetar({ wxString, cover, clouds }).key
// Un relevé réel : orage avec pluie faible (le modèle disait « couvert »)
assert.equal(c('-TSRA', 'BKN'), 'orage')
assert.equal(meteo.conditionFromMetar({ wxString: '-TSRA', cover: 'BKN' }).label, 'Orage et pluie')
assert.equal(c('RA'), 'pluie')
assert.equal(c('-SHRA'), 'pluie')
assert.equal(meteo.conditionFromMetar({ wxString: '+RA', cover: 'OVC' }).label, 'Forte pluie')
assert.equal(c('DZ'), 'bruine')
assert.equal(c('BR'), 'brouillard')
assert.equal(c('HZ'), 'brouillard') // brume sèche (harmattan)
// À proximité ou récent seulement : la station elle-même n'a rien
assert.equal(c('VCTS', 'SCT'), 'eclaircies')
assert.equal(c('RERA', 'FEW'), 'eclaircies')
// Nuages
assert.equal(c('', 'CAVOK'), 'soleil')
assert.equal(c('', 'CLR'), 'soleil')
assert.equal(c('', 'FEW'), 'eclaircies')
assert.equal(c('', 'BKN'), 'couvert')
assert.equal(c('', 'OVC'), 'couvert')
assert.equal(c('', 'SCT', [{ cover: 'OVC' }]), 'couvert')

const VILLE = { name: 'Lyon', latitude: 45.764, longitude: 4.8357 }
;(async () => {
  // Faux services : relevé frais à 5 km → il gagne sur le modèle ; trop vieux → le modèle
  const now = Date.now()
  const fake = (obsAgeMin, modelOk = true) => async url => {
    if (url.includes('aviationweather')) {
      return [{ icaoId: 'DXXX', name: 'Lyon/Bron, FR', lat: 45.80126, lon: 4.86816, obsTime: Math.round((now - obsAgeMin * 60_000) / 1000), temp: 23, wxString: '-TSRA', cover: 'BKN', rawOb: 'METAR DXXX …' }]
    }
    if (!modelOk) throw new Error('HTTP 500')
    return { current: { temperature_2m: 26.2, weather_code: 3, is_day: 1, time: '2026-10-05T16:00' } }
  }
  let w = await meteo.currentWeather(fake(20), VILLE)
  assert.equal(w.source, 'releve')
  assert.equal(w.key, 'orage')
  assert.equal(w.temp, 23)
  assert.equal(w.night, false)
  assert.equal(w.km, 5)
  w = await meteo.currentWeather(fake(240), VILLE)
  assert.equal(w.source, 'modele')
  assert.equal(w.temp, 26)
  w = await meteo.currentWeather(fake(20, false), VILLE) // modèle en panne : le relevé suffit
  assert.equal(w.source, 'releve')

  if (process.argv.includes('--reseau')) {
    const fetchJson = url => fetch(url, { headers: { 'User-Agent': 'Nuage-bureau/1.0' }, signal: AbortSignal.timeout(40_000) }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    const real = await meteo.currentWeather(fetchJson, VILLE)
    console.log(`Lyon maintenant : ${real.temp} °C, ${real.label}${real.night ? ' (nuit)' : ''}, source ${real.source}${real.station ? ` (${real.station}, ${real.km} km, ${real.time})` : ''}`)
  }
  console.log('OK : météo (phénomènes des relevés, relevé réel prioritaire, modèle en secours)')
})().catch(error => {
  console.error(error)
  process.exit(1)
})

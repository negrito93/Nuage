// Météo actuelle (Open-Meteo, gratuit, sans clé) et position de la ville.
// Seules les coordonnées de la ville sont envoyées à Open-Meteo, jamais une adresse.
const GEO_IP = 'https://get.geojs.io/v1/ip/geo.json'
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=fr&format=json&name='
const FORECAST = 'https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,is_day&timezone=auto'

// Codes météo WMO -> ambiance de Nuage
function conditionFromCode(code) {
  if (code === 0) return { key: 'soleil', label: 'Ciel dégagé' }
  if (code === 1 || code === 2) return { key: 'eclaircies', label: code === 1 ? 'Peu nuageux' : 'Éclaircies' }
  if (code === 3) return { key: 'couvert', label: 'Couvert' }
  if (code === 45 || code === 48) return { key: 'brouillard', label: 'Brouillard' }
  if (code >= 51 && code <= 57) return { key: 'bruine', label: 'Bruine' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { key: 'pluie', label: 'Pluie' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: 'neige', label: 'Neige' }
  if (code >= 95) return { key: 'orage', label: 'Orage' }
  return { key: 'eclaircies', label: 'Temps variable' }
}

const placeOf = r => ({
  name: r.name,
  admin: r.admin1 || '',
  country: r.country || '',
  countryCode: r.country_code || '',
  latitude: r.latitude,
  longitude: r.longitude,
})

async function geocode(fetchJson, query) {
  const data = await fetchJson(GEOCODE + encodeURIComponent(query))
  return (data.results || []).map(placeOf)
}

// Position approximative depuis l'adresse IP. Sans ville, on se rabat sur la ville du
// fuseau horaire (ex. Europe/Brussels -> Brussels) si elle est dans le même pays.
async function detectPlace(fetchJson) {
  const ip = await fetchJson(GEO_IP)
  if (ip.city) {
    return {
      name: ip.city, admin: ip.region || '', country: ip.country || '', countryCode: ip.country_code || '',
      latitude: Number(ip.latitude), longitude: Number(ip.longitude), source: 'auto',
    }
  }
  const tzCity = String(ip.timezone || '').split('/').pop().replaceAll('_', ' ')
  if (tzCity) {
    const hits = await geocode(fetchJson, tzCity)
    const hit = hits.find(h => !ip.country_code || h.countryCode === ip.country_code)
    if (hit) return { ...hit, source: 'auto' }
  }
  return {
    name: ip.country || 'Position approximative', admin: '', country: ip.country || '', countryCode: ip.country_code || '',
    latitude: Number(ip.latitude), longitude: Number(ip.longitude), source: 'auto',
  }
}

// ---------- Relevé réel (05/10/2026 : « il affiche 26 °C alors qu'il pleut ») ----------
// Open-Meteo est un modèle : un jour d’octobre à 16 h UTC, il annonçait 26 °C et un ciel couvert sans pluie
// pendant que la station de l'aéroport relevait un orage avec pluie (« -TSRA ») à 23 °C. On prend donc le
// relevé METAR de la station la plus proche (service public de la météo aéronautique des États-Unis,
// aviationweather.gov, gratuit, sans clé ; seules les coordonnées de la zone sont envoyées), s'il a moins
// de 100 min et si la station est à moins de 40 km ; sinon le modèle Open-Meteo, comme avant.
const METAR = 'https://aviationweather.gov/api/data/metar?format=json&hours=3&bbox='
const MAX_KM = 40
const MAX_AGE_MS = 100 * 60_000

function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Phénomènes METAR (ceux de la station, pas « VC » à proximité ni « RE » récents), puis couverture nuageuse
function conditionFromMetar(m) {
  const here = String(m.wxString || '').split(/\s+/).filter(t => t && !/^(VC|RE)/.test(t))
  const has = re => here.some(t => re.test(t))
  const light = has(/^-/)
  if (has(/TS|GR/)) return { key: 'orage', label: has(/RA|SH/) ? 'Orage et pluie' : 'Orage' }
  if (has(/SN|SG|PL/)) return { key: 'neige', label: 'Neige' }
  if (has(/RA|SH|UP/)) return { key: 'pluie', label: light ? 'Pluie faible' : has(/^\+/) ? 'Forte pluie' : 'Pluie' }
  if (has(/DZ/)) return { key: 'bruine', label: 'Bruine' }
  if (has(/FG/)) return { key: 'brouillard', label: 'Brouillard' }
  if (has(/BR/)) return { key: 'brouillard', label: 'Brume' }
  if (has(/HZ|DU|SA/)) return { key: 'brouillard', label: 'Brume sèche' }
  const covers = [String(m.cover || ''), ...(m.clouds || []).map(c => String(c.cover || ''))]
  const worst = ['OVC', 'VV', 'BKN', 'SCT', 'FEW'].find(c => covers.includes(c))
  if (worst === 'OVC') return { key: 'couvert', label: 'Couvert' }
  if (worst === 'VV') return { key: 'brouillard', label: 'Brouillard' }
  if (worst === 'BKN') return { key: 'couvert', label: 'Très nuageux' }
  if (worst === 'SCT') return { key: 'eclaircies', label: 'Éclaircies' }
  if (worst === 'FEW') return { key: 'eclaircies', label: 'Peu nuageux' }
  return { key: 'soleil', label: 'Ciel dégagé' } // CLR, SKC, NSC, CAVOK
}

// Dernier relevé de la station la plus proche, ou null
async function observedWeather(fetchJson, place, now = Date.now()) {
  const d = 0.4 // ≈ 44 km autour de la ville
  const box = [place.latitude - d, place.longitude - d, place.latitude + d, place.longitude + d].map(v => v.toFixed(3)).join(',')
  const list = await fetchJson(METAR + box)
  if (!Array.isArray(list) || !list.length) return null
  const fresh = list
    .filter(m => Number.isFinite(m.temp) && Number.isFinite(m.lat) && Number.isFinite(m.lon) && now - Number(m.obsTime) * 1000 < MAX_AGE_MS)
    .map(m => ({ m, km: distanceKm(place, { latitude: m.lat, longitude: m.lon }) }))
    .filter(x => x.km <= MAX_KM)
    .sort((a, b) => a.km - b.km || b.m.obsTime - a.m.obsTime)
  if (!fresh.length) return null
  const { m, km } = fresh[0]
  return {
    ...conditionFromMetar(m),
    temp: Math.round(m.temp),
    time: new Date(Number(m.obsTime) * 1000).toISOString(),
    station: String(m.name || m.icaoId).replace(/,.*$/, ''),
    stationId: m.icaoId,
    km: Math.round(km),
    metar: m.rawOb || '',
  }
}

// Jour ou nuit sans le modèle : heure solaire du lieu (lever ≈ 6 h, coucher ≈ 18 h 30 sous les tropiques)
function solarNight(place, now = new Date()) {
  const h = (now.getUTCHours() + now.getUTCMinutes() / 60 + place.longitude / 15 + 24) % 24
  return h < 6 || h >= 18.5
}

async function modelWeather(fetchJson, place) {
  const data = await fetchJson(`${FORECAST}&latitude=${place.latitude}&longitude=${place.longitude}`)
  const c = data.current
  return {
    ...conditionFromCode(c.weather_code),
    code: c.weather_code,
    night: c.is_day === 0,
    temp: Math.round(c.temperature_2m),
    time: c.time,
    source: 'modele',
  }
}

// Météo actuelle : le relevé réel s'il existe (jour / nuit donnés par le modèle), sinon le modèle
async function currentWeather(fetchJson, place) {
  const [model, obs] = await Promise.allSettled([modelWeather(fetchJson, place), observedWeather(fetchJson, place)])
  const m = model.status === 'fulfilled' ? model.value : null
  const o = obs.status === 'fulfilled' ? obs.value : null
  if (o) return { ...o, code: null, night: m ? m.night : solarNight(place), source: 'releve' }
  if (m) return m
  throw model.reason || obs.reason || new Error('aucune source météo')
}

module.exports = { conditionFromCode, conditionFromMetar, geocode, detectPlace, currentWeather, observedWeather }

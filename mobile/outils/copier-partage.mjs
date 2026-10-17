// Copie dans www/partage les fichiers communs avec Nuage sur le PC (moteur de l'avatar, sa peau, sa vie,
// icônes, sons, police). Usage : npm run partage
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const from = path.join(here, '..', '..', 'renderer')
const to = path.join(here, '..', 'www', 'partage')
const FILES = [
  'vendor/avatar-web.js', 'nuage.avatar.js', 'peau.js', 'vie.js', 'icones.js', 'icones-LICENCE.txt', 'sons.js', 'style.css', 'matrice.js',
  'fonts/nunito-latin-wght-normal.woff2', 'fonts/nunito-latin-ext-wght-normal.woff2', 'fonts/Nunito-OFL.txt',
]
for (const file of FILES) {
  const target = path.join(to, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(from, file), target)
}
console.log(`www/partage : ${FILES.length} fichiers copiés depuis renderer/`)

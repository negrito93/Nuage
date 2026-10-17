// Construit l'application Android (APK de débogage) et la copie dans ../telephone/nuage-de-poche.apk,
// d'où Nuage sur le PC la propose au téléphone (QR code « Installer l'appli »).
// Java 21 et le SDK Android sont dans %LOCALAPPDATA% (aucune variable d'environnement permanente).
// Usage : node outils/construire-apk.mjs [tâche gradle, par défaut assembleDebug]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const local = process.env.LOCALAPPDATA
const javaDir = path.join(local, 'Programs', 'Java')
const jdk = fs.readdirSync(javaDir).filter(n => n.startsWith('jdk-21')).sort().pop()
const env = {
  ...process.env,
  JAVA_HOME: path.join(javaDir, jdk),
  ANDROID_HOME: path.join(local, 'Android', 'Sdk'),
}
env.Path = `${path.join(env.JAVA_HOME, 'bin')};${process.env.Path || process.env.PATH}`
// Fichier de propriétés : « \ » et « : » s'échappent (C\:\\Users\\…)
fs.writeFileSync(path.join(root, 'android', 'local.properties'), `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`)

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status || 1)
}
run('node', ['outils/copier-partage.mjs'], root)
run('npx', ['cap', 'sync', 'android'], root)
const task = process.argv[2] || 'assembleDebug'
run(`"${path.join(root, 'android', 'gradlew.bat')}"`, [task, '--console=plain', '--no-daemon'], path.join(root, 'android'))
if (task === 'assembleDebug') {
  const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  const target = path.join(root, '..', 'telephone', 'nuage-de-poche.apk')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(apk, target)
  // Version de cet APK : le PC la compare à celle du téléphone et lui envoie la mise à jour (main.js offerPhoneUpdate)
  const version = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8').match(/versionName\s+"([^"]+)"/)[1]
  fs.writeFileSync(target.replace(/\.apk$/, '.version'), version)
  console.log(`APK : ${target} (${Math.round(fs.statSync(target).size / 1024 / 1024 * 10) / 10} Mo)`)
}

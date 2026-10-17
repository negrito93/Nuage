// Regroupe @bible-strong/avatar-web (+ avatar-core et ajv) en un seul module ESM
// chargeable hors ligne par la fenêtre de Nuage : renderer/vendor/avatar-web.js
// Usage : npm run vendor
import { build } from 'esbuild'

await build({
  entryPoints: ['node_modules/@bible-strong/avatar-web/dist/index.js'],
  outfile: 'renderer/vendor/avatar-web.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome130',
  minify: true,
  legalComments: 'eof',
})
console.log('OK : renderer/vendor/avatar-web.js')

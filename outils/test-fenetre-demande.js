// Test de la fenêtre « Un téléphone veut se connecter » (main.js, askPairing) : rattachée à une fenêtre invisible
// « au-dessus de tout », elle doit avoir le style Windows TOPMOST ; sans rattachement (v1.7), elle ne l'a pas et
// peut s'ouvrir cachée derrière un navigateur ou un film. Le test montre un dialogue 1 seconde à l'écran, lit son
// style avec user32, puis le ferme lui-même (WM_CLOSE) : aucune souris, aucun clavier.
// Usage : node_modules\electron\dist\electron.exe outils\test-fenetre-demande.js   (code 0 = OK)
const { app, BrowserWindow, dialog, screen } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Cherche le dialogue (classe « #32770 ») parmi les fenêtres de CE processus (FindWindow par titre ne le retrouvait
// pas), lit son style (WS_EX_TOPMOST = 0x8 dans GWL_EXSTYLE = -20) et sa visibilité, puis le ferme (WM_CLOSE).
const CSHARP = [
  'using System; using System.Text; using System.Runtime.InteropServices;',
  'public static class Fen {',
  '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);',
  '  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
  '  public static string Inspecter(uint pidVoulu, string titreVoulu) {',
  '    string res = "ABSENT";',
  '    EnumWindows((h, l) => {',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      if (pid != pidVoulu) return true;',
  '      var c = new StringBuilder(256); GetClassName(h, c, 256);',
  '      var t = new StringBuilder(256); GetWindowText(h, t, 256);',
  '      if (c.ToString() != "#32770" || t.ToString() != titreVoulu) return true;',
  '      res = "TOPMOST=" + ((GetWindowLong(h, -20) & 8) != 0) + " VISIBLE=" + IsWindowVisible(h);',
  '      PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);',
  '      return false;',
  '    }, IntPtr.Zero);',
  '    return res;',
  '  }',
  '}',
].join('\n')

function inspect(title) {
  const script = path.join(os.tmpdir(), `nuage-test-fenetre-${process.pid}.ps1`)
  const text = `Add-Type -TypeDefinition @'\n${CSHARP}\n'@\n[Fen]::Inspecter(${process.pid}, '${title}')\n`
  fs.writeFileSync(script, text, 'utf8')
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
      try {
        fs.unlinkSync(script)
      } catch {}
      resolve(String(stdout || '').trim() || `(rien lu : ${error?.message || ''} ${String(stderr || '').trim().slice(0, 200)})`)
    })
  })
}

async function run(withAnchor) {
  const title = withAnchor ? 'Nuage test demande (avec ancrage)' : 'Nuage test demande (sans ancrage)'
  let anchor = null
  if (withAnchor) {
    // Les mêmes lignes que main.js (askPairing)
    const area = screen.getPrimaryDisplay().workArea
    anchor = new BrowserWindow({
      width: 2, height: 2, x: Math.round(area.x + area.width / 2), y: Math.round(area.y + area.height / 2),
      show: false, frame: false, transparent: true, skipTaskbar: true, resizable: false, hasShadow: false,
    })
    anchor.setAlwaysOnTop(true, 'screen-saver')
    anchor.showInactive()
    anchor.moveTop()
  }
  const options = { type: 'question', title, message: 'Test automatique : cette fenêtre se ferme toute seule.', buttons: ['Accepter', 'Refuser'], defaultId: 0, cancelId: 1, noLink: true }
  const shown = anchor ? dialog.showMessageBox(anchor, options) : dialog.showMessageBox(options)
  await pause(900)
  const style = await inspect(title)
  const { response } = await shown
  if (anchor && !anchor.isDestroyed()) anchor.destroy()
  return { style, response }
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  // Garde-fou : jamais bloqué plus de 30 s (détruire la fenêtre mère ferme aussi son dialogue)
  const watchdog = setTimeout(() => {
    console.error('test-fenetre-demande : ÉCHEC (bloqué plus de 30 s)')
    for (const w of BrowserWindow.getAllWindows()) w.destroy()
    app.exit(2)
  }, 30_000)
  const withAnchor = await run(true)
  const without = await run(false)
  console.log(`avec ancrage : ${withAnchor.style} (réponse après fermeture : ${withAnchor.response})`)
  console.log(`sans ancrage : ${without.style} (pour comparaison)`)
  const ok = /TOPMOST=True/.test(withAnchor.style) && /VISIBLE=True/.test(withAnchor.style) && withAnchor.response === 1
  console.log(ok ? 'test-fenetre-demande : OK (la fenêtre de la demande est au-dessus de tout, et se ferme proprement)' : 'test-fenetre-demande : ÉCHEC')
  clearTimeout(watchdog)
  app.exit(ok ? 0 : 1)
})

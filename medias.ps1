# medias.ps1 - surveille la musique / video en cours (controles multimedias de Windows : Spotify,
# navigateurs, lecteurs video) et si la fenetre au premier plan est en plein ecran.
# Ecrit une ligne JSON a chaque changement sur la sortie standard.
# Lit des commandes sur l'entree standard : toggle | next | previous. S'arrete quand l'entree se ferme.
# Script volontairement en ASCII pur (PowerShell 5.1).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NuageFenetre {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // Nom du processus de la fenetre au premier plan si elle couvre tout son ecran, sinon ""
  public static string PleinEcran() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    var cls = new StringBuilder(256);
    GetClassName(h, cls, 256);
    string c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return "";
    RECT r;
    if (!GetWindowRect(h, out r)) return "";
    var mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "";
    if (r.Left > mi.rcMonitor.Left || r.Top > mi.rcMonitor.Top || r.Right < mi.rcMonitor.Right || r.Bottom < mi.rcMonitor.Bottom) return "";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return "?"; }
  }
}
// Commandes de Nuage lues sur un fil a part : sous PowerShell 5.1, Console.In.ReadLineAsync()
// bloque jusqu'a la prochaine ligne, ce qui figeait toute la surveillance (bug du 04/10/2026).
public static class NuageEntree {
  static readonly System.Collections.Concurrent.ConcurrentQueue<string> file = new System.Collections.Concurrent.ConcurrentQueue<string>();
  public static volatile bool Fin = false;
  public static void Demarrer() {
    var t = new System.Threading.Thread(() => {
      try { string l; while ((l = Console.In.ReadLine()) != null) file.Enqueue(l); } catch { }
      Fin = true;
    });
    t.IsBackground = true;
    t.Start();
  }
  public static string Suivante() { string l; return file.TryDequeue(out l) ? l : null; }
}
"@

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(5000) | Out-Null
    if (-not $t.IsCompleted) { throw "delai depasse" }
    return $t.Result
}
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

[NuageEntree]::Demarrer()
$last = ''
$session = $null
while ($true) {
    $out = [ordered]@{ app = ''; title = ''; artist = ''; status = 'none'; type = ''; fullscreen = '' }
    try {
        $session = @($mgr.GetSessions()) | Where-Object { [string]$_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
        if (-not $session) { $session = $mgr.GetCurrentSession() }
        if ($session) {
            $info = $session.GetPlaybackInfo()
            $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
            $out.app = [string]$session.SourceAppUserModelId
            $out.title = [string]$props.Title
            $out.artist = [string]$props.Artist
            $out.status = ([string]$info.PlaybackStatus).ToLowerInvariant()
            if ($null -ne $info.PlaybackType) { $out.type = ([string]$info.PlaybackType).ToLowerInvariant() }
        }
    } catch {
        $out.error = $_.Exception.Message
    }
    try { $out.fullscreen = [NuageFenetre]::PleinEcran() } catch { $out.fullscreen = '' }
    $json = $out | ConvertTo-Json -Compress
    if ($json -ne $last) {
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
        $last = $json
    }

    # Commandes de Nuage (lecture / pause, suivant, precedent)
    while ($null -ne ($cmd = [NuageEntree]::Suivante())) {
        if ($session) {
            try {
                switch ($cmd.Trim()) {
                    'toggle' { [void](Await ($session.TryTogglePlayPauseAsync()) ([bool])) }
                    'next' { [void](Await ($session.TrySkipNextAsync()) ([bool])) }
                    'previous' { [void](Await ($session.TrySkipPreviousAsync()) ([bool])) }
                }
            } catch { }
        }
    }
    # Entree fermee : Nuage s'est arrete
    if ([NuageEntree]::Fin) { exit 0 }
    Start-Sleep -Milliseconds 1000
}

# veille.ps1 - ecran de veille Nuage : compile le lanceur nuage.scr et regle l'ecran de veille du
# compte (HKCU\Control Panel\Desktop, sans droits administrateur).
#   -Action lire                    : affiche les reglages actuels (JSON)
#   -Action installer -Delai 300    : compile nuage.scr si besoin, l'active avec verrouillage a la
#                                     reprise ; sortie : {"avant":{...},"apres":{...}}
#   -Action retirer -Avant <base64> : remet les reglages d'avant (JSON encode en base64)
#   -Action lancer                  : demarre l'ecran de veille maintenant (comme Windows le ferait)
# Script volontairement en ASCII pur (PowerShell 5.1).
param([string]$Action = 'lire', [int]$Delai = 300, [string]$Avant = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scr = Join-Path $dir 'nuage.scr'
$subKey = 'Control Panel\Desktop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NuageSpi {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint winIni);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@
$SPIF = 3 # SPIF_UPDATEINIFILE | SPIF_SENDCHANGE

# Lanceur appele par Windows : /s affiche, /p apercu (rien), /c reglages, /l lance maintenant
$launcher = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class NuageEcranDeVeille {
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
  [STAThread]
  public static int Main(string[] args) {
    string mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant().Replace('-', '/') : "/c";
    if (mode.Length > 2) mode = mode.Substring(0, 2);
    string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    if (mode == "/l") { SendMessage(GetDesktopWindow(), 0x0112, (IntPtr)0xF140, IntPtr.Zero); return 0; }
    if (mode == "/p") return 0;
    if (mode != "/s") {
      char e = (char)233; // e accent aigu, le script reste en ASCII
      MessageBox.Show("Les r" + e + "glages de l'" + e + "cran de veille Nuage sont dans le menu de Nuage (clic droit sur le nuage).", "Nuage");
      return 0;
    }
    string exe = Path.Combine(dir, @"node_modules\electron\dist\electron.exe");
    if (!File.Exists(exe)) return 1;
    AllowSetForegroundWindow(-1);
    var psi = new ProcessStartInfo(exe, "\"" + dir + "\" --veille") { UseShellExecute = false, WorkingDirectory = dir };
    using (var p = Process.Start(psi)) { p.WaitForExit(); }
    return 0;
  }
}
"@

function Read-Settings {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey)
    $r = [ordered]@{
        scrnsave = [string]$k.GetValue('SCRNSAVE.EXE')
        active = [string]$k.GetValue('ScreenSaveActive')
        timeout = [string]$k.GetValue('ScreenSaveTimeOut')
        secure = [string]$k.GetValue('ScreenSaverIsSecure')
    }
    $k.Close()
    return $r
}
function Write-Value($name, $value) {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey, $true)
    if ([string]::IsNullOrEmpty($value)) { $k.DeleteValue($name, $false) } else { $k.SetValue($name, [string]$value, 'String') }
    $k.Close()
}
function Apply-Spi($active, $timeout, $secure) {
    [void][NuageSpi]::SystemParametersInfo(0x000F, [uint32]$timeout, [IntPtr]::Zero, $SPIF) # SPI_SETSCREENSAVETIMEOUT
    [void][NuageSpi]::SystemParametersInfo(0x0077, [uint32]$secure, [IntPtr]::Zero, $SPIF)  # SPI_SETSCREENSAVESECURE
    [void][NuageSpi]::SystemParametersInfo(0x0011, [uint32]$active, [IntPtr]::Zero, $SPIF)  # SPI_SETSCREENSAVEACTIVE
}

switch ($Action) {
    'lire' {
        Read-Settings | ConvertTo-Json -Compress
    }
    'installer' {
        if (-not (Test-Path $scr) -or (Get-Item $scr).LastWriteTime -lt (Get-Item $MyInvocation.MyCommand.Path).LastWriteTime) {
            $exe = Join-Path $env:TEMP ('nuage-scr-' + [guid]::NewGuid().ToString('N') + '.exe')
            Add-Type -TypeDefinition $launcher -OutputAssembly $exe -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms
            Copy-Item $exe $scr -Force
            [IO.File]::Delete($exe)
        }
        $before = Read-Settings
        Write-Value 'SCRNSAVE.EXE' $scr
        Write-Value 'ScreenSaveActive' '1'
        Write-Value 'ScreenSaveTimeOut' ([string]$Delai)
        Write-Value 'ScreenSaverIsSecure' '1'
        Apply-Spi 1 $Delai 1
        @{ avant = $before; apres = (Read-Settings) } | ConvertTo-Json -Compress
    }
    'retirer' {
        $prev = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Avant)) | ConvertFrom-Json
        Write-Value 'SCRNSAVE.EXE' $prev.scrnsave
        Write-Value 'ScreenSaveActive' $prev.active
        Write-Value 'ScreenSaveTimeOut' $prev.timeout
        Write-Value 'ScreenSaverIsSecure' $prev.secure
        $active = if ($prev.active -eq '1') { 1 } else { 0 }
        $timeout = if ($prev.timeout) { [int]$prev.timeout } else { 900 }
        $secure = if ($prev.secure -eq '1') { 1 } else { 0 }
        Apply-Spi $active $timeout $secure
        @{ apres = (Read-Settings) } | ConvertTo-Json -Compress
    }
    'lancer' {
        [void][NuageSpi]::SendMessage([NuageSpi]::GetDesktopWindow(), 0x0112, [IntPtr]0xF140, [IntPtr]::Zero)
        '{"lance":true}'
    }
}

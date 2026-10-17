# fenetre.ps1 - trouve la fenetre visible situee sous le curseur, en ignorant celles de Nuage
# (processus passes dans -Exclure). Sortie : {"hwnd":<nombre>,"title":"<titre>"} ou {"hwnd":0}.
# Sert a donner une fenetre en contexte au chat quand on lache Nuage dessus (Maj enfoncee).
# Script volontairement en ASCII pur (PowerShell 5.1).
param([string]$Exclure = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NuageFenetreSous {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  public static string Trouver(int[] exclure) {
    POINT p; GetCursorPos(out p);
    IntPtr found = IntPtr.Zero; string title = "";
    // EnumWindows parcourt les fenetres du haut vers le bas de la pile
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(exclure, (int)pid) >= 0) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (p.X < r.L || p.X >= r.R || p.Y < r.T || p.Y >= r.B) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      found = h; title = sb.ToString(); return false;
    }, IntPtr.Zero);
    return found.ToInt64().ToString() + "|" + title;
  }
}
"@
$ids = @($Exclure -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
$r = [NuageFenetreSous]::Trouver([int[]]$ids)
$parts = $r -split '\|', 2
@{ hwnd = [int64]$parts[0]; title = $parts[1] } | ConvertTo-Json -Compress

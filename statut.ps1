# statut.ps1 - compile nuage-statut.exe, la barre d'etat de Claude Code pour Nuage : lit le JSON
# de Claude Code sur l'entree standard, le transmet a Nuage (127.0.0.1, code secret de
# %APPDATA%\Nuage\jeton.txt) et affiche une ligne courte (modele, contexte, limites 5 h / 7 j).
# Usage : powershell -File statut.ps1  -> sortie {"exe":"<chemin>"}
# Script volontairement en ASCII pur (PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir 'nuage-statut.exe'
$source = @"
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Globalization;
public static class NuageStatut {
  public static int Main() {
    Console.InputEncoding = Encoding.UTF8;
    Console.OutputEncoding = Encoding.UTF8;
    string input = Console.In.ReadToEnd();
    try {
      string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
      string jeton = File.ReadAllText(Path.Combine(appData, "Nuage", "jeton.txt")).Trim();
      var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:47823/statusline");
      req.Method = "POST";
      req.ContentType = "application/json";
      req.Timeout = 700;
      req.ReadWriteTimeout = 700;
      req.Proxy = null;
      req.Headers["X-Nuage-Jeton"] = jeton;
      byte[] data = Encoding.UTF8.GetBytes(input);
      using (var s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }
      using (req.GetResponse()) { }
    } catch { }
    Console.Write(Ligne(input));
    return 0;
  }
  static string Find(string json, string pattern) {
    var m = Regex.Match(json, pattern);
    return m.Success ? m.Groups[1].Value : null;
  }
  static string Round(string v) {
    double d;
    return double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out d) ? Math.Round(d).ToString(CultureInfo.InvariantCulture) : v;
  }
  static string Ligne(string json) {
    string model = Find(json, "\"display_name\"\\s*:\\s*\"([^\"]+)\"");
    string ctx = Find(json, "\"context_window\"[\\s\\S]{0,800}?\"used_percentage\"\\s*:\\s*([0-9.]+)");
    string h5 = Find(json, "\"five_hour\"\\s*:\\s*\\{[^}]*?\"used_percentage\"\\s*:\\s*([0-9.]+)");
    string j7 = Find(json, "\"seven_day\"\\s*:\\s*\\{[^}]*?\"used_percentage\"\\s*:\\s*([0-9.]+)");
    var parts = new List<string> { "Nuage" };
    if (model != null) parts.Add(model);
    if (ctx != null) parts.Add("contexte " + Round(ctx) + "%");
    if (h5 != null) parts.Add("5h " + Round(h5) + "%");
    if (j7 != null) parts.Add("7j " + Round(j7) + "%");
    return string.Join(" | ", parts);
  }
}
"@
if (-not (Test-Path $exe) -or (Get-Item $exe).LastWriteTime -lt (Get-Item $MyInvocation.MyCommand.Path).LastWriteTime) {
    $tmp = Join-Path $env:TEMP ('nuage-statut-' + [guid]::NewGuid().ToString('N') + '.exe')
    Add-Type -TypeDefinition $source -OutputAssembly $tmp -OutputType ConsoleApplication
    Copy-Item $tmp $exe -Force
    [IO.File]::Delete($tmp)
}
@{ exe = $exe } | ConvertTo-Json -Compress

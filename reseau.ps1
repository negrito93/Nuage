# Diagnostic du lien avec le telephone (lecture seule, ne change rien) : reseau(x) connecte(s) et leur type
# (Public / Prive) pour Windows, et les regles du pare-feu qui laissent entrer Nuage pour chaque type.
# Si le reseau actuel est d'un type que les regles ne couvrent pas, Windows bloque le telephone sans rien dire.
# Usage : powershell -File reseau.ps1 -Programme <chemin de electron.exe>. Sortie JSON. ASCII pur.
param([string]$Programme = '')
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$reseaux = @(Get-NetConnectionProfile | ForEach-Object {
  @{ nom = [string]$_.Name; categorie = [string]$_.NetworkCategory; interface = [string]$_.InterfaceAlias; internet = ([string]$_.IPv4Connectivity -eq 'Internet') }
})

$autorise = @{ Public = $false; Private = $false; Domain = $false }
$bloque = @{ Public = $false; Private = $false; Domain = $false }
if ($Programme) {
  $cible = $Programme.ToLowerInvariant()
  foreach ($filtre in Get-NetFirewallApplicationFilter) {
    if ([string]::IsNullOrEmpty($filtre.Program) -or $filtre.Program.ToLowerInvariant() -ne $cible) { continue }
    foreach ($regle in ($filtre | Get-NetFirewallRule)) {
      if ([string]$regle.Enabled -ne 'True' -or [string]$regle.Direction -ne 'Inbound') { continue }
      $profils = [string]$regle.Profile
      foreach ($p in @('Public', 'Private', 'Domain')) {
        if ($profils -eq 'Any' -or $profils -match $p) {
          if ([string]$regle.Action -eq 'Allow') { $autorise[$p] = $true } else { $bloque[$p] = $true }
        }
      }
    }
  }
}
$actifs = @{}
foreach ($pr in Get-NetFirewallProfile) { $actifs[[string]$pr.Name] = ([string]$pr.Enabled -eq 'True') }

ConvertTo-Json -Compress -Depth 4 @{
  reseaux = $reseaux
  autorise = $autorise
  bloque = $bloque
  pareFeuActif = $actifs
}

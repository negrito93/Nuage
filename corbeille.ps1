# corbeille.ps1 - restaure depuis la Corbeille les elements que Nuage vient d'avaler (bouton Annuler).
# Entree standard : tableau JSON des chemins d'origine (ASCII, caracteres speciaux en \uXXXX).
# Sortie : {"restored":[noms],"failed":[noms]}. Ne supprime jamais rien.
# Script volontairement en ASCII pur (PowerShell 5.1).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$paths = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$bin = (New-Object -ComObject Shell.Application).Namespace(10)
$items = @($bin.Items())
$restored = @()
$failed = @()
foreach ($p in $paths) {
    $dir = [IO.Path]::GetDirectoryName($p)
    $name = [IO.Path]::GetFileName($p)
    if (Test-Path -LiteralPath $p) { $failed += $name; continue }
    # Element le plus recent supprime depuis ce dossier sous ce nom
    $hit = $items | Where-Object {
        [string]$_.ExtendedProperty('System.Recycle.DeletedFrom') -eq $dir -and [string]$_.ExtendedProperty('System.FileName') -eq $name
    } | Sort-Object { [datetime]$_.ExtendedProperty('System.Recycle.DateDeleted') } -Descending | Select-Object -First 1
    if (-not $hit) { $failed += $name; continue }
    try { $hit.InvokeVerb('undelete'); $restored += $name } catch { $failed += $name }
}
Start-Sleep -Milliseconds 600
@{ restored = $restored; failed = $failed } | ConvertTo-Json -Compress

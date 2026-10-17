# verrouillage.ps1 - lit et change l'image de l'ecran de verrouillage de Windows (API officielle
# Windows.System.UserProfile.LockScreen, reglage du compte, sans droits administrateur).
# Sans parametre : lit seulement. Avec -Image <chemin> : applique cette image.
# Sortie : {"before":"<image avant>","after":"<image apres>"} (chemin local si c'est un fichier).
# Script volontairement en ASCII pur (PowerShell 5.1).
param([string]$Image = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTaskOp = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskAction = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$type) {
    $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    return $t.Result
}
function AwaitAction($action) {
    $t = $asTaskAction.Invoke($null, @($action))
    $t.Wait(-1) | Out-Null
}
function Describe($uri) {
    if ($null -eq $uri) { return '' }
    $u = [Uri]([string]$uri)
    if ($u.IsFile) { return $u.LocalPath }
    return [string]$uri
}

$lockType = [Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType = WindowsRuntime]
$fileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$before = Describe ($lockType::OriginalImageFile)
if ($Image) {
    $file = Await ($fileType::GetFileFromPathAsync($Image)) $fileType
    AwaitAction ($lockType::SetImageFileAsync($file))
}
$after = Describe ($lockType::OriginalImageFile)
@{ before = $before; after = $after } | ConvertTo-Json -Compress

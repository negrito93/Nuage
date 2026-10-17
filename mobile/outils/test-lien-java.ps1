# Test croise : le protocole Java du telephone (LienProtocoleTest) contre le vrai serveur du PC (lien.js),
# sur 127.0.0.1. Aucun telephone necessaire. Usage : powershell -File outils\test-lien-java.ps1
$ErrorActionPreference = 'Stop'
$racine = Split-Path $PSScriptRoot -Parent
$bureau = Split-Path $racine -Parent
$dossier = Join-Path $env:TEMP ('nuage-test-lien-java-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $dossier | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$serveur = Start-Process -FilePath 'node' -ArgumentList ('"' + (Join-Path $bureau 'outils\serveur-test-lien.js') + '"'), ('"' + $dossier + '"') -PassThru -WindowStyle Hidden
try {
  $qr = Join-Path $dossier 'qr.txt'
  for ($i = 0; $i -lt 50 -and -not (Test-Path $qr); $i++) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $qr)) { throw 'serveur de test absent' }
  $env:NUAGE_TEST_DIR = $dossier # le test lit qr.txt dans ce dossier
  $env:JAVA_HOME = (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Java') -Directory -Filter 'jdk-21*' | Sort-Object Name -Descending | Select-Object -First 1).FullName
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  Push-Location (Join-Path $racine 'android')
  $ErrorActionPreference = 'Continue' # les avertissements de Gradle passent par stderr
  & .\gradlew.bat testDebugUnitTest --tests 'app.nuage.poche.*' --console=plain --no-daemon --rerun-tasks 2>&1 | ForEach-Object { "$_" } | Select-String -Pattern 'Test >|BUILD|FAILED|Exception|expected' | ForEach-Object { $_.Line }
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Pop-Location
  $bilan = Get-Content (Join-Path $dossier 'bilan.json') -Raw | ConvertFrom-Json
  $java = (Get-Content (Join-Path $dossier 'java.sha256') -Raw).Trim()
  "associe : $($bilan.associe)"
  "presse-papiers recu par le PC : $($bilan.presse) (source : $($bilan.source))"
  "etat du telephone : batterie $($bilan.etat.batterie), version $($bilan.etat.version), Android $($bilan.etat.android)"
  "signal : $($bilan.signal)"
  "chat par le PC : $($bilan.api)"
  "fichier recu par le PC : $($bilan.recu.nom), empreinte identique : $($bilan.recu.sha256 -eq $java)"
  $codeJava = (Get-Content (Join-Path $dossier 'code-java.txt') -Raw -ErrorAction SilentlyContinue)
  if ($codeJava) { $codeJava = $codeJava.Trim() }
  "association par le Wi-Fi : code du PC $($bilan.code), code du telephone $codeJava"
  if ($code -ne 0 -or -not $bilan.associe -or $bilan.recu.sha256 -ne $java -or $bilan.source -ne 'menu' -or $bilan.etat.batterie -ne 57 -or $bilan.signal -ne 'coucou' -or $bilan.api -ne 'chat-envoyer' -or -not $bilan.code -or $bilan.code -ne $codeJava) { throw 'test croise en echec' }
  'test-lien-java : OK'
} finally {
  if (-not $serveur.HasExited) { Stop-Process -Id $serveur.Id -Force }
  [IO.Directory]::Delete($dossier, $true)
}

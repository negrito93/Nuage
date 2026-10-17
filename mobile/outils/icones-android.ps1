# Icone de l'appli et ecran de demarrage : Nuage (assets\nuage.png) sur fond nuit, avec un halo bleu
# (version sombre du 04/10/2026, comme l'appli). ASCII pur. Usage : powershell -File outils\icones-android.ps1
Add-Type -AssemblyName System.Drawing
$racine = Split-Path $PSScriptRoot -Parent
$res = Join-Path $racine 'android\app\src\main\res'
$nuage = [System.Drawing.Image]::FromFile((Join-Path (Split-Path $racine -Parent) 'assets\nuage.png'))
$haut = [System.Drawing.Color]::FromArgb(255, 27, 30, 37)
$bas = [System.Drawing.Color]::FromArgb(255, 11, 12, 15)
$fond = [System.Drawing.Color]::FromArgb(255, 11, 12, 15)
$halo = [System.Drawing.Color]::FromArgb(120, 142, 197, 255)
$transparent = [System.Drawing.Color]::FromArgb(0, 142, 197, 255)

# Halo doux derriere Nuage : ellipse dont la couleur s'efface vers le bord
function Halo($g, [int]$w, [int]$h, [double]$part) {
  $d = [int]([Math]::Min($w, $h) * $part)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse([int](($w - $d) / 2), [int](($h - $d) / 2), $d, $d)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush $p
  $b.CenterColor = $halo
  $b.SurroundColors = @($transparent)
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

function Dessiner([int]$w, [int]$h, [double]$part, [string]$forme, [string]$sortie) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($forme -ne 'aucune') {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $pinceau = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $haut, $bas, 90
    if ($forme -eq 'rond') { $g.FillEllipse($pinceau, 0, 0, $w - 1, $h - 1) }
    elseif ($forme -eq 'carre') {
      $r = [int]($w * 0.22)
      $p = New-Object System.Drawing.Drawing2D.GraphicsPath
      $p.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $p.AddArc($w - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
      $p.AddArc($w - 2 * $r - 1, $h - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90); $p.AddArc(0, $h - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90)
      $p.CloseFigure(); $g.FillPath($pinceau, $p)
    } else { $g.Clear($fond) }
    Halo $g $w $h ([Math]::Min(1.0, $part * 1.9))
  }
  $taille = [int]([Math]::Min($w, $h) * $part)
  $g.DrawImage($nuage, [int](($w - $taille) / 2), [int](($h - $taille) / 2), $taille, $taille)
  $g.Dispose()
  $bmp.Save($sortie, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$densites = @{ 'mdpi' = 1.0; 'hdpi' = 1.5; 'xhdpi' = 2.0; 'xxhdpi' = 3.0; 'xxxhdpi' = 4.0 }
foreach ($d in $densites.Keys) {
  $f = $densites[$d]
  $dossier = Join-Path $res "mipmap-$d"
  Dessiner ([int](48 * $f)) ([int](48 * $f)) 0.80 'carre' (Join-Path $dossier 'ic_launcher.png')
  Dessiner ([int](48 * $f)) ([int](48 * $f)) 0.74 'rond' (Join-Path $dossier 'ic_launcher_round.png')
  # Icone adaptative : premier plan transparent, Nuage dans la zone sure (66 dp sur 108)
  Dessiner ([int](108 * $f)) ([int](108 * $f)) 0.60 'aucune' (Join-Path $dossier 'ic_launcher_foreground.png')
}
# Ecran de demarrage : Nuage au centre, fond nuit, toutes orientations
Get-ChildItem $res -Directory -Filter 'drawable*' | ForEach-Object {
  $s = Join-Path $_.FullName 'splash.png'
  if (Test-Path $s) {
    $i = [System.Drawing.Image]::FromFile($s); $w = $i.Width; $h = $i.Height; $i.Dispose()
    Dessiner $w $h 0.36 'fond' $s
  }
}
$nuage.Dispose()
[IO.File]::WriteAllText((Join-Path $res 'values\ic_launcher_background.xml'), "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<resources>`n    <color name=`"ic_launcher_background`">#121419</color>`n</resources>`n")
'icones et ecran de demarrage regeneres'

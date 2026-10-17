# Voix de Nuage sur le PC (05/10/2026) : ecoute "Hey Nuage", puis la phrase qui suit, hors ligne, avec la
# reconnaissance vocale de Windows (francais, System.Speech). Rien n'est enregistre ni envoye sur Internet.
# Sortie : une ligne JSON par evenement : pret, reveil, partiel, phrase, silence, ecoute, erreur, fin.
# Entree : une commande par ligne : ecoute (question tout de suite), pause, reprendre, stop.
# Test sans micro : -Fichier <son.wav> (outils\test-voix.js). Script en ASCII pur : accents par [char].
param([string]$Fichier = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Dire($objet) {
  [Console]::Out.WriteLine((ConvertTo-Json $objet -Compress))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $culture = New-Object System.Globalization.CultureInfo 'fr-FR'
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine $culture
} catch {
  Dire @{ type = 'erreur'; code = 'langue'; message = $_.Exception.Message }
  exit 2
}

# Mots de reveil : "hey nuage", "he nuage", "ok nuage"...
$e = [string][char]0xE9
$mots = @('hey nuage', ('h' + $e + ' nuage'), 'eh nuage', 'ok nuage', 'salut nuage', 'dis nuage', 'coucou nuage', 'allo nuage')
$choix = New-Object System.Speech.Recognition.Choices
foreach ($m in $mots) { $choix.Add($m) }

# 1) le mot de reveil seul ; 2) le mot de reveil suivi de la question d'une traite ; 3) la dictee libre,
# qui sert aussi de "concurrente" : une phrase quelconque y tombe au lieu d'etre prise pour un reveil
$gb = New-Object System.Speech.Recognition.GrammarBuilder
$gb.Culture = $culture
$gb.Append($choix)
$reveil = New-Object System.Speech.Recognition.Grammar $gb
$reveil.Name = 'reveil'

$gb2 = New-Object System.Speech.Recognition.GrammarBuilder
$gb2.Culture = $culture
$gb2.Append($choix)
$gb2.AppendDictation()
$reveilPhrase = New-Object System.Speech.Recognition.Grammar $gb2
$reveilPhrase.Name = 'reveil-phrase'

$dictee = New-Object System.Speech.Recognition.DictationGrammar
$dictee.Name = 'dictee'

# 4) les commandes de Nuage, phrases exactes : bien mieux reconnues que la dictee libre (qui entendait
# "ouvre le charme" pour "ouvre le chat"). Le reste (une vraie question) passe par la dictee.
$a = [string][char]0xE0
$ee = [string][char]0xEA
$commandes = @(
  'ouvre le chat', 'affiche le chat', 'ferme le chat', 'ferme la barre',
  ('fais sonner mon t' + $e + 'l' + $e + 'phone'), ('o' + [char]0xF9 + ' est mon t' + $e + 'l' + $e + 'phone'),
  ('envoie le presse-papiers au t' + $e + 'l' + $e + 'phone'), ('ouvre le menu t' + $e + 'l' + $e + 'phone'),
  'quelle heure est-il', 'quel temps fait-il', ('quelle est la m' + $e + 't' + $e + 'o'),
  'cache-toi', 'montre-toi', 'est-ce que Claude a fini', ('o' + [char]0xF9 + ' en est Claude'),
  ('arr' + $ee + 'te d' + [char]0x27 + $e + 'couter'), 'tais-toi', 'nouvelle session', 'merci', 'rien', 'laisse tomber'
)
$choixCommandes = New-Object System.Speech.Recognition.Choices
foreach ($c in $commandes) { $choixCommandes.Add($c) }
$gb3 = New-Object System.Speech.Recognition.GrammarBuilder
$gb3.Culture = $culture
$gb3.Append($choixCommandes)
$commande = New-Object System.Speech.Recognition.Grammar $gb3
$commande.Name = 'commande'
$commande.Priority = 2

try {
  $rec.LoadGrammar($reveil)
  $rec.LoadGrammar($reveilPhrase)
  $rec.LoadGrammar($commande)
  $rec.LoadGrammar($dictee)
  if ($Fichier) { $rec.SetInputToWaveFile($Fichier) } else { $rec.SetInputToDefaultAudioDevice() }
} catch {
  Dire @{ type = 'erreur'; code = 'micro'; message = $_.Exception.Message }
  exit 3
}
$rec.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(700)
$rec.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1100)

Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -SourceIdentifier 'reco' | Out-Null
Register-ObjectEvent -InputObject $rec -EventName SpeechHypothesized -SourceIdentifier 'hypo' | Out-Null
Register-ObjectEvent -InputObject $rec -EventName RecognizeCompleted -SourceIdentifier 'fini' | Out-Null
# L'ecoute de ce moteur (ancien, hors ligne) ne demarre qu'en secours : voir plus bas

# Le mot de reveil au debut d'une phrase dictee ("et nuage", "he nuage quelle heure...")
$motif = '^\s*(hey|h' + $e + '|eh|et|ok|salut|dis|coucou|allo)\s+nuages?\b[\s,.!?]*(.*)$'
$etat = 'veille'      # veille | question
$depuis = [DateTime]::Now
$pause = $false
$fin = $false
$dernierPartiel = [DateTime]::MinValue
# Commandes de Nuage (pas en test : l'entree y est fermee), lues sur un fil a part : sous PowerShell 5.1,
# [Console]::In.ReadLineAsync() bloque jusqu'a la prochaine ligne. "pret" n'arrivait donc jamais et
# "Hey Nuage" n'etait jamais ecoute tant que Nuage n'envoyait rien (bug du 05/10/2026, meme piege que
# medias.ps1 le 04/10/2026).
if (-not $Fichier) {
  Add-Type -TypeDefinition @"
using System;
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
  [NuageEntree]::Demarrer()
}

function Question([string]$texte, [double]$confiance) {
  Dire @{ type = 'phrase'; texte = $texte.Trim(); confiance = [math]::Round($confiance, 2) }
}

# La question, avec le moteur recent de Windows (celui de la dictee Windows), bien plus juste que la dictee
# ci-dessus avec un vrai micro ("en a" au lieu de la question, 05/10/2026). Il demande l'option Windows
# "Reconnaissance vocale en ligne" (choix de l'utilisateur : le son part alors chez Microsoft) ; sans elle,
# on le dit une fois et on garde la dictee hors ligne. Pas en test (fichier son) : il ne lit que le micro.
$winrt = $null
$winrtOk = -not $Fichier
$dernierStatut = ''
function Charger-WinRT {
  if ($script:asTask) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
  $null = [Windows.Media.SpeechRecognition.SpeechRecognitionListConstraint, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $methodes = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }
  $script:asTask = ($methodes | Where-Object { $_.GetParameters().Count -eq 1 })[0]
  # Variante annulable (le mot de reveil s'arrete quand Nuage parle ou quand on appuie sur Ctrl+Alt+H)
  $script:asTaskAnnulable = ($methodes | Where-Object { $_.GetParameters().Count -eq 2 -and $_.GetParameters()[1].ParameterType.Name -eq 'CancellationToken' })[0]
}
function Preparer-WinRT {
  Charger-WinRT
  $r = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer (New-Object Windows.Globalization.Language 'fr-FR')
  $r.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
  $r.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1200)
  $c = Attendre ($r.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
  if ([string]$c.Status -ne 'Success') { throw "compilation $($c.Status)" }
  return $r
}
function Attendre($op, [Type]$t) {
  $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $null = $task.Wait(-1)
  return $task.Result
}
# Renvoie la phrase ($null : rien entendu) ; $winrtOk passe a faux si le moteur est indisponible
function Question-WinRT {
  try {
    if (-not $script:winrt) { $script:winrt = Preparer-WinRT }
    $res = Attendre ($script:winrt.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
    if ([string]$res.Status -eq 'Success' -and $res.Text) { return [string]$res.Text }
    $script:dernierStatut = [string]$res.Status   # TimeoutExceeded (rien dit), NetworkFailure, MicrophoneUnavailable...
    return $null
  } catch {
    $script:winrtOk = $false
    $msg = [string]$_.Exception.InnerException.Message + ' ' + [string]$_.Exception.Message
    Dire @{ type = 'qualite'; raison = $(if ($msg -match '80045509|privacy|confidentialit') { 'en-ligne' } else { 'indisponible' }); message = $msg.Trim() }
    return $false
  }
}
# Apres "Hey Nuage" : la question par le moteur recent ; $true si c'est fait (sinon, dictee hors ligne)
function Ecouter-Question {
  if (-not $script:winrtOk) { return $false }
  Dire @{ type = 'ecoute' }
  $texte = Question-WinRT
  if ($texte -eq $false) { return $false }
  Get-Event | Remove-Event   # ce que l'autre moteur a entendu pendant ce temps est ignore
  if ($texte) { Question $texte 0.9 } else { Dire @{ type = 'silence'; statut = $script:dernierStatut } }
  $script:etat = 'veille'
  return $true
}

# ---------- Mot de reveil avec le moteur recent de Windows (05/10/2026 au soir) ----------
# L'ancien moteur (ci-dessous) comprenait "neuf" pour "Hey Nuage" et la dictee hors ligne melangeait tout
# avec la tele. Le moteur recent ecoute une liste fermee de mots de reveil : c'est fait SUR LE PC (une liste
# n'a pas besoin d'Internet), le reste est rejete. Seule la question qui suit part chez Microsoft (option
# "Reconnaissance vocale en ligne", activee par l'utilisateur). Sans cette option ou si le moteur recent ne
# demarre pas : l'ancien moteur, comme avant.
function Preparer-Reveil {
  Charger-WinRT
  $r = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer (New-Object Windows.Globalization.Language 'fr-FR')
  # New-Object ne trouve pas ce constructeur (liste WinRT) : on passe par la reflexion, avec une vraie liste
  $ctor = [Windows.Media.SpeechRecognition.SpeechRecognitionListConstraint].GetConstructors() | Where-Object { $_.GetParameters().Count -eq 2 } | Select-Object -First 1
  $listeMots = New-Object 'System.Collections.Generic.List[string]'
  foreach ($m in $mots) { $listeMots.Add($m) }
  $liste = $ctor.Invoke(@([System.Collections.Generic.IEnumerable[string]]$listeMots, 'reveil'))
  # Constraints est une liste WinRT : PowerShell n'en voit pas la methode Add, on passe par l'interface
  $null = [Windows.Media.SpeechRecognition.ISpeechRecognitionConstraint, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
  $collection = [System.Collections.Generic.ICollection[Windows.Media.SpeechRecognition.ISpeechRecognitionConstraint]]
  $null = $collection.GetMethod('Add').Invoke($r.Constraints, @($liste))
  $r.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(15)
  $r.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(350)
  $c = Attendre ($r.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
  if ([string]$c.Status -ne 'Success') { throw "compilation $($c.Status)" }
  return $r
}
$moteur = 'ancien'
$guet = $null
if (-not $Fichier) {
  try {
    $guet = Preparer-Reveil
    $script:winrt = Preparer-WinRT   # le moteur de la question est pret d'avance (rien n'est envoye)
    $moteur = 'recent'
  } catch {
    $guet = $null
    $msg = [string]$_.Exception.InnerException.Message + ' ' + [string]$_.Exception.Message
    if ($msg -match '80045509|privacy|confidentialit') { $winrtOk = $false }
    Dire @{ type = 'qualite'; raison = $(if ($msg -match '80045509|privacy|confidentialit') { 'en-ligne' } else { 'indisponible' }); message = ('moteur recent : ' + $msg.Trim()) }
  }
}
Dire @{ type = 'pret'; moteur = $moteur }

if ($guet) {
  $tache = $null
  $annule = $null
  $typeRes = [Windows.Media.SpeechRecognition.SpeechRecognitionResult]
  function Couper-Guet {
    if ($script:annule) { try { $script:annule.Cancel() } catch {} }
    $script:tache = $null
    $script:annule = $null
  }
  while (-not $fin) {
    while ($null -ne ($cmd = [NuageEntree]::Suivante())) {
      switch ($cmd.Trim()) {
        'ecoute' {
          Couper-Guet
          $pause = $false
          if (-not (Ecouter-Question)) { Dire @{ type = 'ecoute' } }
        }
        'pause' { $pause = $true; Couper-Guet }
        'reprendre' { $pause = $false }
        'stop' { $fin = $true }
      }
    }
    if ($fin -or [NuageEntree]::Fin) { $fin = $true; break }
    if (-not $winrtOk) { break }   # moteur en ligne refuse : on passe a l'ancien moteur
    if ($pause) { Start-Sleep -Milliseconds 60; continue }
    if (-not $tache) {
      if ($asTaskAnnulable) {
        $annule = New-Object System.Threading.CancellationTokenSource
        $tache = $asTaskAnnulable.MakeGenericMethod($typeRes).Invoke($null, @($guet.RecognizeAsync(), $annule.Token))
      } else {
        $tache = $asTask.MakeGenericMethod($typeRes).Invoke($null, @($guet.RecognizeAsync()))
      }
    }
    if ($tache.IsCompleted) {
      $res = $null
      if ([string]$tache.Status -eq 'RanToCompletion') { $res = $tache.Result }
      $tache = $null
      $annule = $null
      if ($pause) { continue }   # Nuage parlait : ce qui a ete entendu est sa propre voix
      $statut = $(if ($res) { [string]$res.Status } else { 'Annule' })
      if ($statut -ne 'Success' -and $statut -ne 'TimeoutExceeded' -and $statut -ne 'Annule') {
        # Echecs en serie (micro pris, moteur en panne) : pas de boucle a vide, puis l'ancien moteur
        $echecs = 1 + [int]$echecs
        if ($echecs -ge 15) {
          Dire @{ type = 'qualite'; raison = 'indisponible'; message = ('moteur recent : ' + $statut) }
          break
        }
        Start-Sleep -Milliseconds 500
        continue
      }
      $echecs = 0
      if ($res -and [string]$res.Status -eq 'Success' -and $res.Text) {
        $niveau = [string]$res.Confidence
        $brut = [math]::Round([double]$res.RawConfidence, 2)
        Dire @{ type = 'entendu'; texte = [string]$res.Text; grammaire = ('reveil-recent ' + $niveau); confiance = $brut }
        if ($niveau -eq 'High' -or $niveau -eq 'Medium') {
          Dire @{ type = 'reveil'; confiance = $brut }
          if (-not (Ecouter-Question)) { break }
        }
      }
      continue
    }
    Start-Sleep -Milliseconds 40
  }
  Couper-Guet
}

# ---------- Ancien moteur (secours, et tests avec un fichier son) ----------
if (-not $fin) { $rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple) }
while (-not $fin) {
  $ev = Get-Event | Select-Object -First 1
  if ($ev) {
    Remove-Event -EventIdentifier $ev.EventIdentifier
    if ($ev.SourceIdentifier -eq 'fini') { break }
    $r = $ev.SourceEventArgs.Result
    if ($r -and -not $pause) {
      $texte = [string]$r.Text
      $conf = [double]$r.Confidence
      $g = [string]$r.Grammar.Name
      if ($ev.SourceIdentifier -eq 'hypo') {
        # Ce qui est en train d'etre dit (question seulement), au plus 4 fois par seconde
        if ($etat -eq 'question' -and $g -ne 'reveil' -and ([DateTime]::Now - $dernierPartiel).TotalMilliseconds -gt 250) {
          $dernierPartiel = [DateTime]::Now
          Dire @{ type = 'partiel'; texte = $texte }
        }
      } elseif ($etat -eq 'veille') {
        # Journal local de ce qui est entendu (reglage de "Hey Nuage" : voix-journal.txt, jamais envoye)
        Dire @{ type = 'entendu'; texte = $texte; grammaire = $g; confiance = [math]::Round($conf, 2) }
        if ($g -eq 'reveil' -and $conf -ge 0.45) {
          Dire @{ type = 'reveil'; confiance = [math]::Round($conf, 2) }
          $etat = 'question'
          $depuis = [DateTime]::Now
          if (Ecouter-Question) { continue }
        } elseif ($g -eq 'reveil-phrase' -and $conf -ge 0.4) {
          $reste = ($texte -replace '^\s*\S+\s+\S+\s*', '')
          Dire @{ type = 'reveil'; confiance = [math]::Round($conf, 2) }
          Question $reste $conf
        } elseif ($g -eq 'dictee' -and $texte -match $motif) {
          Dire @{ type = 'reveil'; confiance = [math]::Round($conf, 2) }
          if ($Matches[2].Trim().Split(' ').Count -ge 2) { Question $Matches[2] $conf }
          else {
            $etat = 'question'
            $depuis = [DateTime]::Now
            if (Ecouter-Question) { continue }
          }
        }
      } else {
        if ($g -eq 'reveil') { $depuis = [DateTime]::Now }   # "hey nuage" redit : il attend toujours
        else {
          if ($g -eq 'reveil-phrase') { $texte = ($texte -replace '^\s*\S+\s+\S+\s*', '') }
          Question $texte $conf
          $etat = 'veille'
        }
      }
    }
    continue
  }
  if ($etat -eq 'question' -and ([DateTime]::Now - $depuis).TotalSeconds -gt 8) {
    Dire @{ type = 'silence' }
    $etat = 'veille'
  }
  if (-not $Fichier) {
    while ($null -ne ($cmd = [NuageEntree]::Suivante())) {
      switch ($cmd.Trim()) {
        'ecoute' {
          $pause = $false
          $etat = 'question'
          $depuis = [DateTime]::Now
          if (-not (Ecouter-Question)) { Dire @{ type = 'ecoute' } }
        }
        'pause' { $pause = $true }
        'reprendre' { $pause = $false }
        'stop' { $fin = $true }
      }
    }
    if ([NuageEntree]::Fin) { break }   # entree fermee : Nuage s'est arrete
  }
  Start-Sleep -Milliseconds 60
}
try { $rec.RecognizeAsyncCancel() } catch {}
# Abonnements rendus avant de sortir (sinon PowerShell quitte avec le code 2)
Get-EventSubscriber | Unregister-Event
Get-Event | Remove-Event
$rec.Dispose()
Dire @{ type = 'fin' }
exit 0

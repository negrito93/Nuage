package app.nuage.poche;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Voix de Nuage de poche (05/10/2026) : « Hey Nuage » écouté tant que l'appli est à l'écran (choix de
 * l'utilisateur : le micro en arrière-plan est très limité par Android), puis la question, et la réponse
 * lue à voix haute en français. Reconnaissance vocale d'Android (sur l'appareil quand il sait le faire),
 * synthèse vocale d'Android. Rien n'est enregistré. L'écoute se met en pause après 3 min sans toucher
 * l'écran (batterie, et certains téléphones font un petit bip à chaque écoute) ; un toucher la relance.
 * Événements : ecoute (mode), reveil, partiel, phrase, silence, parle, fini, erreur, pause.
 */
final class Voix {
    interface Ecouteur {
        void evenement(String type, String texte);
    }

    private static final long PAUSE_INACTIVITE_MS = 3 * 60_000;

    private final Context contexte;
    private final Ecouteur ecouteur;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private SpeechRecognizer reco;
    private boolean surAppareil; // reconnaissance faite sur le téléphone (pas d'envoi à un service en ligne)
    private boolean surAppareilEchoue;
    private TextToSpeech tts;
    private boolean ttsPret;
    private boolean veille; // « Hey Nuage » voulu
    private boolean visible; // appli à l'écran
    private boolean parle;
    private boolean enCours; // une écoute est lancée
    private String mode = "repos"; // repos | reveil | phrase
    private long derniereActivite = System.currentTimeMillis();
    private int erreursDeSuite;
    private long dernierNiveau;
    private final Runnable relancer = this::maj;

    Voix(Context contexte, Ecouteur ecouteur) {
        this.contexte = contexte.getApplicationContext();
        this.ecouteur = ecouteur;
        tts = new TextToSpeech(this.contexte, statut -> {
            if (statut != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(Locale.FRANCE);
            ttsPret = r >= TextToSpeech.LANG_AVAILABLE;
            choisirMeilleureVoix();
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {
                    principal.post(() -> dire("parle", ""));
                }

                @Override
                public void onDone(String id) {
                    principal.post(() -> finParole());
                }

                @Override
                public void onError(String id) {
                    principal.post(() -> finParole());
                }
            });
        });
    }

    /**
     * Voix la plus naturelle (05/10/2026 : « une voix plus naturelle ») : française, installée sur le
     * téléphone (pas besoin de réseau), de la plus haute qualité ; à qualité égale, une voix du système
     * de Google « neuronale » plutôt qu'une ancienne. Débit et ton un peu plus vivants.
     */
    private void choisirMeilleureVoix() {
        try {
            android.speech.tts.Voice meilleure = null;
            int meilleurScore = Integer.MIN_VALUE;
            for (android.speech.tts.Voice v : tts.getVoices()) {
                Locale l = v.getLocale();
                if (l == null || !"fr".equals(l.getLanguage())) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                int score = v.getQuality();
                if (v.isNetworkConnectionRequired()) score -= 150; // marche aussi sans Internet
                if ("FR".equals(l.getCountry())) score += 20;
                if (v.getName() != null && v.getName().contains("-local")) score += 10;
                if (score > meilleurScore) {
                    meilleurScore = score;
                    meilleure = v;
                }
            }
            if (meilleure != null) tts.setVoice(meilleure);
            tts.setSpeechRate(1.03f);
            tts.setPitch(1.06f);
        } catch (Exception ignore) {
            // moteur qui ne liste pas ses voix : on garde celle par défaut
        }
    }

    static boolean disponible(Context c) {
        return SpeechRecognizer.isRecognitionAvailable(c);
    }

    private void dire(String type, String texte) {
        ecouteur.evenement(type, texte == null ? "" : texte);
    }

    // ---------- Commandes (fil principal) ----------
    void setVeille(boolean oui) {
        veille = oui;
        derniereActivite = System.currentTimeMillis();
        maj();
    }

    void setVisible(boolean oui) {
        visible = oui;
        if (oui) derniereActivite = System.currentTimeMillis();
        else taire();
        maj();
    }

    /** L'utilisateur touche l'écran : l'écoute repart si elle s'était mise en pause. */
    void activite() {
        boolean enPause = veille && visible && "repos".equals(mode) && !enCours;
        derniereActivite = System.currentTimeMillis();
        if (enPause) maj();
    }

    /** Écouter une question tout de suite (bouton micro, ou après « Hey Nuage »). */
    void ecouterPhrase() {
        arreterEcoute();
        taire();
        mode = "phrase";
        derniereActivite = System.currentTimeMillis();
        demarrer();
    }

    void parler(String texte) {
        if (!ttsPret || texte == null || texte.trim().isEmpty()) {
            dire("fini", "");
            return;
        }
        arreterEcoute();
        mode = "repos";
        parle = true;
        Bundle p = new Bundle();
        tts.speak(texte, TextToSpeech.QUEUE_FLUSH, p, "nuage");
    }

    void taire() {
        if (parle && tts != null) tts.stop();
        parle = false;
    }

    void detruire() {
        principal.removeCallbacksAndMessages(null);
        if (reco != null) reco.destroy();
        reco = null;
        if (tts != null) tts.shutdown();
        tts = null;
    }

    private void finParole() {
        parle = false;
        dire("fini", "");
        derniereActivite = System.currentTimeMillis();
        principal.postDelayed(relancer, 400); // laisse finir l'écho du haut-parleur
    }

    // ---------- Écoute ----------
    private void maj() {
        principal.removeCallbacks(relancer);
        if ("phrase".equals(mode) || parle || enCours) return;
        boolean voulu = veille && visible;
        if (!voulu) {
            arreterEcoute();
            return;
        }
        if (System.currentTimeMillis() - derniereActivite > PAUSE_INACTIVITE_MS) {
            dire("pause", "");
            return; // un toucher (activite) relance
        }
        mode = "reveil";
        demarrer();
    }

    private void arreterEcoute() {
        principal.removeCallbacks(relancer);
        if (reco != null && enCours) reco.cancel();
        enCours = false;
        if (!"phrase".equals(mode)) mode = "repos";
    }

    private SpeechRecognizer reconnaisseur() {
        if (reco != null) return reco;
        surAppareil = Build.VERSION.SDK_INT >= 31 && !surAppareilEchoue && SpeechRecognizer.isOnDeviceRecognitionAvailable(contexte);
        reco = surAppareil && Build.VERSION.SDK_INT >= 31
            ? SpeechRecognizer.createOnDeviceSpeechRecognizer(contexte)
            : SpeechRecognizer.createSpeechRecognizer(contexte);
        reco.setRecognitionListener(new Ecoute());
        return reco;
    }

    private void demarrer() {
        if (!SpeechRecognizer.isRecognitionAvailable(contexte)) {
            dire("erreur", "Pas de reconnaissance vocale sur ce téléphone (installe l’appli Google).");
            mode = "repos";
            veille = false;
            return;
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, contexte.getPackageName());
        if ("phrase".equals(mode)) {
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
        }
        try {
            enCours = true;
            reconnaisseur().startListening(i);
        } catch (Exception e) {
            enCours = false;
            plusTard(1500);
        }
    }

    private void plusTard(long ms) {
        principal.removeCallbacks(relancer);
        principal.postDelayed(relancer, ms);
    }

    private final class Ecoute implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            erreursDeSuite = 0;
            dire("ecoute", mode);
        }

        @Override
        public void onBeginningOfSpeech() {
            // rien
        }

        @Override
        public void onRmsChanged(float rms) {
            long t = System.currentTimeMillis();
            if ("phrase".equals(mode) && t - dernierNiveau > 120) {
                dernierNiveau = t;
                dire("niveau", String.valueOf(Math.round(Math.max(0, Math.min(10, rms)))));
            }
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            // rien
        }

        @Override
        public void onEndOfSpeech() {
            // le résultat arrive ensuite
        }

        @Override
        public void onPartialResults(Bundle resultats) {
            ArrayList<String> textes = resultats.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (textes != null && !textes.isEmpty() && "phrase".equals(mode)) dire("partiel", textes.get(0));
        }

        @Override
        public void onResults(Bundle resultats) {
            enCours = false;
            ArrayList<String> textes = resultats.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String meilleur = textes == null || textes.isEmpty() ? "" : textes.get(0);
            if ("phrase".equals(mode)) {
                mode = "repos";
                if (meilleur.trim().isEmpty()) {
                    dire("silence", "");
                    plusTard(600);
                } else {
                    dire("phrase", meilleur.trim());
                }
                return;
            }
            // Veille : le mot de réveil est-il dans une des propositions ?
            String reste = null;
            for (String t : textes == null ? new ArrayList<String>() : textes) {
                reste = MotReveil.apres(t);
                if (reste != null) break;
            }
            if (reste == null) {
                plusTard(250);
                return;
            }
            dire("reveil", "");
            if (reste.split("\\s+").length >= 2) {
                mode = "repos";
                dire("phrase", reste); // « Hey Nuage, … » d'une traite
            } else {
                principal.postDelayed(Voix.this::ecouterPhrase, 350); // la question vient juste après
            }
        }

        @Override
        public void onError(int erreur) {
            enCours = false;
            boolean phrase = "phrase".equals(mode);
            android.util.Log.w("NuageVoix", "erreur " + erreur + " (mode " + mode + ", sur l'appareil " + surAppareil + ")");
            if (erreur == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                mode = "repos";
                veille = false;
                dire("erreur", "Le micro n’est pas autorisé pour Nuage de poche.");
                return;
            }
            // Reconnaissance sur l'appareil en échec (langue absente, modèle pas téléchargé, service coupé…) : on repasse
            // par le service habituel d'Android, sauf simple silence (06/10/2026 : dictée muette sur le Pixel, Android 17)
            if (surAppareil && Build.VERSION.SDK_INT >= 31 && erreur != SpeechRecognizer.ERROR_NO_MATCH && erreur != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                surAppareilEchoue = true;
                reco.destroy();
                reco = null;
                if (phrase) demarrer();
                else plusTard(200);
                return;
            }
            if (phrase) {
                mode = "repos";
                dire(erreur == SpeechRecognizer.ERROR_NO_MATCH || erreur == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "silence" : "erreur",
                    erreur == SpeechRecognizer.ERROR_NETWORK || erreur == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "Pas de réseau pour comprendre la voix." : "La reconnaissance vocale a échoué (code " + erreur + ").");
                plusTard(800);
                return;
            }
            // Veille : silence ou bruit, on recommence ; erreurs répétées : on ralentit
            if (erreur == SpeechRecognizer.ERROR_NO_MATCH || erreur == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                plusTard(250);
            } else {
                erreursDeSuite++;
                if (erreur == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && reco != null) reco.cancel();
                plusTard(Math.min(15_000, 800L * erreursDeSuite));
            }
        }

        @Override
        public void onEvent(int type, Bundle params) {
            // rien
        }
    }
}

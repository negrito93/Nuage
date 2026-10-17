package app.nuage.poche;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

/**
 * « Où est mon téléphone ? » : demandé depuis le menu Téléphone du PC. Le téléphone sonne fort (son
 * d'alarme, entendu même en mode silencieux) et vibre, pendant une minute au plus ou jusqu'à « Je l'ai
 * trouvé ». Le volume de l'alarme est remis comme avant à l'arrêt.
 */
final class Sonnerie {
    private static final long DUREE_MAX_MS = 60_000;
    private static MediaPlayer lecteur;
    private static Vibrator vibreur;
    private static int volumeAvant = -1;
    private static final Handler principal = new Handler(Looper.getMainLooper());
    private static Runnable arretAuto;

    private Sonnerie() {
    }

    static boolean active() {
        return lecteur != null;
    }

    /** À appeler sur le fil principal. Renvoie false si rien n'a pu sonner. */
    static boolean demarrer(Context c, Runnable quandFini) {
        if (lecteur != null) return true;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        try {
            volumeAvant = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        } catch (SecurityException nePasDeranger) {
            volumeAvant = -1; // « Ne pas déranger » : on garde le volume réglé
        }
        Uri son = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_ALARM);
        if (son == null) son = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_RINGTONE);
        if (son == null) son = Settings.System.DEFAULT_NOTIFICATION_URI;
        try {
            MediaPlayer m = new MediaPlayer();
            m.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            m.setDataSource(c, son);
            m.setLooping(true);
            m.prepare();
            m.start();
            lecteur = m;
        } catch (Exception e) {
            remettreVolume(am);
            return false;
        }
        vibreur = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibreur != null && vibreur.hasVibrator()) vibreur.vibrate(VibrationEffect.createWaveform(new long[] {0, 700, 500}, 0));
        arretAuto = () -> {
            arreter(c);
            if (quandFini != null) quandFini.run();
        };
        principal.postDelayed(arretAuto, DUREE_MAX_MS);
        return true;
    }

    static void arreter(Context c) {
        if (arretAuto != null) principal.removeCallbacks(arretAuto);
        arretAuto = null;
        if (lecteur != null) {
            try {
                lecteur.stop();
            } catch (IllegalStateException ignore) {
                // déjà arrêté
            }
            lecteur.release();
            lecteur = null;
        }
        if (vibreur != null) vibreur.cancel();
        vibreur = null;
        remettreVolume((AudioManager) c.getSystemService(Context.AUDIO_SERVICE));
    }

    private static void remettreVolume(AudioManager am) {
        if (volumeAvant < 0) return;
        try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, volumeAvant, 0);
        } catch (SecurityException ignore) {
            // « Ne pas déranger » activé entre-temps
        }
        volumeAvant = -1;
    }
}

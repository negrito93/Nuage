package app.nuage.poche;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Connexion automatique (06/10/2026) : après un redémarrage du téléphone (ou une mise à jour de l'appli), le
 * lien avec le PC reprend tout seul, sans ouvrir l'appli, si un PC est associé (ou si la bulle est voulue).
 */
public class DemarrageRecepteur extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (LienService.prefs(c).getString("qr", null) == null && !LienService.bulleVoulue(c)) return;
        try {
            LienService.demarrer(c);
        } catch (Exception ignore) {
            // démarrage refusé par le système : l'appli le relancera à sa prochaine ouverture
        }
    }
}

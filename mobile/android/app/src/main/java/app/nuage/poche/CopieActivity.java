package app.nuage.poche;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/**
 * Copie du téléphone → PC en un geste, sans ouvrir l'appli : tuile des réglages rapides, bouton
 * « Copier sur le PC » de la notification, appui long sur la bulle. Android ne laisse lire le
 * presse-papiers qu'à l'appli qui a le focus, et seulement après un geste de l'utilisateur : cette
 * activité invisible le prend un instant, lit la copie, l'envoie au PC et se ferme aussitôt.
 */
public class CopieActivity extends Activity {
    static final String SOURCE = "source";
    private boolean fait;
    private final Handler principal = new Handler(Looper.getMainLooper());

    static Intent intent(Context c, String source) {
        return new Intent(c, CopieActivity.class)
            .putExtra(SOURCE, source)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Garde-fou : sans focus au bout de 2 s (écran verrouillé…), on n'insiste pas
        principal.postDelayed(() -> {
            if (!fait) {
                fait = true;
                finir();
            }
        }, 2000);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (!focus || fait) return;
        fait = true;
        lireEtEnvoyer();
        finir();
    }

    private void finir() {
        finish();
        overridePendingTransition(0, 0);
    }

    private void lireEtEnvoyer() {
        if (LienService.protocole(this) == null) {
            Toast.makeText(this, "Associe d’abord ton PC dans Nuage de poche.", Toast.LENGTH_LONG).show();
            return;
        }
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = cm.getPrimaryClip();
        CharSequence texte = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(this) : null;
        if (texte == null || texte.length() == 0) {
            Toast.makeText(this, "Rien à envoyer : copie d’abord un texte.", Toast.LENGTH_SHORT).show();
            return;
        }
        String source = getIntent().getStringExtra(SOURCE);
        // Le service dit le résultat (« Sur le PC » ou « Le PC ne répond pas ») une fois la copie partie
        LienService.collerDepuis(this, texte.toString(), source == null ? "" : source);
    }
}

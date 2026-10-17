package app.nuage.poche;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * « Partager » → Nuage de poche, depuis n'importe quelle appli : les fichiers partent vers le PC,
 * un texte (lien, message…) arrive dans le presse-papiers du PC. Aussi « Copier sur le PC » dans le menu
 * qui apparaît quand on sélectionne un texte (à côté de Copier, Partager…) : le texte part tout de suite.
 * Pas d'écran : un petit message et c'est tout.
 */
public class PartageActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent intent = getIntent();
        if (LienService.protocole(this) == null) {
            Toast.makeText(this, "Associe d’abord ton PC dans Nuage de poche.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            CharSequence choisi = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (choisi != null && choisi.length() > 0) LienService.collerDepuis(this, choisi.toString(), "menu"); // le service dit le résultat
            finish();
            return;
        }
        List<Uri> uris = new ArrayList<>();
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
        Uri seul = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uris.isEmpty() && seul != null) uris.add(seul);
        if (!uris.isEmpty()) {
            LienService.envoyerDepuis(this, uris);
            Toast.makeText(this, uris.size() == 1 ? "Nuage l’envoie au PC…" : "Nuage envoie " + uris.size() + " fichiers au PC…", Toast.LENGTH_SHORT).show();
        } else {
            String texte = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (texte != null && !texte.isEmpty()) {
                LienService.collerDepuis(this, texte, "partage"); // le service dit le résultat
            }
        }
        finish();
    }
}

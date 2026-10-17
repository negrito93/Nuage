package app.nuage.poche;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Tuile « Copier sur le PC » des réglages rapides (le volet qu'on tire du haut de l'écran) : un toucher
 * envoie au PC ce qui vient d'être copié sur le téléphone (CopieActivity lit le presse-papiers).
 */
public class TuileCopie extends TileService {
    @Override
    public void onStartListening() {
        Tile tuile = getQsTile();
        if (tuile == null) return;
        tuile.setState(LienService.protocole(this) != null ? Tile.STATE_INACTIVE : Tile.STATE_UNAVAILABLE);
        tuile.updateTile();
    }

    @Override
    public void onClick() {
        Intent copie = CopieActivity.intent(this, "tuile");
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, copie, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapseAncien(copie);
        }
    }

    // Android 13 et moins : la version « PendingIntent » n'existe pas encore, l'ancienne est la seule possible
    @SuppressWarnings("deprecation")
    @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated")
    private void startActivityAndCollapseAncien(Intent copie) {
        startActivityAndCollapse(copie);
    }
}

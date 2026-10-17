package app.nuage.poche;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LienPlugin.class);
        super.onCreate(savedInstanceState);
        // Android 13 et plus : les nouvelles du PC arrivent en notifications (l'utilisateur choisit)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    // L'appli a le focus (seul moment où Android la laisse lire le presse-papiers) : une copie faite juste avant
    // ailleurs part toute seule vers le PC (LienService.envoyerSiNouveau, 08/10/2026)
    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) LienService.envoyerSiNouveau(this);
    }
}

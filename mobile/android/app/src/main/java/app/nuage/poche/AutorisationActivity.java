package app.nuage.poche;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;

/**
 * « Approuver depuis le téléphone, derrière Face ID » (Coucou sur iPhone, version Android, 06/10/2026) : Claude Code
 * demande une autorisation sur le PC ; depuis la notification ou l'appli, l'utilisateur l'approuve après son
 * empreinte (ou son visage, ou le code du téléphone). Activité invisible : l'invite du système, puis la réponse part
 * au PC (LienService.repondreDepuis) et l'activité se ferme. Refuser ne demande rien (c'est sans danger).
 * Téléphone sans verrouillage d'écran : rien à vérifier, une simple question de confirmation.
 */
public class AutorisationActivity extends Activity {
    private static final int CODE = 7;
    private String id;
    private String choix;
    private String label;
    private boolean fini;

    static Intent intent(Context c, String id, String choix, String label) {
        return new Intent(c, AutorisationActivity.class)
            .putExtra("id", id)
            .putExtra("choix", choix)
            .putExtra("label", label == null ? "" : label)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        id = getIntent().getStringExtra("id");
        choix = getIntent().getStringExtra("choix");
        label = getIntent().getStringExtra("label");
        if (id == null || choix == null) {
            finir();
            return;
        }
        if ("deny".equals(choix)) {
            envoyer("aucune");
            return;
        }
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (km == null || !km.isDeviceSecure()) {
            confirmerSansVerrou();
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            invite(new BiometricPrompt.Builder(this)
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL));
        } else if (Build.VERSION.SDK_INT >= 29) {
            inviteAncienne29();
        } else {
            // Android 8 et 9 : l'écran du code (ou du schéma) du téléphone
            @SuppressWarnings("deprecation")
            Intent code = km.createConfirmDeviceCredentialIntent("Autoriser Claude", label);
            if (code == null) confirmerSansVerrou();
            else startActivityForResult(code, CODE);
        }
    }

    @SuppressWarnings("deprecation")
    private void inviteAncienne29() {
        if (Build.VERSION.SDK_INT >= 29) invite(new BiometricPrompt.Builder(this).setDeviceCredentialAllowed(true));
    }

    private void invite(BiometricPrompt.Builder b) {
        if (Build.VERSION.SDK_INT < 28) return;
        BiometricPrompt invite = b
            .setTitle("Autoriser Claude ?")
            .setSubtitle(label == null || label.isEmpty() ? "Demande de Claude Code sur ton PC" : label)
            .setDescription("always".equals(choix) ? "Toujours autoriser ce genre d’action dans cette session." : "Une seule fois.")
            .build();
        invite.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                int type = Build.VERSION.SDK_INT >= 30 ? result.getAuthenticationType() : BiometricPrompt.AUTHENTICATION_RESULT_TYPE_BIOMETRIC;
                envoyer(type == BiometricPrompt.AUTHENTICATION_RESULT_TYPE_DEVICE_CREDENTIAL ? "code" : "biometrie");
            }

            @Override
            public void onAuthenticationError(int code, CharSequence message) {
                finir(); // annulé : rien ne part, la demande attend toujours sur le PC
            }
        });
    }

    private void confirmerSansVerrou() {
        new AlertDialog.Builder(this)
            .setTitle("Autoriser Claude ?")
            .setMessage((label == null || label.isEmpty() ? "Demande de Claude Code sur ton PC." : label)
                + "\n\nAstuce : avec un verrouillage d’écran (empreinte, code), seul toi pourras autoriser.")
            .setPositiveButton("Autoriser", (d, w) -> envoyer("aucune"))
            .setNegativeButton("Annuler", (d, w) -> finir())
            .setOnCancelListener(d -> finir())
            .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CODE) return;
        if (resultCode == RESULT_OK) envoyer("code");
        else finir();
    }

    private void envoyer(String preuve) {
        if (fini) return;
        LienService.repondreDepuis(this, id, choix, preuve);
        finir();
    }

    private void finir() {
        fini = true;
        finish();
        overridePendingTransition(0, 0);
    }
}

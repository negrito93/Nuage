package app.nuage.poche;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget « Nuage — agents » (Coucou sur iPhone : « Widgets. Every agent, at a glance. », version Android).
 * Refonte du 06/10/2026, comme les widgets de Coucou : en tête le mini-Nuage, l'état (calme, au travail, en
 * attente) et le résumé ; les chiffres du jour ; les trois dernières sessions avec une vignette colorée (même
 * couleur que dans l'appli et l'encoche du PC), le nom, l'agent et l'état à droite. Rempli avec le dernier
 * résumé reçu du PC (préférence « agents »), à chaque nouvelle (LienService). Un toucher ouvre l'onglet Agents.
 */
public class AgentsWidget extends AppWidgetProvider {
    private static final int[][] LIGNES = {
        {R.id.w_s1, R.id.w_s1_tuile, R.id.w_s1_nom, R.id.w_s1_sous, R.id.w_s1_etat},
        {R.id.w_s2, R.id.w_s2_tuile, R.id.w_s2_nom, R.id.w_s2_sous, R.id.w_s2_etat},
        {R.id.w_s3, R.id.w_s3_tuile, R.id.w_s3_nom, R.id.w_s3_sous, R.id.w_s3_etat},
    };
    // Mêmes couleurs que l'appli (app.js) et l'encoche du PC (encoche.js), choisies par le nom du projet
    private static final int[] PALETTE = {0xFFFF6B5B, 0xFF2DD4A7, 0xFFF7B32B, 0xFFA78BFA, 0xFF38BDF8, 0xFFF472B6, 0xFF34D399, 0xFFFB923C, 0xFF60A5FA, 0xFFE879F9};
    private static final int GRIS = 0x99EBEBF5;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        mettreAJour(c);
    }

    static int couleur(String statut) {
        if ("en-cours".equals(statut) || "travaille".equals(statut)) return 0xFF64D2FF;
        if ("attente".equals(statut) || "permission".equals(statut)) return 0xFFFF9F0A;
        if ("termine".equals(statut)) return 0xFF30D158;
        return GRIS;
    }

    /** Même calcul que colorFor() en JavaScript (h = h × 31 + code, sur 32 bits non signés). */
    static int couleurDe(String cle) {
        long h = 0;
        String s = cle == null ? "" : cle;
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            h = (h * 31 + s.charAt(i)) & 0xFFFFFFFFL;
            i += Character.charCount(cp);
        }
        return PALETTE[(int) (h % PALETTE.length)];
    }

    static String mots(JSONObject s) {
        String statut = s.optString("statut");
        if ("en-cours".equals(statut)) {
            int total = s.optInt("total");
            return total > 0 ? "au travail · " + Math.min(s.optInt("faites") + 1, total) + "/" + total : "au travail";
        }
        if ("permission".equals(statut)) return "attend ton accord";
        if ("attente".equals(statut)) return "attend ta réponse";
        if ("termine".equals(statut)) return "✓ terminé";
        return "au repos";
    }

    /** Redessine tous les widgets posés (sans effet s'il n'y en a aucun). */
    static void mettreAJour(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        if (m == null) return;
        int[] ids = m.getAppWidgetIds(new ComponentName(c, AgentsWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_agents);
        JSONObject etat = null;
        try {
            String brut = LienService.prefs(c).getString("agents", null);
            if (brut != null) etat = new JSONObject(brut);
        } catch (Exception ignore) {
            // résumé illisible : affichage vide
        }
        boolean associe = LienService.prefs(c).getString("qr", null) != null;
        if (etat == null) {
            v.setTextViewText(R.id.w_pastille, associe ? "en attente" : "aucun PC");
            v.setTextViewText(R.id.w_titre, associe ? "Nuage veille" : "Associe ton PC");
            v.setTextViewText(R.id.w_texte, associe ? "Les nouvelles de tes agents arrivent dès que le PC répond." : "Ouvre Nuage de poche : « Trouver mon PC sur le Wi-Fi ».");
            v.setTextViewText(R.id.w_chiffres, "");
            for (int[] l : LIGNES) v.setViewVisibility(l[0], View.GONE);
        } else {
            JSONObject resume = etat.optJSONObject("resume");
            String e = resume == null ? "calme" : resume.optString("etat", "calme");
            v.setTextViewText(R.id.w_pastille, "attente".equals(e) ? "en attente" : "travaille".equals(e) ? "au travail" : "calme");
            v.setTextColor(R.id.w_pastille, "calme".equals(e) ? GRIS : couleur(e));
            v.setTextViewText(R.id.w_titre, resume == null ? "Tout est calme" : resume.optString("titre", ""));
            String texte = resume == null ? "" : resume.optString("texte", "");
            if (!LienService.connecte) texte = "PC hors de portée · " + texte;
            v.setTextViewText(R.id.w_texte, texte);
            JSONObject j = etat.optJSONObject("aujourdhui");
            if (j != null) {
                v.setTextViewText(R.id.w_chiffres, "AUJOURD’HUI  " + j.optInt("tours") + " tours · " + j.optInt("fichiers") + " fichiers · +" + j.optInt("plus")
                    + " −" + j.optInt("moins") + " · " + j.optInt("accords") + " accords");
            }
            JSONArray sessions = etat.optJSONArray("sessions");
            for (int i = 0; i < LIGNES.length; i++) {
                JSONObject s = sessions == null ? null : sessions.optJSONObject(i);
                if (s == null) {
                    v.setViewVisibility(LIGNES[i][0], View.GONE);
                    continue;
                }
                String projet = s.optString("projet");
                v.setViewVisibility(LIGNES[i][0], View.VISIBLE);
                v.setInt(LIGNES[i][1], "setColorFilter", couleurDe(projet.isEmpty() ? s.optString("titre") : projet));
                v.setTextViewText(LIGNES[i][2], s.optString("titre"));
                String actuel = s.optString("actuel");
                v.setTextViewText(LIGNES[i][3], "en-cours".equals(s.optString("statut")) && !actuel.isEmpty() ? actuel : s.optString("agent", "Claude Code"));
                v.setTextViewText(LIGNES[i][4], mots(s));
                v.setTextColor(LIGNES[i][4], couleur(s.optString("statut")));
            }
        }
        Intent ouvrir = new Intent(c, MainActivity.class).putExtra("onglet", "agents").setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.w_racine, PendingIntent.getActivity(c, 40, ouvrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        m.updateAppWidget(ids, v);
    }
}

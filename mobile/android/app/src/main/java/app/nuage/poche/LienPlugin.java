package app.nuage.poche;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;

/**
 * Pont entre l'interface (www/app.js) et le lien Java : état, association par QR code, envoi de fichiers,
 * presse-papiers, ouverture des fichiers reçus. Événements vers la page : etat, transfert, pressePapiers, nouvelle.
 */
@CapacitorPlugin(name = "Lien", permissions = {@Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "micro")})
public class LienPlugin extends Plugin {

    private boolean attendPermissionBulle;
    private Voix voix;

    @Override
    public void load() {
        ReseauAndroid.installer(getContext());
        LienService.ecouteur = (nom, donnees) -> notifyListeners(nom, versJs(donnees));
        LienService.appliVisible(true);
        if (LienService.protocole(getContext()) != null || LienService.bulleVoulue(getContext())) LienService.demarrer(getContext());
        voix = new Voix(getContext(), (type, texte) -> {
            JSObject e = new JSObject();
            e.put("type", type);
            e.put("texte", texte);
            notifyListeners("voix", e);
        });
        principal(() -> voix.setVisible(true));
        if (micro() && LienService.prefs(getContext()).getBoolean("voix-veille", false)) principal(() -> voix.setVeille(true));
        demandeEcoute(getActivity().getIntent());
        demandeOnglet(getActivity().getIntent());
    }

    // Double toucher sur la bulle : l'appli s'ouvre et écoute la question
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        demandeEcoute(intent);
        demandeOnglet(intent);
    }

    // Notification ou widget des agents : l'appli s'ouvre sur l'onglet demandé (« agents »)
    private void demandeOnglet(Intent intent) {
        if (intent == null || intent.getStringExtra("onglet") == null) return;
        JSObject e = new JSObject();
        e.put("onglet", intent.getStringExtra("onglet"));
        intent.removeExtra("onglet");
        notifyListeners("onglet", e, true);
    }

    private void demandeEcoute(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("ecouter", false)) return;
        intent.removeExtra("ecouter");
        JSObject e = new JSObject();
        e.put("type", "demande");
        e.put("texte", "");
        notifyListeners("voix", e, true);
    }

    // La reconnaissance vocale d'Android ne marche que depuis le fil principal ; les méthodes du plugin
    // tournent sur un autre fil : avant le 05/10/2026, la dictée et « Hey Nuage » échouaient sans rien dire
    private final android.os.Handler filPrincipal = new android.os.Handler(android.os.Looper.getMainLooper());

    private void principal(Runnable r) {
        filPrincipal.post(() -> {
            if (voix != null) r.run();
        });
    }

    private boolean micro() {
        return getPermissionState("micro") == PermissionState.GRANTED;
    }

    @Override
    protected void handleOnResume() {
        if (voix != null) voix.setVisible(true);
        LienService.appliVisible(true); // la bulle se cache quand l'appli est à l'écran
        // Retour des réglages d'Android : la permission « par-dessus les autres applis » a-t-elle été donnée ?
        if (attendPermissionBulle && Bulle.permise(getContext())) {
            attendPermissionBulle = false;
            LienService.prefs(getContext()).edit().putBoolean("bulle", true).apply();
            LienService.majBulleDepuis(getContext());
            notifyListeners("etat", versJs(LienService.etat(getContext())));
        }
    }

    @Override
    protected void handleOnPause() {
        if (voix != null) voix.setVisible(false); // le micro ne reste jamais ouvert appli fermée
        LienService.appliVisible(false);
    }

    @Override
    protected void handleOnDestroy() {
        if (voix != null) voix.detruire();
        voix = null;
        LienService.ecouteur = null;
        LienService.chatOuvert = false;
        LienService.appliVisible(false);
    }

    // ---------- Voix : « Hey Nuage », question, réponse lue à voix haute ----------
    @PluginMethod
    public void voixEtat(PluginCall call) {
        JSObject r = new JSObject();
        r.put("micro", micro());
        r.put("disponible", Voix.disponible(getContext()));
        r.put("veille", micro() && LienService.prefs(getContext()).getBoolean("voix-veille", false));
        call.resolve(r);
    }

    /** « Hey Nuage » tant que l'appli est ouverte ; demande le micro la première fois. */
    @PluginMethod
    public void voixVeille(PluginCall call) {
        boolean actif = Boolean.TRUE.equals(call.getBoolean("actif", false));
        if (actif && !micro()) {
            requestPermissionForAlias("micro", call, "apresMicro");
            return;
        }
        LienService.prefs(getContext()).edit().putBoolean("voix-veille", actif).apply();
        principal(() -> voix.setVeille(actif));
        JSObject r = new JSObject();
        r.put("actif", actif);
        call.resolve(r);
    }

    @PermissionCallback
    private void apresMicro(PluginCall call) {
        boolean ok = micro();
        boolean phrase = "voixPhrase".equals(call.getMethodName());
        if (ok && !phrase) {
            LienService.prefs(getContext()).edit().putBoolean("voix-veille", true).apply();
            principal(() -> voix.setVeille(true));
        }
        if (ok && phrase) principal(() -> voix.ecouterPhrase());
        JSObject r = new JSObject();
        r.put("actif", ok);
        r.put("refuse", !ok);
        call.resolve(r);
    }

    /** Écouter une question tout de suite (bouton micro). */
    @PluginMethod
    public void voixPhrase(PluginCall call) {
        if (!micro()) {
            requestPermissionForAlias("micro", call, "apresMicro");
            return;
        }
        principal(() -> voix.ecouterPhrase());
        JSObject r = new JSObject();
        r.put("actif", true);
        call.resolve(r);
    }

    @PluginMethod
    public void voixParler(PluginCall call) {
        principal(() -> voix.parler(call.getString("texte", "")));
        call.resolve();
    }

    @PluginMethod
    public void voixTaire(PluginCall call) {
        principal(() -> voix.taire());
        call.resolve();
    }

    /** Un toucher sur l'écran : l'écoute repart si elle s'était mise en pause. */
    @PluginMethod
    public void voixActivite(PluginCall call) {
        principal(() -> voix.activite());
        call.resolve();
    }

    // ---------- Chat avec Claude, par le PC (ton abonnement) ----------
    private void api(PluginCall call, String nom, JSONObject donnees, int lectureMs) {
        new Thread(() -> {
            LienProtocole p = LienService.protocole(getContext());
            if (p == null) {
                call.reject("Associe d’abord ton PC.");
                return;
            }
            try {
                call.resolve(versJs(p.api(nom, donnees, lectureMs)));
            } catch (LienProtocole.LienException e) {
                call.reject(e.statut == 0 ? "Le PC ne répond pas : même Wi-Fi, et Nuage ouvert sur le PC ?" : e.getMessage());
            } catch (Exception e) {
                call.reject("Le PC ne répond pas.");
            }
        }).start();
    }

    @PluginMethod
    public void chatEtat(PluginCall call) {
        LienService.chatOuvert = true;
        api(call, "chat-etat", new JSONObject(), 20_000);
    }

    @PluginMethod
    public void chatFerme(PluginCall call) {
        LienService.chatOuvert = false;
        api(call, "chat-ferme", new JSONObject(), 8000);
    }

    @PluginMethod
    public void chatEnvoyer(PluginCall call) {
        try {
            api(call, "chat-envoyer", new JSONObject().put("texte", call.getString("texte", "")).put("voix", Boolean.TRUE.equals(call.getBoolean("voix", false))), 20_000);
        } catch (Exception e) {
            call.reject("message illisible");
        }
    }

    @PluginMethod
    public void chatSession(PluginCall call) {
        try {
            api(call, "chat-session", new JSONObject().put("action", call.getString("action", "")).put("id", call.getString("id", "")), 20_000);
        } catch (Exception e) {
            call.reject("choix illisible");
        }
    }

    @PluginMethod
    public void chatPermission(PluginCall call) {
        try {
            api(call, "chat-permission", new JSONObject().put("id", call.getString("id", "")).put("choix", call.getString("choix", "deny")), 15_000);
        } catch (Exception e) {
            call.reject("réponse illisible");
        }
    }

    @PluginMethod
    public void chatStop(PluginCall call) {
        api(call, "chat-stop", new JSONObject(), 15_000);
    }

    // ---------- Agents de code (Coucou sur iPhone, version Android, 06/10/2026) ----------
    /** Dernier résumé reçu (affichage immédiat, même PC hors de portée). */
    @PluginMethod
    public void agentsMemo(PluginCall call) {
        JSObject r = new JSObject();
        String brut = LienService.prefs(getContext()).getString("agents", null);
        try {
            if (brut != null) r.put("etat", JSObject.fromJSONObject(new JSONObject(brut)));
        } catch (Exception ignore) {
            // résumé illisible : rien
        }
        call.resolve(r);
    }

    @PluginMethod
    public void agentsEtat(PluginCall call) {
        api(call, "agents-etat", new JSONObject(), 15_000);
    }

    @PluginMethod
    public void agentsSession(PluginCall call) {
        try {
            api(call, "agents-session", new JSONObject().put("id", call.getString("id", "")), 15_000);
        } catch (Exception e) {
            call.reject("session illisible");
        }
    }

    /**
     * Répondre à une demande d'autorisation : refuser part tout de suite ; approuver (une fois ou toujours) passe
     * d'abord par l'empreinte, le visage ou le code du téléphone (AutorisationActivity). Le résultat revient par
     * l'événement « autorisation » et le nouveau résumé « agents ».
     */
    @PluginMethod
    public void agentsRepondre(PluginCall call) {
        String id = call.getString("id", "");
        String choix = call.getString("choix", "");
        if (id.isEmpty() || !java.util.Arrays.asList("allow", "deny", "always").contains(choix)) {
            call.reject("demande inconnue");
            return;
        }
        if ("deny".equals(choix)) LienService.repondreDepuis(getContext(), id, choix, "aucune");
        else getActivity().startActivity(AutorisationActivity.intent(getContext(), id, choix, call.getString("label", "")));
        JSObject r = new JSObject();
        r.put("envoye", true);
        call.resolve(r);
    }

    /** « Ajouter le widget » : Android propose de le poser sur l'écran d'accueil (sinon, l'appui long habituel). */
    @PluginMethod
    public void ajouterWidget(PluginCall call) {
        android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(getContext());
        if (m == null || !m.isRequestPinAppWidgetSupported()) {
            call.reject("Ajoute-le toi-même : appui long sur l’écran d’accueil, « Widgets », puis Nuage de poche.");
            return;
        }
        m.requestPinAppWidget(new android.content.ComponentName(getContext(), AgentsWidget.class), null, null);
        call.resolve();
    }

    // ---------- Bulle flottante ----------
    @PluginMethod
    public void bulle(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        Context c = getContext();
        if (active && !Bulle.permise(c)) {
            // L'utilisateur donne lui-même la permission dans les réglages d'Android
            attendPermissionBulle = true;
            Intent reglages = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName()));
            getActivity().startActivity(reglages);
            JSObject r = new JSObject();
            r.put("active", false);
            r.put("permission", false);
            call.resolve(r);
            return;
        }
        LienService.prefs(c).edit().putBoolean("bulle", active).apply();
        LienService.majBulleDepuis(c);
        JSObject r = new JSObject();
        r.put("active", active);
        r.put("permission", true);
        call.resolve(r);
    }

    /** Météo calculée par la page : la bulle prend la même peau. */
    @PluginMethod
    public void meteo(PluginCall call) {
        JSObject w = call.getObject("meteo");
        if (w != null) LienService.meteo(getContext(), w.toString());
        call.resolve();
    }

    private static JSObject versJs(JSONObject o) {
        try {
            return JSObject.fromJSONObject(o);
        } catch (Exception e) {
            return new JSObject();
        }
    }

    @PluginMethod
    public void etat(PluginCall call) {
        call.resolve(versJs(LienService.etat(getContext())));
    }

    // ---------- Association : scanner le QR code affiché par Nuage sur le PC ----------
    @PluginMethod
    public void associer(PluginCall call) {
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Vise le QR code affiché par Nuage sur le PC")
            .setBeepEnabled(false)
            .setOrientationLocked(false);
        Intent intent = new ScanContract().createIntent(getContext(), options);
        startActivityForResult(call, intent, "apresScan");
    }

    @ActivityCallback
    private void apresScan(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String qr = new ScanContract().parseResult(result.getResultCode(), result.getData()).getContents();
        if (qr == null) {
            call.reject("annulé");
            return;
        }
        new Thread(() -> {
            try {
                Context c = getContext();
                LienProtocole p = LienProtocole.depuisQr(qr, LienService.appareilId(c));
                try {
                    p.bonjour(Build.MANUFACTURER + " " + Build.MODEL, Build.MODEL);
                } catch (LienProtocole.LienException injoignable) {
                    // Aucune adresse du QR code ne répond : on cherche le PC sur le Wi-Fi avant d'abandonner
                    if (injoignable.statut != 0 || p.decouvrir(2500) == null) throw injoignable;
                    p.bonjour(Build.MANUFACTURER + " " + Build.MODEL, Build.MODEL);
                }
                LienService.prefs(c).edit().putString("qr", qr).putString("hote", p.hoteActif()).remove("hotes-connues").apply();
                LienService.demarrer(c);
                JSObject r = new JSObject();
                r.put("pc", new JSObject().put("nom", p.pcNom));
                call.resolve(r);
            } catch (LienProtocole.LienException e) {
                call.reject(e.statut == 0
                    ? "le PC ne répond pas. Vérifie que le téléphone est sur le même Wi-Fi et que Nuage est ouvert sur le PC."
                    : "le PC a refusé (code " + e.statut + "). Affiche un nouveau QR code sur le PC.");
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "code illisible" : e.getMessage());
            }
        }).start();
    }

    // ---------- Association par le Wi-Fi, sans QR code (06/10/2026) ----------
    private static final java.util.Map<String, LienProtocole.Demande> demandes = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * Les PC où Nuage est ouvert, sur tous les réseaux du téléphone (Wi-Fi, partage USB…) : { pcs, reseaux, balayage, ms }.
     * « reseaux » dit ce qui a été essayé, pour expliquer un échec.
     */
    @PluginMethod
    public void chercherPcsReseau(PluginCall call) {
        new Thread(() -> {
            ReseauAndroid.installer(getContext());
            try {
                call.resolve(new JSObject(LienProtocole.chercherPcsPartout(47824, 3600).toString()));
            } catch (Exception e) {
                call.reject("recherche impossible : " + e.getMessage());
            }
        }, "nuage-recherche").start();
    }

    /** Les réseaux locaux du téléphone (sans rien envoyer) : l'appli montre « Wi-Fi 192.168.1.23 ». */
    @PluginMethod
    public void reseaux(PluginCall call) {
        new Thread(() -> {
            ReseauAndroid.installer(getContext());
            JSObject r = new JSObject();
            try {
                r.put("reseaux", new com.getcapacitor.JSArray(LienProtocole.reseauxLocaux().toString()));
            } catch (Exception e) {
                r.put("reseaux", new com.getcapacitor.JSArray());
            }
            call.resolve(r);
        }, "nuage-reseaux").start();
    }
    /** Demande envoyée au PC : renvoie le code à 6 chiffres (le PC affiche le même et attend « Accepter »). */
    @PluginMethod
    public void demanderAssociation(PluginCall call) {
        String adresse = call.getString("adresse");
        int port = call.getInt("port", 47824);
        if (adresse == null) {
            call.reject("PC inconnu.");
            return;
        }
        new Thread(() -> {
            try {
                Context c = getContext();
                LienProtocole.Demande d = LienProtocole.demanderAppairage(adresse, port, LienService.appareilId(c), Build.MANUFACTURER + " " + Build.MODEL, Build.MODEL);
                demandes.put(d.id, d);
                JSObject r = new JSObject();
                r.put("demande", d.id);
                r.put("code", d.code);
                r.put("pc", d.pcNom);
                call.resolve(r);
            } catch (LienProtocole.LienException e) {
                call.reject(e.statut == 0 ? "le PC ne répond pas. Nuage est-il ouvert sur le PC ?" : e.getMessage());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "demande impossible" : e.getMessage());
            }
        }).start();
    }

    /** Attend « Accepter » sur le PC (2 min au plus), puis associe ce téléphone comme avec le QR code. */
    @PluginMethod
    public void attendreAssociation(PluginCall call) {
        LienProtocole.Demande d = demandes.remove(call.getString("demande", ""));
        if (d == null) {
            call.reject("Demande inconnue : recommence.");
            return;
        }
        new Thread(() -> {
            try {
                Context c = getContext();
                String qr = LienProtocole.attendreAppairage(d, System.currentTimeMillis() + 130_000);
                LienProtocole p = LienProtocole.depuisQr(qr, LienService.appareilId(c));
                p.bonjour(Build.MANUFACTURER + " " + Build.MODEL, Build.MODEL);
                LienService.prefs(c).edit().putString("qr", qr).putString("hote", p.hoteActif()).remove("hotes-connues").apply();
                LienService.demarrer(c); // la relève prend le nouveau PC (relu dans les préférences à chaque tour)
                JSObject r = new JSObject();
                r.put("pc", new JSObject().put("nom", p.pcNom));
                call.resolve(r);
            } catch (LienProtocole.LienException e) {
                call.reject(e.statut == 403 ? "refusé sur le PC." : e.statut == 408 ? "pas de réponse sur le PC (2 min) : recommence." : e.statut == 0 ? "le PC ne répond plus." : e.getMessage());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "association impossible" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void oublier(PluginCall call) {
        LienService.prefs(getContext()).edit().remove("qr").remove("recus").remove("nouvelles").apply();
        LienService.arreter(getContext());
        if (LienService.bulleVoulue(getContext())) LienService.demarrer(getContext()); // la bulle reste
        call.resolve();
    }

    // ---------- Fichiers vers le PC : sélecteur d'Android ----------
    @PluginMethod
    public void envoyerFichiers(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "apresChoix");
    }

    @ActivityCallback
    private void apresChoix(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("annulé");
            return;
        }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            ClipData clip = data.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        LienService.envoyerDepuis(getContext(), uris);
        JSObject r = new JSObject();
        r.put("nombre", uris.size());
        call.resolve(r);
    }

    // ---------- Presse-papiers du téléphone → PC (l'appli est au premier plan : lecture permise) ----------
    @PluginMethod
    public void collerSurPc(PluginCall call) {
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = cm.getPrimaryClip();
        CharSequence texte = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(getContext()) : null;
        if (texte == null || texte.length() == 0) {
            call.reject("Le presse-papiers du téléphone est vide.");
            return;
        }
        LienService.collerDepuis(getContext(), texte.toString(), "appli");
        JSObject r = new JSObject();
        r.put("longueur", texte.length());
        call.resolve(r);
    }

    // ---------- « Hors de portée » : chercher le PC sur le Wi-Fi (son adresse a peut-être changé) ----------
    @PluginMethod
    public void chercherPc(PluginCall call) {
        new Thread(() -> {
            LienProtocole p = LienService.protocole(getContext());
            if (p == null) {
                call.reject("Associe d’abord ton PC.");
                return;
            }
            String trouve = p.decouvrir(2500);
            JSObject r = new JSObject();
            r.put("adresse", trouve);
            r.put("essayees", String.join(", ", p.hotes()));
            try {
                JSONObject diag = LienProtocole.dernierDiag;
                if (diag != null) r.put("diag", new JSObject(diag.toString()));
            } catch (Exception ignore) {
                // sans diagnostic : l'essai a quand même eu lieu
            }
            if (trouve != null) LienService.prefs(getContext()).edit().putString("hote", trouve).apply();
            call.resolve(r);
        }).start();
    }

    // ---------- Petit coucou au PC (Nuage du PC salue : le lien marche) ----------
    @PluginMethod
    public void coucou(PluginCall call) {
        new Thread(() -> {
            LienProtocole p = LienService.protocole(getContext());
            if (p == null) {
                call.reject("Associe d’abord ton PC.");
                return;
            }
            try {
                p.signal("coucou");
                call.resolve();
            } catch (Exception e) {
                call.reject("Le PC ne répond pas : même Wi-Fi, et Nuage ouvert sur le PC ?");
            }
        }).start();
    }

    // ---------- « Je l'ai trouvé » : arrête la sonnerie demandée par le PC ----------
    @PluginMethod
    public void arreterSonnerie(PluginCall call) {
        LienService.arreterSonnerieDepuis(getContext());
        call.resolve();
    }

    // ---------- Tuile « Copier sur le PC » des réglages rapides (Android 13 et plus : Android propose de l'ajouter) ----------
    @PluginMethod
    public void ajouterTuile(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            call.reject("Ajoute-la toi-même : tire le volet du haut, crayon « Modifier », puis glisse « Copier sur le PC ».");
            return;
        }
        android.app.StatusBarManager barre = getContext().getSystemService(android.app.StatusBarManager.class);
        barre.requestAddTileService(
            new android.content.ComponentName(getContext(), TuileCopie.class),
            "Copier sur le PC",
            android.graphics.drawable.Icon.createWithResource(getContext(), R.drawable.ic_nuage),
            getContext().getMainExecutor(),
            resultat -> {
                JSObject r = new JSObject();
                // 0 : refusée, 1 : déjà là, 2 : ajoutée
                r.put("ajoutee", resultat == android.app.StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED || resultat == android.app.StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED);
                call.resolve(r);
            });
    }

    // ---------- Ouvrir un fichier reçu ----------
    @PluginMethod
    public void ouvrir(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("fichier inconnu");
            return;
        }
        Intent voir = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(Uri.parse(uri), call.getString("type", "*/*"))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(Intent.createChooser(voir, "Ouvrir avec"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Aucune appli pour ouvrir ce fichier.");
        }
    }
}

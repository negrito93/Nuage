package app.nuage.poche;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Service au premier plan : relève le courrier du PC (attente longue de 25 s) et dépose les fichiers.
 * - presse-papiers : copié sur le téléphone (Android permet d'écrire le presse-papiers en arrière-plan) ;
 * - fichier : téléchargé par morceaux dans Téléchargements/Nuage ;
 * - notif : nouvelle du PC (Claude a fini, téléchargement terminé…), en notification Android ;
 * - sonner / sonner-stop : « où est mon téléphone ? » (Sonnerie.java).
 * À chaque relève, le téléphone donne son état au PC (batterie, version) pour le menu Téléphone du PC.
 * Envois vers le PC (fichiers, presse-papiers) : depuis l'appli, « Partager » → Nuage de poche, le menu du
 * texte sélectionné, la tuile des réglages rapides, la bulle ou le bouton de la notification (CopieActivity).
 */
public class LienService extends Service {
    static final String PREFS = "nuage-lien";
    static final String ACTION_ENVOYER = "app.nuage.poche.ENVOYER";
    static final String ACTION_COLLER = "app.nuage.poche.COLLER";
    static final String ACTION_SONNERIE_STOP = "app.nuage.poche.SONNERIE_STOP";
    static final String ACTION_REPONDRE = "app.nuage.poche.REPONDRE";
    private static final String CANAL_VEILLE = "veille-2";
    private static final String CANAL_NOUVELLES = "nouvelles";
    private static final String CANAL_RECHERCHE = "recherche";
    private static final String CANAL_ACCORDS = "accords";
    private static final String CANAL_DIRECT = "direct";
    private static final int NOTIF_VEILLE = 1;
    private static final int NOTIF_SONNERIE = 2;
    private static final int NOTIF_DIRECT = 3;
    private static final int NOTIF_MAJ = 4;

    /** Écouteur de l'interface (LienPlugin) ; null quand l'appli est fermée. */
    interface Ecouteur {
        void evenement(String nom, JSONObject donnees);
    }

    static volatile Ecouteur ecouteur;
    static volatile boolean connecte;
    /** Le PC répond mais refuse la clé (Nuage réinstallé, autre PC) : l'appli propose de se reconnecter avec un code. */
    static volatile boolean refuse;
    private static volatile LienService instance;

    private volatile boolean actif;
    private Thread releve;
    // Connexion automatique (06/10/2026) : dès que le téléphone rejoint un Wi-Fi, la relève se réveille et
    // cherche le PC tout de suite (avant : jusqu'à 30 s d'attente entre deux essais)
    private final Object reveil = new Object();
    private volatile boolean reseauNeuf;
    private android.net.ConnectivityManager.NetworkCallback rappelReseau;
    // Courrier annoncé par le PC (UDP, port 47825) et écran rallumé : la relève repart tout de suite (08/10/2026)
    static final int PORT_REVEIL = 47825;
    private volatile java.net.DatagramSocket reveilUdp;
    private android.content.BroadcastReceiver ecran;
    private final ExecutorService envois = Executors.newSingleThreadExecutor();
    private final Handler principal = new Handler(Looper.getMainLooper());
    private int prochainId = 100;

    // ---------- État partagé (préférences) ----------
    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String appareilId(Context c) {
        SharedPreferences p = prefs(c);
        String id = p.getString("appareil", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            p.edit().putString("appareil", id).apply();
        }
        return id;
    }

    // Une seule instance par QR code : l'adresse qui marche (ou retrouvée par la découverte) est gardée
    private static volatile LienProtocole cache;

    static LienProtocole protocole(Context c) {
        ReseauAndroid.installer(c); // les messages partent par le Wi-Fi, même sans Internet
        String qr = prefs(c).getString("qr", null);
        if (qr == null) {
            cache = null;
            return null;
        }
        LienProtocole p = cache;
        if (p != null && qr.equals(p.qr)) return p;
        try {
            p = LienProtocole.depuisQr(qr, appareilId(c));
            // Adresses données par le PC au fil du temps (autre réseau, nouvelle adresse), puis celle qui a marché
            try {
                JSONArray connues = new JSONArray(prefs(c).getString("hotes-connues", "[]"));
                for (int i = 0; i < connues.length(); i++) p.ajouterHoteSiNouveau(connues.optString(i));
                p.hotesChanges();
            } catch (Exception ignore) {
                // liste illisible : on garde celles du QR code
            }
            p.ajouterHote(prefs(c).getString("hote", null));
            cache = p;
            return p;
        } catch (Exception e) {
            return null;
        }
    }

    /** L'écran du chat est ouvert dans l'appli : le PC envoie l'état du chat dans la boîte. */
    static volatile boolean chatOuvert;

    static JSONObject etat(Context c) {
        JSONObject e = new JSONObject();
        try {
            LienProtocole p = protocole(c);
            e.put("associe", p != null);
            e.put("connecte", p != null && connecte);
            e.put("refuse", p != null && !connecte && refuse);
            if (p != null) e.put("pc", new JSONObject().put("nom", p.pcNom));
            e.put("recus", new JSONArray(prefs(c).getString("recus", "[]")));
            e.put("nouvelles", new JSONArray(prefs(c).getString("nouvelles", "[]")));
            e.put("bulle", bulleVoulue(c) && Bulle.permise(c));
            e.put("version", versionAppli(c));
            String meteoPc = prefs(c).getString("meteo-pc", null);
            if (meteoPc != null) e.put("meteoPc", new JSONObject(meteoPc));
            e.put("sonne", Sonnerie.active());
            e.put("tuile", Build.VERSION.SDK_INT >= 33); // Android 13 et plus : l'appli peut proposer d'ajouter la tuile
            BatteryManager bm = (BatteryManager) c.getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                e.put("batterie", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY));
                e.put("charge", bm.isCharging());
            }
        } catch (Exception ignore) {
            // état minimal
        }
        return e;
    }

    static String versionAppli(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** État donné au PC à chaque relève : batterie, en charge, versions, bulle. */
    private JSONObject etatAppareil() {
        JSONObject e = new JSONObject();
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (dernierNiveau >= 0) {
                // Ce que vient de dire le système (« branché » arrive avant que isCharging() suive)
                e.put("batterie", dernierNiveau);
                e.put("charge", derniereCharge);
            } else if (bm != null) {
                int niveau = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                if (niveau >= 0 && niveau <= 100) e.put("batterie", niveau);
                e.put("charge", bm.isCharging());
            }
            e.put("version", versionAppli(this));
            e.put("android", Build.VERSION.RELEASE);
            e.put("bulle", bulleVoulue(this) && Bulle.permise(this));
            e.put("chat", chatOuvert);
        } catch (Exception ignore) {
            // état partiel
        }
        return e;
    }

    static void demarrer(Context c) {
        Intent i = new Intent(c, LienService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void arreter(Context c) {
        c.stopService(new Intent(c, LienService.class));
    }

    private void emettre(String nom, JSONObject donnees) {
        Ecouteur e = ecouteur;
        if (e != null) principal.post(() -> e.evenement(nom, donnees));
        if (!"etat".equals(nom)) principal.post(() -> {
            if (bulle != null && bulle.visible()) bulle.evenement(nom, donnees);
        });
    }

    // ---------- Bulle flottante (Bulle.java) : visible quand l'appli n'est pas à l'écran ----------
    private Bulle bulle;
    private static volatile boolean appliVisible;

    static boolean bulleVoulue(Context c) {
        return prefs(c).getBoolean("bulle", false);
    }

    /** L'appli passe à l'écran (true) ou en arrière-plan (false). */
    static void appliVisible(boolean oui) {
        appliVisible = oui;
        LienService s = instance;
        if (s != null) s.principal.post(s::majBulle);
    }

    static void majBulleDepuis(Context c) {
        LienService s = instance;
        if (s != null) s.principal.post(s::majBulle);
        else if (bulleVoulue(c)) demarrer(c);
    }

    static void meteo(Context c, String json) {
        prefs(c).edit().putString("meteo", json).apply();
    }

    private void majBulle() {
        if (bulle == null) bulle = new Bulle(this);
        if (bulleVoulue(this) && Bulle.permise(this) && !appliVisible) bulle.montrer();
        else bulle.cacher();
    }

    private void emettreEtat() {
        emettre("etat", etat(this));
    }

    // ---------- Batterie (05/10/2026 : « une animation quand je charge le tel ») ----------
    // Branché / débranché : le PC est prévenu tout de suite (/v1/etat) et l'appli s'anime ; pendant la
    // charge, chaque pour cent part aussi (au plus toutes les 10 s).
    private int dernierNiveau = -1;
    private boolean derniereCharge;
    private long dernierEnvoiEtat;
    private final android.content.BroadcastReceiver batterie = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int niveau = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int echelle = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int statut = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean charge = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
                || statut == BatteryManager.BATTERY_STATUS_CHARGING || statut == BatteryManager.BATTERY_STATUS_FULL;
            int pct = niveau >= 0 && echelle > 0 ? Math.round(niveau * 100f / echelle) : -1;
            boolean changement = charge != derniereCharge || dernierNiveau < 0;
            if (pct == dernierNiveau && !changement) return;
            dernierNiveau = pct;
            derniereCharge = charge;
            try {
                emettre("batterie", new JSONObject().put("niveau", pct).put("charge", charge));
            } catch (Exception ignore) {
                // rien
            }
            long t = System.currentTimeMillis();
            if (changement || (charge && t - dernierEnvoiEtat > 10_000)) {
                dernierEnvoiEtat = t;
                envois.execute(() -> {
                    LienProtocole p = protocole(LienService.this);
                    if (p == null) return;
                    try {
                        p.etat(etatAppareil());
                    } catch (Exception ignore) {
                        // PC hors de portée : la relève suivante donnera l'état
                    }
                });
            }
        }
    };

    // ---------- Cycle de vie ----------
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        androidx.core.content.ContextCompat.registerReceiver(this, batterie, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            // Importance « basse » (sans son) : l'ancienne, « minimale », rangeait la notification si bas que
            // son bouton « Copier sur le PC » restait caché sur beaucoup de téléphones
            nm.deleteNotificationChannel("veille");
            nm.createNotificationChannel(new NotificationChannel(CANAL_VEILLE, "Nuage veille sur ton PC", NotificationManager.IMPORTANCE_LOW));
            nm.createNotificationChannel(new NotificationChannel(CANAL_NOUVELLES, "Nouvelles du PC", NotificationManager.IMPORTANCE_DEFAULT));
            nm.createNotificationChannel(new NotificationChannel(CANAL_RECHERCHE, "Le PC cherche ton téléphone", NotificationManager.IMPORTANCE_HIGH));
            // Agents de code (06/10/2026) : demandes d'autorisation (avec boutons) et activité en direct (sans son)
            nm.createNotificationChannel(new NotificationChannel(CANAL_ACCORDS, "Claude attend ton accord", NotificationManager.IMPORTANCE_HIGH));
            nm.createNotificationChannel(new NotificationChannel(CANAL_DIRECT, "Claude en direct", NotificationManager.IMPORTANCE_LOW));
        }
        // « Copier sur le PC » : envoie ce qui vient d'être copié, sans ouvrir l'appli
        PendingIntent copier = PendingIntent.getActivity(this, 1, CopieActivity.intent(this, "notif"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification veille = new NotificationCompat.Builder(this, CANAL_VEILLE)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle("Nuage veille sur ton PC")
            .setContentText("Fichiers et copier-coller sur ton Wi-Fi")
            .setOngoing(true)
            .setContentIntent(ouvrirAppli())
            .addAction(0, "Copier sur le PC", copier)
            .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_VEILLE, veille, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(NOTIF_VEILLE, veille);
        actif = true;
        releve = new Thread(this::releverLeCourrier, "nuage-releve");
        releve.start();
        ecouterLeReseau();
        ecouterLeCourrierAnnonce();
        ecouterLEcran();
        principal.post(this::majBulle);
    }

    // ---------- Copier-coller instantané (08/10/2026 : « dès que le PC est connecté au mobile ») ----------
    // La relève attend le courrier du PC sur une connexion ouverte. Si elle meurt sans bruit (Wi-Fi en économie
    // d'énergie, veille), le téléphone ne s'en apercevait qu'au bout de 35 s, puis patientait jusqu'à 15 s :
    // le PC annonce donc un courrier pas relevé par un paquet UDP (« NUAGE-COURRIER <id du PC> », lien.js), et
    // l'écran rallumé fait pareil. Dans les deux cas la relève en cours est coupée et repart aussitôt.
    private void ecouterLeCourrierAnnonce() {
        Thread t = new Thread(() -> {
            try (java.net.DatagramSocket s = new java.net.DatagramSocket(null)) {
                s.setReuseAddress(true);
                s.bind(new java.net.InetSocketAddress(PORT_REVEIL));
                reveilUdp = s;
                byte[] tampon = new byte[128];
                while (actif) {
                    java.net.DatagramPacket paquet = new java.net.DatagramPacket(tampon, tampon.length);
                    s.receive(paquet);
                    String m = new String(paquet.getData(), 0, paquet.getLength(), java.nio.charset.StandardCharsets.UTF_8).trim();
                    LienProtocole p = cache;
                    if (p != null && m.equals("NUAGE-COURRIER " + p.pcId)) relancerLaReleve();
                }
            } catch (Exception ignore) {
                // port pris ou service arrêté : la relève marche quand même (moins vite si sa connexion meurt)
            }
        }, "nuage-reveil");
        t.setDaemon(true);
        t.start();
    }

    private void ecouterLEcran() {
        ecran = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                relancerLaReleve();
            }
        };
        android.content.IntentFilter f = new android.content.IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        androidx.core.content.ContextCompat.registerReceiver(this, ecran, f, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void relancerLaReleve() {
        LienProtocole p = cache;
        if (p != null) p.interrompreAttente();
        synchronized (reveil) {
            reveil.notifyAll();
        }
    }

    // Ce qui vient du PC ou y est déjà parti ne repart pas (empreinte du dernier texte échangé)
    private static String empreinte(String texte) {
        return Integer.toHexString(texte.hashCode()) + ":" + texte.length();
    }

    static void retenirPressePapiers(Context c, String texte) {
        prefs(c).edit().putString("dernier-presse-papiers", empreinte(texte)).apply();
    }

    /**
     * Nuage de poche vient de prendre le focus (choix de l'utilisateur, 08/10/2026) : Android ne laisse lire le
     * presse-papiers qu'à l'appli qui l'a. Une copie faite juste avant ailleurs (moins de 10 min) part toute seule
     * vers le PC ; jamais une copie marquée « sensible » (mots de passe, Android 13+), ni ce qui vient du PC, ni
     * deux fois la même.
     */
    static void envoyerSiNouveau(Context c) {
        if (protocole(c) == null) return;
        try {
            ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return;
            ClipDescription d = clip.getDescription();
            if (d != null && d.getExtras() != null && d.getExtras().getBoolean("android.content.extra.IS_SENSITIVE")) return;
            if (d != null && d.getTimestamp() > 0) {
                // L'heure de la copie : selon les versions, horloge murale ou temps depuis le démarrage
                long t = d.getTimestamp();
                long age = Math.min(Math.abs(System.currentTimeMillis() - t), Math.abs(SystemClock.elapsedRealtime() - t));
                if (age > 10 * 60_000) return;
            }
            CharSequence texte = clip.getItemAt(0).coerceToText(c);
            if (texte == null || texte.length() == 0) return;
            if (empreinte(texte.toString()).equals(prefs(c).getString("dernier-presse-papiers", ""))) return;
            collerDepuis(c, texte.toString(), "ouverture");
        } catch (Exception ignore) {
            // presse-papiers illisible (pas encore le focus) : rien
        }
    }

    /** Le Wi-Fi vient de se connecter (nouveau réseau, retour à la maison) : on cherche le PC sans attendre. */
    private void ecouterLeReseau() {
        try {
            android.net.ConnectivityManager cm = getSystemService(android.net.ConnectivityManager.class);
            android.net.NetworkRequest demande = new android.net.NetworkRequest.Builder()
                .addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI)
                .build();
            rappelReseau = new android.net.ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(android.net.Network reseau) {
                    reveiller();
                }
            };
            cm.registerNetworkCallback(demande, rappelReseau);
        } catch (Exception ignore) {
            // sans suivi du réseau : la relève réessaie d'elle-même (toutes les 15 s au plus)
        }
    }

    private void reveiller() {
        reseauNeuf = true;
        synchronized (reveil) {
            reveil.notifyAll();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_ENVOYER.equals(intent.getAction())) {
            List<Uri> uris = new ArrayList<>();
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
            envoyer(uris);
        } else if (intent != null && ACTION_COLLER.equals(intent.getAction())) {
            String texte = intent.getStringExtra("texte");
            String source = intent.getStringExtra("source");
            if (texte != null) coller(texte, source == null ? "" : source);
        } else if (intent != null && ACTION_SONNERIE_STOP.equals(intent.getAction())) {
            arreterSonnerie(true);
        } else if (intent != null && ACTION_REPONDRE.equals(intent.getAction())) {
            String id = intent.getStringExtra("id");
            String choix = intent.getStringExtra("choix");
            String preuve = intent.getStringExtra("preuve");
            if (id != null && choix != null) repondre(id, choix, preuve == null ? "aucune" : preuve);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(batterie);
        } catch (Exception ignore) {
            // déjà retiré
        }
        Sonnerie.arreter(this);
        if (bulle != null) bulle.cacher();
        try {
            if (rappelReseau != null) getSystemService(android.net.ConnectivityManager.class).unregisterNetworkCallback(rappelReseau);
            if (ecran != null) unregisterReceiver(ecran);
        } catch (Exception ignore) {
            // déjà retiré
        }
        actif = false;
        java.net.DatagramSocket s = reveilUdp;
        if (s != null) s.close(); // débloque l'écoute du courrier annoncé
        instance = null;
        connecte = false;
        if (releve != null) releve.interrupt();
        envois.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private PendingIntent ouvrirAppli() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Ouvre l'appli sur un onglet (« agents ») : notifications des agents, widget. */
    private PendingIntent ouvrirAppli(String onglet) {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("onglet", onglet);
        return PendingIntent.getActivity(this, 41, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---------- Relève du courrier ----------
    private void releverLeCourrier() {
        List<String> vus = new ArrayList<>();
        int pause = 2000;
        boolean presente = false;
        int echecs = 0;
        long derniereRecherche = 0;
        while (actif) {
            LienProtocole p = protocole(this);
            if (p == null) {
                dormir(3000);
                continue;
            }
            // Nouveau Wi-Fi : essai immédiat, et recherche du PC sur ce réseau s'il ne répond pas
            if (reseauNeuf) {
                reseauNeuf = false;
                pause = 1000;
                if (!connecte) {
                    echecs = Math.max(echecs, 1);
                    derniereRecherche = 0;
                }
            }
            try {
                if (!presente) {
                    p.bonjour(Build.MANUFACTURER + " " + Build.MODEL, Build.MODEL);
                    presente = true;
                }
                JSONArray elements = p.boite(25_000, vus, etatAppareil());
                vus.clear();
                echecs = 0;
                if (p.hotesChanges()) prefs(this).edit().putString("hotes-connues", new JSONArray(p.hotes()).toString()).apply();
                // Météo du PC : l'appli et la bulle prennent la même (sa ville est la bonne)
                JSONObject meteo = p.meteoPc;
                if (meteo != null && !meteo.toString().equals(prefs(this).getString("meteo-pc", ""))) {
                    prefs(this).edit().putString("meteo-pc", meteo.toString()).putString("meteo", meteo.toString()).apply();
                    emettre("meteo", meteo);
                }
                if (p.hoteActif() != null && !p.hoteActif().equals(prefs(this).getString("hote", null))) prefs(this).edit().putString("hote", p.hoteActif()).apply();
                refuse = false;
                if (!connecte) {
                    connecte = true;
                    emettreEtat();
                }
                pause = 2000;
                for (int i = 0; elements != null && i < elements.length(); i++) {
                    JSONObject e = elements.getJSONObject(i);
                    try {
                        traiter(p, e);
                    } catch (Exception erreur) {
                        // un élément illisible ne bloque pas la boîte
                    }
                    vus.add(e.getString("id"));
                }
            } catch (LienProtocole.LienException e) {
                if (e.statut == -1) continue; // relève coupée exprès (courrier annoncé, écran rallumé) : on relève tout de suite
                if (e.statut == 401 || e.statut == 403) presente = false; // le PC a oublié ce téléphone : se représenter
                horsLigne();
                if (e.statut == 401 && !refuse) {
                    refuse = true;
                    emettreEtat();
                }
                // Le PC ne répond plus à ses adresses : la box lui en a peut-être donné une autre. On le cherche
                // sur le Wi-Fi (au plus toutes les 15 s, tout de suite sur un nouveau Wi-Fi), sans rescanner le QR code.
                if (e.statut == 0 && ++echecs >= 2 && System.currentTimeMillis() - derniereRecherche > 15_000) {
                    derniereRecherche = System.currentTimeMillis();
                    String trouve = p.decouvrir(2500); // diffusion, puis balayage du réseau si rien ne répond
                    if (trouve != null) {
                        prefs(this).edit().putString("hote", trouve).apply();
                        pause = 500;
                        continue;
                    }
                }
                dormir(pause);
                pause = Math.min(15_000, pause * 2);
            } catch (Exception e) {
                horsLigne();
                dormir(pause);
                pause = Math.min(15_000, pause * 2);
            }
        }
    }

    private void horsLigne() {
        if (connecte) {
            connecte = false;
            emettreEtat();
        }
    }

    /** Attente entre deux essais, écourtée dès que le Wi-Fi se connecte (reveiller). */
    private void dormir(int ms) {
        synchronized (reveil) {
            if (reseauNeuf) return;
            try {
                reveil.wait(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void traiter(LienProtocole p, JSONObject e) throws Exception {
        String type = e.optString("type");
        if ("presse-papiers".equals(type)) {
            String texte = e.optString("texte", "");
            if (!texte.isEmpty()) {
                retenirPressePapiers(this, texte); // ne repart pas vers le PC à l'ouverture de l'appli
                principal.post(() -> {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("Nuage", texte));
                });
                emettre("pressePapiers", new JSONObject().put("longueur", texte.length()));
            } else if (!e.optString("image").isEmpty()) {
                byte[] png = Base64.decode(e.getString("image"), Base64.DEFAULT);
                Uri uri = enregistrer("image-du-pc.png", "image/png", out -> out.write(png), png.length, null);
                ajouterRecu("image-du-pc.png", png.length, "image/png", uri);
                notifier("Image copiée sur le PC", "Touche pour l’ouvrir", uri, "image/png");
            }
        } else if ("fichier".equals(type) && !e.optString("maj").isEmpty()) {
            recevoirMaj(p, e.getString("transfert"), e.getInt("morceaux"), e.getString("maj"));
        } else if ("fichier".equals(type)) {
            String nom = e.getString("nom");
            long taille = e.getLong("taille");
            int morceaux = e.getInt("morceaux");
            String transfert = e.getString("transfert");
            String mime = typeDe(nom);
            final long[] fait = {0};
            Uri uri = enregistrer(nom, mime, out -> {
                for (int i = 0; i < morceaux; i++) {
                    byte[] octets = p.envoiMorceau(transfert, i);
                    out.write(octets);
                    fait[0] += octets.length;
                    emettre("transfert", new JSONObject().put("sens", "recu").put("nom", nom).put("taille", taille).put("fait", fait[0]));
                }
            }, taille, nom);
            ajouterRecu(nom, taille, mime, uri);
            emettre("transfert", new JSONObject().put("sens", "recu").put("nom", nom).put("taille", taille).put("fait", taille).put("fini", true));
            notifier("Reçu du PC : " + nom, "Touche pour l’ouvrir", uri, mime);
        } else if ("notif".equals(type)) {
            String titre = e.optString("titre", "Nuage");
            String texte = e.optString("texte", "");
            JSONArray liste = new JSONArray(prefs(this).getString("nouvelles", "[]"));
            liste = garderLesDerniers(liste, new JSONObject().put("titre", titre).put("texte", texte).put("genre", e.optString("genre")).put("at", System.currentTimeMillis()), 20);
            prefs(this).edit().putString("nouvelles", liste.toString()).apply();
            emettre("nouvelle", new JSONObject().put("titre", titre).put("texte", texte).put("genre", e.optString("genre")));
            notifier(titre, texte, null, null);
            emettreEtat();
        } else if ("chat".equals(type)) {
            JSONObject etatChat = e.optJSONObject("etat");
            if (etatChat != null) emettre("chat", etatChat);
        } else if ("agents".equals(type)) {
            JSONObject etatAgents = e.optJSONObject("etat");
            if (etatAgents != null) principal.post(() -> recevoirAgents(etatAgents));
        } else if ("sonner".equals(type)) {
            principal.post(this::sonner);
        } else if ("sonner-stop".equals(type)) {
            principal.post(() -> arreterSonnerie(false));
        }
    }

    // ---------- Agents de code (Coucou sur iPhone, version Android, 06/10/2026) ----------
    // Le PC envoie un résumé (agents-telephone.js) à chaque changement qui compte : l'appli l'affiche (onglet
    // Agents), le widget se redessine, une demande d'autorisation devient une notification à boutons (Approuver
    // derrière l'empreinte, Voir, Refuser) et une session au travail une notification « en direct » (barre
    // d'étapes ; sur Android 16, mise en avant dans la barre d'état et l'écran de verrouillage).
    private final java.util.Set<String> demandesNotifiees = new java.util.HashSet<>();
    private String directSession;
    private String directTitre = "";
    private long directDebut;
    private int directTotal;

    private void recevoirAgents(JSONObject etat) {
        prefs(this).edit().putString("agents", etat.toString()).apply();
        emettre("agents", etat);
        try {
            AgentsWidget.mettreAJour(this);
        } catch (Exception ignore) {
            // widget absent ou refusé : rien de grave
        }
        majDemandes(etat.optJSONArray("demandes"));
        majDirect(etat.optJSONArray("sessions"));
    }

    private static int notifDemande(String id) {
        return 2000 + (id.hashCode() & 0xfff);
    }

    private void majDemandes(JSONArray demandes) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        java.util.Set<String> encore = new java.util.HashSet<>();
        for (int i = 0; demandes != null && i < demandes.length(); i++) {
            JSONObject d = demandes.optJSONObject(i);
            if (d == null || d.optString("id").isEmpty()) continue;
            encore.add(d.optString("id"));
            if (demandesNotifiees.add(d.optString("id"))) notifierDemande(d);
        }
        for (String id : new java.util.ArrayList<>(demandesNotifiees)) {
            if (encore.contains(id)) continue;
            demandesNotifiees.remove(id);
            nm.cancel(notifDemande(id)); // répondue (sur le PC ou ici) ou expirée
        }
    }

    private void notifierDemande(JSONObject d) {
        String id = d.optString("id");
        int nid = notifDemande(id);
        String label = d.optString("label");
        String commande = d.optString("commande");
        boolean question = d.optBoolean("question");
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CANAL_ACCORDS)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle(d.optString("titre", "Claude") + (question ? " te pose une question" : " attend ton accord"))
            .setContentText(question ? "Réponds dans l’encoche du PC." : label)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(question ? "Réponds dans l’encoche du PC." : label + (commande.isEmpty() || commande.equals(label) ? "" : "\n" + commande)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(ouvrirAppli("agents"));
        long reste = d.optLong("expire") - System.currentTimeMillis();
        if (reste > 1000) b.setTimeoutAfter(reste);
        if (!question) {
            PendingIntent approuver = PendingIntent.getActivity(this, nid, AutorisationActivity.intent(this, id, "allow", label), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent refuser = PendingIntent.getService(this, nid + 1, new Intent(this, LienService.class).setAction(ACTION_REPONDRE).putExtra("id", id).putExtra("choix", "deny"),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(0, "Approuver", approuver).addAction(0, "Voir", ouvrirAppli("agents")).addAction(0, "Refuser", refuser);
        }
        try {
            getSystemService(NotificationManager.class).notify(nid, b.build());
        } catch (SecurityException refuse) {
            // notifications refusées : l'appli montre la demande quand même
        }
    }

    private static JSONObject trouver(JSONArray sessions, String id) {
        for (int i = 0; sessions != null && i < sessions.length(); i++) {
            JSONObject s = sessions.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) return s;
        }
        return null;
    }

    private void majDirect(JSONArray sessions) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        JSONObject live = null;
        for (int i = 0; sessions != null && i < sessions.length(); i++) {
            JSONObject s = sessions.optJSONObject(i);
            if (s != null && "en-cours".equals(s.optString("statut"))) {
                live = s;
                break;
            }
        }
        try {
            if (live != null) {
                if (!live.optString("id").equals(directSession)) {
                    directSession = live.optString("id");
                    directDebut = System.currentTimeMillis();
                }
                directTitre = live.optString("titre");
                directTotal = live.optInt("total");
                // qui : « Claude », ou l'IA du chat du PC (« Gemini »…, 09/10/2026)
                String qui = live.optString("qui", "Claude");
                String texte = live.optString("actuel").isEmpty() ? "travaille…" : live.optString("actuel");
                Notification n = Build.VERSION.SDK_INT >= 36
                    ? directeAndroid16(qui + " travaille · " + directTitre, texte, live.optInt("faites"), directTotal)
                    : new NotificationCompat.Builder(this, CANAL_DIRECT)
                        .setSmallIcon(R.drawable.ic_nuage)
                        .setContentTitle(qui + " travaille · " + directTitre)
                        .setContentText(texte)
                        .setSubText(directTotal > 0 ? live.optInt("faites") + " ✓" : null)
                        // + 1 : l'étape en cours (ou la réflexion avant la suivante) ; sinon la barre est pleine
                        // dès qu'un outil se termine alors que Claude travaille encore (vu sur le Pixel le 06/10)
                        .setProgress(directTotal + 1, live.optInt("faites"), directTotal == 0)
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setSilent(true)
                        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                        .setContentIntent(ouvrirAppli("agents"))
                        .build();
                nm.notify(NOTIF_DIRECT, n);
                return;
            }
            if (directSession == null) return;
            // La session suivie ne travaille plus : finie (« Done while you were out »), ou elle attend (la notification
            // d'autorisation prend le relais)
            JSONObject s = trouver(sessions, directSession);
            String statut = s == null ? "" : s.optString("statut");
            directSession = null;
            if ("termine".equals(statut) || "inactif".equals(statut)) {
                long secondes = Math.max(1, (System.currentTimeMillis() - directDebut) / 1000);
                String duree = secondes >= 60 ? (secondes / 60) + " min " + (secondes % 60) + " s" : secondes + " s";
                Notification fin = new NotificationCompat.Builder(this, CANAL_DIRECT)
                    .setSmallIcon(R.drawable.ic_nuage)
                    .setContentTitle("✓ Terminé · " + directTitre)
                    .setContentText((directTotal > 0 ? directTotal + " étapes · " : "") + duree)
                    .setAutoCancel(true)
                    .setTimeoutAfter(30 * 60_000L)
                    .setContentIntent(ouvrirAppli("agents"))
                    .build();
                nm.notify(NOTIF_DIRECT, fin);
            } else {
                nm.cancel(NOTIF_DIRECT);
            }
        } catch (SecurityException refuse) {
            // notifications refusées
        }
    }

    /** Android 16 : barre d'étapes (ProgressStyle) et mise en avant (puce dans la barre d'état, écran de verrouillage). */
    @androidx.annotation.RequiresApi(36)
    private Notification directeAndroid16(String titre, String texte, int faites, int total) {
        Notification.ProgressStyle style = new Notification.ProgressStyle();
        if (total > 0) {
            // Un segment de plus pour l'étape en cours : la barre n'est jamais pleine tant que Claude travaille
            int segs = total + 1;
            List<Notification.ProgressStyle.Segment> segments = new ArrayList<>();
            if (segs <= 12) {
                for (int i = 0; i < segs; i++) segments.add(new Notification.ProgressStyle.Segment(1).setColor(0xFF3B9EFF));
            } else {
                segments.add(new Notification.ProgressStyle.Segment(segs).setColor(0xFF3B9EFF));
            }
            style.setProgressSegments(segments);
            style.setProgress(Math.min(faites, total));
        } else {
            style.setProgressIndeterminate(true);
        }
        return new Notification.Builder(this, CANAL_DIRECT)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle(titre)
            .setContentText(texte)
            .setStyle(style)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            // Android 16 (API 36) : la mise en avant se demande par cet extra (la méthode du Builder vient plus tard)
            .addExtras(promotion())
            .setShortCriticalText(total > 0 ? faites + " ✓" : "…")
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setContentIntent(ouvrirAppli("agents"))
            .build();
    }

    private static android.os.Bundle promotion() {
        android.os.Bundle extras = new android.os.Bundle();
        extras.putBoolean("android.requestPromotedOngoing", true);
        return extras;
    }

    /** Réponse à une demande (approuvée derrière l'empreinte dans AutorisationActivity, ou refusée). */
    static void repondreDepuis(Context c, String id, String choix, String preuve) {
        LienService s = instance;
        if (s != null) {
            s.repondre(id, choix, preuve);
            return;
        }
        Intent i = new Intent(c, LienService.class).setAction(ACTION_REPONDRE).putExtra("id", id).putExtra("choix", choix).putExtra("preuve", preuve);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    void repondre(String id, String choix, String preuve) {
        getSystemService(NotificationManager.class).cancel(notifDemande(id));
        envois.execute(() -> {
            LienProtocole p = protocole(this);
            if (p == null) return;
            try {
                JSONObject r = p.api("agents-repondre", new JSONObject().put("id", id).put("choix", choix).put("preuve", preuve), 15_000);
                principal.post(() -> recevoirAgents(r));
                dire("deny".equals(choix) ? "Refusé : Claude ne le fera pas." : "Autorisé ✓ Claude continue sur le PC.");
                emettre("autorisation", new JSONObject().put("id", id).put("ok", true).put("choix", choix));
            } catch (Exception erreur) {
                String message = erreur.getMessage() == null ? "Le PC ne répond pas." : erreur.getMessage();
                dire(message);
                try {
                    emettre("autorisation", new JSONObject().put("id", id).put("ok", false).put("message", message));
                } catch (Exception ignore) {
                    // rien
                }
            }
        });
    }

    // ---------- « Où est mon téléphone ? » ----------
    private void sonner() {
        if (!Sonnerie.demarrer(this, () -> arreterSonnerie(false))) return;
        PendingIntent trouve = PendingIntent.getService(this, 2, new Intent(this, LienService.class).setAction(ACTION_SONNERIE_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CANAL_RECHERCHE)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle("Nuage te cherche !")
            .setContentText("Ton PC fait sonner ce téléphone.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(ouvrirAppli())
            .addAction(0, "Je l’ai trouvé", trouve)
            .build();
        try {
            getSystemService(NotificationManager.class).notify(NOTIF_SONNERIE, n);
        } catch (SecurityException refuse) {
            // notifications refusées : la sonnerie s'arrête seule, ou depuis l'appli
        }
        try {
            emettre("sonnerie", new JSONObject().put("active", true));
        } catch (Exception ignore) {
            // rien
        }
    }

    /** parUtilisateur : « Je l'ai trouvé » (le PC est prévenu). */
    void arreterSonnerie(boolean parUtilisateur) {
        boolean sonnait = Sonnerie.active();
        Sonnerie.arreter(this);
        getSystemService(NotificationManager.class).cancel(NOTIF_SONNERIE);
        if (sonnait && parUtilisateur) signal("trouve");
        try {
            emettre("sonnerie", new JSONObject().put("active", false));
        } catch (Exception ignore) {
            // rien
        }
    }

    static void arreterSonnerieDepuis(Context c) {
        LienService s = instance;
        if (s != null) s.principal.post(() -> s.arreterSonnerie(true));
    }

    void signal(String quoi) {
        envois.execute(() -> {
            LienProtocole p = protocole(this);
            if (p == null) return;
            try {
                p.signal(quoi);
            } catch (Exception ignore) {
                // PC injoignable : rien de grave
            }
        });
    }

    // ---------- Fichiers reçus : Téléchargements/Nuage ----------
    interface Ecriture {
        void ecrire(OutputStream out) throws Exception;
    }

    private Uri enregistrer(String nom, String mime, Ecriture ecriture, long taille, String nomAffiche) throws Exception {
        String propre = nom.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, propre);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Nuage");
            v.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("Téléchargements inaccessibles");
            try (OutputStream out = cr.openOutputStream(uri)) {
                ecriture.ecrire(out);
            } catch (Exception erreur) {
                cr.delete(uri, null, null);
                annule(nomAffiche);
                throw erreur;
            }
            v.clear();
            v.put(MediaStore.Downloads.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            return uri;
        }
        // Android 8 et 9 : dossier de l'appli (visible depuis Nuage de poche)
        File dossier = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Nuage");
        if (!dossier.exists() && !dossier.mkdirs()) throw new IOException("dossier impossible");
        File fichier = new File(dossier, propre);
        try (OutputStream out = new FileOutputStream(fichier)) {
            ecriture.ecrire(out);
        } catch (Exception erreur) {
            if (!fichier.delete()) fichier.deleteOnExit();
            annule(nomAffiche);
            throw erreur;
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", fichier);
    }

    /**
     * Mise à jour de l'appli envoyée par le PC (lien chiffré) : APK rangé dans le cache, puis notification
     * « Mettre à jour ». Android demande confirmation et refuse un APK qui n'est pas signé comme l'appli installée.
     */
    private void recevoirMaj(LienProtocole p, String transfert, int morceaux, String version) throws Exception {
        File dossier = new File(getCacheDir(), "maj");
        if (!dossier.exists() && !dossier.mkdirs()) throw new IOException("cache inaccessible");
        File apk = new File(dossier, "nuage-de-poche.apk");
        try (OutputStream out = new FileOutputStream(apk)) {
            for (int i = 0; i < morceaux; i++) out.write(p.envoiMorceau(transfert, i));
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apk);
        Intent installer = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent action = PendingIntent.getActivity(this, NOTIF_MAJ, installer, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CANAL_NOUVELLES)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle("Nuage de poche " + version + " est prêt")
            .setContentText("Touche pour mettre à jour (ta version : " + versionAppli(this) + ")")
            .setAutoCancel(true)
            .setContentIntent(action)
            .addAction(0, "Mettre à jour", action)
            .build();
        try {
            getSystemService(NotificationManager.class).notify(NOTIF_MAJ, n);
        } catch (SecurityException refuse) {
            // notifications refusées : la mise à jour attendra la prochaine fois
        }
    }

    private void annule(String nom) {
        if (nom == null) return;
        try {
            emettre("transfert", new JSONObject().put("sens", "recu").put("nom", nom).put("annule", true));
        } catch (Exception ignore) {
            // rien
        }
    }

    private static String typeDe(String nom) {
        int point = nom.lastIndexOf('.');
        String ext = point >= 0 ? nom.substring(point + 1).toLowerCase(java.util.Locale.ROOT) : "";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    private void ajouterRecu(String nom, long taille, String type, Uri uri) throws Exception {
        JSONArray liste = new JSONArray(prefs(this).getString("recus", "[]"));
        JSONObject r = new JSONObject().put("nom", nom).put("taille", taille).put("type", type).put("uri", String.valueOf(uri)).put("at", System.currentTimeMillis());
        prefs(this).edit().putString("recus", garderLesDerniers(liste, r, 30).toString()).apply();
        emettreEtat();
    }

    private static JSONArray garderLesDerniers(JSONArray liste, JSONObject nouveau, int max) throws Exception {
        JSONArray sortie = new JSONArray();
        sortie.put(nouveau);
        for (int i = 0; i < liste.length() && sortie.length() < max; i++) sortie.put(liste.get(i));
        return sortie;
    }

    private void notifier(String titre, String texte, Uri uri, String mime) {
        PendingIntent action = ouvrirAppli();
        if (uri != null) {
            Intent voir = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            action = PendingIntent.getActivity(this, prochainId, voir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        Notification n = new NotificationCompat.Builder(this, CANAL_NOUVELLES)
            .setSmallIcon(R.drawable.ic_nuage)
            .setContentTitle(titre)
            .setContentText(texte)
            .setAutoCancel(true)
            .setContentIntent(action)
            .build();
        try {
            getSystemService(NotificationManager.class).notify(prochainId++, n);
        } catch (SecurityException refuse) {
            // notifications refusées par l'utilisateur : l'appli le montre quand même
        }
    }

    // ---------- Envois vers le PC ----------
    static void envoyerDepuis(Context c, List<Uri> uris) {
        LienService s = instance;
        if (s != null) {
            s.envoyer(uris);
            return;
        }
        Intent i = new Intent(c, LienService.class).setAction(ACTION_ENVOYER).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ClipData clip = null;
        for (Uri u : uris) {
            if (clip == null) clip = ClipData.newRawUri("fichiers", u);
            else clip.addItem(new ClipData.Item(u));
        }
        i.setClipData(clip);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    void envoyer(List<Uri> uris) {
        for (Uri uri : uris) envois.execute(() -> envoyerUn(uri));
    }

    private void envoyerUn(Uri uri) {
        LienProtocole p = protocole(this);
        if (p == null) return;
        String nom = "fichier";
        long taille = -1;
        try (Cursor cur = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                nom = cur.getString(0);
                if (!cur.isNull(1)) taille = cur.getLong(1);
            }
        } catch (Exception ignore) {
            // nom par défaut
        }
        String type = getContentResolver().getType(uri);
        String id = null;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("fichier illisible");
            if (taille < 0) throw new IOException("taille inconnue");
            id = p.fichierDebut(nom, taille, type == null ? "" : type);
            byte[] tampon = new byte[LienProtocole.MORCEAU];
            long fait = 0;
            for (int index = 0; fait < taille; index++) {
                int lu = 0;
                while (lu < tampon.length) {
                    int n = in.read(tampon, lu, tampon.length - lu);
                    if (n < 0) break;
                    lu += n;
                }
                if (lu == 0) break;
                byte[] morceau = lu == tampon.length ? tampon : java.util.Arrays.copyOf(tampon, lu);
                p.fichierMorceau(id, index, morceau);
                fait += lu;
                emettre("transfert", new JSONObject().put("sens", "envoi").put("nom", nom).put("taille", taille).put("fait", fait));
            }
            p.fichierFin(id);
            emettre("transfert", new JSONObject().put("sens", "envoi").put("nom", nom).put("taille", taille).put("fait", taille).put("fini", true));
        } catch (Exception erreur) {
            try {
                if (id != null) p.fichierAnnule(id);
            } catch (Exception ignore) {
                // déjà perdu
            }
            try {
                emettre("transfert", new JSONObject().put("sens", "envoi").put("nom", nom).put("annule", true));
            } catch (Exception ignore) {
                // rien
            }
        }
    }

    /** source : menu (texte sélectionné), bulle, tuile, notif, appli, partage. */
    static void collerDepuis(Context c, String texte, String source) {
        LienService s = instance;
        if (s != null) {
            s.coller(texte, source);
            return;
        }
        Intent i = new Intent(c, LienService.class).setAction(ACTION_COLLER).putExtra("texte", texte).putExtra("source", source);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    void coller(String texte, String source) {
        // Hors de l'appli (menu du texte, tuile, bulle, notification, partage), un petit message dit le
        // résultat : avant le 05/10/2026, « c'est sur le PC » s'affichait avant même de savoir
        // À l'ouverture de l'appli (« ouverture »), l'appli le dit elle-même ; PC injoignable : rien (réessayé la fois suivante)
        boolean dire = !"appli".equals(source) && !"ouverture".equals(source);
        envois.execute(() -> {
            LienProtocole p = protocole(this);
            if (p == null) return;
            try {
                p.pressePapiers(texte, source);
                retenirPressePapiers(this, texte);
                emettre("copie", new JSONObject().put("longueur", texte.length()).put("source", source));
                if (dire) dire("Sur le PC : Ctrl+V pour le coller.");
            } catch (Exception erreur) {
                if (dire) dire("Le PC ne répond pas : copie non envoyée (même Wi-Fi, Nuage ouvert sur le PC ?).");
                else if ("appli".equals(source)) emettre("copieRatee", new JSONObject());
            }
        });
    }

    private void dire(String message) {
        principal.post(() -> android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show());
    }

    static void signalDepuis(Context c, String quoi) {
        LienService s = instance;
        if (s != null) s.signal(quoi);
    }
}

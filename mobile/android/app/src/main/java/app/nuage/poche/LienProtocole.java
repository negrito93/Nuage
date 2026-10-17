package app.nuage.poche;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Lien avec Nuage sur le PC : même protocole que nuage-bureau/lien.js (réseau local, port 47824).
 * Chaque message est chiffré et authentifié en AES-256-GCM : IV (12 octets) | texte chiffré | étiquette (16 octets),
 * données associées = « MÉTHODE /chemin » (réponses : « REP MÉTHODE /chemin »). Messages JSON : horodatage « t »
 * et nonce « n » (le PC refuse les rejeux). Java pur (pas d'Android) : testé sur la JVM contre le vrai serveur.
 */
public final class LienProtocole {
    public static final int MORCEAU = 1024 * 1024;
    private static final int CONNEXION_MS = 2500;

    public final String pcId;
    public final String pcNom;
    public final String qr;
    private final byte[] cle;
    private final List<String> hotes = new java.util.concurrent.CopyOnWriteArrayList<>();
    private volatile int port;
    private final String appareilId;
    private final SecureRandom alea = new SecureRandom();
    private volatile String hoteActif;
    // Relève en cours (/v1/boite) : coupée par interrompreAttente() quand le PC annonce du courrier
    private volatile HttpURLConnection attenteEnCours;
    private volatile boolean interrompu;

    /** Erreur du lien : statut HTTP (0 = PC injoignable, -1 = relève coupée exprès : à relancer tout de suite). */
    public static final class LienException extends IOException {
        public final int statut;

        LienException(int statut, String message) {
            super(message);
            this.statut = statut;
        }
    }

    private LienProtocole(String qr, JSONObject info, String appareilId) throws JSONException {
        this.qr = qr;
        this.pcId = info.getString("id");
        this.pcNom = info.optString("n", "PC");
        this.cle = Base64.getUrlDecoder().decode(info.getString("k"));
        if (cle.length != 32) throw new JSONException("clé incorrecte");
        JSONArray h = info.getJSONArray("h");
        for (int i = 0; i < h.length(); i++) hotes.add(h.getString(i));
        this.port = info.optInt("p", 47824);
        this.appareilId = appareilId;
        if (!hotes.isEmpty()) hoteActif = hotes.get(0);
    }

    /** Contenu du QR code affiché par Nuage sur le PC : « NUAGE1:{json} ». */
    public static LienProtocole depuisQr(String qr, String appareilId) throws JSONException {
        if (qr == null || !qr.startsWith("NUAGE1:")) throw new JSONException("Ce n’est pas un code de Nuage.");
        return new LienProtocole(qr, new JSONObject(qr.substring(7)), appareilId);
    }

    /** Adresse retrouvée plus tard (découverte) : essayée en premier. */
    public void ajouterHote(String hote) {
        if (hote == null || hote.isEmpty()) return;
        hotes.remove(hote);
        hotes.add(0, hote);
        hoteActif = hote;
    }

    public String hoteActif() {
        return hoteActif;
    }

    private volatile boolean hotesChanges;

    /** Météo du PC (sa ville), donnée à chaque relève ; null tant qu'il n'en a pas. */
    public volatile JSONObject meteoPc;

    /** Adresse donnée par le PC (il peut en avoir plusieurs, ou changer de réseau) : essayée après les autres. */
    public void ajouterHoteSiNouveau(String hote) {
        if (hote == null || hote.isEmpty() || hotes.contains(hote)) return;
        hotes.add(hote);
        while (hotes.size() > 8) hotes.remove(hotes.size() - 1);
        hotesChanges = true;
    }

    public List<String> hotes() {
        return new ArrayList<>(hotes);
    }

    /** Vrai une fois si la liste des adresses a changé depuis le dernier appel (à enregistrer). */
    public boolean hotesChanges() {
        boolean c = hotesChanges;
        hotesChanges = false;
        return c;
    }

    // ---------- Réseaux locaux : le PC se cherche sur CHAQUE réseau du téléphone (v1.8, 06/10/2026) ----------
    // v1.7 n'envoyait qu'une diffusion « 255.255.255.255 » par le réseau par défaut d'Android : elle se perd si le
    // routeur ne relaie pas les diffusions, ou si Android choisit un autre réseau (Wi-Fi sans Internet : données
    // mobiles). Maintenant : un socket par réseau local (lié à ce réseau), diffusion générale + diffusion dirigée
    // (x.y.z.255), et, si rien n'a répondu, un message à chaque adresse du réseau (balayage de 254 adresses).

    /** Un réseau local du téléphone (Wi-Fi, point d'accès, partage USB) sur lequel chercher le PC. */
    public interface Cible {
        /** Nom parlant : « Wi-Fi », « câble », « partage de connexion »… */
        String nom();

        /** Adresse du téléphone sur ce réseau (« 192.168.1.23 »), ou "" si inconnue. */
        String moi();

        /** Longueur du masque (24 pour 255.255.255.0). */
        int prefixe();

        /** Socket UDP qui passe par ce réseau (même s'il n'a pas Internet). */
        java.net.DatagramSocket socket() throws IOException;
    }

    /** Les réseaux locaux du téléphone, et la façon d'ouvrir une connexion HTTP vers le PC par le bon. */
    public interface Reseau {
        List<Cible> cibles();

        java.net.URLConnection ouvrir(URL url) throws IOException;
    }

    /** Posé par l'appli Android (ReseauAndroid) ; null sur la JVM des tests (réseau par défaut). */
    public static volatile Reseau reseau;

    /** Dernière recherche : ce qui a été essayé, pour expliquer un échec à l'utilisateur. */
    public static volatile JSONObject dernierDiag;

    static java.net.URLConnection ouvrirCx(URL url) throws IOException {
        Reseau r = reseau;
        return r != null ? r.ouvrir(url) : url.openConnection();
    }

    /** « a.b.c.d » → entier de 32 bits (dans un long), ou -1 si ce n'est pas une adresse IPv4. */
    public static long versLong(String ip) {
        if (ip == null) return -1;
        String[] p = ip.trim().split("\\.");
        if (p.length != 4) return -1;
        long n = 0;
        for (String x : p) {
            if (x.isEmpty() || x.length() > 3) return -1;
            int v;
            try {
                v = Integer.parseInt(x);
            } catch (NumberFormatException e) {
                return -1;
            }
            if (v < 0 || v > 255) return -1;
            n = (n << 8) | v;
        }
        return n;
    }

    public static String versTexte(long n) {
        return ((n >> 24) & 255) + "." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255);
    }

    private static long masque(int prefixe) {
        return prefixe <= 0 ? 0 : (0xFFFFFFFFL << (32 - Math.min(32, prefixe))) & 0xFFFFFFFFL;
    }

    /** « ip » est-elle sur le même réseau que « moi/prefixe » ? */
    public static boolean memeReseau(String ip, String moi, int prefixe) {
        long a = versLong(ip);
        long b = versLong(moi);
        if (a < 0 || b < 0) return false;
        long m = masque(prefixe);
        return (a & m) == (b & m);
    }

    /** Bloc balayé : le réseau du téléphone, ramené à un /24 s'il est plus grand (254 adresses au plus). */
    private static long[] bloc(String moi, int prefixe) {
        long ip = versLong(moi);
        int p = Math.max(24, Math.min(30, prefixe));
        long m = masque(p);
        long reseau = ip & m;
        return new long[] {reseau, reseau | (~m & 0xFFFFFFFFL)};
    }

    /** Adresses de diffusion à essayer : générale, celle du réseau, celle du /24 du téléphone. */
    public static List<String> diffusionsDe(String moi, int prefixe) {
        List<String> liste = new ArrayList<>();
        liste.add("255.255.255.255");
        long ip = versLong(moi);
        if (ip < 0) return liste;
        if (prefixe > 0 && prefixe <= 30) {
            String d = versTexte(ip | (~masque(prefixe) & 0xFFFFFFFFL));
            if (!liste.contains(d)) liste.add(d);
        }
        String d24 = versTexte(bloc(moi, prefixe)[1]);
        if (!liste.contains(d24)) liste.add(d24);
        return liste;
    }

    /** Toutes les adresses du bloc, sauf le réseau, la diffusion et le téléphone lui-même. */
    public static List<String> hotesDe(String moi, int prefixe) {
        List<String> liste = new ArrayList<>();
        if (versLong(moi) < 0) return liste;
        long[] b = bloc(moi, prefixe);
        long soi = versLong(moi);
        for (long n = b[0] + 1; n < b[1]; n++) if (n != soi) liste.add(versTexte(n));
        return liste;
    }

    /** Réseau « factice » des tests et du repli : une seule adresse visée, sans balayage. */
    private static final class CibleFixe implements Cible {
        private final String adresse;

        CibleFixe(String adresse) {
            this.adresse = adresse;
        }

        public String nom() {
            return adresse;
        }

        public String moi() {
            return "";
        }

        public int prefixe() {
            return 0;
        }

        public java.net.DatagramSocket socket() throws IOException {
            return new java.net.DatagramSocket();
        }
    }

    /**
     * Cherche Nuage : « NUAGE-OU <qui> » (qui = « * » pour tous les PC, ou l'identifiant d'un PC) sur chaque réseau.
     * Renvoie { pcs: [{ id, nom, port, adresse }], reseaux: [{ nom, moi, prefixe, balayees?, envoyes, reponses,
     * erreur? }], balayage: bool, ms }. Rien de secret dans ces messages.
     */
    public static JSONObject sonder(List<Cible> cibles, String qui, int portUdp, int attenteMs, boolean balayer) {
        final long debut = System.currentTimeMillis();
        final long fin = debut + attenteMs;
        final byte[] q = ("NUAGE-OU " + qui).getBytes(StandardCharsets.UTF_8);
        final List<JSONObject> trouves = new java.util.concurrent.CopyOnWriteArrayList<>();
        final java.util.Set<String> vus = java.util.concurrent.ConcurrentHashMap.newKeySet();
        final java.util.concurrent.atomic.AtomicLong premiere = new java.util.concurrent.atomic.AtomicLong(0);
        final List<java.net.DatagramSocket> sockets = new ArrayList<>();
        final List<Thread> ecouteurs = new ArrayList<>();
        final List<JSONObject> infos = new ArrayList<>();
        final List<java.util.concurrent.atomic.AtomicInteger> reponses = new ArrayList<>();
        final List<java.util.concurrent.atomic.AtomicInteger> envoyes = new ArrayList<>();

        for (Cible c : cibles) {
            JSONObject info = new JSONObject();
            try {
                info.put("nom", c.nom()).put("moi", c.moi()).put("prefixe", c.prefixe());
            } catch (JSONException ignore) {
                // clés simples : ne lève pas
            }
            infos.add(info);
            final java.util.concurrent.atomic.AtomicInteger rep = new java.util.concurrent.atomic.AtomicInteger();
            reponses.add(rep);
            envoyes.add(new java.util.concurrent.atomic.AtomicInteger());
            try {
                final java.net.DatagramSocket s = c.socket();
                s.setBroadcast(true);
                sockets.add(s);
                Thread t = new Thread(() -> {
                    byte[] tampon = new byte[512];
                    while (System.currentTimeMillis() < fin && !s.isClosed()) {
                        java.net.DatagramPacket r = new java.net.DatagramPacket(tampon, tampon.length);
                        try {
                            s.setSoTimeout(150);
                            s.receive(r);
                        } catch (java.net.SocketTimeoutException attente) {
                            continue;
                        } catch (IOException fermee) {
                            break;
                        }
                        String[] mots = new String(r.getData(), 0, r.getLength(), StandardCharsets.UTF_8).trim().split("\\s+");
                        if (mots.length < 3 || !"NUAGE-ICI".equals(mots[0])) continue;
                        if (!"*".equals(qui) && !qui.equals(mots[1])) continue;
                        rep.incrementAndGet();
                        if (!vus.add(mots[1])) continue;
                        try {
                            String nom = mots.length >= 4 ? java.net.URLDecoder.decode(mots[3], "UTF-8") : "PC";
                            trouves.add(new JSONObject().put("id", mots[1]).put("port", Integer.parseInt(mots[2]))
                                .put("adresse", r.getAddress().getHostAddress()).put("nom", nom));
                            premiere.compareAndSet(0, System.currentTimeMillis());
                        } catch (Exception illisible) {
                            vus.remove(mots[1]); // réponse d'un autre programme : ignorée
                        }
                    }
                }, "nuage-sonde");
                t.setDaemon(true);
                t.start();
                ecouteurs.add(t);
            } catch (Exception e) {
                try {
                    info.put("erreur", String.valueOf(e.getMessage()));
                } catch (JSONException ignore) {
                    // rien
                }
                sockets.add(null);
            }
        }

        boolean balaye = false;
        try {
            // 1. Diffusions (deux fois : un paquet de diffusion du Wi-Fi se perd facilement)
            for (int tour = 0; tour < 2; tour++) {
                for (int i = 0; i < cibles.size(); i++) {
                    java.net.DatagramSocket s = sockets.get(i);
                    if (s == null || s.isClosed()) continue;
                    Cible c = cibles.get(i);
                    List<String> destinations = c instanceof CibleFixe ? java.util.Collections.singletonList(((CibleFixe) c).adresse) : diffusionsDe(c.moi(), c.prefixe());
                    for (String d : destinations) {
                        try {
                            s.send(new java.net.DatagramPacket(q, q.length, java.net.InetAddress.getByName(d), portUdp));
                            envoyes.get(i).incrementAndGet();
                        } catch (IOException e) {
                            try {
                                if (!infos.get(i).has("erreur")) infos.get(i).put("erreur", "envoi à " + d + " : " + e.getMessage());
                            } catch (JSONException ignore) {
                                // rien
                            }
                        }
                    }
                }
                if (attendre(Math.min(fin, System.currentTimeMillis() + (tour == 0 ? 450 : 700)), premiere)) break;
            }
            // 2. Rien ? Un message à chaque adresse du réseau (les routeurs qui ne relaient pas les diffusions laissent passer ça)
            if (trouves.isEmpty() && balayer) {
                for (int i = 0; i < cibles.size(); i++) {
                    java.net.DatagramSocket s = sockets.get(i);
                    Cible c = cibles.get(i);
                    if (s == null || s.isClosed() || c instanceof CibleFixe) continue;
                    List<String> hotes = hotesDe(c.moi(), c.prefixe());
                    if (hotes.isEmpty()) continue;
                    balaye = true;
                    try {
                        infos.get(i).put("balayees", hotes.size());
                    } catch (JSONException ignore) {
                        // rien
                    }
                    int n = 0;
                    for (String h : hotes) {
                        try {
                            s.send(new java.net.DatagramPacket(q, q.length, java.net.InetAddress.getByName(h), portUdp));
                            envoyes.get(i).incrementAndGet();
                        } catch (IOException ignore) {
                            // une adresse qui refuse n'arrête pas les autres
                        }
                        if (++n % 40 == 0) Thread.sleep(4); // pas de rafale : certains routeurs la jettent
                    }
                }
                attendre(fin, premiere);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            for (java.net.DatagramSocket s : sockets) if (s != null) s.close();
            for (Thread t : ecouteurs) {
                try {
                    t.join(300);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        JSONObject resultat = new JSONObject();
        try {
            JSONArray reseaux = new JSONArray();
            for (int i = 0; i < infos.size(); i++) reseaux.put(infos.get(i).put("envoyes", envoyes.get(i).get()).put("reponses", reponses.get(i).get()));
            JSONArray pcs = new JSONArray();
            for (JSONObject t : trouves) pcs.put(t);
            resultat.put("pcs", pcs).put("reseaux", reseaux).put("balayage", balaye).put("ms", System.currentTimeMillis() - debut);
        } catch (JSONException ignore) {
            // rien
        }
        dernierDiag = resultat;
        return resultat;
    }

    /** Attend jusqu'à « jusqua » ; sort plus tôt (renvoie vrai) 350 ms après la première réponse. */
    private static boolean attendre(long jusqua, java.util.concurrent.atomic.AtomicLong premiere) throws InterruptedException {
        while (true) {
            long p = premiere.get();
            long limite = p > 0 ? Math.min(jusqua, p + 350) : jusqua;
            if (System.currentTimeMillis() >= limite) return p > 0;
            Thread.sleep(30);
        }
    }

    private static List<Cible> cibles() {
        Reseau r = reseau;
        List<Cible> liste = r != null ? new ArrayList<>(r.cibles()) : new ArrayList<Cible>();
        if (liste.isEmpty()) liste.add(new CibleFixe("255.255.255.255")); // pas d'info sur le réseau : l'ancienne diffusion
        return liste;
    }

    // ---------- Découverte : le PC a changé d'adresse sur le Wi-Fi (box) ----------
    /** Cherche CE PC sur tous les réseaux du téléphone ; renvoie l'adresse trouvée (aussi ajoutée en tête), ou null. */
    public String decouvrir(int attenteMs) {
        return garder(sonder(cibles(), pcId, port, attenteMs, true));
    }

    /** « NUAGE-OU <id> » vers adresse:portUdp, réponse « NUAGE-ICI <id> <port> » (rien de secret). */
    public String decouvrir(String adresse, int portUdp, int attenteMs) {
        return garder(sonder(java.util.Collections.<Cible>singletonList(new CibleFixe(adresse)), pcId, portUdp, attenteMs, false));
    }

    private String garder(JSONObject resultat) {
        JSONArray pcs = resultat.optJSONArray("pcs");
        if (pcs == null || pcs.length() == 0) return null;
        JSONObject pc = pcs.optJSONObject(0);
        if (pc == null) return null;
        if (pc.optInt("port", 0) > 0) port = pc.optInt("port");
        String hote = pc.optString("adresse", "");
        if (hote.isEmpty()) return null;
        ajouterHote(hote);
        return hote;
    }

    // ---------- Association par le Wi-Fi, sans QR code (06/10/2026) ----------
    // Même protocole que lien.js : « NUAGE-OU * » → « NUAGE-ICI <id> <port> <nom> » ; POST /v1/appairage
    // (clé publique ECDH P-256, SPKI) → le PC affiche un code à 6 chiffres (empreinte des deux clés) et
    // attend l'accord de l'utilisateur ; GET /v1/appairage/<demande> (attente longue) → le contenu du QR code
    // chiffré par la clé commune (ECDH + HKDF-SHA256 + AES-256-GCM, données associées « NUAGE-APPAIRAGE »).

    /** PC avec Nuage sur ce Wi-Fi : liste de { id, nom, adresse, port } (une seule adresse visée : tests). */
    public static JSONArray chercherPcs(String adresse, int portUdp, int attenteMs) {
        return sonder(java.util.Collections.<Cible>singletonList(new CibleFixe(adresse)), "*", portUdp, attenteMs, false).optJSONArray("pcs");
    }

    /** Tous les réseaux du téléphone : { pcs, reseaux, balayage, ms } (voir sonder). */
    public static JSONObject chercherPcsPartout(int portUdp, int attenteMs) {
        return sonder(cibles(), "*", portUdp, attenteMs, true);
    }

    /** Les réseaux locaux du téléphone, sans rien envoyer : [{ nom, moi, prefixe }]. */
    public static JSONArray reseauxLocaux() {
        JSONArray liste = new JSONArray();
        Reseau r = reseau;
        if (r == null) return liste;
        try {
            for (Cible c : r.cibles()) liste.put(new JSONObject().put("nom", c.nom()).put("moi", c.moi()).put("prefixe", c.prefixe()));
        } catch (JSONException ignore) {
            // rien
        }
        return liste;
    }

    /** Demande d'association en cours : le code à afficher, et ce qu'il faut pour lire la réponse du PC. */
    public static final class Demande {
        public final String id;
        public final String code;
        public final String pcNom;
        final String hote;
        final int port;
        final java.security.KeyPair cles;
        final byte[] pubTel;
        final byte[] pubPc;

        Demande(String id, String code, String pcNom, String hote, int port, java.security.KeyPair cles, byte[] pubTel, byte[] pubPc) {
            this.id = id;
            this.code = code;
            this.pcNom = pcNom;
            this.hote = hote;
            this.port = port;
            this.cles = cles;
            this.pubTel = pubTel;
            this.pubPc = pubPc;
        }
    }

    /** Code à 6 chiffres : empreinte SHA-256 des deux clés publiques (le même que celui du PC). */
    static String codeAppairage(byte[] pubTel, byte[] pubPc) throws GeneralSecurityException {
        java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
        d.update(pubTel);
        byte[] h = d.digest(pubPc);
        long n = ((h[0] & 0xffL) << 24) | ((h[1] & 0xffL) << 16) | ((h[2] & 0xffL) << 8) | (h[3] & 0xffL);
        return String.format(java.util.Locale.ROOT, "%06d", n % 1_000_000L);
    }

    /** HKDF-SHA256 (RFC 5869) pour 32 octets : sel = SHA-256(clés publiques), info = « nuage-appairage-v1 ». */
    static byte[] cleAppairage(byte[] commun, byte[] pubTel, byte[] pubPc) throws GeneralSecurityException {
        java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
        d.update(pubTel);
        byte[] sel = d.digest(pubPc);
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(sel, "HmacSHA256"));
        byte[] prk = mac.doFinal(commun);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update("nuage-appairage-v1".getBytes(StandardCharsets.UTF_8));
        mac.update((byte) 1);
        return mac.doFinal();
    }

    /** Requête JSON en clair (association seulement) ; statut ≠ 200 → LienException avec le message du PC. */
    private static JSONObject jsonHttp(String methode, String url, JSONObject corps, int lectureMs) throws IOException {
        HttpURLConnection cx = (HttpURLConnection) ouvrirCx(new URL(url));
        try {
            cx.setConnectTimeout(CONNEXION_MS);
            cx.setReadTimeout(lectureMs);
            cx.setRequestMethod(methode);
            cx.setUseCaches(false);
            if (corps != null) {
                byte[] octets = corps.toString().getBytes(StandardCharsets.UTF_8);
                cx.setDoOutput(true);
                cx.setFixedLengthStreamingMode(octets.length);
                cx.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = cx.getOutputStream()) {
                    out.write(octets);
                }
            }
            int statut = cx.getResponseCode();
            InputStream flux = statut >= 400 ? cx.getErrorStream() : cx.getInputStream();
            String texte = flux == null ? "{}" : new String(lire(flux), StandardCharsets.UTF_8);
            JSONObject r;
            try {
                r = new JSONObject(texte);
            } catch (JSONException e) {
                r = new JSONObject();
            }
            if (statut != 200) throw new LienException(statut, r.optString("erreur", "réponse " + statut));
            return r;
        } catch (LienException e) {
            throw e;
        } catch (IOException e) {
            throw new LienException(0, "PC injoignable (" + e.getMessage() + ")");
        } finally {
            cx.disconnect();
        }
    }

    /** Envoie la demande d'association au PC trouvé ; renvoie le code à afficher (le PC montre le même). */
    public static Demande demanderAppairage(String hote, int port, String appareilId, String nom, String modele) throws IOException {
        try {
            java.security.KeyPairGenerator g = java.security.KeyPairGenerator.getInstance("EC");
            g.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
            java.security.KeyPair cles = g.generateKeyPair();
            byte[] pubTel = cles.getPublic().getEncoded(); // SPKI DER, comme Node
            JSONObject corps = new JSONObject()
                .put("appareil", new JSONObject().put("id", appareilId).put("nom", nom).put("modele", modele))
                .put("pub", Base64.getEncoder().encodeToString(pubTel));
            JSONObject r = jsonHttp("POST", "http://" + hote + ":" + port + "/v1/appairage", corps, 10_000);
            byte[] pubPc = Base64.getDecoder().decode(r.getString("pub"));
            JSONObject pc = r.optJSONObject("pc");
            return new Demande(r.getString("demande"), codeAppairage(pubTel, pubPc), pc == null ? "PC" : pc.optString("nom", "PC"), hote, port, cles, pubTel, pubPc);
        } catch (GeneralSecurityException | JSONException e) {
            throw new IOException(e);
        }
    }

    /**
     * Attend la réponse de l'utilisateur sur le PC (jusqu'à {@code jusqua}) ; renvoie le contenu du QR code
     * équivalent (« NUAGE1:{…} »). Refus, expiration : LienException (403 / 408).
     */
    public static String attendreAppairage(Demande d, long jusqua) throws IOException {
        while (System.currentTimeMillis() < jusqua) {
            JSONObject r = jsonHttp("GET", "http://" + d.hote + ":" + d.port + "/v1/appairage/" + d.id, null, 40_000);
            String statut = r.optString("statut");
            if ("attente".equals(statut)) continue;
            if (!"accepte".equals(statut)) throw new LienException("refuse".equals(statut) ? 403 : 408, statut);
            try {
                java.security.PublicKey pc = java.security.KeyFactory.getInstance("EC").generatePublic(new java.security.spec.X509EncodedKeySpec(d.pubPc));
                javax.crypto.KeyAgreement accord = javax.crypto.KeyAgreement.getInstance("ECDH");
                accord.init(d.cles.getPrivate());
                accord.doPhase(pc, true);
                byte[] cle = cleAppairage(accord.generateSecret(), d.pubTel, d.pubPc);
                byte[] boite = Base64.getDecoder().decode(r.getString("boite"));
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cle, "AES"), new GCMParameterSpec(128, boite, 0, 12));
                c.updateAAD("NUAGE-APPAIRAGE".getBytes(StandardCharsets.UTF_8));
                JSONObject info = new JSONObject(new String(c.doFinal(boite, 12, boite.length - 12), StandardCharsets.UTF_8));
                // L'adresse qui a répondu passe en premier
                JSONArray h = new JSONArray().put(d.hote);
                JSONArray autres = info.optJSONArray("h");
                for (int i = 0; autres != null && i < autres.length(); i++) if (!d.hote.equals(autres.optString(i))) h.put(autres.optString(i));
                info.put("h", h);
                return "NUAGE1:" + info;
            } catch (GeneralSecurityException | JSONException e) {
                throw new LienException(401, "réponse du PC illisible");
            }
        }
        throw new LienException(408, "expire");
    }

    // ---------- Chiffrement ----------
    byte[] sceller(byte[] clair, String aad) throws GeneralSecurityException {
        byte[] iv = new byte[12];
        alea.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cle, "AES"), new GCMParameterSpec(128, iv));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        byte[] chiffre = c.doFinal(clair);
        byte[] boite = new byte[12 + chiffre.length];
        System.arraycopy(iv, 0, boite, 0, 12);
        System.arraycopy(chiffre, 0, boite, 12, chiffre.length);
        return boite;
    }

    byte[] ouvrir(byte[] boite, String aad) throws GeneralSecurityException {
        if (boite.length < 28) throw new GeneralSecurityException("message trop court");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cle, "AES"), new GCMParameterSpec(128, boite, 0, 12));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return c.doFinal(boite, 12, boite.length - 12);
    }

    // ---------- Requêtes ----------
    /** Envoie (corps déjà en clair, ou null pour GET) et renvoie la réponse déchiffrée. */
    private byte[] requete(String methode, String chemin, byte[] clair, int lectureMs) throws IOException {
        byte[] corps;
        try {
            corps = clair == null ? null : sceller(clair, methode + " " + chemin);
        } catch (GeneralSecurityException e) {
            throw new IOException(e);
        }
        List<String> essais = new ArrayList<>();
        if (hoteActif != null) essais.add(hoteActif);
        for (String h : hotes) if (!essais.contains(h)) essais.add(h);
        IOException derniere = new LienException(0, "PC injoignable");
        for (String hote : essais) {
            HttpURLConnection cx = null;
            try {
                cx = (HttpURLConnection) ouvrirCx(new URL("http://" + hote + ":" + port + chemin));
                if ("/v1/boite".equals(chemin)) {
                    interrompu = false;
                    attenteEnCours = cx;
                }
                cx.setConnectTimeout(CONNEXION_MS);
                cx.setReadTimeout(lectureMs);
                cx.setRequestMethod(methode);
                cx.setRequestProperty("X-Nuage-Appareil", appareilId);
                cx.setUseCaches(false);
                if (corps != null) {
                    cx.setDoOutput(true);
                    cx.setFixedLengthStreamingMode(corps.length);
                    cx.setRequestProperty("Content-Type", "application/octet-stream");
                    try (OutputStream out = cx.getOutputStream()) {
                        out.write(corps);
                    }
                }
                int statut = cx.getResponseCode();
                hoteActif = hote;
                if (statut != 200) throw new LienException(statut, "réponse " + statut);
                try (InputStream in = cx.getInputStream()) {
                    return ouvrir(lire(in), "REP " + methode + " " + chemin);
                } catch (GeneralSecurityException e) {
                    throw new LienException(401, "réponse illisible");
                }
            } catch (LienException e) {
                throw e; // le PC a répondu : inutile d'essayer une autre adresse
            } catch (IOException e) {
                if (interrompu) {
                    interrompu = false;
                    throw new LienException(-1, "relève relancée");
                }
                derniere = new LienException(0, "PC injoignable (" + e.getMessage() + ")");
            } finally {
                if (attenteEnCours == cx) attenteEnCours = null;
                if (cx != null) cx.disconnect();
            }
        }
        throw derniere;
    }

    /**
     * Le PC annonce du courrier (paquet UDP) ou l'écran se rallume : la relève en cours, peut-être sur une connexion
     * morte sans bruit, est coupée ; boite() lève alors LienException -1 et la relève repart aussitôt.
     */
    public void interrompreAttente() {
        HttpURLConnection c = attenteEnCours;
        if (c == null) return;
        interrompu = true;
        c.disconnect();
    }

    private static byte[] lire(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] tampon = new byte[64 * 1024];
        for (int n; (n = in.read(tampon)) > 0; ) out.write(tampon, 0, n);
        return out.toByteArray();
    }

    private JSONObject message(String chemin, JSONObject corps, int lectureMs) throws IOException {
        try {
            byte[] nonce = new byte[12];
            alea.nextBytes(nonce);
            StringBuilder n = new StringBuilder();
            for (byte b : nonce) n.append(String.format("%02x", b));
            corps.put("t", System.currentTimeMillis());
            corps.put("n", n.toString());
            byte[] reponse = requete("POST", chemin, corps.toString().getBytes(StandardCharsets.UTF_8), lectureMs);
            return new JSONObject(new String(reponse, StandardCharsets.UTF_8));
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    // ---------- Messages ----------
    public JSONObject bonjour(String nom, String modele) throws IOException {
        try {
            JSONObject appareil = new JSONObject().put("id", appareilId).put("nom", nom).put("modele", modele);
            return message("/v1/bonjour", new JSONObject().put("appareil", appareil), 8000);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** Courrier du PC : attend jusqu'à attenteMs qu'il arrive quelque chose ; vus = accusés de réception. */
    public JSONArray boite(int attenteMs, Collection<String> vus) throws IOException {
        return boite(attenteMs, vus, null);
    }

    /** Idem, en donnant l'état du téléphone (batterie, version…) que montre le menu Téléphone du PC. */
    public JSONArray boite(int attenteMs, Collection<String> vus, JSONObject etat) throws IOException {
        try {
            JSONObject corps = new JSONObject().put("attente", attenteMs).put("vus", new JSONArray(vus));
            if (etat != null) corps.put("etat", etat);
            // Marge courte : une connexion d'attente morte se voit vite (avant : 10 s de plus)
            JSONObject r = message("/v1/boite", corps, attenteMs + 4_000);
            // Le PC donne ses adresses du moment : retenues pour le jour où il change de réseau ou d'adresse
            JSONObject pc = r.optJSONObject("pc");
            if (pc != null && pc.optJSONObject("meteo") != null) meteoPc = pc.optJSONObject("meteo");
            JSONArray adresses = pc == null ? null : pc.optJSONArray("adresses");
            for (int i = 0; adresses != null && i < adresses.length(); i++) ajouterHoteSiNouveau(adresses.optString(i));
            return r.optJSONArray("elements");
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    public void pressePapiers(String texte) throws IOException {
        pressePapiers(texte, "");
    }

    /** source : menu (texte sélectionné), bulle, tuile, notif, appli, partage. */
    public void pressePapiers(String texte, String source) throws IOException {
        try {
            message("/v1/presse-papiers", new JSONObject().put("texte", texte).put("source", source), 15_000);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** État du téléphone tout de suite (branché / débranché, chaque % en charge), sans attendre la relève. */
    public void etat(JSONObject etat) throws IOException {
        try {
            message("/v1/etat", new JSONObject().put("etat", etat), 8000);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** Demande traitée par Nuage sur le PC (chat avec Claude) : renvoie le résultat, ou lève l'erreur à montrer. */
    public JSONObject api(String nom, JSONObject donnees, int lectureMs) throws IOException {
        try {
            JSONObject r = message("/v1/api/" + nom, new JSONObject().put("donnees", donnees == null ? new JSONObject() : donnees), lectureMs);
            if (!r.optBoolean("ok")) throw new LienException(422, r.optString("erreur", "Le PC a refusé."));
            Object resultat = r.opt("resultat");
            return resultat instanceof JSONObject ? (JSONObject) resultat : new JSONObject();
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** Petit signe au PC : « coucou » (Nuage du PC salue) ou « trouve » (la sonnerie est arrêtée). */
    public void signal(String quoi) throws IOException {
        try {
            message("/v1/signal", new JSONObject().put("signal", quoi), 8000);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** Fichier téléphone → PC : renvoie l'identifiant du transfert. */
    public String fichierDebut(String nom, long taille, String type) throws IOException {
        try {
            JSONObject r = message("/v1/fichier/debut", new JSONObject().put("nom", nom).put("taille", taille).put("type", type), 15_000);
            return r.getString("id");
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    public void fichierMorceau(String id, int index, byte[] octets) throws IOException {
        requete("POST", "/v1/fichier/" + id + "/" + index, octets, 60_000);
    }

    public JSONObject fichierFin(String id) throws IOException {
        return message("/v1/fichier/" + id + "/fin", new JSONObject(), 30_000);
    }

    public void fichierAnnule(String id) throws IOException {
        message("/v1/fichier/" + id + "/annule", new JSONObject(), 15_000);
    }

    /** Morceau d'un fichier PC → téléphone (déchiffré). */
    public byte[] envoiMorceau(String transfert, int index) throws IOException {
        return requete("GET", "/v1/envoi/" + transfert + "/" + index, null, 60_000);
    }
}

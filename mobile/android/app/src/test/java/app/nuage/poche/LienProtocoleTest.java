package app.nuage.poche;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeFalse;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Random;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Le protocole Java du téléphone contre le vrai serveur du PC (nuage-bureau/lien.js), lancé sur 127.0.0.1
 * par outils/test-lien-java.ps1. Sans QR code (test lancé seul), le test est ignoré.
 */
public class LienProtocoleTest {
    private static String hex(byte[] octets) throws Exception {
        StringBuilder s = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(octets)) s.append(String.format("%02x", b));
        return s.toString();
    }

    @Test
    public void dialogueAvecLePc() throws Exception {
        // Le QR code est lu dans un fichier : passé en ligne de commande, Windows en retirerait les guillemets
        String chemin = System.getProperty("nuage.dossier", "");
        assumeFalse("serveur de test absent", chemin.isEmpty());
        File dossier = new File(chemin);
        String qr = new String(Files.readAllBytes(new File(dossier, "qr.txt").toPath()), StandardCharsets.UTF_8).trim();
        LienProtocole p = LienProtocole.depuisQr(qr, "telephone-java");

        // 1. Association
        JSONObject r = p.bonjour("Téléphone Java", "JUnit");
        assertEquals("PC-TEST-JAVA", r.getJSONObject("pc").getString("nom"));

        // 2. Le PC a préparé un presse-papiers et un fichier : boîte (avec l'état du téléphone), téléchargement, accusés
        JSONObject etat = new JSONObject().put("batterie", 57).put("charge", false).put("version", "1.1.0").put("android", "15").put("bulle", true);
        JSONArray boite = p.boite(5000, Collections.emptyList(), etat);
        List<String> vus = new ArrayList<>();
        String texte = null;
        byte[] fichier = null;
        for (int i = 0; i < boite.length(); i++) {
            JSONObject e = boite.getJSONObject(i);
            vus.add(e.getString("id"));
            if ("presse-papiers".equals(e.getString("type"))) texte = e.getString("texte");
            if ("fichier".equals(e.getString("type"))) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                for (int n = 0; n < e.getInt("morceaux"); n++) out.write(p.envoiMorceau(e.getString("transfert"), n));
                fichier = out.toByteArray();
            }
        }
        assertEquals("Bonjour depuis le PC (é ☁)", texte);
        assertNotNull("fichier du PC reçu", fichier);
        String attendu = new String(Files.readAllBytes(new File(dossier, "envoye.sha256").toPath()), StandardCharsets.UTF_8).trim();
        assertEquals(attendu, hex(fichier));
        assertEquals(0, p.boite(0, vus).length());

        // 3. Presse-papiers du téléphone → PC (depuis le menu du texte sélectionné), puis un coucou
        p.pressePapiers("Copié sur le téléphone Java", "menu");
        p.signal("coucou");

        // 3 bis. Chat par le PC (/v1/api) : résultat, et erreur renvoyée telle quelle
        JSONObject chat = p.api("chat-envoyer", new JSONObject().put("texte", "Bonjour Claude"), 15_000);
        assertEquals("Bonjour Claude", chat.getString("texte"));
        try {
            p.api("chat-envoyer", new JSONObject(), 15_000);
            throw new AssertionError("un message vide aurait dû être refusé");
        } catch (LienProtocole.LienException e) {
            assertEquals("message vide", e.getMessage());
        }

        // 3 ter. Découverte : le PC répond sur son port UDP (écrit par le serveur de test dans udp.txt)
        int udp = Integer.parseInt(new String(Files.readAllBytes(new File(dossier, "udp.txt").toPath()), StandardCharsets.UTF_8).trim());
        assertEquals("127.0.0.1", p.decouvrir("127.0.0.1", udp, 3000));

        // 4. Fichier du téléphone → PC (2,5 Mo)
        byte[] donnees = new byte[(int) (LienProtocole.MORCEAU * 2.5)];
        new Random(42).nextBytes(donnees);
        String id = p.fichierDebut("depuis-java.bin", donnees.length, "application/octet-stream");
        for (int n = 0; n * LienProtocole.MORCEAU < donnees.length; n++) {
            int debut = n * LienProtocole.MORCEAU;
            int fin = Math.min(donnees.length, debut + LienProtocole.MORCEAU);
            p.fichierMorceau(id, n, java.util.Arrays.copyOfRange(donnees, debut, fin));
        }
        assertEquals("depuis-java.bin", p.fichierFin(id).getString("nom"));
        Files.write(new File(dossier, "java.sha256").toPath(), hex(donnees).getBytes(StandardCharsets.UTF_8));

        // 5. Mauvaise clé : refusée
        String faux = qr.replaceAll("\"k\":\"[^\"]+\"", "\"k\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"");
        assertNotNull(faux.equals(qr) ? null : faux);
        try {
            LienProtocole.depuisQr(faux, "telephone-java").boite(0, Collections.emptyList());
            throw new AssertionError("une mauvaise clé aurait dû être refusée");
        } catch (LienProtocole.LienException e) {
            assertEquals(401, e.statut);
        }
    }

    /** Association par le Wi-Fi, sans QR code (06/10/2026) : recherche, code, accord du PC, clé reçue chiffrée. */
    @Test
    public void associationParLeWifi() throws Exception {
        String chemin = System.getProperty("nuage.dossier", "");
        assumeFalse("serveur de test absent", chemin.isEmpty());
        File dossier = new File(chemin);
        int udp = Integer.parseInt(new String(Files.readAllBytes(new File(dossier, "udp.txt").toPath()), StandardCharsets.UTF_8).trim());
        JSONArray pcs = LienProtocole.chercherPcs("127.0.0.1", udp, 2000);
        assertEquals(1, pcs.length());
        JSONObject pc = pcs.getJSONObject(0);
        assertEquals("PC-TEST-JAVA", pc.getString("nom"));
        LienProtocole.Demande d = LienProtocole.demanderAppairage("127.0.0.1", pc.getInt("port"), "telephone-wifi", "Pixel Wi-Fi", "JUnit");
        assertEquals(6, d.code.length());
        Files.write(new File(dossier, "code-java.txt").toPath(), d.code.getBytes(StandardCharsets.UTF_8));
        // Le serveur de test clique « Accepter » tout seul
        String qr = LienProtocole.attendreAppairage(d, System.currentTimeMillis() + 20_000);
        LienProtocole p = LienProtocole.depuisQr(qr, "telephone-wifi");
        assertEquals("PC-TEST-JAVA", p.bonjour("Pixel Wi-Fi", "JUnit").getJSONObject("pc").getString("nom"));
        assertNotNull(p.boite(0, Collections.emptyList())); // la clé reçue ouvre bien la boîte
    }

    /** 08/10/2026 : la relève en attente est coupée (courrier annoncé par le PC, écran rallumé) et repart aussitôt. */
    @Test
    public void releveCoupee() throws Exception {
        String chemin = System.getProperty("nuage.dossier", "");
        assumeFalse("serveur de test absent", chemin.isEmpty());
        String qr = new String(Files.readAllBytes(new File(chemin, "qr.txt").toPath()), StandardCharsets.UTF_8).trim();
        LienProtocole p = LienProtocole.depuisQr(qr, "telephone-attente");
        p.bonjour("Téléphone qui attend", "JUnit");
        // Boîte vidée d'abord (le serveur de test prépare du courrier pour chaque téléphone associé)
        JSONArray deja = p.boite(0, Collections.emptyList());
        List<String> vus = new ArrayList<>();
        for (int i = 0; i < deja.length(); i++) vus.add(deja.getJSONObject(i).getString("id"));
        p.boite(0, vus);
        new Thread(() -> {
            try {
                Thread.sleep(400);
            } catch (InterruptedException ignore) {
                // rien
            }
            p.interrompreAttente();
        }).start();
        long debut = System.currentTimeMillis();
        try {
            p.boite(15_000, Collections.emptyList());
            org.junit.Assert.fail("la relève aurait dû être coupée");
        } catch (LienProtocole.LienException e) {
            assertEquals(-1, e.statut);
        }
        assertTrue("coupée tout de suite", System.currentTimeMillis() - debut < 3000);
        assertNotNull(p.boite(0, Collections.emptyList())); // la relève suivante marche
    }

    /** v1.8 : calcul des adresses de diffusion et de balayage (sans réseau, sans serveur). */
    @Test
    public void adressesDuReseau() {
        assertEquals(Arrays.asList("255.255.255.255", "192.168.1.255"), LienProtocole.diffusionsDe("192.168.1.23", 24));
        // Réseau plus grand que /24 : sa diffusion, puis celle du /24 du téléphone
        assertEquals(Arrays.asList("255.255.255.255", "192.168.255.255", "192.168.1.255"), LienProtocole.diffusionsDe("192.168.1.23", 16));
        assertEquals(Arrays.asList("255.255.255.255"), LienProtocole.diffusionsDe("", 24));
        List<String> hotes = LienProtocole.hotesDe("192.168.100.62", 24);
        assertEquals(253, hotes.size()); // 254 hôtes, moins le téléphone lui-même
        assertEquals("192.168.100.1", hotes.get(0));
        assertEquals("192.168.100.254", hotes.get(hotes.size() - 1));
        assertFalse(hotes.contains("192.168.100.62"));
        assertEquals(0, LienProtocole.hotesDe("", 24).size());
        assertTrue(LienProtocole.memeReseau("192.168.100.203", "192.168.100.62", 24));
        assertFalse(LienProtocole.memeReseau("192.168.1.5", "192.168.100.62", 24));
        assertEquals(-1, LienProtocole.versLong("pas.une.adresse"));
        assertEquals(-1, LienProtocole.versLong("192.168.1.256"));
        assertEquals("10.0.0.1", LienProtocole.versTexte(LienProtocole.versLong("10.0.0.1")));
    }

    private static LienProtocole.Cible fauxReseau(String moi) {
        return new LienProtocole.Cible() {
            public String nom() {
                return "faux Wi-Fi";
            }

            public String moi() {
                return moi;
            }

            public int prefixe() {
                return 24;
            }

            public java.net.DatagramSocket socket() throws java.io.IOException {
                return new java.net.DatagramSocket();
            }
        };
    }

    /**
     * v1.8 : la diffusion se perd (routeur qui ne la relaie pas) → balayage de chaque adresse du réseau.
     * Le faux téléphone est en 127.0.0.5 ; le PC de test écoute en 127.0.0.1, que seul le balayage atteint.
     */
    @Test
    public void balayageQuandLaDiffusionSePerd() throws Exception {
        String chemin = System.getProperty("nuage.dossier", "");
        assumeFalse("serveur de test absent", chemin.isEmpty());
        int udp = Integer.parseInt(new String(Files.readAllBytes(new File(chemin, "udp.txt").toPath()), StandardCharsets.UTF_8).trim());
        JSONObject r = LienProtocole.sonder(Collections.singletonList(fauxReseau("127.0.0.5")), "*", udp, 6000, true);
        assertEquals(1, r.getJSONArray("pcs").length());
        assertEquals("127.0.0.1", r.getJSONArray("pcs").getJSONObject(0).getString("adresse"));
        assertEquals("PC-TEST-JAVA", r.getJSONArray("pcs").getJSONObject(0).getString("nom"));
        assertTrue("le balayage a été nécessaire", r.getBoolean("balayage"));
        JSONObject reseau = r.getJSONArray("reseaux").getJSONObject(0);
        assertEquals("127.0.0.5", reseau.getString("moi"));
        assertEquals(253, reseau.getInt("balayees"));
        assertEquals(1, reseau.getInt("reponses"));
        // Personne ne répond à un autre identifiant : rapport complet, sans PC
        JSONObject vide = LienProtocole.sonder(Collections.singletonList(fauxReseau("127.0.0.5")), "pc-inconnu", udp, 1500, true);
        assertEquals(0, vide.getJSONArray("pcs").length());
        assertEquals(0, vide.getJSONArray("reseaux").getJSONObject(0).getInt("reponses"));
        assertTrue(vide.getJSONArray("reseaux").getJSONObject(0).getInt("envoyes") >= 253);
        assertNotNull(LienProtocole.dernierDiag);
    }}

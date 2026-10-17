package app.nuage.poche;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.io.IOException;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Les réseaux locaux du téléphone vus par Android (v1.8, 06/10/2026) : le Wi-Fi, un câble, le point d'accès du
 * téléphone, le partage USB. Les messages vers le PC partent par CE réseau (Network.bindSocket / openConnection),
 * pas par le « réseau par défaut » d'Android : quand un Wi-Fi n'a pas Internet (routeur 4G sans forfait), Android
 * envoie sinon tout par les données mobiles, et le PC, juste à côté, reste introuvable.
 */
final class ReseauAndroid implements LienProtocole.Reseau {
    private static volatile boolean installe;
    private final ConnectivityManager cm;

    private ReseauAndroid(Context c) {
        cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    /** À appeler avant tout échange avec le PC (sans effet la deuxième fois). */
    static void installer(Context c) {
        if (installe) return;
        installe = true;
        LienProtocole.reseau = new ReseauAndroid(c.getApplicationContext());
    }

    private static final class CibleAndroid implements LienProtocole.Cible {
        final Network reseau; // null : réseau connu seulement par son interface (point d'accès, partage USB)
        final String nom;
        final String moi;
        final int prefixe;
        final int score;

        CibleAndroid(Network reseau, String nom, String moi, int prefixe, int score) {
            this.reseau = reseau;
            this.nom = nom;
            this.moi = moi;
            this.prefixe = prefixe;
            this.score = score;
        }

        public String nom() {
            return nom;
        }

        public String moi() {
            return moi;
        }

        public int prefixe() {
            return prefixe;
        }

        public DatagramSocket socket() throws IOException {
            if (reseau == null) return new DatagramSocket(new InetSocketAddress(InetAddress.getByName(moi), 0));
            DatagramSocket s = new DatagramSocket();
            try {
                reseau.bindSocket(s);
            } catch (IOException e) {
                s.close();
                throw e;
            }
            return s;
        }
    }

    private static String genreDe(NetworkCapabilities nc, LinkProperties lp) {
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "Wi-Fi";
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "câble";
        return nomInterface(lp.getInterfaceName());
    }

    private static String nomInterface(String i) {
        if (i == null || i.isEmpty()) return "réseau";
        if (i.startsWith("rndis") || i.startsWith("usb")) return "partage USB";
        if (i.startsWith("ap") || i.startsWith("swlan")) return "point d’accès du téléphone";
        if (i.startsWith("wlan")) return "Wi-Fi";
        if (i.startsWith("eth")) return "câble";
        return i;
    }

    @Override
    public List<LienProtocole.Cible> cibles() {
        List<CibleAndroid> liste = new ArrayList<>();
        Set<String> vus = new HashSet<>();
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                LinkProperties lp = cm.getLinkProperties(n);
                if (nc == null || lp == null) continue;
                if (nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) || nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                int score = nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? (nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ? 5 : 4)
                    : nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? 3 : 1;
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (!(la.getAddress() instanceof Inet4Address)) continue;
                    String ip = la.getAddress().getHostAddress();
                    if (ip == null || ip.startsWith("169.254.") || ip.startsWith("127.") || !vus.add(ip)) continue;
                    liste.add(new CibleAndroid(n, genreDe(nc, lp), ip, la.getPrefixLength(), score));
                }
            }
        } catch (Exception ignore) {
            // pas d'accès à la liste des réseaux : on essaie les interfaces ci-dessous
        }
        // Réseaux qu'Android ne présente pas comme tels : point d'accès du téléphone, partage de connexion USB
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface ni = interfaces.nextElement();
                String nom = ni.getName();
                if (!ni.isUp() || ni.isLoopback() || ni.isPointToPoint() || nom == null) continue;
                if (nom.startsWith("rmnet") || nom.startsWith("ccmni") || nom.startsWith("dummy") || nom.startsWith("tun") || nom.startsWith("v4-") || nom.startsWith("clat")) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (!(ia.getAddress() instanceof Inet4Address)) continue;
                    String ip = ia.getAddress().getHostAddress();
                    if (ip == null || ip.startsWith("169.254.") || ip.startsWith("127.") || !vus.add(ip)) continue;
                    liste.add(new CibleAndroid(null, nomInterface(nom), ip, ia.getNetworkPrefixLength(), 0));
                }
            }
        } catch (Exception ignore) {
            // Android 11+ limite la liste des interfaces pour les applis : au pire, seuls les réseaux ci-dessus
        }
        Collections.sort(liste, (a, b) -> b.score - a.score);
        return new ArrayList<LienProtocole.Cible>(liste);
    }

    /** Connexion HTTP vers le PC par le réseau qui contient son adresse (le Wi-Fi), pas par le réseau par défaut. */
    @Override
    public URLConnection ouvrir(URL url) throws IOException {
        Network n = reseauPour(url.getHost());
        return n != null ? n.openConnection(url) : url.openConnection();
    }

    private Network reseauPour(String hote) {
        if (LienProtocole.versLong(hote) < 0) return null;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                LinkProperties lp = cm.getLinkProperties(n);
                if (nc == null || lp == null) continue;
                if (nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) || nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (la.getAddress() instanceof Inet4Address && LienProtocole.memeReseau(hote, la.getAddress().getHostAddress(), la.getPrefixLength())) return n;
                }
            }
        } catch (Exception ignore) {
            // réseau par défaut
        }
        return null;
    }
}

package app.nuage.poche;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Le mot de réveil « Hey Nuage » dans ce que la reconnaissance vocale d'Android renvoie. */
public class MotReveilTest {
    @Test
    public void reconnaitLeMotDeReveil() {
        assertEquals("", MotReveil.apres("Hey Nuage"));
        assertEquals("", MotReveil.apres("hé nuage"));
        assertEquals("quel temps fait-il ?", MotReveil.apres("Hey Nuage, quel temps fait-il ?"));
        assertEquals("ouvre le chat", MotReveil.apres("ok nuage ouvre le chat"));
        assertEquals("fais coucou au PC", MotReveil.apres("Salut Nuage fais coucou au PC"));
        assertEquals("", MotReveil.apres("et nuage"));
        assertEquals("quelle heure est-il", MotReveil.apres("Nuage quelle heure est-il"));
        assertEquals("", MotReveil.apres("alors heu dis nuage"));
    }

    @Test
    public void ignoreLeMotNuageDansUnePhrase() {
        assertNull(MotReveil.apres("le nuage est gris"));
        assertNull(MotReveil.apres("il y a des nuages aujourd'hui"));
        assertNull(MotReveil.apres("je mange une nuageuse"));
        assertNull(MotReveil.apres(""));
        assertNull(MotReveil.apres(null));
    }
}

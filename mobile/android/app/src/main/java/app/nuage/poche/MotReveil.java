package app.nuage.poche;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Le mot de réveil « Hey Nuage » dans un texte reconnu (Java pur, testé sur la JVM : MotReveilTest).
 * Acceptés : « Hey Nuage », « hé Nuage », « ok Nuage », « salut Nuage », « dis Nuage »… n'importe où,
 * et « Nuage » (ou « et Nuage », que la reconnaissance entend souvent) en début de phrase. Pas « le nuage est gris ».
 */
final class MotReveil {
    private static final Pattern REVEIL = Pattern.compile(
        "(?:^|\\s)(?:(?:h[eéèê]+y?|hey|hei|eh|ok|okay|salut|dis|coucou|allo|allô)[\\s,]+|^\\s*(?:et\\s+)?)nuages?(?=[\\s,.!?]|$)[\\s,.!?]*",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private MotReveil() {
    }

    /** « Hey Nuage, quel temps fait-il ? » → « quel temps fait-il ? » ; « Hey Nuage » → « » ; null sans mot de réveil. */
    static String apres(String texte) {
        if (texte == null) return null;
        Matcher m = REVEIL.matcher(texte);
        if (!m.find()) return null;
        return texte.substring(m.end()).trim();
    }
}

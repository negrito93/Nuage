package app.nuage.poche;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * Nuage qui flotte par-dessus les autres applis (permission « Afficher par-dessus d'autres applis », donnée par
 * l'utilisateur dans les réglages d'Android). Une petite fenêtre avec une WebView (www/bulle.html) ; le doigt la
 * déplace, elle se colle au bord le plus proche en rebondissant ; un toucher ouvre Nuage de poche ; un double
 * toucher l'ouvre en écoutant ta question (voix) ; un appui long envoie au PC ce qui vient d'être copié
 * (CopieActivity). Cachée quand l'appli est ouverte.
 */
final class Bulle {
    private static final String ORIGINE = "https://appassets.androidplatform.net";
    private final Context contexte;
    private final WindowManager wm;
    private FrameLayout cadre;
    private WebView vue;
    private WindowManager.LayoutParams lp;
    private boolean prete;

    Bulle(Context contexte) {
        this.contexte = contexte;
        this.wm = (WindowManager) contexte.getSystemService(Context.WINDOW_SERVICE);
    }

    static boolean permise(Context c) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c);
    }

    boolean visible() {
        return cadre != null;
    }

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    void montrer() {
        if (cadre != null || !permise(contexte)) return;
        DisplayMetrics m = contexte.getResources().getDisplayMetrics();
        int taille = Math.round(112 * m.density);
        lp = new WindowManager.LayoutParams(
            taille, taille,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = LienService.prefs(contexte).getInt("bulle-x", m.widthPixels - taille);
        lp.y = LienService.prefs(contexte).getInt("bulle-y", m.heightPixels / 3);

        WebViewAssetLoader chargeur = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(contexte))
            .build();
        vue = new WebView(contexte);
        vue.setBackgroundColor(Color.TRANSPARENT);
        vue.getSettings().setJavaScriptEnabled(true);
        vue.getSettings().setAllowFileAccess(false);
        vue.setVerticalScrollBarEnabled(false);
        vue.setHorizontalScrollBarEnabled(false);
        vue.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return chargeur.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                prete = true;
                String meteo = LienService.prefs(contexte).getString("meteo", null);
                if (meteo != null) js("bulle.meteo(" + meteo + ")");
            }
        });

        cadre = new FrameLayout(contexte) {
            private float departX, departY, fenetreX, fenetreY;
            private boolean glisse;
            private boolean appuiLong;
            private boolean toucherEnAttente;
            private final Runnable ouvrirSimple = () -> {
                toucherEnAttente = false;
                ouvrirAppli(false);
            };
            private VelocityTracker vitesse;
            private final int seuil = ViewConfiguration.get(contexte).getScaledTouchSlop();
            // Appui long : la copie du téléphone part vers le PC
            private final Runnable copier = () -> {
                appuiLong = true;
                performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                js("bulle.copie()");
                contexte.startActivity(CopieActivity.intent(contexte, "bulle"));
            };

            @Override
            public boolean onInterceptTouchEvent(MotionEvent e) {
                return true; // le doigt est pour la fenêtre, pas pour la page
            }

            @Override
            public boolean onTouchEvent(MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        departX = e.getRawX();
                        departY = e.getRawY();
                        fenetreX = lp.x;
                        fenetreY = lp.y;
                        glisse = false;
                        appuiLong = false;
                        postDelayed(copier, ViewConfiguration.getLongPressTimeout() + 150);
                        vitesse = VelocityTracker.obtain();
                        vitesse.addMovement(e);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        if (vitesse != null) vitesse.addMovement(e);
                        float dx = e.getRawX() - departX;
                        float dy = e.getRawY() - departY;
                        if (!glisse && !appuiLong && Math.hypot(dx, dy) > seuil) {
                            glisse = true;
                            removeCallbacks(copier);
                            js("bulle.prise()");
                        }
                        if (glisse) {
                            lp.x = Math.round(fenetreX + dx);
                            lp.y = Math.round(fenetreY + dy);
                            wm.updateViewLayout(cadre, lp);
                            if (vitesse != null) {
                                vitesse.computeCurrentVelocity(1000);
                                js("bulle.vitesse(" + Math.round(vitesse.getXVelocity() / m.density) + "," + Math.round(vitesse.getYVelocity() / m.density) + ")");
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        removeCallbacks(copier);
                        if (vitesse != null) {
                            vitesse.recycle();
                            vitesse = null;
                        }
                        if (appuiLong) return true; // la copie est partie : rien d'autre
                        if (glisse) {
                            js("bulle.lache()");
                            collerAuBord(m.widthPixels, taille);
                        } else if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                            // Double toucher : l'appli s'ouvre et écoute ta question ; un seul : elle s'ouvre
                            if (toucherEnAttente) {
                                removeCallbacks(ouvrirSimple);
                                toucherEnAttente = false;
                                ouvrirAppli(true);
                            } else {
                                toucherEnAttente = true;
                                postDelayed(ouvrirSimple, ViewConfiguration.getDoubleTapTimeout());
                            }
                        }
                        return true;
                    default:
                        return super.onTouchEvent(e);
                }
            }
        };
        cadre.addView(vue, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        wm.addView(cadre, lp);
        vue.loadUrl(ORIGINE + "/assets/public/bulle.html");
    }

    private void ouvrirAppli(boolean ecouter) {
        Intent ouvrir = new Intent(contexte, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("ecouter", ecouter);
        contexte.startActivity(ouvrir);
    }

    // Au bord le plus proche, avec un petit rebond
    private void collerAuBord(int largeurEcran, int taille) {
        int cible = lp.x + taille / 2 < largeurEcran / 2 ? -taille / 8 : largeurEcran - taille + taille / 8;
        ValueAnimator a = ValueAnimator.ofInt(lp.x, cible);
        a.setDuration(380);
        a.setInterpolator(new OvershootInterpolator(1.4f));
        a.addUpdateListener(an -> {
            if (cadre == null) return;
            lp.x = (int) an.getAnimatedValue();
            wm.updateViewLayout(cadre, lp);
        });
        a.start();
        LienService.prefs(contexte).edit().putInt("bulle-x", cible).putInt("bulle-y", lp.y).apply();
    }

    void cacher() {
        if (cadre == null) return;
        try {
            wm.removeView(cadre);
        } catch (Exception ignore) {
            // déjà retirée
        }
        vue.destroy();
        cadre = null;
        vue = null;
        prete = false;
    }

    /** Événement du lien (transfert, pressePapiers, nouvelle) : Nuage réagit dans sa bulle. */
    void evenement(String nom, JSONObject donnees) {
        js("bulle.evenement(" + JSONObject.quote(nom) + "," + donnees + ")");
    }

    private void js(String code) {
        if (vue != null && prete) vue.evaluateJavascript(code, null);
    }
}

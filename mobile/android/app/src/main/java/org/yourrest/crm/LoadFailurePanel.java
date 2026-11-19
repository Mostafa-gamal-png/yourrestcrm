package org.yourrest.crm;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** The panel over the WebView when the CRM's page cannot be shown (1.0.15): a native view, not a page, so it shows whatever the page and
 *  the engine can do. The reason in Arabic or English (LoadFailureRules' words), «إعادة المحاولة», «المتابعة رغم ذلك» for an old engine,
 *  and the facts for support (selectable, so they can be copied). While it shows, the page under it is hidden from accessibility services
 *  and gets no touch. */
final class LoadFailurePanel {
    interface Actions { void retry(); void continueAnyway(); }
    private static final int INK = 0xFF17211C, TEXT = 0xFF33413A, MUTED = 0xFF5B6660, ACCENT = 0xFF16815D, SURFACE = 0xFFFFFFFF, CODE = 0xFFF1F4F2;
    private final Activity activity;
    private final FrameLayout container;
    private final Actions actions;
    private View root;
    private LoadFailureRules.Kind kind;

    LoadFailurePanel(Activity activity, FrameLayout container, Actions actions) { this.activity = activity; this.container = container; this.actions = actions; }
    boolean showing() { return root != null; }
    /** The kind shown, or null. */
    LoadFailureRules.Kind kind() { return kind; }

    void show(LoadFailureRules.Kind shown, boolean english, String title, String message, String extra, String details, boolean offerContinue) {
        hide();
        kind = shown;
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(SURFACE);
        scroll.setClickable(true);
        scroll.setLayoutDirection(english ? View.LAYOUT_DIRECTION_LTR : View.LAYOUT_DIRECTION_RTL);
        FrameLayout frame = new FrameLayout(activity);
        final int widest = dp(560);
        LinearLayout box = new LinearLayout(activity) {
            @Override protected void onMeasure(int width, int height) {
                if (View.MeasureSpec.getSize(width) > widest) width = View.MeasureSpec.makeMeasureSpec(widest, View.MeasureSpec.EXACTLY);
                super.onMeasure(width, height);
            }
        };
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(24), dp(32), dp(24), dp(32));
        box.addView(text(title, 22, INK, true), wide(0));
        box.addView(text(message, 17, TEXT, false), wide(dp(12)));
        if (extra != null && !extra.isEmpty()) box.addView(text(extra, 15, TEXT, false), wide(dp(10)));
        LinearLayout buttons = new LinearLayout(activity);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button retry = new Button(activity);
        retry.setText(LoadFailureRules.retry(english));
        retry.setAllCaps(false);
        retry.setTextColor(SURFACE);
        retry.setBackgroundTintList(ColorStateList.valueOf(ACCENT));
        retry.setMinHeight(dp(48));
        retry.setOnClickListener(view -> actions.retry());
        buttons.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (offerContinue) {
            Button anyway = new Button(activity, null, android.R.attr.borderlessButtonStyle);
            anyway.setText(LoadFailureRules.continueAnyway(english));
            anyway.setAllCaps(false);
            anyway.setTextColor(ACCENT);
            anyway.setMinHeight(dp(48));
            anyway.setOnClickListener(view -> actions.continueAnyway());
            LinearLayout.LayoutParams spaced = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            spaced.setMarginStart(dp(8));
            buttons.addView(anyway, spaced);
        }
        box.addView(buttons, wide(dp(24)));
        box.addView(text(LoadFailureRules.detailsHeading(english), 14, MUTED, true), wide(dp(32)));
        TextView facts = text(details, 13, TEXT, false);
        facts.setTypeface(Typeface.MONOSPACE);
        facts.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        facts.setTextDirection(View.TEXT_DIRECTION_LTR);
        facts.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
        facts.setBackgroundColor(CODE);
        facts.setPadding(dp(12), dp(10), dp(12), dp(10));
        facts.setTextIsSelectable(true);
        box.addView(facts, wide(dp(8)));
        frame.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        scroll.addView(frame, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        for (int i = 0; i < container.getChildCount(); i++) container.getChildAt(i).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        container.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root = scroll;
        retry.requestFocus();
        scroll.announceForAccessibility(title + ". " + message);
    }
    void hide() {
        if (root != null) container.removeView(root);
        root = null; kind = null;
        for (int i = 0; i < container.getChildCount(); i++) container.getChildAt(i).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
    }
    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        view.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
        view.setLineSpacing(dp(3), 1f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }
    private LinearLayout.LayoutParams wide(int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = top;
        return params;
    }
    private int dp(int value) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics())); }

    // ---- The facts.
    /** The WebView provider's package (Google's, AOSP's, Huawei's com.huawei.webview...), or null when none is set (no WebView). */
    static PackageInfo provider() {
        try { return WebView.getCurrentWebViewPackage(); } catch (RuntimeException unavailable) { return null; }
    }
    /** The engine's user agent (it names «Chrome/<major>»): the WebView's own when there is one. */
    static String userAgent(Context context, WebView web) {
        try { return web != null ? web.getSettings().getUserAgentString() : WebSettings.getDefaultUserAgent(context); }
        catch (RuntimeException unavailable) { return null; }
    }
    static LoadFailureRules.Facts facts(Context context, WebView web, String page) {
        LoadFailureRules.Facts facts = new LoadFailureRules.Facts();
        PackageInfo provider = provider();
        if (provider != null) { facts.webViewPackage = provider.packageName; facts.webViewVersion = provider.versionName; }
        facts.chromium = LoadFailureRules.chromiumMajor(userAgent(context, web), facts.webViewVersion);
        facts.androidRelease = Build.VERSION.RELEASE;
        facts.sdk = Build.VERSION.SDK_INT;
        facts.manufacturer = Build.MANUFACTURER;
        facts.model = Build.MODEL;
        try {
            PackageInfo app = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            facts.appVersion = app.versionName;
            facts.appCode = NativeAppUpdater.versionCode(app);
        } catch (Exception unavailable) { facts.appVersion = null; }
        facts.page = page;
        ZoneId zone;
        try { zone = ZoneId.systemDefault(); } catch (RuntimeException unknown) { zone = ZoneOffset.UTC; }
        facts.deviceTime = LoadFailureRules.deviceTime(System.currentTimeMillis(), zone);
        return facts;
    }
}

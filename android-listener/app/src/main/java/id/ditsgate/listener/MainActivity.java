package id.ditsgate.listener;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.graphics.Typeface;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Local-only pairing UI. The Android OS owns the Notification Access consent screen. */
public final class MainActivity extends Activity {
    private EditText endpoint, sourcePackage, token;
    private TextView status;
    private ListenerSettings config;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        config = new ListenerSettings(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(padding, padding, padding, padding);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
        TextView heading = new TextView(this);
        heading.setText("DitsGate Listener · lokal"); heading.setTextSize(22); heading.setTypeface(null, Typeface.BOLD);
        root.addView(heading);
        addText(root, "Hanya kirim sinyal notifikasi dari aplikasi yang Anda pilih. Tidak menghubungkan Shopee Partner dan tidak menandai pembayaran lunas.");
        endpoint = field(root, "URL lengkap endpoint /api/v1/mutations/ingest", config.endpoint(), false);
        sourcePackage = field(root, "Package aplikasi sumber (contoh: com.gojek.gopaymerchant)", config.sourcePackage(), false);
        token = field(root, "Token perangkat dt_... (hanya ditampilkan sekali di dashboard)", "", true);
        Button save = button(root, "Simpan & aktifkan", () -> {
            String url = endpoint.getText().toString().trim();
            String pkg = sourcePackage.getText().toString().trim();
            String key = token.getText().toString().trim();
            if (!SignalFormatter.validEndpoint(url)) { status.setText("URL harus HTTPS dengan path /api/v1/mutations/ingest; HTTP hanya 127.0.0.1 untuk debug USB."); return; }
            if (SignalFormatter.payload(pkg, pkg, "check", "check") == null) { status.setText("Package aplikasi tidak valid."); return; }
            if (!key.matches("dt_[A-Za-z0-9_-]{32,128}")) { status.setText("Token perangkat tidak valid; pasangkan ulang di dashboard."); return; }
            try {
                config.configure(url, pkg, key);
                token.setText("");
                refresh();
            } catch (Exception e) { token.setText(""); status.setText("Penyimpanan token gagal; coba lagi."); }
        });
        button(root, "Buka izin akses notifikasi Android", () -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        button(root, "Nonaktifkan & hapus token lokal", () -> { config.disable(); token.setText(""); refresh(); });
        status = addText(root, "");
        addText(root, "Perangkat fisik lokal: adb reverse tcp:5180 tcp:5180, lalu gunakan http://127.0.0.1:5180/api/v1/mutations/ingest. Untuk perangkat tanpa USB gunakan HTTPS dengan backend yang Anda kendalikan. Notifikasi yang gagal dikirim tidak diulang otomatis.");
        save.setEnabled(true);
        refresh();
    }

    @Override protected void onResume() { super.onResume(); if (status != null) refresh(); }
    private void refresh() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        String component = new ComponentName(this, NotificationReceiver.class).flattenToString();
        boolean access = enabled != null && java.util.Arrays.asList(enabled.split(":")).contains(component);
        String last = getSharedPreferences("listener", MODE_PRIVATE).getString("last_status", "Belum ada pengiriman");
        status.setText("Listener: " + (config.enabled() ? "aktif di app" : "nonaktif") + " · izin Android: " + (access ? "diberikan" : "belum diberikan") + "\nPengiriman terakhir: " + last);
    }
    private TextView addText(LinearLayout root, String value) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(15);
        view.setPadding(0, 12, 0, 12); root.addView(view); return view;
    }
    private EditText field(LinearLayout root, String hint, String initial, boolean secret) {
        EditText view = new EditText(this);
        view.setSingleLine(true); view.setHint(hint); view.setText(initial);
        if (secret) view.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(view); return view;
    }
    private Button button(LinearLayout root, String text, Runnable click) {
        Button view = new Button(this); view.setText(text); view.setOnClickListener(v -> click.run()); root.addView(view); return view;
    }
}

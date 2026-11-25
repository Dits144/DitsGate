package id.ditsgate.listener;

import android.app.Notification;
import android.content.SharedPreferences;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Receives notifications only after the owner explicitly grants Notification Access. */
public final class NotificationReceiver extends NotificationListenerService {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override public void onNotificationPosted(StatusBarNotification item) {
        ListenerSettings settings = new ListenerSettings(this);
        if (!settings.enabled() || !item.getPackageName().equals(settings.sourcePackage())) return;
        Notification notification = item.getNotification();
        if (notification == null || notification.extras == null) return;
        CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        String payload = SignalFormatter.payload(item.getPackageName(), settings.sourcePackage(),
            title == null ? null : title.toString(), text == null ? null : text.toString());
        if (payload == null) return;
        // Updated notifications can retain their key and post time while changing content.
        String eventId = SignalFormatter.eventId(item.getKey(), item.getPostTime(), payload);
        String endpoint = settings.endpoint();
        worker.execute(() -> {
            try {
                // Re-read credentials on the worker so a disabled/revoked device does not send queued jobs.
                if (!settings.enabled() || !item.getPackageName().equals(settings.sourcePackage())) return;
                String token = settings.token();
                if (token == null) return;
                int code = SignalSender.send(endpoint, token, eventId, payload);
                report(code == 202 || code == 200 ? "Sinyal diterima server" : "Server menolak sinyal (HTTP " + code + ")");
            } catch (IOException | RuntimeException e) {
                report("Pengiriman gagal; notifikasi ini tidak diulang otomatis");
            } catch (Exception e) {
                report("Token tidak dapat dibuka; pasangkan ulang perangkat");
            }
        });
    }

    private void report(String status) {
        SharedPreferences prefs = getSharedPreferences("listener", MODE_PRIVATE);
        prefs.edit().putString("last_status", status).putLong("last_attempt", System.currentTimeMillis()).apply();
    }

    @Override public void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }
}

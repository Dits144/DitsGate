package id.ditsgate.listener;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Synchronous sender; caller must run on a worker thread. Never logs token or notification. */
public final class SignalSender {
    private SignalSender() { }
    public static int send(String endpoint, String token, String eventId, String payload) throws IOException {
        if (!SignalFormatter.validEndpoint(endpoint)) throw new IllegalArgumentException("Endpoint tidak aman");
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");  // Never forward credentials across redirects.
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(8_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("X-Device-Token", token);
            connection.setRequestProperty("X-Event-Id", eventId);
            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
            try (var output = connection.getOutputStream()) { output.write(bytes); }
            int status = connection.getResponseCode();
            var response = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (response != null) response.close();
            return status;
        } finally { connection.disconnect(); }
    }
}

package id.ditsgate.listener;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/** Pure protocol formatting shared by Android and JVM contract tests. */
public final class SignalFormatter {
    private SignalFormatter() { }

    public static boolean validEndpoint(String input) {
        try {
            if (input == null || !input.equals(input.trim())) return false;
            URI uri = new URI(input);
            String host = uri.getHost();
            return host != null && uri.getUserInfo() == null && uri.getQuery() == null
                && uri.getFragment() == null && "/api/v1/mutations/ingest".equals(uri.getRawPath())
                && ("https".equalsIgnoreCase(uri.getScheme())
                || ("http".equalsIgnoreCase(uri.getScheme()) && ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host))));
        } catch (Exception ignored) { return false; }
    }

    public static String payload(String packageName, String allowedPackage, String title, String text) {
        if (packageName == null || allowedPackage == null || !packageName.equals(allowedPackage)
            || !packageName.matches("([a-z][a-z0-9_]*\\.)+[a-z][a-z0-9_]*") || packageName.length() > 160
            || title == null || title.trim().isEmpty() || title.length() > 200
            || text == null || text.trim().isEmpty() || text.length() > 4096) return null;
        return "{\"source_app\":\"" + escape(packageName) + "\",\"title\":\"" + escape(title)
            + "\",\"text\":\"" + escape(text) + "\"}";
    }

    public static String eventId(String notificationKey, long postedAt) {
        return eventId(notificationKey, postedAt, "");
    }
    public static String eventId(String notificationKey, long postedAt, String payload) {
        String input = notificationKey + "|" + postedAt + "|" + payload;
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static String escape(String value) {
        StringBuilder result = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': result.append("\\\""); break;
                case '\\': result.append("\\\\"); break;
                case '\n': result.append("\\n"); break;
                case '\r': result.append("\\r"); break;
                case '\t': result.append("\\t"); break;
                default:
                    if (c < 0x20) result.append(String.format(Locale.ROOT, "\\u%04x", (int)c));
                    else result.append(c);
            }
        }
        return result.toString();
    }
}

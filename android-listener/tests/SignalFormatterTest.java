package id.ditsgate.listener;

public final class SignalFormatterTest {
    public static void main(String[] args) {
        String event = SignalFormatter.eventId("com.gojek.gopaymerchant|42", 1700000000123L);
        eq(event, SignalFormatter.eventId("com.gojek.gopaymerchant|42", 1700000000123L));
        if (!event.matches("[a-f0-9]{64}")) throw new AssertionError("unstable event id");
        if (event.equals(SignalFormatter.eventId("com.gojek.gopaymerchant|42", 1700000000124L))) throw new AssertionError("different post time collided");
        String firstContent = SignalFormatter.eventId("notification-key", 1700000000123L, "{\"text\":\"Rp 100\"}");
        eq(firstContent, SignalFormatter.eventId("notification-key", 1700000000123L, "{\"text\":\"Rp 100\"}"));
        if (firstContent.equals(SignalFormatter.eventId("notification-key", 1700000000123L, "{\"text\":\"Rp 200\"}"))) throw new AssertionError("notification update must have new event id");
        if (!firstContent.matches("[a-f0-9]{64}")) throw new AssertionError("invalid content event id");
        eq(null, SignalFormatter.payload("com.other.app", "com.gojek.gopaymerchant", "Paid", "Rp 100"));
        eq(null, SignalFormatter.payload("com.gojek.gopaymerchant", "com.gojek.gopaymerchant", "Paid", " "));
        eq(null, SignalFormatter.payload("com.gojek.gopaymerchant", "com.gojek.gopaymerchant", " ", "Rp 100"));
        eq("{\"source_app\":\"com.gojek.gopaymerchant\",\"title\":\"Pay \\\"ok\\\"\",\"text\":\"Rp 125.008\\npaid\"}", SignalFormatter.payload("com.gojek.gopaymerchant", "com.gojek.gopaymerchant", "Pay \"ok\"", "Rp 125.008\npaid"));
        eq(null, SignalFormatter.payload("com.gojek.gopaymerchant", "com.gojek.gopaymerchant", "Paid", "x".repeat(4097)));
        eq(null, SignalFormatter.payload("com.gojek.gopaymerchant", "com.gojek.gopaymerchant", "x".repeat(201), "Rp 100"));
        eq(null, SignalFormatter.payload("bad package", "bad package", "Paid", "Rp 100"));
        if (!SignalFormatter.validEndpoint("https://example.com/api/v1/mutations/ingest")) throw new AssertionError("https rejected");
        if (!SignalFormatter.validEndpoint("http://127.0.0.1:5180/api/v1/mutations/ingest")) throw new AssertionError("local dev rejected");
        if (SignalFormatter.validEndpoint("http://example.com/api/v1/mutations/ingest") || SignalFormatter.validEndpoint("https://example.com/other") || SignalFormatter.validEndpoint("http://localhost.evil.test/api/v1/mutations/ingest") || SignalFormatter.validEndpoint("https://user:pass@example.com/api/v1/mutations/ingest")) throw new AssertionError("unsafe endpoint accepted");
        System.out.println("SignalFormatterTest PASS");
    }
    private static void eq(Object expected, Object actual) { if (!java.util.Objects.equals(expected, actual)) throw new AssertionError("expected: " + expected + " actual: " + actual); }
}

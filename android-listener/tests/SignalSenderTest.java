package id.ditsgate.listener;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

public final class SignalSenderTest {
    public static void main(String[] args) throws Exception {
        AtomicInteger hits = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/mutations/ingest", exchange -> {
            hits.incrementAndGet();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (!"POST".equals(exchange.getRequestMethod()) || !"dt_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789".equals(exchange.getRequestHeaders().getFirst("X-Device-Token")) || !"event_1".equals(exchange.getRequestHeaders().getFirst("X-Event-Id")) || !"application/json".equals(exchange.getRequestHeaders().getFirst("Content-Type")) || !"{\"source_app\":\"com.gojek.gopaymerchant\",\"title\":\"Paid\",\"text\":\"Rp 100\"}".equals(body)) throw new AssertionError("unexpected request");
            exchange.sendResponseHeaders("event_1".equals(exchange.getRequestHeaders().getFirst("X-Event-Id")) ? 202 : 401, -1); exchange.close();
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/mutations/ingest";
            int status = SignalSender.send(url, "dt_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789", "event_1", "{\"source_app\":\"com.gojek.gopaymerchant\",\"title\":\"Paid\",\"text\":\"Rp 100\"}");
            if (status != 202 || hits.get() != 1) throw new AssertionError("signal not delivered");
            server.removeContext("/api/v1/mutations/ingest");
            server.createContext("/api/v1/mutations/ingest", exchange -> { exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(401, -1); exchange.close(); });
            if (SignalSender.send(url, "dt_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789", "event_1", "{}") != 401) throw new AssertionError("rejected token status hidden");
            try { SignalSender.send("http://example.com/api/v1/mutations/ingest", "token", "e", "{}"); throw new AssertionError("unsafe url accepted"); }
            catch (IllegalArgumentException expected) { /* expected */ }
            System.out.println("SignalSenderTest PASS");
        } finally { server.stop(0); }
    }
}

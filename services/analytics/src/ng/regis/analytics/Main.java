package ng.regis.analytics;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.Executors;

/** Regis analytics service (Java). Loopback only, shared-secret protected. Needs nothing but the JDK. */
public final class Main {
    private static final int MAX_BODY = 8 * 1024 * 1024;

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(env("ANALYTICS_PORT", "8102"));
        String token = env("INTERNAL_TOKEN", "");
        boolean prod = "production".equals(env("APP_ENV", "development"));
        if (prod && token.length() < 32) throw new IllegalStateException("INTERNAL_TOKEN must be 32+ characters in production");
        if (token.isEmpty()) token = "dev-internal-token-change-me-0000000000";
        final byte[] secret = token.getBytes(StandardCharsets.UTF_8);

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/healthz", ex -> send(ex, 200, "text/plain", "ok"));
        server.createContext("/internal/report", ex -> {
            try {
                if (!"POST".equals(ex.getRequestMethod())) { send(ex, 405, "application/json", "{\"error\":\"method\"}"); return; }
                String given = ex.getRequestHeaders().getFirst("X-Internal-Token");
                if (given == null || !MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), secret)) {
                    send(ex, 401, "application/json", "{\"error\":\"unauthorized\"}");
                    return;
                }
                String tz = queryParam(ex.getRequestURI().getRawQuery(), "tz", "Africa/Lagos");
                ZoneId zone;
                try { zone = ZoneId.of(tz); } catch (DateTimeException e) { send(ex, 422, "application/json", "{\"error\":\"bad tz\"}"); return; }
                String body = readBody(ex.getRequestBody());
                TsvParser feed = TsvParser.parse(body);
                Report r = Report.build(feed.orders, feed.items, zone, Instant.now(), 12, 12);
                send(ex, 200, "application/json", r.toJson());
            } catch (TooLarge e) {
                send(ex, 413, "application/json", "{\"error\":\"too large\"}");
            } catch (RuntimeException e) {
                System.err.println("analytics error: " + e);
                send(ex, 500, "application/json", "{\"error\":\"internal\"}");
            }
        });
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("analytics listening on http://127.0.0.1:" + port);
    }

    static final class TooLarge extends RuntimeException {}

    static String readBody(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > MAX_BODY) throw new TooLarge();
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    static String queryParam(String rawQuery, String key, String fallback) {
        if (rawQuery == null) return fallback;
        for (String pair : rawQuery.split("&")) {
            int i = pair.indexOf('=');
            if (i > 0 && pair.substring(0, i).equals(key)) {
                return java.net.URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8);
            }
        }
        return fallback;
    }

    static void send(HttpExchange ex, int code, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        try (var os = ex.getResponseBody()) { os.write(bytes); }
    }

    private static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }
}

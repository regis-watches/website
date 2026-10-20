package ng.regis.analytics;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Parses the tab-separated feed sent by the core service. Bad lines are skipped, never trusted. */
public final class TsvParser {
    public final List<Report.Order> orders = new ArrayList<>();
    public final List<Report.Item> items = new ArrayList<>();
    public int skipped = 0;

    public static TsvParser parse(String body) {
        TsvParser p = new TsvParser();
        for (String line : body.split("\n")) {
            if (line.isBlank()) continue;
            String[] f = line.split("\t", -1);
            try {
                if (f[0].equals("O") && f.length == 6) {
                    long gross = nonNegative(f[3]);
                    long fee = nonNegative(f[4]);
                    long net = Long.parseLong(f[5].trim());
                    p.orders.add(new Report.Order(f[1], Instant.parse(f[2].trim()), gross, fee, net));
                } else if (f[0].equals("I") && f.length == 5) {
                    p.items.add(new Report.Item(f[1], f[2], nonNegative(f[3]), nonNegative(f[4])));
                } else {
                    p.skipped++;
                }
            } catch (RuntimeException e) {
                p.skipped++;
            }
        }
        return p;
    }

    private static long nonNegative(String s) {
        long v = Long.parseLong(s.trim());
        if (v < 0) throw new NumberFormatException("negative");
        return v;
    }
}

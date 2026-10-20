package ng.regis.analytics;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns paid-order records into the numbers the owner cares about: sales and revenue per week and per month.
 * All money is in kobo (long). Weeks start on Monday and everything is bucketed in the business time zone,
 * so a sale at 11:30pm in Lagos lands on the right day.
 */
public final class Report {

    public record Order(String ref, Instant paidAt, long gross, long fee, long net) {}

    public record Item(String ref, String name, long qty, long lineTotal) {}

    /** One bucket (a week or a month). */
    public static final class Bucket {
        public final String label;
        public final String start;
        public long orders, items, gross, fees, net;

        Bucket(String label, String start) {
            this.label = label;
            this.start = start;
        }

        void add(Order o, long itemCount) {
            orders += 1;
            items += itemCount;
            gross += o.gross();
            fees += o.fee();
            net += o.net();
        }
    }

    public record Top(String name, long units, long gross) {}

    public final List<Bucket> weekly = new ArrayList<>();
    public final List<Bucket> monthly = new ArrayList<>();
    public final List<Top> top = new ArrayList<>();
    public final Bucket total = new Bucket("all time", "");
    public Bucket today, thisWeek, thisMonth;

    public static Report build(List<Order> orders, List<Item> items, ZoneId zone, Instant now, int weeks, int months) {
        Report r = new Report();
        LocalDate todayDate = now.atZone(zone).toLocalDate();
        LocalDate thisMonday = todayDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        YearMonth thisMonthYm = YearMonth.from(todayDate);

        // Pre-create every bucket so quiet weeks show as zero instead of disappearing.
        Map<LocalDate, Bucket> weekMap = new LinkedHashMap<>();
        for (int i = weeks - 1; i >= 0; i--) {
            LocalDate monday = thisMonday.minusWeeks(i);
            Bucket b = new Bucket(isoLabel(monday), monday.toString());
            weekMap.put(monday, b);
            r.weekly.add(b);
        }
        Map<YearMonth, Bucket> monthMap = new LinkedHashMap<>();
        for (int i = months - 1; i >= 0; i--) {
            YearMonth ym = thisMonthYm.minusMonths(i);
            Bucket b = new Bucket(ym.toString(), ym.atDay(1).toString());
            monthMap.put(ym, b);
            r.monthly.add(b);
        }
        r.today = new Bucket("today", todayDate.toString());
        r.thisWeek = new Bucket("this week", thisMonday.toString());
        r.thisMonth = new Bucket("this month", thisMonthYm.atDay(1).toString());

        Map<String, Long> itemCount = new HashMap<>();
        for (Item it : items) itemCount.merge(it.ref(), it.qty(), Long::sum);

        for (Order o : orders) {
            long count = itemCount.getOrDefault(o.ref(), 0L);
            LocalDate d = o.paidAt().atZone(zone).toLocalDate();
            r.total.add(o, count);
            Bucket w = weekMap.get(d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)));
            if (w != null) w.add(o, count);
            Bucket m = monthMap.get(YearMonth.from(d));
            if (m != null) m.add(o, count);
            if (d.equals(todayDate)) r.today.add(o, count);
            if (!d.isBefore(thisMonday) && !d.isAfter(todayDate)) r.thisWeek.add(o, count);
            if (YearMonth.from(d).equals(thisMonthYm)) r.thisMonth.add(o, count);
        }

        Map<String, long[]> byName = new HashMap<>();
        for (Item it : items) {
            long[] acc = byName.computeIfAbsent(it.name(), k -> new long[2]);
            acc[0] += it.qty();
            acc[1] += it.lineTotal();
        }
        byName.entrySet().stream()
                .map(e -> new Top(e.getKey(), e.getValue()[0], e.getValue()[1]))
                .sorted(Comparator.comparingLong(Top::units).reversed().thenComparing(Comparator.comparingLong(Top::gross).reversed()))
                .limit(5)
                .forEach(r.top::add);
        return r;
    }

    private static String isoLabel(LocalDate monday) {
        java.time.temporal.WeekFields wf = java.time.temporal.WeekFields.ISO;
        return monday.get(wf.weekBasedYear()) + "-W" + String.format("%02d", monday.get(wf.weekOfWeekBasedYear()));
    }

    // ---------- JSON output (hand written: the JDK has no JSON writer) ----------
    public String toJson() {
        StringBuilder sb = new StringBuilder(4096);
        sb.append('{');
        sb.append("\"total\":").append(bucket(total)).append(',');
        sb.append("\"today\":").append(bucket(today)).append(',');
        sb.append("\"this_week\":").append(bucket(thisWeek)).append(',');
        sb.append("\"this_month\":").append(bucket(thisMonth)).append(',');
        sb.append("\"weekly\":").append(list(weekly)).append(',');
        sb.append("\"monthly\":").append(list(monthly)).append(',');
        sb.append("\"top\":[");
        for (int i = 0; i < top.size(); i++) {
            Top t = top.get(i);
            if (i > 0) sb.append(',');
            sb.append("{\"name\":").append(str(t.name())).append(",\"units\":").append(t.units())
              .append(",\"gross\":").append(t.gross()).append('}');
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String list(List<Bucket> bs) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < bs.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(bucket(bs.get(i)));
        }
        return sb.append(']').toString();
    }

    private static String bucket(Bucket b) {
        return "{\"label\":" + str(b.label) + ",\"start\":" + str(b.start) + ",\"orders\":" + b.orders
                + ",\"items\":" + b.items + ",\"gross\":" + b.gross + ",\"fees\":" + b.fees + ",\"net\":" + b.net + "}";
    }

    static String str(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }
}

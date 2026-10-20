package ng.regis.analytics;

import java.time.Instant;
import java.time.ZoneId;

/** No test framework needed: run with  java -cp out ng.regis.analytics.SelfTest */
public final class SelfTest {
    static int failures = 0;

    static void check(boolean ok, String what) {
        System.out.println((ok ? "  ok   " : "  FAIL ") + what);
        if (!ok) failures++;
    }

    public static void main(String[] args) {
        ZoneId lagos = ZoneId.of("Africa/Lagos");
        Instant now = Instant.parse("2026-10-01T12:00:00Z"); // a Thursday
        String feed = String.join("\n",
            "O\tRG-AAAA1111\t2026-10-01T10:00:00Z\t2000000\t20000\t1980000",   // this week, this month
            "I\tRG-AAAA1111\tSable Quartz\t1\t2000000",
            "O\tRG-BBBB2222\t2026-09-23T09:00:00Z\t38500000\t200000\t38300000",  // last week, last month
            "I\tRG-BBBB2222\tMeridian 38\t1\t38500000",
            "O\tRG-CCCC3333\t2026-09-30T23:30:00Z\t5000000\t75000\t4925000",     // 00:30 on Oct 1 in Lagos
            "I\tRG-CCCC3333\tSable Quartz\t2\t4000000",
            "I\tRG-CCCC3333\tDune\t1\t1000000",
            "garbage line", "O\tbad\tnot-a-date\t1\t1\t1", "");
        TsvParser p = TsvParser.parse(feed);
        check(p.orders.size() == 3 && p.items.size() == 4, "parses 3 orders and 4 items");
        check(p.skipped == 2, "skips malformed lines instead of failing");

        Report r = Report.build(p.orders, p.items, lagos, now, 12, 12);
        check(r.total.orders == 3, "3 orders in total");
        check(r.total.gross == 2000000 + 38500000 + 5000000, "gross is the sum of what customers paid");
        check(r.total.fees == 20000 + 200000 + 75000, "fees are summed");
        check(r.total.net == r.total.gross - r.total.fees, "net equals gross minus fees");
        check(r.thisMonth.orders == 2 && r.thisMonth.gross == 7000000, "this month holds two orders");
        check(r.today.orders == 2, "the 23:30 UTC sale counts as Oct 1 in Lagos (UTC+1)");
        check(r.weekly.size() == 12 && r.monthly.size() == 12, "12 weeks and 12 months, quiet ones are zero");
        check(r.weekly.get(11).orders == 2 && r.weekly.get(10).orders == 1, "week buckets: current 2, previous 1");
        check(r.top.get(0).name().equals("Sable Quartz") && r.top.get(0).units() == 3, "top seller is Sable Quartz with 3 units");
        check(r.toJson().startsWith("{\"total\":{\"label\":\"all time\""), "JSON output is well formed at the start");
        check(Report.str("a\"b\n").equals("\"a\\\"b\\n\""), "JSON strings are escaped");
        System.out.println(failures == 0 ? "ALL PASSED" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}

using System.Net;
using System.Text;
using System.Text.Json;

namespace Regis.Mailer;

public record Rendered(string Subject, string Html, string Text, string? ReplyTo = null, string? UnsubscribeUrl = null);

/// <summary>Every value is HTML-encoded before it touches a template. Links must be http(s).</summary>
public static class Templates
{
    // Two colours, plus two tints of them for hairlines and quiet text (email clients do not support rgba).
    private const string Ink = "#231F20", Paper = "#F7F5ED", Line = "#D1CEC8", Muted = "#6B6866";
    private static readonly HashSet<string> Kinds = new() { "order_confirmation", "order_status", "welcome", "campaign", "contact" };

    /// <summary>Absolute URL of the logo, set once at startup from SITE_URL.</summary>
    public static string LogoUrl { get; set; } = "";

    public static bool Known(string? kind) => kind is not null && Kinds.Contains(kind);

    public static Rendered Render(Message m)
    {
        var d = m.Data ?? new Dictionary<string, JsonElement>();
        switch (m.Kind)
        {
            case "order_confirmation": return OrderConfirmation(d);
            case "order_status": return OrderStatus(d);
            case "welcome": return Welcome(d);
            case "campaign": return Campaign(d);
            case "contact": return Contact(d);
            default: throw new InvalidOperationException("unknown kind");
        }
    }

    // ------------------------------------------------------------------ helpers
    private static string S(Dictionary<string, JsonElement> d, string key) =>
        d.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static string E(string s) => WebUtility.HtmlEncode(s);

    /// <summary>Strip CR/LF so user-supplied text can never inject mail headers.</summary>
    private static string OneLine(string s) => s.Replace("\r", " ").Replace("\n", " ").Trim();

    private static string? SafeUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps) ? u.AbsoluteUri : null;

    private static string Paragraphs(string text) =>
        string.Join("", text.Replace("\r", "").Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(p => $"<p style=\"margin:0 0 16px;line-height:1.6\">{E(p.Trim()).Replace("\n", "<br>")}</p>"));

    private static string Button(string label, string? url) => url is null ? "" :
        $"<p style=\"margin:28px 0 8px\"><a href=\"{E(url)}\" style=\"background:{Ink};color:{Paper};padding:14px 28px;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;letter-spacing:.06em;display:inline-block\">{E(label)}</a></p>";

    private static string Wrap(string preheader, string headline, string bodyHtml, string footerHtml)
    {
        var sb = new StringBuilder();
        sb.Append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>");
        sb.Append($"<body style=\"margin:0;background:{Paper};padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:{Ink}\">");
        sb.Append($"<span style=\"display:none;max-height:0;overflow:hidden\">{E(preheader)}</span>");
        sb.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\">");
        sb.Append($"<table role=\"presentation\" width=\"560\" style=\"max-width:100%;background:{Paper};border:1px solid {Ink}\" cellpadding=\"0\" cellspacing=\"0\">");
        sb.Append($"<tr><td style=\"background:{Ink};padding:22px 32px;color:{Paper}\"><img src=\"{LogoUrl}\" width=\"44\" height=\"44\" alt=\"\" style=\"vertical-align:middle;border-radius:50%;margin-right:12px\"><span style=\"font-size:28px;vertical-align:middle\">Regis</span>");
        sb.Append("<span style=\"float:right;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;padding-top:14px\">Time, by appointment.</span></td></tr>");
        sb.Append($"<tr><td style=\"padding:36px 32px 12px\"><h1 style=\"font-weight:400;font-size:30px;line-height:1.15;margin:0 0 20px\">{E(headline)}</h1>{bodyHtml}</td></tr>");
        sb.Append($"<tr><td style=\"padding:20px 32px 32px;font-family:Arial,sans-serif;font-size:12px;color:{Muted};border-top:1px solid {Line}\">{footerHtml}</td></tr>");
        sb.Append("</table></td></tr></table></body></html>");
        return sb.ToString();
    }

    private static string DefaultFooter => "You are receiving this because of an order or request you made at Regis.";

    private static string UnsubFooter(string? url) => url is null ? DefaultFooter :
        $"You are receiving this because you joined the Regis list. <a href=\"{E(url)}\" style=\"color:{Ink}\">Unsubscribe in one click</a>.";

    // ------------------------------------------------------------------ templates
    private static Rendered OrderConfirmation(Dictionary<string, JsonElement> d)
    {
        var name = S(d, "name"); var order = S(d, "order_ref"); var total = S(d, "total"); var track = SafeUrl(S(d, "track_url"));
        var rows = new StringBuilder(); var text = new StringBuilder();
        if (d.TryGetValue("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var it in items.EnumerateArray())
            {
                if (it.ValueKind != JsonValueKind.Object) continue;
                string P(string k) => it.TryGetProperty(k, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString()) : "";
                rows.Append($"<tr><td style=\"padding:10px 0;border-bottom:1px solid {Line}\">{E(P("name"))} <span style=\"color:{Muted}\">x {E(P("qty"))}</span></td>");
                rows.Append($"<td align=\"right\" style=\"padding:10px 0;border-bottom:1px solid {Line}\">{E(P("price"))}</td></tr>");
                text.AppendLine($"- {P("name")} x {P("qty")}: {P("price")}");
            }
        }
        var body = $"<p style=\"margin:0 0 16px;line-height:1.6\">Thank you, {E(name)}. Your payment went through and we are preparing your order <strong>{E(order)}</strong>.</p>"
                 + $"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:15px\">{rows}"
                 + $"<tr><td style=\"padding:14px 0;font-weight:bold\">Total paid</td><td align=\"right\" style=\"padding:14px 0;font-weight:bold\">{E(total)}</td></tr></table>"
                 + "<p style=\"margin:16px 0 0;line-height:1.6\">Delivery is insured and complimentary. We will email you again when your watch is out for delivery.</p>"
                 + Button("Track your order", track);
        var plain = $"Thank you, {name}. Your payment went through for order {order}.\n\n{text}\nTotal paid: {total}\n\nTrack: {track}\n";
        return new Rendered(OneLine($"Your Regis order {order} is confirmed"), Wrap($"Order {order} confirmed", "Your order is confirmed.", body, DefaultFooter), plain);
    }

    private static Rendered OrderStatus(Dictionary<string, JsonElement> d)
    {
        var name = S(d, "name"); var order = S(d, "order_ref"); var label = S(d, "status_label"); var msg = S(d, "message"); var track = SafeUrl(S(d, "track_url"));
        var body = $"<p style=\"margin:0 0 16px;line-height:1.6\">Hello {E(name)}, your order <strong>{E(order)}</strong> is now <strong>{E(label)}</strong>.</p>"
                 + $"<p style=\"margin:0 0 16px;line-height:1.6\">{E(msg)}</p>" + Button("See order status", track);
        var plain = $"Hello {name}, your order {order} is now {label}.\n{msg}\n\n{track}\n";
        return new Rendered(OneLine($"{label}: order {order}"), Wrap($"{label}: order {order}", label + ".", body, DefaultFooter), plain);
    }

    private static Rendered Welcome(Dictionary<string, JsonElement> d)
    {
        var unsub = SafeUrl(S(d, "unsubscribe_url"));
        var body = "<p style=\"margin:0 0 16px;line-height:1.6\">Thank you for joining. We write rarely: new pieces, restocks, and the occasional note about how to look after a watch.</p>"
                 + "<p style=\"margin:0;line-height:1.6\">Nothing else, and never anything you did not ask for.</p>";
        return new Rendered("You are on the Regis list", Wrap("You are on the list", "You are on the list.", body, UnsubFooter(unsub)),
            $"Thank you for joining the Regis list. We write rarely.\n\nUnsubscribe: {unsub}\n", null, unsub);
    }

    private static Rendered Campaign(Dictionary<string, JsonElement> d)
    {
        var unsub = SafeUrl(S(d, "unsubscribe_url")); var cta = SafeUrl(S(d, "cta_url"));
        var body = Paragraphs(S(d, "body")) + Button(S(d, "cta_label"), cta);
        var plain = $"{S(d, "headline")}\n\n{S(d, "body")}\n\n{(cta is null ? "" : cta + "\n\n")}Unsubscribe: {unsub}\n";
        return new Rendered(OneLine(S(d, "subject")), Wrap(S(d, "headline"), S(d, "headline"), body, UnsubFooter(unsub)), plain, null, unsub);
    }

    private static Rendered Contact(Dictionary<string, JsonElement> d)
    {
        var from = S(d, "from_name"); var email = S(d, "from_email"); var msg = S(d, "message");
        var body = $"<p style=\"margin:0 0 8px;line-height:1.6\"><strong>{E(from)}</strong> ({E(email)}) wrote:</p>" + Paragraphs(msg)
                 + "<p style=\"margin:16px 0 0;font-family:Arial,sans-serif;font-size:13px;color:{Muted}\">Reply to this email to answer them directly.</p>";
        var replyTo = System.Net.Mail.MailAddress.TryCreate(email, out var a) ? a.Address : null;
        return new Rendered(OneLine($"Regis message from {from}"), Wrap("New message", "A new message.", body, "Sent from the Regis contact form."),
            $"{from} ({email}) wrote:\n\n{msg}\n", replyTo);
    }
}

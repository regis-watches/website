using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Regis.Mailer;

public record Message(string? Kind, string? To, Dictionary<string, JsonElement>? Data);

public record SendRequest(List<Message>? Messages);

public sealed class Settings
{
    public int Port { get; init; }
    public string Token { get; init; } = "";
    public string? SmtpHost { get; init; }
    public int SmtpPort { get; init; }
    public string? SmtpUser { get; init; }
    public string? SmtpPass { get; init; }
    public bool SmtpSsl { get; init; }
    public string From { get; init; } = "Regis <no-reply@localhost>";
    public string SiteUrl { get; init; } = "http://localhost:8000";
    public string OutboxDir { get; init; } = "";
    public TimeSpan Throttle { get; init; }

    public static Settings FromEnvironment()
    {
        static string? Env(string k) => string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(k)) ? null : Environment.GetEnvironmentVariable(k);

        var production = Env("APP_ENV") == "production";
        var token = Env("INTERNAL_TOKEN") ?? "";
        if (production && token.Length < 32) throw new InvalidOperationException("INTERNAL_TOKEN must be 32+ characters in production");
        if (token.Length == 0) token = "dev-internal-token-change-me-0000000000";
        if (production && Env("SMTP_HOST") is null) throw new InvalidOperationException("SMTP_HOST is required in production");

        return new Settings
        {
            Port = int.TryParse(Env("MAILER_PORT"), out var p) ? p : 8103,
            Token = token,
            SmtpHost = Env("SMTP_HOST"),
            SmtpPort = int.TryParse(Env("SMTP_PORT"), out var sp) ? sp : 587,
            SmtpUser = Env("SMTP_USER"),
            SmtpPass = Env("SMTP_PASS"),
            SmtpSsl = (Env("SMTP_SSL") ?? "true") != "false",
            SiteUrl = (Env("SITE_URL") ?? "http://localhost:8000").TrimEnd('/'),
            From = Env("MAIL_FROM") ?? "Regis <no-reply@localhost>",
            OutboxDir = Env("OUTBOX_DIR") ?? Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data", "outbox"),
            Throttle = TimeSpan.FromMilliseconds(int.TryParse(Env("MAIL_THROTTLE_MS"), out var t) ? t : 150),
        };
    }
}

public static class Auth
{
    public static bool IsAuthorized(HttpContext ctx, string token)
    {
        var given = Encoding.UTF8.GetBytes(ctx.Request.Headers["X-Internal-Token"].ToString());
        var expected = Encoding.UTF8.GetBytes(token);
        return given.Length == expected.Length && CryptographicOperations.FixedTimeEquals(given, expected);
    }
}

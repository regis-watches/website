using System.Net;
using System.Net.Mail;
using System.Threading.Channels;
using Regis.Mailer;

// Regis mailer (C#). Loopback only, shared-secret protected.
// Receives batches from the core service, renders branded emails, and sends them over SMTP in the background.
// With no SMTP_HOST set it writes each email to data/outbox so everything can be previewed offline.

var settings = Settings.FromEnvironment();
Templates.LogoUrl = $"{settings.SiteUrl}/logo-128.png";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o =>
{
    o.Listen(IPAddress.Loopback, settings.Port);
    o.Limits.MaxRequestBodySize = 10 * 1024 * 1024;
});
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(Channel.CreateBounded<Message>(new BoundedChannelOptions(10_000)
{
    FullMode = BoundedChannelFullMode.Wait,
}));
builder.Services.AddHostedService<MailWorker>();

var app = builder.Build();

app.MapGet("/healthz", () => Results.Text("ok"));

app.MapPost("/internal/send", async (HttpContext ctx, Settings s, Channel<Message> queue) =>
{
    if (!Auth.IsAuthorized(ctx, s.Token))
        return Results.Json(new { error = "unauthorized" }, statusCode: 401);

    SendRequest? body;
    try { body = await ctx.Request.ReadFromJsonAsync<SendRequest>(); }
    catch (System.Text.Json.JsonException) { return Results.Json(new { error = "bad json" }, statusCode: 400); }

    if (body?.Messages is null || body.Messages.Count == 0 || body.Messages.Count > 5000)
        return Results.Json(new { error = "between 1 and 5000 messages expected" }, statusCode: 422);

    var accepted = 0;
    foreach (var m in body.Messages)
    {
        if (!Templates.Known(m.Kind) || !MailAddress.TryCreate(m.To, out var addr) || addr.Address.Length > 254)
            continue; // skip anything we cannot render or address safely
        if (queue.Writer.TryWrite(m with { To = addr.Address })) accepted++;
    }
    return Results.Json(new { queued = accepted }, statusCode: 202);
});

app.Run();

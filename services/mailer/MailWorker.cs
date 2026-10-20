using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Channels;

namespace Regis.Mailer;

/// <summary>Drains the queue slowly and politely so a newsletter never trips the SMTP provider's limits.</summary>
public sealed class MailWorker : BackgroundService
{
    private readonly Channel<Message> _queue;
    private readonly Settings _s;
    private readonly ILogger<MailWorker> _log;

    public MailWorker(Channel<Message> queue, Settings s, ILogger<MailWorker> log)
    {
        _queue = queue;
        _s = s;
        _log = log;
        if (s.SmtpHost is null) _log.LogWarning("No SMTP_HOST set. Emails will be written to {Dir} instead of being sent.", Path.GetFullPath(s.OutboxDir));
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var m in _queue.Reader.ReadAllAsync(ct))
        {
            try { await DeliverAsync(m, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Could not deliver a '{Kind}' email", m.Kind);
            }
            await Task.Delay(_s.Throttle, ct);
        }
    }

    private async Task DeliverAsync(Message m, CancellationToken ct)
    {
        var mail = Templates.Render(m);

        if (_s.SmtpHost is null)
        {
            Directory.CreateDirectory(_s.OutboxDir);
            var safe = Regex.Replace(m.To ?? "unknown", "[^A-Za-z0-9@.\\-]", "_");
            var file = Path.Combine(_s.OutboxDir, $"{DateTime.UtcNow:yyyyMMdd-HHmmssfff}-{m.Kind}-{safe}.html");
            await File.WriteAllTextAsync(file, $"<!-- To: {WebUtility.HtmlEncode(m.To)} | Subject: {WebUtility.HtmlEncode(mail.Subject)} -->\n{mail.Html}", Encoding.UTF8, ct);
            _log.LogInformation("Outbox: {Kind} for {To} saved to {File}", m.Kind, m.To, file);
            return;
        }

        using var client = new SmtpClient(_s.SmtpHost, _s.SmtpPort) { EnableSsl = _s.SmtpSsl, Timeout = 20_000 };
        if (!string.IsNullOrEmpty(_s.SmtpUser)) client.Credentials = new NetworkCredential(_s.SmtpUser, _s.SmtpPass);

        using var msg = new MailMessage { From = new MailAddress(_s.From), Subject = mail.Subject, SubjectEncoding = Encoding.UTF8 };
        msg.To.Add(new MailAddress(m.To!));
        if (mail.ReplyTo is not null) msg.ReplyToList.Add(new MailAddress(mail.ReplyTo));
        if (mail.UnsubscribeUrl is not null)
        {
            msg.Headers.Add("List-Unsubscribe", $"<{mail.UnsubscribeUrl}>");
            msg.Headers.Add("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        }
        msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(mail.Text, Encoding.UTF8, "text/plain"));
        msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(mail.Html, Encoding.UTF8, "text/html"));
        await client.SendMailAsync(msg, ct);
        _log.LogInformation("Sent {Kind} to {To}", m.Kind, m.To);
    }
}

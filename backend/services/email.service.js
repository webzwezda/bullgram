import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Bullgram <noreply@bullgram.xyz>';

function renderEmailHtml({ amountTon, title, payUrl }) {
  const safeTitle = String(title || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<!DOCTYPE html>
<html lang="ru">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:32px 0; margin:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,.06);">
    <tr>
      <td style="padding:32px 32px 8px 32px;">
        <div style="font-size:11px; font-weight:900; letter-spacing:0.18em; text-transform:uppercase; color:#94a3b8;">Bullgram</div>
        <h1 style="margin:8px 0 0 0; font-size:24px; font-weight:900; color:#0f172a;">Счёт оплачен</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 0 32px;">
        <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#334155;">
          На ваш кошелёк поступила оплата в размере
          <strong style="color:#0f172a;">${amountTon} TON</strong>${safeTitle ? ` за «${safeTitle}»` : ''}.
        </p>
        <a href="${payUrl}" style="display:inline-block; padding:12px 24px; background:#0f172a; color:#ffffff; text-decoration:none; font-weight:700; border-radius:10px; font-size:14px;">
          Открыть счёт
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px 32px 32px;">
        <p style="margin:0; font-size:12px; color:#64748b; line-height:1.5;">
          Ссылка на счёт: <a href="${payUrl}" style="color:#64748b; word-break:break-all;">${payUrl}</a><br/>
          Это автоматическое уведомление, не отвечайте на него.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPaymentReceivedEmail({ to, invoiceId, amountTon, title, payUrl }) {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set, skipping payment email for', invoiceId);
    return;
  }
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `Счёт оплачен — ${amountTon} TON`,
      html: renderEmailHtml({ amountTon, title, payUrl })
    });
    if (error) {
      console.error('[email] sendPaymentReceivedEmail error for', invoiceId, ':', error);
      return;
    }
    console.log('[email] payment email sent to', to, 'id=', data?.id, 'invoice=', invoiceId);
  } catch (err) {
    console.error('[email] sendPaymentReceivedEmail failed for', invoiceId, ':', err.message || err);
  }
}

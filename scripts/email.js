/**
 * Transactional email via Resend (invite / temp password / automated reports).
 * Requires RESEND_API_KEY. Optional RESEND_FROM, APP_PUBLIC_URL.
 */
import { Resend } from 'resend';

let client = null;
let clientKey = null;

function resendApiKey() {
  return String(process.env.RESEND_API_KEY || '').trim();
}

function getClient() {
  const key = resendApiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new Resend(key);
    clientKey = key;
  }
  return client;
}

export function isEmailConfigured() {
  return !!resendApiKey();
}

function loginUrl() {
  const base = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/#/login`;
}

function appReportsUrl() {
  const base = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/#/reports`;
}

function fromAddress() {
  return process.env.RESEND_FROM || 'HBM Fleet <noreply@hbm.bestpracticesltd.com.ng>';
}

/**
 * Send account invite with temporary password.
 * @returns {{ sent: boolean, error?: string, id?: string }}
 */
export async function sendAccountInviteEmail({ to, name, password, roleName }) {
  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const url = loginUrl();
  const safeName = name || 'there';
  const role = roleName || 'your assigned role';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: [to],
      subject: 'Your HBM Fleet Intelligence account',
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:520px">
          <h2 style="margin:0 0 12px;font-size:18px">Welcome to HBM Fleet Intelligence</h2>
          <p style="margin:0 0 12px">Hi ${escapeHtml(safeName)},</p>
          <p style="margin:0 0 12px">
            An administrator created your account (${escapeHtml(role)}).
            Sign in with the temporary password below, then you will be asked to set a new one.
          </p>
          <p style="margin:0 0 8px"><strong>Email:</strong> ${escapeHtml(to)}</p>
          <p style="margin:0 0 16px"><strong>Temporary password:</strong>
            <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(password)}</code>
          </p>
          <p style="margin:0 0 20px">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:#0078D4;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">
              Sign in
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#64748b">
            If you did not expect this email, contact your fleet administrator.
          </p>
        </div>
      `,
      text: [
        `Hi ${safeName},`,
        '',
        `An administrator created your HBM Fleet Intelligence account (${role}).`,
        `Email: ${to}`,
        `Temporary password: ${password}`,
        `Sign in: ${url}`,
        '',
        'You will be asked to set a new password after signing in.',
      ].join('\n'),
    });

    if (error) {
      console.warn('Resend invite failed:', error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.warn('Resend invite error:', e?.message || e);
    return { sent: false, error: e?.message || 'Email send failed' };
  }
}

/**
 * Confirm first password change after admin-provisioned temp password.
 * @returns {{ sent: boolean, error?: string, id?: string }}
 */
export async function sendPasswordChangedConfirmationEmail({ to, name }) {
  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const url = loginUrl();
  const safeName = name || 'there';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: [to],
      subject: 'Password updated — HBM Fleet Intelligence',
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:520px">
          <h2 style="margin:0 0 12px;font-size:18px">Password changed successfully</h2>
          <p style="margin:0 0 12px">Hi ${escapeHtml(safeName)},</p>
          <p style="margin:0 0 12px">
            Your HBM Fleet Intelligence password was updated and you are signed in.
            Use your new password for future sign-ins.
          </p>
          <p style="margin:0 0 20px">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:#0078D4;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">
              Open dashboard
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#64748b">
            If you did not change your password, contact your fleet administrator immediately.
          </p>
        </div>
      `,
      text: [
        `Hi ${safeName},`,
        '',
        'Your HBM Fleet Intelligence password was updated and you are signed in.',
        `Open dashboard: ${url}`,
        '',
        'If you did not change your password, contact your fleet administrator immediately.',
      ].join('\n'),
    });

    if (error) {
      console.warn('Resend password-confirm failed:', error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.warn('Resend password-confirm error:', e?.message || e);
    return { sent: false, error: e?.message || 'Email send failed' };
  }
}

/**
 * Calm Resend-style automated report email.
 * @returns {{ sent: boolean, error?: string, id?: string }}
 */
export async function sendAutomatedReportEmail({
  to,
  frequency,
  packs,
  payload,
  test = false,
}) {
  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const freqLabel = frequency === 'hourly'
    ? 'Hourly'
    : frequency === 'daily'
      ? 'Daily'
      : frequency === 'monthly'
        ? 'Monthly'
        : 'Weekly';
  const periodLabel = formatPeriod(payload?.from, payload?.to);
  const subject = `${test ? '[Test] ' : ''}${freqLabel} fleet report · HBM`;
  const reportsUrl = appReportsUrl();

  const sectionHtml = (payload?.sections || []).map(section => `
    <div style="margin:0 0 28px">
      <div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#71717a;margin:0 0 10px">
        ${escapeHtml(section.title)}
      </div>
      ${section.total != null ? `
        <div style="font-size:32px;line-height:1.1;font-weight:600;color:#18181b;margin:0 0 14px">
          ${escapeHtml(String(section.total))}
          <span style="font-size:13px;font-weight:400;color:#71717a;margin-left:6px">total</span>
        </div>
      ` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${(section.rows || []).map((row, i) => `
          <tr>
            <td style="padding:10px 0;border-top:1px solid ${i === 0 ? '#e4e4e7' : '#f4f4f5'};font-size:14px;color:#3f3f46">
              ${escapeHtml(row.label)}
            </td>
            <td align="right" style="padding:10px 0;border-top:1px solid ${i === 0 ? '#e4e4e7' : '#f4f4f5'};font-size:14px;font-weight:600;color:#18181b">
              ${escapeHtml(String(row.count))}
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const html = `
    <div style="background:#fafafa;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden">
        <div style="padding:28px 28px 8px">
          <div style="font-size:12px;color:#a1a1aa;margin:0 0 18px">HBM Fleet Intelligence</div>
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#18181b;letter-spacing:-0.02em">
            Your ${escapeHtml(freqLabel.toLowerCase())} report is ready
          </h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#71717a">
            A quiet snapshot of ${escapeHtml(periodLabel)}. No action needed unless something looks off.
          </p>
        </div>
        <div style="padding:0 28px 8px">
          ${sectionHtml || '<p style="color:#71717a;font-size:14px">No pack data available for this period.</p>'}
        </div>
        <div style="padding:8px 28px 28px">
          <a href="${escapeHtml(reportsUrl)}"
             style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:600">
            Open Reports
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa">
            Sent by Automate · ${escapeHtml((packs || []).join(', ') || 'report')}
            ${test ? ' · test send' : ''}
          </p>
        </div>
      </div>
    </div>
  `;

  const textLines = [
    `Your ${freqLabel.toLowerCase()} HBM fleet report`,
    `Period: ${periodLabel}`,
    '',
    ...(payload?.sections || []).flatMap(s => [
      s.title,
      ...(s.rows || []).map(r => `  ${r.label}: ${r.count}`),
      '',
    ]),
    `Open Reports: ${reportsUrl}`,
  ];

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: recipients,
      subject,
      html,
      text: textLines.join('\n'),
    });
    if (error) {
      console.warn('Resend automate failed:', error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.warn('Resend automate error:', e?.message || e);
    return { sent: false, error: e?.message || 'Email send failed' };
  }
}

/**
 * Ad-hoc Reports export email with file attachment (CSV / Excel / PDF).
 * @returns {{ sent: boolean, error?: string, id?: string }}
 */
export async function sendReportExportEmail({
  to,
  filename,
  mime,
  contentBase64,
  reportTitle,
  meta,
  eventCount,
}) {
  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const title = reportTitle || 'Fleet report';
  const countLabel = eventCount != null ? `${eventCount} event${eventCount === 1 ? '' : 's'}` : 'filtered events';
  const reportsUrl = appReportsUrl();
  const subject = `${title} · HBM`;

  const html = `
    <div style="background:#fafafa;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden">
        <div style="padding:28px 28px 8px">
          <div style="font-size:12px;color:#a1a1aa;margin:0 0 18px">HBM Fleet Intelligence</div>
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#18181b;letter-spacing:-0.02em">
            Your report is attached
          </h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#71717a">
            ${escapeHtml(title)} · ${escapeHtml(countLabel)}.
            ${meta ? `<br/><span style="color:#a1a1aa">${escapeHtml(meta)}</span>` : ''}
          </p>
        </div>
        <div style="padding:8px 28px 28px">
          <a href="${escapeHtml(reportsUrl)}"
             style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:600">
            Open Reports
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa">
            Attachment: ${escapeHtml(filename || 'report')}
          </p>
        </div>
      </div>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: recipients,
      subject,
      html,
      text: [
        `Your HBM report is attached: ${filename || 'report'}`,
        title,
        meta || '',
        countLabel,
        `Open Reports: ${reportsUrl}`,
      ].filter(Boolean).join('\n'),
      attachments: [
        {
          filename: filename || 'report.csv',
          content: contentBase64,
          contentType: mime || undefined,
        },
      ],
    });
    if (error) {
      console.warn('Resend report export failed:', error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.warn('Resend report export error:', e?.message || e);
    return { sent: false, error: e?.message || 'Email send failed' };
  }
}

function formatPeriod(from, to) {
  try {
    const a = new Date(from);
    const b = new Date(to);
    const opts = { day: 'numeric', month: 'short' };
    return `${a.toLocaleDateString('en-GB', opts)} – ${b.toLocaleDateString('en-GB', opts)}`;
  } catch {
    return 'this period';
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function disciplinePlainLabel(band) {
  const map = {
    Green: 'On track',
    Amber: 'Needs coaching',
    Yellow: 'Suspension review',
    Red: 'Critical',
  };
  return map[band] || band || 'Needs coaching';
}

function coachingUrl(link) {
  const base = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  if (link?.startsWith('http')) return link;
  if (link?.startsWith('/#/')) return `${base}${link.slice(1)}`;
  if (link?.startsWith('/')) return `${base}/#${link}`;
  return `${base}/#/drivers/coaching`;
}

/**
 * Notify tagged dashboard users when a written warning is issued.
 * @returns {{ sent: boolean, error?: string, id?: string }}
 */
export async function sendDriverWarningEmail({
  to,
  recipientName,
  driverName,
  comment,
  disciplineBand,
  issuedByName,
  link,
}) {
  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const safeRecipient = recipientName || 'there';
  const band = disciplinePlainLabel(disciplineBand);
  const url = coachingUrl(link);

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: [to],
      subject: `Written warning · ${driverName} · Lafarge fleet`,
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:520px">
          <h2 style="margin:0 0 12px;font-size:18px">Driver written warning</h2>
          <p style="margin:0 0 12px">Hi ${escapeHtml(safeRecipient)},</p>
          <p style="margin:0 0 12px">
            <strong>${escapeHtml(issuedByName || 'A fleet manager')}</strong> issued a formal written warning for
            <strong>${escapeHtml(driverName)}</strong> (${escapeHtml(band)}).
          </p>
          <blockquote style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #f59e0b;border-radius:4px;color:#334155">
            ${escapeHtml(comment || '')}
          </blockquote>
          <p style="margin:0 0 20px">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:#0078D4;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">
              Open Coaching
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#64748b">
            You were tagged on this warning in HBM Fleet Intelligence.
          </p>
        </div>
      `,
      text: [
        `Hi ${safeRecipient},`,
        '',
        `${issuedByName || 'A fleet manager'} issued a written warning for ${driverName} (${band}).`,
        '',
        comment || '',
        '',
        `Open Coaching: ${url}`,
      ].join('\n'),
    });

    if (error) {
      console.warn('Resend driver warning failed:', error);
      return { sent: false, error: error.message || String(error) };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.warn('Resend driver warning error:', e?.message || e);
    return { sent: false, error: e?.message || 'Email send failed' };
  }
}

// إشعارات بريدية (تقييم جديد + التقرير الأسبوعي + إعادة تعيين كلمة المرور).
// اختياري بالكامل: لو ما فيه RESEND_API_KEY بالإعدادات، ما يصير أي شي (بدون أي تكلفة أو خطأ).
// يستخدم Resend عبر REST API مباشرة (بدون SDK إضافي) — https://resend.com

const { env } = require("../config/env");

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail({ toEmail, subject, html }) {
  if (!env.resend.apiKey) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.resend.fromEmail, to: [toEmail], subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return true;
}

function wrapEmail(bodyHtml) {
  return `
    <div dir="ltr" style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; line-height: 1.7; color: #1a1a1a;">
      ${bodyHtml}
    </div>
  `;
}

async function notifyNewReviews({ toEmail, businessName, count }) {
  if (!env.resend.apiKey) return false;

  const subject = count === 1 ? "1 new review needs your reply on Sanad Review" : `${count} new reviews need your reply on Sanad Review`;

  const html = wrapEmail(`
    <h2>Hi ${escapeHtml(businessName)} 👋</h2>
    <p>You have <strong>${count}</strong> ${count === 1 ? "new review" : "new reviews"} on Google that need your review before publishing.</p>
    <p>A draft reply is ready for each one — just review it and hit publish.</p>
    <p><a href="${env.appBaseUrl || ""}/dashboard" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Open dashboard</a></p>
  `);

  return sendEmail({ toEmail, subject, html });
}

async function sendWeeklyDigest({ toEmail, subject, narrative }) {
  const html = wrapEmail(`
    <h2>📊 Your Weekly Digest</h2>
    <p style="white-space: pre-wrap;">${escapeHtml(narrative)}</p>
    <p><a href="${env.appBaseUrl || ""}/dashboard" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Open dashboard</a></p>
  `);

  return sendEmail({ toEmail, subject, html });
}

async function sendPasswordResetEmail({ toEmail, resetUrl }) {
  const html = wrapEmail(`
    <h2>Reset your password</h2>
    <p>We received a request to reset your Sanad Review password. This link expires in 1 hour.</p>
    <p><a href="${resetUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Reset password</a></p>
    <p style="color:#666;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
  `);

  return sendEmail({ toEmail, subject: "Reset your Sanad Review password", html });
}

module.exports = { notifyNewReviews, sendWeeklyDigest, sendPasswordResetEmail };

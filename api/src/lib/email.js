import axios from 'axios';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export async function sendOtpEmail(toEmail, code) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || 'VibeMeet';

    if (!apiKey || !senderEmail) {
        const err = new Error(
            'Email sending is not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL missing)'
        );
        err.status = 503;
        throw err;
    }

    const safeCode = escapeHtml(code);
    const safeEmail = escapeHtml(toEmail);

    const htmlContent = `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#FAF8F4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F4;">
<tr><td align="center" style="padding:48px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#FFFDF9;border:1px solid #C9BFA9;border-radius:4px;">
<tr><td style="padding:36px 32px;text-align:center;font-family:Georgia,serif;">
<p style="margin:0;font-size:28px;font-weight:700;color:#1B1611;">VibeMeet</p>
<p style="margin:6px 0 0;font-size:10px;font-weight:600;letter-spacing:2.5px;color:#8B7F6E;font-family:Arial,sans-serif;">A PHOTOGRAPHIC INDEX OF THE NIGHT</p>
<p style="margin:28px 0 0;font-size:24px;font-weight:600;color:#1B1611;">Your code to join</p>
<p style="margin:12px 0 0;font-size:16px;line-height:1.6;color:#4D4438;">Enter this code to finish creating your account for ${safeEmail}:</p>
<p style="margin:24px 0 0;font-size:36px;font-weight:700;letter-spacing:10px;color:#1B1611;font-family:Arial,sans-serif;">${safeCode}</p>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#8B7F6E;font-family:Arial,sans-serif;">This code expires in 30 minutes. You get 5 tries per code — after that we send you a fresh one.<br>If you did not ask to join VibeMeet, ignore this email.</p>
</td></tr>
</table>
<p style="margin:24px 0 0;font-size:12px;color:#A89A83;font-family:Arial,sans-serif;">Set in Fraunces &middot; Paper, ink and oxblood</p>
</td></tr>
</table>
</body></html>`;

    const textContent = `VibeMeet — your code to join\n\nEnter this code to finish creating your account for ${toEmail}:\n\n${code}\n\nThis code expires in 30 minutes. You get 5 tries per code — after that we send you a fresh one.\nIf you did not ask to join VibeMeet, ignore this email.`;

    try {
        const { data } = await axios.post(
            BREVO_URL,
            {
                sender: { name: senderName, email: senderEmail },
                to: [{ email: toEmail }],
                subject: `Your VibeMeet code is ${code}`,
                htmlContent,
                textContent,
            },
            {
                headers: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json',
                    accept: 'application/json',
                },
                timeout: 10000,
            }
        );
        return data;
    } catch (err) {
        const brevoMessage = err.response?.data?.message;
        const error = new Error(brevoMessage || 'Could not send verification email');
        error.status = 502;
        throw error;
    }
}

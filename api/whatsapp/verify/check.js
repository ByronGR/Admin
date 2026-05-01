const { normalizePhone } = require('../../../_twilio-whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!serviceSid || !accountSid || !authToken) {
    return res.status(500).json({ ok: false, error: 'Twilio Verify environment variables are not configured' });
  }
  const to = normalizePhone(req.body?.whatsapp_number || req.body?.phone || '');
  const code = String(req.body?.code || '').trim();
  if (!to || !code) return res.status(400).json({ ok: false, error: 'Phone and code are required' });
  const params = new URLSearchParams({ To: to, Code: code });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(response.status).json({ ok: false, error: result.message || 'WhatsApp verification check failed', details: result });
  return res.status(200).json({ ok: true, verified: result.status === 'approved', status: result.status, to });
};

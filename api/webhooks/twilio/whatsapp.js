const { normalizePhone, sanitizeMessage, validateTwilioSignature } = require('../../../_twilio-whatsapp');

function parseBody(req) {
  if (typeof req.body === 'string') return Object.fromEntries(new URLSearchParams(req.body));
  return req.body || {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const payload = parseBody(req);
  const signature = req.headers['x-twilio-signature'];
  const appBase = process.env.APP_BASE_URL || '';
  const webhookUrl = appBase ? `${appBase.replace(/\/$/, '')}/api/webhooks/twilio/whatsapp` : '';

  if (process.env.TWILIO_AUTH_TOKEN && webhookUrl && !validateTwilioSignature({ url: webhookUrl, params: payload, signature })) {
    return res.status(403).json({ ok: false, error: 'Invalid Twilio signature' });
  }

  const from = normalizePhone(String(payload.From || '').replace(/^whatsapp:/, ''));
  const to = normalizePhone(String(payload.To || '').replace(/^whatsapp:/, ''));
  const body = sanitizeMessage(payload.Body || '');
  const messageSid = payload.MessageSid || payload.SmsSid || '';
  const status = payload.MessageStatus || payload.SmsStatus || '';

  return res.status(200).json({
    ok: true,
    inbound: !!body,
    delivery_status_update: !!status && !body,
    message: {
      id: 'IN-' + (messageSid || Date.now()),
      twilio_message_sid: messageSid,
      direction: body ? 'inbound' : 'status',
      channel: 'whatsapp',
      from_number: from,
      to_number: to,
      message_body: body,
      delivery_status: status,
      created_at: new Date().toISOString()
    },
    note: 'Webhook received. Firestore persistence can be enabled once server Firebase credentials are added.'
  });
};

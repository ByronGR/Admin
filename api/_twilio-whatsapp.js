const crypto = require('crypto');

function sanitizeMessage(value = '') {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 1600);
}

function normalizePhone(value = '') {
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return '+' + raw.replace(/\D/g, '');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return '+57' + digits;
  if (digits.length === 12 && digits.startsWith('57')) return '+' + digits;
  return '+' + digits;
}

function whatsappAddress(value = '') {
  const phone = normalizePhone(value);
  return phone ? 'whatsapp:' + phone : '';
}

function assertCanMessage(candidate = {}) {
  const status = candidate.whatsapp_status || candidate.whatsappStatus || 'pending';
  if (!candidate.whatsapp_number && !candidate.whatsappNumber) throw new Error('Candidate is missing a WhatsApp number');
  if (candidate.whatsapp_consent === false || candidate.whatsappConsent === false) throw new Error('Candidate has not consented to WhatsApp communication');
  if (status === 'failed' || status === 'needs_new_number') throw new Error('This number could not be reached on WhatsApp. Ask the candidate for another WhatsApp number.');
  if (status === 'opted_out') throw new Error('This candidate has opted out of WhatsApp communication.');
}

async function sendTwilioWhatsApp({ to, body, statusCallback }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error('Twilio WhatsApp environment variables are not configured');
  const params = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : whatsappAddress(from),
    To: whatsappAddress(to),
    Body: body
  });
  if (statusCallback) params.set('StatusCallback', statusCallback);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'Twilio failed to send WhatsApp message');
  return result;
}

function validateTwilioSignature({ url, params, signature }) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature || !url) return false;
  const sorted = Object.keys(params || {}).sort().map(key => key + params[key]).join('');
  const expected = crypto.createHmac('sha1', token).update(url + sorted).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch(e) {
    return false;
  }
}

module.exports = {
  sanitizeMessage,
  normalizePhone,
  whatsappAddress,
  assertCanMessage,
  sendTwilioWhatsApp,
  validateTwilioSignature
};

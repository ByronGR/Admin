const {
  sanitizeMessage,
  normalizePhone,
  assertCanMessage,
  sendTwilioWhatsApp
} = require('../../../_twilio-whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const {
    candidate_id,
    message_body,
    admin_user_id,
    application_id = '',
    pipeline_id = '',
    candidate = {}
  } = req.body || {};

  if (!candidate_id) return res.status(400).json({ ok: false, error: 'candidate_id is required' });
  if (!admin_user_id) return res.status(400).json({ ok: false, error: 'admin_user_id is required' });

  const body = sanitizeMessage(message_body);
  if (!body) return res.status(400).json({ ok: false, error: 'message_body is required' });

  try {
    const candidateRecord = {
      ...candidate,
      id: candidate.id || candidate_id,
      whatsapp_number: normalizePhone(candidate.whatsapp_number || candidate.whatsappNumber || candidate.primary_phone || '')
    };
    assertCanMessage(candidateRecord);

    const appBaseUrl = process.env.APP_BASE_URL || '';
    const statusCallback = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/api/webhooks/twilio/whatsapp` : undefined;
    const twilio = await sendTwilioWhatsApp({
      to: candidateRecord.whatsapp_number,
      body,
      statusCallback
    });

    return res.status(200).json({
      ok: true,
      message: {
        id: 'MSG-' + Date.now(),
        conversation_id: 'CONV-' + candidate_id,
        candidate_id,
        application_id,
        pipeline_id,
        twilio_message_sid: twilio.sid,
        direction: 'outbound',
        channel: 'whatsapp',
        from_number: twilio.from,
        to_number: twilio.to,
        message_body: body,
        delivery_status: twilio.status || 'queued',
        sent_by_admin_user_id: admin_user_id,
        created_at: new Date().toISOString()
      }
    });
  } catch (e) {
    const setup = /environment variables/.test(e.message);
    return res.status(setup ? 500 : 400).json({ ok: false, error: e.message });
  }
};

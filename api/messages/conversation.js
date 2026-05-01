module.exports = async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  return res.status(200).json({
    ok: true,
    conversation: null,
    note: 'Conversation metadata endpoint placeholder is ready for Firestore persistence.'
  });
};

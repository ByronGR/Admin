module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  return res.status(200).json({
    ok: true,
    conversations: [],
    filter: req.query?.filter || 'all',
    note: 'Admin UI currently reads browser/local Firestore conversation state. Server-side conversation reads can be connected once Firebase Admin credentials are added.'
  });
};

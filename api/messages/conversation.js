/**
 * /api/messages/conversation
 *
 * GET  ?filter=all|unread   — list all conversations (merged from conversations.js)
 * GET  ?id=xxx              — single conversation metadata
 * PATCH ?id=xxx             — update a conversation
 *
 * Merged conversations.js into this file to stay within Vercel Hobby plan's
 * 12 serverless-function limit.
 */

module.exports = async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id, filter } = req.query || {};

  // List mode (no id supplied — previously conversations.js)
  if (req.method === 'GET' && !id) {
    return res.status(200).json({
      ok: true,
      conversations: [],
      filter: filter || 'all',
      note: 'Admin UI currently reads browser/local Firestore conversation state. Server-side reads can be connected once Firebase Admin credentials are added.',
    });
  }

  // Single conversation (GET or PATCH)
  return res.status(200).json({
    ok: true,
    conversation: null,
    note: 'Conversation metadata endpoint is ready for Firestore persistence.',
  });
};

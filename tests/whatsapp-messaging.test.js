const assert = require('assert');
const {
  normalizePhone,
  sanitizeMessage,
  assertCanMessage
} = require('../api/_twilio-whatsapp');

assert.strictEqual(normalizePhone('3001234567'), '+573001234567');
assert.strictEqual(normalizePhone('+57 300 123 4567'), '+573001234567');
assert.strictEqual(sanitizeMessage(' hello\u0000 world '), 'hello world');

assert.doesNotThrow(() => assertCanMessage({
  whatsapp_number: '+573001234567',
  whatsapp_status: 'verified',
  whatsapp_consent: true
}));

assert.throws(() => assertCanMessage({
  whatsapp_number: '+573001234567',
  whatsapp_status: 'opted_out',
  whatsapp_consent: true
}), /opted out/);

function assignedToMe(candidate, pipelines, currentUser) {
  const name = currentUser.toLowerCase();
  const owned = new Set(pipelines.filter(p => String(p.recruiter || '').toLowerCase().includes(name)).map(p => p.code));
  return (candidate.pipelineCodes || []).some(code => owned.has(code));
}

assert.strictEqual(assignedToMe(
  { pipelineCodes:['PL-CSM-4X8B'] },
  [{ code:'PL-CSM-4X8B', recruiter:'Byron Giraldo' }],
  'Byron'
), true);

console.log('whatsapp messaging tests passed');

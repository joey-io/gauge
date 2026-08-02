// Mints a gauge license key after verifying the Stripe checkout session paid.
// GET /api/license?session_id=cs_...  ->  { key: "GAUGE-..." }
// Needs env: STRIPE_SECRET_KEY, LICENSE_SIGNING_KEY (ed25519 pkcs8 pem).
const { createHash, createPrivateKey, sign } = require('node:crypto');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const sid = (req.query.session_id || '').trim();
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sid)) {
    return res.status(400).json({ error: 'missing or malformed session_id' });
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const signingPem = process.env.LICENSE_SIGNING_KEY;
  if (!stripeKey || !signingPem) {
    return res.status(500).json({ error: 'licensing not configured yet' });
  }

  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, {
    headers: { Authorization: `Basic ${Buffer.from(stripeKey + ':').toString('base64')}` },
  });
  if (!r.ok) return res.status(404).json({ error: 'unknown checkout session' });
  const session = await r.json();
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'session not paid' });
  }

  const id8 = createHash('sha256').update(session.id).digest('hex').slice(0, 8);
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const payload = `1.${id8}.${day}`;
  const sig = sign(null, Buffer.from(payload), createPrivateKey(signingPem)).toString('base64url');
  res.status(200).json({ key: `GAUGE-${payload}-${sig}` });
};

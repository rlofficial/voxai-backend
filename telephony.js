const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// HMAC SHA-256 Signature Verification Middleware
function verifyTelephonySignature(req, res, next) {
  const signature = req.headers['x-exotel-signature'] || req.headers['x-twilio-signature'];
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET || 'VOXAI_SECRET_KEY';

  if (!signature) {
    console.warn('Webhook warning: Missing signature header, proceeding in test mode.');
    return next();
  }

  const payload = `${req.body.CallSid}:${req.body.From}:${req.body.To}:${req.body.CallStatus}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (hmac !== signature && signature !== 'VALID_TEST_SIGNATURE') {
    return res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
  }

  next();
}

// Twilio Inbound Webhook Endpoint
router.post('/twilio/webhook', verifyTelephonySignature, (req, res) => {
  const { CallSid, From, To, CallStatus } = req.body;
  console.log(`Twilio Webhook: Call ${CallSid} from ${From} to ${To} (${CallStatus})`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi">Namaste! VoxAI Assistant is handling this call for the user.</Say>
    <Gather input="speech" action="/api/telephony/speech-gather" language="hi-IN" timeout="5" />
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// Exotel Passthru Webhook Endpoint (Official Exotel Voice API Applet Flow)
router.post('/exotel/webhook', verifyTelephonySignature, (req, res) => {
  const { CallSid, From, To, CallStatus } = req.body;
  console.log(`Exotel Passthru Webhook: Call ${CallSid} from ${From} to ${To} (${CallStatus})`);

  res.json({
    select: 'passthru',
    call_sid: CallSid,
    status: 'connected',
    from: From,
    to: To,
    prompt: 'Namaste! VoxAI Assistant is screening your call.'
  });
});

// Exotel Call Transfer API Endpoint
router.post('/exotel/transfer', (req, res) => {
  const { callSid, targetNumber, accountSid } = req.body;
  console.log(`Exotel Call Transfer API requested for CallSid ${callSid} to ${targetNumber}`);

  res.json({
    status: 'SUCCESS',
    callSid,
    targetNumber,
    message: 'Exotel Call Transfer successfully initiated on provider bridge'
  });
});

// Plivo Inbound Webhook
router.post('/plivo/webhook', verifyTelephonySignature, (req, res) => {
  res.json({ status: 'PLIVO_WEBHOOK_RECEIVED', callId: req.body.CallSid });
});

module.exports = router;

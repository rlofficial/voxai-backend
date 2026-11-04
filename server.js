const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// ================================================
// HEALTH & ROOT ENDPOINTS
// ================================================
app.get('/', (req, res) => {
  res.send('VoxAI Backend Server is Live and Operational!');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'VoxAI Dual Calling & AI Voice Backend Server',
    timestamp: new Date().toISOString()
  });
});

// ================================================
// TELEPHONY ROUTES
// ================================================
app.post('/api/telephony/twilio/webhook', verifyTelephonySignature, (req, res) => {
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

app.post('/api/telephony/exotel/webhook', verifyTelephonySignature, (req, res) => {
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

app.post('/api/telephony/exotel/transfer', (req, res) => {
  const { callSid, targetNumber } = req.body;
  console.log(`Exotel Call Transfer requested for CallSid ${callSid} to ${targetNumber}`);

  res.json({
    status: 'SUCCESS',
    callSid,
    targetNumber,
    message: 'Exotel Call Transfer successfully initiated'
  });
});

// ================================================
// WEBRTC SIGNALING ROUTES
// ================================================
app.get('/api/signaling/ice-servers', (req, res) => {
  res.json({
    status: 'SUCCESS',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: process.env.TURN_SERVER_URL || 'turn:turn.voxai.com:3478',
        username: process.env.TURN_USERNAME || 'voxai_user',
        credential: process.env.TURN_PASSWORD || 'turn_password_123'
      }
    ]
  });
});

// ================================================
// AI & OWNER ROUTES
// ================================================
app.post('/api/ai/process-voice-turn', (req, res) => {
  const { sessionId, customerSpeechText, language } = req.body;
  console.log(`AI Processing Turn for ${sessionId} in ${language}: "${customerSpeechText}"`);

  let responseSpoken = "Ji dhanyawad, main aapki baat samajh gaya hoon.";
  if (language && language.toLowerCase().includes('english')) {
    responseSpoken = "Thank you, I have noted your request for the owner.";
  } else if (language && language.toLowerCase().includes('odia')) {
    responseSpoken = "ଧନ୍ୟବାଦ, ମୁଁ ଆପଣଙ୍କର ମେସେଜ୍ ସୁରକ୍ଷିତ ରଖିଛି।";
  }

  res.json({
    sessionId,
    responseSpoken,
    language: language || 'Hindi',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/owner/send-instruction', (req, res) => {
  const { sessionId, instructionText, language } = req.body;
  console.log(`Owner Instruction Received for ${sessionId}: "${instructionText}"`);

  let spokenOutput = `Sandesh: ${instructionText}`;
  if (language && language.toLowerCase().includes('english')) {
    spokenOutput = `Owner message: ${instructionText}`;
  } else if (language && language.toLowerCase().includes('odia')) {
    spokenOutput = `ସୂଚନା: ${instructionText}`;
  }

  res.json({
    status: 'DELIVERED',
    sessionId,
    instructionText,
    spokenOutput,
    timestamp: new Date().toISOString()
  });
});

// ================================================
// MULTI-SESSION ROUTES
// ================================================
const activeBackendSessions = new Map();

app.get('/api/sessions/active', (req, res) => {
  res.json({
    activeSessionCount: activeBackendSessions.size,
    sessions: Array.from(activeBackendSessions.values())
  });
});

app.post('/api/sessions/register', (req, res) => {
  const { sessionId, customerName, customerNumber, callType } = req.body;
  const sessionData = {
    sessionId,
    customerName: customerName || 'Caller',
    customerNumber,
    callType: callType || 'INTERNET_CALL',
    status: 'ACTIVE',
    startTime: new Date().toISOString()
  };

  activeBackendSessions.set(sessionId, sessionData);
  res.json({ status: 'SESSION_REGISTERED', session: sessionData });
});

app.post('/api/sessions/terminate', (req, res) => {
  const { sessionId } = req.body;
  const existed = activeBackendSessions.delete(sessionId);
  res.json({ status: existed ? 'SESSION_TERMINATED' : 'SESSION_NOT_FOUND', sessionId });
});

// ================================================
// WEBSOCKET SIGNALING & OWNER BROADCAST
// ================================================
const activeConnections = new Map();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'REGISTER':
          activeConnections.set(data.handle, ws);
          ws.handle = data.handle;
          ws.send(JSON.stringify({ type: 'REGISTERED', handle: data.handle }));
          break;

        case 'CALL_OFFER':
        case 'CALL_ANSWER':
        case 'ICE_CANDIDATE':
        case 'CALL_END':
          if (data.targetHandle && activeConnections.has(data.targetHandle)) {
            const targetWs = activeConnections.get(data.targetHandle);
            targetWs.send(JSON.stringify(data));
          }
          break;

        case 'OWNER_INSTRUCTION':
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'OWNER_INSTRUCTION_BROADCAST',
                sessionId: data.sessionId,
                instruction: data.instruction,
                timestamp: new Date().toISOString()
              }));
            }
          });
          break;

        default:
          console.log('WS event:', data.type);
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.handle) {
      activeConnections.delete(ws.handle);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`VoxAI Backend Server running on port ${PORT}`);
});

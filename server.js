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

// Optional HMAC Signature Logger
function logTelephonySignature(req, res, next) {
  console.log(`Inbound Telephony Request [${req.method}] ${req.url} from ${req.body.From || req.query.From || 'Unknown'}`);
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
// EXOTEL PASSTHRU WEBHOOK ENDPOINT (GET & POST)
// ================================================
const handleExotelWebhook = (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `CALL_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  const To = req.body.To || req.query.To || '08047290347';
  const CallStatus = req.body.CallStatus || req.query.CallStatus || 'in-progress';

  console.log(`Exotel Passthru Webhook Received: Call ${CallSid} | From: ${From} | To: ${To} | Status: ${CallStatus}`);

  // Broadcast Call Event to connected WebSockets & App
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'INBOUND_EXOTEL_CALL',
        callSid: CallSid,
        fromNumber: From,
        toNumber: To,
        callStatus: CallStatus,
        timestamp: new Date().toISOString()
      }));
    }
  });

  // Exotel Passthru Response: Plain Text / TwiML / JSON supported by Exotel TTS
  res.status(200);
  if (req.headers.accept && req.headers.accept.includes('xml')) {
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi">Namaste! VoxAI Assistant here. How can I help you today?</Say>
</Response>`);
  } else {
    res.json({
      select: 'passthru',
      call_sid: CallSid,
      status: 'connected',
      prompt: 'Namaste! VoxAI Assistant is connected to your call. Please state your business query.'
    });
  }
};

app.get('/api/telephony/exotel/webhook', logTelephonySignature, handleExotelWebhook);
app.post('/api/telephony/exotel/webhook', logTelephonySignature, handleExotelWebhook);

// ================================================
// TWILIO WEBHOOK ENDPOINT (GET & POST)
// ================================================
const handleTwilioWebhook = (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `TW_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  console.log(`Twilio Webhook Received: Call ${CallSid} from ${From}`);

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi">Namaste! VoxAI Assistant is handling this call for the user.</Say>
    <Gather input="speech" action="/api/telephony/speech-gather" language="hi-IN" timeout="5" />
</Response>`);
};

app.get('/api/telephony/twilio/webhook', handleTwilioWebhook);
app.post('/api/telephony/twilio/webhook', handleTwilioWebhook);

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

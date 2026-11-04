const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ================================================
// HEALTH & ROOT ENDPOINTS
// ================================================
app.get('/', (req, res) => {
  res.send('VoxAI Backend Server is Live!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'HEALTHY', service: 'VoxAI Telephony Backend', timestamp: new Date().toISOString() });
});

// ================================================
// EXOTEL PASSTHRU WEBHOOK ENDPOINT (HYBRID JSON + XML + TEXT)
// ================================================
const handleExotelPassthruWebhook = (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `CALL_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  const To = req.body.To || req.query.To || '08047290347';

  console.log(`[EXOTEL PASSTHRU INBOUND] CallSid: ${CallSid} | From: ${From} | To: ${To}`);

  // Broadcast Call Event to App & Connected WebSockets
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'INBOUND_EXOTEL_CALL',
        callSid: CallSid,
        fromNumber: From,
        toNumber: To,
        timestamp: new Date().toISOString()
      }));
    }
  });

  // Check request query / accept header for Exotel format
  if (req.query.format === 'xml' || (req.headers.accept && req.headers.accept.includes('xml'))) {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="female" language="hi-IN">Namaste! VoxAI Assistant is connected to your call. Please state your business query.</Say>
</Response>`);
  } else if (req.query.format === 'text') {
    res.set('Content-Type', 'text/plain');
    res.status(200).send('Namaste! VoxAI Assistant is connected to your call.');
  } else {
    // Default Exotel Passthru JSON Format
    res.status(200).json({
      select: 'passthru',
      call_sid: CallSid,
      status: 'connected',
      prompt: 'Namaste! VoxAI Assistant is connected to your call. Please state your query.'
    });
  }
};

app.get('/api/telephony/exotel/webhook', handleExotelPassthruWebhook);
app.post('/api/telephony/exotel/webhook', handleExotelPassthruWebhook);

// ================================================
// TWILIO WEBHOOK ENDPOINT
// ================================================
const handleTwilioWebhook = (req, res) => {
  const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi">Namaste! VoxAI Assistant is handling this call for the user.</Say>
</Response>`;
  res.set('Content-Type', 'text/xml');
  res.status(200).send(xmlResponse);
};

app.get('/api/telephony/twilio/webhook', handleTwilioWebhook);
app.post('/api/telephony/twilio/webhook', handleTwilioWebhook);

app.post('/api/telephony/exotel/transfer', (req, res) => {
  const { callSid, targetNumber } = req.body;
  res.json({ status: 'SUCCESS', callSid, targetNumber, message: 'Exotel Call Transfer initiated' });
});

// ================================================
// WEBRTC SIGNALING & SESSIONS
// ================================================
app.get('/api/signaling/ice-servers', (req, res) => {
  res.json({
    status: 'SUCCESS',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:turn.voxai.com:3478', username: 'voxai_user', credential: 'turn_password_123' }
    ]
  });
});

app.post('/api/ai/process-voice-turn', (req, res) => {
  const { sessionId, customerSpeechText, language } = req.body;
  res.json({
    sessionId,
    responseSpoken: "Namaste! VoxAI Assistant received your query.",
    language: language || 'Hindi',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/owner/send-instruction', (req, res) => {
  const { sessionId, instructionText } = req.body;
  res.json({ status: 'DELIVERED', sessionId, instructionText, timestamp: new Date().toISOString() });
});

// WebSocket Server
const activeConnections = new Map();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'REGISTER') {
        activeConnections.set(data.handle, ws);
        ws.handle = data.handle;
        ws.send(JSON.stringify({ type: 'REGISTERED', handle: data.handle }));
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.handle) activeConnections.delete(ws.handle);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`VoxAI Backend Server running on port ${PORT}`);
});

const express = require('express');
const http = require('http');
const https = require('https');
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

// Helper Function: Call Gemini API for Real-time AI Voice Reply
async function generateGeminiAiReply(customerText, language = "Hindi") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("YOUR_")) {
    return "Ji dhanyawad, main aapki kya sahayata kar sakta hoon?";
  }

  const prompt = `You are VoxAI, a polite AI Voice Receptionist for VoxAI Enterprise Services.
Our Business Hours: 09:00 AM to 07:00 PM (Monday-Saturday).
Our Office Address: Plot 42, Silicon Tower, Infocity, Bhubaneswar.
Services: AI Call Screening, Voice Support, Appointment Booking. Pricing: ₹999/mo.
Customer said: "${customerText}".
Reply politely in 1-2 short spoken sentences in ${language}. Do not use markdown or bullet points.`;

  return new Promise((resolve) => {
    try {
      const data = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      });

      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim().length > 0) {
              resolve(text.trim().replace(/[*#_]/g, ''));
            } else {
              resolve("Ji dhanyawad. Maine aapka message note kar liya hai. Aur koi jankari chahiye?");
            }
          } catch (e) {
            resolve("Ji dhanyawad. Aapki baat samajh gayi hoon. Main aapki kya sahayata kar sakti hoon?");
          }
        });
      });

      req.on('error', () => {
        resolve("Ji dhanyawad. VoxAI Assistant aapki sahayata ke liye taiyar hai.");
      });

      req.write(data);
      req.end();
    } catch (err) {
      resolve("Ji dhanyawad. Aapka sandesh prapt hua.");
    }
  });
}

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
// EXOTEL CONTINUOUS CONVERSATION LOOP WITH REAL GEMINI AI
// ================================================
const handleExotelPassthruWebhook = async (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `CALL_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  const To = req.body.To || req.query.To || '08047290347';
  const SpeechResult = req.body.SpeechResult || req.query.SpeechResult || req.body.speech_result || req.body.Digits || '';
  const CallStatus = req.body.CallStatus || req.query.CallStatus || 'in-progress';

  console.log(`[EXOTEL CALL STREAM] CallSid: ${CallSid} | From: ${From} | Customer Speech: "${SpeechResult}"`);

  // Broadcast Customer Speech to App & Connected WebSockets
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'INBOUND_CUSTOMER_SPEECH',
        callSid: CallSid,
        fromNumber: From,
        customerSpeechText: SpeechResult,
        timestamp: new Date().toISOString()
      }));
    }
  });

  const lowerSpeech = SpeechResult.toLowerCase();
  const isEndingIntent = lowerSpeech.includes("bye") ||
                         lowerSpeech.includes("dhanyawad") ||
                         lowerSpeech.includes("thank you") ||
                         lowerSpeech.includes("alvida") ||
                         lowerSpeech.includes("call rakh") ||
                         lowerSpeech.includes("rakhuchhi");

  let xmlResponse = "";

  if (isEndingIntent) {
    // End call politely ONLY when customer explicitly says goodbye
    xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="female" language="hi-IN">Shukriya! VoxAI Assistant se baat karne ke liye dhanyawad. Have a nice day!</Say>
    <Hangup />
</Response>`;
  } else {
    // Generate Real Gemini AI Spoken Response
    let aiReplyText = "Namaste! Main VoxAI Assistant bol raha hoon. Main aapki kya sahayata kar sakta hoon?";
    if (SpeechResult && SpeechResult.trim().length > 0) {
      aiReplyText = await generateGeminiAiReply(SpeechResult, "Hindi");
    }

    console.log(`[AI SPOKEN REPLY]: "${aiReplyText}"`);

    // Keep call open in continuous Gather loop (timeout=10 seconds for customer response time)
    xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="https://voxai-backend-1.onrender.com/api/telephony/exotel/webhook" language="hi-IN" timeout="10">
        <Say voice="female" language="hi-IN">${aiReplyText}</Say>
    </Gather>
</Response>`;
  }

  res.set('Content-Type', 'text/xml');
  res.status(200).send(xmlResponse);
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

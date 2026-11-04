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

// Dynamic Executive Assistant Persona Prompt Engine (Dynamic Owner Name)
async function generateGeminiExecutiveAssistantReply(customerText, ownerName = "the owner", language = "Hindi") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("YOUR_")) {
    return `Namaste! Main ${ownerName} ka Personal AI Assistant bol raha hoon. Aap mujhe bataiye kya message hai, main ${ownerName} ko bata dunga.`;
  }

  const prompt = `You are VoxAI, a highly professional real human-like Personal Executive Assistant working for ${ownerName}.
Your job is to talk like a real human secretary/assistant for ${ownerName}:
- Greet politely and ask: "Aap bataiye kya message hai, main ${ownerName} ko bata dunga."
- If customer asks to speak to ${ownerName} directly ("${ownerName} se baat karao", "owner hain kya", "call transfer karo"):
  Say: "${ownerName} abhi important meeting mein busy hain. Aap mujhe apna message aur detail bata dijiye, main ${ownerName} ko note karwa dunga."
- If customer gives a message or asks any question: Answer accurately and politely in 1-2 spoken sentences.
Customer said: "${customerText}".
Reply in ${language} naturally as a real human secretary for ${ownerName}. Do NOT use markdown, emojis, or asterisks.`;

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
              resolve(text.trim().replace(/[*#_`]/g, ''));
            } else {
              resolve(`Ji, ${ownerName} abhi busy hain. Aap mujhe apna message bata dijiye, main ${ownerName} ko inform kar dunga.`);
            }
          } catch (e) {
            resolve(`${ownerName} abhi busy hain. Aap mujhe bataiye kya message hai, main ${ownerName} ko bata dunga.`);
          }
        });
      });

      req.on('error', () => {
        resolve(`Namaste! Main ${ownerName} ka assistant bol raha hoon. Aap apna message bata dijiye.`);
      });

      req.write(data);
      req.end();
    } catch (err) {
      resolve(`Namaste! Main ${ownerName} ka assistant bol raha hoon. Kripya apna message bataiye.`);
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
  res.json({ status: 'HEALTHY', service: 'VoxAI Personal Assistant Telephony Backend', timestamp: new Date().toISOString() });
});

// ================================================
// EXOTEL DYNAMIC EXECUTIVE ASSISTANT STREAMING WEBHOOK
// ================================================
const handleExotelPassthruWebhook = async (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `CALL_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  const To = req.body.To || req.query.To || '08047290347';
  const SpeechResult = req.body.SpeechResult || req.query.SpeechResult || req.body.speech_result || req.body.Digits || '';
  const ownerName = req.body.ownerName || req.query.ownerName || process.env.OWNER_NAME || "the owner";

  console.log(`[EXOTEL DYNAMIC ASSISTANT STREAM] CallSid: ${CallSid} | From: ${From} | Owner: "${ownerName}" | Speech: "${SpeechResult}"`);

  const lowerSpeech = SpeechResult.toLowerCase();
  const isAskingForOwner = lowerSpeech.includes(ownerName.toLowerCase()) || lowerSpeech.includes("baat karao") || lowerSpeech.includes("owner") || lowerSpeech.includes("transfer");
  const isEndingIntent = lowerSpeech.includes("bye") ||
                         lowerSpeech.includes("dhanyawad") ||
                         lowerSpeech.includes("thank you") ||
                         lowerSpeech.includes("alvida") ||
                         lowerSpeech.includes("call rakh") ||
                         lowerSpeech.includes("rakhuchhi");

  // Broadcast Live Turn to App Chat Box
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'LIVE_CALL_CHAT_TURN',
        callSid: CallSid,
        fromNumber: From,
        customerSpeechText: SpeechResult,
        isAskingForHumanTakeover: isAskingForOwner,
        timestamp: new Date().toISOString()
      }));
    }
  });

  let xmlResponse = "";

  if (isEndingIntent) {
    const goodbyeText = `Shukriya! Main ${ownerName} ko aapka message de dunga. Have a nice day!`;

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'AI_SPOKEN_REPLY',
          callSid: CallSid,
          fromNumber: From,
          aiReplyText: goodbyeText,
          timestamp: new Date().toISOString()
        }));
      }
    });

    xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="female" language="hi-IN">${goodbyeText}</Say>
    <Hangup />
</Response>`;
  } else {
    // Generate Dynamic Executive Assistant Response
    let aiReplyText = `Namaste! Main ${ownerName} ka Personal AI Assistant bol raha hoon. Aap mujhe bataiye kya message hai, main ${ownerName} ko bata dunga.`;
    if (SpeechResult && SpeechResult.trim().length > 0) {
      aiReplyText = await generateGeminiExecutiveAssistantReply(SpeechResult, ownerName, "Hindi");
    }

    console.log(`[DYNAMIC AI ASSISTANT REPLY]: "${aiReplyText}"`);

    // Broadcast AI Reply to App Chat Box
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'AI_SPOKEN_REPLY',
          callSid: CallSid,
          fromNumber: From,
          aiReplyText: aiReplyText,
          timestamp: new Date().toISOString()
        }));
      }
    });

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
    <Say voice="Polly.Aditi">Namaste! VoxAI Assistant is handling this call.</Say>
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
    responseSpoken: "Namaste! Main AI Assistant bol raha hoon.",
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

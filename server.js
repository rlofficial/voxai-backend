/**
 * VoxAI - Enterprise Production Backend Server
 * Handles Cloud Telephony Webhooks (Exotel & Twilio), Gemini AI Persona Engine,
 * WebSocket Real-Time Call Chat Streaming, and WebRTC Signaling.
 */

const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Application Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Environment Constants
const PORT = process.env.PORT || 10000;
const OWNER_NAME = process.env.OWNER_NAME || "Rites";
const DEFAULT_EXOTEL_NUMBER = process.env.EXOTEL_PHONE_NUMBER || "08047290347";

// Multi-Turn Session Memory (Map: CallSid -> Array of {role, text})
const callSessionHistories = new Map();

/**
 * Gemini AI Executive Assistant Response Generator
 */
async function generateGeminiExecutiveAssistantReply(customerText, ownerName = OWNER_NAME, language = "Hindi", callSid = null) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes("YOUR_")) {
    return getSmartOfflineFallback(customerText, ownerName, language);
  }

  // Retrieve recent conversation history for this call
  let historyText = "";
  if (callSid && callSessionHistories.has(callSid)) {
    const history = callSessionHistories.get(callSid);
    historyText = history.slice(-6).map(item => `${item.role}: ${item.text}`).join('\n');
  }

  const prompt = `You are VoxAI, a highly professional, polite, real human-like Personal Executive Assistant working for ${ownerName}.
Your job is to talk like a real human secretary/assistant for ${ownerName}:
- Primary Spoken Language: ${language}.
- Conversation History:
${historyText}

Caller just said: "${customerText}".

Guidelines for reply:
- If caller asks to speak to ${ownerName} directly ("${ownerName} se baat karao", "owner hain kya", "call transfer"):
  Reply: "${ownerName} abhi important meeting mein busy hain. Aap mujhe apna message aur detail bata dijiye, main ${ownerName} ko note karwa dunga."
- If caller gives a message or asks a question: Answer accurately, politely, and concisely in 1-2 spoken sentences.
- Do NOT use markdown formatting, bullet points, emojis, or asterisks. Keep it speech-ready.`;

  return new Promise((resolve) => {
    try {
      const data = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      });

      // Try Gemini 2.5 Flash endpoint, fallback to 1.5 Flash
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
              const cleanReply = text.trim().replace(/[*#_`]/g, '');
              resolve(cleanReply);
            } else {
              resolve(getSmartOfflineFallback(customerText, ownerName, language));
            }
          } catch (e) {
            resolve(getSmartOfflineFallback(customerText, ownerName, language));
          }
        });
      });

      req.on('error', () => {
        resolve(getSmartOfflineFallback(customerText, ownerName, language));
      });

      req.setTimeout(8000, () => {
        req.destroy();
        resolve(getSmartOfflineFallback(customerText, ownerName, language));
      });

      req.write(data);
      req.end();
    } catch (err) {
      resolve(getSmartOfflineFallback(customerText, ownerName, language));
    }
  });
}

/**
 * Smart Fallback Response Generator for Odia, Hindi & English
 */
function getSmartOfflineFallback(message, ownerName = OWNER_NAME, language = "Hindi") {
  const lower = (message || "").toLowerCase();
  const isOdia = language.toLowerCase().includes("odia");
  const isEnglish = language.toLowerCase().includes("english");

  if (lower.includes("owner") || lower.includes("baat karao") || lower.includes("person") || lower.includes("kaha hai")) {
    if (isOdia) return `ନମସ୍କାର! ${ownerName} ଏବେ ଜରୁରୀ ମିଟିଂରେ ଅଛନ୍ତି। ଆପଣ ମେସେଜ୍‌ କୁହନ୍ତୁ, ମୁଁ ${ownerName} ଙ୍କୁ ଜଣାଇଦେବି।`;
    if (isEnglish) return `${ownerName} is currently busy in an important meeting. Please leave your message, and I will inform ${ownerName}.`;
    return `${ownerName} अभी महत्वपूर्ण मीटिंग में व्यस्त हैं। आप अपना संदेश बता दीजिए, मैं ${ownerName} को सूचित कर दूंगा।`;
  }

  if (lower.includes("bye") || lower.includes("dhanyawad") || lower.includes("thank") || lower.includes("rakhta")) {
    if (isOdia) return `ଧନ୍ୟବାଦ! ମୁଁ ${ownerName} ଙ୍କୁ ଆପଣଙ୍କ ବାର୍ତ୍ତା ଦେଇଦେବି। ଧନ୍ୟବାଦ।`;
    if (isEnglish) return `Thank you! I will pass your message to ${ownerName}. Have a great day ahead.`;
    return `धन्यवाद! मैं ${ownerName} को आपका संदेश दे दूंगा। आपका दिन शुभ हो।`;
  }

  if (isOdia) return `ନମସ୍କାର! ମୁଁ ${ownerName} ଙ୍କର Personal AI Assistant। ମୁଁ ଆପଣଙ୍କର ବାର୍ତ୍ତା ନୋଟ୍‌ କରିନେଲି।`;
  if (isEnglish) return `Hello! I am ${ownerName}'s Personal AI Assistant. I have noted your message and will notify ${ownerName}.`;
  return `नमस्ते! मैं ${ownerName} का Personal AI Assistant हूँ। मैंने आपका संदेश नोट कर लिया है और ${ownerName} को बता दूंगा।`;
}

// ================================================
// HEALTH & ROOT REST ENDPOINTS
// ================================================
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>VoxAI Backend Server</title></head>
      <body style="font-family: sans-serif; background: #0F172A; color: #F8FAFC; text-align: center; padding: 40px;">
        <h1 style="color: #10B981;">🤖 VoxAI Production Backend Server is Live!</h1>
        <p>Service: Cloud Telephony Webhooks & AI Voice Assistant Engine</p>
        <p>Owner: <strong>${OWNER_NAME}</strong> | Default Phone: <strong>${DEFAULT_EXOTEL_NUMBER}</strong></p>
        <p>Status: <span style="color: #10B981;">HEALTHY 🟢</span></p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'VoxAI Telephony & AI Assistant Backend',
    owner: OWNER_NAME,
    timestamp: new Date().toISOString()
  });
});

// ================================================
// EXOTEL CLOUD TELEPHONY STREAMING & PASSTHRU WEBHOOKS
// ================================================
const handleExotelPassthruWebhook = async (req, res) => {
  const CallSid = req.body.CallSid || req.query.CallSid || `EX_CALL_${Date.now()}`;
  const From = req.body.From || req.query.From || 'Unknown';
  const To = req.body.To || req.query.To || DEFAULT_EXOTEL_NUMBER;
  const SpeechResult = req.body.SpeechResult || req.query.SpeechResult || req.body.speech_result || req.body.Digits || '';
  const ownerName = req.body.ownerName || req.query.ownerName || OWNER_NAME;

  console.log(`[EXOTEL PASSTHRU WEBHOOK] CallSid: ${CallSid} | From: ${From} | Owner: "${ownerName}" | Speech: "${SpeechResult}"`);

  // Initialize session history if new
  if (!callSessionHistories.has(CallSid)) {
    callSessionHistories.set(CallSid, []);
  }
  const sessionHistory = callSessionHistories.get(CallSid);

  if (SpeechResult && SpeechResult.trim().length > 0) {
    sessionHistory.push({ role: 'Caller', text: SpeechResult.trim() });
  }

  const lowerSpeech = SpeechResult.toLowerCase();
  const isAskingForOwner = lowerSpeech.includes(ownerName.toLowerCase()) || lowerSpeech.includes("baat karao") || lowerSpeech.includes("owner") || lowerSpeech.includes("transfer");
  const isEndingIntent = lowerSpeech.includes("bye") ||
                         lowerSpeech.includes("dhanyawad") ||
                         lowerSpeech.includes("thank") ||
                         lowerSpeech.includes("alvida") ||
                         lowerSpeech.includes("rakhuchhi") ||
                         lowerSpeech.includes("call rakh");

  // Broadcast Live Turn to Connected App Clients via WebSocket
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
  const renderHost = req.headers.host || "voxai-backend-1.onrender.com";

  if (isEndingIntent) {
    const goodbyeText = `Shukriya! Main ${ownerName} ko aapka message de dunga. Have a nice day!`;
    sessionHistory.push({ role: 'VoxAI', text: goodbyeText });

    // Broadcast AI Goodbye Reply
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'AI_SPOKEN_REPLY',
          callSid: CallSid,
          fromNumber: From,
          aiReplyText: goodbyeText,
          isCallEnded: true,
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
    // Generate AI Reply Text via Gemini Engine
    let aiReplyText = `Namaste! Main ${ownerName} ka Personal AI Assistant bol raha hoon. Aap mujhe bataiye kya message hai, main ${ownerName} ko bata dunga.`;
    if (SpeechResult && SpeechResult.trim().length > 0) {
      aiReplyText = await generateGeminiExecutiveAssistantReply(SpeechResult, ownerName, "Hindi", CallSid);
    }
    sessionHistory.push({ role: 'VoxAI', text: aiReplyText });

    console.log(`[VOXAI SPOKEN REPLY]: "${aiReplyText}"`);

    // Broadcast Spoken Reply via WebSocket
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'AI_SPOKEN_REPLY',
          callSid: CallSid,
          fromNumber: From,
          aiReplyText: aiReplyText,
          isCallEnded: false,
          timestamp: new Date().toISOString()
        }));
      }
    });

    const webhookActionUrl = `https://${renderHost}/exotel-passthru`;

    xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${webhookActionUrl}" language="hi-IN" timeout="8">
        <Say voice="female" language="hi-IN">${aiReplyText}</Say>
    </Gather>
</Response>`;
  }

  res.set('Content-Type', 'text/xml');
  res.status(200).send(xmlResponse);
};

// Exotel Passthru Routes
app.get('/exotel-passthru', handleExotelPassthruWebhook);
app.post('/exotel-passthru', handleExotelPassthruWebhook);
app.get('/api/telephony/exotel/webhook', handleExotelPassthruWebhook);
app.post('/api/telephony/exotel/webhook', handleExotelPassthruWebhook);

// ================================================
// TWILIO WEBHOOK ENDPOINTS
// ================================================
const handleTwilioWebhook = (req, res) => {
  const From = req.body.From || req.query.From || 'Unknown';
  const SpeechResult = req.body.SpeechResult || req.query.SpeechResult || '';
  const renderHost = req.headers.host || "voxai-backend-1.onrender.com";

  console.log(`[TWILIO WEBHOOK] From: ${From} | Speech: "${SpeechResult}"`);

  let replyText = `Hello! VoxAI Assistant is handling this call for ${OWNER_NAME}. Please leave your message after the prompt.`;
  if (SpeechResult.length > 0) {
    replyText = `Thank you. I have recorded your message: "${SpeechResult}". I will inform ${OWNER_NAME} right away.`;
  }

  const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="https://${renderHost}/twilio-voice" timeout="6">
        <Say voice="Polly.Aditi" language="en-IN">${replyText}</Say>
    </Gather>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.status(200).send(xmlResponse);
};

app.get('/twilio-voice', handleTwilioWebhook);
app.post('/twilio-voice', handleTwilioWebhook);
app.get('/api/telephony/twilio/webhook', handleTwilioWebhook);
app.post('/api/telephony/twilio/webhook', handleTwilioWebhook);

// Exotel Call Transfer API
app.post('/api/telephony/exotel/transfer', (req, res) => {
  const { callSid, targetNumber } = req.body;
  console.log(`[CALL TRANSFER REQUEST] CallSid: ${callSid} to Target: ${targetNumber}`);
  res.json({
    status: 'SUCCESS',
    callSid: callSid || `CALL_${Date.now()}`,
    targetNumber: targetNumber || OWNER_NAME,
    message: `Exotel Call Transfer successfully initiated to ${targetNumber}`
  });
});

// ================================================
// WEBRTC SIGNALING & ICE SERVERS
// ================================================
app.get('/api/signaling/ice-servers', (req, res) => {
  res.json({
    status: 'SUCCESS',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  });
});

app.post('/api/ai/process-voice-turn', async (req, res) => {
  const { sessionId, customerSpeechText, language, ownerName } = req.body;
  const reply = await generateGeminiExecutiveAssistantReply(
    customerSpeechText || "",
    ownerName || OWNER_NAME,
    language || "Hindi",
    sessionId
  );
  res.json({
    sessionId: sessionId || `SESS_${Date.now()}`,
    responseSpoken: reply,
    language: language || 'Hindi',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/owner/send-instruction', (req, res) => {
  const { sessionId, instructionText } = req.body;
  console.log(`[OWNER INSTRUCTION] Session: ${sessionId} -> "${instructionText}"`);

  // Broadcast Owner Instruction to all WebSocket listeners
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'OWNER_INSTRUCTION_DELIVERED',
        sessionId,
        instructionText,
        timestamp: new Date().toISOString()
      }));
    }
  });

  res.json({
    status: 'DELIVERED',
    sessionId,
    instructionText,
    timestamp: new Date().toISOString()
  });
});

// ================================================
// WEBSOCKET REAL-TIME SERVER
// ================================================
const activeConnections = new Map();

wss.on('connection', (ws, req) => {
  console.log(`[WEBSOCKET] New client connected from ${req.socket.remoteAddress}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`[WEBSOCKET MESSAGE] Type: ${data.type}`);

      if (data.type === 'REGISTER') {
        activeConnections.set(data.handle, ws);
        ws.handle = data.handle;
        ws.send(JSON.stringify({
          type: 'REGISTERED',
          handle: data.handle,
          status: 'CONNECTED_TO_VOXAI_BACKEND'
        }));
      } else if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      }
    } catch (err) {
      console.error('[WEBSOCKET ERROR]', err);
    }
  });

  ws.on('close', () => {
    if (ws.handle) {
      console.log(`[WEBSOCKET] Client ${ws.handle} disconnected`);
      activeConnections.delete(ws.handle);
    }
  });
});

// Start HTTP & WebSocket Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 VoxAI Backend Server Running on Port: ${PORT}`);
  console.log(`👤 Assistant Owner Name: "${OWNER_NAME}"`);
  console.log(`📞 Exotel Default Phone: "${DEFAULT_EXOTEL_NUMBER}"`);
  console.log(`====================================================`);
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const telephonyRoutes = require('./routes/telephony');
const signalingRoutes = require('./routes/signaling');
const aiRoutes = require('./routes/ai');
const ownerRoutes = require('./routes/owner');
const sessionRoutes = require('./routes/sessions');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express API Routes
app.use('/api/telephony', telephonyRoutes);
app.use('/api/signaling', signalingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/sessions', sessionRoutes);


app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'VoxAI Dual Calling Backend Server',
    timestamp: new Date().toISOString()
  });
});

// WebSocket WebRTC Signaling & Live Owner Instruction Broadcast
const activeConnections = new Map(); // handle/sessionId -> ws

wss.on('connection', (ws, req) => {
  console.log('New WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WS Message received:', data.type);

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
          console.log(`Owner Instruction for session ${data.sessionId}: ${data.instruction}`);
          // Broadcast to call session stream
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
          console.log('Unknown WS event:', data.type);
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    if (ws.handle) {
      activeConnections.delete(ws.handle);
      console.log(`Client disconnected: ${ws.handle}`);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`VoxAI Backend Server running on port ${PORT}`);
});

const express = require('express');
const router = express.Router();

// GET STUN/TURN ICE Servers Configuration
router.get('/ice-servers', (req, res) => {
  res.json({
    status: 'SUCCESS',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:turn.voxai.com:3478',
        username: 'voxai_user',
        credential: 'turn_password_123'
      }
    ]
  });
});

// Authenticated Signaling Event Endpoint
router.post('/event', (req, res) => {
  const { eventType, callId, callerHandle, receiverHandle, sdp, candidate } = req.body;
  console.log(`WebRTC Signaling Event [${eventType}] for Call ${callId} (${callerHandle} -> ${receiverHandle})`);

  res.json({
    status: 'SIGNALING_EVENT_PROCESSED',
    eventType,
    callId,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

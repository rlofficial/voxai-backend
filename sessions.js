const express = require('express');
const router = express.Router();

const activeBackendSessions = new Map(); // sessionId -> metadata
const processedIdempotencyKeys = new Set(); // idempotencyKey -> boolean

// Idempotency Middleware
function checkIdempotencyKey(req, res, next) {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (idempotencyKey) {
    if (processedIdempotencyKeys.has(idempotencyKey)) {
      console.log(`Duplicate webhook/request blocked by idempotency key: ${idempotencyKey}`);
      return res.status(200).json({ status: 'DUPLICATE_EVENT_IGNORED', idempotencyKey });
    }
    processedIdempotencyKeys.add(idempotencyKey);
  }
  next();
}

// Get Active Multi-Sessions
router.get('/active', (req, res) => {
  res.json({
    activeSessionCount: activeBackendSessions.size,
    sessions: Array.from(activeBackendSessions.values())
  });
});

// Register New Multi-Session
router.post('/register', checkIdempotencyKey, (req, res) => {
  const { sessionId, customerName, customerNumber, callType, assistantRole } = req.body;
  const sessionData = {
    sessionId,
    customerName: customerName || 'Caller',
    customerNumber,
    callType: callType || 'INTERNET_CALL',
    assistantRole: assistantRole || 'GENERAL',
    status: 'ACTIVE',
    startTime: new Date().toISOString()
  };

  activeBackendSessions.set(sessionId, sessionData);
  res.json({ status: 'SESSION_REGISTERED', session: sessionData });
});

// Terminate Session
router.post('/terminate', checkIdempotencyKey, (req, res) => {
  const { sessionId } = req.body;
  const existed = activeBackendSessions.delete(sessionId);
  res.json({ status: existed ? 'SESSION_TERMINATED' : 'SESSION_NOT_FOUND', sessionId });
});

module.exports = router;

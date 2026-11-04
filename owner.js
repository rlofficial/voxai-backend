const express = require('express');
const router = express.Router();

router.post('/send-instruction', (req, res) => {
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

module.exports = router;

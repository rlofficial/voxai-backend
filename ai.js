const express = require('express');
const router = express.Router();

router.post('/process-voice-turn', (req, res) => {
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

module.exports = router;

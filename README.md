# VoxAI Dual Calling Backend Server

Express.js + WebSocket Server for SIM Cloud Telephony Webhooks (Twilio/Exotel/Plivo), WebRTC Signaling, AI Voice Processing, and Live Owner Control.

## Features
- **Twilio / Exotel / Plivo Webhooks**: Handles inbound cloud calls and returns TwiML / Speech Gather XML.
- **WebRTC Signaling**: WebSocket server for peer-to-peer WebRTC signaling and ICE candidate exchange.
- **AI Voice Proxy**: Secure backend proxy for AI LLM and TTS voice synthesis.
- **Live Owner Instruction Streaming**: Isolated session routing for live owner chat instructions.

## Installation & Running
```bash
npm install
npm start
```
Default server port: `8080`.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Jarvis Voice Backend' }));

// Main Android Jarvis Endpoint
app.post('/api/jarvis', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const audioPath = req.file.path;
  console.log(`[JARVIS CLOUD] 📱 Request received: File=${req.file.originalname}, Size=${req.file.size} bytes`);

  try {
    // 1. Transcribe with Groq Whisper API (whisper-large-v3-turbo)
    const startTime = Date.now();
    const userText = await transcribeWithGroq(audioPath);
    const transcribeTimeMs = Date.now() - startTime;

    console.log(`[JARVIS CLOUD] 🎤 Groq Transcribed: "${userText}" (${transcribeTimeMs}ms)`);

    cleanupFiles([audioPath]);

    if (!userText || userText.length < 2) {
      return res.json({ text: '', response: '', action: null });
    }

    // 2. Process with Gemini AI for Jarvis Response & Action Detection
    const jarvisResponse = await getJarvisGeminiResponse(userText);

    console.log(`[JARVIS CLOUD] 🤖 Response: "${jarvisResponse.response}"`);
    if (jarvisResponse.action) {
      console.log(`[JARVIS CLOUD] ⚡ Action: ${JSON.stringify(jarvisResponse.action)}`);
    }

    res.json({
      text: userText,
      response: jarvisResponse.response,
      correctedText: userText,
      action: jarvisResponse.action,
      metrics: { transcribeTimeMs }
    });

  } catch (err) {
    console.error('[JARVIS CLOUD Error]', err);
    cleanupFiles([audioPath]);
    res.status(500).json({ error: 'Cloud processing failed', details: err.message });
  }
});

// Transcribe Audio via Groq Whisper API
async function transcribeWithGroq(filePath) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not configured.');
  }

  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });

  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('prompt', 'Hinglish speech: Hello mera naam. YouTube open karo. WhatsApp pe message bhejo.');
  formData.append('temperature', '0.0');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

// Generate Gemini Response & Action Extraction
async function getJarvisGeminiResponse(userText) {
  if (!GEMINI_API_KEY) {
    return { response: "Gemini API Key missing on server.", action: null };
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are Jarvis, an AI voice assistant running on an Android phone. The user spoke to you.

User said: "${userText}"

Respond as a helpful, concise voice assistant (1-2 short sentences max).

Detect if user wants to perform an Android action:
- Open app (WhatsApp, YouTube, Chrome, Spotify, Instagram, Settings, Camera, etc.)
- Make phone call
- Send WhatsApp message
- Search web

Output ONLY valid JSON:
{
  "response": "Your response text",
  "action": null or { "type": "OPEN_APP|CALL|WHATSAPP_MSG|WEB_SEARCH", "target": "app_name_or_contact", "data": "optional_data" }
}`
          }]
        }]
      })
    });

    const data = await response.json();
    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
      let raw = data.candidates[0].content.parts[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        const parsed = JSON.parse(raw);
        return { response: parsed.response || raw, action: parsed.action || null };
      } catch (_) {
        return { response: raw, action: null };
      }
    }
    return { response: "I heard you!", action: null };
  } catch (e) {
    console.error('[Gemini Error]', e);
    return { response: "Processing error.", action: null };
  }
}

function cleanupFiles(files) {
  files.forEach(f => {
    if (f && fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  });
}

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Jarvis Cloud Backend listening on port ${PORT}`);
  console.log(`===============================================`);
});

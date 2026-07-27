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

// Read pool of Groq API Keys from environment variable (comma-separated)
const rawKeys = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '';
const GROQ_API_KEYS = rawKeys
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

let currentKeyIndex = 0;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Health check endpoint
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'Jarvis Voice Backend', 
  activeKeysCount: GROQ_API_KEYS.length 
}));

// Main Android Jarvis Endpoint
app.post('/api/jarvis', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const audioPath = req.file.path;
  console.log(`[JARVIS CLOUD] 📱 Request received: File=${req.file.originalname}, Size=${req.file.size} bytes`);

  try {
    // 1. Transcribe with Groq Whisper API (with multi-key failover pool)
    const startTime = Date.now();
    const userText = await transcribeWithGroqFallback(audioPath);
    const transcribeTimeMs = Date.now() - startTime;

    console.log(`[JARVIS CLOUD] 🎤 Transcribed: "${userText}" (${transcribeTimeMs}ms)`);

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

// Transcribe Audio via Groq Whisper API with Multi-Key Failover
async function transcribeWithGroqFallback(filePath) {
  if (GROQ_API_KEYS.length === 0) {
    throw new Error('GROQ_API_KEYS environment variable is missing or empty.');
  }

  let attempts = 0;
  const maxAttempts = GROQ_API_KEYS.length;

  while (attempts < maxAttempts) {
    const apiKey = GROQ_API_KEYS[currentKeyIndex];
    const keyLabel = `Key #${currentKeyIndex + 1} (${apiKey.substring(0, 8)}...)`;

    try {
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: 'audio/wav' });

      formData.append('file', blob, 'audio.wav');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('temperature', '0.0');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        return (data.text || '').trim();
      }

      console.warn(`[Groq Fallback] ${keyLabel} returned HTTP ${response.status}. Rotating to next key...`);
    } catch (err) {
      console.warn(`[Groq Fallback] ${keyLabel} error: ${err.message}. Rotating to next key...`);
    }

    // Rotate to next key in the pool
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_API_KEYS.length;
    attempts++;
  }

  throw new Error('All Groq API keys in pool failed or reached rate limits.');
}

// Generate Gemini Response & Action Extraction (with local Intent Fallback)
async function getJarvisGeminiResponse(userText) {
  const lowerText = userText.toLowerCase();
  
  // Rule-based fast action extraction (Supports English + Devanagari Hindi!)
  let localAction = null;
  let localResponse = `I heard: "${userText}"`;

  const isYouTube = lowerText.includes('youtube') || lowerText.includes('यूट्यूब');
  const isWhatsApp = lowerText.includes('whatsapp') || lowerText.includes('व्हाट्सएप') || lowerText.includes('व्हाट्सऐप');
  const isSpotify = lowerText.includes('spotify') || lowerText.includes('स्पॉटीफाई');
  const isChrome = lowerText.includes('chrome') || lowerText.includes('क्रोम') || lowerText.includes('google');
  const isCamera = lowerText.includes('camera') || lowerText.includes('कैमरा');
  const isCall = lowerText.includes('call') || lowerText.includes('कॉल');

  if (isYouTube) {
    const playMatch = lowerText.match(/(?:play|प्ले|सोंग|गाना)\s+(.+)/i);
    const dataQuery = playMatch ? playMatch[1] : '';
    localAction = { type: 'OPEN_APP', target: 'youtube', data: dataQuery };
    localResponse = dataQuery ? `Opening YouTube to play ${dataQuery}!` : 'Opening YouTube for you!';
  } else if (isWhatsApp) {
    const msgMatch = lowerText.match(/(?:text|message|संदेश|मैसेज|hii|hi|to)\s+(.+)/i);
    const recipient = msgMatch ? msgMatch[1] : 'Sagar';
    localAction = { type: 'WHATSAPP_MSG', target: recipient, data: 'Hello from Jarvis!' };
    localResponse = `Opening WhatsApp to message ${recipient}!`;
  } else if (isSpotify) {
    localAction = { type: 'OPEN_APP', target: 'spotify' };
    localResponse = 'Opening Spotify!';
  } else if (isChrome) {
    localAction = { type: 'OPEN_APP', target: 'chrome' };
    localResponse = 'Opening Chrome browser!';
  } else if (isCamera) {
    localAction = { type: 'OPEN_APP', target: 'camera' };
    localResponse = 'Opening Camera!';
  } else if (isCall) {
    localAction = { type: 'CALL', target: 'Sagar' };
    localResponse = 'Calling Sagar...';
  }

  // FAST-PATH: If an action command was matched, return IMMEDIATELY (0ms latency, zero API rate limits!)
  if (localAction !== null) {
    console.log(`[JARVIS FAST-PATH] ⚡ Executing instant action: type=${localAction.type}, target=${localAction.target}`);
    return { response: localResponse, action: localAction, automation_steps: null };
  }

  if (!GEMINI_API_KEY) {
    console.warn('[JARVIS] GEMINI_API_KEY is not set on server. Using rule-based fallback.');
    return { response: localResponse, action: localAction, automation_steps: null };
  }

  // Try multiple Gemini models in case of rate limits (gemini-2.0-flash -> gemini-1.5-flash -> gemini-2.5-flash)
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  
  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are Jarvis, an intelligent voice assistant on an Android phone.

User said: "${userText}"

Task:
1. Provide a short, smart, conversational reply (1 sentence max).
2. Detect if the user wants to execute an Android action:
   - OPEN_APP: User wants to open or launch an app (e.g. YouTube, WhatsApp, Spotify, Chrome, Camera, Instagram, Settings, Maps, Phone, etc.).
   - CALL: User wants to call a contact.
   - WHATSAPP_MSG: User wants to send a WhatsApp message.
   - WEB_SEARCH: User wants to search for something or play a song on YouTube.

Output ONLY valid JSON format:
{
  "response": "Short verbal response here",
  "action": null OR { "type": "OPEN_APP|CALL|WHATSAPP_MSG|WEB_SEARCH", "target": "app_or_contact_name", "data": "optional" }
}`
            }]
          }]
        })
      });

      const data = await response.json();
      if (response.ok && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
        let raw = data.candidates[0].content.parts[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        try {
          const parsed = JSON.parse(raw);
          return { 
            response: parsed.response || localResponse, 
            action: parsed.action || localAction,
            automation_steps: parsed.automation_steps || null
          };
        } catch (_) {
          return { response: raw, action: localAction, automation_steps: null };
        }
      }
      console.warn(`[Gemini Model ${model} Warning] Status ${response.status}:`, data.error?.message || 'Rate limited, trying next model...');
    } catch (e) {
      console.error(`[Gemini Error on ${model}]`, e);
    }
  }

  // Fallback to local rule-based intent if all Gemini models are rate-limited
  return { response: localResponse, action: localAction, automation_steps: null };
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
  console.log(`🔑 Active Groq Key Pool Size: ${GROQ_API_KEYS.length}`);
  console.log(`===============================================`);
});

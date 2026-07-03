const express = require('express');
const multer = require('multer');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Config Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDn-avU-cO1cGu-iPrIwhdAejN2GmGSvEk';

// Track current model in the whisper-server
let currentModel = 'small';
let whisperServerProcess = null;

// Function to start whisper-server in the background
function startWhisperServer() {
  const modelPath = path.join(__dirname, 'whisper.cpp', 'models', `ggml-${currentModel}.bin`);
  const serverBin = path.join(__dirname, 'whisper.cpp', 'build', 'bin', 'whisper-server');
  
  console.log(`[ASR Server] Spawning whisper-server on port 8080 with model ${currentModel}...`);
  
  whisperServerProcess = spawn(serverBin, [
    '-m', modelPath,
    '--port', '8080',
    '--host', '127.0.0.1',
    '-t', '4',
    '--no-fallback'
  ]);
  
  whisperServerProcess.stdout.on('data', (data) => {
    // console.log(`[Whisper Server] ${data}`);
  });
  
  whisperServerProcess.stderr.on('data', (data) => {
    // Optionally log some output
    const msg = data.toString();
    if (msg.includes('error') || msg.includes('fail') || msg.includes('listening')) {
      console.log(`[Whisper Server log] ${msg.trim()}`);
    }
  });
  
  whisperServerProcess.on('close', (code) => {
    console.log(`[ASR Server] whisper-server exited with code ${code}`);
  });
}

// Start the server
startWhisperServer();

// Clean up child process on exit
const cleanUpAndExit = () => {
  if (whisperServerProcess) {
    console.log('[ASR Server] Stopping background whisper-server...');
    whisperServerProcess.kill();
  }
  process.exit();
};
process.on('exit', cleanUpAndExit);
process.on('SIGINT', cleanUpAndExit);
process.on('SIGTERM', cleanUpAndExit);

async function correctTextWithGemini(rawText) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are an ASR correction module for a Hindi/Hinglish voice assistant.
Your job is to read a raw, potentially misspelled Hindi/Hinglish speech-to-text transcript and return the corrected, natural version.
Fix phonetically written Hinglish words and spelling errors (e.g. अपन्मेंट/अपॉइंटमेंट -> appointment, सिप्ट -> shift, वोट साप -> WhatsApp, रिहाप -> rehab, फिटनेस -> fitness, प्रुजक -> project, वीए/बिया -> VA, नोड -> Node, सम्वार्हें -> सोमवार है).
Preserve the sentence's grammatical structure, language, and meaning.
Return ONLY the corrected sentence. Do not add any conversational text, notes, or explanations.

Input: "${rawText}"
Output:`
          }]
        }],
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      })
    });

    const data = await response.json();
    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text.trim();
    }
    return rawText;
  } catch (e) {
    console.error('[Gemini API Error]', e);
    return rawText;
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Transcribe API
app.post('/api/transcribe', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const model = req.body.model || 'small';
  const lang = req.body.lang || 'hi';
  const enableLlm = req.body.llmCorrection === 'true';
  
  const inputPath = req.file.path;
  const outputPath = path.join(UPLOADS_DIR, `${Date.now()}_converted.wav`);
  const modelPath = path.join(__dirname, 'whisper.cpp', 'models', `ggml-${model}.bin`);
  
  if (!fs.existsSync(modelPath)) {
    fs.unlinkSync(inputPath);
    return res.status(400).json({ error: `Model ggml-${model}.bin not found locally. Please download it first.` });
  }

  console.log(`[ASR] New request: File=${req.file.originalname}, Model=${model}, Language=${lang}, LLMCorrection=${enableLlm}`);

  // Step 1: Convert audio to 16kHz mono WAV using ffmpeg
  const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`;
  
  exec(ffmpegCmd, async (ffmpegErr, ffmpegStdout, ffmpegStderr) => {
    if (ffmpegErr) {
      console.error('[FFmpeg Error]', ffmpegErr);
      cleanupFiles([inputPath, outputPath]);
      return res.status(500).json({ error: 'Failed to process audio format' });
    }

    try {
      // Step 2: Dynamic Model Switching
      if (model !== currentModel) {
        console.log(`[ASR] Switching whisper-server model from ${currentModel} to ${model}...`);
        const loadFormData = new FormData();
        loadFormData.append('model', modelPath);

        const loadResponse = await fetch('http://127.0.0.1:8080/load', {
          method: 'POST',
          body: loadFormData
        });

        if (loadResponse.ok) {
          currentModel = model;
          console.log(`[ASR] whisper-server model successfully loaded: ${model}`);
        } else {
          console.error('[ASR Load Error] Failed to switch model on whisper-server');
          cleanupFiles([inputPath, outputPath]);
          return res.status(500).json({ error: 'Failed to load model on transcription server' });
        }
      }

      // Step 3: Perform Inference on whisper-server
      const startInference = Date.now();
      const whisperFormData = new FormData();
      const fileBuffer = fs.readFileSync(outputPath);
      whisperFormData.append('file', new Blob([fileBuffer]), 'recording.wav');
      whisperFormData.append('language', lang);
      whisperFormData.append('temperature', '0.0');
      whisperFormData.append('temperature_inc', '0.0');
      whisperFormData.append('no_timestamps', 'true');

      const whisperResponse = await fetch('http://127.0.0.1:8080/inference', {
        method: 'POST',
        body: whisperFormData
      });

      // Cleanup files
      cleanupFiles([inputPath, outputPath]);

      if (!whisperResponse.ok) {
        console.error('[ASR Error] whisper-server inference request failed');
        return res.status(500).json({ error: 'Inference request failed' });
      }

      const whisperData = await whisperResponse.json();
      const rawText = (whisperData.text || '').trim();
      const inferenceTimeMs = Date.now() - startInference;

      console.log(`[ASR] Raw Result: "${rawText}" (Inference Latency: ${inferenceTimeMs}ms)`);
      
      let correctedText = null;
      if (enableLlm && rawText) {
        console.log('[ASR] Calling Gemini API for correction...');
        correctedText = await correctTextWithGemini(rawText);
        console.log(`[ASR] Corrected Result: "${correctedText}"`);
      }

      res.json({
        text: rawText,
        correctedText: correctedText,
        metrics: {
          loadTimeMs: 0, // Model is hot-loaded
          transcribeTimeMs: inferenceTimeMs,
          detectedLang: lang === 'auto' ? 'auto' : lang
        }
      });

    } catch (err) {
      console.error('[Inference pipeline Error]', err);
      cleanupFiles([inputPath, outputPath]);
      return res.status(500).json({ error: 'ASR pipeline failed' });
    }
  });
});

// Helper: Clean up files
function cleanupFiles(files) {
  files.forEach(file => {
    if (file && fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        console.error(`Failed to delete temp file ${file}:`, e);
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 ASR Test Server listening at http://localhost:${PORT}`);
  console.log(`===============================================`);
});

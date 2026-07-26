const { Room, AudioSource, AudioFrame, AudioStream } = require('@livekit/rtc-node');
const { AccessToken } = require('livekit-server-sdk');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { processJarvisTurn } = require('./jarvis_agent.js');
const { fetchHistory, fetchState } = require('./convex_client.js');

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const roomName = process.argv[2] || 'jarvis-call-room';
const sessionId = `livekit-session-${roomName}`;

let room = null;
let audioSource = null;
let isSpeaking = false;
let userAudioBuffer = [];
let silenceTimer = null;
let isAgentPlaying = false;
let agentPlaybackQueue = [];

// Helper: Calculate RMS (Root Mean Square) volume of PCM Int16 samples
function calculateRMS(int16Array) {
  let sum = 0;
  for (let i = 0; i < int16Array.length; i++) {
    const val = int16Array[i] / 32768.0; // Normalize to -1.0 to 1.0
    sum += val * val;
  }
  return Math.sqrt(sum / int16Array.length);
}

// Convert PCM s16le array to WAV file
function savePcmToWav(pcmBuffer, filePath, sampleRate = 16000) {
  const buffer = Buffer.concat(pcmBuffer);
  const wavHeader = Buffer.alloc(44);
  
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + buffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM format
  wavHeader.writeUInt16LE(1, 22); // Mono
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * 2, 28); // Byte rate (16000 * 2)
  wavHeader.writeUInt16LE(2, 32); // Block align
  wavHeader.writeUInt16LE(16, 34); // Bits per sample
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(buffer.length, 40);

  fs.writeFileSync(filePath, Buffer.concat([wavHeader, buffer]));
}

async function run() {
  console.log(`[LiveKit Agent] Starting voice agent for room: ${roomName}...`);

  // 1. Generate connection token for Jarvis Agent
  const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
  const at = new AccessToken(apiKey, apiSecret, { identity: 'jarvis-agent' });
  at.addGrant({ roomJoin: true, room: roomName, publisherModel: true });
  const token = await at.toJwt();

  // 2. Connect to Room
  room = new Room();
  await room.connect(LIVEKIT_URL, token);
  console.log(`[LiveKit Agent] Connected to: ${LIVEKIT_URL}`);

  // 3. Create and publish audio source track (24kHz mono PCM responses)
  audioSource = new AudioSource(24000, 1);
  await room.localParticipant.publishTrack(audioSource, {
    name: 'jarvis-voice',
    source: 2 // AudioTrack source type
  });
  console.log('[LiveKit Agent] Published voice output track.');

  // 4. Handle incoming user audio streams
  room.on('trackSubscribed', (track, publication, participant) => {
    if (track.kind === 'audio' && participant.identity !== 'jarvis-agent') {
      console.log(`[LiveKit Agent] Subscribed to ${participant.identity}'s microphone.`);
      
      const audioStream = new AudioStream(track);
      audioStream.on('data', (frame) => {
        // Frame is PCM 16-bit (typically 48kHz, mono or stereo depending on Livekit client)
        const int16Data = new Int16Array(frame.data.buffer, frame.data.byteOffset, frame.data.length / 2);
        
        // Calculate volume level
        const volume = calculateRMS(int16Data);
        const threshold = 0.015; // Noise gate volume threshold

        if (volume > threshold) {
          // Barge-in check: If user interrupts Jarvis, stop current agent speech
          if (isAgentPlaying) {
            console.log('[LiveKit Agent] User interruption detected! Muting agent track...');
            isAgentPlaying = false;
            agentPlaybackQueue = []; // Clear current speech queue
          }

          if (!isSpeaking) {
            console.log('[LiveKit Agent] User started speaking...');
            isSpeaking = true;
            userAudioBuffer = [];
          }

          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }

          userAudioBuffer.push(Buffer.from(frame.data));
        } else if (isSpeaking) {
          userAudioBuffer.push(Buffer.from(frame.data));
          
          if (!silenceTimer) {
            // Wait 600ms of silence before declaring speech end
            silenceTimer = setTimeout(() => {
              isSpeaking = false;
              console.log('[LiveKit Agent] User stopped speaking. Processing speech turn...');
              processUserSpeech();
            }, 600);
          }
        }
      });
    }
  });

  // Start the background frame playback loop
  playbackLoop();
}

async function processUserSpeech() {
  if (userAudioBuffer.length === 0) return;

  const tempInputPath = path.join(__dirname, `uploads/temp_${Date.now()}.wav`);
  const tempASRPath = tempInputPath.replace('.wav', '_16k.wav');

  try {
    // Save raw audio buffer (typically 48kHz from browser client)
    savePcmToWav(userAudioBuffer, tempInputPath, 48000);
    userAudioBuffer = [];

    // Downsample to 16kHz WAV for whisper-server
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i "${tempInputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${tempASRPath}"`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('[LiveKit Agent ASR] Running local Whisper transcription...');
    const startInference = Date.now();
    const whisperFormData = new FormData();
    const fileBuffer = fs.readFileSync(tempASRPath);
    whisperFormData.append('file', new Blob([fileBuffer]), 'recording.wav');
    whisperFormData.append('language', 'hi');
    whisperFormData.append('temperature', '0.0');
    whisperFormData.append('no_timestamps', 'true');

    const whisperResponse = await fetch('http://127.0.0.1:8080/inference', {
      method: 'POST',
      body: whisperFormData
    });

    // Cleanup temp files
    try {
      fs.unlinkSync(tempInputPath);
      fs.unlinkSync(tempASRPath);
    } catch (e) {}

    if (!whisperResponse.ok) {
      console.error('[LiveKit Agent ASR Error] whisper-server request failed');
      return;
    }

    const whisperData = await whisperResponse.json();
    const rawText = (whisperData.text || '').trim();
    console.log(`[LiveKit Agent ASR] Transcript: "${rawText}" (${Date.now() - startInference}ms)`);

    if (rawText.length < 3) return;

    // Call Jarvis Multi-turn agent logic
    console.log('[LiveKit Agent Logic] Resolving conversational turn...');
    
    // We check if it is a search intent to pre-fetch context (1 single LLM call)
    let searchContext = '';
    const isSearchIntent = rawText.toLowerCase().includes('list') || 
                           rawText.toLowerCase().includes('search') ||
                           rawText.toLowerCase().includes('restaurant') ||
                           rawText.toLowerCase().includes('hotel') ||
                           rawText.toLowerCase().includes('find');
                           
    if (isSearchIntent) {
      const { searchWebAndRank } = require('./search_orchestrator.js');
      searchContext = await searchWebAndRank(rawText);
    }

    const agentResult = await processJarvisTurn(sessionId, rawText, GEMINI_API_KEY, searchContext);
    console.log(`[LiveKit Agent Logic] Response text: "${agentResult.response}"`);

    // Synthesize audio
    console.log('[LiveKit Agent TTS] Generating verbal audio response...');
    const audioContentBase64 = await synthesizeIndicTTSBuffer(agentResult.response, 'hi');
    if (audioContentBase64) {
      queueAgentResponse(audioContentBase64);
    }

  } catch (err) {
    console.error('[LiveKit Agent Turn Error]', err);
    try {
      fs.unlinkSync(tempInputPath);
      fs.unlinkSync(tempASRPath);
    } catch (e) {}
  }
}

// Synthesize response using Google fallback or local server
async function synthesizeIndicTTSBuffer(text, lang = 'hi') {
  try {
    // Call Google TTS API fallback directly to get base64 audio
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (!response.ok) throw new Error('Google TTS request failed');
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    console.error('[LiveKit Agent TTS Error] Fallback failed:', err.message);
    return null;
  }
}

// Decode response audio buffer to raw 24kHz PCM and queue it
function queueAgentResponse(wavBuffer) {
  // WAV header is 44 bytes. We slice it to get raw s16le PCM
  const rawPcm = wavBuffer.slice(44);
  
  // Split into 20ms frames (24kHz Mono = 480 samples = 960 bytes per frame)
  const frameSize = 960;
  const frames = [];
  
  for (let offset = 0; offset < rawPcm.length; offset += frameSize) {
    const chunk = rawPcm.slice(offset, offset + frameSize);
    if (chunk.length === frameSize) {
      frames.push(chunk);
    }
  }
  
  agentPlaybackQueue = frames;
  isAgentPlaying = true;
  console.log(`[LiveKit Agent Playback] Queued ${frames.length} audio frames.`);
}

// Send 20ms chunks continuously to WebRTC track
async function playbackLoop() {
  while (true) {
    if (isAgentPlaying && agentPlaybackQueue.length > 0) {
      const chunk = agentPlaybackQueue.shift();
      
      // Capture frame expects: Int16 samples (480 samples @ 24kHz = 20ms)
      const int16Array = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
      const audioFrame = new AudioFrame(int16Array, 24000, 1, int16Array.length);
      
      await audioSource.captureFrame(audioFrame);
      
      if (agentPlaybackQueue.length === 0) {
        isAgentPlaying = false;
        console.log('[LiveKit Agent Playback] Finished response.');
      }
    }
    // Sleep 20ms
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

run().catch(err => {
  console.error('[LiveKit Agent Fatal Error]', err);
  process.exit(1);
});

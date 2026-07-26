# BRAIN.md — Indic Voice Infrastructure (India-First Vapi)

## Background
Indic Voice Infrastructure is a developer platform for building real-time, multilingual, and tool-connected voice agents optimized for the Indian market. Current voice platforms (Vapi, Retell, Bland AI) are optimized for Western accents, English, and generic speech. They fail in India due to code-switching (Hinglish/Gujarish), heavy regional accents, and domain-specific terms. This project provides a voice-native infrastructure layer optimized for Indic languages (starting with Hindi and Gujarati) and specialized domain verticals (initially dental/healthcare clinics).

---

## Architecture
The system is designed as a 9-layer real-time voice-native stack:

```
[Layer 1: Audio Transport (LiveKit WebRTC)]
                    │
                    ▼
[Layer 2: Voice Detection (Silero VAD)]  ◄── Detects speech start, stop, & silence
                    │
                    ▼
[Layer 3: ASR Engine (whisper.cpp / faster-whisper)]
                    │
                    ▼
[Layer 4: ASR Correction (Domain Dict + LLM Cascade)]  ◄── Fixes Hinglish typos
                    │
                    ▼
[Layer 5: Intent Prediction (Local ONNX Semantic Similarity)]  ◄── Speculative intent
                    │
                    ▼
[Layer 6: Turn Prediction (Speech Shadowing / Predictive Coding)] ◄── Anticipates stop
                    │
                    ▼
[Layer 7: Reasoning Layer (Gemini / OpenAI)]  ◄── Executed once per turn-commit
                    │
                    ▼
[Layer 8: Tool Execution (Calendar, WhatsApp, CRM APIs)]
                    │
                    ▼
[Layer 9: TTS Engine (Indic Parler / Coqui TTS)]
                    │
                    ▼
[LiveKit Audio Out (0ms Response Latency Target)]
```

### The 9 Layers:
1.  **Audio Transport:** Real-time WebRTC streams, rooms, telephony, and interruption handling via **LiveKit**.
2.  **Voice Detection:** Speech start/stop detection and silence filtering via **Silero VAD**.
3.  **ASR Engine:** Local GPU-hot inference via **whisper.cpp** (edge) and cloud scalability via **faster-whisper**.
4.  **ASR Correction Engine:** Merges raw ASR transcripts with a domain dictionary and runs a gated LLM cascade to clean phonetic Hinglish typos (e.g., `"वाडशा बिनुस"` ──► `"WhatsApp Business"`).
5.  **Intent Prediction Engine:** Speculative intent parsing on partial transcripts using local multilingual sentence embeddings (ONNX) to predict needs before the speaker finishes.
6.  **Turn Prediction Engine:** Evaluates pitch, pause length, and semantic completeness to predict exactly when the user will stop talking, allowing the reasoning model to think ahead.
7.  **Reasoning Layer:** Paid cloud LLM (Gemini/OpenAI) invoked exactly once per turn-commit for tool planning and conversational response.
8.  **Tool Execution:** Real-world API actions (booking slots, sending WhatsApp notifications, updating CRMs).
9.  **TTS Engine:** Natural Indic speech synthesis using specialized engines like **Indic Parler** or **Coqui TTS** (supporting Hindi, Gujarati, Marathi, Tamil, Bengali).

---

## Tech Stack & Key Dependencies
*   **LiveKit (WebRTC):** Chosen over vanilla WebSockets or Twilio Media Streams for its native handling of sub-100ms WebRTC streams, room routing, built-in interruption logic, and telephony bridges.
*   **whisper.cpp:** Chosen for local development and edge deployments to achieve ~400ms-600ms transcription times with Metal GPU acceleration on macOS.
*   **faster-whisper:** Selected as the target cloud deployment engine for its optimized C++ runtime and batching efficiency.
*   **Silero VAD:** Selected as the VAD standard for its high accuracy across low-bandwidth microphone signals, implemented directly in the whisper-server CLI flags.
*   **ONNX Runtime (`@huggingface/transformers`):** Chosen for local intent classification to process multilingual embeddings (`paraphrase-multilingual-MiniLM-L12-v2`) in <15ms with $0 cloud cost.
*   **Google Gemini API:** Chosen as the primary cloud reasoning layer due to the latency benefits of setting `thinkingBudget: 0`.

---

## Key Decisions & Rationale
*   **Model-Cascading Fallbacks (July 2026):** Implemented a automatic retry sequence (`gemini-2.5-flash` ──► `gemini-2.5-flash-lite` ──► `gemini-1.5-flash`) to ensure system resilience when a key hits Google's 15–20 RPM Free Tier limits.
*   **Local-First Speculative Gating (July 2026):** Restructured the real-time simulation tab to score incoming speech segments locally. Cloud LLM calls only fire when local intent confidence is high and speculation hasn't yet occurred for the active turn, preventing 429 quota exhaustion.
*   **Auto-Stop Recording on Tab Toggle (July 2026):** Implemented auto-stop listeners in the browser UI when switching views. This guarantees that leaving the "Cognitive Simulation" tab stops background microphone streaming, preventing silent quota drain.

---

## Rejected Approaches
*   **Spawning Sequential CLI Commands:** Spawning a fresh CLI process on every audio input added 1.1s of model-load latency. Replaced with a daemonized `whisper-server` process that keeps the model hot in GPU memory.
*   **Naive Chunk-by-Chunk Speculation:** Triggering a cloud LLM query on every 1.5s audio chunk was abandoned due to high cloud cost, latency, and rapid API quota exhaustion. Replaced with local semantic classification thresholds.

---

## Constraints & Non-Obvious Gotchas
*   **Free-Tier Rate Limits:** The Google AI Studio free tier restricts requests to 15-20 RPM. Speculative streaming must be gated aggressively.
*   **Phonetic Spelling Failures:** Traditional regex or string-matching classifiers fail on phonetic speech anomalies (e.g. transcribing "appointment" as "अपन्मेंट" or "WhatsApp" as "वोट साप"). Classifier rules must use semantic embeddings to handle Hinglish typo mapping.

---

## Current State (Compiled Truth)
*   **Layer 2 (VAD) & Layer 3 (ASR):** Built and verified locally using `whisper-server` + Silero VAD flags. Transcribes Hindi and Hinglish speech.
*   **Layer 4 (ASR Correction) & Layer 7 (Reasoning):** Fully operational with the Gemini cascade pipeline.
*   **Layer 5 (Intent Engine):** Pure JavaScript keyword matcher currently handles 9 receptionist intents (greeting, booking, pricing, etc.). Ready to be upgraded to ONNX embeddings.
*   **UI Sandbox:** A dashboard with tabs for standard file upload, microphone transcription, and speculative cognitive streaming testing.

---

## Open Questions & Roadmap
1.  **Telephony & LiveKit Integration (Layer 1):** Set up a LiveKit WebRTC server to pipe audio streams directly to the Node.js backend.
2.  **Multilingual ONNX Embedding Classifier (Layer 5):** Integrate `@huggingface/transformers` to replace the keyword-based `intent_classifier.js` with semantic vectors.
3.  **Turn-Taking Model (Layer 6):** Prototype pitch and pause-length metrics to predict turn-completion.
4.  **Indic TTS Engine (Layer 9):** Implement a low-latency text-to-speech engine supporting Hindi and Gujarati voices.

---

## How to Use This File
Read this file before making architectural changes to the voice stack, changing dependencies, or implementing new pipeline layers. Update it in place as decisions evolve; let git history preserve the timeline.

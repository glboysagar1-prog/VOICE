// semantic_classifier.js — Local semantic intent classifier using sentence embeddings

let pipeline = null;
let embedder = null;
let referenceVectors = {};

// Reference intent samples mapping to Devanagari, English, and Hinglish clinic receptionist categories
const INTENT_REFERENCES = {
  book_appointment: [
    "appointment book karni hai",
    "appointment book karna hai",
    "डॉक्टर से मिलना है",
    "appointment slot chahiye",
    "checkup ke liye time",
    "appointment book kardo",
    "mujhe appointment chahiye"
  ],
  cancel_appointment: [
    "appointment cancel kar do",
    "कैंसिल करना है",
    "nahi aa paunga appointment hata do",
    "cancel booking",
    "hatao appointment",
    "booking cancel kardo"
  ],
  reschedule: [
    "appointment reschedule karna hai",
    "shift appointment tomorrow",
    "टाइम बदल दीजिए",
    "postpone meeting",
    "appointment shift kardo",
    "dusre time shift kardo"
  ],
  price_inquiry: [
    "rct ka kitna kharcha aayega",
    "fees kitni hai",
    "cleaning ki cost kya hai",
    "treatment price",
    "kitne paise lagenge",
    "charges kitne hai"
  ],
  availability: [
    "doctor kab milenge",
    "slots available hai kya",
    "doctor checkup free timing",
    "doctor cabin me kab aayenge",
    "kya doctor available hai"
  ],
  greeting: [
    "hello doctor",
    "namaste clinic",
    "hi receptionist",
    "hello",
    "नमस्ते"
  ],
  general_inquiry: [
    "whatsapp business kaise kaam karta hai",
    "वाडशा बिनुस कैसे काम करता है",
    "mujhe janna tha iske bare me",
    "information chahiye",
    "details batao",
    "what are cron jobs"
  ],
  clinic_search: [
    "create a list of dental clinics in vapi",
    "vapi me kitne dental clinic hai list banao",
    "find dentist clinics in vapi",
    "vapi ke dental clinics ki list",
    "list of dental clinics in vapi",
    "dental clinics in vapi"
  ]
};

// Helper: Cosine similarity between two arrays of numbers
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function initClassifier() {
  if (embedder) return;
  
  console.log('[Classifier] Loading local multilingual sentence transformer (Xenova/paraphrase-multilingual-MiniLM-L12-v2)...');
  
  // Dynamically load the ESM module package on first use
  if (!pipeline) {
    const transformers = await import('@huggingface/transformers');
    pipeline = transformers.pipeline;
  }

  // Runs the model in WebAssembly/ONNX Runtime locally
  embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  console.log('[Classifier] Pre-computing reference intent vectors...');
  for (const [intent, samples] of Object.entries(INTENT_REFERENCES)) {
    referenceVectors[intent] = [];
    for (const sample of samples) {
      try {
        const output = await embedder(sample, { pooling: 'mean', normalize: true });
        referenceVectors[intent].push(Array.from(output.data));
      } catch (e) {
        console.error(`[Classifier Error] Failed to embed reference phrase: "${sample}"`, e);
      }
    }
  }
  console.log('[Classifier] Initialization complete!');
}

async function classifyIntentSemantic(text) {
  if (!embedder) {
    await initClassifier();
  }
  if (!text || text.trim().length < 2) {
    return { intent: 'unknown', confidence: 0 };
  }

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const userVector = Array.from(output.data);

    let bestIntent = 'unknown';
    let maxScore = 0;

    for (const [intent, vectors] of Object.entries(referenceVectors)) {
      for (const refVector of vectors) {
        const score = cosineSimilarity(userVector, refVector);
        if (score > maxScore) {
          maxScore = score;
          bestIntent = intent;
        }
      }
    }

    return {
      intent: bestIntent,
      confidence: parseFloat(maxScore.toFixed(3))
    };
  } catch (err) {
    console.error('[Classifier Error] Semantic classification failed:', err);
    return { intent: 'unknown', confidence: 0 };
  }
}

module.exports = { initClassifier, classifyIntentSemantic, INTENT_REFERENCES };

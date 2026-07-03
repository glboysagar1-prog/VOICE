const GEMINI_API_KEY = 'AIzaSyDn-avU-cO1cGu-iPrIwhdAejN2GmGSvEk';

const models = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash"
];

async function testModel(modelName) {
  try {
    const start = Date.now();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Hello! If you are working, reply with 'Gemini API is Active'."
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
    const duration = Date.now() - start;
    if (response.ok) {
      console.log(`[OK] Model: ${modelName} | Latency: ${duration} ms | Reply: ${data.candidates[0].content.parts[0].text.trim()}`);
    } else {
      console.log(`[ERR] Model: ${modelName} | Status: ${response.status} | Msg: ${data.error ? data.error.message : 'Unknown'}`);
    }
  } catch (e) {
    console.log(`[EXC] Model: ${modelName} | Error: ${e.message}`);
  }
}

async function run() {
  for (const m of models) {
    await testModel(m);
  }
}

run();

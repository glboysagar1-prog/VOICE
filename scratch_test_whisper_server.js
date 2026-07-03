const fs = require('fs');

async function test() {
  try {
    console.log("Calling whisper-server /inference endpoint...");
    const start = Date.now();
    
    // Read local test file
    const fileBuffer = fs.readFileSync('audio_samples/bi_rehab.wav');
    
    // Build form data
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), 'bi_rehab.wav');
    formData.append('language', 'hi');
    formData.append('temperature', '0.0');
    formData.append('temperature_inc', '0.0'); // Disable temp increments (no retry loops)
    formData.append('no_timestamps', 'true');

    const response = await fetch('http://127.0.0.1:8080/inference', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    const duration = Date.now() - start;
    console.log(`Total Round-Trip Latency: ${duration} ms`);
    console.log("Response Status:", response.status);
    console.log("Response Data:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();

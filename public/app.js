document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const recordTab = document.getElementById('recordTab');
  const uploadTab = document.getElementById('uploadTab');

  // Config
  const modelSelect = document.getElementById('modelSelect');
  const langSelect = document.getElementById('langSelect');
  const llmCorrectionToggle = document.getElementById('llmCorrectionToggle');

  // Recorder Elements
  const recordBtn = document.getElementById('recordBtn');
  const recorderStatus = document.getElementById('recorderStatus');
  const visualizer = document.getElementById('visualizer');
  const canvasCtx = visualizer.getContext('2d');

  // File Upload Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const selectedFileInfo = document.getElementById('selectedFileInfo');
  const selectedFileName = document.getElementById('selectedFileName');
  const clearFileBtn = document.getElementById('clearFileBtn');

  // Actions & Output
  const transcribeBtn = document.getElementById('transcribeBtn');
  const loadingState = document.getElementById('loadingState');
  const resultsContent = document.getElementById('resultsContent');
  const metricsWrapper = document.getElementById('metricsWrapper');

  const loadTimeMetric = document.getElementById('loadTimeMetric');
  const transcribeTimeMetric = document.getElementById('transcribeTimeMetric');
  const audioDurationMetric = document.getElementById('audioDurationMetric');
  const rtfMetric = document.getElementById('rtfMetric');

  // State Variables
  let activeTab = 'record'; // 'record' or 'upload'
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let recordedBlob = null;
  let uploadedFile = null;
  let audioContext = null;
  let analyser = null;
  let dataArray = null;
  let source = null;
  let animationId = null;

  // Toggle Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      activeTab = btn.getAttribute('data-tab');
      if (activeTab === 'record') {
        recordTab.classList.remove('hidden');
        uploadTab.classList.add('hidden');
        checkInputState();
      } else {
        recordTab.classList.add('hidden');
        uploadTab.classList.remove('hidden');
        checkInputState();
      }
    });
  });

  // Enable/Disable Transcribe Button
  function checkInputState() {
    if (activeTab === 'record') {
      transcribeBtn.disabled = !recordedBlob;
    } else {
      transcribeBtn.disabled = !uploadedFile;
    }
  }

  // --- Recorder Logic ---

  recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  async function startRecording() {
    audioChunks = [];
    recordedBlob = null;
    checkInputState();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
        recorderStatus.textContent = 'Recording saved. Ready to transcribe!';
        checkInputState();
        stopVisualizer();
      };

      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add('recording');
      recorderStatus.textContent = 'Recording... click button to stop';
      
      setupVisualizer(stream);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      recorderStatus.textContent = 'Error: Microphone access denied';
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      // Stop microphone stream tracks
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      isRecording = false;
      recordBtn.classList.remove('recording');
    }
  }

  // --- Visualizer Logic ---

  function setupVisualizer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    drawVisualizer();
  }

  function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    
    analyser.getByteFrequencyData(dataArray);
    
    canvasCtx.fillStyle = 'rgba(11, 13, 25, 0.2)';
    canvasCtx.fillRect(0, 0, visualizer.width, visualizer.height);
    
    const barWidth = (visualizer.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;
    
    for (let i = 0; i < dataArray.length; i++) {
      barHeight = dataArray[i] / 3;
      
      // Indigo gradient colors
      canvasCtx.fillStyle = `rgb(${110 + barHeight * 2}, 99, 241)`;
      canvasCtx.fillRect(x, visualizer.height - barHeight, barWidth - 2, barHeight);
      
      x += barWidth;
    }
  }

  function stopVisualizer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (audioContext) {
      audioContext.close();
    }
    // Clear canvas
    canvasCtx.clearRect(0, 0, visualizer.width, visualizer.height);
  }

  // --- File Upload Logic ---

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  function handleFileSelect(file) {
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file.');
      return;
    }
    
    uploadedFile = file;
    selectedFileName.textContent = file.name;
    
    dropzone.classList.add('hidden');
    selectedFileInfo.classList.remove('hidden');
    checkInputState();
  }

  clearFileBtn.addEventListener('click', () => {
    uploadedFile = null;
    fileInput.value = '';
    
    dropzone.classList.remove('hidden');
    selectedFileInfo.classList.add('hidden');
    checkInputState();
  });

  // --- Transcribe Call ---

  transcribeBtn.addEventListener('click', async () => {
    const formData = new FormData();
    const model = modelSelect.value;
    const lang = langSelect.value;
    const enableLlm = llmCorrectionToggle.checked;

    formData.append('model', model);
    formData.append('lang', lang);
    formData.append('llmCorrection', enableLlm);

    if (activeTab === 'record') {
      if (!recordedBlob) return;
      formData.append('audio', recordedBlob, 'mic_recording.webm');
    } else {
      if (!uploadedFile) return;
      formData.append('audio', uploadedFile);
    }

    // UI Updates: Loading state
    transcribeBtn.disabled = true;
    loadingState.classList.remove('hidden');
    resultsContent.innerHTML = '';
    metricsWrapper.classList.add('hidden');

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      loadingState.classList.add('hidden');
      transcribeBtn.disabled = false;

      if (data.error) {
        resultsContent.innerHTML = `<div class="placeholder-text" style="color:var(--danger-color)">Error: ${data.error}</div>`;
        return;
      }

      // Output Results
      if (data.correctedText) {
        resultsContent.innerHTML = `
          <div class="result-box">
            <div class="result-section">
              <div class="result-title">Raw ASR Transcription</div>
              <div class="transcribed-text" style="border-left-color: var(--text-secondary); opacity: 0.7;">
                ${data.text || '[Silent or Unrecognized Speech]'}
              </div>
            </div>
            <div class="result-section">
              <div class="result-title">LLM Corrected Text</div>
              <div class="transcribed-text" style="border-left-color: var(--success-color); box-shadow: -4px 0 12px rgba(16, 185, 129, 0.15);">
                ${data.correctedText}
              </div>
            </div>
          </div>
        `;
      } else {
        resultsContent.innerHTML = `
          <div class="transcribed-text">
            ${data.text || '<span class="placeholder-text">[Silent or Unrecognized Speech]</span>'}
          </div>
        `;
      }

      // Output Metrics
      loadTimeMetric.textContent = `${data.metrics.loadTimeMs.toFixed(1)} ms`;
      transcribeTimeMetric.textContent = `${data.metrics.transcribeTimeMs.toFixed(1)} ms`;
      
      // Determine audio duration (approximate from blob size/rate, or we estimate from API)
      // Since express doesn't calculate duration, we estimate or parse it.
      // We can check if we got a duration back or we calculate it.
      // Let's compute duration on the backend in the future or let the browser compute it.
      // For now, we can read browser audio duration.
      let duration = 0;
      if (activeTab === 'record' && recordedBlob) {
        duration = await getAudioDuration(recordedBlob);
      } else if (uploadedFile) {
        duration = await getAudioDuration(uploadedFile);
      }

      audioDurationMetric.textContent = `${duration.toFixed(2)} s`;
      const rtf = (data.metrics.transcribeTimeMs / 1000.0) / duration;
      rtfMetric.textContent = isFinite(rtf) ? rtf.toFixed(3) : '0.00';

      // Update color coding of RTF (green is fast, yellow is medium, red is slow)
      if (rtf < 0.25) {
        rtfMetric.style.color = 'var(--success-color)';
      } else if (rtf < 0.5) {
        rtfMetric.style.color = '#eab308'; // Amber
      } else {
        rtfMetric.style.color = 'var(--danger-color)';
      }

      metricsWrapper.classList.remove('hidden');

    } catch (err) {
      console.error('Error during transcription:', err);
      loadingState.classList.add('hidden');
      transcribeBtn.disabled = false;
      resultsContent.innerHTML = `<div class="placeholder-text" style="color:var(--danger-color)">Network Error. Please make sure the server is running.</div>`;
    }
  });

  // Helper to read file/blob duration using standard HTML5 Audio
  function getAudioDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        resolve(0);
      });
    });
  }
});

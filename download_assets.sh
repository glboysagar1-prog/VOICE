#!/bin/bash
set -e

# Create directories
mkdir -p audio_samples/original

echo "=== Setting up test audio samples ==="

# 1. Process test_bi_001.wav if it exists in root, otherwise download
if [ -f "test_bi_001.wav" ]; then
    mv test_bi_001.wav audio_samples/original/bi_multiLingual_001.wav
else
    echo "Downloading Hinglish sample 1..."
    curl -sL https://huggingface.co/datasets/nameissakthi/hindi-english-bilingual/resolve/main/wavs/bi/bi_multiLingual_001.wav -o audio_samples/original/bi_multiLingual_001.wav
fi

# Convert sample 1 to 16kHz mono WAV
ffmpeg -y -i audio_samples/original/bi_multiLingual_001.wav -ar 16000 -ac 1 -c:a pcm_s16le audio_samples/bi_rehab.wav

# 2. Download Hinglish sample 2 (Facebook/WhatsApp)
echo "Downloading Hinglish sample 2..."
curl -sL https://huggingface.co/datasets/nameissakthi/hindi-english-bilingual/resolve/main/wavs/bi/bi_multiLingual_002.wav -o audio_samples/original/bi_multiLingual_002.wav
ffmpeg -y -i audio_samples/original/bi_multiLingual_002.wav -ar 16000 -ac 1 -c:a pcm_s16le audio_samples/bi_facebook.wav

# 3. Download Hinglish sample 3 (Flight/Liquid)
echo "Downloading Hinglish sample 3..."
curl -sL https://huggingface.co/datasets/nameissakthi/hindi-english-bilingual/resolve/main/wavs/bi/bi_multiLingual_003.wav -o audio_samples/original/bi_multiLingual_003.wav
ffmpeg -y -i audio_samples/original/bi_multiLingual_003.wav -ar 16000 -ac 1 -c:a pcm_s16le audio_samples/bi_flight.wav

# 4. Download pure Hindi sample from k2-fsa/sherpa-onnx release
echo "Downloading pure Hindi test wave from sherpa-onnx..."
curl -sL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/spoken-language-identification-test-wavs.tar.bz2 -o audio_samples/original/spoken-language-identification-test-wavs.tar.bz2
tar -xjf audio_samples/original/spoken-language-identification-test-wavs.tar.bz2 -C audio_samples/original
ffmpeg -y -i audio_samples/original/spoken-language-identification-test-wavs/hi-hindi.wav -ar 16000 -ac 1 -c:a pcm_s16le audio_samples/hi_hindi.wav

echo "=== All test audio files successfully prepared in audio_samples/ ==="
ls -lh audio_samples/*.wav

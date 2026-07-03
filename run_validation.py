import subprocess
import re
import os
import json
import time

def levenshtein_distance(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    
    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
        
    return previous_row[-1]

def calculate_wer(reference, hypothesis):
    # Basic text normalization for comparison (lowercase, strip punctuation)
    def normalize(text):
        text = text.lower()
        # Remove common punctuation
        text = re.sub(r'[.,\/#!$%\^&\*;:{}=\-_`~()?"\-\'\n]', '', text)
        return text
    
    ref_norm = normalize(reference)
    hyp_norm = normalize(hypothesis)
    
    ref_words = [w for w in ref_norm.split() if w]
    hyp_words = [w for w in hyp_norm.split() if w]
    
    if not ref_words:
        return 1.0 if hyp_words else 0.0
        
    distance = levenshtein_distance(ref_words, hyp_words)
    return distance / len(ref_words)

# Define audio duration manually or check using ffprobe
AUDIO_METADATA = {
    "hi_hindi.wav": {
        "duration": 5.72,
        "ground_truth": "हर कोई दुनिया को बदलने की सोचता है लेकिन कोई खुद को बदलने की सोचता ही नहीं"
    },
    "bi_rehab.wav": {
        "duration": 4.71,
        "ground_truth": "उन्हें दस दिन तक rehab करना होगा और उसके बाद उनका fitness test लिया जाएगा"
    },
    "bi_facebook.wav": {
        "duration": 6.61,
        "ground_truth": "social network site facebook ने अब तक का सबसे बड़ा अधिग्रहण करते हुए whatsapp को खरीद लिया है"
    },
    "bi_flight.wav": {
        "duration": 8.30,
        "ground_truth": "जिसके बाद रूस की तरफ़ जाने वाली non-stop flight के लिए carry bag में कोई भी liquid पदार्थ ले जाने से मना कर दिया गया था"
    }
}

MODELS = {
    "base": "whisper.cpp/models/ggml-base.bin",
    "small": "whisper.cpp/models/ggml-small.bin"
}

LANG_CONFIGS = ["auto", "hi"]

def run_whisper(model_path, audio_path, lang):
    # Command to run whisper-cli
    cmd = [
        "./whisper.cpp/build/bin/whisper-cli",
        "-m", model_path,
        "-f", audio_path,
        "-l", lang,
        "-nt"
    ]
    
    start_time = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    end_time = time.time()
    
    # Process stdout to get transcript
    stdout_lines = result.stdout.strip().split("\n")
    transcription_lines = []
    for line in stdout_lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("read_audio_data:") or line.startswith("system_info:") or line.startswith("main:"):
            continue
        transcription_lines.append(line)
        
    transcription = " ".join(transcription_lines).strip()
    
    # Parse stderr for timings and auto-detected language
    stderr = result.stderr
    
    load_time_ms = 0.0
    total_time_ms = 0.0
    detected_lang = "N/A"
    
    load_match = re.search(r"load time\s*=\s*([\d\.]+)\s*ms", stderr)
    if load_match:
        load_time_ms = float(load_match.group(1))
        
    total_match = re.search(r"total time\s*=\s*([\d\.]+)\s*ms", stderr)
    if total_match:
        total_time_ms = float(total_match.group(1))
        
    # Look for language detection
    lang_match = re.search(r"auto-detected language:\s*([a-zA-Z]+)", stderr)
    if lang_match:
        detected_lang = lang_match.group(1)
        
    return {
        "text": transcription,
        "load_time_ms": load_time_ms,
        "total_time_ms": total_time_ms,
        "wall_time_s": end_time - start_time,
        "detected_lang": detected_lang
    }

def main():
    print("=== Starting ASR Validation Benchmarks ===")
    results = []
    
    for audio_name, meta in AUDIO_METADATA.items():
        audio_path = os.path.join("audio_samples", audio_name)
        duration = meta["duration"]
        gt = meta["ground_truth"]
        
        print(f"\nProcessing {audio_name} (Duration: {duration}s)...")
        
        for model_name, model_path in MODELS.items():
            if not os.path.exists(model_path):
                print(f"Warning: Model {model_path} not found. Skipping...")
                continue
                
            for lang in LANG_CONFIGS:
                print(f"  Running model: {model_name} | Language mode: {lang}...")
                
                try:
                    res = run_whisper(model_path, audio_path, lang)
                    
                    # Compute Word Error Rate
                    wer = calculate_wer(gt, res["text"])
                    rtf = (res["total_time_ms"] / 1000.0) / duration
                    
                    results.append({
                        "audio": audio_name,
                        "duration": duration,
                        "model": model_name,
                        "lang_mode": lang,
                        "detected_lang": res["detected_lang"] if lang == "auto" else "hi",
                        "transcription": res["text"],
                        "ground_truth": gt,
                        "load_time_ms": res["load_time_ms"],
                        "transcribe_time_ms": res["total_time_ms"],
                        "rtf": rtf,
                        "wer": wer
                    })
                except Exception as e:
                    print(f"Error processing {audio_name} with {model_name} ({lang}): {e}")
                    
    # Generate report markdown
    report = []
    report.append("# Local ASR Validation Results\n")
    report.append(f"Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    report.append("## Transcription Performance Summary\n")
    report.append("| Audio File | Duration (s) | Model | Lang Mode | Detected Lang | Transcribe Time (ms) | RTF | WER (%) |")
    report.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    
    for r in results:
        report.append(
            f"| {r['audio']} | {r['duration']:.2f}s | {r['model']} | {r['lang_mode']} | {r['detected_lang']} | "
            f"{r['transcribe_time_ms']:.1f}ms | {r['rtf']:.3f} | {r['wer'] * 100:.1f}% |"
        )
        
    report.append("\n## Detailed Transcriptions\n")
    for r in results:
        report.append(f"### File: `{r['audio']}` | Model: `{r['model']}` | Lang Mode: `{r['lang_mode']}`")
        report.append(f"- **Ground Truth**: {r['ground_truth']}")
        report.append(f"- **Transcription**: {r['transcription']}")
        report.append(f"- **WER**: {r['wer'] * 100:.1f}% | **Time**: {r['transcribe_time_ms']:.1f} ms\n")
        
    # Save the report to a markdown file
    report_content = "\n".join(report)
    with open("asr_validation_results.md", "w") as f:
        f.write(report_content)
        
    print("\n=== Validation Complete! ===")
    print("Results saved in asr_validation_results.md")

if __name__ == "__main__":
    main()

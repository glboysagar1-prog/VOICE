package com.example.jarvis.service

import android.content.Intent
import android.speech.RecognitionService

class JarvisRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        // Recognition delegate to livekit speech pipeline
    }

    override fun onCancel(listener: Callback?) {}

    override fun onStopListening(listener: Callback?) {}
}

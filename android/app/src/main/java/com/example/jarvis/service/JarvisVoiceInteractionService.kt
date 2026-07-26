package com.example.jarvis.service

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.service.voice.VoiceInteractionService
import android.util.Log

class JarvisVoiceInteractionService : VoiceInteractionService() {
    companion object {
        private const val TAG = "JarvisVoiceService"
    }

    override fun onReady() {
        super.onReady()
        Log.d(TAG, "JarvisVoiceInteractionService is ready. Registered as system voice assistant.")
    }
}

class JarvisVoiceInteractionSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return JarvisVoiceInteractionSession(this)
    }
}

class JarvisVoiceInteractionSession(context: android.content.Context) : VoiceInteractionSession(context) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        Log.d("JarvisVoiceSession", "Jarvis Assistant invoked via long-press Home/Power button!")
        // Triggers Jarvis Assistant Overlay
    }
}

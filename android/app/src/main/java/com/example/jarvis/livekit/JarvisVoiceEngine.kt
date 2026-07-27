package com.example.jarvis.livekit

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import com.example.jarvis.actions.NativeIntentHandler
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.sqrt

class JarvisVoiceEngine(
    private val context: Context,
    private val serverBaseUrl: String = "https://jarvis-voice-backend-rg2m.onrender.com",
    private val onStatusUpdate: (String) -> Unit,
    private val onTranscript: (userText: String, jarvisText: String) -> Unit,
    private val onVolumeChange: (Float) -> Unit,
    private val onSessionEnded: () -> Unit = {}
) {
    private var isRecording = false
    private var job: Job? = null

    companion object {
        private const val TAG = "JarvisVoiceEngine"
        private const val SAMPLE_RATE = 16000
    }

    fun startListening() {
        if (isRecording) return
        isRecording = true
        onStatusUpdate("Listening... speak now")

        job = CoroutineScope(Dispatchers.IO).launch {
            try {
                recordAndProcessLoop()
            } catch (e: Exception) {
                Log.e(TAG, "Voice engine loop error", e)
                withContext(Dispatchers.Main) {
                    onStatusUpdate("Error: ${e.message}")
                }
            }
        }
    }

    fun stopListening() {
        isRecording = false
        job?.cancel()
        onStatusUpdate("Call ended.")
        onVolumeChange(0f)
    }

    private suspend fun recordAndProcessLoop() {
        val minBufferSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            minBufferSize * 2
        )

        val byteArrayOutputStream = ByteArrayOutputStream()
        val buffer = ByteArray(minBufferSize)
        audioRecord.startRecording()
        Log.d(TAG, "AudioRecord started, buffer size: ${minBufferSize}")

        var silenceStart = System.currentTimeMillis()
        var speechStart = System.currentTimeMillis()
        var hasSpoken = false
        var frameCount = 0

        while (isRecording) {
            val read = audioRecord.read(buffer, 0, buffer.size)
            if (read > 0) {
                byteArrayOutputStream.write(buffer, 0, read)
                val rms = calculateRMS(buffer, read)
                val volume = (rms / 3000f).coerceIn(0f, 1f)
                frameCount++
                
                withContext(Dispatchers.Main) {
                    onVolumeChange(volume)
                }

                // Lowered threshold to 400 so initial words ('Open YouTube') aren't cut off
                if (rms > 400) {
                    if (!hasSpoken) {
                        Log.d(TAG, "🎤 Speech DETECTED at frame #$frameCount (RMS=$rms)")
                        speechStart = System.currentTimeMillis()
                        hasSpoken = true
                    }
                    silenceStart = System.currentTimeMillis()
                } else if (hasSpoken && (System.currentTimeMillis() - silenceStart > 900)) {
                    Log.d(TAG, "🔇 Silence detected after speech — sending audio (${byteArrayOutputStream.size()} bytes)")
                    break
                }

                if (hasSpoken && (System.currentTimeMillis() - speechStart > 5000)) {
                    Log.d(TAG, "⏱️ Max 5s speech limit reached — sending audio (${byteArrayOutputStream.size()} bytes)")
                    break
                }
            }
        }

        audioRecord.stop()
        audioRecord.release()

        if (!isRecording) return

        val pcmData = byteArrayOutputStream.toByteArray()
        Log.d(TAG, "Recording stopped. Total PCM bytes: ${pcmData.size} (need >16000)")
        
        if (pcmData.size > 16000) { // More than 0.5s of speech
            withContext(Dispatchers.Main) {
                onStatusUpdate("Processing speech turn...")
            }

            val wavFile = File(context.cacheDir, "speech_input.wav")
            savePcmToWav(pcmData, wavFile, SAMPLE_RATE)
            Log.d(TAG, "📤 Sending WAV to server: ${wavFile.length()} bytes")
            sendAudioToServer(wavFile)
        } else {
            Log.d(TAG, "⏭️ Too short (${pcmData.size} bytes), skipping — restarting loop")
            if (isRecording) {
                recordAndProcessLoop()
            }
        }
    }

    private suspend fun sendAudioToServer(audioFile: File) {
        withContext(Dispatchers.IO) {
            val boundary = "---JarvisBoundary" + System.currentTimeMillis()
            val targetUrl = "$serverBaseUrl/api/jarvis"
            Log.d(TAG, "🌐 Connecting to: $targetUrl")
            val url = URL(targetUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                connectTimeout = 10000
                readTimeout = 30000
            }

            var taskExecuted = false

            try {
                val outputStream = DataOutputStream(conn.outputStream)
                
                // Part 1: Audio file
                outputStream.writeBytes("--$boundary\r\n")
                outputStream.writeBytes("Content-Disposition: form-data; name=\"audio\"; filename=\"speech.wav\"\r\n")
                outputStream.writeBytes("Content-Type: audio/wav\r\n\r\n")

                val fileInputStream = FileInputStream(audioFile)
                val buffer = ByteArray(4096)
                var bytesRead: Int
                while (fileInputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                }
                fileInputStream.close()

                // Part 2: Session ID
                outputStream.writeBytes("\r\n--$boundary\r\n")
                outputStream.writeBytes("Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n")
                outputStream.writeBytes("android-session-1\r\n")
                outputStream.writeBytes("--$boundary--\r\n")
                outputStream.flush()
                outputStream.close()

                Log.d(TAG, "📡 Request sent, waiting for response...")
                val responseCode = conn.responseCode
                Log.d(TAG, "📥 Server response code: $responseCode")

                if (responseCode == 200) {
                    val responseText = conn.inputStream.bufferedReader().readText()
                    Log.d(TAG, "📥 Server response body: $responseText")
                    val json = JSONObject(responseText)
                    val userText = json.optString("text", "")
                    val jarvisAnswer = json.optString("response", json.optString("correctedText", ""))

                    withContext(Dispatchers.Main) {
                        onTranscript(userText, jarvisAnswer)

                        // Double-Layer Action Execution:
                        // Check for multi-step UI Automation steps
                        val stepsArray = if (json.has("automation_steps") && !json.isNull("automation_steps")) json.optJSONArray("automation_steps") else null
                        if (stepsArray != null && stepsArray.length() > 0) {
                            val service = com.example.jarvis.service.JarvisAutomationService.instance
                            if (service != null) {
                                Log.d(TAG, "🤖 Executing ${stepsArray.length()} UI Automation steps via AccessibilityService...")
                                taskExecuted = service.executeAutomationSteps(stepsArray)
                            } else {
                                Log.w(TAG, "JarvisAutomationService is NOT enabled in Settings!")
                            }
                        }

                        // 1. Try Gemini AI action object
                        val actionObj = if (json.has("action") && !json.isNull("action")) json.optJSONObject("action") else null
                        
                        if (!taskExecuted && actionObj != null) {
                            val actionType = actionObj.optString("type", "")
                            val actionTarget = actionObj.optString("target", "")
                            Log.d(TAG, "⚡ Executing AI action: type=$actionType, target=$actionTarget")
                            
                            taskExecuted = when (actionType) {
                                "OPEN_APP" -> {
                                    val actionData = actionObj.optString("data", "")
                                    NativeIntentHandler.openApp(context, appPackageMap(actionTarget) ?: "", actionTarget, actionData)
                                }
                                "CALL" -> NativeIntentHandler.makePhoneCall(context, actionTarget)
                                "WHATSAPP_MSG" -> NativeIntentHandler.sendWhatsAppMessage(context, actionTarget, actionObj.optString("data", "Hello from Jarvis!"))
                                "WEB_SEARCH" -> NativeIntentHandler.openApp(context, "com.android.chrome", "Chrome")
                                else -> false
                            }
                        }

                        // 2. Fallback: If AI action didn't execute, check user speech text directly
                        if (!taskExecuted) {
                            val lowerText = userText.lowercase()
                            Log.d(TAG, "🔍 Fallback keyword check on text: '$lowerText'")
                            if (lowerText.contains("youtube")) {
                                taskExecuted = NativeIntentHandler.openApp(context, "com.google.android.youtube", "YouTube")
                            } else if (lowerText.contains("whatsapp")) {
                                taskExecuted = NativeIntentHandler.openApp(context, "com.whatsapp", "WhatsApp")
                            } else if (lowerText.contains("spotify")) {
                                taskExecuted = NativeIntentHandler.openApp(context, "com.spotify.music", "Spotify")
                            } else if (lowerText.contains("chrome") || lowerText.contains("google")) {
                                taskExecuted = NativeIntentHandler.openApp(context, "com.android.chrome", "Chrome")
                            } else if (lowerText.contains("camera")) {
                                taskExecuted = NativeIntentHandler.openApp(context, "com.android.camera", "Camera")
                            } else if (lowerText.contains("call") && lowerText.contains("sagar")) {
                                taskExecuted = NativeIntentHandler.makePhoneCall(context, "1234567890")
                            }
                        }

                        if (taskExecuted) {
                            Log.d(TAG, "🚀 Action EXECUTED successfully!")
                            onStatusUpdate("✅ Task executed. Session ended.")
                            stopListening()
                            onSessionEnded()
                        } else {
                            onStatusUpdate("Listening... speak now")
                        }
                    }
                } else {
                    val errorBody = try { conn.errorStream?.bufferedReader()?.readText() } catch (_: Exception) { "unknown" }
                    Log.e(TAG, "❌ Server error $responseCode: $errorBody")
                    withContext(Dispatchers.Main) {
                        onStatusUpdate("Server Error: $responseCode")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Failed to send audio payload", e)
                withContext(Dispatchers.Main) {
                    onStatusUpdate("Connection Failed: ${e.message}")
                }
            } finally {
                conn.disconnect()
            }

            // Continue listening for next phrase ONLY if no task was executed and still recording
            if (isRecording && !taskExecuted) {
                recordAndProcessLoop()
            }
        }
    }

    // Map Gemini-detected app names to Android package names
    private fun appPackageMap(target: String): String? {
        val lower = target.lowercase()
        return when {
            lower.contains("whatsapp") -> "com.whatsapp"
            lower.contains("youtube") -> "com.google.android.youtube"
            lower.contains("chrome") -> "com.android.chrome"
            lower.contains("spotify") -> "com.spotify.music"
            lower.contains("instagram") -> "com.instagram.android"
            lower.contains("camera") -> "com.android.camera"
            lower.contains("settings") -> "com.android.settings"
            lower.contains("phone") || lower.contains("dialer") -> "com.google.android.dialer"
            lower.contains("maps") -> "com.google.android.apps.maps"
            lower.contains("gmail") -> "com.google.android.gm"
            lower.contains("calendar") -> "com.google.android.calendar"
            lower.contains("calculator") -> "com.miui.calculator"
            lower.contains("gallery") -> "com.miui.gallery"
            lower.contains("notes") -> "com.miui.notes"
            else -> null
        }
    }

    private fun calculateRMS(buffer: ByteArray, size: Int): Float {
        var sum = 0.0
        var i = 0
        while (i < size - 1) {
            val sample = (buffer[i].toInt() and 0xFF) or (buffer[i + 1].toInt() shl 8)
            sum += (sample * sample).toDouble()
            i += 2
        }
        return sqrt(sum / (size / 2)).toFloat()
    }

    private fun savePcmToWav(pcmData: ByteArray, wavFile: File, sampleRate: Int) {
        val totalAudioLen = pcmData.size.toLong()
        val totalDataLen = totalAudioLen + 36
        val channels = 1
        val byteRate = 16 * sampleRate * channels / 8

        val header = ByteArray(44)
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        header[4] = (totalDataLen and 0xff).toByte()
        header[5] = (totalDataLen shr 8 and 0xff).toByte()
        header[6] = (totalDataLen shr 16 and 0xff).toByte()
        header[7] = (totalDataLen shr 24 and 0xff).toByte()
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        header[16] = 16
        header[17] = 0
        header[18] = 0
        header[19] = 0
        header[20] = 1
        header[21] = 0
        header[22] = channels.toByte()
        header[23] = 0
        header[24] = (sampleRate and 0xff).toByte()
        header[25] = (sampleRate shr 8 and 0xff).toByte()
        header[26] = (sampleRate shr 16 and 0xff).toByte()
        header[27] = (sampleRate shr 24 and 0xff).toByte()
        header[28] = (byteRate and 0xff).toByte()
        header[29] = (byteRate shr 8 and 0xff).toByte()
        header[30] = (byteRate shr 16 and 0xff).toByte()
        header[31] = (byteRate shr 24 and 0xff).toByte()
        header[32] = (2 * channels).toByte()
        header[33] = 0
        header[34] = 16
        header[35] = 0
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        header[40] = (totalAudioLen and 0xff).toByte()
        header[41] = (totalAudioLen shr 8 and 0xff).toByte()
        header[42] = (totalAudioLen shr 16 and 0xff).toByte()
        header[43] = (totalAudioLen shr 24 and 0xff).toByte()

        val out = FileOutputStream(wavFile)
        out.write(header)
        out.write(pcmData)
        out.close()
    }
}

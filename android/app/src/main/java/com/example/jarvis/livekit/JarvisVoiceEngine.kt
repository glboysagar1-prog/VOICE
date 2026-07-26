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
    private val serverBaseUrl: String = "http://192.168.1.4:3000",
    private val onStatusUpdate: (String) -> Unit,
    private val onTranscript: (userText: String, jarvisText: String) -> Unit,
    private val onVolumeChange: (Float) -> Unit
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
        onStatusUpdate("Call disconnected.")
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

        var silenceStart = System.currentTimeMillis()
        var hasSpoken = false

        while (isRecording) {
            val read = audioRecord.read(buffer, 0, buffer.size)
            if (read > 0) {
                byteArrayOutputStream.write(buffer, 0, read)
                val rms = calculateRMS(buffer, read)
                val volume = (rms / 3000f).coerceIn(0f, 1f)
                
                withContext(Dispatchers.Main) {
                    onVolumeChange(volume)
                }

                if (rms > 800) {
                    hasSpoken = true
                    silenceStart = System.currentTimeMillis()
                } else if (hasSpoken && (System.currentTimeMillis() - silenceStart > 1200)) {
                    // Silence threshold reached -> end of speech turn
                    break
                }
            }
        }

        audioRecord.stop()
        audioRecord.release()

        if (!isRecording) return

        val pcmData = byteArrayOutputStream.toByteArray()
        if (pcmData.size > 16000) { // More than 0.5s of speech
            withContext(Dispatchers.Main) {
                onStatusUpdate("Processing speech turn...")
            }

            val wavFile = File(context.cacheDir, "speech_input.wav")
            savePcmToWav(pcmData, wavFile, SAMPLE_RATE)
            sendAudioToServer(wavFile)
        } else {
            // Loop back to continue listening
            if (isRecording) {
                recordAndProcessLoop()
            }
        }
    }

    private suspend fun sendAudioToServer(audioFile: File) {
        withContext(Dispatchers.IO) {
            val boundary = "---JarvisBoundary" + System.currentTimeMillis()
            val url = URL("$serverBaseUrl/api/jarvis")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                connectTimeout = 8000
                readTimeout = 15000
            }

            try {
                val outputStream = DataOutputStream(conn.outputStream)
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

                outputStream.writeBytes("\r\n--$boundary\r\n")
                outputStream.writeBytes("Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n")
                outputStream.writeBytes("android-session-1\r\n")
                outputStream.writeBytes("--$boundary--\r\n")
                outputStream.flush()
                outputStream.close()

                if (conn.responseCode == 200) {
                    val responseText = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(responseText)
                    val userText = json.optString("text", "")
                    val jarvisAnswer = json.optString("response", json.optString("correctedText", ""))

                    withContext(Dispatchers.Main) {
                        onTranscript(userText, jarvisAnswer)
                        onStatusUpdate("WebRTC Connected. Listening...")

                        // Check for native OS action execution (e.g. Open WhatsApp)
                        if (userText.lowercase().contains("open whatsapp") || userText.lowercase().contains("whatsapp open")) {
                            NativeIntentHandler.openApp(context, "com.whatsapp", "WhatsApp")
                        } else if (userText.lowercase().contains("message sagar") || userText.lowercase().contains("whatsapp message")) {
                            NativeIntentHandler.sendWhatsAppMessage(context, "Sagar", "Hello from Jarvis Voice!")
                        }
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        onStatusUpdate("Server Error: ${conn.responseCode}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send audio payload", e)
                withContext(Dispatchers.Main) {
                    onStatusUpdate("Connection Failed: Check server IP")
                }
            } finally {
                conn.disconnect()
            }

            // Continue listening for next phrase
            if (isRecording) {
                recordAndProcessLoop()
            }
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

package com.example.jarvis.actions

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import android.util.Log
import org.json.JSONObject

object NativeIntentHandler {
    private const val TAG = "NativeIntentHandler"

    /**
     * Executes device actions based on JSON payload received from Jarvis backend.
     * Example payload: {"action": "SEND_WHATSAPP_MESSAGE", "recipient": "Sagar", "message": "Hello!"}
     */
    fun handleCommandJson(context: Context, jsonString: String): Boolean {
        return try {
            val json = JSONObject(jsonString)
            val action = json.optString("action", "").uppercase()

            when (action) {
                "OPEN_APP" -> {
                    val packageName = json.optString("package", "")
                    val appName = json.optString("appName", "")
                    openApp(context, packageName, appName)
                }
                "SEND_WHATSAPP_MESSAGE" -> {
                    val recipient = json.optString("recipient", "")
                    val message = json.optString("message", "")
                    val phoneNumber = ContactsResolver.findPhoneNumberByName(context, recipient)
                    sendWhatsAppMessage(context, phoneNumber, message)
                }
                "MAKE_PHONE_CALL" -> {
                    val recipient = json.optString("recipient", "")
                    val phoneNumber = json.optString("phone", "")
                        .ifBlank { ContactsResolver.findPhoneNumberByName(context, recipient) ?: "" }
                    makePhoneCall(context, phoneNumber)
                }
                "SET_ALARM" -> {
                    val hour = json.optInt("hour", 7)
                    val minutes = json.optInt("minutes", 0)
                    val message = json.optString("message", "Jarvis Alarm")
                    setAlarm(context, hour, minutes, message)
                }
                "OPEN_URL" -> {
                    val url = json.optString("url", "https://google.com")
                    openUrl(context, url)
                }
                else -> {
                    Log.w(TAG, "Unknown action: $action")
                    false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse or execute action JSON: $jsonString", e)
            false
        }
    }

    fun openApp(context: Context, packageName: String, appName: String = ""): Boolean {
        val targetPackage = when {
            packageName.isNotBlank() -> packageName
            appName.lowercase().contains("whatsapp") -> "com.whatsapp"
            appName.lowercase().contains("youtube") -> "com.google.android.youtube"
            appName.lowercase().contains("spotify") -> "com.spotify.music"
            appName.lowercase().contains("chrome") -> "com.android.chrome"
            else -> packageName
        }

        return try {
            val intent = context.packageManager.getLaunchIntentForPackage(targetPackage)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                Log.d(TAG, "Opened app: $targetPackage")
                true
            } else {
                Log.e(TAG, "App not found: $targetPackage")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error opening app: $targetPackage", e)
            false
        }
    }

    fun sendWhatsAppMessage(context: Context, phoneNumber: String?, message: String): Boolean {
        return try {
            val cleanNumber = phoneNumber?.replace("[^0-9]".toRegex(), "") ?: ""
            val uri = if (cleanNumber.isNotBlank()) {
                Uri.parse("https://api.whatsapp.com/send?phone=$cleanNumber&text=${Uri.encode(message)}")
            } else {
                Uri.parse("https://api.whatsapp.com/send?text=${Uri.encode(message)}")
            }

            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage("com.whatsapp")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Launched WhatsApp message to $cleanNumber")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error opening WhatsApp", e)
            false
        }
    }

    fun makePhoneCall(context: Context, phoneNumber: String): Boolean {
        if (phoneNumber.isBlank()) return false
        return try {
            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phoneNumber")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Initiated call to $phoneNumber")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error making call to $phoneNumber", e)
            false
        }
    }

    fun setAlarm(context: Context, hour: Int, minutes: Int, message: String): Boolean {
        return try {
            val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hour)
                putExtra(AlarmClock.EXTRA_MINUTES, minutes)
                putExtra(AlarmClock.EXTRA_MESSAGE, message)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Set alarm for $hour:$minutes - $message")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error setting alarm", e)
            false
        }
    }

    fun openUrl(context: Context, url: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error opening URL: $url", e)
            false
        }
    }
}

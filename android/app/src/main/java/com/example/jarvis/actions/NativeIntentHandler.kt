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

    fun openApp(context: Context, packageName: String, appName: String = "", data: String = ""): Boolean {
        val targetPackage = when {
            packageName.isNotBlank() -> packageName
            appName.lowercase().contains("whatsapp") -> "com.whatsapp"
            appName.lowercase().contains("youtube") -> "com.google.android.youtube"
            appName.lowercase().contains("spotify") -> "com.spotify.music"
            appName.lowercase().contains("chrome") -> "com.android.chrome"
            else -> packageName
        }

        // If data is provided (e.g. play song / search query), launch via YouTube deep link
        if (targetPackage == "com.google.android.youtube" && data.isNotBlank()) {
            return playYouTubeSong(context, data)
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

    fun playYouTubeSong(context: Context, query: String): Boolean {
        return try {
            // First try YouTube Search Intent with Auto-Play flag
            val intent = Intent(Intent.ACTION_SEARCH).apply {
                setPackage("com.google.android.youtube")
                putExtra("query", query)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Launched YouTube search for: $query")

            // Instruct Accessibility Service to click the first video after 1.2s delay
            val service = com.example.jarvis.service.JarvisAutomationService.instance
            if (service != null) {
                val steps = org.json.JSONArray().apply {
                    put(org.json.JSONObject().apply {
                        put("action", "SCROLL_FORWARD")
                        put("delayMs", 1200L)
                    })
                }
                service.executeAutomationSteps(steps)
            }
            true
        } catch (e: Exception) {
            openApp(context, "com.google.android.youtube", "YouTube")
        }
    }

    fun sendWhatsAppMessage(context: Context, nameOrNumber: String?, message: String): Boolean {
        return try {
            val contactName = nameOrNumber ?: "Sagar"
            val textToSend = if (message.isNotBlank()) message else "Hii"

            // 1. Try Direct Phone Number URI launch if phone number is resolved
            var cleanNumber = contactName.replace("[^0-9]".toRegex(), "")
            if (cleanNumber.length < 10 && contactName.isNotBlank()) {
                val resolvedPhone = ContactsResolver.findPhoneNumberByName(context, contactName)
                if (!resolvedPhone.isNullOrBlank()) {
                    cleanNumber = resolvedPhone.replace("[^0-9]".toRegex(), "")
                }
            }

            // Launch WhatsApp
            val uri = if (cleanNumber.length >= 10) {
                Uri.parse("https://api.whatsapp.com/send?phone=$cleanNumber&text=${Uri.encode(textToSend)}")
            } else {
                Uri.parse("https://api.whatsapp.com/send?text=${Uri.encode(textToSend)}")
            }

            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage("com.whatsapp")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Launched WhatsApp for $contactName with message: '$textToSend'")

            // 2. Full Accessibility UI Automation Pipeline
            val service = com.example.jarvis.service.JarvisAutomationService.instance
            if (service != null) {
                Thread {
                    try {
                        Thread.sleep(1200L) // Wait for WhatsApp to open
                        val root = service.rootInActiveWindow
                        if (root != null) {
                            // Step A: If contact chat isn't open yet, search for contact
                            if (cleanNumber.length < 10) {
                                Log.d(TAG, "🤖 Accessibility: Searching for contact '$contactName'...")
                                service.clickById(root, "com.whatsapp:id/menuitem_search") || service.clickByText(root, "Search")
                                Thread.sleep(600L)
                                service.typeTextInFocusedOrId(service.rootInActiveWindow ?: root, contactName, "com.whatsapp:id/search_src_text")
                                Thread.sleep(800L)
                                service.clickByText(service.rootInActiveWindow ?: root, contactName)
                                Thread.sleep(800L)
                                service.typeTextInFocusedOrId(service.rootInActiveWindow ?: root, textToSend, "com.whatsapp:id/entry")
                                Thread.sleep(600L)
                            }
                            
                            // Step B: Tap Send Button
                            Log.d(TAG, "🤖 Accessibility: Tapping Send button...")
                            service.clickById(service.rootInActiveWindow ?: root, "com.whatsapp:id/send")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Accessibility automation step failed", e)
                    }
                }.start()
            }
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

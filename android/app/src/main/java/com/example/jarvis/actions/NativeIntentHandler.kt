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
        var targetPackage = packageName.ifBlank { resolveInstalledPackageName(context, appName) }

        if (targetPackage.isBlank() && appName.isNotBlank()) {
            targetPackage = when {
                appName.lowercase().contains("whatsapp") -> "com.whatsapp"
                appName.lowercase().contains("youtube") -> "com.google.android.youtube"
                appName.lowercase().contains("spotify") -> "com.spotify.music"
                appName.lowercase().contains("chrome") -> "com.android.chrome"
                appName.lowercase().contains("instagram") -> "com.instagram.android"
                appName.lowercase().contains("camera") -> "com.android.camera"
                appName.lowercase().contains("settings") -> "com.android.settings"
                else -> ""
            }
        }

        if (targetPackage.isBlank()) {
            Log.e(TAG, "Could not resolve package name for app: '$appName'")
            return false
        }

        // If data query is provided (e.g. search / play song), perform in-app search via Accessibility
        if (data.isNotBlank()) {
            return performAppSearchAndAct(context, targetPackage, data)
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

    /**
     * Universal Installed Package Resolver: Finds package name of ANY app installed on the phone by app name.
     */
    fun resolveInstalledPackageName(context: Context, appName: String): String {
        if (appName.isBlank()) return ""
        val lowerName = appName.lowercase().trim()
        return try {
            val pm = context.packageManager
            val packages = pm.getInstalledApplications(android.content.pm.PackageManager.GET_META_DATA)
            for (appInfo in packages) {
                val label = pm.getApplicationLabel(appInfo).toString().lowercase()
                if (label == lowerName || label.contains(lowerName)) {
                    Log.d(TAG, "Resolved '$appName' to installed package: ${appInfo.packageName}")
                    return appInfo.packageName
                }
            }
            ""
        } catch (e: Exception) {
            Log.e(TAG, "Error resolving package name for '$appName'", e)
            ""
        }
    }

    /**
     * Universal In-App Accessibility Search: Launches ANY app, finds search field, types query, and taps top result.
     */
    fun performAppSearchAndAct(context: Context, packageName: String, searchQuery: String): Boolean {
        return try {
            val intent = context.packageManager.getLaunchIntentForPackage(packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            } ?: return false
            context.startActivity(intent)

            val service = com.example.jarvis.service.JarvisAutomationService.instance
            if (service != null) {
                Thread {
                    try {
                        Thread.sleep(1400L) // Wait for target app to load UI
                        val root = service.rootInActiveWindow
                        if (root != null) {
                            Log.d(TAG, "🤖 Accessibility: Initiating universal search for '$searchQuery' in $packageName...")
                            // Try finding search button / search input
                            val searchFound = service.clickById(root, "$packageName:id/search") ||
                                    service.clickById(root, "$packageName:id/menuitem_search") ||
                                    service.clickByText(root, "Search") ||
                                    service.clickByText(root, "Find")

                            Thread.sleep(800L)
                            val searchInputRoot = service.rootInActiveWindow ?: root
                            service.typeTextInFocusedOrId(searchInputRoot, searchQuery)
                            Thread.sleep(800L)

                            // Click top search result or press ENTER
                            val resultRoot = service.rootInActiveWindow ?: root
                            service.clickByText(resultRoot, searchQuery) || service.scroll(resultRoot, forward = true)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Universal app search failed", e)
                    }
                }.start()
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error performing in-app search for $packageName", e)
            false
        }
    }

    fun playYouTubeSong(context: Context, query: String): Boolean {
        return try {
            val searchUri = Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
            val intent = Intent(Intent.ACTION_VIEW, searchUri).apply {
                setPackage("com.google.android.youtube")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "Launched YouTube URI search for: $query")

            // Instruct Accessibility Service to tap top video thumbnail / title after 1.5s delay
            val service = com.example.jarvis.service.JarvisAutomationService.instance
            if (service != null) {
                Thread {
                    try {
                        Thread.sleep(1500L) // Wait for YouTube search results to render
                        val root = service.rootInActiveWindow
                        if (root != null) {
                            Log.d(TAG, "🤖 Accessibility: Tapping top video for '$query'...")
                            service.clickById(root, "com.google.android.youtube:id/title") ||
                                    service.clickById(root, "com.google.android.youtube:id/thumbnail") ||
                                    service.clickByText(root, query) ||
                                    service.scroll(root, forward = true)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "YouTube video auto-play tap failed", e)
                    }
                }.start()
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
                            if (cleanNumber.length < 10) {
                                Log.d(TAG, "🤖 Accessibility: Searching for WhatsApp contact '$contactName'...")
                                service.clickById(root, "com.whatsapp:id/menuitem_search") || service.clickByText(root, "Search")
                                Thread.sleep(600L)
                                val searchRoot = service.rootInActiveWindow ?: root
                                service.typeTextInFocusedOrId(searchRoot, contactName, "com.whatsapp:id/search_src_text")
                                Thread.sleep(900L)
                                
                                // Tap top contact result in WhatsApp list
                                val listRoot = service.rootInActiveWindow ?: root
                                service.clickByText(listRoot, contactName) || service.clickById(listRoot, "com.whatsapp:id/contact_name")
                                Thread.sleep(800L)
                                
                                val chatRoot = service.rootInActiveWindow ?: root
                                service.typeTextInFocusedOrId(chatRoot, textToSend, "com.whatsapp:id/entry")
                                Thread.sleep(600L)
                            }
                            
                            // Tap Send Button
                            Log.d(TAG, "🤖 Accessibility: Tapping WhatsApp Send button...")
                            val finalRoot = service.rootInActiveWindow ?: root
                            service.clickById(finalRoot, "com.whatsapp:id/send")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "WhatsApp Accessibility automation step failed", e)
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

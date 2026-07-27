package com.example.jarvis.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class JarvisAutomationService : AccessibilityService() {

    companion object {
        private const val TAG = "JarvisAutomationService"
        var instance: JarvisAutomationService? = null
            private set

        fun isServiceRunning(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "🤖 Jarvis UI Automation Accessibility Service CONNECTED!")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Active listener for screen changes if needed
    }

    override fun onInterrupt() {
        Log.w(TAG, "Jarvis Automation Service Interrupted.")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.d(TAG, "Jarvis Automation Service Destroyed.")
    }

    /**
     * Executes a series of UI automation steps passed from Jarvis AI backend.
     * Example step JSON array:
     * [
     *   {"action": "CLICK_TEXT", "target": "Search"},
     *   {"action": "TYPE_TEXT", "text": "Sagar"},
     *   {"action": "CLICK_TEXT", "target": "Sagar"},
     *   {"action": "TYPE_TEXT", "text": "Hey from Jarvis!"},
     *   {"action": "CLICK_ID", "target": "com.whatsapp:id/send"}
     * ]
     */
    fun executeAutomationSteps(stepsJsonArray: JSONArray): Boolean {
        val rootNode = rootInActiveWindow ?: run {
            Log.e(TAG, "Cannot execute steps: Root window node is null")
            return false
        }

        try {
            for (i in 0 until stepsJsonArray.length()) {
                val step = stepsJsonArray.getJSONObject(i)
                val action = step.optString("action", "").uppercase()
                val target = step.optString("target", "")
                val text = step.optString("text", "")
                val delayMs = step.optLong("delayMs", 600L)

                Log.d(TAG, "▶️ Step ${i + 1}/${stepsJsonArray.length()}: action=$action, target=$target, text=$text")

                val success = when (action) {
                    "CLICK_TEXT" -> clickByText(rootInActiveWindow ?: rootNode, target)
                    "CLICK_ID" -> clickById(rootInActiveWindow ?: rootNode, target)
                    "TYPE_TEXT" -> typeTextInFocusedOrId(rootInActiveWindow ?: rootNode, text, target)
                    "SCROLL_FORWARD" -> scroll(rootInActiveWindow ?: rootNode, forward = true)
                    "SCROLL_BACKWARD" -> scroll(rootInActiveWindow ?: rootNode, forward = false)
                    "GLOBAL_BACK" -> performGlobalAction(GLOBAL_ACTION_BACK)
                    "GLOBAL_HOME" -> performGlobalAction(GLOBAL_ACTION_HOME)
                    else -> false
                }

                Log.d(TAG, "   Result for step ${i + 1}: ${if (success) "SUCCESS" else "FAILED"}")
                Thread.sleep(delayMs)
            }
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error executing automation pipeline", e)
            return false
        }
    }

    fun clickByText(node: AccessibilityNodeInfo, text: String): Boolean {
        val list = node.findAccessibilityNodeInfosByText(text)
        if (!list.isNullOrEmpty()) {
            for (item in list) {
                if (performClickNode(item)) return true
            }
        }
        Log.w(TAG, "Text node '$text' not found or not clickable.")
        return false
    }

    fun clickById(node: AccessibilityNodeInfo, viewId: String): Boolean {
        val list = node.findAccessibilityNodeInfosByViewId(viewId)
        if (!list.isNullOrEmpty()) {
            for (item in list) {
                if (performClickNode(item)) return true
            }
        }
        Log.w(TAG, "View ID node '$viewId' not found.")
        return false
    }

    private fun performClickNode(node: AccessibilityNodeInfo?): Boolean {
        var temp = node
        while (temp != null) {
            if (temp.isClickable) {
                val clicked = temp.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (clicked) Log.d(TAG, "Successfully clicked node: ${temp.text ?: temp.viewIdResourceName}")
                return clicked
            }
            temp = temp.parent
        }
        return false
    }

    fun typeTextInFocusedOrId(node: AccessibilityNodeInfo, textToType: String, viewId: String = ""): Boolean {
        var targetNode: AccessibilityNodeInfo? = null

        if (viewId.isNotBlank()) {
            val list = node.findAccessibilityNodeInfosByViewId(viewId)
            if (!list.isNullOrEmpty()) targetNode = list[0]
        }

        if (targetNode == null) {
            targetNode = node.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        }

        if (targetNode != null && targetNode.isEditable) {
            val arguments = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, textToType)
            }
            val typed = targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
            Log.d(TAG, "Typed text into input node: success=$typed")
            return typed
        }

        Log.w(TAG, "No editable focused input field found to type text.")
        return false
    }

    fun scroll(node: AccessibilityNodeInfo, forward: Boolean): Boolean {
        val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        return node.performAction(action)
    }
}

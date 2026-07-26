package com.example.jarvis.actions

import android.content.Context
import android.provider.ContactsContract
import android.util.Log

object ContactsResolver {
    private const val TAG = "ContactsResolver"

    /**
     * Looks up phone number from Android contacts by display name or query string.
     */
    fun findPhoneNumberByName(context: Context, contactName: String): String? {
        if (contactName.isBlank()) return null

        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
        )
        val selection = "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?"
        val selectionArgs = arrayOf("%$contactName%")

        try {
            context.contentResolver.query(
                uri,
                projection,
                selection,
                selectionArgs,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    if (numberIndex != -1) {
                        val number = cursor.getString(numberIndex).replace("\\s+".toRegex(), "")
                        Log.d(TAG, "Resolved contact '$contactName' to number: $number")
                        return number
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error resolving contact for $contactName", e)
        }

        return null
    }
}

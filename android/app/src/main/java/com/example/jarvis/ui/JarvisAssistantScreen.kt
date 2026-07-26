package com.example.jarvis.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.jarvis.actions.NativeIntentHandler
import com.example.jarvis.livekit.JarvisVoiceEngine
import com.example.jarvis.ui.components.SiriOrbVisualizer

@Composable
fun JarvisAssistantScreen() {
    val context = LocalContext.current
    var isConnected by remember { mutableStateOf(false) }
    var audioVolume by remember { mutableStateOf(0.1f) }
    var statusText by remember { mutableStateOf("Tap button to connect Siri voice assistant") }
    var userTranscript by remember { mutableStateOf("") }
    var jarvisResponse by remember { mutableStateOf("") }

    val voiceEngine = remember {
        JarvisVoiceEngine(
            context = context,
            serverBaseUrl = "http://192.168.1.4:3000",
            onStatusUpdate = { statusText = it },
            onTranscript = { user, jarvis ->
                userTranscript = user
                jarvisResponse = jarvis
            },
            onVolumeChange = { audioVolume = it }
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            voiceEngine.stopListening()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF0F172A),
                        Color(0xFF020617)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top App Bar Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Jarvis Assistant",
                    color = Color.White,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                
                Surface(
                    color = if (isConnected) Color(0xFF10B981).copy(alpha = 0.2f) else Color.White.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text(
                        text = if (isConnected) "Active" else "Offline",
                        color = if (isConnected) Color(0xFF10B981) else Color.Gray,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            // Middle Visualizer Orb Section
            Box(
                modifier = Modifier
                    .size(260.dp)
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center
            ) {
                SiriOrbVisualizer(
                    isListening = isConnected,
                    audioVolume = if (isConnected) audioVolume else 0.1f,
                    modifier = Modifier.fillMaxSize()
                )
            }

            // Transcript Display Card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = statusText,
                    color = Color(0xFF94A3B8),
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                if (userTranscript.isNotEmpty() || jarvisResponse.isNotEmpty()) {
                    Surface(
                        color = Color(0xFF1E293B).copy(alpha = 0.8f),
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            if (userTranscript.isNotEmpty()) {
                                Text(
                                    text = "You: $userTranscript",
                                    color = Color.White,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Normal
                                )
                            }
                            if (jarvisResponse.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "Jarvis: $jarvisResponse",
                                    color = Color(0xFF38BDF8),
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }
            }

            // Bottom Action Controls
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Quick Test OS Action Chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    OutlinedButton(
                        onClick = {
                            userTranscript = "Open WhatsApp"
                            jarvisResponse = "Opening WhatsApp..."
                            NativeIntentHandler.openApp(context, "com.whatsapp", "WhatsApp")
                        },
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Text("💬 Open WhatsApp", fontSize = 12.sp, color = Color.White)
                    }

                    OutlinedButton(
                        onClick = {
                            userTranscript = "Send WhatsApp message to Sagar"
                            jarvisResponse = "Opening WhatsApp chat..."
                            NativeIntentHandler.sendWhatsAppMessage(context, "Sagar", "Hello from Jarvis Voice Assistant!")
                        },
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Text("📩 Message Sagar", fontSize = 12.sp, color = Color.White)
                    }
                }

                Button(
                    onClick = {
                        isConnected = !isConnected
                        if (isConnected) {
                            voiceEngine.startListening()
                        } else {
                            voiceEngine.stopListening()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isConnected) Color(0xFFEF4444) else Color(0xFF6366F1)
                    ),
                    shape = RoundedCornerShape(24.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                ) {
                    Text(
                        text = if (isConnected) "End Siri Voice Session" else "📞 Connect Real-Time Siri Call",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

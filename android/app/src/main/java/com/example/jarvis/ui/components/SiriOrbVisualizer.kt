package com.example.jarvis.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp

@Composable
fun SiriOrbVisualizer(
    isListening: Boolean = true,
    audioVolume: Float = 0.5f, // 0.0f to 1.0f
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "orbRotation")
    
    val rotationAngle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 4000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "rotation"
    )

    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    val currentScale = (pulseScale + (audioVolume * 0.4f)).coerceIn(0.8f, 1.8f)

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val baseRadius = (size.minDimension / 2f) * 0.65f

            scale(scale = currentScale, pivot = center) {
                // Layer 1: Deep Cyan Glow
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color(0xFF00F2FE).copy(alpha = 0.8f),
                            Color(0xFF4FACFE).copy(alpha = 0.4f),
                            Color.Transparent
                        ),
                        center = center,
                        radius = baseRadius * 1.3f
                    ),
                    radius = baseRadius * 1.3f,
                    center = center
                )

                // Layer 2: Glowing Purple / Violet Core
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color(0xFF9D50BB).copy(alpha = 0.9f),
                            Color(0xFF6E48AA).copy(alpha = 0.5f),
                            Color.Transparent
                        ),
                        center = Offset(center.x - 20f, center.y - 20f),
                        radius = baseRadius * 1.1f
                    ),
                    radius = baseRadius * 1.1f,
                    center = Offset(center.x - 20f, center.y - 20f),
                    blendMode = BlendMode.Screen
                )

                // Layer 3: Vibrant Magenta Pulse
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color(0xFFFF0844).copy(alpha = 0.85f),
                            Color(0xFFFFB199).copy(alpha = 0.3f),
                            Color.Transparent
                        ),
                        center = Offset(center.x + 25f, center.y + 20f),
                        radius = baseRadius * 0.9f
                    ),
                    radius = baseRadius * 0.9f,
                    center = Offset(center.x + 25f, center.y + 20f),
                    blendMode = BlendMode.Screen
                )
            }
        }
    }
}

package com.kreativekoala.vibecoder.ui.create

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.vibecoder.ui.theme.*
import kotlinx.coroutines.delay

@Composable
fun GenerationProgressView(
    progressPercent: Double,
    buildPhase: String,
    buildDetail: String,
    estimatedSecondsRemaining: Int,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Simulated progress that slowly ramps up when real progress is 0
    var simulatedProgress by remember { mutableDoubleStateOf(0.0) }

    LaunchedEffect(Unit) {
        // Slowly ramp from 0 to ~8% over the first 30 seconds
        while (true) {
            delay(500)
            if (simulatedProgress < 8.0) {
                simulatedProgress += 0.25
            }
        }
    }

    // Use whichever is higher: real progress or simulated
    val displayProgress = if (progressPercent > simulatedProgress) progressPercent else simulatedProgress

    val animatedProgress by animateFloatAsState(
        targetValue = (displayProgress / 100.0).toFloat(),
        animationSpec = tween(durationMillis = 500),
        label = "progress"
    )

    // Pulsing glow for the progress arc when waiting
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Circular progress
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(200.dp)
        ) {
            Canvas(modifier = Modifier.size(200.dp)) {
                val strokeWidth = 8.dp.toPx()
                val radius = (size.minDimension - strokeWidth) / 2
                val topLeft = Offset(
                    (size.width - radius * 2) / 2,
                    (size.height - radius * 2) / 2
                )
                val arcSize = Size(radius * 2, radius * 2)

                // Background arc
                drawArc(
                    color = DarkSurfaceVariant,
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                )

                // Progress arc with pulse when in early stages
                val arcAlpha = if (displayProgress < 10.0) pulseAlpha else 1f
                drawArc(
                    color = VibePurple.copy(alpha = arcAlpha),
                    startAngle = -90f,
                    sweepAngle = 360f * animatedProgress,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                )
            }

            // Percentage text
            Text(
                text = "${displayProgress.toInt()}%",
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        // Phase name
        Text(
            text = buildPhase,
            style = MaterialTheme.typography.titleLarge,
            color = TextPrimary,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center
        )

        if (buildDetail.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = buildDetail,
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )
        }

        if (estimatedSecondsRemaining > 0) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "~${estimatedSecondsRemaining}s remaining",
                style = MaterialTheme.typography.bodySmall,
                color = TextTertiary
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        TextButton(onClick = onCancel) {
            Text(
                text = "Cancel",
                color = Color.Red.copy(alpha = 0.7f)
            )
        }
    }
}

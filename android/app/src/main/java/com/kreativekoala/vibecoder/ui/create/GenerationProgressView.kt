package com.kreativekoala.vibecoder.ui.create

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*
import kotlinx.coroutines.delay

@Composable
fun GenerationProgressView(
    progressPercent: Double,
    simulatedProgress: Double,
    notifyEnabled: Boolean,
    buildPhase: String,
    buildDetail: String,
    estimatedSecondsRemaining: Int,
    onNotifyEnabledChanged: (Boolean) -> Unit,
    onSimulatedProgressChanged: (Double) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    // Check if notifications are already permitted
    val hasNotificationPermission = remember {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else true
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        onNotifyEnabledChanged(granted)
    }

    // rememberUpdatedState ensures the coroutine always reads the latest value
    // even though LaunchedEffect(Unit) is only launched once
    val currentSimulated by rememberUpdatedState(simulatedProgress)
    val currentReal by rememberUpdatedState(progressPercent)

    // Sync real progress into simulated when real jumps ahead
    LaunchedEffect(progressPercent) {
        if (progressPercent > currentSimulated) {
            onSimulatedProgressChanged(progressPercent)
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            delay(800)
            // Slowly advance simulated progress when real progress hasn't changed
            // Cap at 95% so the final 5% only comes from actual completion
            if (currentSimulated < 95.0) {
                val increment = when {
                    currentSimulated < 8.0 -> 0.3    // Early: ramp quickly
                    currentSimulated < 50.0 -> 0.15  // Mid: moderate
                    else -> 0.1                       // Late: slow creep
                }
                onSimulatedProgressChanged(currentSimulated + increment)
            }
        }
    }

    // Use whichever is higher: real progress or simulated
    val displayProgress = maxOf(progressPercent, simulatedProgress)

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
                text = stringResource(R.string.generation_time_remaining, estimatedSecondsRemaining),
                style = MaterialTheme.typography.bodySmall,
                color = TextTertiary
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // "Notify me when done" button
        AnimatedVisibility(
            visible = !notifyEnabled,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Button(
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasNotificationPermission) {
                        permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        onNotifyEnabledChanged(true)
                    }
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = VibePurple,
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(0.7f)
            ) {
                Text(
                    text = stringResource(R.string.generation_btn_notify),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Confirmation text when enabled
        AnimatedVisibility(
            visible = notifyEnabled,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = stringResource(R.string.generation_notify_confirmation),
                    style = MaterialTheme.typography.bodySmall,
                    color = VibePurple,
                    fontWeight = FontWeight.Medium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = stringResource(R.string.generation_notify_leave_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextTertiary
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        TextButton(onClick = onCancel) {
            Text(
                text = stringResource(R.string.generation_btn_cancel),
                color = Color.Red.copy(alpha = 0.7f)
            )
        }
    }
}

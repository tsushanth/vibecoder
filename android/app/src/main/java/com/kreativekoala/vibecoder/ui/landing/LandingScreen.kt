package com.kreativekoala.vibecoder.ui.landing

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun LandingScreen(
    onGetStarted: () -> Unit,
    onSignIn: () -> Unit
) {
    val scrollState = rememberScrollState()

    // Animated gradient shift
    val infiniteTransition = rememberInfiniteTransition(label = "gradient")
    val animatedOffset by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "gradientShift"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF1A1040).copy(alpha = 0.6f + animatedOffset * 0.4f),
                        Color(0xFF0D0D1A),
                        DarkBackground
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .statusBarsPadding()
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(48.dp))

            // Hero Section
            HeroSection()

            Spacer(modifier = Modifier.height(48.dp))

            // How it works
            HowItWorksSection()

            Spacer(modifier = Modifier.height(40.dp))

            // Example apps showcase
            ExampleAppsSection()

            Spacer(modifier = Modifier.height(48.dp))

            // CTA Section
            CTASection(onGetStarted = onGetStarted, onSignIn = onSignIn)

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

@Composable
private fun HeroSection() {
    Column(
        modifier = Modifier.padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Animated logo
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(
                    Brush.linearGradient(
                        colors = listOf(VibePurple, VibePurpleLight, VibeBlue)
                    )
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Code,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = Color.White
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = stringResource(R.string.app_name),
            fontSize = 36.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = stringResource(R.string.landing_hero_subtitle),
            fontSize = 18.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            lineHeight = 26.sp
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Prompt preview pill
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            color = DarkSurfaceVariant.copy(alpha = 0.7f),
            border = ButtonDefaults.outlinedButtonBorder(enabled = true).copy(
                brush = Brush.linearGradient(
                    listOf(VibePurple.copy(alpha = 0.4f), VibeBlue.copy(alpha = 0.4f))
                )
            )
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = VibePurple
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = stringResource(R.string.landing_prompt_example),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                )
            }
        }
    }
}

@Composable
private fun HowItWorksSection() {
    Column(
        modifier = Modifier.padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = stringResource(R.string.landing_how_it_works_title),
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(24.dp))

        val steps = listOf(
            Triple(Icons.Default.Edit, stringResource(R.string.landing_step_describe_title), stringResource(R.string.landing_step_describe_desc)),
            Triple(Icons.Default.AutoAwesome, stringResource(R.string.landing_step_generate_title), stringResource(R.string.landing_step_generate_desc)),
            Triple(Icons.Default.Visibility, stringResource(R.string.landing_step_preview_title), stringResource(R.string.landing_step_preview_desc)),
            Triple(Icons.Default.Rocket, stringResource(R.string.landing_step_deploy_title), stringResource(R.string.landing_step_deploy_desc))
        )

        steps.forEachIndexed { index, (icon, title, desc) ->
            StepCard(
                stepNumber = index + 1,
                icon = icon,
                title = title,
                description = desc
            )
            if (index < steps.size - 1) {
                // Connector line
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(20.dp)
                        .background(VibePurple.copy(alpha = 0.3f))
                )
            }
        }
    }
}

@Composable
private fun StepCard(
    stepNumber: Int,
    icon: ImageVector,
    title: String,
    description: String
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = DarkSurfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Step number with icon
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(VibePurple.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = VibePurple
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "$stepNumber.",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = VibePurple
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = title,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                }
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = description,
                    fontSize = 13.sp,
                    color = TextSecondary
                )
            }
        }
    }
}

@Composable
private fun ExampleAppsSection() {
    Column(
        modifier = Modifier.padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = stringResource(R.string.landing_examples_title),
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(20.dp))

        val examples = listOf(
            Triple(Icons.Default.Cloud, stringResource(R.string.landing_example_weather_title), stringResource(R.string.landing_example_weather_desc)),
            Triple(Icons.Default.SportsEsports, stringResource(R.string.landing_example_memory_title), stringResource(R.string.landing_example_memory_desc)),
            Triple(Icons.Default.Calculate, stringResource(R.string.landing_example_budget_title), stringResource(R.string.landing_example_budget_desc)),
            Triple(Icons.Default.Timer, stringResource(R.string.landing_example_pomodoro_title), stringResource(R.string.landing_example_pomodoro_desc)),
            Triple(Icons.Default.Quiz, stringResource(R.string.landing_example_quiz_title), stringResource(R.string.landing_example_quiz_desc)),
            Triple(Icons.Default.FitnessCenter, stringResource(R.string.landing_example_workout_title), stringResource(R.string.landing_example_workout_desc))
        )

        // 2-column grid
        examples.chunked(2).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                row.forEach { (icon, title, desc) ->
                    ExampleAppCard(
                        icon = icon,
                        title = title,
                        description = desc,
                        modifier = Modifier.weight(1f)
                    )
                }
                // Fill remaining space if odd number
                if (row.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}

@Composable
private fun ExampleAppCard(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = DarkSurfaceVariant.copy(alpha = 0.6f)
    ) {
        Column(
            modifier = Modifier.padding(14.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(28.dp),
                tint = VibePurpleLight
            )
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
                maxLines = 1
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = description,
                fontSize = 11.sp,
                color = TextSecondary,
                maxLines = 2,
                lineHeight = 15.sp
            )
        }
    }
}

@Composable
private fun CTASection(
    onGetStarted: () -> Unit,
    onSignIn: () -> Unit
) {
    Column(
        modifier = Modifier.padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Primary CTA
        Button(
            onClick = onGetStarted,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
        ) {
            Icon(
                imageVector = Icons.Default.AutoAwesome,
                contentDescription = null,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.landing_cta_get_started),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Secondary CTA
        TextButton(onClick = onSignIn) {
            Text(
                text = stringResource(R.string.landing_cta_sign_in),
                color = TextSecondary,
                fontSize = 14.sp
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Trust indicators
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TrustBadge(icon = Icons.Default.Bolt, text = stringResource(R.string.landing_trust_badge_instant))
            TrustBadge(icon = Icons.Default.Lock, text = stringResource(R.string.landing_trust_badge_secure))
            TrustBadge(icon = Icons.Default.CreditCardOff, text = stringResource(R.string.landing_trust_badge_no_card))
        }
    }
}

@Composable
private fun TrustBadge(icon: ImageVector, text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(14.dp),
            tint = VibeGreen
        )
        Text(
            text = text,
            fontSize = 12.sp,
            color = TextTertiary
        )
    }
}

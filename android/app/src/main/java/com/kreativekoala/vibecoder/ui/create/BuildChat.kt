package com.kreativekoala.vibecoder.ui.create

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.vibecoder.ui.theme.*
import kotlinx.coroutines.delay

private val Green = Color(0xFF34D399)
private val Red = Color(0xFFF87171)
private val BuildPhases = listOf("Generate", "Validate", "Fix", "Polish", "Verify")

private fun currentPhaseIndex(phase: String, percent: Double): Int {
    val p = phase.lowercase()
    val idx = BuildPhases.indexOfFirst { p.contains(it.lowercase().take(5)) }
    return if (idx >= 0) idx else (percent / 100.0 * BuildPhases.size).toInt().coerceIn(0, BuildPhases.size - 1)
}

private fun fmt(seconds: Long): String = "%d:%02d".format(seconds / 60, seconds % 60)

/** Replit-Agent-style chat thread: prompt bubble, plan, streaming build progress, preview card, tweak composer. */
@Composable
fun BuildChatThread(
    state: CreateUiState,
    showUpsell: Boolean,
    onConfirmPlan: () -> Unit,
    onEditPrompt: () -> Unit,
    onCancel: () -> Unit,
    onOpenPreview: () -> Unit,
    onPublish: () -> Unit,
    onNewApp: () -> Unit,
    onTweak: (String) -> Unit,
    onUpgrade: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scroll = rememberScrollState()
    val focus = remember { FocusRequester() }
    var tweakText by remember { mutableStateOf("") }
    val stage = state.chatStage

    LaunchedEffect(stage, state.buildEvents.size, state.tweakTurns.size, state.buildPhase) {
        scroll.animateScrollTo(scroll.maxValue)
    }

    Column(modifier = modifier.fillMaxSize().imePadding()) {
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Spacer(Modifier.height(8.dp))
            UserBubble(state.chatPrompt)

            state.buildPlan?.let { plan ->
                AssistantCard {
                    Text("Here's my plan", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    if (plan.summary.isNotBlank()) {
                        Spacer(Modifier.height(6.dp)); Text(plan.summary, color = TextSecondary, fontSize = 14.sp)
                    }
                    plan.features.orEmpty().forEach {
                        Spacer(Modifier.height(4.dp)); Text("\u2022 $it", color = TextSecondary, fontSize = 13.sp)
                    }
                    if (plan.style.isNotBlank()) {
                        Spacer(Modifier.height(6.dp)); Text("Style: ${plan.style}", color = TextTertiary, fontSize = 12.sp)
                    }
                    if (stage == ChatStage.PlanReady) {
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onConfirmPlan, colors = ButtonDefaults.buttonColors(containerColor = VibePurple)) { Text("Build this") }
                            OutlinedButton(onClick = onEditPrompt) { Text("Edit prompt", color = TextSecondary) }
                        }
                    }
                }
            }

            if (stage == ChatStage.Planning) {
                AssistantCard { WorkingLine("Thinking through your idea") }
            }

            if (stage == ChatStage.Building || stage == ChatStage.Ready || stage == ChatStage.Failed) {
                ProgressCard(state)
            }

            if (stage == ChatStage.Failed) {
                AssistantCard {
                    Text(state.buildFailure ?: "Something went wrong.", color = Red, fontSize = 14.sp)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onEditPrompt, colors = ButtonDefaults.buttonColors(containerColor = VibePurple)) { Text("Edit & retry") }
                        OutlinedButton(onClick = onNewApp) { Text("New app", color = TextSecondary) }
                    }
                }
            }

            if ((stage == ChatStage.Building || stage == ChatStage.Ready) && showUpsell) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF6366F1).copy(alpha = 0.15f)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("This is your last free build", color = Color(0xFF818CF8), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Spacer(Modifier.height(4.dp))
                        Text("Upgrade to Pro for unlimited apps, priority builds, and no wait times.", color = TextSecondary, fontSize = 12.sp)
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = onUpgrade, colors = ButtonDefaults.buttonColors(containerColor = VibePurple)) { Text("Upgrade to Pro") }
                    }
                }
            }

            if (stage == ChatStage.Ready) {
                AssistantCard {
                    Text("Your app is ready", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Spacer(Modifier.height(4.dp))
                    val hasPreview = state.bundleDir != null || state.previewUrl != null
                    Text(
                        if (hasPreview) "Saved to My Projects. Open the live preview to try it." else "Saved to My Projects.",
                        color = TextSecondary, fontSize = 13.sp
                    )
                    state.deployedUrl?.let { Spacer(Modifier.height(4.dp)); Text("Published: $it", color = Green, fontSize = 12.sp) }
                    Spacer(Modifier.height(10.dp))
                    if (hasPreview) {
                        Button(
                            onClick = onOpenPreview, modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                        ) { Text("Open live preview") }
                        Spacer(Modifier.height(8.dp))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {}, enabled = false) { Text("Saved") }
                        OutlinedButton(onClick = onPublish, enabled = hasPreview) { Text("Publish", color = VibePurple) }
                        OutlinedButton(onClick = { focus.requestFocus() }) { Text("Tweak", color = VibePurple) }
                    }
                    Spacer(Modifier.height(6.dp))
                    TextButton(onClick = onNewApp) { Text("Start a new app", color = TextSecondary) }
                }

                state.tweakTurns.forEachIndexed { i, turn ->
                    UserBubble(turn.text)
                    AssistantCard {
                        when (turn.done) {
                            null -> WorkingLine(state.tweakPhase.ifBlank { "Applying changes" })
                            true -> Text(
                                "Done. Updated the preview" + if (i == state.tweakTurns.lastIndex) "." else " (v${i + 2}).",
                                color = Green, fontSize = 13.sp
                            )
                            false -> Text("That tweak didn't go through.", color = Red, fontSize = 13.sp)
                        }
                        if (turn.done == true && i == state.tweakTurns.lastIndex && (state.bundleDir != null || state.previewUrl != null)) {
                            TextButton(onClick = onOpenPreview) { Text("Open preview", color = VibePurple) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        // Bottom bar
        when (stage) {
            ChatStage.Ready -> Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(16.dp)).background(DarkSurfaceVariant)
                    .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)).padding(start = 4.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextField(
                    value = tweakText, onValueChange = { tweakText = it },
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    placeholder = { Text("Describe a change...", color = TextTertiary) },
                    maxLines = 4,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = VibePurple, focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary
                    )
                )
                val canSend = tweakText.isNotBlank() && !state.isTweaking
                FilledIconButton(
                    onClick = { onTweak(tweakText); tweakText = "" }, enabled = canSend,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = VibePurple, disabledContainerColor = DarkSurfaceElevated)
                ) { Icon(Icons.Default.ArrowUpward, contentDescription = "Send tweak", tint = if (canSend) TextPrimary else TextTertiary) }
            }
            ChatStage.Building, ChatStage.Planning -> Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                OutlinedButton(onClick = onCancel) { Text("Cancel build", color = TextSecondary) }
            }
            else -> {}
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text, color = TextPrimary, fontSize = 14.sp,
            modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp))
                .background(VibePurple.copy(alpha = 0.85f)).padding(horizontal = 14.dp, vertical = 10.dp)
        )
    }
}

@Composable
private fun AssistantCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(DarkSurfaceVariant)
            .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)).padding(14.dp),
        content = content
    )
}

@Composable
private fun WorkingLine(text: String) {
    var dots by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(400); dots = (dots + 1) % 4 } }
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = VibePurple)
        Spacer(Modifier.width(8.dp))
        Text(text.trimEnd('.', ' ') + ".".repeat(dots), color = TextPrimary, fontSize = 13.sp)
    }
}

@Composable
private fun ProgressCard(state: CreateUiState) {
    val stage = state.chatStage
    val building = stage == ChatStage.Building
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(building) { while (building) { now = System.currentTimeMillis(); delay(1000) } }
    val end = state.buildFinishedAtMs ?: now
    val elapsed = ((end - state.buildStartedAtMs) / 1000).coerceAtLeast(0)
    val idx = currentPhaseIndex(state.buildPhase, state.progressPercent)

    AssistantCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (stage) { ChatStage.Ready -> "Build complete"; ChatStage.Failed -> "Build failed"; else -> "Building your app" },
                color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f)
            )
            Text(fmt(elapsed), color = TextTertiary, fontSize = 12.sp)
        }
        Spacer(Modifier.height(10.dp))
        BuildPhases.forEachIndexed { i, name ->
            val done = stage == ChatStage.Ready || i < idx
            val active = building && i == idx
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                Icon(
                    if (done) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null,
                    tint = if (done) Green else if (active) VibePurple else TextTertiary, modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(name, color = if (done || active) TextPrimary else TextTertiary, fontSize = 13.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
        val log = state.buildEvents.mapNotNull { it.message?.takeIf { m -> m.isNotBlank() } }.takeLast(5)
        if (log.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            log.forEach { Text(it, color = TextTertiary, fontSize = 12.sp, maxLines = 2) }
        }
        if (building) {
            Spacer(Modifier.height(10.dp))
            WorkingLine(state.buildDetail.ifBlank { "Working on it" })
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { (state.progressPercent / 100.0).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(), color = VibePurple, trackColor = DarkSurfaceElevated
            )
        }
    }
}

package com.kreativekoala.vibecoder.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.kreativekoala.vibecoder.ui.components.SettingsRow
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun AccountScreen(
    modifier: Modifier = Modifier,
    onSignOut: () -> Unit,
    onSubscriptionsClick: () -> Unit,
    viewModel: AccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSignOutDialog by remember { mutableStateOf(false) }

    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.signOut()
                    showSignOutDialog = false
                    onSignOut()
                }) {
                    Text("Sign Out", color = ErrorRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) {
                    Text("Cancel")
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .padding(20.dp)
    ) {
        Spacer(modifier = Modifier.height(8.dp))

        // Profile header
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Avatar
            val avatarUrl = uiState.user?.avatarUrl
            if (avatarUrl != null) {
                AsyncImage(
                    model = avatarUrl,
                    contentDescription = "Profile photo",
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape)
                        .background(VibePurple.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = (uiState.user?.displayName?.take(1) ?: "?").uppercase(),
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = VibePurple
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = uiState.user?.displayName ?: "User",
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimary,
                fontWeight = FontWeight.Bold
            )

            Text(
                text = uiState.user?.email ?: "",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Subscription badge
            val tier = uiState.subscriptionStatus?.tier ?: uiState.user?.subscriptionTier ?: "free"
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = when (tier) {
                    "pro" -> VibePurple.copy(alpha = 0.2f)
                    "team" -> VibeBlue.copy(alpha = 0.2f)
                    else -> DarkSurfaceElevated
                }
            ) {
                Text(
                    text = tier.replaceFirstChar { it.uppercase() },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = when (tier) {
                        "pro" -> VibePurple
                        "team" -> VibeBlue
                        else -> TextSecondary
                    },
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Upgrade button (for free users)
        if ((uiState.subscriptionStatus?.tier ?: "free") == "free") {
            Button(
                onClick = onSubscriptionsClick,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                contentPadding = PaddingValues(vertical = 16.dp)
            ) {
                Icon(Icons.Default.Star, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Upgrade to Pro",
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(24.dp))
        }

        // Usage stats
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Usage",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.SemiBold
                )

                Spacer(modifier = Modifier.height(12.dp))

                val limit = uiState.subscriptionStatus?.limits
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    UsageStat(
                        label = "Projects",
                        value = "${uiState.user?.totalProjects ?: 0}"
                    )
                    UsageStat(
                        label = "Today's Gens",
                        value = "${uiState.user?.dailyGenerationCount ?: 0}" +
                                if (limit?.unlimited == true) "" else "/${limit?.dailyGenerations ?: 3}"
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Settings
        Text(
            text = "Settings",
            style = MaterialTheme.typography.titleMedium,
            color = TextPrimary,
            fontWeight = FontWeight.SemiBold
        )

        Spacer(modifier = Modifier.height(8.dp))

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
        ) {
            Column {
                SettingsRow(
                    icon = Icons.Default.CreditCard,
                    title = "Subscription",
                    onClick = onSubscriptionsClick
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Palette,
                    title = "Theme",
                    subtitle = "Dark",
                    onClick = { /* Dark only */ }
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Info,
                    title = "About",
                    subtitle = "Version 1.0.0",
                    onClick = { }
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Sign out
        OutlinedButton(
            onClick = { showSignOutDialog = true },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed),
            contentPadding = PaddingValues(vertical = 16.dp)
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ExitToApp,
                contentDescription = null,
                tint = ErrorRed
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Sign Out", fontWeight = FontWeight.SemiBold)
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun UsageStat(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = TextPrimary,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = TextTertiary
        )
    }
}

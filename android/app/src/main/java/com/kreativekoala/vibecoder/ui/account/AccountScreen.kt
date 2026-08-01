package com.kreativekoala.vibecoder.ui.account

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.os.LocaleListCompat
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import androidx.compose.ui.graphics.Color
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.components.SettingsRow
import com.kreativekoala.vibecoder.ui.theme.*
import com.kreativekoala.crosspromokit.models.AppId
import com.kreativekoala.crosspromokit.view.CrossPromoSection
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallPreview

@Composable
fun AccountScreen(
    modifier: Modifier = Modifier,
    onSignOut: () -> Unit,
    onSubscriptionsClick: () -> Unit,
    viewModel: AccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSignOutDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var tapCount by remember { mutableIntStateOf(0) }
    var showPaywallPreview by remember { mutableStateOf(false) }

    val supportedLanguages = listOf(
        "en" to R.string.language_english,
        "es" to R.string.language_spanish,
        "fr" to R.string.language_french,
        "de" to R.string.language_german,
        "ja" to R.string.language_japanese,
        "zh-CN" to R.string.language_chinese,
        "ko" to R.string.language_korean,
        "pt-BR" to R.string.language_portuguese,
        "it" to R.string.language_italian,
        "hi" to R.string.language_hindi,
    )

    val currentLocale = AppCompatDelegate.getApplicationLocales().toLanguageTags().ifEmpty { "en" }

    if (showPaywallPreview) {
        PaywallPreview(
            appId = "vibebuild",
            appName = "VibeBuild",
            features = listOf(
                PaywallFeature("\uD83C\uDFA8", "Unlimited Projects"),
                PaywallFeature("\uD83E\uDD16", "AI Assistant"),
                PaywallFeature("\uD83D\uDE80", "Cloud Deploy"),
                PaywallFeature("\uD83D\uDCF1", "All Templates"),
                PaywallFeature("\uD83D\uDCBE", "Cloud Storage")
            ),
            theme = PaywallTheme(accent = Color(0xFF6C63FF), accent2 = Color(0xFF9C27B0)),
            onDone = { showPaywallPreview = false }
        )
        return
    }

    if (showLanguageDialog) {
        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            title = { Text(stringResource(R.string.language_picker_title)) },
            text = {
                Column {
                    supportedLanguages.forEach { (code, nameRes) ->
                        val isSelected = currentLocale.startsWith(code.split("-")[0])
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    AppCompatDelegate.setApplicationLocales(
                                        LocaleListCompat.forLanguageTags(code)
                                    )
                                    showLanguageDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = isSelected,
                                onClick = {
                                    AppCompatDelegate.setApplicationLocales(
                                        LocaleListCompat.forLanguageTags(code)
                                    )
                                    showLanguageDialog = false
                                },
                                colors = RadioButtonDefaults.colors(selectedColor = VibePurple)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = stringResource(nameRes),
                                color = if (isSelected) VibePurple else TextPrimary,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showLanguageDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            title = { Text(stringResource(R.string.account_dialog_sign_out_title)) },
            text = { Text(stringResource(R.string.account_dialog_sign_out_message)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.signOut()
                    showSignOutDialog = false
                    onSignOut()
                }) {
                    Text(stringResource(R.string.sign_out), color = ErrorRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) {
                    Text(stringResource(R.string.cancel))
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
                    contentDescription = stringResource(R.string.account_cd_profile_photo),
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
                text = uiState.user?.displayName ?: stringResource(R.string.account_default_display_name),
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
                    text = stringResource(R.string.upgrade_to_pro),
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
                    text = stringResource(R.string.account_section_usage),
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
                        label = stringResource(R.string.account_stat_projects),
                        value = "${uiState.user?.totalProjects ?: 0}"
                    )
                    UsageStat(
                        label = stringResource(R.string.account_stat_todays_gens),
                        value = "${uiState.user?.dailyGenerationCount ?: 0}" +
                                if (limit?.unlimited == true) "" else "/${limit?.dailyGenerations ?: 3}"
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Settings
        Text(
            text = stringResource(R.string.account_section_settings),
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
                    title = stringResource(R.string.account_settings_subscription),
                    onClick = onSubscriptionsClick
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Palette,
                    title = stringResource(R.string.account_settings_theme),
                    subtitle = stringResource(R.string.account_settings_theme_value),
                    onClick = { /* Dark only */ }
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Language,
                    title = stringResource(R.string.account_settings_language),
                    subtitle = supportedLanguages
                        .firstOrNull { currentLocale.startsWith(it.first.split("-")[0]) }
                        ?.let { stringResource(it.second) } ?: stringResource(R.string.language_english),
                    onClick = { showLanguageDialog = true }
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.account_settings_about),
                    subtitle = stringResource(R.string.account_settings_version),
                    onClick = { tapCount++ }
                )
                if (tapCount >= 5) {
                    Button(
                        onClick = { showPaywallPreview = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                    ) {
                        Text("Preview Paywalls")
                    }
                }
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
            Text(stringResource(R.string.sign_out), fontWeight = FontWeight.SemiBold)
        }

        CrossPromoSection(currentApp = AppId.VIBEBUILD)

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

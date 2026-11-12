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
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.components.SettingsRow
import com.kreativekoala.vibecoder.BuildConfig
import com.kreativekoala.vibecoder.ui.theme.*
import com.kreativekoala.vibecoder.util.Monetization
import com.kreativekoala.vibecoder.util.PlayStoreLinks
import com.kreativekoala.crosspromokit.models.AppId
import com.kreativekoala.crosspromokit.view.CrossPromoSection

@Composable
fun AccountScreen(
    modifier: Modifier = Modifier,
    onSignOut: () -> Unit,
    onSubscriptionsClick: () -> Unit,
    viewModel: AccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    // Coming back from the paywall: show the server's view of the subscription (the first resume is the initial load).
    var firstResume by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstResume) firstResume = false
        else viewModel.refreshSubscription(expectPaid = MainActivity.isPremiumUser(context))
    }
    var showSignOutDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }

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

    // The account is gone and the session has ended: leave through the same exit as signing out.
    LaunchedEffect(uiState.deleteState) {
        if (uiState.deleteState is DeleteAccountState.Deleted) {
            showDeleteDialog = false
            onSignOut()
        }
    }

    if (showDeleteDialog) {
        val deleteState = uiState.deleteState
        val deleting = deleteState is DeleteAccountState.Deleting
        AlertDialog(
            onDismissRequest = {
                if (!deleting) {
                    showDeleteDialog = false
                    viewModel.dismissDeleteError()
                }
            },
            title = { Text(stringResource(R.string.account_dialog_delete_title)) },
            text = {
                Column {
                    Text(stringResource(R.string.account_dialog_delete_message))
                    if (deleteState is DeleteAccountState.Failed) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = stringResource(
                                if (deleteState.reason == DeleteFailure.SignInAgain) R.string.account_delete_sign_in_again
                                else R.string.account_delete_error
                            ),
                            color = ErrorRed,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteAccount() }, enabled = !deleting) {
                    if (deleting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = ErrorRed)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.account_deleting), color = ErrorRed)
                    } else {
                        Text(stringResource(R.string.account_delete_account), color = ErrorRed)
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDeleteDialog = false
                        viewModel.dismissDeleteError()
                    },
                    enabled = !deleting
                ) {
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

            if (!Monetization.ALL_FREE) {
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
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Upgrade button (for free users)
        if (!Monetization.ALL_FREE && (uiState.subscriptionStatus?.tier ?: "free") == "free") {
            Button(
                onClick = onSubscriptionsClick,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
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
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, DarkBorder),
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

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    UsageStat(
                        label = stringResource(R.string.account_stat_projects),
                        value = "${uiState.user?.totalProjects ?: 0}"
                    )
                    todaysGenerationsText(uiState)?.let { text ->
                        UsageStat(
                            label = stringResource(R.string.account_stat_todays_gens),
                            value = text
                        )
                    }
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
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, DarkBorder),
            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
        ) {
            Column {
                if (!Monetization.ALL_FREE) {
                    SettingsRow(
                        icon = Icons.Default.CreditCard,
                        title = stringResource(R.string.account_settings_subscription),
                        onClick = onSubscriptionsClick
                    )
                    HorizontalDivider(color = DarkBorder)
                }
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
                    icon = Icons.Default.Star,
                    title = stringResource(R.string.account_settings_rate),
                    onClick = { PlayStoreLinks.openListing(context) }
                )
                HorizontalDivider(color = DarkBorder)
                SettingsRow(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.account_settings_about),
                    subtitle = stringResource(R.string.account_settings_version, BuildConfig.VERSION_NAME),
                    onClick = {}
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
            Text(stringResource(R.string.sign_out), fontWeight = FontWeight.SemiBold)
        }

        // Account deletion (Google Play requires an in-app path). Kept quiet: it sits under Sign out and always asks first.
        TextButton(
            onClick = { showDeleteDialog = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.DeleteForever, contentDescription = null, tint = ErrorRed)
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(R.string.account_delete_account), color = ErrorRed)
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

/**
 * The "Today's Gens" figure, or null when it should not be shown. While the app is all free there is no daily cap to show against,
 * so the stat is hidden. Otherwise it is "N/limit" with the limit from the server's subscription status (never a hard-coded
 * number: the server's free limit has changed over time), "N" for paid or unlimited plans, and "N" when the server sent no limit.
 */
internal fun todaysGenerationsText(uiState: AccountUiState, allFree: Boolean = Monetization.ALL_FREE): String? {
    if (allFree) return null
    val limit = uiState.subscriptionStatus?.limits
    val paidTier = (uiState.subscriptionStatus?.tier ?: uiState.user?.subscriptionTier ?: "free") != "free"
    val used = uiState.user?.dailyGenerationCount ?: 0
    val cap = limit?.dailyGenerations
    return if (paidTier || limit?.unlimited == true || cap == null) "$used" else "$used/$cap"
}

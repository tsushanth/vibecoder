package com.kreativekoala.vibecoder.ui.main

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.account.AccountScreen
import com.kreativekoala.vibecoder.ui.apps.AppsScreen
import com.kreativekoala.vibecoder.ui.browse.BrowseScreen
import com.kreativekoala.vibecoder.ui.create.CreateScreen
import com.kreativekoala.vibecoder.ui.theme.DarkBackground
import com.kreativekoala.vibecoder.ui.theme.DarkSurface
import com.kreativekoala.vibecoder.ui.theme.TextSecondary
import com.kreativekoala.vibecoder.ui.theme.VibePurple

data class TabItem(
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

private const val PREF_TELEGRAM_BANNER_DISMISSED = "telegram_banner_dismissed"

@Composable
fun MainScreen(
    onSignOut: () -> Unit,
    onNavigateToSubscriptions: () -> Unit,
    onNavigateToHardPaywall: () -> Unit,
    onNavigateToProjectDetail: (String) -> Unit,
    onNavigateToProjectPreview: (String) -> Unit,
    viewModel: MainViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val tabs = listOf(
        TabItem("Apps", Icons.Filled.Folder, Icons.Outlined.FolderOpen),
        TabItem("Create", Icons.Filled.AddCircle, Icons.Outlined.AddCircleOutline),
        TabItem("Browse", Icons.Filled.Explore, Icons.Outlined.Explore),
        TabItem("Account", Icons.Filled.AccountCircle, Icons.Outlined.AccountCircle)
    )

    var selectedTabIndex by remember { mutableIntStateOf(1) }

    val isSystemDown by viewModel.isSystemDown.collectAsState()
    val systemMessage by viewModel.systemMessage.collectAsState()

    // Telegram banner - persisted dismiss state
    val prefs = remember { context.getSharedPreferences("app_prefs", android.content.Context.MODE_PRIVATE) }
    var showTelegramBanner by remember {
        mutableStateOf(!prefs.getBoolean(PREF_TELEGRAM_BANNER_DISMISSED, false))
    }

    Scaffold(
        containerColor = DarkBackground,
        bottomBar = {
            NavigationBar(
                containerColor = DarkSurface,
                contentColor = TextSecondary
            ) {
                tabs.forEachIndexed { index, tab ->
                    NavigationBarItem(
                        selected = selectedTabIndex == index,
                        onClick = { selectedTabIndex = index },
                        icon = {
                            Icon(
                                imageVector = if (selectedTabIndex == index) tab.selectedIcon else tab.unselectedIcon,
                                contentDescription = tab.title
                            )
                        },
                        label = { Text(text = tab.title) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = VibePurple,
                            selectedTextColor = VibePurple,
                            unselectedIconColor = TextSecondary,
                            unselectedTextColor = TextSecondary,
                            indicatorColor = VibePurple.copy(alpha = 0.15f)
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        Column(modifier = Modifier.padding(innerPadding)) {
            // Maintenance banner (shown when system is down)
            AnimatedVisibility(
                visible = isSystemDown,
                enter = slideInVertically(initialOffsetY = { -it }),
                exit = slideOutVertically(targetOffsetY = { -it })
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFB45309))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = systemMessage ?: "Builds temporarily unavailable. Check back soon!",
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Telegram banner (dismissible, one-time)
            AnimatedVisibility(
                visible = showTelegramBanner && !isSystemDown,
                enter = slideInVertically(initialOffsetY = { -it }),
                exit = slideOutVertically(targetOffsetY = { -it })
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF1D4ED8))
                        .clickable {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me/Vibebuilder_bot"))
                            context.startActivity(intent)
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "✨ Build apps via Telegram! @Vibebuilder_bot",
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = {
                            showTelegramBanner = false
                            prefs.edit().putBoolean(PREF_TELEGRAM_BANNER_DISMISSED, true).apply()
                        },
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Dismiss",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            // Main content
            Box(modifier = Modifier.weight(1f)) {
                when (selectedTabIndex) {
                    0 -> AppsScreen(
                        modifier = Modifier.fillMaxSize(),
                        onProjectClick = onNavigateToProjectDetail
                    )
                    1 -> CreateScreen(
                        modifier = Modifier.fillMaxSize(),
                        onNavigateToSubscriptions = onNavigateToSubscriptions,
                        onNavigateToHardPaywall = onNavigateToHardPaywall
                    )
                    2 -> BrowseScreen(
                        modifier = Modifier.fillMaxSize(),
                        onProjectClick = onNavigateToProjectPreview
                    )
                    3 -> AccountScreen(
                        modifier = Modifier.fillMaxSize(),
                        onSignOut = onSignOut,
                        onSubscriptionsClick = onNavigateToSubscriptions
                    )
                }
            }
        }
    }
}

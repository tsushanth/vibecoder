package com.kreativekoala.vibecoder.ui.main

import com.kreativekoala.vibecoder.R
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AddCircle
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.account.AccountScreen
import com.kreativekoala.vibecoder.ui.apps.AppsScreen
import com.kreativekoala.vibecoder.ui.browse.BrowseScreen
import com.kreativekoala.vibecoder.ui.create.CreateScreen
import com.kreativekoala.vibecoder.ui.theme.DarkBackground
import com.kreativekoala.vibecoder.ui.theme.DarkBorder
import com.kreativekoala.vibecoder.ui.theme.TextSecondary
import com.kreativekoala.vibecoder.ui.theme.VibePurple

data class TabItem(
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

@Composable
fun MainScreen(
    onSignOut: () -> Unit,
    onNavigateToSubscriptions: () -> Unit,
    onNavigateToHardPaywall: () -> Unit,
    onNavigateToProjectDetail: (String) -> Unit,
    onNavigateToProjectPreview: (String) -> Unit,
    viewModel: MainViewModel = hiltViewModel()
) {
    val tabs = listOf(
        TabItem(stringResource(R.string.tab_apps), Icons.Filled.Folder, Icons.Outlined.FolderOpen),
        TabItem(stringResource(R.string.tab_create), Icons.Filled.AddCircle, Icons.Outlined.AddCircleOutline),
        TabItem(stringResource(R.string.tab_browse_nav), Icons.Filled.Explore, Icons.Outlined.Explore),
        TabItem(stringResource(R.string.tab_account), Icons.Filled.AccountCircle, Icons.Outlined.AccountCircle)
    )

    var selectedTabIndex by remember { mutableIntStateOf(1) }

    val isSystemDown by viewModel.isSystemDown.collectAsState()
    val systemMessage by viewModel.systemMessage.collectAsState()

    Scaffold(
        containerColor = DarkBackground,
        bottomBar = {
            Column {
            HorizontalDivider(color = DarkBorder)
            NavigationBar(
                containerColor = DarkBackground,
                contentColor = TextSecondary,
                tonalElevation = 0.dp
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
                            indicatorColor = Color.Transparent
                        )
                    )
                }
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
                        text = systemMessage ?: stringResource(R.string.main_builds_unavailable),
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
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

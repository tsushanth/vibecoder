package com.kreativekoala.vibecoder.ui.main

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.kreativekoala.vibecoder.ui.account.AccountScreen
import com.kreativekoala.vibecoder.ui.apps.AppsScreen
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

@Composable
fun MainScreen(
    onSignOut: () -> Unit,
    onNavigateToBrowse: () -> Unit,
    onNavigateToSubscriptions: () -> Unit,
    onNavigateToProjectDetail: (String) -> Unit
) {
    val tabs = listOf(
        TabItem("Apps", Icons.Filled.Folder, Icons.Outlined.FolderOpen),
        TabItem("Create", Icons.Filled.AddCircle, Icons.Outlined.AddCircleOutline),
        TabItem("Account", Icons.Filled.AccountCircle, Icons.Outlined.AccountCircle)
    )

    var selectedTabIndex by remember { mutableIntStateOf(1) } // Create tab default

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
                        label = {
                            Text(text = tab.title)
                        },
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
        when (selectedTabIndex) {
            0 -> AppsScreen(
                modifier = Modifier.padding(innerPadding),
                onProjectClick = onNavigateToProjectDetail,
                onBrowseClick = onNavigateToBrowse
            )
            1 -> CreateScreen(
                modifier = Modifier.padding(innerPadding)
            )
            2 -> AccountScreen(
                modifier = Modifier.padding(innerPadding),
                onSignOut = onSignOut,
                onSubscriptionsClick = onNavigateToSubscriptions
            )
        }
    }
}

package com.kreativekoala.vibecoder.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.kreativekoala.vibecoder.ui.account.SubscriptionPlansScreen
import com.kreativekoala.vibecoder.ui.apps.ProjectDetailScreen
import com.kreativekoala.vibecoder.ui.auth.AuthViewModel
import com.kreativekoala.vibecoder.ui.auth.SignInScreen
import com.kreativekoala.vibecoder.ui.browse.BrowseScreen
import com.kreativekoala.vibecoder.ui.browse.ProjectPreviewScreen
import com.kreativekoala.vibecoder.ui.main.MainScreen

@Composable
fun VibeBuildNavGraph() {
    val navController = rememberNavController()
    val authViewModel: AuthViewModel = hiltViewModel()
    val isAuthenticated by authViewModel.isAuthenticated.collectAsState()

    val startDestination = if (isAuthenticated) Screen.Main.route else Screen.SignIn.route

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.SignIn.route) {
            SignInScreen(
                onSignInSuccess = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.SignIn.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Main.route) {
            MainScreen(
                onSignOut = {
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onNavigateToBrowse = {
                    navController.navigate(Screen.Browse.route)
                },
                onNavigateToSubscriptions = {
                    navController.navigate(Screen.SubscriptionPlans.route)
                },
                onNavigateToProjectDetail = { projectId ->
                    navController.navigate(Screen.ProjectDetail.createRoute(projectId))
                }
            )
        }

        composable(
            route = Screen.ProjectDetail.route,
            arguments = listOf(navArgument("projectId") { type = NavType.StringType })
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectDetailScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Browse.route) {
            BrowseScreen(
                onBack = { navController.popBackStack() },
                onProjectClick = { projectId ->
                    navController.navigate(Screen.ProjectPreview.createRoute(projectId))
                }
            )
        }

        composable(
            route = Screen.ProjectPreview.route,
            arguments = listOf(navArgument("projectId") { type = NavType.StringType })
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectPreviewScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.SubscriptionPlans.route) {
            SubscriptionPlansScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
}

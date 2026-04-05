package com.kreativekoala.vibecoder.navigation

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import com.kreativekoala.vibecoder.ui.landing.LandingScreen
import com.kreativekoala.vibecoder.ui.main.MainScreen
import com.kreativekoala.vibecoder.ui.onboarding.OnboardingScreen
import com.kreativekoala.vibecoder.ui.theme.DarkBackground

private const val PREFS_NAME = "vibebuild_prefs"
private const val KEY_ONBOARDING_COMPLETED = "onboarding_completed"

@Composable
fun VibeBuildNavGraph() {
    val navController = rememberNavController()
    val authViewModel: AuthViewModel = hiltViewModel()
    val isAuthenticated by authViewModel.isAuthenticated.collectAsState()
    val isAuthResolved by authViewModel.isAuthResolved.collectAsState()
    val context = LocalContext.current

    // Wait for the Supabase session to be checked before deciding the start destination.
    // Without this guard the NavHost would always start at Landing because the session
    // hasn't been restored yet on cold start.
    if (!isAuthResolved) {
        // Show an empty dark screen while auth state is being resolved (typically <200ms)
        Box(modifier = Modifier.fillMaxSize().background(DarkBackground))
        return
    }

    val startDestination = remember(isAuthenticated) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val hasCompletedOnboarding = prefs.getBoolean(KEY_ONBOARDING_COMPLETED, false)
        when {
            !isAuthenticated -> Screen.Landing.route
            !hasCompletedOnboarding -> Screen.Onboarding.route
            else -> Screen.Main.route
        }
    }

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Landing.route) {
            LandingScreen(
                onGetStarted = {
                    navController.navigate(Screen.SignIn.route)
                },
                onSignIn = {
                    navController.navigate(Screen.SignIn.route)
                }
            )
        }

        composable(Screen.SignIn.route) {
            SignInScreen(
                onSignInSuccess = {
                    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    val hasCompletedOnboarding = prefs.getBoolean(KEY_ONBOARDING_COMPLETED, false)
                    if (hasCompletedOnboarding) {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.Landing.route) { inclusive = true }
                        }
                    } else {
                        navController.navigate(Screen.Onboarding.route) {
                            popUpTo(Screen.Landing.route) { inclusive = true }
                        }
                    }
                }
            )
        }

        composable(Screen.Onboarding.route) {
            OnboardingScreen(
                onComplete = {
                    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit().putBoolean(KEY_ONBOARDING_COMPLETED, true).apply()
                    navController.navigate(Screen.Paywall.route) {
                        popUpTo(Screen.Onboarding.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Paywall.route) {
            SubscriptionPlansScreen(
                onBack = {
                    if (!navController.popBackStack()) {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(0) { inclusive = true }
                        }
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
                onNavigateToSubscriptions = {
                    navController.navigate(Screen.SubscriptionPlans.route)
                },
                onNavigateToProjectDetail = { projectId ->
                    navController.navigate(Screen.ProjectDetail.createRoute(projectId))
                },
                onNavigateToProjectPreview = { projectId ->
                    navController.navigate(Screen.ProjectPreview.createRoute(projectId))
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
                onProjectClick = { projectId ->
                    navController.navigate(Screen.ProjectPreview.createRoute(projectId))
                },
                onBack = { navController.popBackStack() }
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

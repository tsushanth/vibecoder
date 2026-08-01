package com.kreativekoala.vibecoder.navigation

sealed class Screen(val route: String) {
    data object Landing : Screen("landing")
    data object SignIn : Screen("sign_in")
    data object Onboarding : Screen("onboarding")
    data object Paywall : Screen("paywall")
    data object Main : Screen("main")
    data object Apps : Screen("apps")
    data object Create : Screen("create")
    data object Account : Screen("account")
    data object Browse : Screen("browse")
    data object ProjectDetail : Screen("project/{projectId}") {
        fun createRoute(projectId: String) = "project/$projectId"
    }
    data object LivePreview : Screen("preview")
    data object SubscriptionPlans : Screen("subscriptions")
    /** Non-dismissible paywall — entered when the user hits the free-build cap.
     * Same RevenueCat paywall UI, but no X button and back navigation is blocked
     * until purchase completes. */
    data object HardPaywall : Screen("subscriptions/hard")
    data object ProjectPreview : Screen("browse/preview/{projectId}") {
        fun createRoute(projectId: String) = "browse/preview/$projectId"
    }
}

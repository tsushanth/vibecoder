package com.kreativekoala.vibecoder.util

object Constants {
    const val BASE_URL = "https://vibecoder-api-917362189743.us-central1.run.app/"
    const val SSE_TIMEOUT_MS = 600_000L // 10 minutes

    // Supabase
    const val SUPABASE_URL = "https://owvvrljdfnhntwedepkl.supabase.co"
    const val SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk"

    // Google Sign-In (Web Client ID for Credential Manager -> Supabase)
    const val GOOGLE_WEB_CLIENT_ID = "917362189743-2tgjn2l4m09ht423l9ogsm74aiotbjgv.apps.googleusercontent.com"

    // Google Play product IDs
    const val PRODUCT_PRO_MONTHLY = "com.kreativekoala.vibebuild.pro.monthly"
    const val PRODUCT_PRO_YEARLY = "com.kreativekoala.vibebuild.pro.yearly"
    const val PRODUCT_TEAM_MONTHLY = "com.kreativekoala.vibebuild.team.monthly"

    // Free tier limits
    const val FREE_DAILY_GENERATION_LIMIT = 3
    const val FREE_TWEAKS_PER_PROJECT = 3
}

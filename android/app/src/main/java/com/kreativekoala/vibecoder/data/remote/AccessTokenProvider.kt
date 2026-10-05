package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.util.Constants
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton

/** The signed-in user's access token for requests to [host], or null when signed out or the host is not ours. */
interface AccessTokenProvider {
    fun tokenFor(host: String): String?
}

@Singleton
class SupabaseAccessTokenProvider @Inject constructor(
    private val supabase: SupabaseClient
) : AccessTokenProvider {
    override fun tokenFor(host: String): String? =
        if (isApiHost(host)) supabase.auth.currentAccessTokenOrNull() else null

    companion object {
        /** Only our own API ever receives the token; never a third-party host (image CDNs, redirects, etc.). */
        fun isApiHost(host: String): Boolean =
            host.equals(URI(Constants.BASE_URL).host, ignoreCase = true)
    }
}

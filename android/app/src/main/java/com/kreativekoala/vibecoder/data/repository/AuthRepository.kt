package com.kreativekoala.vibecoder.data.repository

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.kreativekoala.vibecoder.data.model.DeleteRequest
import com.kreativekoala.vibecoder.data.model.RegisterRequest
import com.kreativekoala.vibecoder.data.model.User
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import com.kreativekoala.vibecoder.ui.auth.AuthFailure
import com.kreativekoala.vibecoder.ui.auth.AuthFailureException
import com.kreativekoala.vibecoder.util.Constants
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.providers.builtin.IDToken
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transform
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Lightweight auth identity exposed to ViewModels.
 */
data class AuthUser(
    val uid: String,
    val email: String?,
    val displayName: String?,
    val avatarUrl: String?
)

/**
 * The signed-in user as the app knows it from the Supabase session alone. The backend has no
 * "get user" endpoint, so this is the profile used whenever the server did not return one.
 */
fun AuthUser.toLocalUser(): User = User(
    userId = uid,
    email = email,
    displayName = displayName ?: email?.substringBefore('@'),
    avatarUrl = avatarUrl
)

@Singleton
class AuthRepository @Inject constructor(
    private val api: VibeBuildApi,
    private val supabase: SupabaseClient
) {

    /**
     * Observe Supabase session changes, emitting an AuthUser when
     * authenticated or null when signed out.
     */
    fun observeAuthState(): Flow<AuthUser?> {
        return supabase.auth.sessionStatus.map { status ->
            when (status) {
                is SessionStatus.Authenticated -> {
                    val user = status.session.user ?: return@map null
                    AuthUser(
                        uid = user.id,
                        email = user.email,
                        displayName = user.userMetadata?.get("full_name")?.toString()?.removeSurrounding("\""),
                        avatarUrl = user.userMetadata?.get("avatar_url")?.toString()?.removeSurrounding("\"")
                    )
                }
                else -> null
            }
        }
    }

    /**
     * The Supabase user id each time a session is established or restored, and null when the user is signed out. The initial and
     * refresh-failure states say nothing about who is signed in, so they emit nothing.
     */
    fun observeUserId(): Flow<String?> {
        return supabase.auth.sessionStatus.transform { status ->
            when (status) {
                is SessionStatus.Authenticated -> status.session.user?.id?.let { emit(it) }
                is SessionStatus.NotAuthenticated -> emit(null)
                else -> Unit
            }
        }.distinctUntilChanged()
    }

    /**
     * Returns the currently signed-in user, or null.
     */
    val currentUser: AuthUser?
        get() {
            val session = supabase.auth.currentSessionOrNull() ?: return null
            val user = session.user ?: return null
            return AuthUser(
                uid = user.id,
                email = user.email,
                displayName = user.userMetadata?.get("full_name")?.toString()?.removeSurrounding("\""),
                avatarUrl = user.userMetadata?.get("avatar_url")?.toString()?.removeSurrounding("\"")
            )
        }

    /**
     * Sign in with Google via Credential Manager -> Supabase IDToken provider.
     *
     * 1. Use Credential Manager to get a Google ID token
     * 2. Exchange it with Supabase Auth via the IDToken provider
     * 3. Register the user with the VibeBuild backend
     */
    suspend fun signInWithGoogle(context: Context): User {
        // Step 1: Get Google ID token via Credential Manager
        val credentialManager = CredentialManager.create(context)

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(Constants.GOOGLE_WEB_CLIENT_ID)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        val result = credentialManager.getCredential(context, request)
        val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(result.credential.data)
        val idToken = googleIdTokenCredential.idToken

        // Step 2: Sign in to Supabase with the Google ID token
        supabase.auth.signInWith(IDToken) {
            this.idToken = idToken
            provider = Google
        }

        // Step 3: Register with VibeBuild backend
        val authUser = currentUser ?: throw AuthFailureException(AuthFailure.GoogleFailed)
        return registerWithBackend(authUser)
    }

    suspend fun signUpWithEmail(email: String, password: String, displayName: String?): User {
        supabase.auth.signUpWith(Email) {
            this.email = email
            this.password = password
        }
        // No session after a successful sign-up means the project wants the email confirmed before the first sign-in.
        val authUser = currentUser ?: throw AuthFailureException(AuthFailure.ConfirmEmailToFinish)
        return registerWithBackend(
            authUser.copy(displayName = displayName ?: authUser.displayName)
        )
    }

    suspend fun signInWithEmail(email: String, password: String): User {
        supabase.auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
        val authUser = currentUser ?: throw AuthFailureException(AuthFailure.Unknown)
        return registerWithBackend(authUser)
    }

    private suspend fun registerWithBackend(authUser: AuthUser): User {
        val request = RegisterRequest(
            userId = authUser.uid,
            email = authUser.email,
            displayName = authUser.displayName,
            avatarUrl = authUser.avatarUrl
        )

        val response = api.register(request)
        return response.user ?: authUser.toLocalUser()
    }

    suspend fun signOut() {
        supabase.auth.signOut()
    }

    /**
     * Deletes the signed-in user's account and all their data on the server (the same call the web settings page makes), then
     * ends the local session. A failure of the server call is thrown so the caller can show it and the person can try again.
     * Once the server has deleted the account, a failure to sign out does not matter: the session is dropped locally instead.
     */
    suspend fun deleteAccount() {
        val uid = currentUser?.uid ?: throw IllegalStateException("Not signed in")
        api.deleteAccount(DeleteRequest(uid))
        try {
            supabase.auth.signOut()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The login is already gone on the server, so revoking its token there can fail.
            supabase.auth.clearSession()
        }
    }
}

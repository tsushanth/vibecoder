package com.kreativekoala.vibecoder.service

import android.util.Log
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.awaitLogIn
import com.revenuecat.purchases.awaitLogOut
import com.revenuecat.purchases.restorePurchasesWith
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The RevenueCat calls the identity sync needs, so the sync logic can be tested without the SDK. */
interface PurchasesGateway {
    val appUserId: String
    val isAnonymous: Boolean

    /** Identifies the SDK as [uid]; RevenueCat aliases a purchase made while anonymous to it. Returns true if [uid] has an active entitlement. */
    suspend fun logIn(uid: String): Boolean

    suspend fun logOut()

    /** Re-syncs the store account's purchases to the current RevenueCat user. */
    suspend fun restore()
}

class RealPurchasesGateway : PurchasesGateway {
    override val appUserId: String get() = Purchases.sharedInstance.appUserID
    override val isAnonymous: Boolean get() = Purchases.sharedInstance.isAnonymous

    override suspend fun logIn(uid: String): Boolean =
        Purchases.sharedInstance.awaitLogIn(uid).customerInfo.entitlements.active.isNotEmpty()

    override suspend fun logOut() {
        Purchases.sharedInstance.awaitLogOut()
    }

    override suspend fun restore(): Unit = suspendCancellableCoroutine { cont ->
        Purchases.sharedInstance.restorePurchasesWith(
            onError = { cont.resumeWithException(IllegalStateException(it.message)) },
            onSuccess = { cont.resume(Unit) }
        )
    }
}

/**
 * Ties RevenueCat purchases to the signed-in Supabase user. The server's RevenueCat webhook maps the event's app_user_id to the
 * Supabase user id and ignores anonymous ($RCAnonymousID) ids, so without this a mobile payer is never entitled on the server.
 *
 * Call [apply] with the Supabase user id whenever the session is established or restored, and with null on sign-out.
 */
class RevenueCatIdentitySync(
    private val gateway: PurchasesGateway,
    private val retryDelaysMs: List<Long> = listOf(2_000L, 8_000L, 30_000L)
) {
    suspend fun apply(uid: String?) {
        if (uid == null) {
            // logOut() on an anonymous user is an SDK error, and there is nothing to undo.
            if (!gateway.isAnonymous) attempt("logOut") { gateway.logOut() }
            return
        }
        if (gateway.appUserId == uid) return
        var hasEntitlement = false
        val loggedIn = attempt("logIn") { hasEntitlement = gateway.logIn(uid) }
        // A user who already existed in RevenueCat does not inherit this device's anonymous purchase, so pull the store account's
        // purchases over (the same restore the launch gate already runs).
        if (loggedIn && !hasEntitlement) attempt("restore", retries = false) { gateway.restore() }
    }

    private suspend fun attempt(what: String, retries: Boolean = true, block: suspend () -> Unit): Boolean {
        val delays = if (retries) retryDelaysMs else emptyList()
        for (i in 0..delays.size) {
            try {
                block()
                return true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "RevenueCat $what failed (attempt ${i + 1}): ${e.message}")
                if (i < delays.size) delay(delays[i])
            }
        }
        return false
    }

    private companion object { const val TAG = "RevenueCatIdentity" }
}

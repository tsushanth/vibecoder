package com.kreativekoala.vibecoder.service

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class RevenueCatIdentitySyncTest {

    private class FakeGateway(
        override var appUserId: String = "\$RCAnonymousID:abc",
        var logInEntitled: Boolean = false,
        var logInFailures: Int = 0,
        var logOutFailures: Int = 0
    ) : PurchasesGateway {
        override val isAnonymous: Boolean get() = appUserId.startsWith("\$RCAnonymousID:")
        val calls = mutableListOf<String>()

        override suspend fun logIn(uid: String): Boolean {
            calls += "logIn($uid)"
            if (logInFailures > 0) { logInFailures--; throw IOException("offline") }
            appUserId = uid
            return logInEntitled
        }

        override suspend fun logOut() {
            calls += "logOut"
            if (logOutFailures > 0) { logOutFailures--; throw IOException("offline") }
            appUserId = "\$RCAnonymousID:new"
        }

        override suspend fun restore() { calls += "restore" }
    }

    private fun sync(g: FakeGateway) = RevenueCatIdentitySync(g, retryDelaysMs = listOf(10L, 10L))

    @Test fun signInIdentifiesTheAnonymousUserAsTheSupabaseUser() = runTest {
        val g = FakeGateway(logInEntitled = true)
        sync(g).apply("u1")
        assertEquals(listOf("logIn(u1)"), g.calls)
        assertEquals("u1", g.appUserId)
    }

    @Test fun restoredSessionAlreadyIdentifiedDoesNothing() = runTest {
        val g = FakeGateway(appUserId = "u1")
        sync(g).apply("u1")
        assertEquals(emptyList<String>(), g.calls)
    }

    @Test fun differentUserSignedInOnSameDeviceLogsInAgain() = runTest {
        val g = FakeGateway(appUserId = "u1", logInEntitled = true)
        sync(g).apply("u2")
        assertEquals(listOf("logIn(u2)"), g.calls)
    }

    @Test fun userWithNoEntitlementAfterLoginRestoresStorePurchases() = runTest {
        val g = FakeGateway(logInEntitled = false)
        sync(g).apply("u1")
        assertEquals(listOf("logIn(u1)", "restore"), g.calls)
    }

    @Test fun failedLoginIsRetriedThenSucceeds() = runTest {
        val g = FakeGateway(logInEntitled = true, logInFailures = 2)
        sync(g).apply("u1")
        assertEquals(listOf("logIn(u1)", "logIn(u1)", "logIn(u1)"), g.calls)
        assertEquals("u1", g.appUserId)
    }

    @Test fun loginGivesUpAfterTheRetriesAndDoesNotRestore() = runTest {
        val g = FakeGateway(logInFailures = 99)
        sync(g).apply("u1")
        assertEquals(3, g.calls.size) // first try + 2 retries
        assertEquals(true, g.isAnonymous)
    }

    @Test fun signOutLogsTheIdentifiedUserOut() = runTest {
        val g = FakeGateway(appUserId = "u1")
        sync(g).apply(null)
        assertEquals(listOf("logOut"), g.calls)
        assertEquals(true, g.isAnonymous)
    }

    @Test fun signOutWhileAnonymousDoesNotCallLogOut() = runTest {
        val g = FakeGateway()
        sync(g).apply(null)
        assertEquals(emptyList<String>(), g.calls)
    }

    @Test fun failedLogOutIsRetried() = runTest {
        val g = FakeGateway(appUserId = "u1", logOutFailures = 1)
        sync(g).apply(null)
        assertEquals(listOf("logOut", "logOut"), g.calls)
    }
}

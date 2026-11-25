package com.kreativekoala.vibecoder.service

import com.kreativekoala.vibecoder.data.repository.AuthUser
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class RegistrationSyncTest {

    private class Fake(var failures: Int = 0) {
        val attempts = mutableListOf<String>()
        val registered = mutableListOf<String>()
        val gaveUp = mutableListOf<Exception>()
        val sync = RegistrationSync(
            register = { user ->
                attempts += user.uid
                if (failures > 0) { failures--; throw IOException("offline") }
            },
            onRegistered = { registered += it },
            onGaveUp = { gaveUp += it },
            retryDelaysMs = listOf(10L, 10L)
        )
    }

    private fun user(id: String) = AuthUser(id, "$id@example.com", null, null)

    @Test fun aStoredSessionRegistersOnLaunch() = runTest {
        val f = Fake()
        f.sync.run(flowOf(null, user("u1")))
        assertEquals(listOf("u1"), f.attempts)
        assertEquals(listOf("u1"), f.registered)
    }

    @Test fun aFailedRegistrationIsRetried() = runTest {
        val f = Fake(failures = 2)
        f.sync.run(flowOf(user("u1")))
        assertEquals(listOf("u1", "u1", "u1"), f.attempts)
        assertEquals(listOf("u1"), f.registered)
        assertEquals(0, f.gaveUp.size)
    }

    @Test fun itGivesUpAfterTheLastDelayAndReportsOnce() = runTest {
        val f = Fake(failures = 99)
        f.sync.run(flowOf(user("u1")))
        assertEquals(3, f.attempts.size)
        assertEquals(emptyList<String>(), f.registered)
        assertEquals(1, f.gaveUp.size)
    }

    @Test fun theNextLaunchTriesAgainAfterGivingUp() = runTest {
        val f = Fake(failures = 3)
        f.sync.run(flowOf(user("u1")))
        f.sync.run(flowOf(user("u1")))
        assertEquals(listOf("u1"), f.registered)
    }

    @Test fun signedOutDoesNothing() = runTest {
        val f = Fake()
        f.sync.run(flowOf(null))
        assertEquals(emptyList<String>(), f.attempts)
    }

    @Test fun aRefreshedSessionForTheSameUserDoesNotRegisterAgain() = runTest {
        val f = Fake()
        f.sync.run(flowOf(user("u1"), user("u1").copy(displayName = "Ann")))
        assertEquals(listOf("u1"), f.attempts)
    }

    @Test fun signingOutDropsPendingRetries() = runTest {
        val f = Fake(failures = 99)
        val sessions = MutableStateFlow<AuthUser?>(user("u1"))
        val job = launch { f.sync.run(sessions) }
        runCurrent()
        sessions.value = null
        advanceTimeBy(1_000)
        advanceUntilIdle()
        assertEquals(1, f.attempts.size)
        assertEquals(0, f.gaveUp.size)
        job.cancel()
    }
}

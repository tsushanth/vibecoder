package com.kreativekoala.vibecoder.ui.account

import com.kreativekoala.vibecoder.data.model.SubscriptionLimits
import com.kreativekoala.vibecoder.data.model.SubscriptionStatusResponse
import com.kreativekoala.vibecoder.data.model.User
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.AuthUser
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val auth = mockk<AuthRepository>(relaxed = true)
    private val subs = mockk<SubscriptionRepository>(relaxed = true)
    private val projects = mockk<ProjectRepository>(relaxed = true)

    @Before fun setUp() {
        Dispatchers.setMain(StandardTestDispatcher())
        every { auth.currentUser } returns AuthUser("u1", "ann@example.com", null, "http://av")
    }

    @After fun tearDown() { Dispatchers.resetMain() }

    private fun subStatus(tier: String, limits: SubscriptionLimits? = null) =
        SubscriptionStatusResponse(success = true, tier = tier, limits = limits)

    @Test fun profileFetchThrows_fallsBackToLocalSession() = runTest {
        coEvery { auth.fetchUserProfile("u1") } throws IOException("404")
        coEvery { projects.countMyProjects("u1") } returns 4
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("free")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        val s = vm.uiState.value
        assertEquals("u1", s.user!!.userId)
        assertEquals("ann@example.com", s.user!!.email)
        assertEquals("ann", s.user!!.displayName) // email prefix when no display name
        assertEquals("http://av", s.user!!.avatarUrl)
        assertFalse(s.isLoading)
    }

    @Test fun localDisplayNameWinsOverEmailPrefix() = runTest {
        every { auth.currentUser } returns AuthUser("u1", "ann@example.com", "Ann Lee", null)
        coEvery { auth.fetchUserProfile("u1") } throws IOException()
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals("Ann Lee", vm.uiState.value.user!!.displayName)
    }

    @Test fun fetchedProfileIsUsedWhenAvailable() = runTest {
        coEvery { auth.fetchUserProfile("u1") } returns User(userId = "u1", displayName = "Server Name")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals("Server Name", vm.uiState.value.user!!.displayName)
    }

    @Test fun projectCount_comes_from_countMyProjects() = runTest {
        coEvery { auth.fetchUserProfile("u1") } returns User(userId = "u1", totalProjects = 0)
        coEvery { projects.countMyProjects("u1") } returns 230
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals(230, vm.uiState.value.user!!.totalProjects)
        coVerify(exactly = 1) { projects.countMyProjects("u1") }
    }

    @Test fun countFailure_keepsUserAndStillLoadsSubscription() = runTest {
        coEvery { auth.fetchUserProfile("u1") } returns User(userId = "u1", totalProjects = 3)
        coEvery { projects.countMyProjects("u1") } throws IOException()
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("pro")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals(3, vm.uiState.value.user!!.totalProjects)
        assertEquals("pro", vm.uiState.value.subscriptionStatus!!.tier)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test fun signedOut_doesNothing() = runTest {
        every { auth.currentUser } returns null
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertNull(vm.uiState.value.user)
        coVerify(exactly = 0) { projects.countMyProjects(any()) }
    }

    // ---- "N/limit" text ----

    private fun state(tier: String?, limits: SubscriptionLimits?, used: Int = 2, userTier: String = "free") =
        AccountUiState(
            user = User(userId = "u", dailyGenerationCount = used, subscriptionTier = userTier),
            subscriptionStatus = tier?.let { subStatus(it, limits) }
        )

    @Test fun freeTier_showsLimit() {
        assertEquals("2/5", todaysGenerationsText(state("free", SubscriptionLimits(dailyGenerations = 5))))
    }

    @Test fun freeTier_missingLimit_defaultsTo3() {
        assertEquals("2/3", todaysGenerationsText(state("free", null)))
        assertEquals("2/3", todaysGenerationsText(state(null, null)))
    }

    @Test fun proTier_infinityLimitNull_showsNoSlashLimit() {
        val text = todaysGenerationsText(state("pro", SubscriptionLimits(dailyGenerations = null)))
        assertEquals("2", text)
        assertFalse(text.contains("/"))
    }

    @Test fun teamTier_and_unlimitedFlag_showNoLimit() {
        assertEquals("2", todaysGenerationsText(state("team", null)))
        assertEquals("2", todaysGenerationsText(state("free", SubscriptionLimits(unlimited = true))))
    }

    @Test fun proFromUserRecord_whenNoSubscriptionStatus() {
        assertEquals("2", todaysGenerationsText(state(null, null, userTier = "pro")))
    }
}

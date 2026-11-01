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

    @Test fun profileComesFromTheLocalSession() = runTest {
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
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals("Ann Lee", vm.uiState.value.user!!.displayName)
    }

    @Test fun projectCount_comes_from_countMyProjects() = runTest {
        coEvery { projects.countMyProjects("u1") } returns 230
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals(230, vm.uiState.value.user!!.totalProjects)
        coVerify(exactly = 1) { projects.countMyProjects("u1") }
    }

    @Test fun countFailure_keepsUserAndStillLoadsSubscription() = runTest {
        coEvery { projects.countMyProjects("u1") } throws IOException()
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("pro")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals("u1", vm.uiState.value.user!!.userId)
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

    // ---- refreshSubscription ----

    @Test fun refresh_replacesTheStatusWithTheServersView() = runTest {
        coEvery { subs.getSubscriptionStatus("u1") } returnsMany listOf(subStatus("free"), subStatus("pro"))
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        assertEquals("free", vm.uiState.value.subscriptionStatus!!.tier)
        vm.refreshSubscription()
        advanceUntilIdle()
        assertEquals("pro", vm.uiState.value.subscriptionStatus!!.tier)
    }

    @Test fun refresh_whenPaidIsExpected_waitsForTheWebhookToLand() = runTest {
        coEvery { subs.getSubscriptionStatus("u1") } returnsMany
            listOf(subStatus("free"), subStatus("free"), subStatus("free"), subStatus("pro"))
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle() // initial load: free
        vm.refreshSubscription(expectPaid = true)
        advanceUntilIdle()
        assertEquals("pro", vm.uiState.value.subscriptionStatus!!.tier)
        coVerify(exactly = 4) { subs.getSubscriptionStatus("u1") }
    }

    @Test fun refresh_whenPaidIsExpected_givesUpAfterFiveChecks() = runTest {
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("free")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        vm.refreshSubscription(expectPaid = true)
        advanceUntilIdle()
        coVerify(exactly = 6) { subs.getSubscriptionStatus("u1") } // 1 initial + 5
        assertEquals("free", vm.uiState.value.subscriptionStatus!!.tier)
    }

    @Test fun refresh_withoutExpectedPurchase_checksOnce() = runTest {
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("free")
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        vm.refreshSubscription()
        advanceUntilIdle()
        coVerify(exactly = 2) { subs.getSubscriptionStatus("u1") }
    }

    @Test fun refresh_networkFailure_keepsTheLastStatus() = runTest {
        coEvery { subs.getSubscriptionStatus("u1") } returns subStatus("pro") andThenThrows IOException()
        val vm = AccountViewModel(auth, subs, projects)
        advanceUntilIdle()
        vm.refreshSubscription()
        advanceUntilIdle()
        assertEquals("pro", vm.uiState.value.subscriptionStatus!!.tier)
    }

    @Test fun refresh_signedOut_doesNothing() = runTest {
        every { auth.currentUser } returns null
        val vm = AccountViewModel(auth, subs, projects)
        vm.refreshSubscription(expectPaid = true)
        advanceUntilIdle()
        coVerify(exactly = 0) { subs.getSubscriptionStatus(any()) }
    }

    // ---- "N/limit" text ----

    private fun state(tier: String?, limits: SubscriptionLimits?, used: Int = 2, userTier: String = "free") =
        AccountUiState(
            user = User(userId = "u", dailyGenerationCount = used, subscriptionTier = userTier),
            subscriptionStatus = tier?.let { subStatus(it, limits) }
        )

    @Test fun freeTier_showsLimit_fromTheServer() {
        assertEquals("2/5", todaysGenerationsText(state("free", SubscriptionLimits(dailyGenerations = 5)), allFree = false))
        assertEquals("2/10", todaysGenerationsText(state("free", SubscriptionLimits(dailyGenerations = 10)), allFree = false))
    }

    @Test fun freeTier_missingLimit_showsOnlyTheCount_neverAStaleCap() {
        assertEquals("2", todaysGenerationsText(state("free", null), allFree = false))
        assertEquals("2", todaysGenerationsText(state(null, null), allFree = false))
        assertEquals("2", todaysGenerationsText(state("free", SubscriptionLimits()), allFree = false))
    }

    @Test fun proTier_infinityLimitNull_showsNoSlashLimit() {
        val text = todaysGenerationsText(state("pro", SubscriptionLimits(dailyGenerations = null)), allFree = false)
        assertEquals("2", text)
        assertFalse(text!!.contains("/"))
    }

    @Test fun teamTier_and_unlimitedFlag_showNoLimit() {
        assertEquals("2", todaysGenerationsText(state("team", null), allFree = false))
        assertEquals("2", todaysGenerationsText(state("free", SubscriptionLimits(unlimited = true)), allFree = false))
    }

    @Test fun proFromUserRecord_whenNoSubscriptionStatus() {
        assertEquals("2", todaysGenerationsText(state(null, null, userTier = "pro"), allFree = false))
    }

    @Test fun allFree_hidesTheCounter() {
        assertTrue(com.kreativekoala.vibecoder.util.Monetization.ALL_FREE)
        assertNull(todaysGenerationsText(state("free", SubscriptionLimits(dailyGenerations = 10))))
        assertNull(todaysGenerationsText(state("free", null)))
    }
}

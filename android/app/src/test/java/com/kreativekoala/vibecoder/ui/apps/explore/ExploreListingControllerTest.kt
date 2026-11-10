package com.kreativekoala.vibecoder.ui.apps.explore

import com.kreativekoala.vibecoder.data.repository.ExploreListingApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ExploreListingControllerTest {
    private class FakeApi : ExploreListingApi {
        var current: Boolean? = false
        var saveOk = true
        var gate: CompletableDeferred<Unit>? = null
        val reads = mutableListOf<String>()
        val saves = mutableListOf<Pair<String, Boolean>>()
        override suspend fun isListed(projectId: String): Boolean? { reads += projectId; return current }
        override suspend fun setListed(projectId: String, listed: Boolean): Boolean {
            saves += projectId to listed; gate?.await(); return saveOk
        }
    }

    private fun TestScope.controller(api: FakeApi) = ExploreListingController(api, this)

    @Test fun isOffAndHiddenUntilTheSettingIsKnown() = runTest {
        val c = controller(FakeApi())
        assertFalse(c.state.value.ready)
        assertFalse(c.state.value.listed)
    }

    @Test fun readsTheCurrentSettingFromTheServer() = runTest {
        val api = FakeApi().apply { current = true }
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        assertTrue(c.state.value.ready)
        assertTrue(c.state.value.listed)
        assertEquals(listOf("p1"), api.reads)
    }

    @Test fun aKnownSettingSkipsTheRead() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.load("p1", known = false); advanceUntilIdle()
        assertTrue(c.state.value.ready)
        assertFalse(c.state.value.listed)
        assertTrue(api.reads.isEmpty())
    }

    @Test fun staysHiddenWhenTheSettingCannotBeRead() = runTest {
        val api = FakeApi().apply { current = null }
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        assertFalse(c.state.value.ready)
    }

    @Test fun turningItOnSavesAndMovesTheSwitch() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        c.setListed(true); advanceUntilIdle()
        assertEquals(listOf("p1" to true), api.saves)
        assertTrue(c.state.value.listed)
        assertFalse(c.state.value.saving)
        assertFalse(c.state.value.failed)
    }

    @Test fun aRefusedSaveLeavesTheSwitchWhereItWasAndShowsAnError() = runTest {
        val api = FakeApi().apply { saveOk = false }
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        c.setListed(true); advanceUntilIdle()
        assertFalse(c.state.value.listed)
        assertTrue(c.state.value.failed)
        assertFalse(c.state.value.saving)
    }

    @Test fun theErrorClearsOnTheNextTry() = runTest {
        val api = FakeApi().apply { saveOk = false }
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        c.setListed(true); advanceUntilIdle()
        api.saveOk = true
        c.setListed(true); advanceUntilIdle()
        assertTrue(c.state.value.listed)
        assertFalse(c.state.value.failed)
    }

    @Test fun aSecondTapWhileSavingIsIgnored() = runTest {
        val api = FakeApi().apply { gate = CompletableDeferred() }
        val c = controller(api)
        c.load("p1"); advanceUntilIdle()
        c.setListed(true); advanceUntilIdle()
        assertTrue(c.state.value.saving)
        c.setListed(false); advanceUntilIdle()
        assertEquals(1, api.saves.size)
        api.gate!!.complete(Unit); advanceUntilIdle()
        assertTrue(c.state.value.listed)
    }

    @Test fun doesNothingBeforeTheSettingIsKnown() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.setListed(true); advanceUntilIdle()
        assertTrue(api.saves.isEmpty())
    }
}

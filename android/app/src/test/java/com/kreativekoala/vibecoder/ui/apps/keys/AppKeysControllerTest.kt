package com.kreativekoala.vibecoder.ui.apps.keys

import com.kreativekoala.vibecoder.data.model.RequiredSecret
import com.kreativekoala.vibecoder.data.model.SecretInfo
import com.kreativekoala.vibecoder.data.model.SecretsPayInfo
import com.kreativekoala.vibecoder.data.model.SecretsResponse
import com.kreativekoala.vibecoder.data.repository.SecretsApi
import com.kreativekoala.vibecoder.data.repository.SecretsFailure
import com.kreativekoala.vibecoder.data.repository.SecretsResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AppKeysControllerTest {
    private class FakeApi : SecretsApi {
        var listResult: SecretsResult<SecretsResponse> = SecretsResult.Ok(SecretsResponse())
        var setResult: SecretsResult<Unit> = SecretsResult.Ok(Unit)
        var removeResult: SecretsResult<Unit> = SecretsResult.Ok(Unit)
        var setGate: CompletableDeferred<Unit>? = null
        val listCalls = mutableListOf<String>()
        val setCalls = mutableListOf<Triple<String, String, String>>()
        val removeCalls = mutableListOf<Pair<String, String>>()
        override suspend fun list(projectId: String): SecretsResult<SecretsResponse> { listCalls += projectId; return listResult }
        override suspend fun set(projectId: String, name: String, value: String): SecretsResult<Unit> {
            setCalls += Triple(projectId, name, value); setGate?.await(); return setResult
        }
        override suspend fun remove(projectId: String, name: String): SecretsResult<Unit> { removeCalls += projectId to name; return removeResult }
    }

    private fun response(required: List<Pair<String, List<String>>>, set: List<String> = emptyList(), pay: String? = null) = SecretsResponse(
        secrets = set.map { SecretInfo(it, "2026-10-07T00:00:00Z") },
        required = required.map { RequiredSecret(it.first, it.second, null) },
        pay = pay?.let { SecretsPayInfo(it) }
    )

    private fun TestScope.ready(api: FakeApi, required: List<Pair<String, List<String>>> = listOf("WEATHER_KEY" to listOf("weather"), "MAPS_KEY" to listOf("maps")), set: List<String> = emptyList()): AppKeysController {
        api.listResult = SecretsResult.Ok(response(required, set))
        val c = AppKeysController(api, this)
        c.load("proj-1"); advanceUntilIdle()
        return c
    }

    @Test fun load_mergesRequiredWithStoredAndKeepsExtrasLast() = runTest {
        val c = ready(FakeApi(), listOf("B_KEY" to listOf("b"), "A_KEY" to listOf("a")), set = listOf("A_KEY", "OLD_KEY"))
        val s = c.state.value
        assertEquals(KeysLoad.READY, s.load)
        assertEquals(listOf("B_KEY", "A_KEY", "OLD_KEY"), s.rows.map { it.name })
        assertEquals(listOf(false, true, true), s.rows.map { it.isSet })
        assertEquals(listOf("a"), s.rows[1].usedBy)
        assertEquals(1, s.missing); assertEquals(3, s.total)
    }

    @Test fun load_payInfoShowsWebhookUrl() = runTest {
        val api = FakeApi(); api.listResult = SecretsResult.Ok(response(listOf("STRIPE_SECRET_KEY" to listOf("pay")), pay = "https://p.example/app/pay/webhook"))
        val c = AppKeysController(api, this); c.load("proj-1"); advanceUntilIdle()
        assertTrue(c.state.value.hasPay); assertEquals("https://p.example/app/pay/webhook", c.state.value.payWebhookUrl)
    }

    @Test fun load_hiddenWhenAppHasNoKeyOrKeySupportIsOff() = runTest {
        val none = FakeApi(); none.listResult = SecretsResult.Ok(SecretsResponse(emptyList(), emptyList(), null))
        val a = AppKeysController(none, this); a.load("p"); advanceUntilIdle(); assertEquals(KeysLoad.HIDDEN, a.state.value.load)
        val off = FakeApi(); off.listResult = SecretsResult.Failed(SecretsFailure.Unavailable)
        val b = AppKeysController(off, this); b.load("p"); advanceUntilIdle(); assertEquals(KeysLoad.HIDDEN, b.state.value.load)
        val notMine = FakeApi(); notMine.listResult = SecretsResult.Failed(SecretsFailure.Forbidden)
        val c = AppKeysController(notMine, this); c.load("p"); advanceUntilIdle(); assertEquals(KeysLoad.HIDDEN, c.state.value.load)
    }

    @Test fun load_failureShowsErrorAndRetryReloads() = runTest {
        val api = FakeApi(); api.listResult = SecretsResult.Failed(SecretsFailure.StoreDown)
        val c = AppKeysController(api, this); c.load("p"); advanceUntilIdle()
        assertEquals(KeysLoad.ERROR, c.state.value.load); assertEquals(KeysError.STORE_DOWN, c.state.value.error)
        api.listResult = SecretsResult.Ok(response(listOf("K_KEY" to listOf("k"))))
        c.retry(); advanceUntilIdle()
        assertEquals(KeysLoad.READY, c.state.value.load); assertEquals(2, api.listCalls.size)
    }

    @Test fun load_sameProjectTwiceDoesNotRefetch() = runTest {
        val api = FakeApi(); val c = ready(api)
        c.load("proj-1"); advanceUntilIdle()
        assertEquals(1, api.listCalls.size)
    }

    @Test fun save_sendsTrimmedValueThenDropsTheDraftAndMarksSet() = runTest {
        val api = FakeApi(); val c = ready(api)
        c.onDraftChanged("WEATHER_KEY", "  sk-123\n")
        c.save("WEATHER_KEY"); advanceUntilIdle()
        assertEquals(listOf(Triple("proj-1", "WEATHER_KEY", "sk-123")), api.setCalls)
        val s = c.state.value
        assertTrue(s.rows.first { it.name == "WEATHER_KEY" }.isSet)
        assertTrue(s.drafts.isEmpty()); assertNull(s.busy); assertNull(s.replacing)
        assertEquals(KeyNote("WEATHER_KEY", KeyNoteKind.SAVED), s.note)
    }

    @Test fun save_failureKeepsTheDraftSoNothingIsRetyped() = runTest {
        val api = FakeApi(); val c = ready(api)
        api.setResult = SecretsResult.Failed(SecretsFailure.Network)
        c.onDraftChanged("MAPS_KEY", "abc"); c.save("MAPS_KEY"); advanceUntilIdle()
        val s = c.state.value
        assertEquals(KeysError.NETWORK, s.error); assertEquals("abc", s.drafts["MAPS_KEY"]); assertNull(s.busy)
        assertFalse(s.rows.first { it.name == "MAPS_KEY" }.isSet)
    }

    @Test fun save_blankOrTooLongIsRefusedWithoutACall() = runTest {
        val api = FakeApi(); val c = ready(api)
        c.onDraftChanged("MAPS_KEY", "   \n"); c.save("MAPS_KEY"); advanceUntilIdle()
        assertEquals(KeysError.INVALID_VALUE, c.state.value.error)
        c.onDraftChanged("MAPS_KEY", "x".repeat(AppKeysController.MAX_VALUE + 1)); c.save("MAPS_KEY"); advanceUntilIdle()
        assertEquals(KeysError.INVALID_VALUE, c.state.value.error)
        c.onDraftChanged("MAPS_KEY", "x".repeat(AppKeysController.MAX_VALUE)); c.save("MAPS_KEY"); advanceUntilIdle()
        assertEquals(1, api.setCalls.size)
        assertEquals(0, api.setCalls.count { it.third.isBlank() })
    }

    @Test fun save_whileAnotherSaveIsRunningIsIgnored() = runTest {
        val api = FakeApi(); val c = ready(api); api.setGate = CompletableDeferred()
        c.onDraftChanged("WEATHER_KEY", "one"); c.onDraftChanged("MAPS_KEY", "two")
        c.save("WEATHER_KEY"); advanceUntilIdle()
        assertEquals("WEATHER_KEY", c.state.value.busy)
        c.save("MAPS_KEY"); c.save("WEATHER_KEY"); advanceUntilIdle()
        assertEquals(1, api.setCalls.size)
        api.setGate!!.complete(Unit); advanceUntilIdle()
        assertNull(c.state.value.busy)
    }

    @Test fun save_aKeyTheAppDoesNotListIsIgnored() = runTest {
        val api = FakeApi(); val c = ready(api)
        c.onDraftChanged("OTHER_KEY", "v"); c.save("OTHER_KEY"); advanceUntilIdle()
        assertTrue(api.setCalls.isEmpty())
    }

    @Test fun remove_needsAConfirmationFirst() = runTest {
        val api = FakeApi(); val c = ready(api, set = listOf("WEATHER_KEY"))
        c.confirmRemove("WEATHER_KEY"); advanceUntilIdle()
        assertTrue(api.removeCalls.isEmpty())
        c.askRemove("WEATHER_KEY"); c.cancelRemove(); c.confirmRemove("WEATHER_KEY"); advanceUntilIdle()
        assertTrue(api.removeCalls.isEmpty())
        c.askRemove("WEATHER_KEY"); c.confirmRemove("WEATHER_KEY"); advanceUntilIdle()
        assertEquals(listOf("proj-1" to "WEATHER_KEY"), api.removeCalls)
        val s = c.state.value
        assertFalse(s.rows.first { it.name == "WEATHER_KEY" }.isSet); assertNull(s.confirmingRemove)
        assertEquals(KeyNote("WEATHER_KEY", KeyNoteKind.REMOVED), s.note)
    }

    @Test fun confirming_aDifferentKeyThanTheOneAskedIsIgnored() = runTest {
        val api = FakeApi(); val c = ready(api, set = listOf("WEATHER_KEY", "MAPS_KEY"))
        c.askRemove("WEATHER_KEY"); c.confirmRemove("MAPS_KEY"); advanceUntilIdle()
        assertTrue(api.removeCalls.isEmpty())
    }

    @Test fun remove_failureKeepsTheKeySetAndReportsTheError() = runTest {
        val api = FakeApi(); val c = ready(api, set = listOf("WEATHER_KEY"))
        api.removeResult = SecretsResult.Failed(SecretsFailure.Unauthorized)
        c.askRemove("WEATHER_KEY"); c.confirmRemove("WEATHER_KEY"); advanceUntilIdle()
        assertTrue(c.state.value.rows.first { it.name == "WEATHER_KEY" }.isSet)
        assertEquals(KeysError.UNAUTHORIZED, c.state.value.error); assertNull(c.state.value.busy)
    }

    @Test fun cancelEdit_dropsTheDraft_andClearDraftsDropsAll() = runTest {
        val c = ready(FakeApi(), set = listOf("WEATHER_KEY"))
        c.startReplace("WEATHER_KEY"); c.onDraftChanged("WEATHER_KEY", "secret-a"); c.onDraftChanged("MAPS_KEY", "secret-b")
        c.cancelEdit("WEATHER_KEY")
        assertNull(c.state.value.replacing); assertNull(c.state.value.drafts["WEATHER_KEY"]); assertEquals("secret-b", c.state.value.drafts["MAPS_KEY"])
        c.clearDrafts(); assertTrue(c.state.value.drafts.isEmpty())
    }

    @Test fun aTypedValueNeverShowsUpWhenTheStateIsPrinted() = runTest {
        val c = ready(FakeApi())
        c.onDraftChanged("WEATHER_KEY", "super-secret-value")
        assertFalse(c.state.value.toString().contains("super-secret-value"))
    }
}

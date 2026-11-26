package com.kreativekoala.vibecoder.service

import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.AppVisits
import com.kreativekoala.vibecoder.data.model.OwnerLink
import com.kreativekoala.vibecoder.data.model.PushTokenRequest
import com.kreativekoala.vibecoder.data.model.VisitsResponse
import com.kreativekoala.vibecoder.ui.create.NotificationPromptPolicy
import com.kreativekoala.vibecoder.util.PushOpen
import com.kreativekoala.vibecoder.util.PushTap
import com.kreativekoala.vibecoder.util.VisitDates
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.Locale

@OptIn(ExperimentalCoroutinesApi::class)
class PushReachTest {

    @Test fun aFailedTokenUploadIsTriedAgain() = runTest {
        var failures = 2
        val sent = mutableListOf<String>()
        val uploader = PushTokenUploader({ user, token -> sent += "$user $token"; if (failures-- > 0) throw IOException("offline") }, listOf(10L, 10L))
        assertTrue(uploader.upload("u1", "t"))
        assertEquals(listOf("u1 t", "u1 t", "u1 t"), sent)
    }

    @Test fun theUploadGivesUpAfterTheLastRetry() = runTest {
        var attempts = 0
        val uploader = PushTokenUploader({ _, _ -> attempts++; throw IOException("offline") }, listOf(10L, 10L))
        assertFalse(uploader.upload("u1", "t"))
        assertEquals(3, attempts)
    }

    @Test fun cancellingDropsPendingRetries() = runTest {
        var attempts = 0
        val uploader = PushTokenUploader({ _, _ -> attempts++; throw IOException("offline") }, listOf(1_000L))
        val job = launch { uploader.upload("u1", "t") }
        runCurrent()
        job.cancel()
        advanceUntilIdle()
        assertEquals(1, attempts)
    }

    @Test fun thePermissionIsAskedOnceOnAndroid13AndLater() {
        assertTrue(NotificationPromptPolicy.shouldAutoAsk(33, granted = false, askedBefore = false))
        assertFalse(NotificationPromptPolicy.shouldAutoAsk(33, granted = false, askedBefore = true))
        assertFalse(NotificationPromptPolicy.shouldAutoAsk(33, granted = true, askedBefore = false))
        assertFalse(NotificationPromptPolicy.shouldAutoAsk(32, granted = false, askedBefore = false))
        assertTrue(NotificationPromptPolicy.mustUseSettings(askedBefore = true, canExplain = false))
        assertFalse(NotificationPromptPolicy.mustUseSettings(askedBefore = true, canExplain = true))
        assertFalse(NotificationPromptPolicy.mustUseSettings(askedBefore = false, canExplain = false))
    }

    @Test fun theTokenRequestSaysWhetherNoticesCanShow() {
        assertEquals(
            """{"userId":"u","token":"t","platform":"android","notificationsEnabled":false}""",
            Gson().toJson(PushTokenRequest(userId = "u", token = "t", notificationsEnabled = false))
        )
    }

    @Test fun onlyOurNoticeExtrasOpenAnApp() {
        val id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assertEquals(PushTap(id, "build_ready"), PushOpen.parse(id, "build_ready"))
        assertEquals(PushTap(null, "build_failed"), PushOpen.parse(null, "build_failed"))
        assertEquals(PushTap(null, "build_ready"), PushOpen.parse("../account", "build_ready"))
        assertNull(PushOpen.parse(id, null))
        assertNull(PushOpen.parse(id, "something"))
    }

    @Test fun aTapIsHandledOnce() {
        PushOpen.offer(PushTap(null, "other"))
        PushOpen.offer(null)
        assertEquals(PushTap(null, "other"), PushOpen.take())
        assertNull(PushOpen.take())
    }

    private val body = """{"countingSince":"2026-11-26","apps":[
        {"projectId":"p1","url":"https://a.vibebuild.cc","openUrl":"https://a.vibebuild.cc?vb_own=1.x","today":0,"last7Days":3,"total":9},
        {"projectId":"p2","url":"https://b.vibebuild.cc","openUrl":"https://b.vibebuild.cc?vb_own=1.y"}]}"""

    @Test fun visitCountsAreReadAndIncompleteOnesLeftOut() {
        val visits = Gson().fromJson(body, VisitsResponse::class.java).byProject()
        assertEquals(setOf("p1"), visits.keys)
        assertEquals(3, visits.getValue("p1").last7Days)
        assertTrue(Gson().fromJson("{}", VisitsResponse::class.java).byProject().isEmpty())
    }

    @Test fun theSignedLinkIsUsedOnlyForItsOwnSite() {
        val mine = AppVisits("p1", "https://a.vibebuild.cc", "https://a.vibebuild.cc?vb_own=1.x", 0, 0, 0)
        assertEquals("https://a.vibebuild.cc?vb_own=1.x", OwnerLink.forUrl("https://a.vibebuild.cc", mine))
        assertEquals("https://b.vibebuild.cc", OwnerLink.forUrl("https://b.vibebuild.cc", mine))
        assertEquals("https://a.vibebuild.cc", OwnerLink.forUrl("https://a.vibebuild.cc", null))
    }

    @Test fun theCountingDateIsShownInTheReadersFormat() {
        assertEquals("Nov 26, 2026", VisitDates.display("2026-11-26", Locale.US))
        assertNull(VisitDates.display("soon"))
        assertNull(VisitDates.display(null))
    }
}

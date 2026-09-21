package com.kreativekoala.vibecoder.data.model

import com.kreativekoala.vibecoder.di.AppModule
import org.junit.Assert.*
import org.junit.Test

/** Parses realistic backend JSON with the app's real Gson (AppModule.provideGson()). */
class ModelParsingTest {
    private val gson = AppModule.provideGson()

    @Test fun progress_full_payload() {
        val json = """{"success":true,"status":"building","phase":"Validate","detail":"Checking files",
            "percent":42.5,"startedAt":"2026-09-20T10:00:00Z",
            "events":[{"ts":"t1","phase":"Generate","message":"Writing code"},{"ts":"t2","phase":"Validate","message":"Linting"}]}"""
        val p = gson.fromJson(json, ProjectProgress::class.java)
        assertEquals("building", p.status)
        assertEquals("Validate", p.phase)
        assertEquals(42.5, p.percent, 0.0)
        assertEquals(2, p.events!!.size)
        assertEquals("Linting", p.events!![1].message)
        assertNull(p.error)
    }

    @Test fun progress_partial_uses_defaults() {
        val p = gson.fromJson("""{"status":"ready"}""", ProjectProgress::class.java)
        assertEquals("ready", p.status)
        assertEquals("", p.phase)
        assertEquals(0.0, p.percent, 0.0)
        assertNull(p.events)
    }

    @Test fun progress_empty_object_defaults_to_building() {
        val p = gson.fromJson("{}", ProjectProgress::class.java)
        assertEquals("building", p.status)
        assertTrue(p.success)
    }

    @Test fun progress_null_percent_and_null_events() {
        val p = gson.fromJson("""{"status":"building","percent":null,"events":null,"detail":null}""", ProjectProgress::class.java)
        assertEquals(0.0, p.percent, 0.0)
        assertNull(p.events)
    }

    @Test fun progress_failed_carries_error() {
        val p = gson.fromJson("""{"status":"failed","error":"Out of credits"}""", ProjectProgress::class.java)
        assertEquals("failed", p.status)
        assertEquals("Out of credits", p.error)
    }

    @Test fun progress_event_with_missing_fields() {
        val p = gson.fromJson("""{"events":[{},{"message":"hi"}]}""", ProjectProgress::class.java)
        assertNull(p.events!![0].message)
        assertEquals("hi", p.events!![1].message)
    }

    @Test fun plan_full() {
        val r = gson.fromJson(
            """{"success":true,"plan":{"summary":"A todo app","features":["Add","Delete"],"style":"Dark"}}""",
            PlanResponse::class.java
        )
        assertTrue(r.success)
        assertEquals("A todo app", r.plan!!.summary)
        assertEquals(listOf("Add", "Delete"), r.plan!!.features)
        assertEquals("Dark", r.plan!!.style)
    }

    @Test fun plan_missing_fields_and_missing_plan() {
        val a = gson.fromJson("""{"success":true,"plan":{"summary":"x"}}""", PlanResponse::class.java)
        assertNull(a.plan!!.features)
        assertEquals("", a.plan!!.style)
        val b = gson.fromJson("""{"success":false}""", PlanResponse::class.java)
        assertFalse(b.success)
        assertNull(b.plan)
    }

    @Test fun subscriptionLimits_infinity_serialised_as_null() {
        // Node JSON.stringify(Infinity) === null
        val s = gson.fromJson(
            """{"success":true,"tier":"pro","limits":{"daily_generations":null,"tweaks_per_project":null,"unlimited":true}}""",
            SubscriptionStatusResponse::class.java
        )
        assertEquals("pro", s.tier)
        assertNull(s.limits!!.dailyGenerations)
        assertNull(s.limits!!.tweaksPerProject)
        assertTrue(s.limits!!.unlimited)
    }

    @Test fun subscriptionLimits_free_numeric() {
        val s = gson.fromJson(
            """{"success":true,"tier":"free","limits":{"daily_generations":3,"tweaks_per_project":3}}""",
            SubscriptionStatusResponse::class.java
        )
        assertEquals(3, s.limits!!.dailyGenerations)
        assertFalse(s.limits!!.unlimited)
    }

    @Test fun subscriptionStatus_without_limits() {
        val s = gson.fromJson("""{"success":true,"tier":"free"}""", SubscriptionStatusResponse::class.java)
        assertEquals("free", s.tier)
        assertNull(s.limits)
    }

    @Test fun myProjects_paging_fields() {
        val r = gson.fromJson(
            """{"success":true,"totalCount":230,"hasMore":true,"projects":[{"id":"a","title":"A","creator_id":"u","play_count":5,"preview_url":"https://p"}]}""",
            MyProjectsResponse::class.java
        )
        assertEquals(230, r.totalCount)
        assertTrue(r.hasMore)
        assertEquals("u", r.projects[0].creatorId)
        assertEquals(5, r.projects[0].playCount)
        assertEquals("https://p", r.projects[0].previewUrl)
    }

    @Test fun myProjects_missing_paging_fields_default() {
        val r = gson.fromJson("""{"success":true,"projects":[]}""", MyProjectsResponse::class.java)
        assertEquals(0, r.totalCount)
        assertFalse(r.hasMore)
    }

    @Test fun user_snake_case_mapping() {
        val u = gson.fromJson("""{"user_id":"u1","display_name":"Ann","total_projects":7,"subscription_tier":"pro"}""", User::class.java)
        assertEquals("u1", u.userId)
        assertEquals("Ann", u.displayName)
        assertEquals(7, u.totalProjects)
        assertEquals("pro", u.subscriptionTier)
    }

    @Test fun sseStatus_resolves_alternate_keys() {
        val s = gson.fromJson("""{"phase":"Fix","progressPercent":55.0}""", SseEvent.Status::class.java)
        assertEquals(55.0, s.resolvedProgress(), 0.0)
        val t = gson.fromJson("""{"phase":"Fix","progress_percent":30.0}""", SseEvent.Status::class.java)
        assertEquals(30.0, t.resolvedProgress(), 0.0)
    }

    @Test fun subscriptionTier_fromString_unknown_is_free() {
        assertEquals(SubscriptionTier.PRO, SubscriptionTier.fromString("pro"))
        assertEquals(SubscriptionTier.FREE, SubscriptionTier.fromString("weird"))
    }
}

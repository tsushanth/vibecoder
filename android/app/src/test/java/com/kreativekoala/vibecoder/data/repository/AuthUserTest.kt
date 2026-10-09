package com.kreativekoala.vibecoder.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthUserTest {
    @Test fun localUserCarriesTheSessionFields() {
        val u = AuthUser("u1", "ann@example.com", "Ann Lee", "http://av").toLocalUser()
        assertEquals("u1", u.userId)
        assertEquals("ann@example.com", u.email)
        assertEquals("Ann Lee", u.displayName)
        assertEquals("http://av", u.avatarUrl)
    }

    @Test fun displayNameFallsBackToTheEmailPrefix() {
        assertEquals("ann", AuthUser("u1", "ann@example.com", null, null).toLocalUser().displayName)
    }

    @Test fun noNameAndNoEmailLeavesTheNameEmpty() {
        assertNull(AuthUser("u1", null, null, null).toLocalUser().displayName)
    }
}

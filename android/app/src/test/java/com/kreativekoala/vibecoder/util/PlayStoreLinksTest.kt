package com.kreativekoala.vibecoder.util

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayStoreLinksTest {
    @Test fun market_url_points_at_the_app_listing() {
        assertEquals("market://details?id=com.kreativekoala.vibecoder", PlayStoreLinks.marketUrl("com.kreativekoala.vibecoder"))
    }

    @Test fun web_url_is_the_https_fallback_for_the_same_package() {
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder",
            PlayStoreLinks.webUrl("com.kreativekoala.vibecoder")
        )
    }
}

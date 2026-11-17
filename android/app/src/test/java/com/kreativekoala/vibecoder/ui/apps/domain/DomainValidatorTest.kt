package com.kreativekoala.vibecoder.ui.apps.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DomainValidatorTest {
    @Test fun validDomainsPass() {
        assertNull(DomainValidator.error("www.example.com"))
        assertNull(DomainValidator.error("https://Shop.Example.co.uk/path?x=1"))
    }

    @Test fun eachRejectionHasItsOwnKindSoTheScreenCanTranslateIt() {
        assertEquals(DomainInvalid.EMPTY, DomainValidator.error("   "))
        assertEquals(DomainInvalid.TOO_LONG, DomainValidator.error("a".repeat(250) + ".com"))
        assertEquals(DomainInvalid.NO_EXTENSION, DomainValidator.error("localhost"))
        assertEquals(DomainInvalid.BAD_CHARACTERS, DomainValidator.error("my_app.example.com"))
        assertEquals(DomainInvalid.NOT_A_DOMAIN, DomainValidator.error("example.1"))
        assertEquals(DomainInvalid.OWN_ADDRESS, DomainValidator.error("my.vibebuild.cc"))
    }

    @Test fun everyKindHasAStringResource() {
        for (k in DomainInvalid.values()) invalidDomainRes(k) // exhaustive when: fails to compile if a kind is added without a string
    }
}

package com.kreativekoala.vibecoder.ui.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Account > About must show the real version, so no language may carry a typed-in version number. */
class VersionStringTest {
    private val resDir = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }

    private fun versionLines(): Map<String, String> =
        resDir.listFiles { f -> f.isDirectory && f.name.startsWith("values") }!!
            .mapNotNull { dir -> File(dir, "strings.xml").takeIf { it.exists() } }
            .associate { f ->
                f.parentFile.name to f.readLines().first { it.contains("name=\"account_settings_version\"") }
            }

    @Test fun everyLanguageTakesTheVersionAsAnArgument() {
        val lines = versionLines()
        assertTrue("expected many locales, got ${lines.keys}", lines.size >= 20)
        for ((locale, line) in lines) {
            assertTrue("$locale: $line", line.contains("%1\$s"))
            assertFalse("$locale hard-codes a version: $line", line.contains("1.0.0"))
        }
    }

    @Test fun formattedWithTheBuildVersion() {
        val template = Regex(">(.*)</string>").find(versionLines().getValue("values").replace("\\'", "'"))!!.groupValues[1]
        assertEquals("Version 2.5.4", String.format(template, "2.5.4"))
    }
}

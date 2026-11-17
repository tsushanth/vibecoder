package com.kreativekoala.vibecoder

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Every shipped language has a translated title and prompt for every bundled template. */
class TemplateTranslationsTest {
    private val assets: File = listOf("src/main/assets", "android/app/src/main/assets").map { File(it) }.first { it.isDirectory }
    private val gson = Gson()
    private val shipped = listOf("ar", "cs", "de", "el", "es", "fi", "fr", "hi", "hu", "id", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tl", "tr", "uk", "vi", "zh")

    private data class Text(val title: String? = null, val description: String? = null)

    private val ids: Set<String> by lazy {
        @Suppress("UNCHECKED_CAST")
        val root = gson.fromJson(File(assets, "templates/catalog.json").readText(), Map::class.java) as Map<String, Any>
        (root["projects"] as List<Map<String, Any>>).map { it["id"] as String }.toSet()
    }

    @Test fun everyLanguageTranslatesEveryTemplate() {
        val type = object : TypeToken<Map<String, Text>>() {}.type
        val problems = ArrayList<String>()
        for (tag in shipped) {
            val f = File(assets, "templates/i18n/$tag.json")
            if (!f.isFile) { problems += "$tag: file missing"; continue }
            val m: Map<String, Text> = gson.fromJson(f.readText(), type)
            if (m.keys != ids) problems += "$tag: ids differ (missing ${ids - m.keys}, extra ${m.keys - ids})"
            m.forEach { (id, t) -> if (t.title.isNullOrBlank() || t.description.isNullOrBlank()) problems += "$tag:$id empty" }
        }
        assertTrue(problems.joinToString("\n"), problems.isEmpty())
    }

    @Test fun thereAreNoStrayLanguageFiles() {
        val files = File(assets, "templates/i18n").listFiles().orEmpty().map { it.name.removeSuffix(".json") }.sorted()
        assertEquals(shipped.sorted(), files)
    }
}

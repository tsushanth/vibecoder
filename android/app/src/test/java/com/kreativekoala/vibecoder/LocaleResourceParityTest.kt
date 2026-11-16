package com.kreativekoala.vibecoder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Guards localization: every shipped language has every translatable string, plural and array of the default (English)
 * resources, no stray keys, the same format specifiers (%d, %1$s, %%...) per string, and the per-app language list
 * (res/xml/locales_config.xml) names exactly the shipped languages.
 */
class LocaleResourceParityTest {
    private val resDir: File = listOf("src/main/res", "android/app/src/main/res").map { File(it) }.first { it.isDirectory }

    private class Entry(val kind: String, val items: List<String>)

    private fun parse(file: File): Map<String, Entry> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val out = LinkedHashMap<String, Entry>()
        val nodes = doc.documentElement.childNodes
        for (i in 0 until nodes.length) {
            val n = nodes.item(i)
            if (n !is org.w3c.dom.Element) continue
            val name = n.getAttribute("name")
            if (name.isEmpty() || n.getAttribute("translatable") == "false") continue
            when (n.tagName) {
                "string" -> out[name] = Entry("string", listOf(n.textContent))
                "plurals", "string-array" -> {
                    val items = n.getElementsByTagName("item")
                    out[name] = Entry(n.tagName, (0 until items.length).map { items.item(it).textContent })
                }
            }
        }
        return out
    }

    private fun parseDir(dir: File): Map<String, Entry> {
        val all = LinkedHashMap<String, Entry>()
        dir.listFiles { f -> f.name.endsWith(".xml") }.orEmpty().sortedBy { it.name }
            .filter { it.name !in setOf("colors.xml", "themes.xml", "styles.xml", "dimens.xml") }
            .forEach { all.putAll(parse(it)) }
        return all
    }

    private val ignoredKeys = setOf("default_web_client_id", "app_id", "gcm_defaultSenderId", "google_api_key", "google_app_id",
        "firebase_database_url", "google_storage_bucket", "project_id", "google_crash_reporting_api_key")

    private val spec = Regex("""%(?:\d+\$)?[-#+0,(]*\d*(?:\.\d+)?[sdfxXeEgGcb]|%%""")
    private fun specs(s: String) = spec.findAll(s).map { it.value.replace(Regex("""^%\d+\$"""), "%") }.sorted().toList()

    private val defaults by lazy { parseDir(File(resDir, "values")).filterKeys { it !in ignoredKeys } }
    private val localeDirs by lazy {
        resDir.listFiles { f -> f.isDirectory && f.name.startsWith("values-") && f.listFiles { x -> x.name.endsWith(".xml") }.orEmpty().isNotEmpty() }
            .orEmpty().filter { Regex("""values-[a-z]{2,3}(-r[A-Z]{2})?""").matches(it.name) }.sortedBy { it.name }
    }

    @Test fun everyLanguageHasEveryString() {
        val problems = ArrayList<String>()
        for (d in localeDirs) {
            val loc = parseDir(d)
            val missing = defaults.keys.filter { it !in loc }
            if (missing.isNotEmpty()) problems += "${d.name}: missing ${missing.size}: ${missing.take(8)}"
            val extra = loc.keys.filter { it !in defaults && it !in ignoredKeys }
            if (extra.isNotEmpty()) problems += "${d.name}: not in default: ${extra.take(8)}"
        }
        assertTrue(problems.joinToString("\n"), problems.isEmpty())
    }

    @Test fun formatSpecifiersMatchTheDefault() {
        val problems = ArrayList<String>()
        for (d in localeDirs) {
            val loc = parseDir(d)
            for ((k, def) in defaults) {
                val tr = loc[k] ?: continue
                if (def.kind == "array" || def.kind == "string-array") continue
                if (def.kind == "string") {
                    if (specs(def.items[0]) != specs(tr.items[0])) problems += "${d.name}:$k ${specs(def.items[0])} vs ${specs(tr.items[0])}"
                } else {
                    val base = specs(def.items.last())
                    // every translated plural form keeps the number placeholder unless it is a "one"/"zero"/"two" form written with a word
                    tr.items.forEach { if (specs(it) != base && specs(it).isNotEmpty()) problems += "${d.name}:$k plural form ${specs(it)} vs $base" }
                }
            }
        }
        assertTrue(problems.joinToString("\n"), problems.isEmpty())
    }

    @Test fun localeConfigListsExactlyTheShippedLanguages() {
        val cfg = File(resDir, "xml/locales_config.xml")
        if (!cfg.exists()) return
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(cfg)
        val listed = (0 until doc.getElementsByTagName("locale").length).map {
            doc.getElementsByTagName("locale").item(it).attributes.getNamedItem("android:name").nodeValue.lowercase()
        }.toSet()
        fun tag(dir: String): String = when (val q = dir.removePrefix("values-")) {
            "in" -> "id"; "zh-rCN" -> "zh-hans"; "zh-rTW" -> "zh-hant"; else -> q.replace("-r", "-").lowercase()
        }
        val shipped = localeDirs.map { tag(it.name) }.toSet() + "en"
        assertEquals("locales_config.xml vs shipped values-* folders", shipped.sorted(), listed.map { if (it == "zh-cn") "zh-hans" else it }.toSet().sorted())
    }
}

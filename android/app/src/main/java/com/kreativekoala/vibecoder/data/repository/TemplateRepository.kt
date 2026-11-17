package com.kreativekoala.vibecoder.data.repository

import android.content.Context
import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.Template
import com.kreativekoala.vibecoder.data.model.TemplateCatalog
import com.kreativekoala.vibecoder.util.AppLanguage
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Loads the bundled template catalog from assets. The same 30 curated
 * projects iOS ships as runnable lessons live here as inspiration cards
 * for the Create screen — tapping one fills the user's prompt with the
 * project description and lets Claude generate their own variant.
 */
@Singleton
class TemplateRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val gson: Gson,
) {
    private val english: List<Template> by lazy { load() }
    private val byLanguage = HashMap<String, List<Template>>()

    /** The catalog in the app language: titles and prompts come from assets/templates/i18n/<tag>.json when there is one. */
    @Synchronized
    fun all(): List<Template> {
        val lang = AppLanguage.current()
        if (lang == "en") return english
        return byLanguage.getOrPut(lang) { localized(english, lang) }
    }

    fun byCategory(category: String): List<Template> =
        all().filter { it.category.equals(category, ignoreCase = true) }

    fun categories(): List<String> = all().map { it.category }.distinct().sorted()

    private fun load(): List<Template> = try {
        context.assets.open("templates/catalog.json").bufferedReader().use {
            gson.fromJson(it, TemplateCatalog::class.java).projects
        }
    } catch (_: Exception) {
        emptyList()
    }

    /** Falls back to the English template when the language file or an entry is missing. */
    private fun localized(base: List<Template>, lang: String): List<Template> = try {
        val type = object : com.google.gson.reflect.TypeToken<Map<String, TemplateText>>() {}.type
        val texts: Map<String, TemplateText> = context.assets.open("templates/i18n/$lang.json").bufferedReader().use { gson.fromJson(it, type) }
        base.map { t ->
            val x = texts[t.id]
            if (x == null || x.title.isNullOrBlank() || x.description.isNullOrBlank()) t else t.copy(title = x.title, description = x.description)
        }
    } catch (_: Exception) {
        base
    }

    private data class TemplateText(val title: String? = null, val description: String? = null)
}

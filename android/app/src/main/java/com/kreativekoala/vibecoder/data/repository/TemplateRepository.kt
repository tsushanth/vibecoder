package com.kreativekoala.vibecoder.data.repository

import android.content.Context
import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.Template
import com.kreativekoala.vibecoder.data.model.TemplateCatalog
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
    private val cache: List<Template> by lazy { load() }

    fun all(): List<Template> = cache

    fun byCategory(category: String): List<Template> =
        cache.filter { it.category.equals(category, ignoreCase = true) }

    fun categories(): List<String> = cache.map { it.category }.distinct().sorted()

    private fun load(): List<Template> = try {
        context.assets.open("templates/catalog.json").bufferedReader().use {
            gson.fromJson(it, TemplateCatalog::class.java).projects
        }
    } catch (_: Exception) {
        emptyList()
    }
}

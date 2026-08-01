package com.kreativekoala.vibecoder.data.model

/**
 * Curated "starter idea" the user can tap to seed the Create screen's
 * prompt. Sourced from `assets/templates/catalog.json`, which is the same
 * catalog the iOS app ships as runnable lessons (here we only use the
 * metadata as inspiration — the Android app then asks Claude to generate
 * the user's own version rather than running the bundled HTML directly).
 */
data class Template(
    val id: String,
    val slug: String,
    val title: String,
    val creator: String,
    val difficulty: String,
    val category: String,
    val learn: List<String> = emptyList(),
    val fileCount: Int = 0,
    val description: String,
    val githubRepo: String? = null,
    val thumbnailUrl: String? = null,
)

data class TemplateCatalog(
    val version: Int,
    val projects: List<Template>,
)

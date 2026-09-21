package com.kreativekoala.vibecoder.ui.browse

import com.kreativekoala.vibecoder.data.model.Project
import org.junit.Assert.assertEquals
import org.junit.Test

class ProjectCategoryTest {

    private fun p(title: String = "", desc: String? = null, prompt: String? = null) =
        Project(id = "1", title = title, description = desc, initialPrompt = prompt)

    @Test fun games_english() {
        assertEquals(ProjectCategory.GAMES, classify(p("Snake Game")))
        assertEquals(ProjectCategory.GAMES, classify(p("Trivia Quiz")))
        assertEquals(ProjectCategory.GAMES, classify(p("2048 clone")))
        assertEquals(ProjectCategory.GAMES, classify(p("x", prompt = "a tic-tac-toe board")))
    }

    @Test fun games_nonEnglish() {
        assertEquals(ProjectCategory.GAMES, classify(p("Jeu de mémoire")))
        assertEquals(ProjectCategory.GAMES, classify(p("Un juego de cartas")))
        assertEquals(ProjectCategory.GAMES, classify(p("Gioco del tris")))
        assertEquals(ProjectCategory.GAMES, classify(p("Jogo da velha")))
        assertEquals(ProjectCategory.GAMES, classify(p("Casse-tête")))
    }

    @Test fun trackers_english_and_nonEnglish() {
        assertEquals(ProjectCategory.TRACKERS, classify(p("Habit Tracker")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("My to-do list")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Suivi des dépenses")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Control de gastos")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Registro de spese")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Controle de despesas")))
    }

    @Test fun sites_english_and_nonEnglish() {
        assertEquals(ProjectCategory.SITES, classify(p("Bakery website")))
        assertEquals(ProjectCategory.SITES, classify(p("My portfolio")))
        assertEquals(ProjectCategory.SITES, classify(p("Online store")))
        assertEquals(ProjectCategory.SITES, classify(p("Site vitrine pour boulangerie")))
        assertEquals(ProjectCategory.SITES, classify(p("Tienda de ropa")))
        assertEquals(ProjectCategory.SITES, classify(p("Sito web per ristorante")))
        assertEquals(ProjectCategory.SITES, classify(p("Loja de flores")))
    }

    @Test fun tools_default() {
        assertEquals(ProjectCategory.TOOLS, classify(p("Unit converter")))
        assertEquals(ProjectCategory.TOOLS, classify(p("Calculator", "adds numbers")))
    }

    @Test fun wholeWord_jeune_isNotJeu() {
        assertEquals(ProjectCategory.TOOLS, classify(p("Application pour jeune entrepreneur")))
    }

    @Test fun wholeWord_restore_isNotStore() {
        assertEquals(ProjectCategory.TOOLS, classify(p("Restore backup helper")))
    }

    @Test fun wholeWord_embeddedKeywordsDoNotMatch() {
        assertEquals(ProjectCategory.TOOLS, classify(p("Gamekeeper inventory")))
        assertEquals(ProjectCategory.TOOLS, classify(p("Shopify importer")))
    }

    @Test fun plurals() {
        assertEquals(ProjectCategory.GAMES, classify(p("Word games")))
        assertEquals(ProjectCategory.GAMES, classify(p("Des jeux")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Budget trackers")))
        assertEquals(ProjectCategory.SITES, classify(p("Coffee shops")))
    }

    @Test fun emptyFields_areTools() {
        assertEquals(ProjectCategory.TOOLS, classify(p("")))
        assertEquals(ProjectCategory.TOOLS, classify(p("", null, null)))
    }

    @Test fun matchesAcrossDescriptionAndPrompt() {
        assertEquals(ProjectCategory.GAMES, classify(p("Fun thing", desc = "a puzzle for kids")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Thing", desc = null, prompt = "track my expenses daily")))
    }

    @Test fun priority_games_beat_trackers_beat_sites() {
        assertEquals(ProjectCategory.GAMES, classify(p("Puzzle tracker")))
        assertEquals(ProjectCategory.TRACKERS, classify(p("Budget website")))
    }

    @Test fun caseInsensitive() {
        assertEquals(ProjectCategory.GAMES, classify(p("SNAKE GAME")))
    }

    @Test fun classify_neverReturnsAll() {
        val samples = listOf("game", "todo", "website", "zzz", "")
        samples.forEach { assert(classify(p(it)) != ProjectCategory.ALL) }
    }

    @Test fun visibleProjects_filtersByCategory() {
        val list = listOf(p("Snake Game"), p("Habit Tracker"), p("Calculator"))
        val all = BrowseUiState(projects = list)
        assertEquals(3, all.visibleProjects.size)
        assertEquals(1, all.copy(category = ProjectCategory.GAMES).visibleProjects.size)
        assertEquals(1, all.copy(category = ProjectCategory.TOOLS).visibleProjects.size)
        assertEquals(0, all.copy(category = ProjectCategory.SITES).visibleProjects.size)
    }
}

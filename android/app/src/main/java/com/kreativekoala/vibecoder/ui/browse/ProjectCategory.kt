package com.kreativekoala.vibecoder.ui.browse

import com.kreativekoala.vibecoder.data.model.Project

/** Client-side Browse categories. ALL is a filter only; classify() never returns it. */
enum class ProjectCategory(val label: String) {
    ALL("All"),
    GAMES("Games"),
    TOOLS("Tools"),
    SITES("Sites"),
    TRACKERS("Trackers")
}

private val gameKeywords = listOf(
    "game", "quiz", "trivia", "puzzle", "snake", "tetris", "arcade", "platformer", "shooter",
    "chess", "simulator", "multiplayer", "runner", "surfers", "flappy", "2048", "sudoku", "wordle", "tic tac toe", "tic-tac-toe", "memory match",
    // fr / es / it / pt
    "لعبة", "игра", "jeu", "jouer", "juego", "jugar", "gioco", "giocare", "jogo", "jogar", "rompecabezas", "casse-tete", "casse-tête", "puzzle"
)

private val trackerKeywords = listOf(
    "tracker", "tracking", "todo", "to-do", "to do", "habit", "budget", "expense",
    "journal", "planner", "checklist", "diary",
    // fr / es / it / pt
    "suivi", "suivre", "depenses", "dépenses", "habitude", "tâches", "taches", "liste de",
    "seguimiento", "rastreador", "gastos", "hábito", "habito", "tareas", "presupuesto",
    "traccia", "spese", "abitudini", "attività", "compiti", "bilancio",
    "rastreio", "despesas", "hábitos", "tarefas", "orçamento", "orcamento", "diário"
)

private val siteKeywords = listOf(
    "website", "web site", "landing", "portfolio", "blog", "homepage", "home page", "site ",
    "restaurant", "shop", "store", "business page", "personal page", "resume", "cv ",
    // fr / es / it / pt
    "site web", "site vitrine", "boutique", "portfolio", "sitio web", "página web", "pagina web",
    "tienda", "sito web", "negozio", "loja", "página", "cardápio"
)

// Whole-word matching (with an optional plural s/x) so "jeu" doesn't hit "jeune" and
// "store" doesn't hit "restore".
private fun wordRegex(keywords: List<String>) = Regex(
    keywords.joinToString("|", prefix = "(?<![\\p{L}\\p{N}])(?:", postfix = ")[sx]?(?![\\p{L}\\p{N}])") { Regex.escape(it.trim()) }
)

private val gameRegex = wordRegex(gameKeywords)
private val trackerRegex = wordRegex(trackerKeywords)
private val siteRegex = wordRegex(siteKeywords)

fun classify(project: Project): ProjectCategory {
    val text = "${project.title} ${project.description.orEmpty()} ${project.initialPrompt.orEmpty()}"
        .lowercase()
    return when {
        gameRegex.containsMatchIn(text) -> ProjectCategory.GAMES
        trackerRegex.containsMatchIn(text) -> ProjectCategory.TRACKERS
        siteRegex.containsMatchIn(text) -> ProjectCategory.SITES
        else -> ProjectCategory.TOOLS
    }
}

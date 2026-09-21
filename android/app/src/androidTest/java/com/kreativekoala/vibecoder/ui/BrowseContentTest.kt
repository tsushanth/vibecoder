package com.kreativekoala.vibecoder.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.ui.browse.BrowseContent
import com.kreativekoala.vibecoder.ui.browse.BrowseUiState
import com.kreativekoala.vibecoder.ui.browse.ProjectCategory
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class BrowseContentTest {
    @get:Rule val rule = createComposeRule()

    private val projects = listOf(
        Project(id = "g", title = "Snake Game"),
        Project(id = "t", title = "Habit Tracker"),
        Project(id = "s", title = "Bakery website"),
        Project(id = "u", title = "Unit converter")
    )
    private val clicked = mutableListOf<String>()

    /** Holds state like BrowseViewModel does (selectCategory -> copy(category)). */
    private fun show(initial: BrowseUiState) {
        rule.setContent {
            var state by remember { mutableStateOf(initial) }
            VibeBuildTheme {
                BrowseContent(
                    uiState = state,
                    onSelectCategory = { state = state.copy(category = it) },
                    onProjectClick = { clicked += it }
                )
            }
        }
    }

    @Test fun all_chips_render_with_ALL_selected() {
        show(BrowseUiState(projects = projects))
        ProjectCategory.entries.forEach { rule.onNodeWithText(it.label).assertIsDisplayed() }
        rule.onNodeWithText("All").assertIsSelected()
        rule.onNodeWithText("Games").assertIsNotSelected()
    }

    @Test fun all_shows_every_project() {
        show(BrowseUiState(projects = projects))
        projects.forEach { rule.onNodeWithText(it.title).assertIsDisplayed() }
    }

    @Test fun selecting_games_filters_grid() {
        show(BrowseUiState(projects = projects))
        rule.onNodeWithText("Games").performClick()
        rule.onNodeWithText("Games").assertIsSelected()
        rule.onNodeWithText("Snake Game").assertIsDisplayed()
        rule.onNodeWithText("Habit Tracker").assertDoesNotExist()
        rule.onNodeWithText("Bakery website").assertDoesNotExist()
    }

    @Test fun selecting_trackers_sites_tools() {
        show(BrowseUiState(projects = projects))
        rule.onNodeWithText("Trackers").performClick()
        rule.onNodeWithText("Habit Tracker").assertIsDisplayed()
        rule.onNodeWithText("Snake Game").assertDoesNotExist()
        rule.onNodeWithText("Sites").performClick()
        rule.onNodeWithText("Bakery website").assertIsDisplayed()
        rule.onNodeWithText("Habit Tracker").assertDoesNotExist()
        rule.onNodeWithText("Tools").performClick()
        rule.onNodeWithText("Unit converter").assertIsDisplayed()
    }

    @Test fun switching_back_to_all_restores_everything() {
        show(BrowseUiState(projects = projects))
        rule.onNodeWithText("Games").performClick()
        rule.onNodeWithText("All").performClick()
        projects.forEach { rule.onNodeWithText(it.title).assertIsDisplayed() }
    }

    @Test fun empty_category_shows_empty_state() {
        show(BrowseUiState(projects = projects.filter { it.id != "s" }))
        rule.onNodeWithText("Sites").performClick()
        rule.onNodeWithText("No apps in this category yet").assertIsDisplayed()
    }

    @Test fun no_projects_at_all_shows_empty_state() {
        show(BrowseUiState(projects = emptyList()))
        rule.onNodeWithText("No apps in this category yet").assertIsDisplayed()
    }

    @Test fun loading_hides_empty_state() {
        show(BrowseUiState(isLoading = true))
        rule.onNodeWithText("No apps in this category yet").assertDoesNotExist()
    }

    @Test fun clicking_card_reports_project_id() {
        show(BrowseUiState(projects = projects))
        rule.onNodeWithText("Snake Game").performClick()
        assertEquals(listOf("g"), clicked)
    }
}

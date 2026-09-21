package com.kreativekoala.vibecoder.ui.browse

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseScreen(
    onProjectClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    viewModel: BrowseViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSortMenu by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                windowInsets = if (onBack != null) TopAppBarDefaults.windowInsets else WindowInsets(0, 0, 0, 0),
                title = { Text(stringResource(R.string.browse_screen_title)) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.back),
                                tint = TextPrimary
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.loadProjects() }) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.refresh),
                            tint = TextSecondary
                        )
                    }
                    Box {
                        IconButton(onClick = { showSortMenu = true }) {
                            Icon(
                                Icons.AutoMirrored.Filled.Sort,
                                contentDescription = stringResource(R.string.apps_cd_sort),
                                tint = TextPrimary
                            )
                        }
                        DropdownMenu(
                            expanded = showSortMenu,
                            onDismissRequest = { showSortMenu = false },
                            containerColor = DarkSurfaceElevated
                        ) {
                            SortOption.entries.forEach { option ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = option.label,
                                            color = if (uiState.sortOption == option) VibePurple else TextPrimary
                                        )
                                    },
                                    onClick = {
                                        viewModel.changeSortOption(option)
                                        showSortMenu = false
                                    }
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkBackground,
                    titleContentColor = TextPrimary
                )
            )
        }
    ) { innerPadding ->
        BrowseContent(
            uiState = uiState,
            onSelectCategory = { viewModel.selectCategory(it) },
            onProjectClick = onProjectClick,
            modifier = Modifier.padding(innerPadding)
        )
    }
}

/** Stateless Browse body (category chips + grid/empty/loading). Extracted so it can be UI-tested without a ViewModel. */
@Composable
fun BrowseContent(
    uiState: BrowseUiState,
    onSelectCategory: (ProjectCategory) -> Unit,
    onProjectClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
        Column(modifier = modifier.fillMaxSize()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            rowItems(ProjectCategory.entries.toList()) { cat ->
                val selected = uiState.category == cat
                FilterChip(
                    selected = selected,
                    onClick = { onSelectCategory(cat) },
                    label = { Text(cat.label) },
                    colors = FilterChipDefaults.filterChipColors(
                        containerColor = DarkSurfaceVariant,
                        labelColor = TextSecondary,
                        selectedContainerColor = VibePurple.copy(alpha = 0.2f),
                        selectedLabelColor = VibePurple
                    ),
                    border = FilterChipDefaults.filterChipBorder(
                        enabled = true,
                        selected = selected,
                        borderColor = DarkBorder,
                        selectedBorderColor = VibePurple
                    )
                )
            }
        }
        val visible = uiState.visibleProjects
        when {
            uiState.isLoading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = VibePurple)
                }
            }

            visible.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize().weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No apps in this category yet", color = TextSecondary)
                }
            }

            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxSize()
                ) {
                    items(
                        items = visible,
                        key = { it.id }
                    ) { project ->
                        BrowseProjectCard(
                            project = project,
                            onClick = { onProjectClick(project.id) }
                        )
                    }
                }
            }
        }
        }
}

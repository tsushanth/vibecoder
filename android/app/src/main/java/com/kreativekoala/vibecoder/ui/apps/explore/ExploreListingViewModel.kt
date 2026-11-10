package com.kreativekoala.vibecoder.ui.apps.explore

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.repository.ExploreListingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ExploreListingViewModel @Inject constructor(
    repository: ExploreListingRepository
) : ViewModel() {
    val controller = ExploreListingController(api = repository, scope = viewModelScope)
}

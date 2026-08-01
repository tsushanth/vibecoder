package com.kreativekoala.vibecoder.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferences @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {

    companion object {
        val KEY_USER_ID = stringPreferencesKey("user_id")
        val KEY_DISPLAY_NAME = stringPreferencesKey("display_name")
        val KEY_HAS_ONBOARDED = booleanPreferencesKey("has_onboarded")
        val KEY_DAILY_GENERATIONS = intPreferencesKey("daily_generations")
        val KEY_LAST_GENERATION_DATE = stringPreferencesKey("last_generation_date")
        val KEY_HAS_SHOWN_RATING_PROMPT = booleanPreferencesKey("has_shown_rating_prompt")
        val KEY_PENDING_GENERATION_PROMPT = stringPreferencesKey("pending_generation_prompt")
        val KEY_PENDING_GENERATION_TIME = stringPreferencesKey("pending_generation_time")
    }

    val userId: Flow<String?> = dataStore.data.map { it[KEY_USER_ID] }
    val displayName: Flow<String?> = dataStore.data.map { it[KEY_DISPLAY_NAME] }
    val hasOnboarded: Flow<Boolean> = dataStore.data.map { it[KEY_HAS_ONBOARDED] ?: false }
    val hasShownRatingPrompt: Flow<Boolean> = dataStore.data.map { it[KEY_HAS_SHOWN_RATING_PROMPT] ?: false }
    val pendingGenerationPrompt: Flow<String?> = dataStore.data.map { it[KEY_PENDING_GENERATION_PROMPT] }
    val pendingGenerationTime: Flow<String?> = dataStore.data.map { it[KEY_PENDING_GENERATION_TIME] }

    suspend fun markRatingPromptShown() {
        dataStore.edit { it[KEY_HAS_SHOWN_RATING_PROMPT] = true }
    }

    suspend fun savePendingGeneration(prompt: String) {
        dataStore.edit {
            it[KEY_PENDING_GENERATION_PROMPT] = prompt
            it[KEY_PENDING_GENERATION_TIME] = System.currentTimeMillis().toString()
        }
    }

    suspend fun clearPendingGeneration() {
        dataStore.edit {
            it.remove(KEY_PENDING_GENERATION_PROMPT)
            it.remove(KEY_PENDING_GENERATION_TIME)
        }
    }

    suspend fun saveUser(userId: String, displayName: String?) {
        dataStore.edit { prefs ->
            prefs[KEY_USER_ID] = userId
            displayName?.let { prefs[KEY_DISPLAY_NAME] = it }
        }
    }

    suspend fun clearUser() {
        dataStore.edit { it.clear() }
    }
}

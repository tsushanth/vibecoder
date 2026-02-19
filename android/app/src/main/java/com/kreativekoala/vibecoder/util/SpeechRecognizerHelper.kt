package com.kreativekoala.vibecoder.util

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import java.util.Locale

class SpeechRecognizerHelper(
    private val onResult: (String) -> Unit
) {
    fun createIntent(): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Describe your app idea...")
        }
    }

    fun handleResult(resultCode: Int, data: Intent?) {
        if (resultCode == Activity.RESULT_OK) {
            val results = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val spokenText = results?.firstOrNull()
            if (!spokenText.isNullOrBlank()) {
                onResult(spokenText)
            }
        }
    }
}

@Composable
fun rememberSpeechRecognizer(
    onResult: (String) -> Unit
): Pair<SpeechRecognizerHelper, () -> Unit> {
    val helper = remember { SpeechRecognizerHelper(onResult) }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        helper.handleResult(result.resultCode, result.data)
    }

    val launch = remember(launcher) {
        { launcher.launch(helper.createIntent()) }
    }

    return helper to launch
}

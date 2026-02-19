package com.kreativekoala.vibecoder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.kreativekoala.vibecoder.navigation.VibeBuildNavGraph
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VibeBuildTheme {
                VibeBuildNavGraph()
            }
        }
    }
}

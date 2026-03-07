package com.kreativekoala.vibecoder

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.kreativekoala.vibecoder.navigation.VibeBuildNavGraph
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
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

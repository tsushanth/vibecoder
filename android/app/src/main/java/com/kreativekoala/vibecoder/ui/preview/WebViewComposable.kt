package com.kreativekoala.vibecoder.ui.preview

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewComposable(
    bundleDir: File,
    modifier: Modifier = Modifier,
    onReloadRequested: (() -> Unit)? = null
) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = true
                    @Suppress("DEPRECATION")
                    allowFileAccessFromFileURLs = true
                    @Suppress("DEPRECATION")
                    allowUniversalAccessFromFileURLs = true
                    loadWithOverviewMode = true
                    useWideViewPort = true
                    setSupportZoom(true)
                    builtInZoomControls = true
                    displayZoomControls = false
                }

                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()

                setBackgroundColor(android.graphics.Color.BLACK)

                val indexFile = File(bundleDir, "index.html")
                if (indexFile.exists()) {
                    loadUrl("file://${indexFile.absolutePath}")
                }
            }
        },
        update = { webView ->
            // Reload if needed
            onReloadRequested?.let {
                val indexFile = File(bundleDir, "index.html")
                if (indexFile.exists()) {
                    webView.loadUrl("file://${indexFile.absolutePath}")
                }
            }
        },
        modifier = modifier
    )
}

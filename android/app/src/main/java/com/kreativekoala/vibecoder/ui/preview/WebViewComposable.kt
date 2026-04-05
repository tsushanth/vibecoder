package com.kreativekoala.vibecoder.ui.preview

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewComposable(
    bundleDir: File,
    modifier: Modifier = Modifier,
    reloadTrigger: Int = 0
) {
    // key on bundleDir path so the WebView is recreated when the bundle changes (e.g. after tweak)
    key(bundleDir.absolutePath) {
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
                // Reload when trigger changes (manual reload button)
                if (reloadTrigger > 0) {
                    val indexFile = File(bundleDir, "index.html")
                    if (indexFile.exists()) {
                        webView.loadUrl("file://${indexFile.absolutePath}")
                    }
                }
            },
            modifier = modifier
        )
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun UrlWebViewComposable(
    url: String,
    modifier: Modifier = Modifier,
    reloadTrigger: Int = 0
) {
    key(url) {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        loadWithOverviewMode = true
                        useWideViewPort = true
                        setSupportZoom(true)
                        builtInZoomControls = true
                        displayZoomControls = false
                    }

                    webViewClient = WebViewClient()
                    webChromeClient = WebChromeClient()

                    setBackgroundColor(android.graphics.Color.BLACK)

                    loadUrl(url)
                }
            },
            update = { webView ->
                if (reloadTrigger > 0) {
                    webView.loadUrl(url)
                }
            },
            modifier = modifier
        )
    }
}

package com.kreativekoala.vibecoder.ui.preview

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
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
    var lastReload by remember(url) { mutableIntStateOf(0) }
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
                        // Always revalidate against the server so post-tweak
                        // bundles are picked up. The preview server sends
                        // Cache-Control: no-cache, but WebView's default
                        // (LOAD_DEFAULT) still serves stale entries from
                        // its disk cache after redirects/reloads. NO_CACHE
                        // forces a network fetch every load.
                        cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                    }

                    webViewClient = WebViewClient()
                    webChromeClient = WebChromeClient()

                    setBackgroundColor(android.graphics.Color.BLACK)

                    loadUrl(url)
                }
            },
            update = { webView ->
                // Only fire on actual reloadTrigger increments — `update`
                // runs on every recomposition, and an unconditional reload
                // here used to loop the WebView on unrelated state changes.
                if (reloadTrigger != lastReload) {
                    lastReload = reloadTrigger
                    if (reloadTrigger > 0) {
                        // Clear cached page bytes before re-fetching so the
                        // post-tweak bundle is guaranteed fresh.
                        webView.clearCache(true)
                        webView.loadUrl(url)
                    }
                }
            },
            modifier = modifier
        )
    }
}

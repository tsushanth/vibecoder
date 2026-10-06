package com.vibebuild.export

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import android.content.pm.ApplicationInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT

        webView = WebView(this)
        setContentView(webView)

        // Served from https://<app>.vibebuild.cc (bundled files answer locally), so the page has a real origin that the platform
        // proxy accepts. With no host configured the app falls back to the old file:// mode.
        val host = getString(R.string.vibe_host).trim()
        val served = host.isNotEmpty()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = !served
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = !served
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = !served
            mixedContentMode = if (served) WebSettings.MIXED_CONTENT_NEVER_ALLOW else WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            databaseEnabled = true
            textZoom = 100
        }

        if (served) {
            val loader = WebViewAssetLoader.Builder()
                .setDomain(host)
                .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()
            webView.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
        } else {
            webView.webViewClient = WebViewClient()
        }
        webView.webChromeClient = WebChromeClient()
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        // Remote debugging only for debuggable builds, never in a release APK
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)

        webView.loadUrl(if (served) "https://$host/index.html" else "file:///android_asset/index.html")
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}

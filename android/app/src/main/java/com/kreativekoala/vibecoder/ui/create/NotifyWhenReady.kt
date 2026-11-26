package com.kreativekoala.vibecoder.ui.create

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.TextTertiary
import com.kreativekoala.vibecoder.ui.theme.VibePurple

/** When to ask for the notification permission (Android 13 and later show nothing without it). */
object NotificationPromptPolicy {
    fun needsPermission(sdk: Int, granted: Boolean): Boolean = sdk >= 33 && !granted

    /** Once, by itself, at the first build; after that only when the person presses the button. */
    fun shouldAutoAsk(sdk: Int, granted: Boolean, askedBefore: Boolean): Boolean = needsPermission(sdk, granted) && !askedBefore

    /** The system will not show its question again (declined twice): the button then opens the app's notification settings. */
    fun mustUseSettings(askedBefore: Boolean, canExplain: Boolean): Boolean = askedBefore && !canExplain
}

private const val PREFS = "vibebuild_notifications"
private const val KEY_ASKED = "permission_asked"

private fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

/**
 * Shown under a running build. Asks for the notification permission at the first build, and offers a button while it is still
 * missing. [onAllowed] runs when it is granted, so the server learns this phone can show notices.
 */
@Composable
fun NotifyWhenReady(onAllowed: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var granted by remember { mutableStateOf(hasPermission(context)) }
    val missingAtStart = remember { NotificationPromptPolicy.needsPermission(Build.VERSION.SDK_INT, granted) }

    fun update(now: Boolean) {
        if (now && !granted) onAllowed()
        granted = now
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { update(it) }
    // Back from the settings page.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { update(hasPermission(context)) }

    fun ask() {
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    LaunchedEffect(Unit) {
        if (NotificationPromptPolicy.shouldAutoAsk(Build.VERSION.SDK_INT, granted, prefs.getBoolean(KEY_ASKED, false))) ask()
    }

    if (!missingAtStart) return
    Column(Modifier.fillMaxWidth()) {
        if (granted) {
            Text(stringResource(R.string.generation_notify_confirmation), color = VibePurple, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.generation_notify_leave_hint), color = TextTertiary, fontSize = 12.sp)
        } else {
            Button(
                onClick = {
                    val activity = context as? Activity
                    val canExplain = activity?.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) == true
                    if (NotificationPromptPolicy.mustUseSettings(prefs.getBoolean(KEY_ASKED, false), canExplain)) {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        )
                    } else {
                        ask()
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
            ) { Text(stringResource(R.string.generation_btn_notify)) }
        }
    }
}

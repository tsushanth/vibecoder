package com.kreativekoala.vibecoder.ui.telegram

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.DarkBorder
import com.kreativekoala.vibecoder.ui.theme.DarkSurface
import com.kreativekoala.vibecoder.ui.theme.TextPrimary
import com.kreativekoala.vibecoder.ui.theme.TextSecondary

/** Where the app sends people to the Telegram bot, and the start payload that says which surface they tapped (install attribution). */
object TelegramBot {
    const val USERNAME = "Vibebuilder_bot"
    const val PAYLOAD_BANNER = "app"
    const val PAYLOAD_CARD = "app_card"
    const val PAYLOAD_BUILD = "app_build"
    const val PAYLOAD_SETTINGS = "app_settings"

    private const val PREFS = "app_prefs"
    private const val PREF_OPENED = "telegram_opened"

    fun url(payload: String): String = "https://t.me/$USERNAME?start=$payload"

    /** Opens the bot (the Telegram app when installed, else the browser) and remembers that the person has been shown the way. */
    fun open(context: Context, payload: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_OPENED, true).apply()
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url(payload))))
        } catch (e: ActivityNotFoundException) {
            // no browser and no Telegram: nothing to open
        }
    }

    fun hasOpened(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PREF_OPENED, false)
}

/**
 * When the top Telegram banner is shown. Dismissing it hides it for [RESHOW_AFTER_DAYS] days (it used to hide it forever, which
 * is why almost nobody saw it twice); opening the bot from anywhere hides it for good because it has done its job.
 */
object TelegramBannerPolicy {
    const val RESHOW_AFTER_DAYS = 7L
    private const val DAY_MS = 24L * 60 * 60 * 1000

    /**
     * The dismissal time to use. Installs that dismissed the old one-time banner have only the legacy boolean: count that as
     * "dismissed now", so they see it again after [RESHOW_AFTER_DAYS] days.
     */
    fun effectiveDismissedAt(legacyDismissed: Boolean, storedDismissedAt: Long, nowMs: Long): Long =
        if (storedDismissedAt > 0L) storedDismissedAt else if (legacyDismissed) nowMs else 0L

    fun shouldShow(nowMs: Long, dismissedAtMs: Long, opened: Boolean): Boolean {
        if (opened) return false
        if (dismissedAtMs <= 0L) return true
        return nowMs - dismissedAtMs >= RESHOW_AFTER_DAYS * DAY_MS
    }
}

/** The Create-screen card, under the prompt box: what the bot does, and one button to open it. */
@Composable
fun TelegramPromoCard(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(DarkSurface)
            .border(BorderStroke(1.dp, DarkBorder), RoundedCornerShape(16.dp))
            .clickable { TelegramBot.open(context, TelegramBot.PAYLOAD_CARD) }
            .padding(16.dp)
    ) {
        Text(
            text = stringResource(R.string.telegram_card_title),
            color = TextPrimary,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.telegram_card_body),
            color = TextSecondary,
            fontSize = 13.sp
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.Start, verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = { TelegramBot.open(context, TelegramBot.PAYLOAD_CARD) },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF229ED9), contentColor = Color.White)
            ) {
                Text(stringResource(R.string.telegram_card_cta))
            }
        }
    }
}

package com.m1racle.note

import ai.m1racle.designsystem.M1racleDarkColors
import ai.m1racle.designsystem.M1racleLightColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

internal fun noteColors(dark: Boolean) = if (dark) M1racleDarkColors else M1racleLightColors

/** Product mapping consumes the shared semantic export, without a second palette. */
@Composable
internal fun NoteTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = noteColors(dark)
    val defaults = if (dark) darkColorScheme() else lightColorScheme()
    val scheme = defaults.copy(
        primary = colors.actionPrimaryBg,
        onPrimary = colors.actionPrimaryFg,
        primaryContainer = colors.actionSecondaryBg,
        onPrimaryContainer = colors.actionSecondaryFg,
        inversePrimary = colors.actionPrimaryFg,
        secondary = colors.actionSecondaryFg,
        onSecondary = colors.actionSecondaryBg,
        secondaryContainer = colors.actionSecondaryBg,
        onSecondaryContainer = colors.actionSecondaryFg,
        tertiary = colors.actionSecondaryFg,
        onTertiary = colors.actionSecondaryBg,
        tertiaryContainer = colors.actionSecondaryBg,
        onTertiaryContainer = colors.actionSecondaryFg,
        background = colors.canvas,
        onBackground = colors.textBody,
        surface = colors.paper,
        onSurface = colors.textPrimary,
        surfaceVariant = colors.subtle,
        onSurfaceVariant = colors.textSecondary,
        surfaceTint = Color.Transparent,
        inverseSurface = colors.actionPrimaryBg,
        inverseOnSurface = colors.actionPrimaryFg,
        error = colors.error,
        onError = colors.textInverse,
        errorContainer = colors.subtle,
        onErrorContainer = colors.error,
        outline = colors.border,
        outlineVariant = colors.border,
        surfaceBright = colors.raised,
        surfaceDim = colors.subtle,
        surfaceContainer = colors.subtle,
        surfaceContainerHigh = colors.raised,
        surfaceContainerHighest = colors.raised,
        surfaceContainerLow = colors.paper,
        surfaceContainerLowest = colors.canvas,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}

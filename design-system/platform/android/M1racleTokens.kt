package ai.m1racle.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * M1racle Design System v1.0.1
 *
 * Brand source of truth:
 * M1racle Note Brand Preview v1.2.2 FINAL
 *
 * Product UI should consume semantic roles below instead of hard-coding
 * FoundationColors. App icon optical colors are asset tokens and must not
 * be aliased to UI text/surface colors.
 */
object M1racleFoundationColors {
    val N0 = Color(0xFFFFFFFF)
    val N50 = Color(0xFFFBFBFB)
    val N100 = Color(0xFFF6F6F6)
    val N150 = Color(0xFFF5F5F5)
    val N200 = Color(0xFFE8E8E8)
    val N400 = Color(0xFFA3A3A3)
    val N500 = Color(0xFF737373)
    val N650 = Color(0xFF3B3B3B)
    val N800 = Color(0xFF242424)
    val N850 = Color(0xFF181818)
    val N875 = Color(0xFF151515)
    val N900 = Color(0xFF111111)
    val N950 = Color(0xFF0D0D0D)
}

data class M1racleSemanticColors(
    val canvas: Color,
    val paper: Color,
    val subtle: Color,
    val raised: Color,
    val surfaceOverlay: Color,
    val textPrimary: Color,
    val textBody: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textInverse: Color,
    val border: Color,
    val borderOverlay: Color,
    val actionPrimaryBg: Color,
    val actionPrimaryFg: Color,
    val actionSecondaryBg: Color,
    val actionSecondaryFg: Color,
    val actionHover: Color,
    val actionPressed: Color,
    val success: Color,
    val warning: Color,
    val error: Color,
    val link: Color,
    val focusRing: Color,
)

val M1racleLightColors = M1racleSemanticColors(
    canvas = Color(0xFFFFFFFF),
    paper = Color(0xFFFFFFFF),
    subtle = Color(0xFFF6F6F6),
    raised = Color(0xFFFBFBFB),
    surfaceOverlay = Color(0xFFFFFFFF).copy(alpha = 0.88f),
    textPrimary = Color(0xFF111111),
    textBody = Color(0xFF3B3B3B),
    textSecondary = Color(0xFF6F6F6F),
    textTertiary = Color(0xFF707070),
    textInverse = Color(0xFFFFFFFF),
    border = Color(0xFFE8E8E8),
    borderOverlay = Color(0xFFE8E8E8).copy(alpha = 0.82f),
    actionPrimaryBg = Color(0xFF111111),
    actionPrimaryFg = Color(0xFFFFFFFF),
    actionSecondaryBg = Color(0xFFF6F6F6),
    actionSecondaryFg = Color(0xFF111111),
    actionHover = Color(0xFFF6F6F6),
    actionPressed = Color(0xFFE8E8E8),
    success = Color(0xFF18794E),
    warning = Color(0xFF9A5B00),
    error = Color(0xFFB42318),
    link = Color(0xFF2457D6),
    focusRing = Color(0xFF2457D6),
)

val M1racleDarkColors = M1racleSemanticColors(
    canvas = Color(0xFF0D0D0D),
    paper = Color(0xFF111111),
    subtle = Color(0xFF151515),
    raised = Color(0xFF111111),
    surfaceOverlay = Color(0xFF0D0D0D).copy(alpha = 0.88f),
    textPrimary = Color(0xFFF5F5F5),
    textBody = Color(0xFFD1D1D1),
    textSecondary = Color(0xFFA5A5A5),
    textTertiary = Color(0xFF7F7F7F),
    textInverse = Color(0xFF111111),
    border = Color(0xFF242424),
    borderOverlay = Color(0xFF242424).copy(alpha = 0.82f),
    actionPrimaryBg = Color(0xFFF5F5F5),
    actionPrimaryFg = Color(0xFF0D0D0D),
    actionSecondaryBg = Color(0xFF151515),
    actionSecondaryFg = Color(0xFFF5F5F5),
    actionHover = Color(0xFF151515),
    actionPressed = Color(0xFF242424),
    success = Color(0xFF5CCF92),
    warning = Color(0xFFF2B84B),
    error = Color(0xFFFF7B72),
    link = Color(0xFF7AA2FF),
    focusRing = Color(0xFF7AA2FF),
)

object M1racleSpacing {
    val Half = 4.dp
    val One = 8.dp
    val OneHalf = 12.dp
    val Two = 16.dp
    val TwoHalf = 20.dp
    val Three = 24.dp
    val Four = 32.dp
    val Five = 40.dp
    val Six = 48.dp
    val Eight = 64.dp
    val Ten = 80.dp
    val Twelve = 96.dp
}

object M1racleRadius {
    val Small = 8.dp
    val Medium = 12.dp
    val Large = 18.dp
    val ExtraLarge = 28.dp
}

object M1racleType {
    val Caption = 11.sp
    val Control = 12.sp
    val BodySmall = 14.sp
    val Body = 16.sp
    val Reading = 17.sp
    val TitleSmall = 20.sp
    val Title = 28.sp
    val DisplaySmall = 42.sp
    val Display = 68.sp
}

object M1racleMotion {
    const val FastMs = 120
    const val StandardMs = 160
    const val SlowMs = 240
}

/**
 * Minimum Android interactive width and height, in dp.
 *
 * Maps component.interactionTarget.androidMinimum to 48.dp, independently
 * from the Web 44 CSS px minimum. A smaller visual control still needs an
 * actual, non-overlapping 48.dp target in both axes. These exported values
 * are a layout contract; consumers must apply them to their clickable area.
 */
object M1racleInteractionTarget {
    val Minimum = 48.dp
    val ButtonMinimum = Minimum
    val IconButtonMinimum = Minimum
    val FieldMinimum = Minimum
    val ListRowMinimum = Minimum
}

/** Asset-level values; keep separate from M1racleSemanticColors. */
object M1racleAppIconOptics {
    val DayBackground = Color(0xFFFFFFFF)
    val DayForeground = Color(0xFF181818)
    val NightBackground = Color(0xFF242424)
    val NightForeground = Color(0xFFF5F5F5)
}

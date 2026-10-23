package com.m1racle.note

import android.os.Build
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.LayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.highlight.Highlight

/** Reader PDF Control/Capsule recipe, using the same pinned Backdrop engine. */
@Composable
fun Modifier.pdfGlass(backdrop: Backdrop, shape: Shape, dark: Boolean, panel: Boolean=false,
                      interactions: MutableInteractionSource?=null, export: LayerBackdrop?=null): Modifier {
    val pressed=interactions?.collectIsPressedAsState()?.value ?: false
    val progress by animateFloatAsState(if(pressed) 1f else 0f, spring(dampingRatio=.55f,stiffness=450f),label="pdfGlassPress")
    val colors=noteColors(dark)
    // Keep the established material strengths and capture topology; only map its tint role.
    val tint=colors.surfaceOverlay.copy(alpha=if(dark) { if(panel) .64f else .22f } else { if(panel) .60f else .32f })
    if(Build.VERSION.SDK_INT<31) return background(tint.copy(alpha=.94f),shape).border(.75.dp,colors.borderOverlay,shape)
    return this.dropShadow(shape,Shadow(radius=8.dp,color=Color.Black.copy(alpha=if(dark) .24f else .12f),offset=DpOffset(0.dp,2.dp)))
        .drawBackdrop(backdrop=backdrop,shape={shape},effects={
            blur(4.dp.toPx())
            if(Build.VERSION.SDK_INT>=33) lens(refractionHeight=8.dp.toPx(),refractionAmount=24.dp.toPx(),depthEffect=true,chromaticAberration=false)
        },layerBlock={val scale=1f-.035f*progress.coerceIn(0f,1f);scaleX=scale;scaleY=scale},
            highlight={Highlight.Default.copy(width=.75.dp,alpha=.60f+.10f*progress.coerceIn(0f,1f))},shadow=null,
            exportedBackdrop=export,onDrawSurface={drawRect(tint.copy(alpha=(tint.alpha+.04f*progress.coerceIn(0f,1f)).coerceAtMost(1f)))})
}

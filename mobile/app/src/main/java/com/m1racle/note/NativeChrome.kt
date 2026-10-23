package com.m1racle.note

import ai.m1racle.designsystem.M1racleInteractionTarget
import ai.m1racle.designsystem.M1racleRadius
import ai.m1racle.designsystem.M1racleSpacing
import ai.m1racle.designsystem.M1racleType
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.PathParser
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private fun ink(dark:Boolean)=noteColors(dark).textPrimary
private fun muted(dark:Boolean)=noteColors(dark).textSecondary

@Composable private fun Symbol(name:String,color:Color) {
    val data=when(name) {
        "back"->"M14 5L7 12L14 19"
        "plus"->"M12 5V19M5 12H19"
        "undo"->"M8 4L3 9L8 14M3 9H13C21 9 21 21 13 21"
        "redo"->"M16 4L21 9L16 14M21 9H11C3 9 3 21 11 21"
        "search"->"M17 10.5A6.5 6.5 0 1 1 4 10.5A6.5 6.5 0 1 1 17 10.5M16 16L21 21"
        "share"->"M12 15V3M8 7L12 3L16 7M7 11H5V21H19V11H17"
        "import"->"M4 14V20H20V14M12 3V15M7 10L12 15L17 10"
        "export"->"M4 14V20H20V14M12 15V3M7 8L12 3L17 8"
        "settings"->"M4 7H20M4 17H20M12 7A3 3 0 1 1 6 7A3 3 0 1 1 12 7M18 17A3 3 0 1 1 12 17A3 3 0 1 1 18 17"
        "close"->"M6 6L18 18M18 6L6 18"
        "next"->"M9 5L16 12L9 19"
        else->"M6 3H14L19 8V21H6ZM14 3V8H19M9 12H16M9 16H14"
    }
    val path=remember(data){PathParser.createPathFromPathData(data)!!.asComposePath()}
    Canvas(Modifier.size(22.dp)) {
        withTransform({scale(size.width/24f,size.height/24f,pivot=androidx.compose.ui.geometry.Offset.Zero)}) {
            if(name=="more") listOf(5f,12f,19f).forEach{drawCircle(color,1.5f,androidx.compose.ui.geometry.Offset(it,12f))}
            else drawPath(path,color,style=Stroke(width=1.7f,cap=androidx.compose.ui.graphics.StrokeCap.Round,join=androidx.compose.ui.graphics.StrokeJoin.Round))
        }
    }
}
@Composable private fun GlassButton(label:String,icon:String,backdrop:Backdrop,dark:Boolean,modifier:Modifier=Modifier,enabled:Boolean=true,onClick:()->Unit) {
    val interaction=remember{MutableInteractionSource()}
    Box(modifier.sizeIn(minWidth=M1racleInteractionTarget.IconButtonMinimum,minHeight=M1racleInteractionTarget.IconButtonMinimum).size(M1racleInteractionTarget.IconButtonMinimum).pdfGlass(backdrop,CircleShape,dark,interactions=interaction).clip(CircleShape)
        .semantics{contentDescription=label}.clickable(enabled=enabled,interactionSource=interaction,indication=null,role=Role.Button,onClick=onClick),contentAlignment=Alignment.Center){Symbol(icon,ink(dark).copy(alpha=if(enabled) 1f else .4f))}
}
@Composable private fun PlainButton(label:String,icon:String,dark:Boolean,enabled:Boolean=true,onClick:()->Unit) {
    val interaction=remember{MutableInteractionSource()}
    Box(Modifier.size(M1racleInteractionTarget.IconButtonMinimum).clip(CircleShape).semantics{contentDescription=label}.clickable(enabled=enabled,interactionSource=interaction,indication=null,role=Role.Button,onClick=onClick),contentAlignment=Alignment.Center){Symbol(icon,ink(dark).copy(alpha=if(enabled) 1f else .4f))}
}
@Composable private fun GlassInput(value:String,label:String,backdrop:Backdrop,dark:Boolean,onValue:(String)->Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min=M1racleInteractionTarget.FieldMinimum).pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.Medium),dark).padding(horizontal=M1racleSpacing.Two),verticalAlignment=Alignment.CenterVertically) {
        Symbol("search",muted(dark));Spacer(Modifier.width(M1racleSpacing.OneHalf))
        BasicTextField(value=value,onValueChange=onValue,singleLine=true,textStyle=TextStyle(color=ink(dark),fontSize=M1racleType.BodySmall),cursorBrush=androidx.compose.ui.graphics.SolidColor(noteColors(dark).focusRing),
            modifier=Modifier.weight(1f).heightIn(min=M1racleInteractionTarget.FieldMinimum).semantics{contentDescription=label},decorationBox={inner->Box(contentAlignment=Alignment.CenterStart){if(value.isEmpty())Text(label,color=muted(dark),fontSize=M1racleType.BodySmall);inner()}})
        if(value.isNotEmpty()) PlainButton("清除搜索","close",dark){onValue("")}
    }
}
private fun excerpt(value:String)=value.replace(Regex("!?\\[([^]]*)]\\([^)]*\\)"),"$1").replace(Regex("(^|\\s)>\\s?"),"$1").replace(Regex("[*_`~]"),"").replace(Regex("\\s+")," ").trim()
private fun dateLabel(timestamp:Long):String {
    val date=Calendar.getInstance().apply{timeInMillis=timestamp};val today=Calendar.getInstance();val yesterday=Calendar.getInstance().apply{add(Calendar.DATE,-1)}
    val day=when{date.get(Calendar.YEAR)==today.get(Calendar.YEAR)&&date.get(Calendar.DAY_OF_YEAR)==today.get(Calendar.DAY_OF_YEAR)->"今天 "
        date.get(Calendar.YEAR)==yesterday.get(Calendar.YEAR)&&date.get(Calendar.DAY_OF_YEAR)==yesterday.get(Calendar.DAY_OF_YEAR)->"昨天 "
        else->return SimpleDateFormat(if(date.get(Calendar.YEAR)==today.get(Calendar.YEAR)) "M月d日" else "yyyy年M月d日",Locale.CHINA).format(Date(timestamp))}
    return day+SimpleDateFormat("HH:mm",Locale.CHINA).format(Date(timestamp))
}

@Composable fun NativeChrome(state:ChromeState,backdrop:Backdrop,command:(String,JSONObject)->Unit,editor:(String)->Unit,preference:(JSONObject)->Unit) {
    var panel by remember {mutableStateOf("")}
    var query by remember {mutableStateOf("")}
    var find by remember {mutableStateOf("")}
    val menuBackdrop=rememberLayerBackdrop()
    LaunchedEffect(state.screen){panel="";query="";find=""}
    BackHandler(panel.isNotEmpty()){panel=""}
    val action:(String,JSONObject)->Unit={type,payload->panel="";command(type,payload)}
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxPanelHeight=(maxHeight-96.dp).coerceAtLeast(100.dp)
        if(state.screen=="home") {
            val filtered=state.notes.filter{it.title.contains(query,true)||it.preview.contains(query,true)}
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=M1racleSpacing.Three).padding(top=20.dp,bottom=120.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)){Text("M1racle Note",fontSize=M1racleType.Control,color=muted(state.dark));Spacer(Modifier.height(M1racleSpacing.Half));Text("笔记",fontSize=M1racleType.Title,fontWeight=FontWeight.SemiBold,color=ink(state.dark))}
                    GlassButton("首页菜单","more",backdrop,state.dark){panel=if(panel=="menu") "" else "menu"}
                }
                Spacer(Modifier.height(M1racleSpacing.Three));GlassInput(query,"搜索笔记",backdrop,state.dark){query=it};Spacer(Modifier.height(M1racleSpacing.Three))
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(if(query.isEmpty()) "最近编辑" else "搜索结果",fontSize=M1racleType.Control,color=muted(state.dark));Text("${filtered.size} 篇",fontSize=M1racleType.Caption,color=muted(state.dark))}
                Spacer(Modifier.height(M1racleSpacing.OneHalf))
                if(filtered.isNotEmpty()) Column(Modifier.fillMaxWidth().pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.Large),state.dark,panel=true).clip(RoundedCornerShape(M1racleRadius.Large))) {
                    filtered.forEachIndexed{index,note->key(note.id){
                        if(index>0) HorizontalDivider(Modifier.padding(horizontal=M1racleSpacing.Two),color=noteColors(state.dark).border)
                        val interaction=remember{MutableInteractionSource()}
                        Row(Modifier.fillMaxWidth().heightIn(min=M1racleInteractionTarget.ListRowMinimum).clickable(enabled=!state.busy,interactionSource=interaction,indication=null,role=Role.Button){action("open",JSONObject().put("filename",note.id))}.padding(M1racleSpacing.Two),verticalAlignment=Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(note.title,fontSize=M1racleType.Body,fontWeight=FontWeight.SemiBold,color=ink(state.dark),lineHeight=23.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                                Spacer(Modifier.height(M1racleSpacing.Half));Text(excerpt(note.preview).ifEmpty{"还没有正文"},fontSize=M1racleType.BodySmall,lineHeight=19.sp,color=muted(state.dark),maxLines=1,overflow=TextOverflow.Ellipsis)
                                Spacer(Modifier.height(M1racleSpacing.OneHalf));Text(dateLabel(note.modified),fontSize=M1racleType.Caption,color=muted(state.dark))
                            };Spacer(Modifier.width(M1racleSpacing.OneHalf));Box(Modifier.size(16.dp),contentAlignment=Alignment.Center){Text("›",fontSize=21.sp,color=muted(state.dark).copy(alpha=.55f))}
                        }
                    }}
                } else Column(Modifier.fillMaxWidth().padding(top=60.dp),horizontalAlignment=Alignment.CenterHorizontally){Symbol(if(query.isEmpty()) "file" else "search",muted(state.dark));Spacer(Modifier.height(M1racleSpacing.Two));Text(if(query.isEmpty()) "从一个想法开始" else "没有找到笔记",color=ink(state.dark),fontSize=M1racleType.Reading);Spacer(Modifier.height(M1racleSpacing.One));Text(if(query.isEmpty()) "轻点 ＋，写下第一篇笔记。" else "换个关键词试试。",color=muted(state.dark),fontSize=M1racleType.BodySmall)}
            }
            GlassButton("新建笔记","plus",backdrop,state.dark,Modifier.align(Alignment.BottomEnd).padding(M1racleSpacing.Three).size(56.dp),enabled=!state.busy){action("create",JSONObject())}
        } else Row(Modifier.fillMaxWidth().padding(horizontal=M1racleSpacing.Two).padding(top=M1racleSpacing.Two),verticalAlignment=Alignment.CenterVertically) {
            GlassButton("返回首页","back",backdrop,state.dark,enabled=!state.busy){action("home",JSONObject())};Spacer(Modifier.weight(1f))
            Row(Modifier.pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.ExtraLarge),state.dark).padding(M1racleSpacing.Half)) {
                PlainButton("撤销","undo",state.dark,enabled=!state.busy){editor("undo()")}
                PlainButton("更多菜单","more",state.dark){panel=if(panel=="menu") "" else "menu"}
            }
        }
        if(panel.isNotEmpty()) {
            val interaction=remember{MutableInteractionSource()}
            Box(Modifier.fillMaxSize().clickable(interactionSource=interaction,indication=null){panel=""})
            Column(Modifier.align(Alignment.TopEnd).padding(top=M1racleSpacing.Ten,end=M1racleSpacing.Two,start=M1racleSpacing.Two).width(if(panel=="settings") 360.dp else 300.dp).heightIn(max=maxPanelHeight)
                .pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.ExtraLarge),state.dark,panel=true,export=menuBackdrop).clip(RoundedCornerShape(M1racleRadius.ExtraLarge))
                .verticalScroll(rememberScrollState()).padding(if(panel=="settings") M1racleSpacing.TwoHalf else M1racleSpacing.One)) {
                when(panel) {
                    "settings"->Settings(state,menuBackdrop,{panel=""},preference)
                    "find"->{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("查找",color=ink(state.dark),fontWeight=FontWeight.SemiBold,modifier=Modifier.weight(1f));PlainButton("关闭查找","close",state.dark){panel="";editor("searchNative(\"\")")}}
                        GlassInput(find,"查找正文",menuBackdrop,state.dark){find=it;editor("searchNative(${JSONObject.quote(it)})")}
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){PlainButton("上一处","back",state.dark){editor("searchNative(${JSONObject.quote(find)},-1)")};PlainButton("下一处","next",state.dark){editor("searchNative(${JSONObject.quote(find)},1)")}}
                    }
                    else->{
                        if(state.screen=="editor") {
                            MenuRow("查找","search",state.dark){panel="find"}
                            MenuRow("撤销","undo",state.dark){panel="";editor("undo()")}
                            MenuRow("重做","redo",state.dark){panel="";editor("redo()")}
                            MenuDivider(state.dark)
                            MenuRow("分享文档","share",state.dark){action("share",JSONObject())}
                            MenuRow("导出 Markdown","export",state.dark){action("export",JSONObject())}
                        }
                        MenuRow(if(state.screen=="home") "打开 Markdown" else "打开其他文档","import",state.dark){action("import",JSONObject())}
                        MenuDivider(state.dark)
                        MenuRow(if(state.screen=="home") "外观设置" else "排版与外观","settings",state.dark){panel="settings"}
                    }
                }
            }
        }
        if(state.error.isNotEmpty()) Row(Modifier.align(Alignment.BottomCenter).padding(M1racleSpacing.TwoHalf).fillMaxWidth().pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.Large),state.dark,panel=true).padding(M1racleSpacing.OneHalf),verticalAlignment=Alignment.CenterVertically){Text(state.error,color=noteColors(state.dark).error,fontSize=M1racleType.BodySmall,modifier=Modifier.weight(1f));PlainButton("关闭提示","close",state.dark){editor("reportError(\"\")")}}
        if(state.busy) CircularProgressIndicator(Modifier.align(Alignment.BottomCenter).padding(bottom=20.dp).size(20.dp),color=noteColors(state.dark).actionPrimaryBg,strokeWidth=2.dp)
    }
}
@Composable private fun MenuDivider(dark:Boolean){HorizontalDivider(Modifier.padding(horizontal=M1racleSpacing.OneHalf,vertical=M1racleSpacing.Half),color=noteColors(dark).border)}
@Composable private fun MenuRow(label:String,icon:String,dark:Boolean,action:()->Unit){val interaction=remember{MutableInteractionSource()};Row(Modifier.fillMaxWidth().heightIn(min=M1racleInteractionTarget.ListRowMinimum).clip(RoundedCornerShape(M1racleRadius.Medium)).clickable(interactionSource=interaction,indication=null,role=Role.Button,onClick=action).padding(horizontal=M1racleSpacing.Two,vertical=M1racleSpacing.OneHalf),verticalAlignment=Alignment.CenterVertically){Symbol(icon,ink(dark));Spacer(Modifier.width(M1racleSpacing.OneHalf));Text(label,color=ink(dark),fontSize=M1racleType.BodySmall)}}

@Composable private fun Settings(s:ChromeState,backdrop:Backdrop,close:()->Unit,change:(JSONObject)->Unit) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("排版与外观",fontSize=M1racleType.TitleSmall,fontWeight=FontWeight.SemiBold,color=ink(s.dark),modifier=Modifier.weight(1f));PlainButton("关闭设置","close",s.dark, onClick=close)}
    Spacer(Modifier.height(M1racleSpacing.OneHalf));SettingLabel("纸张尺寸",s.dark)
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(M1racleSpacing.One)) {
        listOf(Triple("fluid","自适应","随屏幕调整"),Triple("a4","A4","210 × 297 mm"),Triple("a5","A5","148 × 210 mm")).forEach{(value,label,dimensions)->
            val interaction=remember{MutableInteractionSource()};val shape=RoundedCornerShape(M1racleRadius.Medium)
            Column(Modifier.weight(1f).sizeIn(minWidth=M1racleInteractionTarget.Minimum,minHeight=M1racleInteractionTarget.Minimum).pdfGlass(backdrop,shape,s.dark,interactions=interaction).then(if(s.paper==value) Modifier.border(1.dp,noteColors(s.dark).actionPrimaryBg,shape) else Modifier).clip(shape).semantics{selected=s.paper==value}.clickable(interactionSource=interaction,indication=null,role=Role.RadioButton){change(JSONObject().put("paper",value))}.padding(vertical=M1racleSpacing.Two),horizontalAlignment=Alignment.CenterHorizontally){
                Box(Modifier.size(if(value=="a5") 21.dp else 25.dp,if(value=="a5") 29.dp else 35.dp).border(1.dp,ink(s.dark),RoundedCornerShape(3.dp)))
                Spacer(Modifier.height(M1racleSpacing.One));Text(label,fontSize=M1racleType.BodySmall,fontWeight=FontWeight.SemiBold,color=ink(s.dark));Spacer(Modifier.height(M1racleSpacing.Half));Text(dimensions,fontSize=M1racleType.Caption,color=muted(s.dark))
            }
        }
    }
    Spacer(Modifier.height(M1racleSpacing.OneHalf));Text("A4 / A5 显示纸张比例，正文连续编辑。",fontSize=M1racleType.Caption,color=muted(s.dark))
    Spacer(Modifier.height(M1racleSpacing.Three));SettingLabel("字体",s.dark);Segments(listOf("sans" to "无衬线","serif" to "宋体"),s.font,backdrop,s.dark){change(JSONObject().put("font",it))}
    Spacer(Modifier.height(M1racleSpacing.Three));GlassRange("字号",s.size,s.size.roundToInt().toString(),14f..24f,9,backdrop,s.dark){change(JSONObject().put("size",it.roundToInt()))}
    Spacer(Modifier.height(M1racleSpacing.TwoHalf));GlassRange("行距",s.leading,String.format(Locale.ROOT,"%.1f",s.leading),1.4f..2.2f,7,backdrop,s.dark){change(JSONObject().put("leading",(it*10).roundToInt()/10f))}
    Spacer(Modifier.height(M1racleSpacing.TwoHalf));SettingLabel("外观",s.dark);Segments(listOf("system" to "自动","light" to "浅色","dark" to "深色"),s.theme,backdrop,s.dark){change(JSONObject().put("theme",it))}
}
@Composable private fun SettingLabel(text:String,dark:Boolean){Text(text,color=muted(dark),fontSize=M1racleType.Control);Spacer(Modifier.height(M1racleSpacing.OneHalf))}
@Composable private fun Segments(values:List<Pair<String,String>>,selected:String,backdrop:Backdrop,dark:Boolean,change:(String)->Unit){Row(Modifier.fillMaxWidth().pdfGlass(backdrop,RoundedCornerShape(M1racleRadius.Medium),dark).padding(M1racleSpacing.Half)){
    values.forEach{(value,label)->val interaction=remember{MutableInteractionSource()};val shape=RoundedCornerShape(M1racleRadius.Small)
        Box(Modifier.weight(1f).sizeIn(minWidth=M1racleInteractionTarget.Minimum,minHeight=M1racleInteractionTarget.Minimum).then(if(selected==value) Modifier.pdfGlass(backdrop,shape,dark,interactions=interaction).border(1.dp,noteColors(dark).actionPrimaryBg,shape) else Modifier).clip(shape).semantics{this.selected=selected==value}.clickable(interactionSource=interaction,indication=null,role=Role.RadioButton){change(value)},contentAlignment=Alignment.Center){Text(label,fontSize=M1racleType.BodySmall,color=ink(dark))}
    }
}}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun GlassRange(label:String,value:Float,display:String,range:ClosedFloatingPointRange<Float>,steps:Int,backdrop:Backdrop,dark:Boolean,change:(Float)->Unit){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(label,fontSize=M1racleType.Control,color=muted(dark));Text(display,fontSize=M1racleType.Control,color=muted(dark))}
    Slider(value=value,onValueChange=change,valueRange=range,steps=steps,modifier=Modifier.fillMaxWidth().heightIn(min=M1racleInteractionTarget.Minimum).semantics{contentDescription=label},
        thumb={Box(Modifier.size(26.dp).pdfGlass(backdrop,CircleShape,dark))},track={Canvas(Modifier.fillMaxWidth().height(M1racleSpacing.Half)){drawRoundRect(noteColors(dark).border,cornerRadius=androidx.compose.ui.geometry.CornerRadius(8f))}})
}

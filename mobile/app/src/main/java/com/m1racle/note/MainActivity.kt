package com.m1racle.note

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.charset.CharacterCodingException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private val main = Handler(Looper.getMainLooper())
    private val storage = Executors.newSingleThreadScheduledExecutor()
    private var pending: ScheduledFuture<*>? = null
    private var session: DocumentSession? = null // storage thread only
    private lateinit var web: WebView
    private var destroyed = false
    private var inEditor = false
    private var editorReady = false // main thread only
    private var activeFilename: String? = null
    @Volatile private var restoredFilename: String? = null
    private var pendingExportName: String? = null // saved in Android's Activity state
    private data class Display(val filename:String,val payload:String,val focus:Boolean)
    private var waitingDisplay: Display? = null
    private val waitingCommands = mutableListOf<String>()
    private var surfaceColor by mutableStateOf(noteColors(false).canvas)
    private var appearanceDark by mutableStateOf(false)
    private val notes get() = File(filesDir, "Notes").apply { mkdirs() }
    private val prefs get() = getSharedPreferences("appearance", MODE_PRIVATE)
    private val exports get() = PendingExportStore(File(filesDir, "pending-exports"))
    private val shares get() = ShareCopyStore(File(filesDir, "share-copies"))
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) { js("setBusy(false)"); js("setReadOnly(false)") }
        else storage.execute {
            try {
                flush()
                val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                val file = File(notes, "import-${UUID.randomUUID()}.md")
                DocumentSession.atomicWrite(file, bytes)
                val opened = try { DocumentSession(file) } catch (e: Exception) { file.delete(); throw e }
                session = opened; display(opened)
            } catch (e: Exception) { fail(e) }
            finally { main.post { js("setBusy(false)"); js("setReadOnly(false)") } }
        }
    }
    private val exporter = registerForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        val record = pendingExportName
        pendingExportName = null
        storage.execute {
            try {
                if(uri != null) {
                    check(record != null) { "导出状态已失效，请重新导出" }
                    val bytes = exports.read(record)
                    val output = contentResolver.openOutputStream(uri,"w") ?: error("无法写入选定的位置")
                    output.use { it.write(bytes); it.flush() }
                }
            }
            catch (e: Exception) { fail(e) }
            finally {
                if(record != null) try { exports.discard(record) } catch(e:Exception) { Log.e("M1racle","Export cleanup failed",e) }
                main.post { js("setBusy(false)"); js("setReadOnly(false)") }
            }
        }
    }
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        restoredFilename = savedInstanceState?.getString("active-note")?.takeIf { it.matches(Regex("[a-zA-Z0-9.-]+\\.md")) }
        pendingExportName = savedInstanceState?.getString("pending-export")?.takeIf { PendingExportStore.validName(it) }
        val initialDark = JSONObject(prefs.getString("preferences", "{}")!!).optString("theme", "system").let {
            it == "dark" || (it == "system" && resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES)
        }
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { initialDark },
            navigationBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { initialDark })
        applyAppearance(String.format(java.util.Locale.ROOT,"#%06x",noteColors(initialDark).canvas.toArgb() and 0xFFFFFF), initialDark)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web = WebView(this).apply {
            setBackgroundColor(noteColors(initialDark).canvas.toArgb())
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.blockNetworkLoads = true; settings.domStorageEnabled = false
            addJavascriptInterface(Bridge(), "Native")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
                    loader.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain","utf-8",403,"Offline only",emptyMap(),ByteArrayInputStream(byteArrayOf()))
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                    storage.execute { try { flush() } catch (e: Exception) { Log.e("M1racle","Final save failed",e) } }
                    main.post { android.app.AlertDialog.Builder(this@MainActivity).setMessage("编辑器已停止，请重新打开应用。已回传的内容正在保存。").setPositiveButton("关闭") { _, _ -> finish() }.show() }
                    return true
                }
            }
        }
        setContent { NoteTheme(appearanceDark) { Surface(Modifier.fillMaxSize(), color=surfaceColor) { AndroidView(factory={web},modifier=Modifier.fillMaxSize().safeDrawingPadding().imePadding()) } } }
        onBackPressedDispatcher.addCallback(this, object: OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if(inEditor) js("back()") else finish() }
        })
        web.loadUrl("https://appassets.androidplatform.net/assets/editor/index.html")
    }
    private fun executeJs(command:String) { if(!destroyed) web.evaluateJavascript("window.M1racle.$command",null) }
    private fun js(command:String) {
        if(destroyed) return
        if(editorReady) executeJs(command) else waitingCommands.add(command)
    }
    private fun render(document:Display) {
        inEditor=true; activeFilename=document.filename
        executeJs("loadDocument(${document.payload})")
        if(document.focus) executeJs("focus()")
    }
    private fun applyAppearance(background:String, dark:Boolean) {
        val color=android.graphics.Color.parseColor(background)
        surfaceColor=Color(color)
        appearanceDark=dark
        window.decorView.setBackgroundColor(color)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars=!dark
            isAppearanceLightNavigationBars=!dark
        }
    }
    private fun save(doc:DocumentSession) {
        doc.save()
        main.post { js("clearSaveError(${JSONObject.quote(doc.id)})") }
    }
    private fun flush() { pending?.cancel(false); session?.let { save(it) } }
    private fun title(text:String):String = text.lineSequence().firstOrNull { it.isNotBlank() }?.replace(Regex("^#{1,6}\\s+"),"")?.take(64) ?: "未命名笔记"
    private fun display(doc:DocumentSession, focus:Boolean=false) {
        val payload=JSONObject().put("id",doc.id).put("markdown",doc.text).put("path",doc.file.name).put("title",title(doc.text))
        val document=Display(doc.file.name,payload.toString(),focus)
        main.post { if(!destroyed) { if(editorReady) render(document) else waitingDisplay=document } }
    }
    private fun publishLibrary() {
        val result=JSONArray()
        notes.listFiles()?.filter { it.extension=="md" && it.name!="qa.md" }?.sortedByDescending { it.lastModified() }?.forEach { file ->
            try {
                // The list is derived from source; never modifies a document.
                val excerpt=file.bufferedReader(Charsets.UTF_8).use { reader -> val chars=CharArray(4096); val n=reader.read(chars); if(n>0) String(chars,0,n).removePrefix("\uFEFF") else "" }
                val preview=excerpt.lineSequence().filter { it.isNotBlank() && !it.startsWith("#") }.joinToString(" ").take(100)
                result.put(JSONObject().put("id",file.name).put("title",title(excerpt)).put("preview",preview).put("modified",file.lastModified()))
            } catch(e:Exception) { Log.w("M1racle","Cannot read note metadata",e) }
        }
        main.post { js("setLibrary($result)") }
    }
    private fun fail(e:Exception) {
        Log.e("M1racle","Storage failure",e)
        val recoverable = session?.dirty == true
        val message = if(e is CharacterCodingException) "这份文件的编码暂不支持。请先将它另存为 UTF-8，再导入。"
            else e.message?.let { "操作未完成：$it" } ?: "操作未完成，请重试。"
        main.post { js("reportError(${JSONObject.quote(message)},$recoverable)"); js("setReadOnly(false)") }
    }
    inner class Bridge {
        @JavascriptInterface fun postMessage(message:String) {
            storage.execute {
                try {
                    val event=JSONObject(message)
                    when(event.getString("type")) {
                        "open-link" -> {
                            flush()
                            val url=WebLink.parse(event.getString("url"))
                            main.post {
                                try { startActivity(Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
                                catch(e:Exception) { storage.execute { fail(e) } }
                            }
                        }
                        "appearance" -> {
                            val dark=event.getBoolean("dark")
                            val background=event.getString("background")
                            if(background.matches(Regex("#[0-9a-fA-F]{6}"))) main.post { applyAppearance(background,dark) }
                        }
                        "ready" -> {
                            flush()
                            var restoreFailure:Exception?=null
                            val restore=restoredFilename; restoredFilename=null
                            if(session==null && restore!=null) {
                                try { session=DocumentSession(File(notes,restore)) } catch(e:Exception) { restoreFailure=e }
                            }
                            if(!prefs.getBoolean("initialized",false)) {
                                val welcome=File(notes,"welcome.md")
                                if(!welcome.exists()) DocumentSession.atomicWrite(welcome,assets.open("welcome.md").use { it.readBytes() })
                                prefs.edit().putBoolean("initialized",true).apply()
                            }
                            val settings=JSONObject(prefs.getString("preferences","{}")!!)
                            session?.let { display(it) }
                            main.post {
                                if(!destroyed) {
                                    editorReady=true; executeJs("setPreferences($settings)")
                                    val document=waitingDisplay; waitingDisplay=null
                                    if(document!=null) render(document)
                                    else { inEditor=false; activeFilename=null; executeJs("showHome()") }
                                    val commands=waitingCommands.toList(); waitingCommands.clear()
                                    commands.forEach { executeJs(it) }
                                }
                            }
                            publishLibrary()
                            restoreFailure?.let { fail(it) }
                        }
                        "create" -> {
                            flush(); val file=File(notes,"note-${UUID.randomUUID()}.md")
                            DocumentSession.atomicWrite(file,byteArrayOf()); session=DocumentSession(file); display(session!!,true)
                        }
                        "open" -> {
                            val filename=event.getString("filename")
                            require(filename.matches(Regex("[a-zA-Z0-9.-]+\\.md"))) { "无效的文件名" }
                            flush(); session=DocumentSession(File(notes,filename)); display(session!!)
                        }
                        "home" -> {
                            flush(); publishLibrary()
                            main.post { inEditor=false; activeFilename=null; js("showHome()") }
                        }
                        "retry-save" -> {
                            flush()
                        }
                        "save-copy" -> {
                            val doc = session ?: error("没有可保存的文档")
                            pending?.cancel(false)
                            val copy = File(notes, "note-copy-${UUID.randomUUID()}.md")
                            session = doc.copyTo(copy)
                            display(session!!)
                        }
                        "import" -> {
                            flush()
                            main.post { try { picker.launch(arrayOf("text/*","application/octet-stream")) } catch(e:Exception) { storage.execute { fail(e) } } }
                        }
                        "export" -> {
                            flush()
                            val doc=session ?: error("请先打开需要导出的笔记")
                            val record=exports.prepare(doc.file)
                            val name=title(doc.text).replace(Regex("[\\\\/:*?\"<>|]"),"_")
                            main.post {
                                if(!destroyed) {
                                    pendingExportName=record
                                    try { exporter.launch("$name.md") }
                                    catch(e:Exception) { pendingExportName=null; storage.execute { try { exports.discard(record) } catch(cleanup:Exception) { Log.e("M1racle","Export cleanup failed",cleanup) }; fail(e) } }
                                }
                            }
                        }
                        "share" -> {
                            flush()
                            val doc=session ?: error("请先打开需要分享的笔记")
                            val copy=shares.prepare(doc.file,title(doc.text))
                            val uri=FileProvider.getUriForFile(this@MainActivity,"$packageName.files",copy)
                            main.post {
                                if(!destroyed) try {
                                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                        type="text/markdown"; putExtra(Intent.EXTRA_STREAM,uri)
                                        clipData=ClipData.newRawUri(copy.name,uri)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    },"分享文档"))
                                } catch(e:Exception) { storage.execute { fail(e) } }
                            }
                        }
                        "preferences" -> prefs.edit().putString("preferences",event.getJSONObject("preferences").toString()).apply()
                        "change" -> {
                            val doc=session ?: return@execute
                            if(!doc.change(event.getString("id"),event.getLong("revision"),event.getString("markdown"))) return@execute
                            pending?.cancel(false)
                            pending=storage.schedule({ try { save(doc) } catch(e:Exception) { fail(e) } },550,TimeUnit.MILLISECONDS)
                        }
                        "loaded" -> Log.i("M1racle","baseline $event")
                    }
                } catch(e:Exception) { fail(e) }
            }
        }
    }
    override fun onPause() { super.onPause(); storage.execute { try { flush() } catch(e:Exception) { fail(e) } } }
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("active-note",if(inEditor) activeFilename else if(!editorReady) waitingDisplay?.filename ?: restoredFilename else null)
        outState.putString("pending-export",pendingExportName)
    }
    override fun onDestroy() {
        destroyed=true; waitingCommands.clear(); waitingDisplay=null; web.removeJavascriptInterface("Native"); web.destroy()
        storage.execute { try { flush() } catch(e:Exception) { Log.e("M1racle","Final save failed",e) } }
        storage.shutdown(); super.onDestroy()
    }
}

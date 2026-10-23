package com.m1racle.note

import java.net.URI

/** Validate an external web destination without loading it in the editor. */
object WebLink {
    fun parse(value:String):String {
        require(value.none { it.isISOControl() }) { "链接地址包含无效字符。" }
        val uri=try { URI(value) } catch(e:Exception) { throw IllegalArgumentException("链接地址格式不正确。",e) }
        require(uri.scheme?.lowercase() in setOf("http","https") && !uri.isOpaque) { "仅支持打开 http 或 https 网页链接。" }
        require(uri.toURL().host.isNotBlank()) { "链接缺少网址。" }
        return value
    }
}

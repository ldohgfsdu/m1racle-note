package com.m1racle.note

import java.io.File
import java.util.UUID

/** A durable, raw Markdown copy for one outstanding system export request. */
class PendingExportStore(private val directory: File) {
    fun prepare(source: File): String {
        val name = "export-${UUID.randomUUID()}.md"
        DocumentSession.atomicWrite(target(name), source.readBytes(), expectedAbsent = true)
        return name
    }

    fun read(name: String): ByteArray {
        val file = target(name)
        check(file.isFile) { "待导出的内容已失效，请重新导出" }
        return file.readBytes()
    }

    fun discard(name: String) {
        val file = target(name)
        check(!file.exists() || file.delete()) { "无法清理导出临时文件" }
    }

    private fun target(name: String): File {
        require(validName(name)) { "无效的导出记录" }
        return File(directory, name)
    }

    companion object {
        private val pattern = Regex("export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.md")
        fun validName(name: String): Boolean = pattern.matches(name)
    }
}

package com.m1racle.note

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Immutable raw Markdown files for delayed readers of an Android share URI. */
class ShareCopyStore(private val directory: File, private val clock: () -> Long = System::currentTimeMillis) {
    fun prepare(source: File, title: String): File {
        if (!directory.isDirectory && !directory.mkdirs()) throw IOException("无法准备分享副本")
        removeExpiredCopies()
        val request = File(directory, "share-${UUID.randomUUID()}")
        if (!request.mkdir()) throw IOException("无法创建分享副本")
        val copy = File(request, filename(title))
        try {
            DocumentSession.atomicWrite(copy, source.readBytes(), expectedAbsent = true)
            return copy
        } catch (error: Exception) {
            copy.delete()
            request.delete()
            throw error
        }
    }

    private fun removeExpiredCopies() {
        val cutoff = clock() - TimeUnit.DAYS.toMillis(7)
        directory.listFiles()?.forEach { request ->
            // Never recurse or remove unexpected entries. Only our single-file UUID requests expire.
            if (!request.name.matches(requestPattern) || !request.isDirectory || Files.isSymbolicLink(request.toPath()) || request.lastModified() >= cutoff) return@forEach
            val entries = request.listFiles() ?: return@forEach
            if (entries.size > 1 || entries.any { !it.isFile || it.extension != "md" || Files.isSymbolicLink(it.toPath()) }) return@forEach
            if (entries.all { it.delete() }) request.delete()
        }
    }

    private fun filename(title: String): String {
        val safe = title.replace(Regex("[\\u0000-\\u001f\\u007f\\\\/:*?\"<>|]"), "_")
            .trim { it.isWhitespace() || it == '.' }
        // Reserve room for atomicWrite's temporary suffix and never split an emoji pair.
        return safe.take(64).dropLastWhile { Character.isHighSurrogate(it) }
            .ifBlank { "未命名笔记" } + ".md"
    }

    companion object {
        private val requestPattern = Regex("share-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    }
}

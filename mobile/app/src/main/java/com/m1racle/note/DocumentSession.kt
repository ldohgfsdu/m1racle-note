package com.m1racle.note

import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/** Accessed only on the single storage executor. No AST ever owns content. */
class DocumentSession(val file: File) {
    val id: String = UUID.randomUUID().toString()
    private var original = file.readBytes()
    private val bom = original.take(3) == listOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
    var text: String = decode(original, bom)
        private set
    var revision: Long = 0
        private set
    var dirty: Boolean = false
        private set

    fun change(documentId: String, nextRevision: Long, markdown: String): Boolean {
        if (documentId != id || nextRevision <= revision) return false
        text = markdown; revision = nextRevision
        dirty = !encoded().contentEquals(original)
        return true
    }

    fun save() {
        // No-edit saves never open the file for writing, preserving all bytes.
        if (!dirty) return
        check(file.readBytes().contentEquals(original)) { "文件已在外部改变，已暂停保存" }
        val bytes = encoded()
        atomicWrite(file, bytes, original)
        original = bytes; dirty = false
    }

    /** A separate Markdown file can rescue edits even when the original conflicts. */
    fun copyTo(destination: File): DocumentSession {
        check(!destination.exists()) { "副本文件已存在，请换一个位置" }
        atomicWrite(destination, encoded(), expectedAbsent = true)
        return DocumentSession(destination)
    }

    private fun encoded(): ByteArray = (if (bom) byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) else byteArrayOf()) + text.toByteArray(Charsets.UTF_8)

    companion object {
        private fun decode(bytes: ByteArray, bom: Boolean): String {
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            return decoder.decode(ByteBuffer.wrap(if (bom) bytes.copyOfRange(3, bytes.size) else bytes)).toString()
        }
        fun atomicWrite(file: File, bytes: ByteArray, expectedOriginal: ByteArray? = null, expectedAbsent: Boolean = false) {
            file.parentFile?.mkdirs()
            val temp = File.createTempFile(".${file.name}.", ".tmp", file.parentFile)
            try {
                FileOutputStream(temp).use { it.write(bytes); it.fd.sync() }
                // The target may have changed while the temporary file was written and flushed.
                if (expectedOriginal != null) {
                    check(file.readBytes().contentEquals(expectedOriginal)) { "保存期间文件发生外部更改，已暂停保存" }
                }
                if (expectedAbsent) {
                    check(!file.exists()) { "副本位置已被占用，请重新保存副本" }
                }
                // Fail visibly if the filesystem cannot atomically replace; never truncate.
                Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } finally { temp.delete() }
        }
    }
}

package com.m1racle.note

import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ShareCopyStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun delayedReadersKeepTheExactRevisionWithoutChangingTheSource() {
        val bytes = "\uFEFF# 分享原文\r\n\n正文🌱\r尾行  ".toByteArray()
        val source = temporary.newFile("note-internal-id.md").apply { writeBytes(bytes) }
        val modified = source.lastModified()
        val store = ShareCopyStore(temporary.newFolder("shared"))
        val first = store.prepare(source, "分享原文")
        assertEquals("分享原文.md", first.name)
        assertArrayEquals(bytes, first.readBytes())
        assertArrayEquals(bytes, source.readBytes())
        assertEquals(modified, source.lastModified())
        source.writeText("a later revision\n")
        val second = store.prepare(source, "分享原文")
        assertNotEquals(first, second)
        assertArrayEquals(bytes, first.readBytes())
        assertArrayEquals("a later revision\n".toByteArray(), second.readBytes())
        source.delete()
        assertArrayEquals(bytes, first.readBytes())
    }

    @Test fun filenamesStayInsideTheRequestDirectoryAndKeepReadableUnicode() {
        val directory = temporary.newFolder("shared")
        val store = ShareCopyStore(directory)
        val source = temporary.newFile("source.md").apply { writeText("untouched\r\n") }
        val normal = store.prepare(source, "中文与🌱")
        assertEquals("中文与🌱.md", normal.name)
        for (title in listOf("../a\\b:c*?\"<>|\u0000\n", "...  ", "🌱".repeat(200))) {
            val copy = store.prepare(source, title)
            val request = checkNotNull(copy.parentFile)
            assertEquals(directory.canonicalFile, checkNotNull(request.parentFile).canonicalFile)
            assertTrue(request.name.startsWith("share-"))
            assertFalse(copy.name.contains(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]")))
            assertTrue(copy.name.toByteArray().size < 255)
            assertArrayEquals(source.readBytes(), copy.readBytes())
        }
        assertEquals("未命名笔记.md", store.prepare(source, "... ").name)
    }

    @Test fun aLaterRequestRemovesOnlyExpiredOwnedCopies() {
        val directory = temporary.newFolder("shared")
        val source = temporary.newFile("source.md").apply { writeText("keep\r\n") }
        val now = System.currentTimeMillis()
        val store = ShareCopyStore(directory) { now }
        val expired = store.prepare(source, "old")
        val recent = store.prepare(source, "recent")
        val unexpected = store.prepare(source, "unexpected")
        File(unexpected.parentFile, "user-file.txt").writeText("do not delete")
        val outside = File(directory, "other-directory").apply { mkdir() }
        File(outside, "outside.md").writeText("keep outside")
        val oldTime = now - TimeUnit.DAYS.toMillis(8)
        for (folder in listOf(checkNotNull(expired.parentFile), checkNotNull(unexpected.parentFile), outside)) assertTrue(folder.setLastModified(oldTime))
        val next = store.prepare(source, "next")
        assertFalse(checkNotNull(expired.parentFile).exists())
        assertTrue(recent.isFile)
        assertEquals("do not delete", File(unexpected.parentFile, "user-file.txt").readText())
        assertEquals("keep outside", File(outside, "outside.md").readText())
        assertTrue(next.isFile)
        assertEquals("keep\r\n", source.readText())
    }

    @Test fun failedPreparationDoesNotModifyTheSourceOrAnOccupiedDestination() {
        val source = temporary.newFile("source.md").apply { writeText("keep🌱\r\n") }
        val occupied = temporary.newFile("occupied").apply { writeText("not a folder") }
        assertThrows(java.io.IOException::class.java) { ShareCopyStore(occupied).prepare(source, "title") }
        assertEquals("keep🌱\r\n", source.readText())
        assertEquals("not a folder", occupied.readText())
    }
}

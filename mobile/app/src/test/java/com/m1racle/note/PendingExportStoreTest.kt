package com.m1racle.note

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PendingExportStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun aNewOwnerCanReadTheExactExportAfterTheSourceChanges() {
        val original = "\uFEFF# 标题\r\n\n正文🌱\r尾行  ".toByteArray()
        val source = temporary.newFile("source.md").apply { writeBytes(original) }
        val directory = temporary.newFolder("pending")
        val token = PendingExportStore(directory).prepare(source)
        source.writeText("a later document revision\n")
        assertArrayEquals(original, PendingExportStore(directory).read(token))
        assertEquals("a later document revision\n", source.readText())
        PendingExportStore(directory).discard(token)
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun preparingAnExportDoesNotWriteTheSource() {
        val source = temporary.newFile("source.md").apply { writeText("# 原文\r\n\n") }
        val bytes = source.readBytes()
        val modified = source.lastModified()
        val store = PendingExportStore(temporary.newFolder("pending"))
        val token = store.prepare(source)
        assertArrayEquals(bytes, source.readBytes())
        assertEquals(modified, source.lastModified())
        assertArrayEquals(bytes, store.read(token))
    }

    @Test fun requestsHaveSeparateCopiesAndCleanupDoesNotTouchAnotherRequest() {
        val source = temporary.newFile("source.md").apply { writeText("first\r\n") }
        val store = PendingExportStore(temporary.newFolder("pending"))
        val first = store.prepare(source)
        source.writeText("second\n")
        val second = store.prepare(source)
        assertNotEquals(first, second)
        store.discard(first)
        store.discard(first)
        assertArrayEquals("second\n".toByteArray(), store.read(second))
        assertEquals("second\n", source.readText())
    }

    @Test fun invalidReferencesCannotReadOrDeleteOtherFiles() {
        val outside = temporary.newFile("outside.md").apply { writeText("keep me") }
        val store = PendingExportStore(temporary.newFolder("pending"))
        for (name in listOf("../outside.md", outside.absolutePath, "export-note.md", "source.md", "")) {
            assertThrows(IllegalArgumentException::class.java) { store.read(name) }
            assertThrows(IllegalArgumentException::class.java) { store.discard(name) }
        }
        assertEquals("keep me", outside.readText())
    }

    @Test fun failedPreparationDoesNotChangeTheSourceAndMissingRecordsFailClearly() {
        val source = temporary.newFile("source.md").apply { writeText("keep\r\n") }
        val occupied = temporary.newFile("occupied").apply { writeText("not a directory") }
        assertThrows(java.io.IOException::class.java) { PendingExportStore(occupied).prepare(source) }
        assertEquals("keep\r\n", source.readText())
        assertEquals("not a directory", occupied.readText())
        val missing = assertThrows(IllegalStateException::class.java) {
            PendingExportStore(temporary.newFolder("empty")).read("export-12345678-1234-1234-1234-123456789abc.md")
        }
        assertTrue(missing.message!!.contains("重新导出"))
    }
}

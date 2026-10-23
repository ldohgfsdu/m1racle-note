package com.m1racle.note

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class DocumentSessionTest {
    private fun file(bytes: ByteArray) = Files.createTempDirectory("m1racle-test").resolve("note.md").toFile().apply { writeBytes(bytes); deleteOnExit(); parentFile?.deleteOnExit() }
    @Test fun noEditRetainsBomMixedNewlinesAndWhitespace() {
        val bytes = byteArrayOf(0xEF.toByte(),0xBB.toByte(),0xBF.toByte()) + "# 标题\r\n\n<!-- keep -->\r尾部  ".toByteArray()
        val f = file(bytes); val session = DocumentSession(f)
        session.save(); assertArrayEquals(bytes, f.readBytes())
    }
    @Test fun editAndUndoKeepOnlyIntentionalChanges() {
        val f = file("old\r\nuntouched  \n".toByteArray()); val session = DocumentSession(f)
        assertTrue(session.change(session.id, 1, "new\r\nuntouched  \n")); session.save()
        assertEquals("new\r\nuntouched  \n", f.readText())
        assertFalse(session.change("stale", 2, "bad")); assertFalse(session.change(session.id, 1, "bad"))
    }
    @Test fun externalChangeDoesNotGetOverwritten() {
        val f = file("old".toByteArray()); val session = DocumentSession(f)
        session.change(session.id, 1, "edited"); f.writeText("external")
        assertThrows(IllegalStateException::class.java) { session.save() }
        assertEquals("external", f.readText()); assertTrue(session.dirty)
    }
    @Test fun invalidUtf8IsRejected() { assertThrows(java.nio.charset.CharacterCodingException::class.java) { DocumentSession(file(byteArrayOf(0xff.toByte()))) } }

    @Test fun atomicReplacementRefusesAStaleExpectedFileAndCleansTemporaryBytes() {
        val original = "original\r\n".toByteArray()
        val f = file(original)
        f.writeText("external\n")
        assertThrows(IllegalStateException::class.java) {
            DocumentSession.atomicWrite(f, "mine\r\n".toByteArray(), original)
        }
        assertEquals("external\n", f.readText())
        assertEquals(listOf("note.md"), f.parentFile!!.list()!!.sorted())
    }

    @Test fun failedSaveKeepsEditsForASeparateCopy() {
        val f = file("original".toByteArray())
        val session = DocumentSession(f)
        session.change(session.id, 1, "mine")
        f.writeText("external")
        assertThrows(IllegalStateException::class.java) { session.save() }
        assertEquals("mine", session.text)
        assertTrue(session.dirty)
        val copy = f.resolveSibling("copy.md")
        session.copyTo(copy)
        assertEquals("external", f.readText())
        assertEquals("mine", copy.readText())
    }

    @Test fun conflictCopyPreservesBomMixedEndingsAndOriginalBytes() {
        val original = "\uFEFF# 原文\r\n\n尾行\r".toByteArray()
        val f = file(original)
        val session = DocumentSession(f)
        val edited = "# 我的文字\r\n\n尾行\r继续写"
        session.change(session.id, 1, edited)
        f.writeText("external\n")
        assertThrows(IllegalStateException::class.java) { session.save() }
        val copy = f.resolveSibling("copy.md")
        val recovered = session.copyTo(copy)
        assertEquals("external\n", f.readText())
        assertArrayEquals(("\uFEFF" + edited).toByteArray(), copy.readBytes())
        assertEquals(edited, recovered.text)
        assertFalse(recovered.dirty)
        assertNotEquals(session.id, recovered.id)
    }

    @Test fun recoveryCopyRefusesAnExistingDestinationAndRetainsEdits() {
        val f = file("original".toByteArray())
        val session = DocumentSession(f)
        session.change(session.id, 1, "mine")
        val copy = f.resolveSibling("copy.md").apply { writeText("other document") }
        assertThrows(IllegalStateException::class.java) { session.copyTo(copy) }
        assertEquals("other document", copy.readText())
        assertEquals("original", f.readText())
        assertEquals("mine", session.text)
        assertTrue(session.dirty)
    }

    @Test fun recoveryCopyFailureRetainsCurrentFileAndText() {
        val f = file("original".toByteArray())
        val session = DocumentSession(f)
        session.change(session.id, 1, "mine")
        val notDirectory = f.resolveSibling("not-directory").apply { writeText("keep") }
        assertThrows(java.io.IOException::class.java) { session.copyTo(notDirectory.resolve("copy.md")) }
        assertEquals("original", f.readText())
        assertEquals("mine", session.text)
        assertTrue(session.dirty)
        assertEquals(listOf("note.md", "not-directory").sorted(), f.parentFile!!.list()!!.sorted())
    }

    @Test fun atomicNewCopyRefusesAnOccupiedTargetAndCleansTemporaryBytes() {
        val f = file("other document".toByteArray())
        assertThrows(IllegalStateException::class.java) {
            DocumentSession.atomicWrite(f, "mine".toByteArray(), expectedAbsent = true)
        }
        assertEquals("other document", f.readText())
        assertEquals(listOf("note.md"), f.parentFile!!.list()!!.sorted())
    }
}

package com.m1racle.note

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WebLinkTest {
    @Test fun keepsWebDestinationsWithoutConnectingOrRewriting() {
        for(url in listOf("https://example.com/a?b=c#d","http://localhost:8000/","https://例子.测试/记录","https://example.com/a%20b","http://[::1]/")) assertEquals(url,WebLink.parse(url))
    }
    @Test fun rejectsNonWebSchemesAndMissingHosts() {
        for(url in listOf("javascript:alert(1)","data:text/html,x","file:///sdcard/a.md","mailto:user@example.com","../a.md","https:///a","https:")) assertThrows(IllegalArgumentException::class.java) { WebLink.parse(url) }
    }
    @Test fun rejectsBrokenDestinationsAndControlCharacters() {
        for(url in listOf("https://example.com/a b","https://example.com/\nnext","https://example.com/\rnext","https://example.com/\tnext")) assertThrows(IllegalArgumentException::class.java) { WebLink.parse(url) }
    }
}

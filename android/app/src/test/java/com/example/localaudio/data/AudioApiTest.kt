package com.example.localaudio.data

import java.io.IOException
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class AudioApiTest {
    @Test fun mediaUrlEncodesTheExactRemotePath() {
        val path = "专辑 一/01 #&?.m4a"
        val url = AudioEndpoint.mediaUrl(path).toHttpUrl()
        assertEquals("192.168.1.2", url.host)
        assertEquals(80, url.port)
        assertEquals("/api/file", url.encodedPath)
        assertEquals(path, url.queryParameter("path"))
        assertNull(url.fragment)
    }

    @Test fun invalidPathsAreRejected() {
        listOf("", "/etc/passwd", "../a.mp3", "album/../a.mp3", "a\\b", "a\u0000b", "./a").forEach {
            assertFalse(it, AudioEndpoint.validPath(it))
        }
    }

    @Test fun paginationUsesServerItemCountAndDeduplicates() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[{"path":"01.m4a","name":"01.m4a","kind":"audio"},{"path":"01.m4a","name":"01.m4a","kind":"audio"}],"has_more":true}"""))
            server.enqueue(MockResponse().setBody("""{"items":[{"path":"02.m4a","name":"02.m4a","kind":"audio"}],"has_more":false}"""))
            val tracks = AudioApi(server.url("/").toString()).load()
            assertEquals(listOf("01.m4a", "02.m4a"), tracks.map { it.path })
            val first = server.takeRequest().requestUrl!!
            assertEquals("audio", first.queryParameter("kind"))
            assertEquals("0", first.queryParameter("offset"))
            assertEquals("2", server.takeRequest().requestUrl!!.queryParameter("offset"))
        }
    }

    @Test fun emptyUnfinishedPageFailsInsteadOfLooping() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[],"has_more":true}"""))
            assertThrows(IOException::class.java) { AudioApi(server.url("/").toString()).load() }
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun serverFailureIsNotAnEmptyLibrary() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503))
            val error = assertThrows(IOException::class.java) { AudioApi(server.url("/").toString()).load() }
            assertTrue(error.message!!.contains("503"))
        }
    }
}

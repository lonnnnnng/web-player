package com.example.localaudio.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun normalizesHostPortAndReverseProxyPath() {
        assertEquals(AudioEndpoint.BASE_URL, ServerAddress.normalize(" 192.168.1.2 "))
        assertEquals("https://audio.example.com:8443/player/", ServerAddress.normalize("https://AUDIO.example.com:8443/player"))
        assertEquals("http://[::1]:8080/", ServerAddress.normalize("[::1]:8080"))
    }

    @Test fun rejectsUnsupportedAndAmbiguousAddresses() {
        listOf("", "  ", "ftp://host", "file:///tmp/audio", "http://", "http://host:99999", "host/path?x=1",
            "host/#fragment", "http://user:password@host", "host/white space", "host\\path", "host/\npath").forEach { address ->
            assertThrows(address, IllegalArgumentException::class.java) { ServerAddress.normalize(address) }
        }
    }

    @Test fun defaultStoreRemainsCompatibleAndServersAreIsolated() {
        assertEquals("audio-playback", ServerAddress.historyNamespace("192.168.1.2"))
        assertEquals(ServerAddress.historyNamespace("HOST:80/player"), ServerAddress.historyNamespace("http://host/player/"))
        assertNotEquals(ServerAddress.historyNamespace("host/player"), ServerAddress.historyNamespace("host/other"))
        assertNotEquals(ServerAddress.historyNamespace("host"), ServerAddress.historyNamespace("host:8080"))
    }

    @Test fun mediaUrlKeepsConfiguredSubpathAndEscapesFilename() {
        val path = "专辑/01 #&.m4a"
        val url = AudioEndpoint.mediaUrl(path, "https://audio.example.com/proxy/player").toHttpUrl()
        assertEquals("audio.example.com", url.host)
        assertEquals("/proxy/player/api/file", url.encodedPath)
        assertEquals(path, url.queryParameter("path"))
    }
}

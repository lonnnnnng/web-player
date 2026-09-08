package com.example.localaudio.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class TimeFormatTest {
    @Test fun longAudioHasUnambiguousHours() {
        assertEquals("0:00", formatTime(-1))
        assertEquals("2:05", formatTime(125000))
        assertEquals("1:02:03", formatTime(3723000))
    }
}

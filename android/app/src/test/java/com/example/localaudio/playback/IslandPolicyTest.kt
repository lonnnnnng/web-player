package com.example.localaudio.playback

import org.junit.Assert.*
import org.junit.Test

class IslandPolicyTest {
    @Test fun visibleOnlyForOptedInUnlockedBackgroundPlayback() {
        assertTrue(IslandPolicy.visible(true, true, false, true, false, true))
    }

    @Test fun hidesWhenDisabledOrPermissionRevoked() {
        assertFalse(IslandPolicy.visible(false, true, false, true, false, true))
        assertFalse(IslandPolicy.visible(true, false, false, true, false, true))
    }

    @Test fun hidesInAppAndOnLockScreenWithoutChangingAudio() {
        assertFalse(IslandPolicy.visible(true, true, true, true, false, true))
        assertFalse(IslandPolicy.visible(true, true, false, true, true, true))
        assertFalse(IslandPolicy.visible(true, true, false, false, false, true))
    }

    @Test fun emptyQueueNeverCreatesAnOverlay() {
        assertFalse(IslandPolicy.visible(true, true, false, true, false, false))
    }
}

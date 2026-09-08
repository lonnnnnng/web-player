package com.example.localaudio.playback

import android.app.Application
import android.app.KeyguardManager
import android.os.Looper
import android.os.PowerManager
import androidx.lifecycle.Lifecycle
import com.example.localaudio.data.AudioTrack
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSettings

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PlaybackIslandTest {
    @Test fun overlayLifecycleDoesNotPauseOrRestartPlayer() {
        val context = RuntimeEnvironment.getApplication()
        val settings = IslandSettings(context)
        val player = StoredPlayer().apply { items = listOf(AudioTrack("01.m4a", "01.m4a").toMediaItem()) }
        ShadowSettings.setCanDrawOverlays(true)
        shadowOf(context.getSystemService(PowerManager::class.java)).setIsInteractive(true)
        val keyguard = shadowOf(context.getSystemService(KeyguardManager::class.java))
        keyguard.setKeyguardLocked(false)
        settings.setEnabled(true)
        val island = PlaybackIsland(context, player.player, settings)
        try {
            island.start()
            shadowOf(Looper.getMainLooper()).idle()
            assertNull(settings.error.value)
            assertEquals(Lifecycle.State.RESUMED, island.lifecycle.currentState)
            settings.setForeground(true)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(Lifecycle.State.CREATED, island.lifecycle.currentState)
            settings.setForeground(false)
            keyguard.setKeyguardLocked(true)
            island.sync()
            assertEquals(Lifecycle.State.CREATED, island.lifecycle.currentState)
            keyguard.setKeyguardLocked(false)
            island.sync()
            assertEquals(Lifecycle.State.RESUMED, island.lifecycle.currentState)
            ShadowSettings.setCanDrawOverlays(false)
            island.sync()
            assertFalse(settings.enabled.value)
            assertEquals(Lifecycle.State.CREATED, island.lifecycle.currentState)
            assertFalse(player.playRequested)
        } finally { island.close() }
        assertEquals(Lifecycle.State.DESTROYED, island.lifecycle.currentState)
    }
}

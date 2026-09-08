package com.example.localaudio.playback

import android.app.Application
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.ServerSettings
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PlaybackStoreTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test fun persistsQueueProgressAndSpeedAcrossStoreInstances() {
        val source = StoredPlayer().apply {
            items = listOf(AudioTrack("01.m4a", "01.m4a"), AudioTrack("02.m4a", "02.m4a")).map { it.toMediaItem() }
            index = 1; position = 45678; speed = 1.75f; status = Player.STATE_READY
        }
        PlaybackStore(context).save(source.player)
        val restored = StoredPlayer()
        PlaybackStore(context).restore(restored.player)
        assertEquals(listOf("01.m4a", "02.m4a"), restored.items.map { it.mediaId })
        assertEquals(1, restored.index)
        assertEquals(45678, restored.position)
        assertEquals(1.75f, restored.speed)
        assertFalse(restored.playRequested)
    }

    @Test fun completedTrackRestoresAtBeginningWithoutAutoplay() {
        val source = StoredPlayer().apply {
            items = listOf(AudioTrack("01.m4a", "01.m4a").toMediaItem())
            position = 120000; status = Player.STATE_ENDED
        }
        PlaybackStore(context).save(source.player)
        assertTrue(PlaybackStore(context).history().single().completed)
        val restored = StoredPlayer()
        val store = PlaybackStore(context)
        store.restore(restored.player)
        store.save(restored.player)
        assertEquals(0, restored.position)
        assertTrue(store.history().single().completed)
        assertFalse(restored.playRequested)
    }

    @Test fun unopenedQueueIsNotAPlayHistoryEntry() {
        val source = StoredPlayer().apply { items = listOf(AudioTrack("01.m4a", "01.m4a").toMediaItem()) }
        val store = PlaybackStore(context)
        store.save(source.player)
        assertTrue(store.history().isEmpty())
    }

    @Test fun serversNeverShareProgressEvenWithIdenticalPaths() {
        val source = StoredPlayer().apply {
            items = listOf(AudioTrack("01.m4a", "01.m4a").toMediaItem())
            position = 30000; status = Player.STATE_READY
        }
        PlaybackStore(context).save(source.player)
        val other = "http://192.168.1.3/"
        val otherStore = PlaybackStore(context, other)
        otherStore.save(source.player)
        assertTrue(otherStore.history().isEmpty())
        source.items = listOf(AudioTrack("01.m4a", "01.m4a").toMediaItem(other))
        source.position = 60000
        otherStore.save(source.player)
        val first = StoredPlayer()
        PlaybackStore(context).restore(first.player)
        assertEquals(30000, first.position)
        assertEquals(AudioEndpoint.mediaUrl("01.m4a"), first.items.single().localConfiguration?.uri.toString())
        val second = StoredPlayer()
        PlaybackStore(context, other).restore(second.player)
        assertEquals(60000, second.position)
        assertEquals(AudioEndpoint.mediaUrl("01.m4a", other), second.items.single().localConfiguration?.uri.toString())
    }

    @Test fun settingsAndIslandPreferencesPersistButForegroundDoesNot() {
        ServerSettings(context).update("192.168.1.3:8080/audio")
        assertEquals("http://192.168.1.3:8080/audio/", ServerSettings(context).address.value)
        IslandSettings(context).apply { setEnabled(true); setOffset(500); setForeground(true) }
        val restored = IslandSettings(context)
        assertTrue(restored.enabled.value)
        assertEquals(120, restored.offset.value)
        assertFalse(restored.foreground.value)
        restored.reportFailure()
        assertFalse(restored.enabled.value)
        assertNotNull(restored.error.value)
    }
}

internal class StoredPlayer {
    var items = emptyList<MediaItem>()
    var index = 0
    var position = 0L
    var speed = 1f
    var status = Player.STATE_IDLE
    var playRequested = false
    val player: Player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
        when (method.name) {
            "getMediaItemCount" -> items.size
            "getCurrentMediaItem" -> items.getOrNull(index)
            "getMediaItemAt" -> items[args!![0] as Int]
            "getCurrentMediaItemIndex" -> index
            "getCurrentPosition" -> position
            "getDuration" -> 120000L
            "getPlaybackParameters" -> PlaybackParameters(speed)
            "getPlaybackState" -> status
            "isPlaying" -> false
            "getPlayWhenReady", "hasPreviousMediaItem", "hasNextMediaItem" -> false
            "getPlayerError" -> null
            "setPlaybackSpeed" -> { speed = args!![0] as Float; null }
            "setMediaItems" -> {
                @Suppress("UNCHECKED_CAST")
                items = args!![0] as List<MediaItem>
                index = args[1] as Int
                position = args[2] as Long
                null
            }
            "play" -> { playRequested = true; null }
            else -> error("Unexpected Player call: ${method.name}")
        }
    } as Player
}

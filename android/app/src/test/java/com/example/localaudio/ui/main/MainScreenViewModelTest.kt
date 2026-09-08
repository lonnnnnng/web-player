package com.example.localaudio.ui.main

import com.example.localaudio.data.DataRepository
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.data.ServerAddress
import com.example.localaudio.data.ServerConfig
import com.example.localaudio.playback.PlaybackControls
import com.example.localaudio.playback.PlaybackState
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainScreenViewModelTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test fun loadAndSelectPreservesCompleteQueue() {
        val repository = FakeRepository()
        val controls = FakeControls()
        val model = MainScreenViewModel(repository, controls, FakeServerConfig())
        assertFalse(model.uiState.value.loading)
        assertEquals(repository.tracks, model.uiState.value.tracks)
        model.select(repository.tracks[1])
        assertEquals(repository.tracks, controls.queue)
        assertEquals(repository.tracks[1], controls.selected)
    }

    @Test fun refreshFailureKeepsQueueAndDoesNotTouchPlayback() {
        val repository = FakeRepository()
        val controls = FakeControls()
        val model = MainScreenViewModel(repository, controls, FakeServerConfig())
        repository.fail = true
        model.refresh()
        assertEquals(repository.tracks, model.uiState.value.tracks)
        assertTrue(model.uiState.value.error!!.contains("offline"))
        assertFalse(model.uiState.value.loading)
        assertEquals(0, controls.toggleCount)
    }

    @Test fun serverChangeNormalizesAndReloadsOnce() {
        val repository = FakeRepository()
        val config = FakeServerConfig()
        val model = MainScreenViewModel(repository, FakeControls(), config)
        model.saveServer("192.168.1.3:8088/audio")
        assertEquals("http://192.168.1.3:8088/audio/", model.uiState.value.serverAddress)
        assertEquals(listOf(AudioEndpoint.BASE_URL, config.address.value), repository.requests)
        model.saveServer(config.address.value)
        assertEquals(2, repository.requests.size)
    }

    @Test fun invalidAddressLeavesCurrentLibraryUntouched() {
        val repository = FakeRepository()
        val model = MainScreenViewModel(repository, FakeControls(), FakeServerConfig())
        assertThrows(IllegalArgumentException::class.java) { model.saveServer("ftp://server/") }
        assertEquals(AudioEndpoint.BASE_URL, model.uiState.value.serverAddress)
        assertEquals(repository.tracks, model.uiState.value.tracks)
        assertEquals(1, repository.requests.size)
    }

    @Test fun oldServerResponseCannotOverwriteNewLibrary() = runTest {
        val oldResult = CompletableDeferred<List<AudioTrack>>()
        val newTracks = listOf(AudioTrack("new.m4a", "new.m4a"))
        val repository = object : DataRepository {
            override suspend fun loadAudio(baseUrl: String): List<AudioTrack> =
                if (baseUrl == AudioEndpoint.BASE_URL) withContext(NonCancellable) { oldResult.await() } else newTracks
        }
        val model = MainScreenViewModel(repository, FakeControls(), FakeServerConfig())
        model.saveServer("192.168.1.3")
        assertEquals(newTracks, model.uiState.value.tracks)
        oldResult.complete(listOf(AudioTrack("old.m4a", "old.m4a")))
        runCurrent()
        assertEquals(newTracks, model.uiState.value.tracks)
        assertEquals("http://192.168.1.3/", model.uiState.value.serverAddress)
    }

    @Test fun failedNewServerDoesNotShowOldServerTracks() {
        val repository = FakeRepository()
        val controls = FakeControls()
        val model = MainScreenViewModel(repository, controls, FakeServerConfig())
        repository.fail = true
        model.saveServer("192.168.1.3")
        assertTrue(model.uiState.value.tracks.isEmpty())
        assertTrue(model.uiState.value.error!!.contains("192.168.1.3"))
        assertFalse(model.uiState.value.loading)
        assertEquals(0, controls.toggleCount)
    }
}

private class FakeServerConfig : ServerConfig {
    override val address = MutableStateFlow(AudioEndpoint.BASE_URL)
    override fun update(address: String) { this.address.value = ServerAddress.normalize(address) }
}

private class FakeRepository : DataRepository {
    val tracks = listOf(AudioTrack("专辑/01.m4a", "01.m4a"), AudioTrack("专辑/02.m4a", "02.m4a"))
    var fail = false
    val requests = mutableListOf<String>()
    override suspend fun loadAudio(baseUrl: String): List<AudioTrack> {
        requests += baseUrl
        if (fail) throw IOException("offline")
        return tracks
    }
}

private class FakeControls : PlaybackControls {
    override val state = MutableStateFlow(PlaybackState(connected = true, playing = true))
    var queue: List<AudioTrack> = emptyList()
    var selected: AudioTrack? = null
    var toggleCount = 0
    override fun connect() = Unit
    override fun play(tracks: List<AudioTrack>, selected: AudioTrack) { queue = tracks; this.selected = selected }
    override fun toggle() { toggleCount++ }
    override fun seek(position: Long) = Unit
    override fun previous() = Unit
    override fun next() = Unit
    override fun retry() = Unit
    override fun setSpeed(speed: Float) = Unit
    override fun close() = Unit
}

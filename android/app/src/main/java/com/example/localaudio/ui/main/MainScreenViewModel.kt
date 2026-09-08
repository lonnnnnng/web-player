package com.example.localaudio.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.localaudio.data.DataRepository
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.ServerConfig
import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.playback.PlaybackControls
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class MainScreenUiState(val loading: Boolean = true, val tracks: List<AudioTrack> = emptyList(), val error: String? = null,
    val serverAddress: String = AudioEndpoint.BASE_URL)

@HiltViewModel
class MainScreenViewModel @Inject constructor(private val repository: DataRepository, val controls: PlaybackControls,
    private val settings: ServerConfig) : ViewModel() {
    private val mutableState = MutableStateFlow(MainScreenUiState())
    val uiState = mutableState.asStateFlow()
    val playback = controls.state
    private var loadingJob: Job? = null
    private var requestId = 0

    init {
        viewModelScope.launch {
            settings.address.collect { address ->
                mutableState.value = MainScreenUiState(serverAddress = address)
                refresh()
            }
        }
    }

    fun saveServer(address: String) { settings.update(address) }

    fun refresh() {
        loadingJob?.cancel()
        val request = ++requestId
        val address = settings.address.value
        loadingJob = viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, error = null)
            try {
                val tracks = repository.loadAudio(address)
                // long: 旧请求即使不响应取消，也不能把切换服务后的音频库覆盖回去。
                if (request == requestId && address == settings.address.value) {
                    mutableState.value = MainScreenUiState(false, tracks, serverAddress = address)
                }
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if (request != requestId || address != settings.address.value) return@launch
                // long: 刷新失败时保留已有队列，不因列表网络故障中断服务里正在播放的音频。
                mutableState.value = mutableState.value.copy(loading = false,
                    error = "无法读取 $address 的音频。${error.message.orEmpty()}")
            }
        }
    }

    fun select(track: AudioTrack) = controls.play(uiState.value.tracks, track)
    override fun onCleared() { controls.close(); super.onCleared() }
}

package com.example.localaudio.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.ServerConfig
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PlaybackState(
    val connected: Boolean = false, val path: String = "", val title: String = "尚未选择音频",
    val directory: String = "", val playing: Boolean = false, val playWhenReady: Boolean = false,
    val buffering: Boolean = false, val position: Long = 0, val duration: Long = 0,
    val hasPrevious: Boolean = false, val hasNext: Boolean = false, val error: String? = null,
    val speed: Float = 1f, val history: List<HistoryEntry> = emptyList(),
)

interface PlaybackControls {
    val state: StateFlow<PlaybackState>
    fun connect()
    fun play(tracks: List<AudioTrack>, selected: AudioTrack)
    fun toggle()
    fun seek(position: Long)
    fun previous()
    fun next()
    fun retry()
    fun setSpeed(speed: Float)
    fun close()
}

@UnstableApi
class PlaybackConnection @Inject constructor(@param:ApplicationContext private val context: Context, private val settings: ServerConfig) : PlaybackControls {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(PlaybackState())
    override val state = mutableState.asStateFlow()
    private var controller: MediaController? = null
    private var future: ListenableFuture<MediaController>? = null
    private var store = PlaybackStore(context, settings.address.value)
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = update()
    }

    init {
        connect()
        scope.launch { settings.address.collect { store = PlaybackStore(context, it); update() } }
        scope.launch { while (true) { update(); delay(1000) } }
    }

    override fun connect() {
        if (future != null) return
        val pending = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    this@PlaybackConnection.controller = null
                    future = null
                    mutableState.value = mutableState.value.copy(connected = false, playing = false, error = "播放服务已断开，请重连")
                }
            }).buildAsync()
        future = pending
        pending.addListener({
            if (future !== pending) return@addListener
            try {
                controller = pending.get().also { it.addListener(listener) }
                update()
            } catch (_: Exception) {
                future = null
                mutableState.value = PlaybackState(error = "播放服务连接失败，请重连")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    override fun play(tracks: List<AudioTrack>, selected: AudioTrack) {
        val player = controller ?: return
        val server = settings.address.value
        store = PlaybackStore(context, server)
        if (player.currentMediaItem?.mediaId == selected.path && player.currentMediaItem?.mediaMetadata?.extras?.getString(MEDIA_SERVER) == server) {
            if (!player.playWhenReady || player.playbackState == Player.STATE_ENDED) {
                if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
                if (player.playbackState == Player.STATE_IDLE) player.prepare()
                player.play()
            }
            return
        }
        val position = store.history().find { it.track.path == selected.path }?.resumePosition ?: 0
        val queue = tracks.takeIf { it.any { track -> track.path == selected.path } } ?: listOf(selected)
        player.setMediaItems(queue.map { it.toMediaItem(server) }, queue.indexOfFirst { it.path == selected.path }, position)
        player.prepare()
        player.play()
    }

    override fun toggle() {
        val player = controller ?: return
        if (player.playbackState == Player.STATE_ENDED) { player.seekToDefaultPosition(); player.play() }
        else if (player.playWhenReady) player.pause()
        else if (player.mediaItemCount > 0) {
            if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
            if (player.playbackState == Player.STATE_IDLE) player.prepare()
            player.play()
        }
    }
    override fun seek(position: Long) { controller?.seekTo(position.coerceAtLeast(0)) }
    override fun previous() { controller?.seekToPreviousMediaItem() }
    override fun next() { controller?.seekToNextMediaItem() }
    override fun retry() { controller?.let { it.prepare(); it.play() } ?: connect() }
    override fun setSpeed(speed: Float) { controller?.setPlaybackSpeed(normalizedSpeed(speed)) }

    override fun close() {
        scope.cancel()
        controller?.removeListener(listener)
        // long: 页面只释放控制器，绝不释放服务里的播放器，返回桌面或重建页面不会中断声音。
        future?.let { MediaController.releaseFuture(it) }
        future = null
        controller = null
    }

    private fun update() {
        val p = controller ?: run {
            mutableState.value = mutableState.value.copy(history = store.history())
            return
        }
        val item = p.currentMediaItem
        if (item != null && item.mediaMetadata.extras?.getString(MEDIA_SERVER) != settings.address.value) {
            mutableState.value = PlaybackState(history = store.history())
            return
        }
        mutableState.value = PlaybackState(true, item?.mediaId.orEmpty(), item?.mediaMetadata?.title?.toString() ?: "尚未选择音频",
            item?.mediaMetadata?.artist?.toString().orEmpty(), p.isPlaying, p.playWhenReady && p.playbackState != Player.STATE_ENDED,
            p.playbackState == Player.STATE_BUFFERING, p.currentPosition.coerceAtLeast(0),
            p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0, p.hasPreviousMediaItem(), p.hasNextMediaItem(),
            p.playerError?.let { if (RetryPolicy.recoverable(it.errorCode)) "网络中断，正在等待重连" else "音频暂时无法播放（${it.errorCode}）" },
            p.playbackParameters.speed, store.history())
    }
}

package com.example.localaudio.playback

import android.app.PendingIntent
import android.content.Intent
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.example.localaudio.MainActivity
import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.ServerConfig
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

internal const val MEDIA_SERVER = "localAudioServer"

fun AudioTrack.toMediaItem(serverUrl: String = AudioEndpoint.BASE_URL): MediaItem = MediaItem.Builder()
    .setMediaId(path).setUri(AudioEndpoint.mediaUrl(path, serverUrl))
    .setMediaMetadata(MediaMetadata.Builder().setTitle(name).setArtist(directory)
        .setExtras(Bundle().apply { putString(MEDIA_SERVER, serverUrl) }).build()).build()

@UnstableApi
@AndroidEntryPoint
class PlaybackService : MediaSessionService() {
    @Inject lateinit var settings: ServerConfig
    @Inject lateinit var islandSettings: IslandSettings
    private var island: PlaybackIsland? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var serverUrl = AudioEndpoint.BASE_URL
    private var switchingServer = false
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var store: PlaybackStore
    private val handler = Handler(Looper.getMainLooper())
    private var retryAttempt = 0
    private var samples = 0
    private var networkRegistered = false
    private var destroyed = false
    private val retry = Runnable {
        // long: 只恢复仍有播放意图的网络故障；用户暂停、来电或换曲后不得被重试强行播放。
        if (!destroyed && player.playWhenReady && player.playerError != null) player.prepare()
    }
    private val checkpoint = object : Runnable {
        override fun run() {
            store.save(player)
            if (++samples % 6 == 0 && player.playWhenReady) {
                Log.i("LocalAudioPlayback", "playing=${player.isPlaying} state=${player.playbackState} positionMs=${player.currentPosition} bufferedMs=${player.bufferedPosition}")
            }
            handler.postDelayed(this, 5000)
        }
    }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post {
                // long: 注销前已在途的网络回调可能晚于销毁到达，不得再访问释放的播放器。
                if (destroyed) return@post
                if (player.playWhenReady && player.playerError != null && recoverable(player.playerError!!)) {
                    handler.removeCallbacks(retry)
                    handler.post(retry)
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        serverUrl = settings.address.value
        store = PlaybackStore(this, serverUrl)
        val http = DefaultHttpDataSource.Factory().setUserAgent("LocalAudio/0.2.0")
            .setConnectTimeoutMs(15000).setReadTimeoutMs(30000)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http)
                .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6)))
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(60000, 180000, 1500, 3000)
                .setPrioritizeTimeOverSizeThresholds(true).build())
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            // long: 由 ExoPlayer 随播放/暂停管理 CPU 与 Wi-Fi 锁，不持有永久锁或亮屏锁。
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(10000)
            .build()
        store.restore(player)
        player.addListener(object : Player.Listener {
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                if (!switchingServer) store.recordPrevious(oldPosition, reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION)
            }

            override fun onEvents(player: Player, events: Player.Events) {
                if (switchingServer) return
                if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) || events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED)) {
                    handler.removeCallbacks(retry)
                    retryAttempt = 0
                }
                // long: 拖动、暂停、切歌和倍速改变立即落盘；连续播放仍由五秒检查点补充。
                store.save(player)
                island?.sync()
                if (player.isPlaying) retryAttempt = 0
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w("LocalAudioPlayback", "error=${error.errorCode} positionMs=${player.currentPosition}")
                if (player.playWhenReady && recoverable(error)) {
                    handler.removeCallbacks(retry)
                    handler.postDelayed(retry, RetryPolicy.delayMs(retryAttempt++))
                }
                store.save(player)
            }
        })
        val activity = PendingIntent.getActivity(this, 0, MainActivity.detailsIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        session = MediaSession.Builder(this, player).setSessionActivity(activity)
            .setCallback(object : MediaSession.Callback {
                override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
                    mediaItems: List<MediaItem>): ListenableFuture<List<MediaItem>> {
                    switchServer(settings.address.value)
                    // long: 系统控制器可以选曲，但不得让导出的服务代播任意外部地址。
                    if (mediaItems.any { !AudioEndpoint.validPath(it.mediaId) ||
                            it.mediaMetadata.extras?.getString(MEDIA_SERVER)?.let { origin -> origin != serverUrl } == true }) {
                        return Futures.immediateFailedFuture(IllegalArgumentException("无效音频路径"))
                    }
                    return Futures.immediateFuture(mediaItems.map {
                        it.buildUpon().setUri(AudioEndpoint.mediaUrl(it.mediaId, serverUrl))
                            .setMediaMetadata(it.mediaMetadata.buildUpon()
                                .setExtras(Bundle().apply { putString(MEDIA_SERVER, serverUrl) }).build()).build()
                    })
                }
            }).build()
        serviceScope.launch {
            settings.address.collect { address -> switchServer(address) }
        }
        try {
            island = PlaybackIsland(this, player, islandSettings).also { it.start() }
        } catch (_: RuntimeException) { island?.close(); island = null; islandSettings.reportFailure() }
        handler.postDelayed(checkpoint, 5000)
        try {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
            networkRegistered = true
        } catch (error: RuntimeException) {
            Log.w("LocalAudioPlayback", "Network callback unavailable", error)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        if (controllerInfo.packageName == packageName || controllerInfo.isTrusted) session else null

    private fun switchServer(address: String) {
        if (address == serverUrl) return
        // long: 地址变更与选曲命令共用同一个主线程切换入口，避免控制器抢先把旧队列写入新历史。
        switchingServer = true
        try {
            store.save(player)
            handler.removeCallbacks(retry)
            retryAttempt = 0
            player.pause()
            player.stop()
            player.clearMediaItems()
            serverUrl = address
            store = PlaybackStore(this, address)
            store.restore(player)
        } finally { switchingServer = false }
        island?.sync()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        island?.configurationChanged()
    }

    // long: 保留 Media3 默认的任务移除行为：正在播放时划掉页面也不会销毁前台播放服务。
    override fun onDestroy() {
        destroyed = true
        island?.close()
        island = null
        serviceScope.cancel()
        handler.removeCallbacksAndMessages(null)
        if (networkRegistered) getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback)
        store.save(player)
        session?.release()
        player.release()
        session = null
        super.onDestroy()
    }

    private fun recoverable(error: PlaybackException): Boolean {
        val response = generateSequence(error as Throwable) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()
        return RetryPolicy.recoverable(error.errorCode, response?.responseCode)
    }
}

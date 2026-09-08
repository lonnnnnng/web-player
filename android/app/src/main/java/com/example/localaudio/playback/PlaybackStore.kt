package com.example.localaudio.playback

import android.content.Context
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.data.ServerAddress
import org.json.JSONArray
import org.json.JSONObject

class PlaybackStore(context: Context, private val serverUrl: String = AudioEndpoint.BASE_URL) {
    private val preferences = context.getSharedPreferences(ServerAddress.historyNamespace(serverUrl), Context.MODE_PRIVATE)
    private var cachedRaw: String? = null
    private var cachedHistory = emptyList<HistoryEntry>()

    fun history(): List<HistoryEntry> {
        val raw = preferences.getString("history", "[]").orEmpty()
        if (raw != cachedRaw) { cachedRaw = raw; cachedHistory = HistoryCodec.decode(raw) }
        return cachedHistory
    }

    private fun record(track: AudioTrack, position: Long, duration: Long, completed: Boolean = false) {
        val entries = history()
        val previous = entries.find { it.track.path == track.path }
        val knownDuration = duration.takeIf { it > 0 } ?: previous?.duration ?: 0
        if (previous?.position == position && previous.duration == knownDuration && previous.completed == completed) return
        val entry = HistoryEntry(track, position.coerceAtLeast(0), knownDuration, System.currentTimeMillis(), completed)
        preferences.edit().putString("history", HistoryCodec.encode(HistoryCodec.upsert(entries, entry))).apply()
    }

    @androidx.annotation.OptIn(UnstableApi::class)
    fun recordPrevious(position: Player.PositionInfo, completed: Boolean) {
        val item = position.mediaItem ?: return
        if (item.mediaMetadata.extras?.getString(MEDIA_SERVER) != serverUrl) return
        if (!AudioEndpoint.validPath(item.mediaId) || position.positionMs <= 0) return
        // long: 切歌回调保留上一首的精确位置，不能用切换后播放器的新位置覆盖它。
        record(AudioTrack(item.mediaId, item.mediaMetadata.title?.toString() ?: item.mediaId.substringAfterLast('/')),
            position.positionMs, if (completed) position.positionMs else 0, completed)
    }

    fun save(player: Player) {
        preferences.edit().putFloat("speed", normalizedSpeed(player.playbackParameters.speed)).apply()
        if (player.mediaItemCount == 0) return
        if (player.currentMediaItem?.mediaMetadata?.extras?.getString(MEDIA_SERVER) != serverUrl) return
        player.currentMediaItem?.let { item ->
            if (player.playbackState != Player.STATE_IDLE && (player.isPlaying || player.currentPosition > 0 || history().any { it.track.path == item.mediaId })) {
                record(AudioTrack(item.mediaId, item.mediaMetadata.title?.toString() ?: item.mediaId.substringAfterLast('/')),
                    player.currentPosition, player.duration, player.playbackState == Player.STATE_ENDED)
            }
        }
        val queue = JSONArray()
        for (i in 0 until player.mediaItemCount) {
            val item = player.getMediaItemAt(i)
            queue.put(JSONObject().put("path", item.mediaId).put("name", item.mediaMetadata.title.toString()))
        }
        preferences.edit().putString("queue", queue.toString())
            .putInt("index", player.currentMediaItemIndex.coerceAtLeast(0))
            .putLong("position", player.currentPosition.coerceAtLeast(0)).apply()
    }

    fun restore(player: Player) {
        player.setPlaybackSpeed(normalizedSpeed(preferences.getFloat("speed", 1f)))
        try {
            val saved = JSONArray(preferences.getString("queue", "[]"))
            val items = (0 until saved.length()).map { saved.getJSONObject(it) }.map {
                AudioTrack(it.getString("path"), it.getString("name"))
            }
            if (items.isEmpty() || items.any { !AudioEndpoint.validPath(it.path) }) return
            // long: 重新打开只恢复队列和位置，必须由用户点播放，避免启动应用就突然出声。
            val index = preferences.getInt("index", 0).coerceIn(items.indices)
            val position = history().find { it.track.path == items[index].path }?.resumePosition
                ?: preferences.getLong("position", 0).coerceAtLeast(0)
            player.setMediaItems(items.map { it.toMediaItem(serverUrl) }, index, position)
        } catch (_: Exception) {
            // long: 损坏的本地记录不能阻止用户重新选曲，正式音频资源不会被改写。
        }
    }
}

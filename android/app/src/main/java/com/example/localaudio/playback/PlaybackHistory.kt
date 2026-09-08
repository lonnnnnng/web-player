package com.example.localaudio.playback

import com.example.localaudio.data.AudioEndpoint
import com.example.localaudio.data.AudioTrack
import org.json.JSONArray
import org.json.JSONObject

data class HistoryEntry(val track: AudioTrack, val position: Long, val duration: Long,
    val updatedAt: Long, val completed: Boolean = false) {
    val resumePosition: Long get() = if (completed) 0 else position.coerceAtLeast(0).let {
        if (duration > 0) it.coerceAtMost(duration) else it
    }
}

object HistoryCodec {
    const val LIMIT = 100

    fun decode(raw: String): List<HistoryEntry> {
        val array = try { JSONArray(raw) } catch (_: Exception) { return emptyList() }
        return (0 until array.length()).mapNotNull { index ->
            try {
                val item = array.getJSONObject(index)
                val path = item.getString("path")
                if (!AudioEndpoint.validPath(path)) null else HistoryEntry(
                    AudioTrack(path, item.getString("name")), item.optLong("position").coerceAtLeast(0),
                    item.optLong("duration").coerceAtLeast(0), item.optLong("updatedAt").coerceAtLeast(0),
                    item.optBoolean("completed"))
            } catch (_: Exception) { null }
        }.sortedByDescending { it.updatedAt }.distinctBy { it.track.path }.take(LIMIT)
    }

    fun encode(entries: List<HistoryEntry>): String = JSONArray().apply {
        entries.forEach { entry -> put(JSONObject().put("path", entry.track.path).put("name", entry.track.name)
            .put("position", entry.position).put("duration", entry.duration).put("updatedAt", entry.updatedAt)
            .put("completed", entry.completed)) }
    }.toString()

    fun upsert(entries: List<HistoryEntry>, entry: HistoryEntry): List<HistoryEntry> =
        (listOf(entry) + entries.filterNot { it.track.path == entry.track.path }).take(LIMIT)
}

fun normalizedSpeed(speed: Float): Float = if (speed.isFinite()) speed.coerceIn(0.5f, 3f) else 1f

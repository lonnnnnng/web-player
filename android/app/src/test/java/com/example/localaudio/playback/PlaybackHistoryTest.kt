package com.example.localaudio.playback

import com.example.localaudio.data.AudioTrack
import org.junit.Assert.*
import org.junit.Test

class PlaybackHistoryTest {
    private fun entry(path: String = "专辑/01.m4a", position: Long = 30000, duration: Long = 120000,
        updatedAt: Long = 1000, completed: Boolean = false) =
        HistoryEntry(AudioTrack(path, path.substringAfterLast('/')), position, duration, updatedAt, completed)

    @Test fun roundTripPreservesProgressAndCompletion() {
        val entries = listOf(entry(completed = true), entry("02.m4a", updatedAt = 900))
        assertEquals(entries, HistoryCodec.decode(HistoryCodec.encode(entries)))
    }

    @Test fun completedTrackRestartsAndOtherPositionsAreClamped() {
        assertEquals(0, entry(completed = true).resumePosition)
        assertEquals(120000, entry(position = 150000).resumePosition)
        assertEquals(0, entry(position = -1).resumePosition)
        assertEquals(30000, entry(duration = 0).resumePosition)
    }

    @Test fun corruptedEntriesDoNotDiscardHealthyHistory() {
        val raw = """[null,{"path":"../bad","name":"bad"},{"path":"ok.m4a","name":"ok.m4a","position":-10,"duration":-20},{"name":"missing path"}]"""
        assertEquals(listOf(entry("ok.m4a", 0, 0, 0)), HistoryCodec.decode(raw))
        assertTrue(HistoryCodec.decode("not json").isEmpty())
    }

    @Test fun newerDuplicateWinsAndRecentFirstOrderingIsStable() {
        val old = entry(updatedAt = 1)
        val newer = entry(position = 60000, updatedAt = 3)
        val other = entry("02.m4a", updatedAt = 2)
        assertEquals(listOf(newer, other), HistoryCodec.decode(HistoryCodec.encode(listOf(old, other, newer))))
    }

    @Test fun updateMovesTrackToFrontWithoutLosingOtherProgress() {
        val other = entry("02.m4a")
        val changed = entry(position = 70000, updatedAt = 2000)
        assertEquals(listOf(changed, other), HistoryCodec.upsert(listOf(other, entry()), changed))
    }

    @Test fun historyHasBoundedStorage() {
        val entries = (0..150).map { entry("$it.m4a", updatedAt = it.toLong()) }
        assertEquals(HistoryCodec.LIMIT, HistoryCodec.decode(HistoryCodec.encode(entries)).size)
        val updated = HistoryCodec.upsert(entries.take(100), entry("new.m4a"))
        assertEquals(100, updated.size)
        assertEquals("new.m4a", updated.first().track.path)
    }

    @Test fun speedIsFiniteAndWithinSupportedRange() {
        assertEquals(1f, normalizedSpeed(Float.NaN))
        assertEquals(1f, normalizedSpeed(Float.POSITIVE_INFINITY))
        assertEquals(0.5f, normalizedSpeed(-1f))
        assertEquals(3f, normalizedSpeed(10f))
        assertEquals(1.75f, normalizedSpeed(1.75f))
    }
}

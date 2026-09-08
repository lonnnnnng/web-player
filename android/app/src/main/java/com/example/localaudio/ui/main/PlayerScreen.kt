package com.example.localaudio.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.playback.PlaybackState
import com.example.localaudio.playback.HistoryEntry
import com.example.localaudio.playback.IslandSettings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MainScreen(model: MainScreenViewModel, islandSettings: IslandSettings, detailsRequest: Int = 0) {
    val library by model.uiState.collectAsStateWithLifecycle()
    val playback by model.playback.collectAsStateWithLifecycle()
    PlayerScreen(library, playback, model::refresh, model::select, model.controls::toggle,
        model.controls::seek, model.controls::previous, model.controls::next, model.controls::retry, model.controls::setSpeed,
        model::saveServer, islandSettings, detailsRequest)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerScreen(
    library: MainScreenUiState, playback: PlaybackState,
    refresh: () -> Unit, select: (AudioTrack) -> Unit, toggle: () -> Unit,
    seek: (Long) -> Unit, previous: () -> Unit, next: () -> Unit, retry: () -> Unit,
    setSpeed: (Float) -> Unit, saveServer: (String) -> Unit,
    islandSettings: IslandSettings, detailsRequest: Int = 0,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var details by rememberSaveable { mutableStateOf(false) }
    val visible = remember(library.tracks, query) {
        library.tracks.filter { it.path.contains(query, ignoreCase = true) }
    }
    LaunchedEffect(detailsRequest) { if (detailsRequest > 0) details = true }
    LaunchedEffect(library.serverAddress) { query = "" }
    BackHandler(details || selectedTab != 0) { if (details) details = false else selectedTab = 0 }
    if (details) {
        PlaybackDetailScreen(playback, { details = false }, toggle, seek, previous, next, retry, setSpeed)
        return
    }
    val openTrack: (AudioTrack) -> Unit = { track -> select(track); details = true }
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        when (selectedTab) {
            1 -> HistoryPanel(playback.history, playback.connected, openTrack, Modifier.weight(1f))
            2 -> SettingsScreen(library, playback.playWhenReady, saveServer, refresh, islandSettings, Modifier.weight(1f))
            else -> LibraryPanel(library, visible, query, { query = it }, playback, openTrack, refresh, Modifier.weight(1f))
        }
        if (playback.path.isNotBlank() || playback.error != null) {
            MiniPlayer(playback, { details = true }, toggle)
        }
        NavigationBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
            listOf("音频库" to Icons.Rounded.LibraryMusic, "历史" to Icons.Rounded.History, "设置" to Icons.Rounded.Settings)
                .forEachIndexed { index, (label, icon) ->
                    NavigationBarItem(selected = selectedTab == index, onClick = { selectedTab = index },
                        icon = { Icon(icon, null) }, label = { Text(label) })
                }
        }
    }
}

@Composable
private fun LibraryPanel(library: MainScreenUiState, visible: List<AudioTrack>, query: String,
    onQuery: (String) -> Unit, playback: PlaybackState, select: (AudioTrack) -> Unit, refresh: () -> Unit, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    Column(modifier.fillMaxHeight()) {
        OutlinedTextField(query, onQuery, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            label = { Text("搜索音频") }, singleLine = true, shape = RoundedCornerShape(8.dp),
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            trailingIcon = { if (query.isNotEmpty()) ToolButton("清空搜索", Icons.Rounded.Close, onClick = { onQuery("") }) })
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("音频库", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("${visible.size} 首", style = MaterialTheme.typography.labelLarge, color = colors.onSurfaceVariant)
        }
        if (library.loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 20.dp))
        if (library.error != null) {
            Text(library.error, Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = colors.error,
                style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            TextButton(refresh, Modifier.padding(horizontal = 8.dp)) { Text("重新加载") }
        }
        if (!library.loading && visible.isEmpty() && library.error == null) {
            Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(Icons.Rounded.LibraryMusic, null, Modifier.size(48.dp), tint = colors.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                Text(if (query.isBlank()) "暂无音频" else "没有匹配的音频", color = colors.onSurfaceVariant)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                items(visible, key = { it.path }) { track ->
                    val selected = track.path == playback.path
                    Row(Modifier.fillMaxWidth().background(if (selected) colors.primaryContainer else colors.surface)
                        .clickable(enabled = playback.connected) { select(track) }.padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) colors.primary else colors.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                            Icon(if (selected && playback.playing) Icons.Rounded.GraphicEq else Icons.Rounded.MusicNote,
                                null, tint = if (selected) colors.onPrimary else colors.onSurfaceVariant)
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(track.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(track.directory, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text(track.name.substringAfterLast('.').uppercase(Locale.ROOT), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
internal fun PlayerPanel(state: PlaybackState, toggle: () -> Unit, seek: (Long) -> Unit,
    previous: () -> Unit, next: () -> Unit, retry: () -> Unit, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    var dragging by remember(state.path) { mutableStateOf(false) }
    var dragValue by remember(state.path) { mutableFloatStateOf(0f) }
    val current = if (dragging) dragValue.toLong() else state.position
    Column(modifier.background(colors.surfaceContainerLow).padding(horizontal = 16.dp, vertical = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Headphones, null, Modifier.size(32.dp), tint = colors.primary)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(state.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(when { !state.connected -> "正在连接播放服务"; state.buffering -> "正在缓冲"; state.playing -> "正在播放"; state.path.isEmpty() -> "未播放"; else -> "已暂停" },
                    color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (state.error != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(state.error, Modifier.weight(1f), color = colors.error, style = MaterialTheme.typography.bodySmall,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                TextButton(retry) { Text(if (state.connected) "重试" else "重连") }
            }
        }
        Slider(value = current.toFloat().coerceIn(0f, state.duration.coerceAtLeast(1).toFloat()),
            onValueChange = { dragging = true; dragValue = it },
            onValueChangeFinished = { seek(dragValue.toLong()); dragging = false },
            valueRange = 0f..state.duration.coerceAtLeast(1).toFloat(), enabled = state.connected && state.duration > 0,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "播放进度" })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(current), style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
            Text(formatTime(state.duration), style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            ToolButton("上一首", Icons.Rounded.SkipPrevious, state.connected && state.hasPrevious, previous)
            ToolButton("后退 10 秒", Icons.Rounded.Replay10, state.duration > 0) { seek((state.position - 10000).coerceAtLeast(0)) }
            FilledIconButton(toggle, Modifier.size(64.dp), enabled = state.connected && state.path.isNotBlank()) {
                Icon(if (state.playWhenReady) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    if (state.playWhenReady) "暂停" else "播放", Modifier.size(34.dp))
            }
            ToolButton("前进 10 秒", Icons.Rounded.Forward10, state.duration > 0) { seek((state.position + 10000).coerceAtMost(state.duration)) }
            ToolButton("下一首", Icons.Rounded.SkipNext, state.connected && state.hasNext, next)
        }
    }
}

@Composable
internal fun ToolButton(label: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick, Modifier.size(48.dp), enabled = enabled) { Icon(icon, label) }
}

@Composable
private fun MiniPlayer(state: PlaybackState, open: () -> Unit, toggle: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow)) {
        LinearProgressIndicator(progress = { if (state.duration > 0) (state.position.toFloat() / state.duration).coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).heightIn(min = 56.dp).clickable(onClickLabel = "打开播放详情", onClick = open).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.GraphicEq, null, tint = colors.primary)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(state.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (state.playing) "正在播放" else if (state.buffering) "正在缓冲" else "继续播放 · ${formatTime(state.position)}",
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
                Icon(Icons.Rounded.KeyboardArrowUp, "播放详情")
            }
            ToolButton(if (state.playWhenReady) "暂停" else "播放", if (state.playWhenReady) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                state.connected && state.path.isNotBlank(), toggle)
        }
    }
}

@Composable
private fun HistoryPanel(history: List<HistoryEntry>, connected: Boolean, select: (AudioTrack) -> Unit, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    if (history.isEmpty()) {
        Column(modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Rounded.History, null, Modifier.size(48.dp), tint = colors.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Text("暂无播放历史", color = colors.onSurfaceVariant)
        }
        return
    }
    val dateFormat = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = 12.dp)) {
        items(history, key = { it.track.path }) { entry ->
            Column(Modifier.fillMaxWidth().clickable(enabled = connected) { select(entry.track) }.padding(horizontal = 20.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (entry.completed) Icons.Rounded.CheckCircle else Icons.Rounded.History, null, tint = colors.primary)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(entry.track.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(entry.track.directory, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.onSurfaceVariant)
                    }
                    Icon(Icons.Rounded.PlayArrow, if (entry.completed) "重新播放" else "继续播放", tint = colors.primary)
                }
                Spacer(Modifier.height(10.dp))
                if (entry.duration > 0) LinearProgressIndicator(
                    progress = { if (entry.completed) 1f else (entry.position.toFloat() / entry.duration).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().height(3.dp))
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (entry.completed) "已播完" else "${formatTime(entry.position)} / ${if (entry.duration > 0) formatTime(entry.duration) else "--:--"}",
                        style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                    Text(dateFormat.format(Date(entry.updatedAt)), style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                }
            }
        }
    }
}

fun formatTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
}

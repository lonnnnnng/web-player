package com.example.localaudio.ui.main

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.example.localaudio.playback.PlaybackState
import com.example.localaudio.theme.LocalAudioTheme

@Composable
internal fun IslandContent(state: PlaybackState, expanded: Boolean, maxHeight: Dp, expand: (Boolean) -> Unit,
    toggle: () -> Unit, previous: () -> Unit, next: () -> Unit, open: () -> Unit, dismiss: () -> Unit) {
    LocalAudioTheme(darkTheme = true) {
        val colors = MaterialTheme.colorScheme
        Surface(color = colors.surface, contentColor = colors.onSurface,
            shape = RoundedCornerShape(if (expanded) 24.dp else 32.dp),
            modifier = Modifier.fillMaxWidth().heightIn(max = maxHeight)) {
            val status = when {
                state.error != null -> "播放出错"
                state.buffering -> "正在缓冲"
                state.playing -> formatTime(state.position)
                else -> "已暂停 · ${formatTime(state.position)}"
            }
            if (!expanded) {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
                    .clickable(onClickLabel = "展开灵动岛") { expand(true) }
                    .semantics { contentDescription = "展开灵动岛" }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (state.playing) Icons.Rounded.GraphicEq else Icons.Rounded.Headphones, null,
                        Modifier.size(24.dp), tint = colors.primary)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(state.title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(status, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = colors.onSurfaceVariant)
                    }
                }
            } else {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        ToolButton("打开播放详情", Icons.Rounded.OpenInFull, onClick = open)
                        Text("本地听", Modifier.weight(1f).padding(horizontal = 4.dp), style = MaterialTheme.typography.labelLarge,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        ToolButton("收起灵动岛", Icons.Rounded.KeyboardArrowUp, onClick = { expand(false) })
                        ToolButton("关闭灵动岛", Icons.Rounded.Close, onClick = dismiss)
                    }
                    Text(state.title, Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("$status · ${speedLabel(state.speed)}", Modifier.padding(horizontal = 8.dp),
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(progress = {
                        if (state.duration > 0) (state.position.toFloat() / state.duration).coerceIn(0f, 1f) else 0f
                    }, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp).height(3.dp))
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically) {
                        ToolButton("上一首", Icons.Rounded.SkipPrevious, state.hasPrevious, previous)
                        FilledIconButton(toggle, Modifier.size(56.dp)) {
                            Icon(if (state.playWhenReady) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                                if (state.playWhenReady) "暂停" else "播放", Modifier.size(32.dp))
                        }
                        ToolButton("下一首", Icons.Rounded.SkipNext, state.hasNext, next)
                    }
                }
            }
        }
    }
}

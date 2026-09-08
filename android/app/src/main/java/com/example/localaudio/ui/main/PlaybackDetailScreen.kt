package com.example.localaudio.ui.main

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.localaudio.playback.PlaybackState
import java.util.Locale

@Composable
internal fun PlaybackDetailScreen(state: PlaybackState, back: () -> Unit, toggle: () -> Unit, seek: (Long) -> Unit,
    previous: () -> Unit, next: () -> Unit, retry: () -> Unit, setSpeed: (Float) -> Unit) {
    var speedMenu by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ToolButton("返回", Icons.AutoMirrored.Rounded.ArrowBack, onClick = back)
            Text("播放详情", Modifier.weight(1f).padding(horizontal = 12.dp), style = MaterialTheme.typography.titleMedium)
            Box {
                TextButton({ speedMenu = true }, enabled = state.connected, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Rounded.Speed, null, Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(speedLabel(state.speed))
                }
                DropdownMenu(speedMenu, { speedMenu = false }) {
                    listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f).forEach { speed ->
                        DropdownMenuItem(text = { Text(speedLabel(speed)) },
                            trailingIcon = { if (state.speed == speed) Icon(Icons.Rounded.Check, null) },
                            onClick = { setSpeed(speed); speedMenu = false })
                    }
                }
            }
        }
        // long: 详情允许纵向滚动，大字体和横屏时进度与播放按钮仍可到达，不挤压成重叠布局。
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 600.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.fillMaxWidth().heightIn(min = 140.dp, max = 220.dp).padding(32.dp), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.GraphicEq, null, Modifier.size(128.dp), tint = colors.primary)
                }
                Text(state.title, Modifier.fillMaxWidth().padding(horizontal = 24.dp), style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                Text(state.directory, Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp),
                    style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                PlayerPanel(state, toggle, seek, previous, next, retry, Modifier.fillMaxWidth())
                TextButton({ seek(0); if (!state.playWhenReady) toggle() },
                    enabled = state.connected && state.path.isNotBlank(), modifier = Modifier.padding(16.dp)) {
                    Icon(Icons.Rounded.RestartAlt, null)
                    Spacer(Modifier.width(8.dp))
                    Text("从头播放")
                }
            }
        }
    }
}

internal fun speedLabel(speed: Float): String = String.format(Locale.ROOT, "%.2f", speed).trimEnd('0').trimEnd('.') + "x"

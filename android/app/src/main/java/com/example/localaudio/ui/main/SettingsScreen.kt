package com.example.localaudio.ui.main

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.localaudio.data.ServerAddress
import com.example.localaudio.playback.IslandSettings

@Composable
internal fun SettingsScreen(library: MainScreenUiState, playing: Boolean, saveServer: (String) -> Unit,
    refresh: () -> Unit, island: IslandSettings, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val enabled by island.enabled.collectAsStateWithLifecycle()
    val offset by island.offset.collectAsStateWithLifecycle()
    val islandError by island.error.collectAsStateWithLifecycle()
    var address by rememberSaveable(library.serverAddress) { mutableStateOf(library.serverAddress) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var pendingAddress by rememberSaveable { mutableStateOf<String?>(null) }
    var permissionDialog by rememberSaveable { mutableStateOf(false) }
    var unrestricted by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        // long: 系统权限页不返回授权结果，返回后必须重新核验实际权限，不能把取消当作授权。
        val granted = Settings.canDrawOverlays(context)
        island.setEnabled(granted)
        feedback = if (granted) "灵动岛已开启" else "未授权悬浮窗，灵动岛保持关闭"
    }
    DisposableEffect(lifecycle) {
        fun updatePermissions() {
            unrestricted = context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
            if (island.enabled.value && !Settings.canDrawOverlays(context)) island.setEnabled(false)
        }
        updatePermissions()
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) updatePermissions() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val applyAddress: (String) -> Unit = { normalized ->
        saveServer(normalized)
        address = normalized
        focus.clearFocus()
        error = null
        feedback = "服务地址已保存"
    }
    val submit: () -> Unit = {
        try {
            val normalized = ServerAddress.normalize(address)
            if (playing && normalized != library.serverAddress) pendingAddress = normalized else applyAddress(normalized)
        } catch (invalid: IllegalArgumentException) { error = invalid.message }
    }
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 600.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("设置", style = MaterialTheme.typography.headlineSmall)
            Text("服务器", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(value = address, onValueChange = { address = it; error = null; feedback = null },
                modifier = Modifier.fillMaxWidth(), label = { Text("服务地址") }, placeholder = { Text("http://192.168.1.2/") },
                isError = error != null, supportingText = error?.let { message -> { Text(message) } },
                maxLines = 3, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }))
            Button(onClick = submit, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Save, null)
                Spacer(Modifier.width(8.dp))
                Text("保存地址")
            }
            if (feedback != null) Text(feedback!!, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            if (library.error != null) Text(library.error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            TextButton(refresh, enabled = !library.loading) {
                Icon(Icons.Rounded.Refresh, null)
                Spacer(Modifier.width(8.dp))
                Text(if (library.loading) "正在加载" else "刷新音频库")
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.PictureInPictureAlt, null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text("灵动岛", style = MaterialTheme.typography.titleMedium)
                    Text(if (enabled) "已开启" else "已关闭", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = enabled, onCheckedChange = { value ->
                    if (!value) island.setEnabled(false)
                    else if (Settings.canDrawOverlays(context)) island.setEnabled(true)
                    else permissionDialog = true
                }, modifier = Modifier.semantics { contentDescription = "灵动岛" })
            }
            if (islandError != null) Text(islandError!!, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            if (enabled) {
                Text("顶部偏移 · $offset dp", style = MaterialTheme.typography.bodyMedium)
                var dragOffset by remember(offset) { mutableFloatStateOf(offset.toFloat()) }
                Slider(value = dragOffset, onValueChange = { dragOffset = it }, valueRange = 0f..120f, steps = 29,
                    onValueChangeFinished = { island.setOffset(dragOffset.toInt()) },
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "灵动岛顶部偏移" })
            }
            HorizontalDivider()
            ListItem(headlineContent = { Text("电池设置") },
                supportingContent = { Text(if (unrestricted) "标准电池优化已豁免" else "标准电池优化已启用") },
                leadingContent = { Icon(Icons.Rounded.BatteryFull, null) },
                trailingContent = { Icon(Icons.Rounded.ChevronRight, null) },
                modifier = Modifier.clickable {
                    try { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                    catch (_: RuntimeException) { feedback = "无法打开系统电池设置" }
                })
        }
    }
    pendingAddress?.let { normalized ->
        AlertDialog(onDismissRequest = { pendingAddress = null }, title = { Text("更换服务地址？") },
            text = { Text("当前播放将停止，原服务的播放历史会保留。") },
            confirmButton = { TextButton({ pendingAddress = null; applyAddress(normalized) }) { Text("更换") } },
            dismissButton = { TextButton({ pendingAddress = null }) { Text("取消") } })
    }
    if (permissionDialog) AlertDialog(onDismissRequest = { permissionDialog = false }, title = { Text("开启灵动岛") },
        text = { Text("需要允许本地听显示在其他应用上层。授权仅用于播放悬浮窗，不读取其他应用内容。") },
        confirmButton = { TextButton({
            permissionDialog = false
            try { launcher.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))) }
            catch (_: RuntimeException) { feedback = "无法打开悬浮窗授权页，请在系统应用设置中授权" }
        }) { Text("前往授权") } },
        dismissButton = { TextButton({ permissionDialog = false }) { Text("取消") } })
}

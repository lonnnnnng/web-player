package com.example.localaudio.playback

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

@Singleton
class IslandSettings @Inject constructor(@param:ApplicationContext context: Context) {
    private val preferences = context.getSharedPreferences("playback-island", Context.MODE_PRIVATE)
    private val mutableEnabled = MutableStateFlow(preferences.getBoolean("enabled", false))
    private val mutableOffset = MutableStateFlow(preferences.getInt("offset", 8).coerceIn(0, 120))
    private val mutableForeground = MutableStateFlow(false)
    private val mutableError = MutableStateFlow<String?>(null)
    val enabled = mutableEnabled.asStateFlow()
    val offset = mutableOffset.asStateFlow()
    val foreground = mutableForeground.asStateFlow()
    val error = mutableError.asStateFlow()

    fun setEnabled(value: Boolean) {
        preferences.edit().putBoolean("enabled", value).apply()
        mutableError.value = null
        mutableEnabled.value = value
    }

    fun setOffset(value: Int) {
        val offset = value.coerceIn(0, 120)
        preferences.edit().putInt("offset", offset).apply()
        mutableOffset.value = offset
    }

    fun setForeground(value: Boolean) { mutableForeground.value = value }

    fun reportFailure() {
        // long: 悬浮窗失败仅关闭可选控件，不把界面权限问题传播成音频服务故障。
        setEnabled(false)
        mutableError.value = "灵动岛未能显示，请检查悬浮窗权限后重新开启"
    }
}

internal object IslandPolicy {
    fun visible(enabled: Boolean, permission: Boolean, foreground: Boolean, interactive: Boolean,
        locked: Boolean, hasMedia: Boolean): Boolean = enabled && permission && !foreground && interactive && !locked && hasMedia
}

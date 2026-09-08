package com.example.localaudio.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.MessageDigest

interface ServerConfig {
    val address: StateFlow<String>
    fun update(address: String)
}

@Singleton
class ServerSettings @Inject constructor(@param:ApplicationContext context: Context) : ServerConfig {
    private val preferences = context.getSharedPreferences("server-settings", Context.MODE_PRIVATE)
    private val mutableAddress = MutableStateFlow(runCatching {
        ServerAddress.normalize(preferences.getString("address", AudioEndpoint.BASE_URL).orEmpty())
    }.getOrDefault(AudioEndpoint.BASE_URL))
    override val address = mutableAddress.asStateFlow()

    override fun update(address: String) {
        val normalized = ServerAddress.normalize(address)
        preferences.edit().putString("address", normalized).apply()
        mutableAddress.value = normalized
    }
}

object ServerAddress {
    fun normalize(input: String): String {
        val value = input.trim()
        require(value.isNotEmpty()) { "请输入服务地址" }
        require(value.none { it.isWhitespace() || it.isISOControl() } && !value.contains('\\')) { "地址不能包含空格或反斜杠" }
        val url = (if (value.contains("://")) value else "http://$value").toHttpUrlOrNull()
            ?: throw IllegalArgumentException("请输入有效的 HTTP 或 HTTPS 地址")
        require(url.username.isEmpty() && url.password.isEmpty()) { "地址不能包含用户名或密码" }
        require(url.query == null && url.fragment == null) { "服务地址不能包含查询参数或锚点" }
        return if (url.encodedPath.endsWith('/')) url.toString() else url.newBuilder().addPathSegment("").build().toString()
    }

    fun historyNamespace(address: String): String {
        val normalized = normalize(address)
        // long: 默认地址继续使用首版存储；其他服务器独立命名，避免同名文件串用播放进度。
        if (normalized == AudioEndpoint.BASE_URL) return "audio-playback"
        val digest = MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
        return "audio-playback-" + digest.joinToString("") { "%02x".format(it) }
    }
}

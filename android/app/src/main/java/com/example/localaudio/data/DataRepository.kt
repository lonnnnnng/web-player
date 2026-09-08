package com.example.localaudio.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class AudioTrack(val path: String, val name: String, val size: Long = 0) {
    val directory: String get() = path.substringBeforeLast('/', "根目录")
}

object AudioEndpoint {
    const val BASE_URL = "http://192.168.1.2/"
    fun validPath(path: String): Boolean = path.isNotBlank() && !path.startsWith('/') &&
        !path.contains('\\') && !path.contains('\u0000') && path.split('/').none { it == ".." || it == "." }

    fun mediaUrl(path: String, baseUrl: String = BASE_URL): String {
        require(validPath(path)) { "无效音频路径" }
        // long: 文件名可能含中文、空格、# 和 &，用查询参数构造器避免串成另一个请求。
        return ServerAddress.normalize(baseUrl).toHttpUrl().newBuilder().addPathSegments("api/file")
            .addQueryParameter("path", path).build().toString()
    }
}

interface DataRepository {
    suspend fun loadAudio(baseUrl: String = AudioEndpoint.BASE_URL): List<AudioTrack>
}

class DefaultDataRepository @Inject constructor() : DataRepository {
    override suspend fun loadAudio(baseUrl: String): List<AudioTrack> = withContext(Dispatchers.IO) { AudioApi(baseUrl).load() }
}

class AudioApi(
    private val baseUrl: String = AudioEndpoint.BASE_URL,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS).build(),
) {
    fun load(): List<AudioTrack> {
        val tracks = linkedMapOf<String, AudioTrack>()
        var offset = 0
        // long: 后端每页有条数限制，必须取完分页才能保证下一首不会在首屏末尾断掉。
        while (true) {
            val url = baseUrl.toHttpUrl().newBuilder().addPathSegments("api/library")
                .addQueryParameter("kind", "audio").addQueryParameter("sort", "name")
                .addQueryParameter("limit", "100").addQueryParameter("offset", offset.toString()).build()
            val body = client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) throw IOException(if (response.code == 401) "服务器需要密码，首版仅支持无密码服务" else "音频列表请求失败（HTTP ${response.code}）")
                JSONObject(response.body?.string() ?: throw IOException("服务器没有返回音频列表"))
            }
            val items = body.getJSONArray("items")
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val path = item.getString("path")
                if (item.optString("kind") == "audio" && AudioEndpoint.validPath(path)) {
                    tracks[path] = AudioTrack(path, item.getString("name"), item.optLong("size"))
                }
            }
            if (!body.optBoolean("has_more")) return tracks.values.toList()
            if (items.length() == 0 || offset >= 10000) throw IOException("音频分页异常，请刷新重试")
            offset += items.length()
        }
    }
}

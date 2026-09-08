package com.example.localaudio.playback

import androidx.media3.common.PlaybackException

object RetryPolicy {
    fun delayMs(attempt: Int): Long = (2000L shl attempt.coerceIn(0, 4)).coerceAtMost(30000L)

    fun recoverable(code: Int, httpStatus: Int? = null): Boolean {
        // long: 网络短断与服务器临时繁忙可重试；文件不存在、鉴权失败和解码失败需明确交给用户。
        if (httpStatus != null) return httpStatus == 408 || httpStatus == 429 || httpStatus in 500..599
        return code in setOf(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, PlaybackException.ERROR_CODE_IO_UNSPECIFIED)
    }
}

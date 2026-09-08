package com.example.localaudio.playback

import androidx.media3.common.PlaybackException
import org.junit.Assert.*
import org.junit.Test

class RetryPolicyTest {
    @Test fun retriesBackOffAndAreCapped() {
        assertEquals(listOf(2000L, 4000L, 8000L, 16000L, 30000L, 30000L), (0..5).map(RetryPolicy::delayMs))
    }

    @Test fun permanentErrorsDoNotRetry() {
        assertFalse(RetryPolicy.recoverable(2004, 401))
        assertFalse(RetryPolicy.recoverable(2004, 404))
        assertFalse(RetryPolicy.recoverable(PlaybackException.ERROR_CODE_DECODING_FAILED))
    }

    @Test fun temporaryNetworkAndServerErrorsRetry() {
        assertTrue(RetryPolicy.recoverable(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT))
        assertTrue(RetryPolicy.recoverable(2004, 503))
        assertTrue(RetryPolicy.recoverable(2004, 429))
    }
}

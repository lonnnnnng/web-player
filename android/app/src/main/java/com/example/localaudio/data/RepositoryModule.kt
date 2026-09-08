package com.example.localaudio.data

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import com.example.localaudio.playback.PlaybackControls
import com.example.localaudio.playback.PlaybackConnection
import androidx.media3.common.util.UnstableApi

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds abstract fun server(implementation: ServerSettings): ServerConfig
    @Binds abstract fun repository(implementation: DefaultDataRepository): DataRepository
    @androidx.annotation.OptIn(UnstableApi::class)
    @Binds abstract fun playback(implementation: PlaybackConnection): PlaybackControls
}

package com.example.localaudio.ui.main

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.example.localaudio.data.AudioTrack
import com.example.localaudio.playback.HistoryEntry
import com.example.localaudio.playback.IslandSettings
import com.example.localaudio.playback.PlaybackState
import com.example.localaudio.theme.LocalAudioTheme
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w360dp-h740dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PlayerLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val track = AudioTrack("早春晴朗 全一季完结新增番外2/01.m4a", "01.m4a")
    private val playback = PlaybackState(connected = true, path = track.path, title = track.name, directory = track.directory,
        position = 75000, duration = 3600000, hasPrevious = true, hasNext = true,
        history = listOf(HistoryEntry(track, 75000, 3600000, 1700000000000)))

    @Test fun homeStartsAtSearchAndSettingsValidatesAddress() {
        var saved: String? = null
        compose.setContent {
            LocalAudioTheme { Surface { PlayerScreen(MainScreenUiState(false, listOf(track)), playback, {}, {}, {}, {}, {}, {}, {}, {},
                { saved = it }, IslandSettings(RuntimeEnvironment.getApplication())) } }
        }
        compose.onNodeWithText("搜索音频").assertIsDisplayed()
        compose.onNodeWithText("本地听").assertDoesNotExist()
        compose.onNodeWithContentDescription("电池设置").assertDoesNotExist()
        snapshot("home-phone")
        compose.onNodeWithText("设置").performClick()
        compose.onNodeWithText("服务地址").performTextReplacement("ftp://host")
        compose.onNodeWithText("保存地址").performClick()
        compose.onNodeWithText("请输入有效的 HTTP 或 HTTPS 地址").assertExists()
        assertNull(saved)
        compose.onNodeWithText("服务地址").performTextReplacement("192.168.1.3:8080")
        compose.onNodeWithText("保存地址").performClick()
        assertEquals("http://192.168.1.3:8080/", saved)
        snapshot("settings-phone")
    }

    @Test fun detailsSpeedAndSmallScreenControlsWork() {
        var speed = 1f
        var seek = -1L
        var toggled = false
        compose.setContent { LocalAudioTheme { Surface {
            PlaybackDetailScreen(playback, {}, { toggled = true }, { seek = it }, {}, {}, {}, { speed = it })
        } } }
        compose.onNodeWithText("1x").performClick()
        compose.onNodeWithText("1.5x").performClick()
        assertEquals(1.5f, speed)
        compose.onNodeWithContentDescription("播放").assertIsDisplayed()
        snapshot("details-phone")
        compose.onNodeWithText("从头播放").performScrollTo().performClick()
        assertEquals(0, seek)
        assertTrue(toggled)
    }

    @Test @Config(qualifiers = "w640dp-h360dp-mdpi")
    fun landscapeAndLargeFontDetailsRemainScrollable() {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                LocalAudioTheme(darkTheme = true) { Surface {
                    PlaybackDetailScreen(playback, {}, {}, {}, {}, {}, {}, {})
                } }
            }
        }
        compose.onNodeWithContentDescription("播放").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("下一首").assertIsDisplayed()
        snapshot("details-landscape-large-text")
    }

    @Test fun islandExpandsAndAllControlsHaveTouchTargets() {
        var expanded by mutableStateOf(false)
        var paused = false
        var next = false
        var closed = false
        compose.setContent {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.width(if (expanded) 328.dp else 220.dp)) {
                    IslandContent(playback, expanded, 500.dp, { expanded = it }, { paused = true }, {},
                        { next = true }, {}, { closed = true })
                }
            }
        }
        snapshot("island-collapsed")
        compose.onNodeWithContentDescription("展开灵动岛").performClick()
        compose.onNodeWithContentDescription("播放").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithContentDescription("下一首").performClick()
        assertTrue(paused)
        assertTrue(next)
        snapshot("island-expanded")
        compose.onNodeWithContentDescription("关闭灵动岛").performClick()
        assertTrue(closed)
    }

    private fun snapshot(name: String) {
        compose.runOnIdle {
            // long: 本地 JVM 没有设备合成器，直接绘制已完成布局的视图，避免 PixelCopy 等待硬件帧超时。
            val view = compose.activity.window.decorView
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val colors = mutableSetOf<Int>()
            for (y in 0 until bitmap.height step 5) for (x in 0 until bitmap.width step 5) colors += bitmap.getPixel(x, y)
            assertTrue("截图不能是空白画面", colors.size > 10)
            val output = File("build/outputs/local-ui/$name.png")
            output.parentFile?.mkdirs()
            output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
}

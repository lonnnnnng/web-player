package com.example.localaudio.ui.main

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.util.regex.Pattern
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainScreenTest {
    private lateinit var device: UiDevice
    private val packageName = "io.github.lonnnnnng.localaudio"

    @Before fun launch() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.wakeUp()
        device.executeShellCommand("wm dismiss-keyguard")
        openApp(reset = true)
        device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_allow_button"))), 3000)?.click()
        assertTrue("真实后端必须含 01.m4a", device.wait(Until.hasObject(By.text("01.m4a")), 30000))
    }

    @Test fun searchAndPlaybackSurviveHomeNavigation() {
        // long: 端到端测试直接连接指定内网服务，覆盖应用注入、中文列表及系统后台切换。
        device.findObject(By.clazz("android.widget.EditText")).text = "02"
        assertTrue(device.wait(Until.hasObject(By.text("1 首")), 5000))
        assertTrue(device.hasObject(By.text("02.m4a")))
        device.findObject(By.desc("清空搜索")).click()
        assertTrue(device.wait(Until.hasObject(By.text("01.m4a")), 5000))
        device.pressBack()
        openApp()
        device.findObject(By.text("01.m4a")).click()
        assertTrue(device.wait(Until.hasObject(By.text("正在播放")), 30000))
        device.pressHome()
        val service = device.executeShellCommand("dumpsys activity services $packageName")
        assertTrue("返回桌面后必须仍是前台播放服务", service.contains("isForeground=true"))
        openApp()
        assertTrue(device.wait(Until.hasObject(By.text("正在播放")), 10000))
        device.findObject(By.desc("暂停")).click()
        assertTrue(device.wait(Until.hasObject(By.text("已暂停")), 5000))
    }

    @Test fun searchSurvivesRotationAndControlsRemainVisible() {
        device.findObject(By.clazz("android.widget.EditText")).text = "02"
        assertTrue(device.wait(Until.hasObject(By.text("1 首")), 5000))
        try {
            device.setOrientationLandscape()
            assertTrue(device.wait(Until.hasObject(By.text("1 首")), 10000))
            device.findObject(By.text("02.m4a")).click()
            assertTrue(device.wait(Until.hasObject(By.text("播放详情")), 10000))
            assertTrue(device.findObject(By.desc("下一首")).visibleBounds.width() > 0)
            device.findObject(By.desc("返回")).click()
        } finally {
            device.setOrientationPortrait()
            device.unfreezeRotation()
            device.wait(Until.findObject(By.clazz("android.widget.EditText")), 10000)?.text = ""
        }
    }

    @Test fun detailsSpeedAndHistoryRemainAvailable() {
        device.findObject(By.text("01.m4a")).click()
        assertTrue(device.wait(Until.hasObject(By.text("正在播放")), 30000))
        device.findObject(By.text(Pattern.compile("[0-9.]+x"))).click()
        device.wait(Until.findObject(By.text("1.5x")), 5000).click()
        assertTrue(device.wait(Until.hasObject(By.text("1.5x")), 5000))
        device.findObject(By.desc("前进 10 秒")).click()
        device.findObject(By.desc("暂停")).click()
        device.findObject(By.desc("返回")).click()
        device.findObject(By.text("历史")).click()
        assertTrue(device.wait(Until.hasObject(By.text("01.m4a")), 5000))
        device.findObject(By.text("01.m4a")).click()
        assertTrue(device.wait(Until.hasObject(By.text("播放详情")), 5000))
        assertTrue(device.hasObject(By.text("1.5x")))
        device.findObject(By.desc("暂停")).click()
    }

    @Test fun configurationRejectsInvalidAddressWithoutChangingService() {
        device.findObject(By.text("设置")).click()
        val input = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 5000)
        input.text = "ftp://invalid"
        device.findObject(By.text("保存地址")).click()
        assertTrue(device.wait(Until.hasObject(By.text("请输入有效的 HTTP 或 HTTPS 地址")), 5000))
        device.pressBack()
        device.findObject(By.text("音频库")).click()
        assertTrue(device.wait(Until.hasObject(By.text("01.m4a")), 5000))
    }

    private fun openApp(reset: Boolean = false) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = requireNotNull(context.packageManager.getLaunchIntentForPackage(packageName))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (reset) intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
        assertTrue(device.wait(Until.hasObject(By.pkg(packageName)), 10000))
    }
}

package com.example.localaudio.playback

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.media3.common.Player
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.example.localaudio.MainActivity
import com.example.localaudio.ui.main.IslandContent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

internal class PlaybackIsland(private val context: Context, private val player: Player,
    private val settings: IslandSettings) : LifecycleOwner, SavedStateRegistryOwner {
    private val lifecycleRegistry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = lifecycleRegistry
    private val savedStateController = SavedStateRegistryController.create(this)
    override val savedStateRegistry get() = savedStateController.savedStateRegistry
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    @Suppress("DEPRECATION")
    private val windowType = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else WindowManager.LayoutParams.TYPE_PHONE
    private val displayContext = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        ?.let(context::createDisplayContext) ?: context
    private val windowContext = if (Build.VERSION.SDK_INT >= 30) displayContext.createWindowContext(windowType, null) else displayContext
    private val windowManager = windowContext.getSystemService(WindowManager::class.java)
    private var view: ComposeView? = null
    private var expanded = mutableStateOf(false)
    private var state = mutableStateOf(PlaybackState())
    private var closed = false
    private var receiverRegistered = false
    private val tick = Runnable { sync() }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_SCREEN_OFF) hide() else sync()
        }
    }

    init {
        savedStateController.performAttach()
        savedStateController.performRestore(null)
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
    }

    fun start() {
        ContextCompat.registerReceiver(context, receiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
        scope.launch { combine(settings.enabled, settings.foreground, settings.offset) { _, _, _ -> Unit }.collect { sync() } }
    }

    fun sync() {
        if (closed) return
        handler.removeCallbacks(tick)
        try {
            val permitted = Settings.canDrawOverlays(context)
            if (settings.enabled.value && !permitted) settings.setEnabled(false)
            if (!IslandPolicy.visible(settings.enabled.value, permitted, settings.foreground.value,
                    context.getSystemService(PowerManager::class.java).isInteractive,
                    context.getSystemService(KeyguardManager::class.java).isKeyguardLocked, player.currentMediaItem != null)) {
                hide()
                return
            }
            updateState()
            if (view == null) show() else windowManager.updateViewLayout(view, layout())
            // long: 仅可见的胶囊更新进度；锁屏或回到应用立即停掉界面计时，不增加音频保活负担。
            handler.postDelayed(tick, 1000)
        } catch (_: RuntimeException) {
            hide()
            settings.reportFailure()
        }
    }

    private fun show() {
        expanded.value = false
        val content = ComposeView(windowContext)
        content.setViewTreeLifecycleOwner(this)
        content.setViewTreeSavedStateRegistryOwner(this)
        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
        val metrics = windowContext.resources.displayMetrics
        content.setContent {
            val offset = settings.offset.collectAsState().value
            IslandContent(state.value, expanded.value, (metrics.heightPixels / metrics.density - 100 - offset).coerceAtLeast(96f).dp,
                expand = { expanded.value = it; sync() }, toggle = {
                    if (player.playWhenReady && player.playbackState != Player.STATE_ENDED) player.pause()
                    else {
                        if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
                        if (player.playbackState == Player.STATE_IDLE) player.prepare()
                        player.play()
                    }
                    sync()
                }, previous = { player.seekToPreviousMediaItem() }, next = { player.seekToNextMediaItem() },
                open = {
                    try { context.startActivity(MainActivity.detailsIntent(context)) }
                    catch (_: RuntimeException) { settings.reportFailure() }
                }, dismiss = { settings.setEnabled(false) })
        }
        // long: 窗口只覆盖胶囊自身的矩形，不创建透明全屏遮罩，也不占用键盘焦点或亮屏锁。
        try { windowManager.addView(content, layout()); view = content }
        catch (error: RuntimeException) { content.disposeComposition(); throw error }
    }

    private fun layout(): WindowManager.LayoutParams {
        val metrics = windowContext.resources.displayMetrics
        val width = minOf(if (expanded.value) 360 else 220, (metrics.widthPixels / metrics.density - 32).toInt())
        return WindowManager.LayoutParams((width * metrics.density).toInt(), WindowManager.LayoutParams.WRAP_CONTENT,
            windowType, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (settings.offset.value * metrics.density).toInt()
            if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
        }
    }

    private fun updateState() {
        val item = player.currentMediaItem
        state.value = PlaybackState(connected = true, path = item?.mediaId.orEmpty(),
            title = item?.mediaMetadata?.title?.toString().orEmpty(), playing = player.isPlaying,
            playWhenReady = player.playWhenReady && player.playbackState != Player.STATE_ENDED,
            buffering = player.playbackState == Player.STATE_BUFFERING,
            position = player.currentPosition.coerceAtLeast(0), duration = player.duration.coerceAtLeast(0),
            speed = player.playbackParameters.speed, hasPrevious = player.hasPreviousMediaItem(), hasNext = player.hasNextMediaItem(),
            error = player.playerError?.message)
    }

    fun configurationChanged() { hide(); sync() }

    private fun hide() {
        handler.removeCallbacks(tick)
        val content = view
        view = null
        if (content != null) {
            runCatching { windowManager.removeViewImmediate(content) }
            content.disposeComposition()
        }
        if (!closed) lifecycleRegistry.currentState = Lifecycle.State.CREATED
        expanded.value = false
    }

    fun close() {
        if (closed) return
        closed = true
        scope.cancel()
        hide()
        if (receiverRegistered) context.unregisterReceiver(receiver)
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
    }
}

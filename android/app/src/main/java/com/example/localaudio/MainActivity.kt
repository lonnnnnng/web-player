package com.example.localaudio

import android.os.Bundle
import android.Manifest
import android.os.Build
import android.content.Context
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.runtime.mutableIntStateOf
import com.example.localaudio.theme.LocalAudioTheme
import com.example.localaudio.ui.main.MainScreen
import com.example.localaudio.ui.main.MainScreenViewModel
import dagger.hilt.android.AndroidEntryPoint
import com.example.localaudio.playback.IslandSettings
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
  @Inject lateinit var islandSettings: IslandSettings
  private val detailsRequest = mutableIntStateOf(0)
  private val model: MainScreenViewModel by viewModels()
  private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    islandSettings.setForeground(true)
    if (intent.action == ACTION_DETAILS) detailsRequest.intValue++
    enableEdgeToEdge()
    setContent {
      LocalAudioTheme { Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        MainScreen(model, islandSettings, detailsRequest.intValue)
      } }
    }
    if (Build.VERSION.SDK_INT >= 33 && !getPreferences(MODE_PRIVATE).getBoolean("notificationAsked", false)) {
      getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply()
      notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
  }

  override fun onStart() { super.onStart(); islandSettings.setForeground(true) }
  override fun onStop() { islandSettings.setForeground(false); super.onStop() }
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.action == ACTION_DETAILS) detailsRequest.intValue++
  }

  companion object {
    private const val ACTION_DETAILS = "io.github.lonnnnnng.localaudio.PLAYBACK_DETAILS"
    fun detailsIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
      .setAction(ACTION_DETAILS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }
}

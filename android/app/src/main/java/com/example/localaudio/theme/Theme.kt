package com.example.localaudio.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF9DD4B5), onPrimary = Color(0xFF103D2B), primaryContainer = Color(0xFF234938),
    onPrimaryContainer = Color(0xFFC1EFD4), secondary = Color(0xFFD9C28F), tertiary = Color(0xFFC8B8DE),
    background = Color(0xFF151917), surface = Color(0xFF151917), surfaceContainerLow = Color(0xFF1D231F),
    surfaceContainerHighest = Color(0xFF333C35), onSurface = Color(0xFFE5EBE6), onSurfaceVariant = Color(0xFFBFCAC1))

private val LightColorScheme =
  lightColorScheme(
    primary = Color(0xFF246547),
    secondary = Color(0xFF79642E),
    tertiary = Color(0xFF6A547B),
    primaryContainer = Color(0xFFD9EDDF), onPrimaryContainer = Color(0xFF123D2A),
    background = Color(0xFFF9FAF8), surface = Color(0xFFF9FAF8),
    surfaceContainerLow = Color(0xFFEEF3ED), surfaceContainerHighest = Color(0xFFE1E8DF),
    onPrimary = Color.White,
    onSurface = Color(0xFF1A251E), onSurfaceVariant = Color(0xFF505F55),
  )

@Composable
fun LocalAudioTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val colorScheme =
    when {
      darkTheme -> DarkColorScheme
      else -> LightColorScheme
    }

  MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}

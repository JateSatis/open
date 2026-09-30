package expo.modules.callservice

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Держит звонок живым, пока приложение в фоне: без foreground service Android
 * 14+ отбирает микрофон у свёрнутого приложения, а система может убить процесс.
 */
class CallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallService")

    Function("start") { title: String, text: String, microphone: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, CallForegroundService::class.java)
        .putExtra(CallForegroundService.EXTRA_TITLE, title)
        .putExtra(CallForegroundService.EXTRA_TEXT, text)
        .putExtra(CallForegroundService.EXTRA_MICROPHONE, microphone)

      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (error: Exception) {
        // Android 12+ не даёт запускать службу из фона — звонок всё равно
        // идёт, пока приложение на экране.
        false
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, CallForegroundService::class.java))
      null
    }
  }
}

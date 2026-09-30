package expo.modules.callservice

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Держит звонок живым, пока приложение в фоне: без foreground service Android
 * 14+ отбирает микрофон у свёрнутого приложения, а система может убить процесс.
 */
class CallServiceModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val timers = mutableMapOf<Int, Runnable>()

  override fun definition() = ModuleDefinition {
    Name("CallService")

    // Таймеры, которые не засыпают в фоне. Таймеры JS у свёрнутого приложения
    // Android-версия React Native приостанавливает, а на них держится пинг
    // LiveKit: без него сервер через несколько секунд считает участника
    // потерянным. Сработавший таймер будит JS событием.
    Events("onTimer")

    Function("setTimer") { id: Int, delayMs: Double, repeat: Boolean ->
      clearTimer(id)

      val runnable = object : Runnable {
        override fun run() {
          if (repeat) {
            handler.postDelayed(this, delayMs.toLong())
          } else {
            timers.remove(id)
          }
          sendEvent("onTimer", mapOf("id" to id))
        }
      }

      timers[id] = runnable
      handler.postDelayed(runnable, delayMs.toLong())
    }

    Function("clearTimer") { id: Int -> clearTimer(id) }

    OnDestroy {
      timers.values.forEach(handler::removeCallbacks)
      timers.clear()
    }

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

  private fun clearTimer(id: Int) {
    timers.remove(id)?.let(handler::removeCallbacks)
  }
}

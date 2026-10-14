package expo.modules.backgesture

import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Системный жест «назад» по шагам, а не одним нажатием. React Native и
 * react-native-screens узнают о жесте только в момент отпускания, а экрану,
 * который едет за пальцем, нужен ход жеста: начало, прогресс, отмена.
 *
 * Пока перехват включён, наш колбэк — последний добавленный в диспетчер
 * активити и поэтому первый: «назад» (жестом и кнопкой) достаётся JS
 * событием `onBackInvoked`, а не навигации React Native. Окна `Modal` —
 * отдельные диалоги со своим диспетчером, их «назад» сюда не попадает.
 */
class BackGestureModule : Module() {
  private var callback: OnBackPressedCallback? = null

  override fun definition() = ModuleDefinition {
    Name("BackGesture")

    Events("onBackStarted", "onBackProgressed", "onBackCancelled", "onBackInvoked")

    AsyncFunction("setEnabled") { enabled: Boolean ->
      if (enabled) enable() else disable()
    }.runOnQueue(Queues.MAIN)

    OnDestroy { disable() }
  }

  private fun enable() {
    if (callback != null) return

    val activity = appContext.currentActivity as? ComponentActivity ?: return
    val created = object : OnBackPressedCallback(true) {
      override fun handleOnBackStarted(backEvent: BackEventCompat) {
        sendEvent("onBackStarted", payload(backEvent))
      }

      override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        sendEvent("onBackProgressed", payload(backEvent))
      }

      override fun handleOnBackCancelled() {
        sendEvent("onBackCancelled", emptyMap<String, Any>())
      }

      override fun handleOnBackPressed() {
        sendEvent("onBackInvoked", emptyMap<String, Any>())
      }
    }

    activity.onBackPressedDispatcher.addCallback(created)
    callback = created
  }

  private fun disable() {
    callback?.remove()
    callback = null
  }

  private fun payload(event: BackEventCompat): Map<String, Any> {
    val density = appContext.reactContext?.resources?.displayMetrics?.density ?: 1f

    return mapOf(
      "progress" to event.progress.toDouble(),
      // В dp, как координаты в JS.
      "touchX" to (event.touchX / density).toDouble(),
      "edge" to if (event.swipeEdge == BackEventCompat.EDGE_RIGHT) "right" else "left",
    )
  }
}

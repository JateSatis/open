package expo.modules.audiooutput

import android.content.Context
import android.database.ContentObserver
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Громкость медиа и куда идёт звук (динамик, проводные, Bluetooth) — для
 * журнала рекомендаций: тихо или без звука посмотренное видео — другой
 * сигнал, чем со звуком. Только чтение, ничего не меняет.
 */
class AudioOutputModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var observer: ContentObserver? = null
  private var deviceCallback: AudioDeviceCallback? = null
  private var last: Map<String, Any>? = null

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("AudioOutput")

    Events("onChange")

    Function("getState") {
      state()
    }

    OnStartObserving {
      val context = appContext.reactContext ?: return@OnStartObserving
      val manager = audioManager ?: return@OnStartObserving

      // Кнопки громкости не шлют публичного события — меняют системную
      // настройку, за которой можно следить.
      observer = object : ContentObserver(handler) {
        override fun onChange(selfChange: Boolean) = emitIfChanged()
      }.also {
        context.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, it)
      }

      deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = emitIfChanged()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = emitIfChanged()
      }.also {
        manager.registerAudioDeviceCallback(it, handler)
      }
    }

    OnStopObserving {
      observer?.let { appContext.reactContext?.contentResolver?.unregisterContentObserver(it) }
      deviceCallback?.let { audioManager?.unregisterAudioDeviceCallback(it) }
      observer = null
      deviceCallback = null
    }
  }

  private fun emitIfChanged() {
    val next = state()

    if (next == last) return

    last = next
    sendEvent("onChange", next)
  }

  private fun state(): Map<String, Any> {
    val manager = audioManager ?: return mapOf("volume" to 1.0, "muted" to false, "route" to "other")
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val current = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
    val muted = current == 0 || manager.isStreamMute(AudioManager.STREAM_MUSIC)

    return mapOf(
      "volume" to current.toDouble() / max,
      "muted" to muted,
      "route" to route(manager),
    )
  }

  /** Куда идёт звук: подключённое устройство важнее встроенного динамика. */
  private fun route(manager: AudioManager): String {
    val types = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
    val bluetooth = setOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_BLE_SPEAKER,
    )
    val wired = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )

    return when {
      types.any { it in bluetooth } -> "bluetooth"
      types.any { it in wired } -> "wired"
      else -> "speaker"
    }
  }
}

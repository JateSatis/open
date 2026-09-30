package expo.modules.callservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Служба на время звонка. Уведомление не прячется: пока идёт звонок, человек
 * видит, что он в эфире, даже со свёрнутым приложением. Тап возвращает в Open.
 */
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Звонок"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val microphone = intent?.getBooleanExtra(EXTRA_MICROPHONE, false) ?: false

    ensureChannel()

    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val content = launch?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_call_notification)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(content)
      .build()

    // Слушателю микрофон не нужен, и разрешения на него может не быть —
    // тогда тип microphone уронил бы запуск службы.
    val type = if (microphone && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    } else {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    }

    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    } catch (error: Exception) {
      stopSelf()
    }

    return START_NOT_STICKY
  }

  // Смахнули приложение из недавних — звонок кончается вместе с ним, а не
  // висит уведомлением без процесса.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(NotificationManager::class.java) ?: return

    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Звонки", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Идущий звонок"
        setShowBadge(false)
      },
    )
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_MICROPHONE = "microphone"
    private const val CHANNEL_ID = "open_calls"
    private const val NOTIFICATION_ID = 7301
  }
}

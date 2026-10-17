package expo.modules.scrolltap

import android.content.Context
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.OverScroller
import android.widget.ScrollView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.reflect.Field

/**
 * Касание по списку, который ещё едет по инерции или отскакивает от края.
 *
 * Android-овский `ScrollView` на касании проверяет, закончилась ли инерция и
 * отпустил ли край, — и если нет, забирает касание себе: список
 * останавливается, а до кнопок под пальцем касание не доходит. Так первое
 * касание по летящему списку только тормозит его, и это правильно. Но тот же
 * перехват срабатывает и на медленном хвосте инерции, и на отскоке от края,
 * когда список для глаза уже стоит, — и тап по фото в этот момент «не
 * нажимается».
 *
 * Обёртка видит касание раньше списков внутри неё. Если список под пальцем
 * едет медленнее порога, она останавливает его сама, и список касание уже
 * не перехватывает: оно достаётся тому, что под пальцем. Быстрый полёт не
 * трогается. Отскок от края касание не забирает у жест-обработчиков и так.
 */
class ScrollTapView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Порог скорости, dp/с: медленнее — касание проходит к содержимому. */
  var slowVelocityDp: Float = 500f

  private val rect = Rect()
  private val location = IntArray(2)

  // Детей раскладывает Yoga. `ExpoView` — это `LinearLayout`, и его собственный
  // проход раскладки поставил бы их столбиком поверх того, что задал React.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      // Точка касания — в координатах окна, как и видимые прямоугольники ниже.
      getLocationInWindow(location)
      settleSlowScrolls(this, location[0] + event.x, location[1] + event.y)
    }

    return super.dispatchTouchEvent(event)
  }

  private fun settleSlowScrolls(view: View, x: Float, y: Float) {
    if (!view.isShown || !contains(view, x, y)) return

    if (view is ScrollView) settle(view)

    if (view is ViewGroup) {
      for (index in 0 until view.childCount) settleSlowScrolls(view.getChildAt(index), x, y)
    }
  }

  // Видимый прямоугольник, а не угол вью плюс размер: перевёрнутый список
  // переписки развёрнут трансформом, и его угол на экране — нижний.
  private fun contains(view: View, x: Float, y: Float): Boolean =
    view.getGlobalVisibleRect(rect) && rect.contains(x.toInt(), y.toInt())

  private fun settle(scrollView: ScrollView) {
    val scroller = scrollerField?.get(scrollView) as? OverScroller
    val slow = slowVelocityDp * resources.displayMetrics.density

    if (scroller == null || scroller.isFinished || scroller.currVelocity > slow) return

    scroller.abortAnimation()
  }

  private companion object {
    // То же поле берёт по отражению сам `ReactScrollView`; нет поля — нет и
    // помощи, касание работает как раньше.
    val scrollerField: Field? =
      try {
        ScrollView::class.java.getDeclaredField("mScroller").apply { isAccessible = true }
      } catch (_: Throwable) {
        null
      }
  }
}

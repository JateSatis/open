package expo.modules.textgeometry

import android.text.Layout
import android.view.View
import android.widget.TextView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Геометрия отрисованного текста: строки и горизонталь каждого символа — из
 * того самого `Layout`, которым текст нарисован на экране, а не из повторного
 * измерения. По ней JS попадает пальцем в символ и рисует выделение ровно по
 * глифам.
 *
 * Всё — в dp от левого верхнего угла вью текста, смещения — UTF-16, как строки
 * в JS. `null` — вью нет (уехало из списка) или это не текст.
 */
class TextGeometryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TextGeometry")

    AsyncFunction("measure") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction null

      measure(view)
    }.runOnQueue(Queues.MAIN)
  }

  private fun measure(view: View): Map<String, Any>? {
    val placed = placedLayout(view) ?: return null
    val layout = placed.layout
    val density = view.resources.displayMetrics.density
    val dx = placed.left
    val dy = placed.top
    val text = layout.text
    val length = text.length

    val lines = ArrayList<Map<String, Any>>(layout.lineCount)
    for (line in 0 until layout.lineCount) {
      lines.add(
        mapOf(
          "start" to layout.getLineStart(line),
          "end" to layout.getLineEnd(line),
          "top" to ((layout.getLineTop(line) + dy) / density).toDouble(),
          "bottom" to ((layout.getLineBottom(line) + dy) / density).toDouble(),
          "baseline" to ((layout.getLineBaseline(line) + dy) / density).toDouble(),
          "left" to ((layout.getLineLeft(line) + dx) / density).toDouble(),
          "right" to ((layout.getLineRight(line) + dx) / density).toDouble(),
        ),
      )
    }

    // Левый край каждого символа на его строке. Конец строки — правый край
    // строки (`right`): горизонталь смещения на переносе — уже следующая строка.
    val xs = ArrayList<Double>(length)
    for (offset in 0 until length) {
      xs.add(((layout.getPrimaryHorizontal(offset) + dx) / density).toDouble())
    }

    return mapOf(
      "text" to text.toString(),
      "width" to (view.width / density).toDouble(),
      "height" to (view.height / density).toDouble(),
      "lines" to lines,
      "xs" to xs,
    )
  }

  private class Placed(val layout: Layout, val left: Float, val top: Float)

  /**
   * `Layout` вью и где он стоит внутри неё. Обычный текст React Native на
   * Android — `ReactTextView` (наследник `TextView`); за флагом
   * `enablePreparedTextLayout` — `PreparedLayoutTextView` со своим
   * подготовленным `Layout`, до него — рефлексией: класс внутренний.
   */
  private fun placedLayout(view: View): Placed? {
    if (view is TextView) {
      val layout = view.layout ?: return null

      return Placed(layout, view.totalPaddingLeft.toFloat(), view.totalPaddingTop.toFloat())
    }

    if (view.javaClass.simpleName != "PreparedLayoutTextView") return null

    return try {
      val getter = view.javaClass.methods.firstOrNull { it.name.startsWith("getPreparedLayout") }
        ?: return null
      val prepared = getter.invoke(view) ?: return null
      val layout = prepared.javaClass.methods
        .firstOrNull { it.name == "getLayout" }
        ?.invoke(prepared) as? Layout ?: return null
      val offset = prepared.javaClass.methods
        .firstOrNull { it.name == "getVerticalOffset" }
        ?.invoke(prepared) as? Float ?: 0f

      Placed(layout, view.paddingLeft.toFloat(), view.paddingTop + offset)
    } catch (_: Exception) {
      null
    }
  }
}

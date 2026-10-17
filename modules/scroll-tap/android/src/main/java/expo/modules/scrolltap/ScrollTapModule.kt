package expo.modules.scrolltap

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ScrollTapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScrollTap")

    View(ScrollTapView::class) {
      Prop("slowVelocity") { view: ScrollTapView, value: Double ->
        view.slowVelocityDp = value.toFloat()
      }
    }
  }
}

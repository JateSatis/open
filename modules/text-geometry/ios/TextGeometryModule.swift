import ExpoModulesCore
import UIKit

/**
 * Геометрия отрисованного текста — то же, что на Android: строки и левый край
 * каждого символа в pt от угла вью, смещения — UTF-16.
 *
 * Fabric на iOS рисует текст `RCTParagraphComponentView` через свой TextKit,
 * а наружу отдаёт лишь `attributedText`. Раскладка повторяется тем же TextKit с
 * теми же параметрами, что у `RCTTextLayoutManager`: контейнер шириной вью,
 * без внутренних полей строки. Не проверено на устройстве.
 */
public class TextGeometryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TextGeometry")

    AsyncFunction("measure") { (viewTag: Int) -> [String: Any]? in
      guard let view = self.appContext?.findView(withTag: viewTag, ofType: UIView.self) else {
        return nil
      }

      return TextGeometryModule.measure(view)
    }.runOnQueue(.main)
  }

  private static func measure(_ view: UIView) -> [String: Any]? {
    guard view.responds(to: NSSelectorFromString("attributedText")),
          let text = view.value(forKey: "attributedText") as? NSAttributedString
    else {
      return nil
    }

    let size = view.bounds.size
    let storage = NSTextStorage(attributedString: text)
    let manager = NSLayoutManager()
    let container = NSTextContainer(size: CGSize(width: size.width, height: .greatestFiniteMagnitude))

    container.lineFragmentPadding = 0
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
    manager.ensureLayout(for: container)

    let string = storage.string as NSString
    let length = string.length
    var lines: [[String: Any]] = []
    var glyphIndex = 0
    let glyphCount = manager.numberOfGlyphs

    while glyphIndex < glyphCount {
      var lineGlyphs = NSRange(location: 0, length: 0)
      let rect = manager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: &lineGlyphs)
      let used = manager.lineFragmentUsedRect(forGlyphAt: glyphIndex, effectiveRange: nil)
      let chars = manager.characterRange(forGlyphRange: lineGlyphs, actualGlyphRange: nil)
      let baseline = manager.location(forGlyphAt: glyphIndex).y

      lines.append([
        "start": chars.location,
        "end": chars.location + chars.length,
        "top": Double(rect.minY),
        "bottom": Double(rect.maxY),
        "baseline": Double(rect.minY + baseline),
        "left": Double(used.minX),
        "right": Double(used.maxX),
      ])

      glyphIndex = NSMaxRange(lineGlyphs)
    }

    var xs: [Double] = []
    xs.reserveCapacity(length)

    for offset in 0..<length {
      let glyph = manager.glyphIndexForCharacter(at: offset)
      let fragment = manager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)

      xs.append(Double(fragment.minX + manager.location(forGlyphAt: glyph).x))
    }

    return [
      "text": storage.string,
      "width": Double(size.width),
      "height": Double(size.height),
      "lines": lines,
      "xs": xs,
    ]
  }
}

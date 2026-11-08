"""Optional OpenCV pixel comparison of two explicit image regions, never an FPS test."""
import argparse
import json
from pathlib import Path


def compare(before, after, roi, threshold):
    import cv2
    import numpy as np

    first = cv2.imread(str(before))
    second = cv2.imread(str(after))
    if first is None or second is None or first.shape != second.shape:
        raise ValueError("Need readable images of the same dimensions; do not resize silently")
    x, y, width, height = roi
    if min(x, y) < 0 or min(width, height) <= 0 or x + width > first.shape[1] or y + height > first.shape[0]:
        raise ValueError("ROI is outside image")
    a = first[y:y + height, x:x + width]
    b = second[y:y + height, x:x + width]
    delta = cv2.absdiff(a, b)
    changed = np.max(delta, axis=2) > threshold
    overlay = b.copy()
    overlay[changed] = (0, 0, 255)
    output = after.with_name(after.stem + "-diff.png")
    if not cv2.imwrite(str(output), overlay):
        raise ValueError("Cannot save diff")
    return {"roi": roi, "threshold": threshold, "changedPercent": round(float(changed.mean()) * 100, 3),
            "meanChannelDifference": round(float(delta.mean()), 3), "diff": str(output.resolve()),
            "scope": "pixel difference only; neither semantic correctness nor smoothness"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--roi", nargs=4, type=int, required=True, metavar=("X", "Y", "W", "H"))
    parser.add_argument("--threshold", type=int, default=24)
    args = parser.parse_args()
    if not 0 <= args.threshold <= 255:
        parser.error("--threshold must be between 0 and 255")
    try:
        print(json.dumps(compare(args.before, args.after, args.roi, args.threshold), indent=2))
    except ImportError:
        parser.exit(2, "OpenCV unavailable. Use the optional host venv described in docs/development.md#визуальные-проверки.\n")
    except ValueError as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()

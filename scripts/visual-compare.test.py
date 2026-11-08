import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("visual_compare", Path(__file__).with_name("visual-compare.py"))
sys.dont_write_bytecode = True
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompareTest(unittest.TestCase):
    def test_roi_excludes_unrelated_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            before, after = Path(directory) / "before.png", Path(directory) / "after.png"
            image = np.zeros((20, 20, 3), dtype=np.uint8)
            cv2.imwrite(str(before), image)
            image[10:, 10:] = 255
            cv2.imwrite(str(after), image)
            self.assertEqual(module.compare(before, after, [0, 0, 10, 10], 24)["changedPercent"], 0)
            self.assertEqual(module.compare(before, after, [10, 10, 10, 10], 24)["changedPercent"], 100)
            with self.assertRaises(ValueError):
                module.compare(before, after, [10, 10, 11, 10], 24)

    def test_different_sizes_are_not_silently_rescaled(self):
        with tempfile.TemporaryDirectory() as directory:
            before, after = Path(directory) / "before.png", Path(directory) / "after.png"
            cv2.imwrite(str(before), np.zeros((20, 20, 3), dtype=np.uint8))
            cv2.imwrite(str(after), np.zeros((30, 20, 3), dtype=np.uint8))
            with self.assertRaises(ValueError):
                module.compare(before, after, [0, 0, 10, 10], 24)


if __name__ == "__main__":
    unittest.main()

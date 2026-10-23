import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class GalleryPagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="slr-gallery-unit-")
        self.root = Path(self.temp.name)
        with patch.dict(os.environ, {"OTG_ADMIN_GALLERY_AGENT_ROOT": str(self.root), "OTG_ADMIN_GALLERY_AGENT_TOKEN": "synthetic-test-only"}):
            spec = importlib.util.spec_from_file_location("gallery_under_test", Path(__file__).with_name("otg_admin_gallery_agent.py"))
            self.agent = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.agent)
        for index, name in enumerate(("a.png", "b.mp4", "c.png", "d.mp4")):
            file = self.root / name
            file.write_bytes(b"synthetic metadata fixture")
            os.utime(file, (1000 + index, 1000 + index))

    def tearDown(self):
        self.temp.cleanup()

    def test_kind_filter_before_page(self):
        items, count = self.agent.list_media(1, 1, kind_filter="image", sort="name")
        self.assertEqual(count, 2)
        self.assertEqual([item["name"] for item in items], ["c.png"])

    def test_search_all_records(self):
        items, count = self.agent.list_media(1, search="A.PNG")
        self.assertEqual(count, 1)
        self.assertEqual(items[0]["name"], "a.png")

    def test_oldest_and_newest(self):
        self.assertEqual(self.agent.list_media(1, sort="oldest")[0][0]["name"], "a.png")
        self.assertEqual(self.agent.list_media(1, sort="newest")[0][0]["name"], "d.mp4")

    def test_final_page(self):
        items, count = self.agent.list_media(2, 3, sort="name")
        self.assertEqual(count, 4)
        self.assertEqual([item["name"] for item in items], ["d.mp4"])

    def test_path_traversal_refused(self):
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.agent.safe_media_path("../other.mp4")

    def test_symlink_media_excluded(self):
        (self.root / "alias.png").symlink_to(self.root / "a.png")
        self.assertEqual(self.agent.list_media(100)[1], 4)


if __name__ == "__main__":
    unittest.main()

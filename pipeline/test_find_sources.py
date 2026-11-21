"""Offline checks for find_sources.py (no network, no model)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("HE_API_URL", "http://x")
import find_sources as fs  # noqa: E402


class FindSourcesTest(unittest.TestCase):
    def test_official_hosts_only(self):
        for u in ("https://www.halal.gov.my/a", "https://lom.agc.gov.my/", "http://npra.gov.my/x"):
            self.assertTrue(fs.official(u), u)
        for u in ("https://evil.com/halal.gov.my", "https://halal.gov.my.evil.com/", "http://fakegov.my/", "https://www.facebook.com/x", ""):
            self.assertFalse(fs.official(u), u)

    def test_bing_wrapper_decoded(self):
        u = "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cuaGFsYWwuZ292Lm15L3BkZi9wbGgvUlMwMjExMjAyNkVOR0xJU0gucGRm&ntb=1"
        self.assertEqual(fs.bing_url(u), "https://www.halal.gov.my/pdf/plh/RS02112026ENGLISH.pdf")

    def test_html_text(self):
        t, text, links = fs.html_text("<html><title> A &amp; B </title><script>x=1</script><p>Hello <b>world</b></p><a href='/x.pdf'>f</a></html>")
        self.assertEqual(t, "A & B")
        self.assertIn("Hello world", text)
        self.assertNotIn("x=1", text)
        self.assertEqual(links, ["/x.pdf"])

    def _ps(self):
        return [{"n": 1, "url": "https://www.halal.gov.my/pdf/a.pdf", "host": "halal.gov.my", "title": "a.pdf", "page": "7", "pdf": True,
                 "text": "Pemegang sijil hendaklah mempamerkan logo halal Malaysia pada label produk dengan nama dan alamat pengilang."}]

    def test_accept_good_and_bad(self):
        point = "logo halal pada label produk dan alamat pengilang"
        good = {"text": "Logo halal Malaysia hendaklah dipamerkan pada label produk.", "n": 1, "quote": "mempamerkan logo halal Malaysia pada label produk"}
        s, p = fs.accept(point, good, self._ps())
        self.assertTrue(s and s.endswith("halal.gov.my/pdf/a.pdf)") and "ms. 7" in s and "Sumber:" in s, s)
        self.assertTrue(fs.sourced(s))
        for bad, why in (({"text": "x", "n": 1, "quote": "a quote that is not in the passage at all"}, "word for word"),
                         ({"text": "Yuran RM300 dikenakan.", "n": 1, "quote": "mempamerkan logo halal Malaysia pada label produk"}, "numbers"),
                         ({"text": "ok", "n": 9, "quote": "mempamerkan logo halal Malaysia pada label produk"}, "not sent"),
                         ({"text": None}, "no official")):
            s2, w = fs.accept(point, bad, self._ps())
            self.assertIsNone(s2)
            self.assertIn(why, w)

    def test_sourced_marker(self):
        self.assertTrue(fs.sourced("x. (Source: halal.gov.my, T, https://www.halal.gov.my/x)"))
        self.assertFalse(fs.sourced("a plain open point"))


if __name__ == "__main__":
    unittest.main()

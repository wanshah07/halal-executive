"""Registration links printed as QR codes on event posters (Wan, 18 Oct 2026).

The model that reads a poster only gets its text, so the link behind the QR
code was always lost. This decodes the code itself, with OpenCV, from every
kind of file an event poster arrives as:

  - pictures (PNG, JPEG, WebP, GIF, BMP, TIFF; HEIC when pillow-heif is there)
  - PDF: each page rendered at 3x (PyMuPDF), first 8 pages
  - PowerPoint and Word (.pptx/.docx, e.g. a Canva export): every picture in
    the file's media folder

A QR code on a poster is small and often sits on a coloured background, so
each picture is tried whole, at several scales and in overlapping tiles, with
and without sharpening, before it counts as having no code. Only http(s)
addresses come out (a QR can carry anything), a bare `www.` address gets
https://, and every one passes the same check as every other link here.

  python qr_links.py FILE...        decode files and print what they hold
"""
import io
import re
import sys
import time
import zipfile

import cv2
import numpy as np

MAX_PAGES = 8
BUDGET_S = 60                    # per file: a poster with no code costs a minute at most
MAX_PIXELS = 36_000_000          # larger pictures are scaled down first
MAX_URL = 500
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"}


def clean_url(raw):
    """An address safe to publish, or "". Same rule as safe_url in process_raw
    and safeUrl on the page: http(s) only."""
    u = str(raw or "").strip().strip("​﻿")
    if re.match(r"^www\.[^\s/]+\.[a-z]{2,}", u, re.I):
        u = "https://" + u
    if not re.match(r"^https?://[^\s<>\"']+$", u, re.I):
        return ""
    return u[:MAX_URL]


def _gray(img):
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _detectors():
    ds = [cv2.QRCodeDetector()]
    aruco = getattr(cv2, "QRCodeDetectorAruco", None)
    if aruco is not None:
        ds.append(aruco())
    return ds


def _decode(det, img):
    out = []
    try:
        ok, texts, _pts, _ = det.detectAndDecodeMulti(img)
        if ok:
            out += [t for t in texts if t]
    except cv2.error:
        pass
    if not out:
        try:
            t, _pts, _ = det.detectAndDecode(img)
            if t:
                out.append(t)
        except cv2.error:
            pass
    return out


def _views(gray):
    """The same picture as the detectors may need it: as is, sharpened, and
    thresholded (a code on a coloured panel loses contrast in grey) and
    inverted (white modules on a dark background, which the detectors skip)."""
    yield gray
    blur = cv2.GaussianBlur(gray, (0, 0), 3)
    yield cv2.addWeighted(gray, 1.8, blur, -0.8, 0)
    yield cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    yield cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 8)
    yield cv2.bitwise_not(gray)  # light modules on a dark panel


def _tiles(gray, n):
    h, w = gray.shape[:2]
    th, tw = int(h / n * 1.5), int(w / n * 1.5)  # 50% overlap, so a code on a seam survives
    for i in range(n):
        for j in range(n):
            y, x = min(int(i * h / n), max(h - th, 0)), min(int(j * w / n), max(w - tw, 0))
            yield gray[y:y + th, x:x + tw]


def decode_image(img, deadline=None):
    """Every http(s) address in the QR codes found in one picture (numpy BGR
    or grey), in the order found, no repeats. Stops at `deadline` (monotonic)."""
    if img is None or img.size == 0:
        return []
    h, w = img.shape[:2]
    if h * w > MAX_PIXELS:
        k = (MAX_PIXELS / (h * w)) ** 0.5
        img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    gray = _gray(img)
    found, dets = [], _detectors()

    def take(texts):
        for t in texts:
            u = clean_url(t)
            if u and u not in found:
                found.append(u)
        return bool(found)

    # Whole picture first at a few scales, then tiles. Stop at the first hit:
    # a poster has one registration code, and the passes are not cheap.
    late = lambda: deadline is not None and time.monotonic() > deadline  # noqa: E731
    for scale in (1.0, 0.5, 1.5, 2.0):
        if late():
            return found
        g = gray if scale == 1.0 else cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        if max(g.shape) > 6000:
            continue
        for v in _views(g):
            for d in dets:
                if take(_decode(d, v)):
                    return found
    for n in (2, 3, 4):
        for tile in _tiles(gray, n):
            if late():
                return found
            for scale in (1.0, 2.0):
                t = tile if scale == 1.0 else cv2.resize(tile, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                for v in (t, cv2.threshold(t, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1], cv2.bitwise_not(t)):
                    for d in dets:
                        if take(_decode(d, v)):
                            return found
    return found


def _imdecode(data):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is not None:
        return img
    try:  # formats OpenCV cannot read (GIF, HEIC with pillow-heif, odd TIFFs)
        from PIL import Image
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            pass
        im = Image.open(io.BytesIO(data))
        im.seek(0)
        return cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:  # noqa: BLE001
        return None


def _pdf(data, deadline):
    import pymupdf
    out = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for page in list(doc)[:MAX_PAGES]:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(3, 3), colorspace=pymupdf.csRGB, alpha=False)
            img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            out += decode_image(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), deadline)
            if out or time.monotonic() > deadline:
                break
    return out


def _office(data, deadline):
    out = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        media = sorted(n for n in z.namelist() if re.search(r"/media/[^/]+$", n) and n[n.rfind("."):].lower() in IMAGE_EXT)
        for n in media[:40]:
            if z.getinfo(n).file_size > 25_000_000:
                continue
            out += decode_image(_imdecode(z.read(n)), deadline)
            if out or time.monotonic() > deadline:
                break
    return out


def links_from_bytes(data, name=""):
    """http(s) addresses held in the QR codes of one file, in the order found.
    The type is read from the bytes, not trusted from the name or mime."""
    if not data:
        return []
    deadline = time.monotonic() + BUDGET_S
    try:
        if data[:4] == b"%PDF":
            urls = _pdf(data, deadline)
        elif data[:2] == b"PK":
            urls = _office(data, deadline)
        else:
            urls = decode_image(_imdecode(data), deadline)
    except Exception as e:  # noqa: BLE001  a corrupt file must never stop a run
        print(f"[qr] {name or 'file'}: not read ({type(e).__name__}: {str(e)[:100]})", file=sys.stderr)
        return []
    seen = []
    for u in urls:
        if u not in seen:
            seen.append(u)
    return seen


if __name__ == "__main__":
    for p in sys.argv[1:]:
        with open(p, "rb") as f:
            print(p, links_from_bytes(f.read(), p))

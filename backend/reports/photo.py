"""
Report photos: every upload is decoded and re-encoded as a fresh JPEG.

Re-encoding drops ALL metadata (EXIF including GPS, XMP, IPTC, ICC, comments):
only pixels are copied into the new file. The camera's orientation is applied
to the pixels first, so the photo still stands the right way up. Large photos
are scaled to at most MAX_WIDTH pixels wide.

Guards: at most MAX_BYTES uploaded; at most MAX_PIXELS decoded (a small file
that claims a huge size is a "decompression bomb" and is refused); only
formats Pillow can open (the browser converts HEIC to JPEG first).
"""

from __future__ import annotations

import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000  # about 7300 x 5500
MAX_WIDTH = 1600
QUALITY = 82
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "MPO"}


class PhotoError(ValueError):
    """The upload is not a usable photo. ``code`` is for the UI's message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def clean_photo(data: bytes) -> bytes:
    """A metadata-free JPEG of the photo in ``data``; raises PhotoError."""
    if len(data) > MAX_BYTES:
        raise PhotoError("too_large", "The photo is larger than 8 MB.")
    if not data:
        raise PhotoError("unreadable", "The photo is empty.")
    try:
        with warnings.catch_warnings():
            # Pillow warns between MAX_IMAGE_PIXELS and twice it; treat both as errors
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data))
            if img.format not in ALLOWED_FORMATS:
                raise PhotoError("format", "Please use a JPEG or PNG photo.")
            w, h = img.size
            if w * h > MAX_PIXELS:
                raise PhotoError("too_many_pixels", "The photo has too many pixels.")
            img.load()
    except PhotoError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise PhotoError("too_many_pixels", "The photo has too many pixels.") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise PhotoError("format", "Please use a JPEG or PNG photo.") from exc

    # the camera's rotation, applied to the pixels before the metadata is dropped
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        background = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        img = background
    if img.width > MAX_WIDTH:
        img = img.resize((MAX_WIDTH, round(img.height * MAX_WIDTH / img.width)), Image.LANCZOS)

    # a new image holding only the pixels: nothing from the original file's headers
    pixels = Image.new("RGB", img.size)
    pixels.paste(img)
    out = io.BytesIO()
    pixels.save(out, format="JPEG", quality=QUALITY, optimize=True)
    return out.getvalue()

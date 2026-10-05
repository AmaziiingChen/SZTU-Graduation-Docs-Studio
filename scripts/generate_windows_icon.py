"""Create the Windows ICO from the existing application icon using Pillow."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
destination = root / "apps" / "desktop" / "build" / "icon.ico"
destination.parent.mkdir(parents=True, exist_ok=True)
with Image.open(root / "apps" / "desktop" / "public" / "app-icon.png") as source:
    source.convert("RGBA").save(
        destination, format="ICO", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)]
    )
print(f"Windows icon is ready: {destination}")

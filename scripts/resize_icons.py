from PIL import Image
import os


def resize_icon(source_path, target_dir, sizes):
    with Image.open(source_path) as img:
        for size in sizes:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            output_name = f"icon-{size}.png"
            output_path = os.path.join(target_dir, output_name)
            resized.save(output_path, "PNG")
            print(f"Saved {output_path} ({size}x{size})")


icon_dir = r"d:\GitHub\JiHa-Kim\prism-text-macros\public\icons"
source = os.path.join(icon_dir, "icon128.png")  # This is the 1024x1024 file

if os.path.exists(source):
    resize_icon(source, icon_dir, [16, 48, 128])
else:
    print(f"Source file not found: {source}")

from PIL import Image
import sys
import os

source_path = sys.argv[1]
dest_dir = sys.argv[2]
sizes = [16, 48, 128]

if not os.path.exists(dest_dir):
    os.makedirs(dest_dir)

with Image.open(source_path) as img:
    for size in sizes:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(os.path.join(dest_dir, f"icon-{size}.png"))
        print(f"Saved icon-{size}.png")

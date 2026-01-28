from PIL import Image
import os


def resize_image(input_path, output_path, size):
    with Image.open(input_path) as img:
        # Convert to RGB to ensure no alpha (as requested: "JPEG or 24-bit PNG (no alpha)")
        img = img.convert("RGB")

        # We want to crop and resize to fit the aspect ratio without stretching
        target_w, target_h = size
        img_w, img_h = img.size

        target_ratio = target_w / target_h
        img_ratio = img_w / img_h

        if img_ratio > target_ratio:
            # Image is wider than target
            new_w = int(img_h * target_ratio)
            left = (img_w - new_w) / 2
            img = img.crop((left, 0, left + new_w, img_h))
        else:
            # Image is taller than target
            new_h = int(img_w / target_ratio)
            top = (img_h - new_h) / 2
            img = img.crop((0, top, img_w, top + new_h))

        img = img.resize(size, Image.Resampling.LANCZOS)
        img.save(output_path, "PNG")
        print(f"Saved {output_path} with size {img.size}")


base_path = r"C:\Users\DefaultUser\.gemini\antigravity\brain\603e839c-58dd-4f62-86e4-9d6d24665c09"
small_in = os.path.join(base_path, "small_promo_tile_1769636711265.png")
marquee_in = os.path.join(base_path, "marquee_promo_tile_1769636723252.png")

small_out = os.path.join(base_path, "small_promo_tile_440x280.png")
marquee_out = os.path.join(base_path, "marquee_promo_tile_1400x560.png")

resize_image(small_in, small_out, (440, 280))
resize_image(marquee_in, marquee_out, (1400, 560))

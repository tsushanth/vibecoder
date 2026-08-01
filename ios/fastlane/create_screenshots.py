#!/usr/bin/env python3
"""Generate iOS App Store marketing screenshots emphasizing web/educational angle."""

from PIL import Image, ImageDraw, ImageFont
import os

# Paths
SRC = "/Users/sushanthtiruvaipati/Documents/GitHub/VibeBuild/android/fastlane/metadata/android/en-US/images/phoneScreenshots"
OUT = "/Users/sushanthtiruvaipati/Documents/GitHub/VibeBuild/ios/fastlane/screenshots"
os.makedirs(OUT, exist_ok=True)

# iPhone 6.7" dimensions
W, H = 1290, 2796

# Find a good font
def get_font(size, bold=False):
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size)
        except:
            continue
    return ImageFont.load_default()

font_title = get_font(78, bold=True)
font_subtitle = get_font(44)
font_small = get_font(36)

def create_gradient(w, h, color_top, color_bottom):
    """Create a vertical gradient image."""
    img = Image.new('RGB', (w, h))
    for y in range(h):
        ratio = y / h
        r = int(color_top[0] + (color_bottom[0] - color_top[0]) * ratio)
        g = int(color_top[1] + (color_bottom[1] - color_top[1]) * ratio)
        b = int(color_top[2] + (color_bottom[2] - color_top[2]) * ratio)
        for x in range(w):
            img.putpixel((x, y), (r, g, b))
    return img

def make_screenshot(filename, src_img_name, title, subtitle, subtitle2=None,
                    grad_top=(26, 5, 51), grad_bottom=(10, 10, 15)):
    """Create a marketing screenshot."""
    # Create gradient background
    bg = create_gradient(W, H, grad_top, grad_bottom)
    draw = ImageDraw.Draw(bg)

    # Draw title centered
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, 180), title, fill='white', font=font_title)

    # Draw subtitle centered
    bbox = draw.textbbox((0, 0), subtitle, font=font_subtitle)
    sw = bbox[2] - bbox[0]
    draw.text(((W - sw) // 2, 290), subtitle, fill=(170, 170, 204), font=font_subtitle)

    # Optional second subtitle
    if subtitle2:
        bbox = draw.textbbox((0, 0), subtitle2, font=font_small)
        s2w = bbox[2] - bbox[0]
        draw.text(((W - s2w) // 2, 355), subtitle2, fill=(136, 136, 170), font=font_small)

    # Overlay source screenshot
    src = Image.open(os.path.join(SRC, src_img_name))
    # Scale to fit width ~920px
    scale = 920 / src.width
    new_w = 920
    new_h = int(src.height * scale)
    src = src.resize((new_w, new_h), Image.LANCZOS)

    # Center horizontally, place near bottom
    x_offset = (W - new_w) // 2
    y_offset = H - new_h - 80
    bg.paste(src, (x_offset, y_offset))

    bg.save(os.path.join(OUT, filename))
    print(f"Created {filename} ({bg.size[0]}x{bg.size[1]})")

# Screenshot 1: Create screen
make_screenshot("01_describe.png", "1_en-US.png",
    "Describe Any Web Page",
    "AI generates HTML, CSS & JavaScript code",
    grad_top=(26, 5, 51))

# Screenshot 2: Generation progress
make_screenshot("02_generating.png", "6_en-US.png",
    "AI Writes Your Code",
    "Generates complete web pages in seconds",
    grad_top=(10, 21, 51))

# Screenshot 3: Preview
make_screenshot("03_preview.png", "8_en-US.png",
    "Preview Your Web Page",
    "See your HTML page rendered in real-time",
    grad_top=(26, 16, 51))

# Screenshot 4: Safari - KEY screenshot for review
make_screenshot("04_safari.png", "8_en-US.png",
    "Run in Safari",
    "Web pages served from our secure server",
    subtitle2="Open in Apple's Safari browser for full experience",
    grad_top=(10, 37, 21))

# Screenshot 5: Projects list
make_screenshot("05_projects.png", "7_en-US.png",
    "Manage Web Projects",
    "Save and organize your HTML/CSS creations",
    grad_top=(21, 21, 10))

# Screenshot 6: Subscription
make_screenshot("06_learn.png", "4_en-US.png",
    "Learn Web Development",
    "Create unlimited web pages with Pro",
    grad_top=(26, 10, 51))

print("\nAll screenshots created!")
print(f"Output directory: {OUT}")

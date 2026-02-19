#!/usr/bin/env python3
"""
Generate VibeCoder app icon
Simple gradient with code brackets
"""
from PIL import Image, ImageDraw, ImageFont
import os

# Icon sizes needed
SIZES = {
    'AppIcon-20@2x.png': 40,
    'AppIcon-20@3x.png': 60,
    'AppIcon-29@2x.png': 58,
    'AppIcon-29@3x.png': 87,
    'AppIcon-40@2x.png': 80,
    'AppIcon-40@3x.png': 120,
    'AppIcon-60@2x.png': 120,
    'AppIcon-60@3x.png': 180,
    'AppIcon-1024.png': 1024,
}

OUTPUT_DIR = '/Users/sushanthtiruvaipati/Documents/GitHub/vibecoder/ios/VibeCoder/Assets.xcassets/AppIcon.appiconset'

def create_gradient(size):
    """Create a blue-purple gradient background"""
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)

    # Blue to purple gradient
    for y in range(size):
        # Interpolate between blue and purple
        ratio = y / size
        r = int(60 + (140 - 60) * ratio)   # 60 -> 140
        g = int(100 + (80 - 100) * ratio)  # 100 -> 80
        b = int(200 + (200 - 200) * ratio) # 200 -> 200
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    return img

def draw_code_symbol(img, size):
    """Draw code brackets < > in the center"""
    draw = ImageDraw.Draw(img)

    # Calculate sizes
    bracket_width = size // 3
    bracket_height = size // 2
    line_width = max(size // 20, 3)

    center_x = size // 2
    center_y = size // 2

    # Left bracket <
    left_points = [
        (center_x - bracket_width//4, center_y - bracket_height//2),  # top
        (center_x - bracket_width//2, center_y),                      # middle
        (center_x - bracket_width//4, center_y + bracket_height//2),  # bottom
    ]
    draw.line(left_points, fill='white', width=line_width, joint='curve')

    # Right bracket >
    right_points = [
        (center_x + bracket_width//4, center_y - bracket_height//2),  # top
        (center_x + bracket_width//2, center_y),                      # middle
        (center_x + bracket_width//4, center_y + bracket_height//2),  # bottom
    ]
    draw.line(right_points, fill='white', width=line_width, joint='curve')

    return img

def create_icon(size):
    """Create a single icon at the specified size"""
    # Create gradient background
    img = create_gradient(size)

    # Add code symbol
    img = draw_code_symbol(img, size)

    return img

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for filename, size in SIZES.items():
        print(f'Generating {filename} ({size}x{size})...')
        icon = create_icon(size)
        output_path = os.path.join(OUTPUT_DIR, filename)
        icon.save(output_path, 'PNG')

    print(f'\n✓ All icons generated in {OUTPUT_DIR}')

if __name__ == '__main__':
    main()

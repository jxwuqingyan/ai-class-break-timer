#!/usr/bin/env python3
"""生成应用图标 build/icon.png（1024x1024）。
electron-builder 会自动从 PNG 生成 .icns / .ico。
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

SS = 2                 # 超采样倍率
SIZE = 1024
W = SIZE * SS

BG_TOP = (5, 22, 16)
BG_BOT = (2, 9, 7)
ACCENT = (61, 255, 154)
ACCENT_DIM = (61, 255, 154, 55)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main():
    random.seed(7)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # 1. 圆角矩形背景（竖向渐变）
    bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    grad = Image.new("RGBA", (1, W))
    for y in range(W):
        t = y / (W - 1)
        grad.putpixel((0, y), (
            int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t),
            255,
        ))
    grad = grad.resize((W, W))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, W - 1, W - 1), radius=int(226 * SS), fill=255)
    bg.paste(grad, (0, 0), mask)
    img = Image.alpha_composite(img, bg)

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 2. 背景代码雨竖条（极淡）
    cols = 26
    step = W // cols
    for i in range(cols):
        x = i * step + random.randint(0, step // 2)
        y0 = random.randint(0, W // 2)
        h = random.randint(W // 8, W // 2)
        a = random.randint(6, 26)
        d.rectangle((x, y0, x + int(3.5 * SS), y0 + h), fill=(61, 255, 154, a))

    # 3. 中心柔光
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(330 * SS)
    gd.ellipse((W // 2 - r, W // 2 - r, W // 2 + r, W // 2 + r),
               fill=(24, 120, 78, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(90 * SS))
    layer = Image.alpha_composite(layer, glow)

    d = ImageDraw.Draw(layer)

    # 4. 刻度环（暗）
    pad = int(150 * SS)
    ring = (pad, pad, W - pad, W - pad)
    lw = int(26 * SS)
    d.ellipse(ring, outline=(61, 255, 154, 46), width=int(lw * 0.7))

    # 5. 进度弧（约 300°，从 12 点顺时针）
    arc_glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc_glow)
    ad.arc(ring, start=-90, end=210, fill=(61, 255, 154, 190), width=lw)
    arc_glow = arc_glow.filter(ImageFilter.GaussianBlur(18 * SS))
    layer = Image.alpha_composite(layer, arc_glow)

    d = ImageDraw.Draw(layer)
    d.arc(ring, start=-90, end=210, fill=ACCENT + (255,), width=lw)

    # 弧线端点小球
    cx = cy = W / 2
    rad = (W - 2 * pad) / 2
    end_angle = math.radians(210)
    ex = cx + rad * math.cos(end_angle)
    ey = cy + rad * math.sin(end_angle)
    br = int(lw * 0.85)
    d.ellipse((ex - br, ey - br, ex + br, ey + br), fill=(190, 255, 220, 255))

    # 6. 表针
    def hand(angle_deg, length, width):
        a = math.radians(angle_deg - 90)
        x = cx + math.cos(a) * length
        y = cy + math.sin(a) * length
        d.line((cx, cy, x, y), fill=(232, 255, 244, 255), width=int(width), joint="curve")
        d.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2),
                  fill=(232, 255, 244, 255))

    hand(0, rad * 0.52, 30 * SS)     # 分针指 12 点
    hand(115, rad * 0.36, 38 * SS)   # 时针指约 4 点方向

    # 中心点
    cr = int(20 * SS)
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=ACCENT + (255,))
    d.ellipse((cx - cr * 2.6, cy - cr * 2.6, cx + cr * 2.6, cy + cr * 2.6),
              outline=(61, 255, 154, 90), width=int(3 * SS))

    img = Image.alpha_composite(img, layer)

    # 7. 轻微内描边
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((2 * SS, 2 * SS, W - 2 * SS, W - 2 * SS),
                        radius=int(226 * SS),
                        outline=(120, 255, 200, 38), width=int(2 * SS))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(here, "build")
    os.makedirs(build_dir, exist_ok=True)
    path = os.path.join(build_dir, "icon.png")
    out.save(path, "PNG")
    print("saved:", path, out.size)


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""生成 DMG 拖拽安装背景图（深色代码雨风格，带指向 Applications 的箭头）。

用法：python3 scripts/make-dmg-background.py
输出：build/dmg-background.png（660x400）与 build/dmg-background@2x.png（1320x800）
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1320, 800  # @2x 尺寸，对应 DMG 窗口 660x400
BG = (7, 12, 9, 255)          # 近黑绿底，匹配代码雨主题
GREEN = (0, 255, 120)
DIM_GREEN = (0, 160, 80)
TEXT = (235, 245, 235)

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"

# 与 electron-builder dmg.contents 中的坐标对应（@2x）
APP_X, APP_Y = 360, 560       # app 图标位置
LINK_X, LINK_Y = 960, 560     # Applications 位置


def font(size):
    return ImageFont.truetype(FONT_PATH, size, index=0)


def draw_arrow(d):
    """从 app 图标上方画一条弧线箭头指向 Applications 上方。"""
    y_lift = 90
    x0, y0 = APP_X + 60, APP_Y - y_lift
    x1, y1 = LINK_X - 60, LINK_Y - y_lift
    # 弧线：用多段直线近似二次贝塞尔
    cx, cy = (x0 + x1) // 2, min(y0, y1) - 120
    pts = []
    for t in [i / 24 for i in range(25)]:
        bx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1
        by = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1
        pts.append((bx, by))
    d.line(pts, fill=GREEN, width=10, joint="curve")
    # 箭头头部（指向 Applications）
    ex, ey = pts[-1]
    d.polygon([(ex - 14, ey - 42), (ex + 26, ey + 6), (ex - 40, ey + 10)], fill=GREEN)
    return (x0 + x1) // 2, cy - 40


def main():
    img = Image.new("RGBA", (W, H), BG)

    # 背景铺少量代码雨感的暗绿竖线纹理
    d = ImageDraw.Draw(img)
    import random
    random.seed(42)
    for _ in range(90):
        x = random.randrange(0, W, 8)
        y = random.randrange(0, H, 8)
        ln = random.randrange(30, 140)
        d.line([(x, y), (x, y + ln)], fill=(0, 60, 30, 90), width=2)

    # 顶部提示文案
    t1 = "将「课间休息计时」拖入右侧 Applications 文件夹完成安装"
    f1 = font(38)
    tw = d.textlength(t1, font=f1)
    d.text(((W - tw) / 2, 150), t1, font=f1, fill=TEXT)

    mx, my = draw_arrow(d)
    t2 = "拖我"
    f2 = font(30)
    tw2 = d.textlength(t2, font=f2)
    d.text((mx - tw2 / 2, my - 60), t2, font=f2, fill=DIM_GREEN)

    img.save("build/dmg-background.png".replace("dmg-background", "dmg-background@2x"))
    img.resize((660, 400), Image.LANCZOS).save("build/dmg-background.png")
    print("OK: build/dmg-background.png (660x400) + build/dmg-background@2x.png (1320x800)")


if __name__ == "__main__":
    main()

"""Adapt the approved Note optical masters to Android resources without redrawing paths."""
import copy
import hashlib
import json
import math
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/branding-runtime"))
from PIL import Image

BRAND = ROOT / "branding/m1racle-note/v1"
RES = ROOT / "mobile/app/src/main/res"
OUTPUT = ROOT / "output/icon-adoption-20261016/android"
ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)


def attr(name):
    return "{" + ANDROID + "}" + name


def write_xml(path, node):
    path.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(node, space="    ")
    path.write_text('<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(node, encoding="unicode") + "\n", encoding="utf-8")


def convert(source, destination):
    tag = source.tag.rsplit("}", 1)[-1]
    if tag == "g":
        group = ET.SubElement(destination, "group")
        transform = source.attrib.get("transform", "")
        commands = re.findall(r"(translate|scale)\(([^)]+)\)", transform)
        if re.sub(r"(translate|scale)\([^)]+\)", "", transform).strip():
            raise ValueError("Unsupported SVG transform: " + transform)
        for operation, arguments in commands:
            values = re.split(r"[\s,]+", arguments.strip())
            if len(values) not in (1, 2):
                raise ValueError("Unexpected transform arity")
            x, y = values[0], values[1] if len(values) == 2 else ("0" if operation == "translate" else values[0])
            key = "translate" if operation == "translate" else "scale"
            group = ET.SubElement(group, "group", {attr(key + "X"): x, attr(key + "Y"): y})
        for child in source:
            convert(child, group)
    elif tag == "path":
        attributes = {attr("pathData"): source.attrib["d"], attr("fillColor"): "@color/m1_launcher_foreground"}
        if source.attrib.get("fill-rule") == "evenodd":
            attributes[attr("fillType")] = "evenOdd"
        ET.SubElement(destination, "path", attributes)
    else:
        raise ValueError("Unexpected artwork element: " + tag)


def artwork(size):
    source = ET.parse(BRAND / f"svg/icon-{size}-day.svg").getroot()
    return [element for element in source if element.tag.rsplit("}", 1)[-1] == "g"]


def vector(size, rendered_size, name):
    root = ET.Element("vector", {attr("width"): "108dp", attr("height"): "108dp", attr("viewportWidth"): "108", attr("viewportHeight"): "108"})
    scale = rendered_size / size
    inset = (108 - rendered_size) / 2
    outer = ET.SubElement(root, "group", {attr("scaleX"): str(scale), attr("scaleY"): str(scale), attr("translateX"): str(inset), attr("translateY"): str(inset)})
    original = artwork(size)
    for group in original:
        convert(group, outer)
    # Source path data remains byte-for-byte identical after XML attribute decoding.
    expected = [e.attrib["d"] for group in original for e in group.iter() if e.tag.rsplit("}", 1)[-1] == "path"]
    actual = [e.attrib[attr("pathData")] for e in root.iter("path")]
    assert actual == expected
    write_xml(RES / "drawable" / name, root)
    preview_groups = copy.deepcopy(original)
    for group in preview_groups:
        for element in group.iter():
            element.tag = element.tag.rsplit("}", 1)[-1]
    body = "".join(ET.tostring(group, encoding="unicode") for group in preview_groups)
    return f'<g transform="translate({inset} {inset}) scale({scale})">{body}</g>', len(actual)


OUTPUT.mkdir(parents=True, exist_ok=True)
# The original 512px icon maps to the visible 72dp viewport inside the 108dp adaptive layer.
# The background tile is deliberately omitted: the launcher owns the external mask.
foreground, full_paths = vector(512, 72, "ic_launcher_foreground.xml")
# Small monochrome/themed surfaces use the approved N optical master, not a reduced full lockup.
monochrome, mono_paths = vector(32, 90, "ic_launcher_monochrome.xml")

for theme, background, foreground_color in [("day", "#FFFFFF", "#181818"), ("night", "#242424", "#F5F5F5")]:
    values = ET.Element("resources")
    ET.SubElement(values, "color", {"name": "m1_launcher_background"}).text = background
    ET.SubElement(values, "color", {"name": "m1_launcher_foreground"}).text = foreground_color
    write_xml(RES / ("values" if theme == "day" else "values-night") / "launcher_colors.xml", values)
    image = Image.open(BRAND / f"png/icon-1024-{theme}.png").convert("RGBA")
    for density, pixels in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        # Android resource qualifiers put night before density.
        destination = RES / f"mipmap-{'night-' if theme == 'night' else ''}{density}"
        destination.mkdir(exist_ok=True)
        if pixels == 48:
            data = (BRAND / f"png/icon-48-{theme}.png").read_bytes()
            (destination / "ic_launcher.png").write_bytes(data)
        else:
            image.resize((pixels, pixels), Image.Resampling.LANCZOS).save(destination / "ic_launcher.png")

for api, themed in [(26, False), (33, True)]:
    adaptive = ET.Element("adaptive-icon")
    ET.SubElement(adaptive, "background", {attr("drawable"): "@color/m1_launcher_background"})
    ET.SubElement(adaptive, "foreground", {attr("drawable"): "@drawable/ic_launcher_foreground"})
    if themed:
        ET.SubElement(adaptive, "monochrome", {attr("drawable"): "@drawable/ic_launcher_monochrome"})
    for name in ["ic_launcher.xml", "ic_launcher_round.xml"]:
        write_xml(RES / f"mipmap-anydpi-v{api}" / name, copy.deepcopy(adaptive))

# Raster measurement checks the essential ink against the conservative central 66dp safe circle.
source = Image.open(BRAND / "png/icon-512-day.png").convert("RGBA")
ink = [(x + .5, y + .5) for y in range(512) for x in range(512) if source.getpixel((x, y))[3] > 128 and max(source.getpixel((x, y))[:3]) < 128]
radius = max(math.hypot(x - 256, y - 256) for x, y in ink) * 72 / 512
assert radius < 33
small = Image.open(BRAND / "png/icon-32-day.png").convert("RGBA")
small_ink = [(x + .5, y + .5) for y in range(32) for x in range(32) if small.getpixel((x, y))[3] > 128 and max(small.getpixel((x, y))[:3]) < 128]
mono_radius = max(math.hypot(x - 16, y - 16) for x, y in small_ink) * 90 / 32
assert mono_radius < 33
report = {
    "source": "branding/m1racle-note/v1/svg/icon-512-day.svg",
    "sourceSha256": hashlib.sha256((BRAND / "svg/icon-512-day.svg").read_bytes()).hexdigest(),
    "foregroundPathsPreserved": full_paths,
    "monochromePathsPreserved": mono_paths,
    "adaptiveLayerDp": 108,
    "originalTileMappedToDp": 72,
    "essentialInkMaximumRadiusDp": radius,
    "monochromeInkMaximumRadiusDp": mono_radius,
    "safeCircleRadiusDp": 33,
    "maskAppliedByLauncher": True,
    "resourceFiles": sorted(str(path.relative_to(ROOT)).replace("\\", "/") for path in RES.rglob("*launcher*")),
    "boundary": "Source geometry/raster-mask check only; platform rendering is verified separately.",
}
(OUTPUT / "source-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

masks = {"Circle": '<circle cx="36" cy="36" r="36"/>', "Squircle": '<rect width="72" height="72" rx="18"/>', "Square": '<rect width="72" height="72"/>', "Teardrop": '<path d="M36 0H72V36C72 56 56 72 36 72S0 56 0 36 16 0 36 0Z"/>'}
cards = []
for theme, bg, fg in [("Day", "#FFFFFF", "#181818"), ("Night", "#242424", "#F5F5F5")]:
    for name, shape in masks.items():
        symbol = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" style="color:{fg}"><defs><clipPath id="mask-{theme}-{name}">{shape}</clipPath></defs><g clip-path="url(#mask-{theme}-{name})"><rect width="72" height="72" fill="{bg}"/><g transform="translate(-18 -18)">{foreground}</g></g></svg>'
        cards.append(f'<article><p>{theme} · {name}</p><div class="large">{symbol}</div><div class="sizes"><span style="width:48px;height:48px">{symbol}</span><span style="width:32px;height:32px">{symbol}</span></div></article>')
html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Note Android icon mask preview</title><style>*{box-sizing:border-box}body{margin:0;background:#eeeeee;color:#242424;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}main{padding:32px;max-width:1080px;margin:auto}h1{font-size:24px;margin:0 0 8px}.note{color:#666;margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}article{padding:16px;background:#ddd;border-radius:12px}article p{font-size:12px;margin:0 0 16px}.large{width:128px;height:128px;margin:auto}svg{width:100%;height:100%;display:block}.sizes{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:20px}span{display:inline-block}</style><main><h1>M1racle Note · Android 图标</h1><p class="note">正式母标 + Note；启动器遮罩预览，非设备截图。下排分别为 48px / 32px。主题单色层使用正式 N。</p><div class="grid">' + ''.join(cards) + '</div></main></html>'
(OUTPUT / "masks.html").write_text(html, encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))

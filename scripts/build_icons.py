"""long: 将官方 Lucide 图标裁剪为本地精灵图，手机只请求实际用到的图标，无需访问 CDN。"""
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "node_modules" / "lucide-static"
NAMES = "audio-lines library history folder folder-open film music search x chevron-right arrow-left arrow-up-right layout-grid list arrow-down-wide-narrow refresh-cw sun moon play pause skip-back skip-forward rotate-ccw rotate-cw volume-2 volume-x repeat sliders-horizontal circle-alert headphones cloud-check cloud-upload cloud-off check circle-play".split()
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
sprite = ET.Element("{%s}svg" % NS)
for name in NAMES:
    source = ET.parse(PACKAGE / "icons" / (name + ".svg")).getroot()
    symbol = ET.SubElement(sprite, "{%s}symbol" % NS, {"id": name, "viewBox": "0 0 24 24"})
    symbol.extend(source)
ET.indent(sprite, space="  ")
ET.ElementTree(sprite).write(ROOT / "static" / "icons.svg", encoding="utf-8", xml_declaration=True)
(ROOT / "static" / "lucide-LICENSE").write_bytes((PACKAGE / "LICENSE").read_bytes())
print("Built %d Lucide icons" % len(NAMES))

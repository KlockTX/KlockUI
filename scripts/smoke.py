"""KlockUI 冒烟自检：不需要起服务，几秒跑完，用来在改完代码后确认基本盘没塌。

用法（必须用带依赖的 Python，即 ComfyUI 的 venv）：
    D:\\AI\\ComfyUI\\venv\\Scripts\\python.exe scripts\\smoke.py

为什么要有它：
2026-11-19 给请求钉住底模时，把「不带扩展名的 stem」直接塞进了 UNETLoader，
ComfyUI 报 value_not_in_list，生成全挂。这类错误的共同点是**只在前端点生成时才暴露**。
把纯函数层的检查放到这里，改完就能立刻跑一遍。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FAILED = []
PASSED = []


def check(name, fn):
    try:
        fn()
        PASSED.append(name)
        print("  ok   %s" % name)
    except AssertionError as exc:
        FAILED.append((name, str(exc) or "断言失败"))
        print("  FAIL %s -> %s" % (name, exc))
    except Exception as exc:  # noqa: BLE001
        FAILED.append((name, "%s: %s" % (type(exc).__name__, exc)))
        print("  ERR  %s -> %s: %s" % (name, type(exc).__name__, exc))


def main():
    print("[1] 模块可导入")
    import comfy_bridge
    import server  # noqa: F401

    print("[2] 模型名规整")
    files = comfy_bridge._model_filenames()

    def stem_resolves():
        if not files:
            return
        stem = comfy_bridge._stem(files[0])
        got = comfy_bridge.resolve_model_file(stem)
        assert got == files[0], "stem 未解析成 %s，得到 %s" % (files[0], got)

    def filename_kept():
        if not files:
            return
        got = comfy_bridge.resolve_model_file(files[0])
        assert got == files[0], "完整文件名被改写：%s" % got

    def unknown_kept():
        got = comfy_bridge.resolve_model_file("definitely-not-installed")
        assert got == "definitely-not-installed", "未知模型不该被替换，得到 %s" % got

    check("stem -> 完整文件名", stem_resolves)
    check("完整文件名保持原样", filename_kept)
    check("未知模型原样返回", unknown_kept)

    print("[3] 预设配方")
    preset_dir = os.path.join(ROOT, "presets")
    for name in sorted(os.listdir(preset_dir)):
        if not name.endswith(".json"):
            continue

        def verify(path=os.path.join(preset_dir, name), label=name):
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            assert isinstance(data, dict), "顶层必须是对象"
            assert data.get("arch") in ("krea", "zimage", "anima", "moss", "sdxl"), "arch 非法：%s" % data.get("arch")
            assert data.get("prompt"), "缺少 prompt"
            assert data.get("size", {}).get("ratio"), "缺少 size.ratio"
            if data["arch"] == "krea":
                assert "shift" not in data, "Krea 配方不该写 shift"

        check("preset %s" % name, verify)

    print("\n通过 %d / 失败 %d" % (len(PASSED), len(FAILED)))
    if FAILED:
        for name, reason in FAILED:
            print("  - %s: %s" % (name, reason))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

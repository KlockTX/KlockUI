#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""WD14 图反推：图片 -> 标签。

权重放 D:/AI/models/wd14/，用 SmilingWolf 的 wd-v1-4-moat-tagger-v2（Danbooru 标注体系，
和 Anima / Illustrious 系的标签语言一致，所以反推出来的词底模真的认识）。

设计要点：
  * 懒加载：没点过「图反推」就不占内存；onnxruntime 只在 CPU 上跑，不抢显存。
  * 预处理按 SmilingWolf 官方示例：透明底先铺白，补成正方形再缩到 448（拉伸会毁比例）。
  * 阈值按类别分开：general 0.35 / character 0.85——角色名误报代价高，宁可少给。
"""
import io
import os
import threading

MODEL_DIR = os.environ.get("KLOCK_WD14_DIR") or r"D:\AI\models\wd14"
MODEL_FILE = os.environ.get("KLOCK_WD14_MODEL") or "wd-v1-4-moat-tagger-v2.onnx"
TAGS_FILE = os.environ.get("KLOCK_WD14_TAGS") or "selected_tags.csv"
INPUT_SIZE = 448

_lock = threading.Lock()
_state = {"session": None, "names": None, "categories": None, "error": None}


def _paths():
    model = MODEL_FILE if os.path.isabs(MODEL_FILE) else os.path.join(MODEL_DIR, MODEL_FILE)
    tags = TAGS_FILE if os.path.isabs(TAGS_FILE) else os.path.join(MODEL_DIR, TAGS_FILE)
    return model, tags


def available():
    model, tags = _paths()
    return os.path.isfile(model) and os.path.isfile(tags)


def _load():
    """返回 (session, names, categories)；失败抛 RuntimeError（带可读原因）。"""
    with _lock:
        if _state["session"] is not None:
            return _state["session"], _state["names"], _state["categories"]
        model, tags = _paths()
        if not os.path.isfile(model):
            raise RuntimeError("找不到 WD14 模型：%s" % model)
        if not os.path.isfile(tags):
            raise RuntimeError("找不到标签表：%s" % tags)
        try:
            import onnxruntime as ort
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("onnxruntime 不可用：%s" % exc)
        try:
            session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
            names, categories = [], []
            with open(tags, "r", encoding="utf-8") as handle:
                header = handle.readline()
                cols = [c.strip() for c in header.split(",")]
                idx_name = cols.index("name") if "name" in cols else 1
                idx_cat = cols.index("category") if "category" in cols else 2
                for line in handle:
                    parts = line.rstrip("\n").split(",")
                    if len(parts) <= max(idx_name, idx_cat):
                        continue
                    names.append(parts[idx_name])
                    categories.append(parts[idx_cat])
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("加载 WD14 失败：%s" % exc)
        _state.update({"session": session, "names": names, "categories": categories})
        return session, names, categories


def status():
    model, tags = _paths()
    return {
        "available": available(),
        "model": model,
        "tags": tags,
        "loaded": _state["session"] is not None,
        "installed": os.path.isfile(model) and os.path.isfile(tags),
    }


def _prepare(blob):
    from PIL import Image
    import numpy as np

    image = Image.open(io.BytesIO(blob))
    image.load()
    image = image.convert("RGBA")
    canvas = Image.new("RGBA", image.size, (255, 255, 255, 255))
    canvas.alpha_composite(image)
    image = canvas.convert("RGB")
    # 补成正方形再缩：直接 resize 到 448×448 会把竖图压扁，人物比例全错。
    side = max(image.size)
    square = Image.new("RGB", (side, side), (255, 255, 255))
    square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    square = square.resize((INPUT_SIZE, INPUT_SIZE), Image.BICUBIC)
    array = np.asarray(square, dtype=np.float32)[None, ...]
    return array


def interrogate(blob, general_th=0.35, character_th=0.85, limit=40):
    """返回 {tags:[{tag,score,category}], general:[], character:[], elapsed}。"""
    import time
    import numpy as np

    started = time.time()
    session, names, categories = _load()
    tensor = _prepare(blob)
    input_name = session.get_inputs()[0].name
    scores = session.run(None, {input_name: tensor})[0][0]
    scores = np.asarray(scores, dtype=np.float32)

    general, character, rating = [], [], []
    for index, score in enumerate(scores):
        if index >= len(names):
            break
        value = float(score)
        category = str(categories[index]).strip()
        tag = names[index].replace("_", " ").strip()
        if not tag:
            continue
        if category == "0":                       # general
            if value >= general_th:
                general.append({"tag": tag, "score": round(value, 3), "category": "general"})
        elif category == "4":                     # character
            if value >= character_th:
                character.append({"tag": tag, "score": round(value, 3), "category": "character"})
        elif category == "9":                     # rating
            rating.append({"tag": tag, "score": round(value, 3)})

    general.sort(key=lambda item: item["score"], reverse=True)
    character.sort(key=lambda item: item["score"], reverse=True)
    rating.sort(key=lambda item: item["score"], reverse=True)
    tags = character + general
    return {
        "tags": tags[:limit],
        "general": [item["tag"] for item in general],
        "character": [item["tag"] for item in character],
        "rating": rating[:3],
        "elapsed": round((time.time() - started) * 1000),
    }

# KlockUI

把 ComfyUI 包成一个能直接用的本地出图工作台。填提示词、点生成，其它全在界面上。

面向 8–16GB 显存的消费级显卡设计：多架构预设、LoRA 一键组合、参数配方可存可分享。

> **不含推理引擎，也不含任何模型权重。** 引擎（ComfyUI）与底模由 `install.md` 指导安装，
> 全部由 agent 完成——你只需要回答"要装哪几个架构"。

---

## 它解决什么

ComfyUI 很强，但每换一个底模就要重连一遍节点、调一遍采样参数、改一遍提示词写法。
KlockUI 把这些固定在代码里：

| | |
|---|---|
| **按架构自动配参数** | 换模型时自动套用该架构的采样器、步数、CFG、shift、文本编码器类型 |
| **LoRA 按架构隔离** | 149 支 LoRA 只会出现在兼容的底模下，权重可逐个微调 |
| **参数配方可分享** | 整套设置存成 `.json`，拖进界面即还原；也能导出给朋友 |
| **本地优先** | 全部跑在本机，不联网、不上传、不需要账号 |

支持的架构：

| 架构 | 参数量 | 特点 |
|---|---|---|
| **Anima 2.9B** | 2.9B | 写实/二次元通用，28–50 步 |
| **Z-Image Turbo** | 6B | 9 步出图，唯一能正确渲染中文的 |
| **Krea 2 Turbo** | 12.9B | 画质上限最高 |
| **MOSS-Image** | 5B | JSON 布局排版、中英文字 |
| **SDXL / Pony / Illustrious** | 6–7B | 生态最大（需自备底模） |

---

## 快速开始

```bash
git clone <this-repo> KlockUI
```

然后**让 agent 读 `install.md` 执行**——它会给 ComfyUI 建环境、按你的显卡选量化档、
问你要装哪些架构、逐文件校验下载、最后跑一张测试图验收。

手动装也可以，`install.md` 里的每一步都带断言，照着走即可。

装完后启动：

```bash
# Windows：双击 start.bat，或
start.bat          # 自动拉起引擎 + 界面
stop.bat           # 只停界面，引擎保留
```

```bash
# 任意平台
../ComfyUI/venv/bin/python server.py
```

打开 http://127.0.0.1:7861 。

---

## 目录

```
KlockUI/
├─ server.py            # 本地 HTTP 服务、任务队列、图库
├─ comfy_bridge.py      # 参数 → ComfyUI 工作流（所有架构知识都在这）
├─ interrogate.py       # WD14 图反推（可选）
├─ index.html           # 单页前端
├─ assets/              # 前端逻辑、图库与词库
├─ vendor/              # mdui 与图标字体（离线可用）
├─ presets/             # 示例参数配方（12 个 JSON）
├─ install.md           # 安装说明（写给 agent）
├─ skill.md             # 配置知识与排错（写给 agent）
├─ models.manifest.json # 模型清单：去哪下、多大、什么许可
└─ requirements.txt
```

**关键设计**：架构判断基于权重张量名（`_classify()`），不看文件名。
文件名会骗人，权重不会。

---

## 参数配方

界面上调好的整套设置可以导出成 JSON：

```json
{
  "klockui": 1,
  "name": "初音 · 雨夜霓虹",
  "model": "krea2_turbo_int8_convrot.safetensors",
  "prompt": "anime illustration, cel shading, ...",
  "quality": "standard",
  "size": { "width": 832, "height": 1216 },
  "steps": 12, "cfg": 1,
  "sampler": "Euler", "scheduler": "Simple",
  "loras": [{ "name": "krea2_yoneyama_mai", "weight": 0.75 }]
}
```

拖到界面上即还原。字段说明见 `presets/README.md`。

---

## 许可

代码：**GPL-3.0**（见 `LICENSE`）。

模型权重不适用本许可。各架构的授权情况见 `models.manifest.json` 的 `license` 字段，
其中 Anima 系为**非商用**许可，商用前请自行替换。

前端依赖 [mdui](https://www.mdui.org/) 与 Material Icons，许可见 `vendor/`。
推理引擎为 [ComfyUI](https://github.com/comfyanonymous/ComfyUI)，与本项目独立。

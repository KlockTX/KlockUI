# KlockUI 安装说明（面向 agent）

> **读者是安装代理，不是人。**
> 按阶段执行，每阶段通过验收再进下一阶段。任一步失败跳到第 8 节，**不要跳过断言继续装**。
>
> **本仓库不含推理引擎，也不含任何模型权重。** 下面所有内容都由你（agent）在实际安装时获取。
>
> **触发方式**（三种都走同一套流程）：
> 1. 用户给你仓库链接（`https://github.com/KlockTX/KlockUI`）并要求"按 install.md 安装"；
> 2. 用户直接给你一个 `KlockUI-<版本>.zip` 压缩包，要求安装配置 ——
>    解压后读包内 `AGENT-INSTALL.md`，**从第 1 节开始照常执行**，不要因为它不是 git 仓库就停下；
> 3. 你已在本目录看到本文件。

## 0. 契约

| 项 | 约定 |
|---|---|
| 允许 | 建目录、装 Python 包、下载模型、写配置、启动本地进程 |
| 禁止 | 改系统 Python、覆盖已装 torch、改 ComfyUI 源码、删除用户已有模型、在已有引擎时另起一个抢 8188 |
| 顺序 | **P0 先探测本机 ComfyUI / 8188，命中就复用，只有全未命中才 clone** |
| 结构 | KlockUI 与 ComfyUI **同级**放在同一父目录（路径探测依赖这个结构） |
| 结束必须交付 | 两个端口可访问、一张测试图、环境报告（第 7 节） |

```
<父目录>/
├─ ComfyUI/      # 你自己 clone
└─ KlockUI/      # 本仓库
```

---

## 1. 前置检查

```bash
python3 -V                                        # 需要 3.10 – 3.13
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
df -h .                                           # 全装约 55GB，单架构约 8GB
git --version
```

网络探测（决定后面用哪个源）：

```bash
time curl -s -o /dev/null -m 10 -w "%{speed_download}\n" \
  "https://hf-mirror.com/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors"
```

| 探测结果 | 结论 |
|---|---|
| 能下且 > 300KB/s | 用国内源 `hf-mirror.com` |
| 能连但很慢 / 报错 | 仍用国内源，但提醒用户可能很慢 |
| 完全连不上 | 让用户开代理，再设 `HTTPS_PROXY`，走 `huggingface.co` |

**判断依据是实际字节数，不是 HTTP 状态码**——镜像限流时会返回 200 但只有几百字节。

Windows 注意：路径不要含中文或空格；用 `venv\Scripts\python.exe`。

---

## 2. 询问用户（必做，不要跳过）

安装前必须确认两件事。**只问一次，用一次提问覆盖，不要反复打断。**

### 2.1 要哪些架构

| 架构 | 体积 | 适合 | 许可 |
|---|---|---|---|
| **Anima 2.9B** | 5.4GB | 写实 / 二次元通用，28–50 步 | 非商用 |
| Z-Image Turbo | 12GB | 9 步极快，**图里能写中文** | Apache-2.0 |
| Krea 2 Turbo | 19GB | 画质上限最高，12.9B | 社区（年收 <100 万美元免费） |
| MOSS-Image | 13GB | JSON 布局排版 + 中英文字 | Apache-2.0 |

话术建议：

> KlockUI 本体不含模型。要装哪些？
> ① Anima（推荐，5.4GB，通用）
> ② Z-Image（12GB，出图快、能写中文）
> ③ Krea 2（19GB，画质最好，8GB 显存会很慢）
> ④ MOSS（13GB，做海报排版）
> 可以多选，也可以只装 ①。

**只装一个也能完整出图**，不要默认全装。

### 2.2 显存档位

| 显存 | 启动参数 |
|---|---|
| ≥16GB | 不加 `--lowvram` |
| 8–12GB | `--lowvram --cache-ram 2` |
| <8GB | `--lowvram --cache-ram 1`，且只装 Anima |

---

## 3. P0 · ComfyUI：先探测本机，再决定要不要装

**不要一上来就 clone。** 先花一分钟探测，命中就跳过整个 P0：

```bash
# A. 端口是否已有引擎在跑（最优先，命中就直接进 P1）
curl -fsS http://127.0.0.1:8188/system_stats && echo "ENGINE_READY"

# B. 本机是否已有 ComfyUI 目录（按优先级找，找到第一个就停）
ls -d ../ComfyUI ../ComfyUI_windows_portable ~/ComfyUI /d/AI/ComfyUI 2>/dev/null

# C. 找到后确认它是能用的，而不是空壳
<找到的目录>/venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available())" \
  || <找到的目录>/venv/Scripts/python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
test -f <找到的目录>/main.py && echo "COMFY_USABLE"
```

**探测结果怎么处理**

| 结果 | 你要做的 |
|---|---|
| A 命中（`ENGINE_READY`） | **整个 P0 跳过**，直接进第 4 节。别另起一个引擎抢 8188 端口 |
| A 未命中、B/C 命中 | **复用这个目录**：不要 clone、不要新建 venv、不要覆盖已装的 torch；直接启动它（见 6.1），确认 8188 通了再进 P1 |
| 全未命中 | 才走下面的全新安装 |

> **KlockUI 不要求 ComfyUI 一定和它同级。** 桥接层只连 `127.0.0.1:8188`；
> 同级目录只是 `start.bat` 的默认探测路径，实际路径可以用 `KLOCK_COMFY_DIR` 覆盖。
> 所以本机已有 ComfyUI 时，**优先复用**，不要为了凑目录结构去搬动或复制它。

---

### 全新安装（仅当上面全未命中）

```bash
cd <父目录>
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python3 -m venv venv
```

torch 的 CUDA 版本按驱动选（`nvidia-smi` 右上角）：

```bash
venv/bin/pip install --upgrade pip
venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
venv/bin/pip install -r requirements.txt
```

Windows 把 `venv/bin/` 换成 `venv\Scripts\`。

**验收（必须过）**

```bash
venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

输出末尾是 `True` 才继续。`False` 说明驱动/CUDA 不匹配，**停在这里报告**。

---

## 4. P1 · 装 KlockUI

```bash
cd <父目录>
git clone <klockui-repo> KlockUI
cd KlockUI
../ComfyUI/venv/bin/pip install -r requirements.txt
```

复用 ComfyUI 的 venv，**不要另建环境**（两套 torch 会互相覆盖）。

**验收**

```bash
../ComfyUI/venv/bin/python -c "import server, comfy_bridge; print('ok')"
```

### 4.1 安装 skill（强烈建议，别跳过）

`skill.md` 是给 agent 用的配置手册：架构参数、排错表、加/删模型的七处改动、文件与功能索引。
把它装进你的技能目录，以后用户问"怎么换个底模""报错了"，下一个会话的 agent 能直接查到，
不必重新翻代码。

**装法**：整份复制成 `SKILL.md`，目录名用 `klockui`。

```bash
# WorkBuddy
mkdir -p ~/.workbuddy/skills/klockui
cp skill.md ~/.workbuddy/skills/klockui/SKILL.md

# Claude Code
mkdir -p ~/.claude/skills/klockui
cp skill.md ~/.claude/skills/klockui/SKILL.md

# 其他 agent：放进它约定的技能目录，文件名统一叫 SKILL.md
```

Windows 下用 `%USERPROFILE%\.workbuddy\skills\klockui\SKILL.md` 这种形式。

**不用改内容**：`skill.md` 开头已经带了 YAML frontmatter（`name: klockui` + `description`），
直接改名即可被识别。

**验收**：目录里能看到这个文件，且它开头三行是：

```
---
name: klockui
description: ...
```

若用户不想装技能，**不要因此中断安装**——它是增强项，不是运行依赖。跳过时在报告里注明一句即可。

---

## 5. P2 · 模型（全部可选，按第 2 节的回答装）

清单：`models.manifest.json`。先按用户选择的架构查 `arch_requires`，只下这些 id。

### 5.1 源的选择

```
URL = mirrors.cn 或 mirrors.global  + "/" + asset.path
```

1. 先用 `mirrors.cn`（`hf-mirror.com`）
2. 单文件失败 2 次，或速度 < 300KB/s 持续 30 秒 → 切 `mirrors.global`
3. 切之前提醒用户：**huggingface.co 在中国大陆通常需要代理**，请开启 Clash/V2Ray 并告知本地 HTTP 代理端口（常见 7890 / 7897）

```bash
export HTTPS_PROXY=http://127.0.0.1:7897
```

### 5.2 下完必须校验

```python
import json, os, struct
p = "<文件路径>"
size = os.path.getsize(p)
assert size == EXPECTED, f"体积不符：{size} != {EXPECTED}（截断文件，删除重下）"
with open(p, "rb") as f:
    n = struct.unpack("<Q", f.read(8))[0]
    head = json.loads(f.read(n).decode("utf-8", "replace"))
head.pop("__metadata__", None)
end = max(v["data_offsets"][1] for v in head.values()) + 8 + n
assert end == size, f"头部偏移不符：{end} != {size}"
print("OK", p)
```

**不能只信下载工具的"成功"**：截断文件能通过下载、却会在加载时崩，且 ComfyUI 报的错与真实原因毫无关系。

### 5.3 放到哪

```
<ComfyUI>/models/diffusion_models/   底模
<ComfyUI>/models/text_encoders/      编码器
<ComfyUI>/models/vae/                VAE
<ComfyUI>/models/loras/              LoRA（用户自备，仓库不提供）
```

---

## 6. P3 · 启动与验收

### 6.1 ComfyUI

```bash
cd <父目录>/ComfyUI
venv/bin/python main.py --listen 127.0.0.1 --port 8188 --lowvram --cache-ram 2 --preview-method auto
```

- `--preview-method auto` **必加**：默认 `NoPreviews` 会让界面步进预览全黑
- 等到日志出现 `To see the GUI go to: http://127.0.0.1:8188`（30–60 秒）

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/system_stats   # 必须 200
```

### 6.2 KlockUI

```bash
cd <父目录>/KlockUI
../ComfyUI/venv/bin/python server.py
```

```bash
curl -s http://127.0.0.1:7861/api/status
```

期望 `{"online": true, "model": "...", "arch": "..."}`。

| 现象 | 处理 |
|---|---|
| `online: false` | ComfyUI 没起来，或端口不是 8188（`KLOCK_COMFY_URL` 覆盖） |
| `model` 为空 | 模型没扫到，见第 8 节 B |

### 6.3 无模型时的处理（agent 职责，不要交付半成品）

启动后 `curl -s http://127.0.0.1:7861/api/status` 若 `model` 为空：

1. **这不是安装失败**。KlockUI 不附带模型，空模型列表是正常初始状态，界面上也只会显示空下拉。
2. **不要**把这种情况当作"已完成"交付给用户，也不要说"装好了"。
3. 回到第 2 节，用 `models.manifest.json` 的 `ask` 询问用户要哪个架构，按 `arch_requires` 下齐文件。
4. 下完重启 KlockUI（不是重启引擎），再次检查 `model` 非空。
5. 若用户明确表示"先不装模型"，才可交付，但要说明：**界面为空是预期行为，装完模型才可出图**，并给出第 5 节的文件落点。

判断依据只有一条：`model` 字段非空。`online: true` 而 `model` 为空，说明引擎通了但没模型，属于未完成。

### 6.4 出图验收（唯一有效的成功判据）

按用户装的架构替换 `model` 与采样参数：

```bash
curl -s -X POST http://127.0.0.1:7861/local/generate \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "txt2img",
    "model": "anima-aesthetic-v1.1.safetensors",
    "payload": {
      "prompt": "a red apple on a wooden table, soft daylight",
      "negative_prompt": "worst quality, low quality, blurry",
      "steps": 28, "cfg_scale": 4.0,
      "width": 512, "height": 512,
      "sampler_name": "Euler", "scheduler": "SGM Uniform",
      "seed": 12345, "n_iter": 1
    }
  }'
```

轮询 `GET /local/generate/status?id=<id>`：

| 返回 | 处理 |
|---|---|
| `"status": "done"` | 成功，记录耗时 |
| `ComfyUI 引擎未启动` | 回 6.1 |
| `normalized_shape=...` | 架构判错，见第 8 节 A |
| 10 分钟仍 `queued` | 查 ComfyUI 控制台日志 |

**验收定义**：产出一张 512×512 PNG，且 `online` 为 `true`。

---

## 7. 环境报告（交付时附上）

```
OS        :
Python    : x.y.z
torch     : x.y.z+cuXXX  cuda=True
GPU       : <型号> <显存>
ComfyUI   : 8188 <启动参数>
KlockUI   : 7861
源        : hf-mirror / huggingface(<代理端口>)
已装架构  : anima
模型      :
  anima-aesthetic-v1.1   4182230656  OK
  qwen_3_06b_base        1192135096  OK
  qwen_image_vae          253806246  OK
验收      : 512x512 / 28 步 / <耗时>s
```

---

## 8. 故障分支

### A. `normalized_shape=[2560] got [1, N, 1024]`

架构判错，用了错的编码器（2560 = Qwen3-4B，1024 = Qwen3-0.6B）。
1. `comfy_bridge._classify(<模型路径>)` 看返回值是否与预期一致
2. 返回 `unknown` 说明是新架构，需在 `_classify` 补判据，并同步 `ALLOWED_ARCHS`
3. **不要**靠改文件名绕过

### B. 模型列表为空但文件在

```bash
python -c "import comfy_bridge as c; print(c.MODELS_ROOT, c.DIFF_DIR)"
```

目录不对就设 `KLOCK_MODELS_ROOT` 后**重启 KlockUI**（不是重启引擎）。

### C. 改了 Python 不生效

`comfy_bridge.py` 随 `server.py` 进程加载，改完必须重启 KlockUI。
重启 ComfyUI 没用——它只执行图，图是 KlockUI 拼的。

### D. 出图极慢

底模体积 > 显存，每步搬权重。换 int8 量化版、降分辨率、确认 `--lowvram`。

### E. 图全黑 / 无步进预览

启动参数缺 `--preview-method auto`。

### F. 下载卡住或只有几百字节

镜像限流。换 `mirrors.global` + 代理，或等 5–10 分钟重试。
**不要**用返回体积当成功判据。

### G. 端口冲突

`KLOCKUI_PORT=7862`、`KLOCK_COMFY_URL=http://127.0.0.1:8190`，重启对应进程。

---

## 9. 完成定义

- [ ] `8188/system_stats` → 200
- [ ] `7861/api/status` → `online: true` 且 `model` 非空（为空即未完成，见 6.3）
- [ ] 6.4 返回 `done`，产出 PNG
- [ ] skill.md 已复制为 `<技能目录>/klockui/SKILL.md`（用户拒绝则注明）
- [ ] 环境报告已填写
- [ ] 未改 ComfyUI 源码、未用系统 Python

---

## 附：卸载

| 装了什么 | 怎么撤 |
|---|---|
| ComfyUI | 删 `<父目录>/ComfyUI` |
| KlockUI | 删 `<父目录>/KlockUI` |
| 模型 | 删 `<ComfyUI>/models/<dir>/<file>` |
| 环境变量 | 从 shell 配置删 `KLOCK_*` 行 |

不写系统目录、不注册服务、不改 PATH。

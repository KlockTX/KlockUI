---
name: klockui
description: 为 KlockUI（本地 AI 绘图 Web UI）安装、配置、排错，或编写/校验出图配方（JSON preset）时使用。覆盖 ComfyUI 引擎对接、多架构底模参数（Anima / Krea 2 / MOSS-Image / Z-Image / SDXL）、LoRA 管理与风格配方。
---

# KlockUI 配置技能

KlockUI 是一个本地 Web 界面，把 ComfyUI 的节点图封装成"填提示词 → 出图"的表单。
它**不自带推理引擎，也不附带任何模型权重**——引擎和模型都由使用者在安装时自行获取。

```
浏览器 ──► KlockUI :7861 ──► ComfyUI :8188 ──► GPU
            静态前端           节点图执行
            参数 → 图
```

KlockUI 由三部分组成：

| 文件 | 作用 |
|---|---|
| `server.py` | 标准库 HTTP 服务，静态页 + 本地任务队列 + 图库 |
| `comfy_bridge.py` | A1111 风格参数 → ComfyUI API 工作流，**所有架构知识都在这里** |
| `assets/app.js` + `index.html` | 单页前端，设置存 localStorage |

---

## 一、安装

完整安装步骤见 **`install.md`**（面向安装代理的分阶段规格），模型清单位于 **`models.manifest.json`**。
下面是摘要，细节与验收判据以 `install.md` 为准。

### 1.1 前置：ComfyUI

```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python -m venv venv
venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
venv/bin/pip install -r requirements.txt
```

Windows 用 `venv\Scripts\pip`。**不要用系统 Python**，torch 版本冲突很难救。

启动（8GB 显存建议带这些参数）：

```bash
python main.py --listen 127.0.0.1 --port 8188 --lowvram --cache-ram 2 --preview-method auto
```

> `--preview-method auto` 不是可选项：ComfyUI 默认 `NoPreviews`，KlockUI 的步进预览会全黑。

### 1.2 装 KlockUI

```bash
git clone <klockui-repo> KlockUI
cd KlockUI
# 用同一个 venv 的解释器启动
../ComfyUI/venv/bin/python server.py
```

默认 http://127.0.0.1:7861 。

### 1.3 模型（全部可选）

仓库不含权重。装哪个架构取决于用户需求，见 `models.manifest.json` 的 `ask` 与 `arch_requires`：

| 架构 | 需要 | 体积 |
|---|---|---|
| Anima | 底模 + `qwen_3_06b_base` + `qwen_image_vae` | 5.4GB |
| Z-Image | 底模 + `qwen_3_4b_fp8_mixed` + `ae` | 12GB |
| Krea 2 | 底模 + `qwen3vl_4b_fp8_scaled` + `qwen_image_vae` | 19GB |
| MOSS | 底模 + `qwen3.5_9b_w4a8_gptq` + `flux2-vae_small` | 13GB |

**只装一个也能完整出图。** 装好后访问 `/api/status`，`online: true` 且 `model` 非空即接通。

---

## 二、环境变量

路径解析顺序：`KLOCK_MODELS_ROOT` → `<repo>/../models` → `<repo>/models` → `<repo>/../ComfyUI/models`，
都不存在才回落到 `<repo>/models`。子目录也可用同名环境变量（`KLOCK_DIFFUSION_DIR` 等）单独覆盖。

| 变量 | 默认 | 说明 |
|---|---|---|
| `KLOCK_COMFY_URL` | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `KLOCKUI_PORT` | `7861` | 本服务端口 |
| `KLOCK_MODELS_ROOT` | 自动探测 | 模型根目录 |
| `KLOCK_CHECKPOINT_DIR` | `<root>/checkpoints` | SDXL 系整模型 |
| `KLOCK_DIFFUSION_DIR` | `<root>/diffusion_models` | DiT 系底模 |
| `KLOCK_VAE_DIR` | `<root>/vae` | VAE |
| `KLOCK_IDLE_UNLOAD_SECONDS` | `600` | 空闲多久释放模型 |

最小配置（Linux / macOS 示例）：

```bash
export KLOCK_MODELS_ROOT="$HOME/ComfyUI/models"
export KLOCK_DIFFUSION_DIR="$KLOCK_MODELS_ROOT/diffusion_models"
export KLOCK_VAE_DIR="$KLOCK_MODELS_ROOT/vae"
export KLOCK_CHECKPOINT_DIR="$KLOCK_MODELS_ROOT/checkpoints"
python server.py
```

---

## 三、架构识别（先看权重，别信文件名）

`comfy_bridge._classify()` 读 safetensors 头部张量名来判断架构。判断顺序：

| 判据（张量名特征） | 架构 | 底模体积参考 |
|---|---|---|
| `shared_block_modulation.weight` + `layers.0.proj.ffn_up_gate.weight` | **moss** | 5.0GB (int8) |
| `llm_adapter.blocks.0.cross_attn.q_proj.weight` | **anima** | 3.9GB (bf16) |
| `txtfusion.projector.weight` | **krea** | 12.6GB (int8) |
| `cap_embedder.0.weight` + `noise_refiner.*` | **zimage** | 5.9GB (int8) |
| `conditioner.*` / `first_stage_model.*` / `input_blocks.*` | **sdxl** | 6–7GB |

**为什么必须看权重**：按文件名匹配会认错（`z_image` 被当成别的架构），然后拿错的文本编码器去编码，报一个完全看不懂的错：

```
RuntimeError: Given normalized_shape=[2560], expected input with shape [*2560],
but got input of size[1, 11, 1024]
```

这个错的真实含义是：**编码器维度不对**（2560 = Qwen3-4B，1024 = Qwen3-0.6B），也就是架构判错了。

---

## 四、各架构参数（官方配方，别自己发明）

### 4.1 Anima（随包模型）

```yaml
编码器: qwen_3_06b_base.safetensors   # CLIPLoader type="stable_diffusion"
VAE:   qwen_image_vae.safetensors
采样:   Euler + sgm_uniform（备选 Res Multistep / ER SDE）
步数:   28–50（50 为画质上限）
CFG:   3.5–5.0
尺寸:   812×1216、1152×1536（1536² 不稳定，18 的倍数对齐）
```

负面词建议保留官方长串（`worst quality, low quality, score_1…`）。

### 4.2 Krea 2

```yaml
编码器: qwen3vl_4b_fp8_scaled.safetensors  # CLIPLoader type="krea2"
VAE:   qwen_image_vae.safetensors
采样:   Euler + Simple
步数:   8 起（8 是速度拐点，加步数仍会变精细，只是收益递减）
CFG:   1.0（无 CFG，负面词无效）
shift: 1.15，蒸馏时已 baked 进模型，节点里改了不生效
```

### 4.3 MOSS-Image

```yaml
编码器: qwen3.5_9b_w4a8_gptq.safetensors
VAE:   flux2-vae_small.safetensors
采样:   Euler + Simple
步数:   50+（ComfyUI 模板默认 25 步 / CFG 2.5 是官方点名的"夹生"值）
CFG:   3.0（短提示词可到 6）
shift: 5，baked；负分支在第 22 层跳过（SLG）
尺寸:   1–2MP，16 的倍数
```

### 4.4 Z-Image Turbo

```yaml
编码器: qwen_3_4b_fp8_mixed.safetensors   # CLIPLoader type="lumina2"
VAE:   ae.safetensors                      # 即 FLUX 的 ae
采样:   Res Multistep + Simple
步数:   9（官方）；实测加到 20–30 不会变糊，只是收益递减
CFG:   1.0
shift: 3（ModelSamplingAuraFlow）
特殊:   唯一能正确渲染中文的架构，文字要用引号括住
```

### 4.5 SDXL / Pony / Illustrious

```yaml
采样:   DPM++ 2M SDE + Karras（Pony）/ Euler a + Karras（通用）
步数:   20–30
CFG:   5–7
尺寸:   832×1216 起，8 的倍数
```

---

## 五、LoRA

- 文件放 `models/loras/`，KlockUI 启动或点「刷新」时扫描
- 前端在提示词末尾追加 `<lora:名字:权重>`，桥接层解析成 `LoraLoader` 节点
- **权重总和要控制**：
  - 蒸馏架构（Krea 8 步、Z-Image 9 步、MOSS turbo）：**总和 ≈ 1**，两三支就到顶
  - 多步架构（Anima 28–50 步）：1.3–1.6 也能吃
- 画风 LoRA 一般 0.6–0.9；工具类（手部修正、细节）0.6–0.8；滑块类一次只调一个

---

## 六、出图配方（JSON preset）

KlockUI 支持把整套设置写成 `.json`，拖到界面「画面描述」框即可一键还原。

```json
{
  "klockui": 1,
  "name": "配方名",
  "model": "krea2_xxx.safetensors",
  "prompt": "...",
  "negative": "",
  "quality": "standard",
  "size": { "width": 832, "height": 1216 },
  "steps": 12,
  "cfg": 1,
  "sampler": "Euler",
  "scheduler": "Simple",
  "shift": 3,
  "seed": -1,
  "batch": 1,
  "hires": false,
  "easyCache": true,
  "loras": [{ "name": "krea2_yoneyama_mai", "weight": 0.75 }]
}
```

**字段优先级**：`model` → `quality` → 显式字段 → `loras`。

`quality` 是档位名（`gacha` / `draft` / `standard` / `fine` / `hires`），会一次性写入步数、CFG、二采；JSON 里再写 `steps` 则以显式值为准。

**校验配方**：`model` 必须在 `diffusion_models` 或 `checkpoints` 里存在，`loras[].name` 不带 `.safetensors`，写错会被静默跳过。

---

## 七、排错（都是真实踩过的）

| 现象 | 真实原因 | 处理 |
|---|---|---|
| `normalized_shape=[2560] got [1, 11, 1024]` | 架构判错，用了 0.6B 编码器 | 检查 `_classify` 是否识别成正确架构 |
| 图全黑 / 没步进预览 | ComfyUI 未开 `--preview-method auto` | 启动参数加上 |
| 模型列表空，但文件在 | 目录不对 | 覆盖 `KLOCK_DIFFUSION_DIR` 等变量 |
| 出图极慢（每步数秒） | 底模体积 > 显存，每步搬权重 | 换 int8/GGUF，或降分辨率 |
| 下载的模型加载报错 | 文件截断 | 解析 safetensors header 算 `max(data_offsets)+8+header`，不等于文件大小就是坏文件 |
| 画风全变写实 | 提示词里混了镜头语言 | 删 `shallow depth of field` / `film grain` / `35mm`，加 `anime illustration, cel shading, flat colors` |
| 改了 Python 不生效 | 服务端进程没重启 | `comfy_bridge.py` 随 `server.py` 加载，改完必须重启**服务**（不是引擎） |
| 新增架构后参数被"改回去" | 架构白名单元组没加 | 见下 |

### 最容易漏的一处

`build_graph()` 开头有一个白名单守卫：

```python
if arch not in ALLOWED_ARCHS:
    arch = current_arch()   # 静默改写！
```

**加新架构时**，除了 `_classify` / `_modules_for` / 采样分支，**必须把名字加进 `ALLOWED_ARCHS`**，否则 arch 会被悄悄换成上一套架构，然后以错误编码器报维度错——而且不报"架构未知"，极难定位。

---

## 八、给 agent 的工作准则

1. **先看证据再改代码**。报错信息里的数字（维度、节点 id、步数）几乎都能定位到具体分支，别靠猜。
2. **改前查白名单/元组**。新增一个枚举值，往往要在 3 处以上同步。
3. **本地先验证再交付**。`build_graph()` 可以脱离服务直接调用，打印生成的节点图就能确认参数是否落对。
4. **大文件下载必须校验**。比对字节数 + safetensors header，截断文件能通过"下载成功"却会在加载时崩。
5. **不要用间接指标代替观感**。"像素差异变大"不代表画质变差；蒸馏模型的步数上限要靠实拍对比，不靠推理。
6. **改动后写清回滚路径**。启动参数、依赖包这类改动，说清楚删哪一行 / 卸哪个包能恢复。

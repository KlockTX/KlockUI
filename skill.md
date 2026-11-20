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

触发方式：用户把仓库链接（`https://github.com/KlockTX/KlockUI`）交给你并要求"按 install.md 安装"。

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
| `KLOCK_OUTPUT_DIR` | 自动探测 | 出图根目录：env → 同级 `outputs/` → 仓库内 `outputs/` |
| `KLOCK_CACHE_DIR` | `<repo>/.cache` | 历史、缩略图、导出 |

**输出目录有个坑**：仓库放在 `D:/AI/KlockUI`、图在 `D:/AI/outputs` 这种布局下，
如果只认仓库内 `outputs/`，历史记录和缩略图会全部 404（文件没丢，只是找错了地方）。
所以探测顺序里带了「同级 outputs」这一级，且只在它确实有图时才用。

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

### 4.1 Anima 2.9B

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

## 六、增删模型与 LoRA

### 6.1 加一个**同架构**的新底模（最常见）

比如又出了一个 Krea 2 的微调版：

1. 把 `.safetensors` 放进 `models/diffusion_models/`（SDXL 系放 `checkpoints/`）
2. 重启 KlockUI（**不是重启引擎**）
3. 完成。架构靠权重特征自动识别，前端会自动套用对应预设

**如果它没出现**：文件名带空格或中文导致扫描失败；或文件截断，解析 header 失败被跳过。
用第 9 节 B 的方法确认目录，再检查文件完整性。

### 6.2 加一个**新架构**

要改八处，少一处就会出现"能选但不生效"或"静默换架构"的怪现象。

| # | 文件 | 位置 | 改什么 |
|---|---|---|---|
| 1 | `comfy_bridge.py` | `_classify()` | 加一条权重特征判据，返回新 arch 名 |
| 2 | `comfy_bridge.py` | `_modules_for()` | 返回该架构依赖的编码器 / VAE 文件名 |
| 3 | `comfy_bridge.py` | `build_graph()` | 加采样分支：加载器、CLIP type、采样节点、latent 类型 |
| 4 | `comfy_bridge.py` | `ALLOWED_ARCHS` | 把新名字加进元组 |
| 5 | `assets/data.js` | `MODEL_PROFILES` | 加 profile：`match` 正则、默认 sampler/scheduler/shift、各画质档 |
| 6 | `assets/data.js` | `SAMPLER_PRESETS` | 该架构的参数卡片（均衡 / 结构 / 柔和…） |
| 7 | `assets/app.js` | `SAMPLER_SETS` | 允许该架构用的采样器/调度器（不加会被下拉隐藏） |
| 8 | `assets/app.js` | `archForModel()` | 前端回退判定用的正则 |

第 4 处是**最阴的**：漏了不会报"未知架构"，而是把 arch 静默换成上一个用过的架构，
然后拿错的文本编码器去编码，报一个与真实原因毫无关系的维度错误。

**改完必须验证**（不用起服务）：

```bash
python -c "import comfy_bridge as c; print(c._classify(r'<模型路径>'))"
```

输出应为新 arch 名。再跑一次 `build_graph`，把生成的节点图打印出来逐项对：

```python
import json, comfy_bridge as cb
p = {"prompt": "x", "negative_prompt": "", "steps": 9, "cfg_scale": 1.0,
     "width": 1024, "height": 1024, "sampler_name": "res_multistep",
     "scheduler": "simple", "seed": 1, "distilled_cfg_scale": 3}
g = cb.build_graph("txt2img", p, model="<模型文件名>", seed=1, uploaded=None, arch="<新arch>")
print(json.dumps(g, ensure_ascii=False, indent=1))
```

重点核对：`CLIPLoader` 的 `clip_name` 与 `type`、`VAELoader`、采样节点 class、latent 节点 class、保存前缀。

### 6.2.1 新架构的参数怎么定（别自己试）

八处改完只是"能跑起来"，参数错了照样出废图。顺序是：**先找官方工作流，再按类型套区间，最后实拍验证**。

**第一步：找官方工作流，从里面读，不猜**

- Hugging Face 的 model card 通常挂 `workflow.json` / `example workflow`
- 官方 ComfyUI 支持新模型时会加节点，`comfy_extras/` 里有对应实现
- 从工作流里能直接读出四样东西：`KSampler` 的 `sampler_name` / `scheduler` / `steps` / `cfg`、
  `CLIPLoader` 的 `type`、latent 节点类型、VAE 文件名

**第二步：判断它属于哪一类**，区间就对上了

| 类型 | 识别特征 | CFG | 步数 | 备注 |
|---|---|---|---|---|
| 蒸馏 | 名字带 turbo / lightning / dmd / distill | ≈ 1 | 4–12 | CFG 高于 1 会过曝发灰 |
| 流匹配 | 要 shift、latent 不是 `EmptyLatentImage` | 1–4 | 8–30 | shift 烤在模型里，界面只给微调 |
| 传统 DDPM | 常规 UNet / DiT | 3.5–7 | 20–40 | 负面词真生效 |

**第三步：两个最容易错的地方**

- **latent 节点**：流匹配架构要用对应的空 latent（`EmptySD3LatentImage` 等），
  用普通的会出纯色或噪点图
- **CLIPLoader 的 `type`**：目前用到 `stable_diffusion`（Anima）/ `krea2`（Krea 2）/
  `lumina2`（Z-Image）/ `moss_image`（MOSS）；新架构可能新增 type，以 ComfyUI 的
  `CLIPLoader` 文档为准。填错报的是编码器维度错，和采样参数毫无关系

**第四步：填 `MODEL_PROFILES` 的五档，不是简单倍增**

| 档位 | 怎么填 |
|---|---|
| `gacha` | **只有带加速 LoRA 的架构才给**，没加速 LoRA 就别开这档 |
| `draft` | 标准步数 ×0.6，CFG 不变 |
| `standard` | 官方工作流的值 |
| `fine` | 标准步数 ×1.4，到架构上限为止（蒸馏模型别超 20 步，白烧时间） |
| `hires` | 首采一半（至少 8 步），二采重绘幅度 0.35–0.45 |

**第五步：实拍验证，别只看不报错**

1. `standard` 一张：结构对不对、有没有过曝/发灰
2. `fine` 一张：细节是变多还是崩坏（崩了说明步数超了架构上限）
3. 和官方工作流出的图并排看，风格应当一致

三项都过再写进 `models.manifest.json` 和 README 的架构表。

### 6.3 移除一个架构

分两种：

**只是不想用了** —— 删掉底模文件即可，代码不用动。前端 profile 还在，但模型列表里没有它，
选不到就不会触发；启动不会报错。

**彻底移除** —— 按 6.2 的八处反向删：profile、`SAMPLER_SETS` 条目、`archForModel` 正则、
`build_graph` 分支、`_modules_for` 分支、`_classify` 判据、`ALLOWED_ARCHS` 里的名字。
**`ALLOWED_ARCHS` 最后删**：先删它有概率让残留的旧配置指向不存在的架构。

删完跑 6.2 的验证，确认其他架构的分类与图构建仍正常。

### 6.4 LoRA 的增删

放在 `models/loras/`，无需改代码：

```
models/loras/
├─ krea2_yoneyama_mai.safetensors      ← 只在 Krea 2 下出现
├─ zimage_hands.safetensors            ← 只在 Z-Image 下出现
├─ anima_detail.safetensors            ← 只在 Anima 下出现
└─ moss_xxx.safetensors                ← 只在 MOSS 下出现
```

**命名决定归属**：`loraArchTag()` 按文件名里的 `krea` / `moss` / `anima` / `zimage` 归类，
没有这些词的会被归为 `sdxl`。所以给 Z-Image 训练的 LoRA 一定要带 `zimage_` 前缀。

想让它显示中文标题和建议权重，在 `assets/app.js` 的 `LORA_LIBRARY` 里加一条：

```js
"zimage_hands": { title: "Z-Image · 手部修正", weight: 0.8, desc: "……" }
```

不加也能用，只是列表里显示原始文件名、权重用默认值。

删除：直接从 `loras/` 删文件，重启 KlockUI。**不要**删 `LORA_LIBRARY` 里的条目——
留着不影响，删了如果别人有同名文件反而少了描述。

---

## 七、文件索引与功能索引

### 7.1 文件职责

| 文件 | 职责 | 什么时候要改 |
|---|---|---|
| `server.py` | HTTP 服务（标准库）、静态页、任务队列、图库、登录鉴权 | 改路由、改鉴权、加新接口 |
| `comfy_bridge.py` | **架构知识的唯一来源**：模型识别、依赖解析、参数 → 节点图 | 加架构、调采样、改节点结构 |
| `assets/app.js` | 前端全部逻辑：面板、预设、LoRA、拖拽、存档 | 改交互、加参数控件、改预设 |
| `assets/artists.js` | 画师词库 | 补充画师词条 |
| `assets/characters*.js` | 角色 / 词库 | 补充角色词条 |
| `index.html` | 单页结构（所有 `id` 都被 `app.js` 用 `$("#…")` 引用） | 加控件时**先加 id 再写逻辑** |
| `assets/app.css` | 样式 | 改外观 |
| `vendor/` | mdui + 图标字体（离线） | 升级前端库时整体替换 |
| `install.md` | 面向安装 agent 的规格：阶段、断言、故障分支 | 安装流程变化 |
| `skill.md` | 本文件：配置知识与排错 | 踩了新坑就补一条 |
| `models.manifest.json` | 模型清单：地址、字节数、许可 | 增删可选模型 |
| `presets/*.json` | 示例参数配方 | 换示例题材 |

### 7.2 功能 → 代码位置

| 想改的东西 | 去看 |
|---|---|
| 换模型时的默认参数、画质档 | `assets/app.js` → `MODEL_PROFILES` |
| 采样器预设卡片 | `assets/app.js` → `SAMPLER_PRESETS`（卡片）+ `SAMPLER_SETS`（下拉可选项） |
| 架构识别规则 | `comfy_bridge.py` → `_classify()` |
| 参数 → 节点图 | `comfy_bridge.py` → `build_graph()` |
| LoRA 挂载与权重 | `comfy_bridge.py` → `_add_loras()`；前端 `loraArchTag()` / `loraMatchesArch()` |
| LoRA 标题与建议权重 | `assets/app.js` → `LORA_LIBRARY` |
| 局部重绘（蒙版） | `comfy_bridge.py` → `_apply_inpaint_mask()` |
| 高清二采 | `comfy_bridge.py` → `_hires_pixel_chain()` / `_hr_mode()` |
| JSON 预设导入 | `assets/app.js` → `applyPresetJson()` |
| 仓库配方列表 / 单个读取 | `server.py` → `_presets_list()` / `_preset_one()`（`/local/presets`、`/local/preset?file=`） |
| 仓库配方 UI | `assets/app.js` → `loadRepoPresets()` / `renderRepoPresets()` / `importRepoPreset()` |
| LoRA 搜索过滤 | `assets/app.js` → `loraMatchesQuery()` + `state.loraQuery` |
| 画面对比 | `assets/app.js` → `openCompareDialog()` / `renderCompare()` / `compareFieldRows()` |
| 排队任务锁定模型 | 前端 `buildRequest()` 写 `override_settings.sd_model_checkpoint`；服务端 `_generate_submit()` 兜底 |
| 显存释放时机 | `comfy_bridge.set_model()`（RAM < 3GB 才卸载）、`server.py` 空闲 600s 卸载、NeverOOM 跑完卸载 |
| 配方保存接口 | `server.py` → `_preset_save()`（`POST /local/preset/save`，文件名白名单 + 校验） |
| 配方编辑器 | `assets/app.js` → `openPresetEditor()` / `savePresetEdit()` / `presetJsonError()` |
| 前端公共件 | `assets/ui.js` → `h()` / `archLabel()` / `bindDialog()` / `debounce()` |
| JSON 预设导出 | `assets/app.js` → `exportPresetJson()` / `downloadPresetJson()` |
| 拖拽文件进界面 | `assets/app.js` → `bindPresetDrop()` |
| 设置持久化 | `assets/app.js` → `currentConfig()` / `applyConfig()` |
| 模型切换流程 | `assets/app.js` → `switchModel()`；服务端 `_engine_select_model()` |
| 引擎状态 | `server.py` → `_status()`；`comfy_bridge.status()` |
| 图库 / 历史 | `server.py` → `_open_output()` / `_open_favorites()` |
| 登录与鉴权 | `server.py` → `_request_guard()` / `_session_cookie()` |
| 图反推标签 | `interrogate.py` |
| 跑起来没反应 | 第 9 节排错表 |

### 7.3 改完的验收清单

```bash
python -c "import server, comfy_bridge; print('import ok')"
node --check assets/app.js
python -c "import comfy_bridge as c; print([c._classify(f) for f in c._model_filenames()])"
```

第三条列出所有模型的识别结果——**任何一个显示 `unknown` 都说明判据漏了**，
哪怕它现在还能用（会走回退逻辑，行为不可预测）。

---
## 八、出图配方（JSON preset）

KlockUI 支持把整套设置写成 `.json`，拖到界面「画面描述」框即可一键还原。

```json
{
  "klockui": 1,
  "name": "配方名",
  "model": "krea2_xxx.safetensors",
  "arch": "krea",
  "prompt": "...",
  "negative": "",
  "quality": "standard",
  "size": { "ratio": "2:3", "width": 1024, "height": 1536 },
  "steps": 12,
  "cfg": 1,
  "sampler": "Euler",
  "scheduler": "Simple"
  "seed": -1,
  "batch": 1,
  "hires": false,
  "easyCache": true,
  "loras": [{ "name": "krea2_yoneyama_mai", "weight": 0.75 }]
}
```

**写配方的三个坑**（都踩过）：

1. **Krea 2 不要写 `shift`** —— 它烤在模型里（固定 1.15），写了只会让滑杆显示一个不生效的值
2. **Krea 2 尺寸至少 1K** —— 832×1216 会掉画质，按 `2:3 = 1024×1536` 写
3. **`model` 要配 `arch`** —— 分享出去后对方多半没有你那个微调文件；
   有 `arch` 就能自动落到同架构的任意底模，没有就只报"模型未切换"

**字段优先级**：`model` → `quality` → 显式字段 → `loras`。

`quality` 是档位名（`gacha` / `draft` / `standard` / `fine` / `hires`），会一次性写入步数、CFG、二采；JSON 里再写 `steps` 则以显式值为准。

**校验配方**：`model` 必须在 `diffusion_models` 或 `checkpoints` 里存在，`loras[].name` 不带 `.safetensors`，写错会被静默跳过。

---

## 九、排错（都是真实踩过的）

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

## 十、给 agent 的工作准则

1. **先看证据再改代码**。报错信息里的数字（维度、节点 id、步数）几乎都能定位到具体分支，别靠猜。
2. **改前查白名单/元组**。新增一个枚举值，往往要在 3 处以上同步。
3. **本地先验证再交付**。`build_graph()` 可以脱离服务直接调用，打印生成的节点图就能确认参数是否落对。
4. **大文件下载必须校验**。比对字节数 + safetensors header，截断文件能通过"下载成功"却会在加载时崩。
5. **不要用间接指标代替观感**。"像素差异变大"不代表画质变差；蒸馏模型的步数上限要靠实拍对比，不靠推理。
6. **改动后写清回滚路径**。启动参数、依赖包这类改动，说清楚删哪一行 / 卸哪个包能恢复。

---

## 十一、扫描本机已有模型与 LoRA，自动配置

> 场景：用户说"我 ComfyUI 已经装好了 / 我有一堆模型"，或 install.md 的 P0 探测到已有引擎。
> **目标**：不重复下载、不覆盖用户已有文件，按实测结果配好 KlockUI 的参数。

### 11.1 流程总览（四步，顺序不能乱）

```
① 拿 models 路径（用户可能要手动给）
        ↓
② 只读扫描：底模判架构 + LoRA 判归属 + 查缺失的 TE/VAE
        ↓
③ 生成配置草案（JSON preset，每个架构一份），不落盘
        ↓
④ KlockUI 启动后，通过前端"导入预设"入口写入 localStorage
```

**为什么③④要分开**：后端**不保存任何设置**，`_CURRENT_MODEL` 只是进程内存态，
调 `/local/engine/select-model` 重启就丢。唯一的持久化层是浏览器 localStorage
（`simplegen.settings.v2`），而导入入口在前端。所以"配置"必须走前端导入，
不能只调后端 API。

### 11.2 第一步：拿路径，别只找默认位置

优先按环境变量 / 约定路径找；找不到**直接问用户**，不要猜：

> 你的 ComfyUI 装在哪个目录？我扫一下 models 文件夹，看已有底模和 LoRA，
> 避免重复下载，也能直接帮你配参数。

拿到后设 `KLOCK_MODELS_ROOT=<路径>/models`。**注意不是 `KLOCK_COMFY_DIR`**：
`comfy_bridge.py` 扫模型只读 `KLOCK_MODELS_ROOT`；`KLOCK_COMFY_DIR` 只被 `start.bat`
用来定位引擎目录。装过多个 ComfyUI 的机器上，用户给的路径最可靠。

### 11.3 第二步：只读扫描

用 `comfy_bridge._classify()` 读 safetensors header 判架构，**别用文件名猜**：

```bash
cd <KlockUI 目录>
../ComfyUI/venv/bin/python - <<'PY'
import os, comfy_bridge as b
print("ROOT", b.MODELS_ROOT)
for folder in (b.DIFF_DIR, b.CKPT_DIR):
    for name in b._model_filenames():
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            print("%-10s %5.1fGB %s" % (b._classify(path), os.path.getsize(path)/1024**3, name))
PY
```

判据见第三节。**zimage 要单独处理**：服务端 `/local/engine/catalog` 的 `checkpoints[].arch`
和 payload 都没有 zimage，只能靠 `_classify()`（`cap_embedder.0.weight` + `noise_refiner.*`）
或文件名 `/z[_ -]?image/i` 兜底，并在配方里显式写 `"arch": "zimage"`。

再扫 LoRA、配套模块与**超分模型**：

```bash
ls <ComfyUI>/models/loras/*.safetensors 2>/dev/null | sed 's#.*/##'
ls <ComfyUI>/models/text_encoders/*.safetensors <ComfyUI>/models/vae/*.safetensors 2>/dev/null | sed 's#.*/##'
ls <ComfyUI>/models/upscale_models/*.{safetensors,pth,pt} 2>/dev/null | sed 's#.*/##'
```

**超分模型（放大）必须单独扫**，它不属于任何底模架构，最容易被漏：

- 有超分模型时，高清档走 `UpscaleModelLoader + ImageUpscaleWithModel`，真补细节；
  没有时走 `VAEDecode + ImageScale` 插值，放大后偏糊。
- 超分节点内部**已经分块**（`tiled_scale(512/32)`，OOM 会自动把 tile 减半），
  KlockUI 侧没有可传的分块参数；`UPSCALE_MAX_EDGE` 限制的是输出尺寸，不是分块。
- 倍数是**模型固定的**：`_upscale_model_scale()` 从文件名猜（`4x-` / `_x4plus` → 4），
  没写就按 4x。桥接层按原生倍数出图，不再缩回用户选的 1.5x——缩回去等于白扔像素。
- 超分模型名带 `4x` 也可能其实是别家版本。**按字节数 + sha256 校验**才认，
  `models.manifest.json` 的 `ask.upscale_question` 和两条 `arch: upscaler` 条目是安装依据。
- 本机文件与官方源不一致时（例如旧版 Remacri 66MB vs 官方 33MB），
  不要偷偷替换用户已有的——只报告差异，让用户决定。

**分块 VAE 是默认开的**（`_apply_tiled_vae()` 在组装后统一替换所有
`VAEDecode` / `VAEEncode`）。8GB 卡上实测比整图快一倍（12.1s vs 24.3s）、
像素差 0.19/255。调 `KLOCK_TILED_VAE_TILE` / `KLOCK_TILED_VAE_OVERLAP` 改分块，
`KLOCK_TILED_VAE=0` 回退整图解码。爆显存时优先动这个，别急着上 `--cpu-vae`。

LoRA 归属看名字前缀：`krea*`→krea、`moss_*`→moss、`anima_*`→anima、
`zimage_*`/`z_image_*`→zimage，其余→sdxl。注意 `krea2_turbo_lora*` 是 Raw 侧 adapter，
在 Turbo 底模下前端会自动隐藏，别给它配权重。

**查缺失的配套模块**（按 `comfy_bridge.py:89-111` 的固定文件名）：

| 架构 | 必需 TE | 必需 VAE |
|---|---|---|
| anima | `qwen_3_06b_base.safetensors` | `qwen_image_vae.safetensors` |
| krea | `qwen3vl_4b_fp8_scaled.safetensors` | 同 anima 的 VAE |
| moss | `qwen3.5_9b_w4a8_gptq.safetensors` | `flux2-vae_small.safetensors` |
| zimage | `qwen_3_4b_fp8_mixed.safetensors` | `ae.safetensors` |

缺哪个报给用户，按 `models.manifest.json` 的 `arch_requires` 补，**已存在的不动**。

**提示词转写模型（可选，最容易和 CLIP 编码器搞混）**：

- 它不是底模的编码器，是独立的本地 LLM：`Qwen3.5-4B abliterated` GGUF（2.7GB），
  走 llama.cpp **CPU** 推理，端口 7865，**不占 ComfyUI 显存**。
- 扫 `<ComfyUI>/models/prompt-llm/*.gguf` 和 `<父目录>/llama-engine/llama/llama-server.exe`。
  两者都有才可用；只有模型没有运行时，或反过来，按钮都点不动。
- 文件名不必叫 `prompt-llm.gguf`：KlockUI 会自动发现该目录**唯一的** .gguf
  （历史默认名早就废弃了）。多个 gguf 才需要 `KLOCK_PROMPT_LLM_MODEL` 显式指定。
- 下载项在 `models.manifest.json` 的 `arch_requires["prompt-llm"]`：
  GGUF 来自 `mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF`，
  运行时用 **CPU 版** `llama-b11877-bin-win-cpu-x64.zip`（24MB），别下 CUDA 版。
- 验收别只看 `ready`：模型按需启动、空闲 600 秒退出。
  查 `/api/prompt/status` 的 `detail` 不含"找不到提示词模型"即路径正确。

### 11.4 第三步：生成配置草案

每个扫到的架构一份 JSON preset，字段参照 `presets/*.json`。参数从 `MODEL_PROFILES[arch]`
（`assets/data.js`，**不是 app.js**）取：

| 架构 | sampler / scheduler | shift | standard | 加速 LoRA（仅抽卡档） |
|---|---|---|---|---|
| anima | Euler / SGM Uniform | 3.5 | 28 步 / CFG 4 | `anima_turbo_v0.2` |
| krea | Euler / Simple | 1.15 | 8 步 / CFG 1 | 无（底模即 Turbo） |
| moss | Euler / Simple | — | 35 步 / CFG 3 | `moss_image_sft_8steps_dmd_lora` |
| zimage | Res Multistep / Simple | 3 | 9 步 / CFG 1 | 无 |
| sdxl | Euler a / Karras | — | 26 步 / CFG 5 | 无 |

各画质档、负面词、尺寸约束见第四节。**硬约束别违背**：

- Krea 步数 ≥ 8、原生 1K–2K，低于 1K 掉画质
- Z-Image 的 CFG 必须为 1，负面词无效
- MOSS 所有档位 `turbo:false`，否则会挂上 Anima 的加速 LoRA

LoRA 挑选：只挂同架构前缀的，画风 0.6–0.9、工具/细节 0.3–0.6，
一次不超过 2 支，总权重蒸馏架构 ≈ 1、多步架构 1.3–1.6。

### 11.5 第四步：落成设置（必须走前端）

每份 JSON 存成文件，在已打开的 KlockUI 页面：

- 拖到提示词卡或参数卡上（拖拽导入），或
- 点参数区的"导入预设"文件按钮

`applyPresetJson()` 会按 `model` → 同架构兜底 → 显式字段 → `loras` 的优先级应用，
并写入 localStorage。导入后核对：模型下拉非空、步数/CFG/采样器与草案一致。

**别用后端 API 代替导入**——`select-model` 只改内存，刷新页面就没了。

### 11.6 扫描后的用户反馈话术

基于实测说，别凭空问：

> 在 `<路径>` 扫到：Krea 2 全套（底模+TE+VAE）、Anima 底模但缺 TE、
> 12 支 LoRA（8 Krea / 4 Anima）。要补装 Anima 的 TE 吗？还是只用 Krea？

用户的选择决定下载清单；已存在且校验通过的文件直接跳过。

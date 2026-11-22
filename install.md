# KlockUI 安装说明（面向 agent）

> **读者是安装代理，不是人。**
> 按阶段执行，每阶段通过验收再进下一阶段。任一步失败跳到第 8 节，**不要跳过断言继续装**。
>
> **本仓库不含推理引擎，也不含任何模型权重。** 下面所有内容都由你（agent）在实际安装时获取。
>
> **触发方式**（三种都走同一套流程）：
> 1. 用户给你仓库链接（`https://github.com/KlockTX/KlockUI`）并要求"按 install.md 安装"；
> 2. 用户直接给你一个 `KlockUI-<版本>.zip` 压缩包，要求安装配置 ——
>    解压后读包内 `AGENT-INSTALL.md`，**从第 0 节开始照常执行**，不要因为它不是 git 仓库就停下；
> 3. 你已在本目录看到本文件。

## 0. 开工前

### 0.1 先读 skill.md（顺序不能换）

**在动任何命令之前，先把同目录的 `skill.md` 读完。** 不要只搜关键词——后面每一步都会用到它：

- P0.5 扫描时，要知道每个架构依赖哪些编码器/VAE（skill 第十一节）
- 判断新架构、定参数时，要按 skill 6.2 / 6.2.1 的清单和三类区间
- 出图报错时，第 8 节的故障分支多数在 skill 第九节有更细的实测记录

两份文件的分工是这样，别搞混：

| 文件 | 管什么 | 什么时候用 |
|---|---|---|
| `install.md`（本文） | **这一次装什么、怎么验**：探测或安装引擎、装 KlockUI、扫已有模型、补缺的权重、跑通一张图 | 现在，从第 1 节走到第 9 节 |
| `skill.md` | **以后怎么改、为什么这么配**：各架构参数依据、LoRA 归属规则、排错表、新增架构的八处改动、配方 JSON 规范 | 现在先读；之后用户说"换模型""报错了""加个架构"时再查 |

**两者冲突时以 `skill.md` 的架构参数为准**——那份是长期维护的，本文里的参数只是引用。

### 0.2 契约

| 项 | 约定 |
|---|---|
| 允许 | 建目录、装 Python 包、下载模型、写配置、启动本地进程 |
| 禁止 | 改系统 Python、覆盖已装 torch、改 ComfyUI 源码、删除用户已有模型、在已有引擎时另起一个抢 8188 |
| 顺序 | **P0 先探测本机 ComfyUI / 8188，命中就复用，只有全未命中才 clone** |
| 结构 | KlockUI 与 ComfyUI **同级**放在同一父目录（路径探测依赖这个结构） |
| 结束必须交付 | 两个端口可访问、一张测试图、环境报告（第 7 节） |

### 0.3 目标结构

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
| **其他 / 你另有指定** | 看模型 | 报模型名或链接即可，agent 按 `skill.md` 去找、验、装 | 见各模型 |

话术建议：

> KlockUI 本体不含模型。要装哪些？
> ① Anima（推荐，5.4GB，通用）
> ② Z-Image（12GB，出图快、能写中文）
> ③ Krea 2（19GB，画质最好，8GB 显存会很慢）
> ④ MOSS（13GB，做海报排版）
> ⑤ 其他（你有想用的模型，报名字或链接）
> 可以多选，也可以只装 ①。

**只装一个也能完整出图**，不要默认全装。

**用户选了"其他"就这么办**（不要硬塞进上面四个架构）：

1. **先问清楚是什么模型**：名字、来源链接、大概多大。拿不到链接就问他在哪个站看到的。
2. **按 `skill.md` 第十一节的流程去源站找**，别自己编下载地址：
   - **Hugging Face** —— 最规范，文件名和字节数都能核对；国内走 `hf-mirror.com`
   - **Civitai（C站）** —— 社区底模和 LoRA 最多；需要登录拿 API token，有成人内容，按用户要求筛
   - **ModelScope（魔搭）** —— 国内直连快，阿里系模型常在这
3. **下载前先判架构**（`skill.md` 第三节）：读 safetensors header 的张量名，不看文件名。
   文件名可以随便改，权重不会说谎。
4. **分流处理**：
   - 架构已在支持列表里（anima / krea / zimage / moss / sdxl）→ 放进对应目录后重启
     KlockUI 即可（`skill.md` 6.1）
   - 架构是新的 → 按 `skill.md` 6.2 改八处，再按 6.2.1 定参数
5. **校验必须做**：字节数比对 + safetensors header 可解析。截断的文件能"下载成功"，
   要加载时才崩。
6. 许可由用户自己负责：把模型页的 license 如实转告，不要替用户判断能不能商用。

### 2.2 显存档位

| 显存 | 启动参数 |
|---|---|
| ≥16GB | 不加 `--lowvram`，`--cache-ram 8` |
| 8–12GB | `--lowvram --cache-ram 2` |
| <8GB | `--lowvram --cache-ram 1`，且只装 Anima |

**真的爆显存时按需追加**（KlockUI 侧已经做了分块 VAE，这几条是最后的兜底）：

| 参数 | 代价 | 什么时候用 |
|---|---|---|
| `--novram` | 更频繁搬运，慢 | `--lowvram` 仍然 OOM |
| `--cpu-vae` | VAE 慢 2–3 倍，显存省 1–2GB | Hires 二采、超大图解码时 OOM |
| `--fp16-vae` | **部分 VAE 会出黑图** | 最后手段，出黑图立即回退 |
| `--reserve-vram 1` | 少用一点显存 | 系统/浏览器抢显存导致掉驱动 |

设置方式：`run_comfy.bat` 里直接加；或在 KlockUI 的 `start.bat` 走**兜底启动**时用
`set KLOCK_ENGINE_ARGS=--cpu-vae` 追加（该变量只在没有 `run_comfy.bat` 时生效）。

**另外两条与稳定性无关、但值得默认开/按需开的：**

> **`--fast-disk` 建议默认开**：让权重卸载走 NVMe 而不是非固定内存。本机实测 Krea2
> 1024² 冷启 55.8/51.3s → 48.1/42.3s（快 12–16%），MOSS 768² 25 步 34.1→31.7s。
> 机械盘或慢 SATA 盘不要开，反而更慢。
>
> **内存只有 16GB 时可以加 `--disable-pinned-memory`**：实测释放 1.4GB（Krea）/ 0.4GB（MOSS）
> 固定内存，速度没有可测的损失。代价是 CPU↔GPU 传输少一层加速，MOSS 这类大编码器
> 反复换入的场景要先小图验证。

---

### 2.3 要装哪些 LoRA（两步问，别一次抛出 35 支）

LoRA 不是必需品——不装也能出图，只是预设里挂的会提示缺件。
清单在 [`loras.manifest.json`](loras.manifest.json)，35 支（31 支来自 `presets/` 配方，另 4 支是 2026-11-22 补的社区精选画师件），★ 是精选。

#### 第一步：先选系（可多选）

> 预设里的 LoRA 按底模分系，先选要装哪几系：
> ① **Anima 系** —— 14 支，约 2.3GB
> ② **Krea 2 系** —— 20 支，约 5.5GB
> ③ **Z-Image 系** —— 1 支，约 0.3GB
> 可以多选。没打算装的架构就别选，省得白下。

**只列用户选中的系，别把三系混在一起报。** 用户只装 Anima 就别提 Krea 2 那 20 支。

MOSS 系没有预设引用 LoRA，所以不用问；用户主动要 MOSS 的 LoRA 再按 `skill.md` 11.7 找。

#### 第二步：每系选装法

对每一个选中的系，三选一：

> ① **全装** —— 该系全部，预设一次跑通
> ② **精选** —— 只装 ★ 那几支（加速 + 通用光照 + 主力画师），自己搭配方够用
> ③ **不装** —— 只要底模

另外任何时候都可以加一句：**你有想装的 LoRA 报名字或链接，我单独装。**

**精选只有这些**（Krea 2 系 4 支、Anima 系 3 支，Z-Image 系只有 1 支不分档）：

| 系 | 精选支数 | 体积 |
|---|---|---|
| Anima | 3 支 | 0.65GB |
| Krea 2 | 4 支 | 1.01GB |
| Z-Image | 全部 1 支 | 0.32GB |

要提醒一句：每个预设用的 LoRA 组合都不一样，**精选只能保住最常用的场景**，
其余预设仍会缺它自己的那几支。要"全都跑得通"，只有全装。

#### 各系清单

**Anima 系 · 14 支 · 2.26GB**

| LoRA | 用途 | 体积 | 预设 |
|---|---|---|---|
| `anima_turbo_v0.2` | ★ 加速（必装） | 142MB | 8 |
| `anima_flatline` | ★ 作品风格 | 22MB | 3 |
| `anima_rimix` | ★ 光照氛围 | 504MB | 3 |
| `anima_yoneyama_mai` | 画师画风 | 175MB | 2 |
| `anima_moriimee_gothic` | 作品风格 | 132MB | 2 |
| `anima_anime_in_real` | 画风 | 264MB | 2 |
| `anima_90s_melancholy` | 作品风格 | 132MB | 1 |
| `anima_anime_flat` | 作品风格 | 88MB | 1 |
| `anima_takeda_hiromitsu` | 画师画风 | 175MB | 1 |
| `anima_blueprint` | 画风 | 37MB | 1 |
| `anima_miyu_style` | 画师画风（社区精选） | 88MB | 1 |
| `anima_memani_flat` | 杂志厚涂（社区精选） | 264MB | 1 |
| `anima_yuming_li` | 画师画风（社区精选） | 132MB | 1 |
| `anima_mutopaint` | 画师画风（社区精选） | 132MB | 1 |

**Krea 2 系 · 20 支 · 5.49GB**

| LoRA | 用途 | 体积 | 预设 |
|---|---|---|---|
| `krea2_rim_light` | ★ 光照氛围 | 382MB | 5 |
| `krea2_yoneyama_mai` | ★ 画师画风 | 209MB | 4 |
| `krea2_loundraw` | ★ 画师画风 | 224MB | 4 |
| `krea2_fuzichoco` | ★ 画师画风 | 218MB | 3 |
| `krea2_clear_anime` | 画风 | 392MB | 2 |
| `krea2_90s_aesthetic` | 作品风格 | 218MB | 2 |
| `krea2_anmi` | 画师画风 | 224MB | 2 |
| `krea2_kuvshinov` | 画师画风 | 109MB | 2 |
| `krea2_cyberpunk_anime` | 场景氛围 | 218MB | 1 |
| `krea2_rella` | 画师画风 | 224MB | 1 |
| `krea2_bioluminescent` | 画风 | 382MB | 1 |
| `krea2_rembrandt_light` | 光照氛围 | 382MB | 1 |
| `krea2_murata` | 画师画风 | 218MB | 1 |
| `krea2_kantoku` | 画师画风 | 219MB | 1 |
| `krea2_evan_cagle` | 画师画风 | 436MB | 1 |
| `krea2_dark_art` | 画风 | 218MB | 1 |
| `krea2_blue_archive_style` | 画风 | 895MB | 1 |
| `krea2_celdepth_25d` | 画风 | 218MB | 1 |
| `krea2_bold-inked-anime-realism` | 画风 | 224MB | 1 |
| `krea2_detail_slider` | 细节增强 | 11MB | 1 |

**Z-Image 系 · 1 支 · 0.32GB**

| LoRA | 用途 | 体积 | 预设 |
|---|---|---|---|
| `zimage_cyberpunk_anime` | 场景氛围 | 324MB | 1 |

#### 装的时候三件事不能错

1. **按清单的 `name` 命名**——Civitai / HF 上的原始文件名和这里对不上，预设是按名字匹配的，不改名等于没装。
2. **架构要匹配**——按清单的 `arch` 放对目录；Krea 2 的 LoRA 挂到 Anima 上不会报错，只是没效果，最难查。
3. **认 `search_hint`**——按它去 Civitai / HF / 魔搭搜，核对方法见 `skill.md` 11.7。Civitai 标 `Rent` 的是付费，跳过，按 `purpose` 找同类免费替代。

---

## 3. P0 · ComfyUI：先探测本机，再决定要不要装

**不要一上来就 clone。** 先花一分钟探测，命中就跳过整个 P0：

```bash
# A. 端口是否已有引擎在跑（最优先，命中就直接进 P1）
curl -fsS http://127.0.0.1:8188/system_stats && echo "ENGINE_READY"

# B. 本机是否已有 ComfyUI 目录（这几个只是常见位置，没命中不代表没有 —— 往下看）
ls -d ../ComfyUI ../ComfyUI_windows_portable ~/ComfyUI /d/AI/ComfyUI 2>/dev/null
# 用户常把 AI 工具放在 D/E 盘，扫一层 + 一层子目录就够（不要递归全盘）
ls -d /c/*[Cc]omfy* /d/*[Cc]omfy* /e/*[Cc]omfy* 2>/dev/null
ls -d /c/*/[Cc]omfy* /d/*/[Cc]omfy* /e/*/[Cc]omfy* 2>/dev/null

# C. 找到后确认它是能用的，而不是空壳
<找到的目录>/venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available())" \
  || <找到的目录>/venv/Scripts/python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
test -f <找到的目录>/main.py && echo "COMFY_USABLE"
```

**探测结果怎么处理**

| 结果 | 你要做的 |
|---|---|
| A 命中（`ENGINE_READY`） | **跳过下面的"全新安装"子节**，但仍要做 P0.5 扫描配置；别另起一个引擎抢 8188 端口 |
| A 未命中、B/C 命中 | **复用这个目录**：不要 clone、不要新建 venv、不要覆盖已装的 torch；直接启动它（见 6.1），确认 8188 通了再进 P1 |
| 全未命中 | **先问用户，别直接开始下载** —— 见下面的话术，确认真的没有才走全新安装 |

**全未命中时先问一句**（这是最容易被跳过、也最容易白下载几 GB 的一步）：

> 我在常见位置没找到 ComfyUI。你这台机器上装过吗？
> 装过的话告诉我装在哪（比如 `D:/ComfyUI`、`E:/AI/ComfyUI`），我直接复用现有的；
> 没有的话我再下载安装，大概 2–3GB。

问清楚再动手的理由：

- 装在非常规路径是常态，尤其习惯把 AI 工具放 D/E 盘的用户
- 用过一键包的话，目录可能叫 `ComfyUI_windows_portable`、`ComfyUI-aki`、`comfyui-v1.0`
  这类名字，默认列表扫不到
- 复用已装的能省掉：2–3GB 下载 + venv 安装 + torch 下载（这一步最慢，GB 级）
- 用户答"不确定"时，按 B 的扫盘命令查一层目录，别直接开装

拿到路径后回到 C 复验（torch 能 import、`main.py` 存在）。**仍不通过就当没有** ——
空壳目录或坏掉的 venv 复用过来只会把故障带到后面。

> **KlockUI 不要求 ComfyUI 一定和它同级。** 桥接层只连 `127.0.0.1:8188`；
> 同级目录只是 `start.bat` 的默认探测路径，实际路径可以用 `KLOCK_COMFY_DIR` 覆盖。
> 所以本机已有 ComfyUI 时，**优先复用**，不要为了凑目录结构去搬动或复制它。
>
> **端口通 ≠ 知道模型路径**。即使 A 命中，也继续做 P0.5：引擎可能在跑但模型装在别处，
> 必须确认路径才能扫描配置。

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

## 3.5 P0.5 · 扫描本机已有模型与 LoRA，生成配置草案

> **这一段只读，不改任何文件、不写任何配置。**
> 目的：把第 2 节的"你要装哪些架构"从凭空问变成**基于实测问**，
> 并提前准备好一份待导入的 JSON 配方，避免重复下载用户已有的模型。

### 3.5.1 拿到 models 目录（两种途径）

优先用 P0 探测到的 ComfyUI 路径：

```bash
<ComfyUI>/models/diffusion_models/
<ComfyUI>/models/checkpoints/
<ComfyUI>/models/loras/
<ComfyUI>/models/text_encoders/
<ComfyUI>/models/vae/
```

**如果 P0 没定位到目录，或用户说"我 ComfyUI 装在别处"，就直接问用户路径**，
不要猜、不要只找默认位置：

> 你的 ComfyUI 装在哪个目录？我需要扫一下里面的 models 文件夹，看看你已经有
> 哪些底模和 LoRA，这样就不会重复下载，也能直接帮你配好参数。
> （示例：`D:/AI/ComfyUI` / `E:/sd/ComfyUI_windows_portable`）

拿到路径后先确认：

```bash
test -d "<用户给的路径>/models" && echo "MODELS_FOUND"
```

用户给的路径可以放进环境变量，后面 KlockUI 启动时会用到：

```bash
export KLOCK_MODELS_ROOT="<用户给的路径>/models"
```

> 注意是 `KLOCK_MODELS_ROOT`，不是 `KLOCK_COMFY_DIR`。桥接层扫模型只读这个根。
> 让用户自己确认路径比自动找更可靠——装过多个 ComfyUI 的机器很常见。

### 3.5.2 只读扫描（用 KlockUI 自带的分类函数，别自己猜架构）

KlockUI 源码里有现成的 `_classify()`：**读 safetensors header 的张量名判定架构**，
比看文件名准。从 KlockUI 目录跑：

```bash
cd <KlockUI 目录>
../ComfyUI/venv/bin/python - <<'PY'
import os, comfy_bridge as b
print("MODELS_ROOT =", b.MODELS_ROOT)
for folder in (b.DIFF_DIR, b.CKPT_DIR):
    for name in b._model_filenames():
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            print("%-12s %10.2fGB  %s" % (b._classify(path), os.path.getsize(path)/1024**3, name))
PY
```

输出示例：

```
krea         11.74GB  krea2_noct_v4_int8_convrot.safetensors
anima         3.90GB  anima-aesthetic-v1.1.safetensors
zimage        6.31GB  z_image_turbo_int8_convrot.safetensors
unknown       0.21GB  some-random-model.safetensors
```

**判据表**（`comfy_bridge.py:420-454`，写代码前先核对）：

| 架构 | safetensors header 特征键 |
|---|---|
| moss | `shared_block_modulation.weight` + `layers.0.proj.ffn_up_gate.weight` |
| anima | `llm_adapter.blocks.0.cross_attn.q_proj.weight` |
| krea | `txtfusion.projector.weight` |
| zimage | `cap_embedder.0.weight` + `noise_refiner.*` |
| sdxl | `conditioner.*` / `first_stage_model.*` / `input_blocks.*` |

> **服务端 `/local/engine/catalog` 不返回 zimage**，所以这一步必须直接调 `_classify()`，
> 或按文件名 `/z[_ -]?image/i` 兜底。别拿 catalog 的 `arch` 字段当唯一依据。

再扫 LoRA、配套模块和**超分模型**：

```bash
ls <ComfyUI>/models/loras/*.safetensors 2>/dev/null | sed 's#.*/##'
ls <ComfyUI>/models/text_encoders/*.safetensors <ComfyUI>/models/vae/*.safetensors 2>/dev/null | sed 's#.*/##'
# 超分（放大补细节用）——不属于任何底模架构，最容易被漏
ls <ComfyUI>/models/upscale_models/*.{safetensors,pth,pt} 2>/dev/null | sed 's#.*/##'
```

**超分扫描报告**单独列出：有没有、4x 还是 2x（`_upscale_model_scale()` 从文件名猜，
没写倍数按 4x）、safetensors 还是 pth。一个都没有时高清档只能用插值放大、**仍然偏糊**，
要明确告诉用户并问要不要装（`models.manifest.json` 的 `ask.upscale_question`）。

LoRA 的架构归属**看名字前缀**（`app.js:2584-2592`）：

```
krea* / krea2_*  → krea      moss_*  → moss
anima_*          → anima     zimage_* / z_image_* → zimage
其它             → sdxl
```

### 3.5.3 生成配置草案（不落盘，等 P1 完成后导入）

对**每个扫到的架构**生成一份 JSON preset，字段参照 `presets/*.json`。
参数从 `assets/data.js` 的 `MODEL_PROFILES[arch]` 取，**不要自己发明**：

| 架构 | 采样器 / 调度器 | shift | 标准档 | 加速 LoRA |
|---|---|---|---|---|
| anima | Euler / SGM Uniform | 3.5 | 28 步 / CFG 4 | `anima_turbo_v0.2`（仅抽卡档） |
| krea | Euler / Simple | 1.15 | 8 步 / CFG 1 | 无（底模即 Turbo） |
| moss | Euler / Simple | — | 35 步 / CFG 3 | `moss_image_sft_8steps_dmd_lora`（仅抽卡档） |
| zimage | Res Multistep / Simple | 3 | 9 步 / CFG 1 | 无 |
| sdxl | Euler a / Karras | — | 26 步 / CFG 5 | 无 |

完整规则、各画质档、LoRA 权重建议见 `skill.md` 第三、四、五节。

草案示例（krea）：

```json
{
  "klockui": 1,
  "name": "自动配置 · Krea",
  "model": "krea2_noct_v4_int8_convrot.safetensors",
  "arch": "krea",
  "quality": "standard",
  "steps": 8,
  "cfg": 1,
  "sampler": "Euler",
  "scheduler": "Simple",
  "shift": 1.15,
  "size": { "ratio": "2:3", "width": 1024, "height": 1536 },
  "loras": []
}
```

**匹配到已有 LoRA 时**：按前缀挑同架构的，画风类权重 0.6–0.9，
工具/细节类 0.3–0.6；不要一次挂超过 2 支。Krea / MOSS 的 LoRA 是 DiT-only，
桥接层会自动用 `LoraLoaderModelOnly`，不需要你处理。

### 3.5.4 把扫描结果反馈给用户，再继续

用这个话术（**基于实测，不要凭空问**）：

> 我在 `<用户给的 ComfyUI 路径>/models` 扫到了：Krea 2 全套（底模 + 编码器 + VAE）、
> Anima 底模但缺编码器、12 支 LoRA（8 支 Krea / 4 支 Anima）、
> 3 个超分模型（UltraSharp / AnimeSharp / Remacri）。
> 要我补装缺的 Anima 编码器吗？还是只用 Krea？超分够用还是要加写实基线？

**超分模型清单**（`models.manifest.json` 里 `arch: upscaler`，全装约 223MB，不是必需）：

| 文件 | 擅长 | 体积 | 来源 |
|---|---|---|---|
| `4x-AnimeSharp.safetensors` | 动漫线条最锐 | 32MB | HF `Kim2091/AnimeSharp` |
| `4x-UltraSharp.safetensors` | 通用/数字艺术 | 64MB | HF `Kim2091/UltraSharp` |
| `4x_foolhardy_Remacri.safetensors` | 人像/皮肤最稳 | 64MB | HF `LyliaEngine/4x_foolhardy_Remacri` |
| `RealESRGAN_x4plus.safetensors` | 写实基线 | 64MB | HF `Comfy-Org/Real-ESRGAN_repackaged` |

装 2 个够用：**动漫**（AnimeSharp）+ **通用**（UltraSharp 或 Remacri）。
四个的区别只在锐度倾向——超分模型不造新细节，只放大和锐化；
要真补纹理得靠 Hires 二采的低噪重绘，模型只是像素那一环。

**关于扩散超分（会真补细节，不只是锐化）**：

8GB 卡**可以跑**，用 SeedVR2 3B 的 GGUF Q4 量化版（1.86GB）。实测本机
1024×1536 → 2048×3072 只要 36.7 秒，靠 BlockSwap 32 + VAE 分块把权重卸到 CPU，
不改 torch。它保特征（缩回原图平均差 3.54/255），细节比插值多 24%，
适合"出完图要放大但人物不能变"的场景。

**上限约 2x**：节点 DiT 一次处理整图、无图像分块，显存由输出像素决定
（6.3M 可行，更高直接卡死）。超限时后端自动收敛倍数并提示；
要更大就先 2x 再用 ESRGAN 接力。

但要装 ComfyUI 自定义节点 `numz/ComfyUI-SeedVR2_VideoUpscaler` 和 2.3GB 模型，
不是零成本。若只是想让图更大，上面的 ESRGAN 够用；要补细节且不改人物，才上 SeedVR2。
安装与参数见 [`docs/seedvr2-research.md`](docs/seedvr2-research.md)。

不推荐 HAT / SwinIR（非扩散且慢）和 SUPIR 全精度 FP16（要 24GB）——
但注意 SUPIR 的 fp8 + 分块采样在 8GB 也能跑，只是远慢于 SeedVR2，别一概而论。

用户的选择决定 P2 下载清单：**已存在且校验通过的文件直接跳过**，只下缺的。

---

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

### 4.1 把 skill.md 装进技能目录（强烈建议，别跳过）

内容在 0.1 已经读过了，这一步只是把它**固化**到你的技能目录——这样下一个会话
（用户问"换个底模""报错了"）能自动加载，不必重新翻代码。

### 4.2 把 P0.5 的配置草案落成设置

**后端不保存设置**——配置只存在浏览器 localStorage（`simplegen.settings.v2`）。
所以不要指望调 API 选个模型就完事，重启就没了。正确做法是把 P0.5 生成的每份 JSON
通过前端入口导入：

1. 启动 KlockUI 并打开页面（见 6.2）；
2. 把 JSON 存成 `<名字>.json`，拖到**提示词卡或参数卡**上（支持拖拽导入），
   或点参数区的"导入预设"文件按钮选中它；
3. `applyPresetJson()` 会自动匹配模型名——找不到同名模型时按 `arch` 兜底到同架构的，
   再写入 localStorage 并立即生效。

每个架构导入一份。导入后到画面区确认：模型下拉非空、步数/CFG/采样器与草案一致。
若用户明确说"先不装模型"，跳过这一步，但按 6.3 说明交付状态。

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

## 4.5 P1.5 · 提示词转写模型（可选，中文直出英文）

> 这一段装的是**提示词转写**用的本地 LLM，不是底模的 CLIP 编码器，别搞混。
> 它让"转写预览"按钮可用：中文描述 → 英文提示词，**走 llama.cpp CPU，不占 ComfyUI 显存**。

### 4.5.1 先问用户要不要装

`models.manifest.json` 的 `ask.prompt_llm_question` 有现成话术。**不装也能正常出图**，
只是要自己写英文提示词、"转写预览"按钮不可用。

### 4.5.2 装两样东西

清单里 `arch_requires["prompt-llm"]` 列了两项，缺一不可：

**① 运行时**（Windows x64 CPU 版 llama.cpp，24MB）

```bash
# 下载（注意：GitHub release 不走 hf-mirror，直接用这个 URL）
https://github.com/ggml-org/llama.cpp/releases/download/b11877/llama-b11877-bin-win-cpu-x64.zip

# 解压后摆成这个结构
<父目录>/llama-engine/llama/llama-server.exe
```

用 **CPU 版**是刻意设计：转写不能抢 ComfyUI 的显存。别下 CUDA 版（272MB）。

**② 模型**（GGUF，2.7GB）

```bash
# 放到
<ComfyUI>/models/prompt-llm/Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf

# 下载源（mirrors + path）
https://hf-mirror.com/mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF/resolve/main/Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf
```

按 `models.manifest.json` 的 `size` + `sha256` 校验。本机实测值与官方 LFS oid 一致。

### 4.5.3 文件名不用改

KlockUI 会自动发现 `prompt-llm/` 下**唯一的 .gguf**——历史默认名 `prompt-llm.gguf`
早就不用了。目录里放一个 gguf 即可让服务找到；多个 gguf 时必须用
`KLOCK_PROMPT_LLM_MODEL` 显式指定，agent 不要替用户猜。

### 4.5.4 验收

启动 KlockUI 后：

```bash
curl -s http://127.0.0.1:7861/api/prompt/status | python3 -m json.tool
```

**别只看 `ready`**：模型是按需启动的（点转写才拉起，约 10–30 秒）、空闲 600 秒自动退出，
所以刚启动服务时 `ready: false` 是正常现象。正确判据：

- `detail` **不含**"找不到提示词模型" / "找不到 llama-server.exe" → 安装路径正确
- 想要 `ready: true`，先在界面点一次"转写预览"触发加载，再查状态

本机 gguf 可被自动发现：`KLOCK_PROMPT_LLM_MODEL` 未设置时，
KlockUI 会扫 `prompt-llm/` 目录下唯一的 `.gguf`。有多个 gguf 时必须显式指定路径。

---

## 5. P2 · 模型（全部可选，按第 2 节的回答装）

清单：`models.manifest.json`。先按用户选择的架构查 `arch_requires`，只下这些 id。

**先对照 P0.5 的扫描报告**：已经存在且字节数/header 校验通过的文件**直接跳过**，
只下用户确认要补的缺口——不要因为清单里写了就重新下一遍。

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
venv/bin/python main.py --listen 127.0.0.1 --port 8188 --lowvram --cache-ram 2 --preview-method auto --fast-disk
```

- `--preview-method auto` **必加**：默认 `NoPreviews` 会让界面步进预览全黑
- `--fast-disk` 在 NVMe 上实测快 12–16%（见 §2.2），机械盘/慢 SATA 盘去掉
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
- [ ] P0.5 扫描报告已产出（扫到的架构/缺的模块/LoRA 数量），并入环境报告
- [ ] 每个扫到的架构都已导入配置草案，或用户明确说"先不装模型"
- [ ] 提示词转写（可选）：装了则 `/api/prompt/status` 的 detail 无"找不到"错误；跳过则在报告注明"
- [ ] skill.md 已复制为 `<技能目录>/klockui/SKILL.md`（用户拒绝则注明）
- [ ] 环境报告已填写
- [ ] 未改 ComfyUI 源码、未用系统 Python、**未删除或覆盖用户已有的模型/LoRA**

---

## 附：卸载

| 装了什么 | 怎么撤 |
|---|---|
| ComfyUI | 删 `<父目录>/ComfyUI` |
| KlockUI | 删 `<父目录>/KlockUI` |
| 模型 | 删 `<ComfyUI>/models/<dir>/<file>` |
| 环境变量 | 从 shell 配置删 `KLOCK_*` 行 |

不写系统目录、不注册服务、不改 PATH。

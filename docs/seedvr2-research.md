# 低显存扩散超分调研（2026-11-21）

> 起因：之前在 install.md 里写了「不建议 HAT / SwinIR / SUPIR，8GB 太慢」，
> 用户指出判断过于笼统——扩散超分并非都要 24GB。重新调研并**实测**后记录如下。

## 结论先行

**有，而且能在你的 8GB 上跑。是 SeedVR2，不是 SUPIR。**

| 方案 | 8GB 可行性 | 实测 |
|---|---|---|
| SeedVR2 3B Q4（GGUF） | ✓ | **1024×1536 → 2048×3072，36.7 秒** |
| SUPIR fp8_unet + tiled sampler | 理论上可，但很慢 | 未实测 |
| HAT / SwinIR | 非扩散，且 transformer 慢 | 不推荐 |

之前的错误：把 SUPIR 官方全精度 FP16（24GB）当成了所有扩散超分的要求，
忽略了 GGUF 量化和 BlockSwap 这两条低显存路径。

---

## SeedVR2 是什么

字节跳动 Seed 团队的**一步扩散**超分模型，同时支持图像和视频。
ComfyUI 接入：第三方节点 [`numz/ComfyUI-SeedVR2_VideoUpscaler`](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)。

「一步扩散」是关键：不需要跑 20–40 步，1 步就够，所以能在消费卡上实用。

### 模型矩阵（HF `cmeka/SeedVR2-GGUF` / `numz/SeedVR2_comfyUI`）

| 档位 | 文件 | 体积 | 适用 |
|---|---|---|---|
| **8GB 推荐** | `seedvr2_ema_3b-Q4_K_M.gguf` | **1.86GB** | 实测配置 |
| 8GB 宽松 | `seedvr2_ema_3b-Q8_0.gguf` | 3.41GB | 显存余量大时 |
| 12–16GB | `seedvr2_ema_3b_fp8_e4m3fn.safetensors` | 3.16GB | 质量更好 |
| 24GB+ | `seedvr2_ema_7b_fp16.safetensors` | 15.35GB | 最高质量 |

配套 VAE：`ema_vae_fp16.safetensors`，470MB。

---

## 本机实测（RTX 5060 Laptop 8GB / 16GB RAM）

### 安装

```bash
cd D:/AI/ComfyUI/custom_nodes
git clone https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git
cd ../..
venv/Scripts/python.exe -m pip install -r custom_nodes/ComfyUI-SeedVR2_VideoUpscaler/requirements.txt
```

依赖新增 18 个包（diffusers / peft / gguf / omegaconf 等），
**torch 未改动**，装前装后都是 2.14.1+cu130。快照在 `_backup/pip-freeze-before-seedvr2.txt`。

模型下到 `ComfyUI/models/SEEDVR2/`：

```
seedvr2_ema_3b-Q4_K_M.gguf     1,995,344,224 bytes
ema_vae_fp16.safetensors         501,324,814 bytes
```

节点加载 9.5 秒，注册 9 个节点：

```
SeedVR2LoadDiTModel / SeedVR2LoadVAEModel / SeedVR2VideoUpscaler
SeedVR2Conditioning / SeedVR2Preprocess / SeedVR2PostProcessing
SeedVR2TemporalChunk / SeedVR2TemporalMerge / SeedVR2TorchCompileSettings
```

### 关键参数（8GB 不爆显存的组合）

```
blocks_to_swap: 32          # 32/32 transformer 块全卸载到 CPU
swap_io_components: true    # 输入/输出嵌入也卸载
encode_tiled: true          # VAE 编码分块 512 / overlap 64
decode_tiled: true          # VAE 解码分块 512 / overlap 64
offload_device: cpu
batch_size: 1
color_correction: lab
resolution: 2048            # 短边目标像素
```

日志实证：

```
🚀 Materializing DiT weights to CPU (offload device)
🔀 BlockSwap: 32/32 transformer blocks + I/O components offloaded to CPU
🎬 Output assembled: 1 frames, Resolution: 2048x3072px
```

### 性能与画质

| 项 | 数值 |
|---|---|
| 1024×1536 → **2048×3072**（4 倍像素） | **36.7 秒** |
| 显存峰值 | 未见异常占用，空闲读数 1.4GB |
| 高频细节（vs Lanczos 放大） | **+24.1%** |
| 缩回原尺寸与源图平均差 | **3.54 / 255** |

「缩回后差 3.54」说明它**保特征**：不重绘人物、不改构图、不漂移画风。
但它确实补了高频（+24%），不是纯插值。这正是扩散超分比 ESRGAN 强的地方——
ESRGAN 是锐化已有像素，SeedVR2 是真去噪重建。

### ⚠️ 输出像素是硬上限（用户实测 4x 卡死的教训）

节点 DiT **一次处理整图，没有图像分块**，显存由输出像素量直接决定：

| 目标 | 输出像素 | 结果 |
|---|---|---|
| 1.5x（1024×1536 源） | 3.5M | ✓ |
| 2x | 6.29M | ✓ 36.7s |
| 3.16x（clamp 后） | 6.7M | **采样器卡死 0%，interrupt 无效，只能重启引擎** |
| 4x 直出 | 25M | 必爆（cuMemSetAccess OOM） |

所以 `SEEDVR2_MAX_PIXELS = 6_300_000` 贴着实测成功值，宁小勿大。
超限时后端自动收敛倍数，返回体带 `vramClamped: true`，界面提示
「要更大：先按 2x 放大，再用 ESRGAN 接力」。

另外两个坑：

1. `/free` 清显存救不了像素超限（方向错误，已撤销）——驻留不是主因。
2. 卡死状态 interrupt 不响应，必须杀引擎进程重启。

### 踩坑

1. `SeedVR2VideoUpscaler` 的 `uniform_batch_size` 是**必填**，漏了校验失败。
2. 短边 `resolution` 填原图值等于没放大（第一次测试填 1024，输出仍是 1024×1536）。
3. 节点用 ComfyUI 0.45 的新式 `comfy_entrypoint` 注册，没有 `NODE_CLASS_MAPPINGS`，
   靠 `/object_info` 才能确认是否加载。

---

## 与现有 Hires 二采的关系

KlockUI 的「高清二采」是 **latent 放大 + 低噪重绘**（denoise 0.30–0.35），
已经属于扩散放大，但走的是标准 KSampler，会轻微改变人物。

SeedVR2 的价值在**不改人物**的场景：

| 场景 | 用什么 |
|---|---|
| 出图时就想放大，允许轻微重绘补纹理 | 现有 Hires 二采（快，1.25x） |
| 出完图后放大，人物必须一模一样 | **SeedVR2** |
| 只要更大、不追求补细节 | ESRGAN（UltraSharp / AnimeSharp），秒级 |

两者不冲突，可以并存。

---

## 已接入 KlockUI（2026-11-21）

接在**放大弹窗的「算法」选择区**，不是新开一个按钮——用户本来就在那里选
AnimeSharp / UltraSharp / Remacri / Anime6B，SeedVR2 作为第一种算法排在最前面。

改动：

| 层 | 改了什么 |
|---|---|
| 前端 | `renderUpscaleAlgoOptions()` 在模型可用时插入 `SeedVR2` 选项；倍数选择器对它有效（ESRGAN 固定 4x 才隐藏倍数） |
| 前端 | `loadEngineCatalog()` 读 `data.seedvr2.ready` → `state.seedvr2Ready` |
| 后端 | `/local/engine/catalog` 新增 `seedvr2` 字段，探测 DiT + VAE 两个文件是否都在 |
| 后端 | `/local/postprocess` 白名单放行 `SeedVR2` |
| 桥接 | `comfy_bridge.upscale_seedvr2()`：LoadImage → SeedVR2LoadDiTModel + LoadVAEModel → VideoUpscaler → SaveImage，走已有的 `_submit_and_collect` |
| 路径 | `SEEDVR2_DIR` 自动探测：统一模型库和 `ComfyUI/models/SEEDVR2` 都试，可用 `KLOCK_SEEDVR2_DIR` 覆盖 |

**端到端实测**（KlockUI → ComfyUI → 出图）：

```
catalog.seedvr2.ready = true
POST /local/postprocess {path, scale:2, upscaler:"SeedVR2"}
→ 39.5s，返回标准放大结果（image/width/height/preview/mode）
```

浏览器确认算法按钮顺序：`SeedVR2 / AnimeSharp / UltraSharp / Remacri / Anime6B`。

### 踩坑（接入时）

1. `seed: -1` 被节点拒绝（最小 0），改成随机正整数
2. `uniform_batch_size` 是必填字段，漏了校验失败
3. `SEEDVR2_DIR` 最初按 `UPSCALE_DIR` 的父目录推，那是统一模型库 `D:/AI/models`，
   而模型实际在 `D:/AI/ComfyUI/models/SEEDVR2` —— 必须单独探测
4. `/local/postprocess` 的 `path` 必须带输出子目录前缀
   （`txt2img-images/xxx.png`），裸文件名 404

---

## 复现脚本

`_backup/_shots/seedvr2_test.py`，用法：

```bash
cd D:/AI/_backup/_shots
python seedvr2_test.py klock_seed_test.png 2048
```

第一个参数是已经放进 `ComfyUI/input/` 的文件名，第二个是短边目标像素。

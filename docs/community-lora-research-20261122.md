# 社区高分 LoRA 调研（2026-11-22）

> 目标：补 KlockUI 最缺的一系——**Anima**。依据 `explore-report-2026-11.md`：C 站最新 200 个 LoRA 中 Anima 58 个（29%，仅次于 Illustrious 60），而本地 `loras.manifest.json` 只有 10 支、预设引用覆盖不足。Krea 2（本地 93 支）、MOSS（38 支）已饱和，本轮不再堆。
> 数据来源：B 站视频元数据（本地 `.research/` 8 份 JSON）、C 站/C 站中文镜像页面、Tensor.Art、liblib。**2026-11-22 补记**：C 站页面摘要里的「50.7k/41.8k」是搜索结果拼接错显，经 API 核对真实下载量为下表数值——以 API 为准。数字为**页面公开值**，非本机实测——按 skill.md §10.5「不要靠间接指标代替观感」，全部标注为**候选**，安装后仍需实拍验证。

## 一、推荐优先级（先看结论）

| 档 | LoRA | 架构 | 口碑证据 | 建议权重 | 理由 |
|---|---|---|---|---|---|
| **A1** | **Miyu Style** `@mxyx` | Anima | C 站 Anima 版 1030 下载 / **Very Positive 120 评** | 1.0 | Anima LoRA 里评价样本最大；87.72MB；作者同出 Illustrious 版 |
| **A2** | **MeMaAni Flat Anime** | Anima | C 站 v2.0C 4211 下载 / 全系 17.6k / **Very Positive 165 评** | 1.0 | 评语数最多；Megami 杂志画风，去日文文字训练；1792 分辨率训练可出大图 |
| **A3** | **RDBT \| Anima** | Anima | C 站 25.9k 下载 / **Very Positive 80 评** | 见注 | 蒸馏/底模级（8步、16步、dmd2 等多版本），本轮首选其 `v1.0 8-step` 分支 |
| **B1** | **Yuming Li Style** | Anima+MOSS | 584 下载 / **Positive 48 评** | 0.6（Anima）/ 0.8（MOSS） | **双架构**，本机两系都能用；132.24MB |
| **B2** | **KaliMichi AniToon - Full Render** | Anima | 4.1k 下载 / Positive 8 评 | 0.7–0.8 | 日漫+美式卡通混合渲染，132.24MB；作者自述复杂姿势有解剖问题 |
| **B3** | **Mutomorokoshi Style** `@mutopaint` | Anima | 104 下载 / Positive 12 评 | 0.8（0.6–1.0） | 厚涂笔触、层次上色，114 张精选图训练 |
| **B4** | **MayngoMay style** `@mngm` | Anima | 76 下载 / Positive 17 评 | 1.0 | 搞笑反应脸/漫画分镜，219 格训练；**不含童年角色**，Re:Zero 系最适配 |
| **B5** | **Style Lora** `@shu` | Anima | 314 下载 / Positive 45 评 | 未标 | 87.61MB，748 tensors；作者仅写「用 AI 图练的」——风格偏通用，待实拍 |
| **B6** | **Marvel's What If...? Style** | Anima | 158 下载 / Positive 24 评 | 0.7–1.0 | 66.31MB，美漫赛璐璐；配角色 LoRA 时此风格降到 0.5 |

## 二、国内作者/社区线（评价数据弱，但风格独特）

| LoRA | 来源 | 作者 | 触发词 / 权重 | 备注 |
|---|---|---|---|---|
| **anima 画风 kanamenaka** | B 站 `BV1VtYJ68EeG` | 絵有紀 | — | **39,759 播放 / 14,891 赞**（赞率 37%，本轮最高）；anima base10 训练 4500step，底模 anima_turboV11 |
| **幻想传说 7in1 / 藤岛康介** | Tensor.Art `1042225890047575083` | flyx3 | `Tales of Phantasia Style` / 0.6–1.5 | 1100+ 张原画集；作者自评 Anima 版细节优于 Illustrious 版，复古感稍弱 |
| **草莓100% 4in1 / 河下水希** | Tensor.Art `1014510791430280175` | flyx3 | `Mizuki Kawashita Style` / 0.6–1.5 | 1000+ 张，13 star；漫画+TV 双风格 |
| **心跳回忆 16in1 / 小仓雅史** | Tensor.Art `1008775764549619504` | flyx3 | `Original Style` / `Ai Maker Style` | 500+ 张；作者做了「现代化调整」避免线条过简 |
| **神话国风美术 @xuanlux** | Tensor.Art `1062782399168956289` | 流水星痕 | `@xuanlux` / 单用 1.2、混用 0.6 | 东方古典奇幻；**明确警告不要配加速 LoRA，否则画风全丢** |
| **Niji Cute 可爱动漫画风** | C 站中文镜像 `civitai.me/58137` | Zoropa | 0.8–1.0 | 132MB，马卡龙配色软萌向；页面写「与 Pony v6/Illustrious 配合良好」，**标 Anima 但实际底座存疑，须用 `_classify()` 核对** |

## 三、B 站视频线索（`.research/` 已缓存元数据，无字幕正文）

| BV | 标题 | 播放/赞 | 可用性 |
|---|---|---|---|
| `BV1jE8Y6NEXm` | 【模型Lora推荐】Krea2 特刊 B（砚青节点） | 2316/68 | 简介写「推荐 40 个 Krea2 LoRA」，全表在充电 PDF（`bilibili.com/opus/1237392176926687250`），JSON 无字幕，**拿不到清单** |
| `BV1FvxT6XEjF` | MOSS 4G 显存 + 神级 LORA 组合 | 8903/329 | 同上，无字幕正文 |
| `BV1oY4X6yEhp` | Krea2 动漫二次元全家桶（lora 推荐+提示词模板） | 39887/1063 | 网盘 `pan.quark.cn/s/3ec34096266b`，未验证 |
| `BV1qm8s6GEvW` | Krea2 姿态控制 ControlNet LoRA | 27086/867 | 关联待办「ControlNet 未接」 |
| `BV1dEuZ6mEH3` / `BV18s8b6CED6` | AIGC特异点的 Krea2 LoRA 鉴赏 / 漫转真 V3 | 7082/333、25225/991 | 作者有 C 站 `AIGC_Singularity` + HF `WarmBloodAban` 主页，可溯源 |

**砚青节点系列**（第三方归档 civarchive）第 78 期明确写「37 个 anima Lora」，但正文只有首页截图与充电 PDF 链接，**无逐条清单**。要拿全表得看充电 PDF。

## 四、避坑与硬规则（来自本项目记忆，别踩）

1. **RDBT 是蒸馏/底模级，不是画风 LoRA**。已有踩坑：2.9B 直接叠 28-block Turbo LoRA 会触发 `Re-Mapping 28 to 40`，慢 5–19%；内置 Turbo 整模再叠 Turbo LoRA = 双重蒸馏过饱和。**先确认它挂在哪一档**。
2. **命名决定架构**：下载后必须按 `loras.manifest.json` 的 `name` 重命名，前缀 `anima_` 才会归到 Anima 系；Krea LoRA 挂到 Anima 不报错、只无效，最难查。
3. **三步核对**（skill.md §11.7）：① 用 `_classify()` 判真实架构，别信文件名（Niji Cute 存疑）；② 字节数精确比对；③ safetensors header 能否解析。
4. **权重**：Anima 是多步架构（28–50 步），1.3–1.6 也能吃；画风类 0.6–0.9 起；一次不超过 2 支。蒸馏档总权重≈1。
5. **许可**：C 站 Anima 系普遍是 `CircleStone Labs Non-Commercial License v1.2`（非商用）；LORA_LIBRARY 只加中文标题/建议权重/描述，删 LoRA 时**不要删库条目**。
6. **C 站 `Rent` 标记 = 付费**，跳过，按 `purpose` 找同类免费替代。

## 五、落地建议（下一步）

- 先只装 **A1 Miyu Style**（87.72MB）+ **A2 MeMaAni**（264MB），两者评价样本最大、体积可控。
- 实拍验证：同 seed、同底模（Anima SFT）、832×1216、8 步 turbo 与 28 步标准各跑一轮，看是否崩结构。不靠下载量下结论。
- 验证通过后再按 `manifest` 格式补进 `loras.manifest.json`（字段 `name/arch/purpose/tier/presets/used_by/size/search_hint`），并在 `assets/app.js` 的 `LORA_LIBRARY` 加中文条目。
- 本文件放 `docs/`，**不进发行包**（须同步加入 `scripts/make_release.py` 的 `DEV_ONLY`）。

## 来源

- 本地 `.research/*.json`（B 站官方 view API 元数据，8 份）
- C 站：`models/2023846`（Miyu）、`models/2580945`（KaliMichi）、`models/2971260`（Yuming Li）、`models/2995344`（Mutomorokoshi）、`models/3018121`（MayngoMay）、`models/2951278`（@shu）、`models/2712667`（What If）、`models/2483826`（MeMaAni）、`models/2364703`（RDBT）
- civitai.red / civitai.me / tensor.art / liblib.art / civarchive.com
- `D:\AI\KlockUI\explore-report-2026-11.md`、`anima-research-20261031.md`、`lora-list.md`、`skill.md` §11、`install.md` §2.3

## 六、已执行（2026-11-22 01:56）

下载通道：本机 Clash `127.0.0.1:7897` + `D:/AI/_backup/civitai.token`（复用 `fetch_civitai.py` 的成熟路径）。C 站直连不通、civitai.red 403，必须走代理。

| 本地名 | 来源版本 | SHA256 校验 | 状态 |
|---|---|---|---|
| `anima_miyu_style` | v3142446 | BC67ED9B… 一致 | 已装 91.98MB |
| `anima_memani_flat` | v3309374（v2.0 C） | C6762807… 一致 | 已装 277.28MB |
| `anima_yuming_li` | v3367097（Anima 版） | F1E35DC7… 一致 | 已装 138.66MB |
| `anima_mutopaint` | v3397065 | F2AE3174… 一致 | 已装 138.66MB |

**踩坑**：C 站 API 的 `sizeKB` 是近似值，`sizeKB×1024` 与真实字节差 208~1687 字节。**以 SHA256 为准，别用 sizeKB 做准确性判据**。safetensors header 均可解析（840 / 1344 / 896 / 896 tensors），KlockUI 未重启即识别（160→164）。

**注意 PEFT 前缀**：miyu/memani 是 `lora_unet_blocks_*`，yuming/mutopaint 是 `diffusion_model.blocks.*`——两种前缀都在本项目记忆的「前缀坑」名单里（`base_model.model.blocks.*` 才是 0 patches）。已提交一张 10 步生成验证，进度到 0.99 无报错，但**未做画质对比**，属待实拍确认。

配套预设（4 个，`presets/29`~`32`）：
- `29-anima-miyu-style.json` — Miyu 1.0，28 步 CFG4
- `30-anima-memani-flat.json` — MeMaAni 1.0，28 步 CFG4
- `31-anima-yuming-li.json` — Yuming Li 0.6，28 步 CFG4
- `32-anima-mutopaint.json` — Mutopaint 0.8，28 步 CFG4

全部用 `anima-aesthetic-v1.1.safetensors`（本机唯一 Anima checkpoint），单支画风 LoRA 不叠加。抽卡档若要加速，按现有惯例补 `anima_turbo_v0.2` 并把总权重压到 ≈1。

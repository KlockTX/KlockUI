# SwarmUI 调研与借鉴清单

> 调研时间 2026-11-20。对象：[mcmonkeyprojects/SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI) v0.9.8 Beta。
> 目的：找出 KlockUI 该学什么、不该学什么，以及生态位怎么讲清楚。

---

## 一、SwarmUI 是什么

| 项 | 内容 |
|---|---|
| 定位（官方原话） | *"A Modular AI Image Generation Web-User-Interface, with an emphasis on making powertools easily accessible, high performance, and extensibility"* |
| 前身 | StableSwarmUI，最初在 Stability AI 内部孵化 |
| 技术栈 | **C# / .NET 8** 后端 + 自研 HTML/JS 前端 + ComfyUI 作为主力推理后端 |
| 后端支持 | 可插拔：ComfyUI、AUTOMATIC1111、Swarm-API-Backend（远程实例） |
| 内容类型 | 图像（Krea 2 / SD / Flux）、视频（Wan / LTX-2 / MiniMax H3）、音频（ACE-Step） |
| 许可 | MIT（本体），但会调 GPL/AGPL 组件 |
| 安装 | 一键 `install-windows.bat` → 网页安装向导；另有 Docker / Colab / Runpod / Vast.ai |

**名字来源**：最初的核心功能是让**多张 GPU 同时为同一个用户出图**（"一群"GPU），
尤其面向大网格生成。现在多 GPU 只是特性之一。

---

## 二、它的关键设计取舍（来自官方 Motivations）

1. **为什么用 C# 而不是 Python**
   原文：Python *"lacks 'true' multithreading capabilities (due to Python GIL)"*，
   而这个项目要做「快速响应的多用户、多后端服务」。
   → 这是**架构级**的分歧点，KlockUI 学不了，也不该学。

2. **为什么选 ComfyUI 当主力后端**
   因为 ComfyUI 本身模块化、性能好、代码干净，还白送一个节点编辑器。
   → KlockUI 的判断与之一致，但**没有做后端抽象**。

3. **模块化**
   *"backends are fully separated from the middle-layer which is fully separated from the frontend UI, and all components are interswappable"*。
   → 代价也写明了：*"some tools may not easily be intercompatible"*。

4. **前端自研，不用 Gradio**
   为了能深度定制 UI，也方便远程托管。

---

## 三、值得借鉴的（按性价比排序）

### P0 · 立刻能做，收益明确

**1. 参数分组 + 每个参数一个 `?` 说明**

SwarmUI 的原则：*"exposing all the parameters to you, but making them approachable"*。
做法是——参数全部按组折叠（Refiner / Init Image / …），**每个参数旁边一个小 `?` 图标，
点开是文字解释 + 示例**。

KlockUI 现状：有 `helper` 段落，但只在少数关键控件下面，且是整段文字。
**借鉴点**：给 `steps / cfg / shift / sampler / scheduler / denoise / clip skip`
这类容易困惑的参数加统一 tooltip，文案复用 `skill.md` 第四节的官方配方说明。

**2. 参数组整体开关**

SwarmUI 的 `Refiner` 组标题旁有个 toggle，一拨整组生效/失效。
KlockUI 的 Hires 目前是散落的字段（`enable_hr / hr_scale / hr_upscaler / denoising_strength`）。
**借鉴点**：把 Hires 收敛成一个「高清修复」组 + 一个总开关，关掉时整组灰化。

**3. 安装即向导**

SwarmUI 装完自动开网页，让你选：主题 → 用途（自己/局域网）→ 后端 → 起始模型。
KlockUI 现在是 agent 按 `install.md` 装（更像"托管安装"），体验其实更好，
**但缺一个"装完之后的自检页"**。
**借鉴点**：不需要网页安装器，但可以在首次启动时给一个状态页：
引擎通不通 / 有哪些模型 / 采样器是否匹配 / 缺什么。

**4. 模型选择的三视图**

卡片 / 缩略图 / 列表三种视图切换，外加一棵文件夹树。
KlockUI 的模型是 flat 下拉。
**借鉴点**：模型多于 10 个时，下拉不够用；至少加"最近使用"和搜索过滤。

### P1 · 中期，需要设计

**5. Grid Generator（多轴网格对比）**

选一个参数作为 X 轴、填几个值，再加 Y 轴，一次跑出 N×M 张拼成网格图。
这是调参的刚需——尤其"步数 × CFG"这种组合。

KlockUI 现在只能一张一张试，或者用"本批对比"看同一组参数的 N 张。
**借鉴点**：做一个轻量版——固定提示词，选 1–2 个参数各给 3 个值，生成 9 宫格对比。
这对"按架构调配方"的场景价值极高。

**6. Comfy Workflow tab（原生图出口）**

SwarmUI 给高级用户留了完整的 Comfy 原始工作流页，还有 `Use This Workflow` 把
自定义图接回 Generate 页。

KlockUI 完全不给图——这在"零门槛"定位下是对的，但**缺一个逃生门**：
用户想加个自定义节点就无路可走。
**借鉴点**：不做编辑器，但可以在"高级"里提供「导出当前工作流 JSON」，
让用户拿去 ComfyUI 改，改完再拖回来（这条路 KlockUI 目前完全没有）。

**7. Prompt 语法扩展**

`<random:cat, dog>` 随机选、输入 `<` 弹出可用选项、`<segment:yolo-...>` 分段控制。
KlockUI 已有 `<lora:name:weight>`，可以低成本加 `<random:a,b,c>`——
抽卡场景很实用。

**8. 后端抽象（多 ComfyUI 实例）**

后端页可加多个后端，大 batch / grid 时自动分散。
KlockUI 是单后端写死 `127.0.0.1:8188`。
**借鉴点**：不急。单卡 8GB 用户没有第二块 GPU，加了也用不上。

### P2 · 只记录，暂不做

| 特性 | 为什么暂不做 |
|---|---|
| 多用户 / 会话隔离 | 单机工具，用户就是一个人 |
| 桌面 app 模式（`launch_mode app`） | 现有 `start.bat` + 浏览器够用 |
| 视频 / 音频模型 | 8GB 卡跑视频是自虐；等硬件换代 |
| 扩展系统（Extension） | 需要插件加载规范 + 沙箱，工程量大，且会破坏"零门槛" |
| 云 GPU 模板（Runpod/Vast） | 与"本地、隐私、不要账号"的定位冲突 |

---

## 四、KlockUI 明确不该学的

1. **.NET 重写后端**。KlockUI 的定位是轻量本地工具，Python + 单文件服务足够；
   换成 C# 只会让安装变复杂。
2. **全参数暴露**。SwarmUI 面向"愿意学参数的人"，KlockUI 面向"不想学参数的人"。
   两边都能存在，但混在一起就两头不讨好。
3. **模块化到"组件可互换"**。这种抽象在只有一个后端时是纯负担。

---

## 五、生态位（这是 README 最该讲清楚的）

| 维度 | ComfyUI 原生 | A1111 / Forge | SwarmUI | **KlockUI** |
|---|---|---|---|---|
| 一句话 | 节点图推理引擎 | 经典表单式 WebUI | 模块化全能平台 | **零门槛的本地 WebUI** |
| 心智负担 | 要会搭图 | 要懂采样参数 | 要懂参数 + 后端 | **只要会写描述** |
| 装完能出图 | 不能，得先搭工作流 | 能 | 能（有向导） | **能（问 3 个问题）** |
| 参数从哪来 | 自己填 | 自己填 | 自己填 + 参考文档 | **按模型架构自动给** |
| 换模型 | 改图 | 改下拉 | 改下拉 | **整套参数跟着换** |
| 低显存 | 靠引擎参数 | 靠引擎参数 | 靠后端集群 | **设计目标就是 8–16GB** |
| 中文场景 | 自己想办法 | 插件 | 自己想办法 | **内置转写 / 角色词库 / 画师词库** |
| 谁装 | 你自己 | 你自己 | 你自己 | **可以让 agent 装** |

### KlockUI 的主张（一句话）

> **不要求你懂采样器，也不要求你懂 ComfyUI。**
> 选一个模型，它会知道该用什么采样器、多少步、几张 LoRA；
> 8GB 显存不是"最低要求"，而是设计目标。

### 它不争的东西

- 不争"节点自由度"——那是 ComfyUI 的
- 不争"插件生态"——那是 A1111 的
- 不争"多后端 / 多用户"——那是 SwarmUI 的

**KlockUI 只争一件事：让第一次出图的门槛降到最低，且不用为参数负责。**

---

## 六、行动清单

| 优先级 | 事项 | 工作量 | 依据 |
|---|---|---|---|
| P0-1 | 关键参数加统一 `?` tooltip | 小 | §三-1 |
| P0-2 | Hires 收成一个组 + 总开关 | 小 | §三-2 |
| P0-3 | 首次启动自检页（引擎/模型/参数匹配） | 中 | §三-3 |
| P0-4 | README 重写，讲清生态位 | 小 | §五 |
| P1-1 | 轻量 Grid（1–2 参数 × 3 值 = 9 宫格） | 中 | §三-5 |
| P1-2 | 导出当前工作流 JSON（逃生门） | 中 | §三-6 |
| P1-3 | `<random:a,b,c>` 语法 | 小 | §三-7 |
| P2 | 多后端 / 扩展系统 / 视频 | 大 | §三-P2 |

---

## 附：一手资料

- README：https://github.com/mcmonkeyprojects/SwarmUI
- 设计动机（SwarmUI 仓库内的 `docs/Motivations.md`）：为什么 C#、为什么选 ComfyUI、为什么自研前端
- 使用文档（SwarmUI 仓库内的 `docs/Basic Usage.md`）：安装向导、参数分组、Grid Generator、多后端

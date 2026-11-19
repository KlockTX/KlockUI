# 前端约定

> 写给改这个前端的人（和 agent）。KlockUI 没有构建步骤，也没有框架——
> 原生 JS + mdui。所以**约定就是架构**，破坏约定就等于制造下次的坑。

## 一、文件职责

| 文件 | 放什么 | 不放什么 |
|---|---|---|
| `assets/data.js` | **只读数据**：词库、LoRA 目录、图标、架构档案、画质档 | 逻辑、DOM、state |
| `assets/ui.js` | 纯工具：建元素、架构名、关弹窗、防抖 | 任何业务状态、任何 `fetch` |
| `assets/app.js` | 业务逻辑、状态、事件绑定 | 通用工具（ui.js）、静态数据（data.js） |
| `index.html` | 结构；每个会被 JS 引用的节点必须有 `id` | 内联样式、内联事件 |
| `assets/app.css` | 样式；只用设计令牌 | 硬编码颜色 / 字号 |

## 二、ui.js 提供什么

```js
const { h, archLabel, bindDialog, debounce } = window.KUI;
```

**`h(tag, props, ...children)`** —— 建 DOM。`class` / `text` / `html` / `on` / `dataset` 是特殊键，其余写属性。
子节点可以是字符串、节点、数组，`null`/`false` 会被跳过（方便条件渲染）。

```js
h("div", { class: "row" },
  h("span", { text: item.name }),
  item.badge ? h("em", { text: item.badge }) : null
)
```

**`archLabel(arch)`** —— `krea → "Krea 2"`。**新增架构时只改 `ARCH_LABELS` 一处**，
不要再在别处写 `{ krea: "Krea 2" }` 这种内联映射。

**`bindDialog(dialog, ...closers)`** —— 给弹窗挂"点这些按钮就关"。
替代每个弹窗一行 `el.closeX.addEventListener("click", () => { el.x.open = false })`。

**`debounce(fn, ms)`** —— 尾触发防抖，`.cancel()` 可取消。搜索框、尺寸输入一律用它，
不要手写 `setTimeout` + 全局 timer。

## 三、样式规则

**只用令牌，不写字面值**：

```css
/* 对 */  font-size: var(--fs-micro); border-radius: var(--r-sm);
         color: rgb(var(--mdui-color-on-surface-variant));
/* 错 */  font-size: 11px; border-radius: 8px; color: #8b949e;
```

现有令牌：`--fs-micro / --fs-xs / --fs-sm / --fs-small`、`--r-sm`、
`--app-outline-soft`、mdui 的 `--mdui-color-*`。

**新组件必须能在浅色与深色主题下读**：颜色走 `rgb(var(--mdui-color-*))`，
透明度用 `/ .08` 这种写法，不要写死 rgba。

## 四、加一个功能的完整流程

1. **结构**：`index.html` 里加节点，先给 `id`（JS 全靠 `$("#id")` 取）
2. **取元素**：在 `el` 映射里加一行；不要把 `$("#x")` 散落在业务函数里
3. **状态**：加到 `state` 初始值里，别用模块级 `let` 兜着
4. **逻辑**：新函数紧挨同类函数放，别追加到文件末尾
5. **样式**：加到 `app.css` 对应分组，只用令牌
6. **绑定**：统一在 `init()` 里绑定，不要在渲染函数里重复绑
7. **验收**：`node --check assets/app.js` + 浏览器里点一遍 + `/api/status` 正常
8. **落后端**：接口走 `server.py` 的 `do_GET` / `do_POST` 分支，返回 JSON；
   涉及写文件必须做**文件名白名单 + 内容校验**（见 `_preset_save`）

## 五、已知的历史债（下次重构优先处理）

| 位置 | 问题 | 建议 |
|---|---|---|
| `assets/app.js` | 单个 IIFE 约 670KB，463 个函数 | 按领域拆 `presets.js` / `loras.js` / `gallery.js`，用 `<script>` 顺序加载 |
| LoRA / 图库列表 | 手工 `createElement` 拼接，每次全量重建 | 改用 `h()`；列表长时考虑 `requestAnimationFrame` 分片 |
| `app.css` | 309 个选择器，部分分组重复 | 用 `@layer base, components, utilities` 分层 |
| 弹窗 | 8 个 `mdui-dialog`，open/close 逻辑各写一遍 | 抽 `openDialog(el, onOpen)` 统一处理动画时序 |

## 六、不要做的事

- **不要引入构建链**（webpack/vite/ts）。这个项目的卖点之一是 clone 就能跑。
- **不要为了 DRY 过度抽象**：只有重复 3 次以上、且形状稳定的才抽。
- **不要在渲染函数里绑事件**：列表重建会重复绑定，内存与行为都会漂。
- **不要把业务状态挂到 `window`**：现在的 `window.__klockui` 是只读调试入口，别再扩大。

## 七、加载顺序（错了会白屏）

```html
<script src="/assets/data.js"></script>   <!-- 1. 数据，app.js 解构依赖它 -->
<script src="/assets/ui.js"></script>     <!-- 2. 工具，挂 window.KUI -->
<script src="/assets/app.js"></script>    <!-- 3. 主逻辑 -->
```

`app.js` 开头有两行解构，就是这三者的契约：

```js
const { h, archLabel, bindDialog, debounce } = window.KUI;
const { MODEL_PROFILES, LORA_LIBRARY, TAG_GROUPS, ... } = window.KLOCK_DATA;
```

**新增数据表**：写进 `data.js` → 在 `data.js` 末尾的导出对象里加名字 → 在 `app.js` 的解构里加名字。
三处漏一处就是 `undefined`，症状通常是"某个下拉空了"，而不是报错。

## 八、2026-11-19 拆分记录

| | 拆分前 | 拆分后 |
|---|---|---|
| `app.js` | 561.9 KB | 423.5 KB（−24.6%） |
| `data.js` | — | 152.9 KB |
| `ui.js` | — | 3.0 KB |

搬走的 20 个数据块：`LORA_LIBRARY`(37KB)、`TAG_GROUPS`(21KB)、`KREA_PRESET_GROUPS`(14KB)、
`MOSS_CHARACTER_GROUPS`(12KB)、`MOSS_TAG_GROUPS`(9KB)、`MODEL_PROFILES`(9KB)、`ICONS`(6KB) 等。

**两个必须记住的坑**（第一次拆分就踩了第一个）：

1. 切块时 `start` 吃掉了 const 前的换行，`end` 又带走块尾换行，**直接删会把上一行注释和
   下一行代码粘成一行**，下一行被注释吃掉。`MODEL_PROFILE_LIST` 就这么消失过。
   正确做法是删除后补一个 `\n`。
2. 数据块之间有引用（`MODEL_PROFILES → QUALITY_GENERIC`、`MOSS_PRESET_GROUPS → MOSS_STYLES`），
   所以 `data.js` 必须写成「顺序 const + 末尾导出」，不能写成一个对象字面量。

## 九、为什么没有继续拆「行为模块」

本轮只拆了数据，没拆逻辑（预设 / LoRA / 图库这些）。

原因是纯函数抽取被**共享常量**卡住：`loraDefaultWeight` → `loraInfo` → `LORA_LIBRARY`，
`loraInfo` 按"不碰 el/state"算是纯函数，但它依赖模板作用域里的数据表。搬出去就必须
给每个模块注入 data，等于重建一套依赖系统——**在没有测试的情况下，这是纯风险**。

要继续拆，先补这三样（按顺序）：

1. **冒烟脚本**：能自动跑「加载页 → 开三个弹窗 → 生成一张 512×512 → 断言 done」
2. **命名空间**：`window.Klock = { state, el, data, fns }`，模块只从这里取
3. **按领域切**：`presets.js` / `loras.js` / `gallery.js` / `prompt.js`，每次只切一个并跑冒烟

顺序不能颠倒。先切模块再补测试，等于蒙着眼改。

## 十、视觉层约定（2026-11-19 CSS 重构）

### 令牌只有这几组，新增前先想清楚

| 组 | 令牌 | 用途 |
|---|---|---|
| 字号 | `--fs-micro / xs / sm / md / lg` | 9.5 / 10.5 / 12 / 13.5 / 15 |
| 圆角 | `--r-xs / sm / md / lg / full` | 8 / 12 / 16 / 20 / 999 |
| 间距 | `--sp-1…8` | 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 |
| 动效 | `--dur-fast / base / slow` + `--ease-out` | .12 / .2 / .32 |
| 焦点 | `--focus-ring` `--focus-offset` | 统一键盘焦点环 |
| 颜色 | `--mdui-color-*` + `--k-*` 品牌色 | 明暗主题由 mdui 切换 |

**间距刻度是 2 的倍数为主、4 的倍数优先**。出现 5/7/9 这种值说明在硬凑视觉，先想是不是布局本身要改。

### 这次改了什么

| 项 | 数量 |
|---|---|
| `gap` 改为 `var(--sp-*)` | 316 处引用（含 88 处 ±1px 归一：7→8、9→8、11→12） |
| `border-radius` 改为 `var(--r-*)` | 136 处 |
| 动效时长归一 | 138 处（原本 6 种时长：.12/.13/.14/.15/.16/.18 → 统一两档） |
| 全局焦点环 | 新增，覆盖 `button` / `a` / mdui 组件 `::part` |

**归一前先量了影响**：用固定视口截了「主界面 / 预设弹窗 / LoRA 弹窗」三张图做像素对比，
差异 1.5–1.9%（本质是 1px 间距导致的亚像素位移），肉眼不可见，布局无破版。

### 控件尺寸：两轮做完

高度早就有令牌（`--h-sm 28 / --h-md 34 / --h-lg 40`），横向内边距这次补齐：

```css
--pad-ctl-1: 8px;   /* 紧凑 chip、图标按钮 */
--pad-ctl-2: 10px;  /* 顶栏 chip */
--pad-ctl-3: 12px;  /* 文字按钮 */
```

改动 32 处，其中 16 处是**左右不对称的修正**——原来写成 `0 10px 0 11px`、`0 8px 0 9px`
这种差 1px 的值，看着像文字没居中。统一取较小值后，顶栏 chip 的 padding 变成
左右一致（`.model-chip` 实测从 `0px 10px 0px 11px` → `0px 10px`）。

**验证方式**：改前改后各测一遍 10 个个关键控件的 `getBoundingClientRect().height`，
全部一致（36 / 40 / 48 / 28 一个没变）——证明只改了内边距对齐，没让任何控件变大变小。

`padding` 仍有 99 处非刻度值（`0 9px`、`8px 9px` 这类）。剩这些是因为它们成对出现在
四值简写里，单独换会破坏视觉平衡，需要连 `padding` 一起重排布局，属于改版级的活。

### 不要做的事

- 不要用 `!important`（全文件只剩 14 处，都是和 mdui 内部样式对抗的历史遗留）
- 不要给单个组件写 `transition: .15s`，用 `var(--dur-fast)`
- 不要在组件里重画焦点环，全局规则已经覆盖

## 十一、控件自建原则（2026-11-19）

**能自己画的，不要用原生/mdui 默认外观。** 原因不是"好看"，是**尺寸与状态不可控**：

| 组件 | 原方案 | 现在 | 为什么 |
|---|---|---|---|
| 搜索框 | `mdui-text-field` 描边框 | `.pill-search` 胶囊（原生 `input`） | 高度 48px 与胶囊按钮的 28px 对不上 |
| 滚动条 | 系统 overlay 滚动条 | 自定义细条 + `scrollbar-gutter: stable` | overlay 会压在卡片上 |

### 胶囊搜索框

```html
<label class="pill-search">
  <span class="icon pill-search-icon" data-icon="search"></span>
  <input type="search" class="pill-search-input" placeholder="…">
</label>
```

- 高度固定 `var(--h-sm)`，和 chip / 分类条完全一致
- 聚焦用 `:focus-within` 画环，不依赖组件内部状态
- 清除按钮用 `::-webkit-search-cancel-button` + mask 自己画
- JS 侧仍然是 `.value` + `input` 事件，**替换组件不需要改逻辑**

### 滚动条

```css
* { scrollbar-width: thin; scrollbar-color: rgb(var(--mdui-color-outline) / .45) transparent; }
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-thumb { background: …; border: 2px solid transparent; background-clip: padding-box; }
```

配合滚动容器上的 `scrollbar-gutter: stable` + 右内边距，内容不再被压住。

**注意**：`scrollbar-gutter` 会让容器始终留出槽位（即使不滚动），
所以只给确实会滚的列表加（`.lora-list` / `.saved-list` / `.gallery-grid`），别全局加。

### 还剩哪些原生控件

`<input type="file">` 4 个（全部隐藏，只作触发）、`type="hidden"` 1 个。
没有原生 `<select>`、`<input type="range">`、`<input type="number">` —— 这些都已用 mdui 组件或自建替代。

## 十二、静态资源版本与缓存（踩过的坑）

**症状**：HTML 换了结构，页面却还是旧样式——搜索框变成一个带白底描边的原生输入框。

**原因**：`index.html` 里四个资源各带一个 `?v=` 参数，我只改了 JS 的，CSS 还是旧版本号；
而 `server.py` 对静态资源发的是 `Cache-Control: public, max-age=3600`，
浏览器直接用了缓存里的旧 CSS，新 HTML + 旧 CSS 拼出一个"半个新界面"。

**现在两道保险**：

1. **服务器加 ETag + `no-cache`**
   ```python
   etag = 'W/"%x-%x"' % (int(st.st_mtime), st.st_size)
   # 命中 If-None-Match 直接 304，不再有 max-age 窗口期
   ```
   改完文件刷新就生效，未改动时回 304，不额外传输。

2. **版本号一次性全改**
   ```bash
   sed -i 's/?v=[0-9]\{8\}[A-Za-z0-9]*/?v=<新版本>/g' index.html
   ```
   只改某一个资源的版本号 = 制造半截状态，比重构本身更容易出事故。

### 排查口诀

样式"没生效"时先看这三条，再怀疑 CSS 写错：

1. `curl -s http://127.0.0.1:7861/assets/app.css | grep 你的选择器` —— 服务器上到底有没有
2. 浏览器 DevTools → Network → 该 CSS 的 status（200 还是 304 / from cache）
3. `index.html` 里各资源 `?v=` 是否一致

## 十三、画面对比（2026-11-19）

调参最缺的是反馈闭环：改一个参数，前后两张到底差在哪。

实现要点：

| 关注点 | 做法 |
|---|---|
| 同步缩放/平移 | 只维护一份 `compareState{scale,x,y}`，一次赋值给两张图的 `transform` |
| 参数差异 | `compareFieldRows()` 逐项比对，**只渲染不同的行**；相同的字段不占版面 |
| 数据来源 | 历史记录里的 `prompt/negative/model/steps/cfg/sampler/seed`，服务端一直在存，前端之前没接出来 |
| 不改状态 | 对比是纯浏览，不动当前设置、不写文件 |

交互：滚轮缩放（0.6–4 倍）、拖动平移、`交换 A/B`、`更早 / 更新的` 整组前后挪一张。

**已知取舍**：两张图各自等比适配，不强制同尺寸对齐——不同采样器的出图尺寸可能不同，
强行对齐反而会让其中一张变形。

## 十四、图片加载策略（2026-11-19）

三种用途，三个尺寸，别混用：

| 场景 | 地址 | 尺寸 | 单张体积 |
|---|---|---|---|
| 历史条 / 批次条 / 作品库卡片 | `/local/gallery/thumb?path=…` | 480px 长边 | **约 48KB** |
| 主预览、灯箱 | `/local/gallery/file?path=…` | 原图 | 400KB–1.5MB |
| 对比视图 | 同主预览 | 原图 | 看画质需要 |

**之前的错误**：历史条直接塞原图。60 张 1024×1536 解码后约占 360MB 内存，
而它们显示宽度只有 60px 左右——纯浪费。

**缩略图是按需生成 + 磁盘缓存**（`<cache>/thumbs/`，JPEG q82）。
首次访问时服务端用 PIL 生成，之后直接读缓存。

**注意**：如果运行环境没有装 PIL（`Image is None`），接口会退回发原图。
所以「改了却看不出快」时，先确认用的是不是带 PIL 的 venv Python。
KlockUI 的 `start.bat` 用的是 ComfyUI 的 venv，正常都有。

## 十五、性能：实测数据与优化（2026-11-19）

测试环境：真实数据（图片 3083 张、LoRA 180 支、历史 60 条），本机 localhost。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 作品库列表接口（每翻一页） | 187 ms | **15–20 ms** |
| 首屏传输总量 | 9.1 MB | **1.35 MB** |
| 静态资源（html/css/js）传输 | 946 KB | **261 KB** |
| DOMContentLoaded | — | 489 ms |

### 三个动作

**1. 目录扫描加缓存（服务端）**

`scan_images()` 每次 `os.walk` + 3000 次 `os.stat` 约 180ms，
而作品库翻页**每页都调一次**。加 30 秒 TTL 缓存，并在写操作
（生成完成 / 删除 / 收藏 / 后处理）显式失效。

返回时做浅拷贝 `[dict(item) for item in items]` —— 调用方会往 item 里塞
`favorite`、`mode`，直接返回缓存里的字典会被污染。

**2. 静态资源 gzip**

`index.html / app.js / data.js / app.css / *.svg` 走 gzip(6)，带 ETag 与 304。
压缩结果按 (路径, mtime, 大小) 缓存在内存，最多 32 份。

**3. 历史条用 480px 缩略图**（见第十四节）

### 怎么验的

```js
// 浏览器里读真实传输量
performance.getEntriesByType('resource')
  .reduce((a, b) => a + (b.transferSize || 0), 0) / 1024
```

分项看最大的几个资源，才能发现"缩略图其实是原图"这种问题。

### 坑：PIL 缺失时缩略图退化成原图

用没有 PIL 的 Python 起服务时，`/local/gallery/thumb` 会退回发原图，
首屏传输从 1.35MB 变成 9.1MB。**测性能前先确认用的是 ComfyUI 的 venv Python。**

## 十六、冒烟自检（2026-11-19）

```bash
D://AI//ComfyUI//venv//Scripts//python.exe scripts\smoke.py
```

几秒跑完，检查三件事：模块能否导入、模型名规整是否正常、`presets/*.json` 是否合规。
不需要起服务。

**为什么加它**：给请求钉住底模那次改动，把不带扩展名的 stem 塞进了 `UNETLoader`，
ComfyUI 返回 `value_not_in_list`，所有生成全挂 —— 但只有在浏览器里点生成才会暴露。
把这类纯函数检查放进脚本，改完代码先跑一遍，比等用户报错快。

### 模型名必须规整

界面里的 `activeModel` 是 **不带扩展名的 stem**（`krea2_noct_v4_int8_convrot`），
而 ComfyUI 的加载节点只认清单里的 **完整文件名**（`...safetensors`）。

```python
comfy_bridge.resolve_model_file("krea2_noct_v4_int8_convrot")
# -> "krea2_noct_v4_int8_convrot.safetensors"
```

`generate()` 和 `set_model()` 都会先过这一层。历史记录的 `model` 字段也统一存完整名，
否则按模型分组（对比、耗时统计）会把同一个模型分成两组。

## 十七、步预览（2026-11-19）

### 数据怎么来的

ComfyUI 每步会通过 WebSocket 发一帧预览图，`comfy_bridge` 收到后暂存，
`/api/sdapi/v1/progress?skip_current_image=false` 被调用时取走并清空
（`take_preview()`）。

**关键特性：帧是一次性的**。前端 650ms 轮询一次，取走即清空；如果某次轮询晚到，
那一帧就丢了 —— 只是少显示一帧，不影响出图。

实测一轮 8 步：8 帧，每步一帧，约 38KB/帧。

### 这次改了什么

| 改动 | 原因 |
|---|---|
| 每步换图加 120ms 淡入 | 潜空间预览颗粒感强，硬切很跳 |
| 页签隐藏时暂停轮询 | 后台不需要预览，省 CPU；切回来自动追上 |

### 一个被回退的"优化"

试过「先 `new Image()` 预加载，`onload` 后再替换 src」来消除闪屏。
结果预览整段不出现 —— headless 与真实浏览器里都出现过 `onload` 不触发的情况，
而轮询外层有 `catch {}` 兜着，失败是静默的。

**结论**：预览这种"可丢失"的 UI，直接用 `img.src = dataUrl` 最可靠。
想消除闪屏应该在 CSS 上做（淡入），不要在加载时序上做手脚。

### 引擎侧可选：降低预览开销

预览由 ComfyUI 生成，默认 `--preview-size 512`。想要更省，可以：

```bat
--preview-size 256
```

代价是预览更糊。8 步的 Krea 2 上，这项开销通常在每秒几十毫秒量级，不建议为它牺牲观感。

## 十八、预览延迟：从轮询改推送（2026-11-19）

### 之前的延迟从哪来

```
ComfyUI 发一帧 → 桥接层暂存 → 前端 650ms 轮询取走（取走即清空）
```

两个问题叠加：

1. **一次性帧**：轮询晚一拍，那一帧就丢；丢的帧不会补，画面就停在旧的一帧上，
   越丢越落后 —— 看起来就是"预览延迟很大"。
2. **轮询是定时拉**：即使帧已经到了，也要等下一次定时器，平均多 325ms。

### 现在

**① 预览改为粘性**（`peek_preview()` + `preview_seq`）

帧不再取走，而是保留并递增序号。谁读都拿到最新一帧，迟到不会丢。

**② 新增 SSE 推送** `/local/progress/stream`

桥接层每收到一帧，服务端 120ms 内推给浏览器：

```
data: {"step":4,"steps":8,"progress":0.5,"eta":14.2,"image":"/9j/4AAQ..."}
```

只在 `(预览序号, 步数)` 变化时发送，空闲时发 `: keep-alive`，任务结束发 `event: end`。

**③ 轮询退回兜底**

`EventSource` 连不上时 `state.sseActive=false`，轮询恢复带图模式
（`skip_current_image=false`）——两条路不会同时抢帧。

### 实测

```
SSE 事件：t=1.16s step=0 / t=2.69s step=1 / ... 步进即时到达
浏览器：一轮 8 步，34 次采样都能看到预览，步骤文案同步
```

### 遗留：帧本身来得晚

引擎侧前几步常常没有预览帧（实测 10s 后才开始有），这是 ComfyUI
对 int8 大模型的预览生成策略，不是前端延迟。前端能做到的是"来一帧显示一帧"，
不能凭空造帧。

## 十九、用户停止 ≠ 生成失败（2026-11-19）

### 现象

点停止后弹「生成失败：ComfyUI 执行失败：[["execution_start",...],["execution_interrupted",...]]」。

原因：ComfyUI 把中断也报成 `status_str: "error"`，只是在 messages 里带了
`execution_interrupted`。桥接层一视同仁地抛了 EngineError。

### 修法

```python
class JobInterrupted(EngineError): ...

if any(msg[0] == "execution_interrupted" for msg in messages):
    raise JobInterrupted("已停止")
```

服务端单独接这个异常 → `status="cancelled"`；另外加一层兜底：
只要任务被标记过 `interrupt_requested`，其它形态的引擎报错也按「已停止」处理。

前端区分两种终止：

| 阶段 | 进度文案 | 提示 |
|---|---|---|
| 排队中被取消 | 已取消 | 已取消排队任务 |
| 跑到一半被停止 | **已停止** | 已停止生成 |

### 实测

```
停止前：第 6/8 步 · 生成中 76%
停止后：已停止        提示：已停止生成        进度面板已收起
历史记录：0 条新增（中断不落盘）
```

### 原则

**用户主动做的操作不该显示成错误。** 中断、取消、超时（如果是用户触发）都该
走"完成但没结果"的路径，只有引擎真的坏了才弹红色错误。

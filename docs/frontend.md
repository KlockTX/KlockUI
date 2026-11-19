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

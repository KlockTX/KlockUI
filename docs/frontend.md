# 前端约定

> 写给改这个前端的人（和 agent）。KlockUI 没有构建步骤，也没有框架——
> 原生 JS + mdui。所以**约定就是架构**，破坏约定就等于制造下次的坑。

## 一、文件职责

| 文件 | 放什么 | 不放什么 |
|---|---|---|
| `assets/ui.js` | 纯工具：建元素、架构名、关弹窗、防抖 | 任何业务状态、任何 `fetch` |
| `assets/app.js` | 业务逻辑、状态、事件绑定 | 通用工具（放 ui.js） |
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

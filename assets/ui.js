/* KlockUI 前端公共件（2026-11-19）
 *
 * 抽出来的都是「每个弹窗 / 每个列表都要写一遍」的东西：
 *   h()        建 DOM —— 手写 createElement 三步（建、设 className、append）占了 190 处
 *   archLabel()架构中文名 —— 之前散在至少三处，改一个名字要搜三个地方
 *   bindDialog()关弹窗 —— 原来每个弹窗一行 addEventListener，且格式各不相同
 *   debounce() 输入防抖 —— 搜索框都要用
 *
 * 约定：本文件不碰业务状态，只做纯工具；挂在 window.KUI 上，由 app.js 解构使用。
 */
window.KUI = (() => {
  "use strict";

  /**
   * 建元素。props 里 class/text/html/on 有特殊含义，其余当作属性写入。
   * 子节点可以是字符串、节点、数组或 null（null 直接跳过，方便条件渲染）。
   */
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    const spec = props || {};
    Object.keys(spec).forEach((key) => {
      const value = spec[key];
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key === "on") Object.keys(value).forEach((evt) => node.addEventListener(evt, value[evt]));
      else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    append(node, children);
    return node;
  }

  function append(node, children) {
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) append(node, child);
      else node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
  }

  // 架构 id → 展示名。新增架构时**只改这里**。
  const ARCH_LABELS = {
    anima: "Anima",
    krea: "Krea 2",
    zimage: "Z-Image",
    moss: "MOSS",
    sdxl: "SDXL"
  };

  function archLabel(arch) {
    const key = String(arch || "").toLowerCase();
    return ARCH_LABELS[key] || arch || "—";
  }

  /** 给弹窗挂「点这些按钮就关」的行为，省掉每个弹窗一行近乎相同的监听。 */
  function bindDialog(dialog, ...closers) {
    if (!dialog) return;
    closers.filter(Boolean).forEach((node) => {
      node.addEventListener("click", () => {
        dialog.open = false;
      });
    });
  }

  /** 尾触发防抖：搜索框、尺寸输入这类高频事件都用它。 */
  function debounce(fn, wait = 120) {
    let timer = 0;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }

  return { h, archLabel, ARCH_LABELS, bindDialog, debounce };
})();

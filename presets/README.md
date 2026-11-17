# JSON 预设格式

把一整套出图设置写进一个 `.json`，拖到 KlockUI 的画面上就能一键还原。

## 怎么用

1. **拖拽**：把 `.json` 拖到「画面描述」框或「输出规格」卡片上，松手即应用
2. **点击**：左侧「参数预设」→「导入 JSON」
3. **导出**：调好参数后点「导出当前」，会下载一份完整 JSON

---

## 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `klockui` | number | 格式版本，目前固定 1 |
| `name` | string | 载入时提示的名字 |
| `model` | string | 底模文件名，必须与 `models/diffusion_models/` 里一致 |
| `prompt` | string | 正面提示词 |
| `negative` | string | 负面（Krea / Z-Image 是 CFG 1，填了也不生效） |
| `quality` | string | 画质档：`gacha` / `draft` / `standard` / `fine` / `hires` |
| `size` | object | `{ratio: "2:3", width, height}` —— 比例键决定界面选中哪一档，宽高决定实际像素 |
| `ratioKey` | string | 与 `size.ratio` 等价，顶层写法（导出时两者都会出现） |
| `steps` | number | 6–60 |
| `cfg` | number | 1–10 |
| `sampler` | string | `Euler` / `Res Multistep` / `DPM++ 2M` … |
| `scheduler` | string | `Simple` / `Karras` / `SGM Uniform` … |
| `shift` | number | 流匹配模型的时间步偏移 |
| `seed` | number | -1 随机 |
| `batch` | number | 张数 |
| `hires` | bool | 是否开二采 |
| `hrScale` / `hrDenoise` | number | 二采倍率与重绘幅度 |
| `easyCache` | bool | 跳步缓存 |
| `loras` | array | `[{name, weight}]`，文件名不带 `.safetensors` |
| `note` | string | 备注，不参与出图 |

---

## 优先级

```
model → quality → 显式字段（steps/cfg/sampler/shift…）→ loras
```

`quality` 会一次性写入该档的步数、CFG、二采；如果 JSON 里又单独写了 `steps`，以显式值为准。

**例**：`quality: "fine"` + `steps: 12` → 二采用 fine 的 1.25x/0.30，步数用 12。

---

## 最小示例

```json
{
  "klockui": 1,
  "name": "我的配方",
  "model": "krea2_noct_v4_int8_convrot.safetensors",
  "prompt": "anime illustration, cel shading, hatsune miku ...",
  "size": { "width": 832, "height": 1216 },
  "steps": 12,
  "cfg": 1,
  "sampler": "Euler",
  "scheduler": "Simple",
  "loras": [
    { "name": "krea2_yoneyama_mai", "weight": 0.75 }
  ]
}
```

---

## 容错

- JSON 语法错 → 直接报错，不应用任何设置
- `model` 不存在 → 跳过模型切换，其余照常应用
- LoRA 不存在 → 跳过该条，提示缺哪几支
- 引擎忙 / 离线 → 只应用参数，模型稍后手动切

---

## 现有示例

`01`–`11` 是 Krea 2 版（初音未来，12 组场景/姿势/氛围），`12` 是 Z-Image 版（中文海报文字）。

每份都带画风词前缀和画师 LoRA，可以直接拖进去出图，也可以当成模板改。

# 优质二次元 LoRA 与社区配方

> 整理于 2026-11-18。来源是 Civitai 官方模型的下载量与 `trainedWords`（触发词）。
>
> **一个诚实的说明**：Civitai 现在的公开 API 对图片返回的 `meta` 是 `null`，
> 也就是说**抓不到别人的真实出图参数和提示词**。网上流传的“大佬提示词”大多来自模型页作者写的示例。
> 所以下面给的是**官方触发词 + 经过验证的搭配逻辑**，不是冒充从别人图里扒出来的。

---

## 一、新装的 9 支

### Anima（适配你的 `miaomiaoHarem_29BBETA11_bf16`）

| 条目 | 大小 | 下载 | 触发词 | 角色 |
|---|---|---|---|---|
| MoriiMee 哥特霓虹 | 132MB | 15.4 万 | 无 | 哥特、霓虹、蕾丝金属 |
| Ri-mix | 504MB | 5.9 万 | 无 | 厚涂插画、笔触强 |
| 平涂二次元 | 88MB | 4.3 万 | 无 | 干净色块、番剧感 |
| 现实系动画 | 264MB | 4.1 万 | 无 | 动画角色 + 写实光影 |
| 武田弘光 | 175MB | 3.1 万 | 无 | 厚涂、体积感（成人向作者） |
| 米山舞 | 175MB | 1.8 万 | 无 | 强光影、锐利脸型 |
| Flatline | 22MB | 2.3 万 | `@flatline` | 利落线条、高对比（辅料） |
| 90 年代忧郁 | 132MB | 1.5 万 | `90s_melancholy, retro` | 褪色质感、静谧 |

### Krea 2

| 条目 | 大小 | 下载 | 触发词 |
|---|---|---|---|
| 蔚蓝档案画风（BArtstyle） | 895MB | 3.2 万 | `azure youth anime art style` |

**注意**：`anima_yoneyama_mai` 和 `krea2_yoneyama_mai` 是同一个画师的不同底模分卷，不是同一支 LoRA，别混用。

---

## 二、四组“串”配置

原则是 **1 支画师主 + 1 支风格辅**，权重总和压在 1.2–1.5。三支以上会互相打架。

### A · 米山舞系（强光影）

```
anima_yoneyama_mai   0.8
anima_flatline       0.5     ← 只做线条柔化，别抢主风格
```

Anima 提示词：

```
masterpiece, best quality, score_9, score_8, very aesthetic, ultra detailed,
1girl, teal twintails, aqua eyes, looking back over shoulder,
dramatic rim light, wind-blown hair, dynamic composition,
@flatline, soft cel shading
```

负面：

```
worst quality, low quality, score_1, score_2, blurry, jpeg artifacts, extra fingers
```

---

### B · 90 年代怀旧（情绪向）

```
anima_90s_melancholy    0.8
anima_moriimee_gothic   0.5
```

```
masterpiece, best quality, 1girl, sitting by the window, late afternoon,
faded colors, film-like grain, quiet expression, old anime aesthetic,
90s_melancholy, retro
```

要点：这两支都偏暗，别再加暗角词，会糊成一团。

---

### C · 番剧平涂（最稳的日常向）

```
anima_anime_flat        0.85
anima_flatline          0.4
```

```
masterpiece, best quality, 1girl, school uniform, classroom, sunlight through window,
clean flat colors, crisp lineart, anime key visual,
@flatline, soft cel shading
```

---

### D · 蔚蓝档案立绘（Krea 2）

```
krea2_blue_archive_style  0.85
krea2_rim_light           0.5
```

Krea 2 吃**自然语言**，不要塞 booru 标签和质量词：

```
azure youth anime art style, a cheerful schoolgirl standing in a sunlit hallway,
clean cel shading, bright pastel palette, strong rim light separating her silhouette,
three-quarter view, simple background with soft light dots
```

CFG 1，负面留空，建议 12–16 步 + 1.25x 二采。

---

## 三、两个模型的提示词写法差别

| | Anima 2.9B | Krea 2 |
|---|---|---|
| 写法 | **booru 标签串**，质量词打头 | **自然语言描述句** |
| 质量前缀 | `masterpiece, best quality, score_9, very aesthetic, ultra detailed` | **不要写**，会把画面推向写实 |
| 负面 | 有用，CFG 3.5–5 | **无效**，CFG 1，留空 |
| 画风词位置 | 放标签串末尾 | 放句子开头 |

MiaoMiao（你的 Anima 底模）系列作者推荐的具体前缀：

```
masterpiece, best quality, score_7, score_9, very aesthetic, ultra detailed,
fair skin, sensitive, high contrast
```

---

## 四、为什么别人图更精细——回看那个问题

装完这些 LoRA 也未必立刻追上别人，因为差距更可能在这三处：

1. **档位**：8 步标准档 vs 20 步 + 1.35x 二采，差距远大于换 LoRA
2. **LoRA 总量**：叠到 1.35 会把细节洗掉；先关掉全部 LoRA 跑一张做基线
3. **后期**：很多“高质量图”是超分 + 面修 + 调色之后才发的，不是直出

建议先跑 A/B：同样的提示词和 seed，四张对比。

```
A  8 步 / 无 LoRA
B  8 步 / 原 LoRA
C  20 步 + 1.35x / 原 LoRA
D  20 步 + 1.35x / 无 LoRA
```


---

## 五、一支没装成的

**HS Style Gallery**（Anima，22MB，7.4 万下载）在 Civitai API 里返回的是 HTML 页面：
站点已把成人内容迁到 `civitai.red`，而该域名在当前网络下不可达（直连 403 / 代理超时）。
所以这支没有安装，配方里已用 `anima_flatline` 替代它的辅料位置。

---

## 六、各底模的角色 LoRA 存量（2026-11-19 实测）

先说个教训：查 MOSS 时我第一次用了 `baseModels=MOSS-Image`（带连字符），
返回 **0 条**，于是得出"MOSS 没有角色 LoRA"的错误结论。
Civitai 里真实取值是 **`MOSS Image`（空格）**。换成空格后，MOSS 生态立刻出来：
下载量最高的一支有 **22.6 万**。

| 底模 | LoRA 生态 | 角色包 | 实际情况 |
|---|---|---|---|
| **Anima** | 成熟 | **多** | 初音 / 海梦 / 卡莲 / 兔田妈妈都有，几千到一两万下载 |
| **Krea 2** | 很大 | 少而集中 | 以风格、写实、NSFW 为主；角色靠 **ZyloO's Characters（7.9 万）** 这类合集包 |
| **Z-Image** | 大 | **极少** | 榜首是 Hands XL（31.5 万）、细节强化（14 万）——全是工具件，不是角色 |
| **MOSS Image** | 大（22.6 万封顶） | **几乎没有** | 榜单清一色写实/NSFW/风格；角色训练几乎没人做 |

**结论**：不是"LoRA 少"，而是**新架构的 LoRA 生态集中在风格与工具，不集中在角色**。
角色还原度目前仍是 Anima 和 Illustrious/Pony 这类老架构的强项。

### 想在新架构上出某个角色怎么办

三条路，按可靠性排序：

1. **用合集包 + 触发词**：Krea 2 的 ZyloO's、原神 cos 合集都属于这类
2. **不挂角色 LoRA，靠提示词 + 参考图**：Z-Image 对五官和手更准，写清特征也能接近
3. **换架构**：真要精确还原，Anima 或 Illustrious 的角色包数量是 Z-Image 的几十倍

### 补装的 5 支工具件

| 条目 | 底模 | 下载 | 作用 |
|---|---|---|---|
| Hands XL | Z-Image | 31.5 万 | 修手（触发词 hand, detailed） |
| 细节强化 | Z-Image | 14 万 | 手/脚/脸同时强化 |
| YARN 风格集 | Krea 2 | 4.7 万 | 综合画风过渡层 |
| 平涂二次元 | MOSS | 4.36 万 | 补 MOSS 偏写实的问题 |
| Afrobull 画风 | MOSS | 2.3 万 | 触发词 zfr0 |


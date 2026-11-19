/* KlockUI 静态数据（2026-11-19 从 app.js 抽出）
 *
 * 这里只有「不会变的东西」：词库、LoRA 目录、图标路径、架构配置、画质档。
 * 不写逻辑、不碰 DOM、不读 state —— 想改行为请去 app.js。
 *
 * 为什么单独一个文件：
 *   1. app.js 从 560KB 降到约 410KB，读逻辑时不用在几百行词库里滚
 *   2. 词库改动频繁，和逻辑改动分开后，diff 更干净
 *   3. 加载顺序明确：data.js 必须在 app.js 之前
 */
(function () {
  "use strict";

  const QUALITY_GENERIC = {
    draft: { steps: 12, cfg: 5, hires: false },
    standard: { steps: 24, cfg: 5.5, hires: false },
    fine: { steps: 32, cfg: 5.5, hires: false },
    hires: { steps: 28, cfg: 5.5, hires: true, scale: 1.25, denoise: 0.38 }
  };
  const REFINE_PRESETS = [
    {
      id: "face",
      name: "面部与眼神",
      denoise: 0.35,
      desc: "五官、虹膜、睫毛与嘴唇；最稳的定稿第一步。",
      prompt: "detailed face, delicate facial features, symmetrical eyes, detailed irises, catchlights, fine eyelashes, soft skin texture, natural lips, subtle blush, sharp focus on the face"
    },
    {
      id: "hair",
      name: "发丝与轮廓光",
      denoise: 0.35,
      desc: "碎发、层次与发梢高光，适合逆光和侧光。",
      prompt: "individual hair strands, layered hair, flyaway strands, glossy highlights, rim light outlining the hair, soft shadows between strands, detailed hair ornaments"
    },
    {
      id: "skin",
      name: "皮肤与身体质感",
      denoise: 0.30,
      desc: "皮肤通透感与锁骨、肩线；幅度最低，保构图。",
      prompt: "natural skin texture, soft subsurface scattering, subtle pores, collarbone and shoulder definition, anatomically correct proportions, soft specular highlights, no plastic skin"
    },
    {
      id: "hands",
      name: "手部结构",
      denoise: 0.40,
      desc: "手指数量、关节与指甲；手崩时单独修。",
      prompt: "anatomically correct hands, five fingers, natural finger joints and nails, relaxed hand pose, balanced limb proportions, clear silhouette, no overlapping fingers"
    },
    {
      id: "fabric",
      name: "服装与布料",
      denoise: 0.45,
      desc: "织纹、褶皱、缝线与五金；适合换质感。",
      prompt: "detailed fabric weave, natural folds and creases, realistic drapery, stitched seams, embroidered trim, metal buckles, leather texture, cloth following the body pose"
    },
    {
      id: "light",
      name: "电影光影",
      denoise: 0.45,
      desc: "主光、轮廓光、体积雾与色调分离。",
      prompt: "cinematic lighting, warm rim light, soft key light, volumetric haze, clean deep shadows, gentle bloom, atmospheric perspective, subtle film grain, teal shadows and warm highlights"
    },
    {
      id: "background",
      name: "背景与景深",
      denoise: 0.50,
      desc: "环境层次、远景灯光与散景；会改背景，慎高幅。",
      prompt: "detailed background, layered environment, architectural props, distant city lights, atmospheric perspective, shallow depth of field, creamy bokeh, clear separation between subject and background"
    },
    {
      id: "cel",
      name: "赛璐璐收线",
      denoise: 0.40,
      desc: "干净线稿、双色阴影与平涂色块。",
      prompt: "clean cel shading, crisp lineart, two-tone shadows, flat color blocks, precise highlights, consistent line weight, anime illustration finish"
    },
    {
      id: "painterly",
      name: "厚涂笔触",
      denoise: 0.40,
      desc: "可见笔触、堆叠颜料与画布质感。",
      prompt: "painterly rendering, visible brushstrokes, thick impasto, textured canvas, rich color blending, dramatic edge light, illustration finish"
    },
    {
      id: "photo",
      name: "摄影质感",
      denoise: 0.45,
      desc: "35mm 镜头、自然肤质与胶片颗粒。",
      prompt: "photorealistic, 35mm photograph, natural skin and fabric texture, realistic lens falloff, fine film grain, true-to-life color, soft window light"
    }
  ];
  const REFINE_PRESETS_KREA = [
    {
      id: "face", name: "面部与眼神", denoise: 0.5,
      desc: "五官、睫毛与眼神光；最稳的定稿第一步。",
      prompt: "the face in close detail: individual eyelashes, a clear catchlight in each eye, visible pores across the cheekbones, faint freckles, natural lip texture with small creases"
    },
    {
      id: "hair", name: "发丝与轮廓光", denoise: 0.5,
      desc: "逐根发丝与发梢高光，适合逆光和侧光。",
      prompt: "hair rendered strand by strand, fine flyaway hairs catching a rim light, soft shadows between the locks, a few loose strands across the forehead"
    },
    {
      id: "skin", name: "皮肤与身体质感", denoise: 0.42,
      desc: "皮肤通透感与锁骨肩线；幅度最低，保构图。",
      prompt: "natural skin with visible pores and fine texture, subtle subsurface scattering at the ears and nose, a soft sheen on the collarbone, no plastic smoothing"
    },
    {
      id: "hands", name: "手部结构", denoise: 0.55,
      desc: "指节、指甲与手指比例；手崩时单独修。",
      prompt: "hands with visible knuckles and tendons, short natural nails, correct finger proportions, a relaxed pose, slight shadow falling between the fingers"
    },
    {
      id: "fabric", name: "服装与布料", denoise: 0.55,
      desc: "织纹、褶皱与五金；适合换质感。",
      prompt: "fabric in close detail: visible weave, natural folds following the body, stitched seams, slightly worn edges, metal hardware with a dull sheen"
    },
    {
      id: "light", name: "电影光影", denoise: 0.55,
      desc: "主光位置、阴影落差与空气感。",
      prompt: "light from a single warm source on the left, soft falloff across the face, deep clean shadows on the right, a thin haze in the air, gentle bloom around the highlights"
    },
    {
      id: "background", name: "背景与景深", denoise: 0.6,
      desc: "远景层次与散景；会改背景，慎高幅。",
      prompt: "the background pushed out of focus: layered depth, distant lights as soft discs, atmospheric haze separating the subject from everything behind"
    },
    {
      id: "cel", name: "赛璐璐收线", denoise: 0.5,
      desc: "干净线稿与平涂色块。",
      prompt: "clean cel shading with crisp lineart, two flat tones per color, sharp shapes for the highlights, consistent line weight throughout"
    },
    {
      id: "painterly", name: "厚涂笔触", denoise: 0.5,
      desc: "可见笔触、堆叠颜料与画布质感。",
      prompt: "visible brushstrokes with thick impasto, canvas texture showing through the paint, pigment blended wet into wet, edges left slightly rough"
    },
    {
      id: "photo", name: "摄影质感", denoise: 0.55,
      desc: "35mm 镜头、自然肤质与胶片颗粒。",
      prompt: "photographed on 35mm film: natural skin and fabric texture, gentle lens falloff at the corners, fine grain, true-to-life color, light from a north-facing window"
    }
  ];
  const MODEL_PROFILES = {
    miaomiao: {
      id: "miaomiao",
      label: "MiaoMiao Harem 2.9B",
      kind: "Anima 架构",
      arch: "anima",
      match: /miaomiao/i,
      sampler: "Euler",
      scheduler: "SGM Uniform",
      shift: 3.5,
      clipSkip: 1,
      qualityPrefix: "masterpiece, best quality, score_7, score_9, very aesthetic, ultra detailed, fair skin, high contrast, ",
      negativeHint: "worst quality, low quality, lowres, jpeg artifacts, watermark, text, shiny skin",
      qualities: {
        gacha: { steps: 10, cfg: 1, hires: false, turbo: true, sampler: "Euler", scheduler: "Beta" },
        draft: { steps: 20, cfg: 3.5, hires: false, turbo: false },
        standard: { steps: 32, cfg: 4, hires: false, turbo: false },
        fine: { steps: 40, cfg: 4.5, hires: false, turbo: false },
        // 实测 32 步 + 1.25x / 0.4 已是 8GB 上限（94 秒 / 7.5GB），步数再高只多等待
        hires: { steps: 32, cfg: 4, hires: true, scale: 1.25, denoise: 0.4, turbo: false }
      }
    },
    silvermoon: {
      id: "silvermoon",
      label: "SilvermoonMix 2.9B",
      kind: "Anima 架构",
      arch: "anima",
      match: /silvermoon/i,
      sampler: "Euler a",
      scheduler: "Beta",
      shift: 3.5,
      clipSkip: 1,
      qualityPrefix: "masterpiece, best quality, ",
      negativeHint: "",
      qualities: {
        gacha: { steps: 10, cfg: 1, hires: false, turbo: true, sampler: "Euler", scheduler: "Beta" },
        draft: { steps: 20, cfg: 4, hires: false, turbo: false },
        standard: { steps: 28, cfg: 4, hires: false, turbo: false },
        fine: { steps: 36, cfg: 4.5, hires: false, turbo: false },
        // 28 步 + 1.25x / 0.4 实测 47 秒 / 7.5GB；INT8 底模比 MiaoMiao 省一半时间
        hires: { steps: 28, cfg: 4, hires: true, scale: 1.25, denoise: 0.4, turbo: false }
      }
    },
    anima: {
      id: "anima",
      label: "Anima 通用",
      kind: "Anima 架构",
      arch: "anima",
      match: /anima/i,
      // 官方 Anima-2.9B 与 MiaoMiao 系列一致推荐 Euler + sgm-uniform；
      // Euler a 只会加随机性，不该当默认。
      sampler: "Euler",
      scheduler: "SGM Uniform",
      shift: 3.5,
      clipSkip: 1,
      qualityPrefix: "masterpiece, best quality, ",
      negativeHint: "worst quality, low quality, blurry, jpeg artifacts, watermark",
      qualities: {
        gacha: { steps: 10, cfg: 1, hires: false, turbo: true, sampler: "Euler", scheduler: "Beta" },
        draft: { steps: 20, cfg: 4, hires: false, turbo: false },
        standard: { steps: 28, cfg: 4, hires: false, turbo: false },
        // 官方区间 28–50 步、CFG 3.5–5；50 步是画质上限，这里封顶 44（再往上纯线性耗时）
        fine: { steps: 44, cfg: 4, hires: false, turbo: false },
        hires: { steps: 36, cfg: 4, hires: true, scale: 1.25, denoise: 0.4, turbo: false }
      }
    },
    moss: {
      // MOSS-Image 5B：int8 DiT + Qwen3.5-9B w4a8 编码器 + FLUX.2 小 VAE。
      // OpenMOSS 官方配方：Euler + Simple、50 步以上、CFG 3（3–6），Shift baked 5。
      // ComfyUI 模板默认的 25 步 / CFG 2.5 被官方点名"夹生"，不能当标准档。
      // 所有档位都 turbo:false —— 前端 turbo 会挂 anima_turbo LoRA，对 MOSS 不兼容。
      id: "moss",
      label: "MOSS-Image 5B",
      kind: "MOSS 架构",
      arch: "moss",
      match: /moss/i,
      sampler: "Euler",
      scheduler: "Simple",
      clipSkip: 1,
      // MOSS 走自然语言句子，标签式质量前缀会污染语义，这里必须留空；
      // 从 Anima 切过来时 swapPromptQualityPrefix 会顺手把旧前缀剥掉。
      qualityPrefix: "",
      // 中文负面对 MOSS 更直接；重点压「多腿 / 肢体融合」这类最常见的崩坏。
      negativeHint: "低画质，模糊，畸变的手，多余的手指，多余的腿，三条腿，多余的肢体，肢体融合，人体结构错误，比例失调，过曝，水印，文字",
      qualities: {
        gacha: { steps: 8, cfg: 1.0, hires: false, turbo: true, sampler: "ER SDE", scheduler: "Simple" },
        draft: { steps: 16, cfg: 2.2, hires: false, turbo: false },
        standard: { steps: 35, cfg: 3.0, hires: false, turbo: false,
                    sampler: "Euler", scheduler: "Simple" },
        fine: {
          // OpenMOSS 官方 README 配方：50 步 / CFG 3.0 / Euler + Simple。
          // 实测同提示词下头发分层、布料褶皱、手部结构都明显好于 25 步 CFG 2.5，
          // 代价是耗时翻倍（768² 下 18s → 34s），所以只挂在「精细」档。
          steps: 50, cfg: 3.0, hires: false, turbo: false,
          sampler: "Euler", scheduler: "Simple"
        },
        // 高清档：低基准 + 二采。1.5x 时基础分辨率约 683，复杂构图（仰视全身、
        // 交叠腿、长裙）肢体明显更稳；二采 denoise 0.35 补细节又不把结构带偏。
        // 采样器沿用官方配方的 Euler + Simple。
        hires: { steps: 30, cfg: 3.0, hires: true, scale: 1.5, denoise: 0.35, turbo: false,
                 sampler: "Euler", scheduler: "Simple" }
      }
    },
    zimage: {
      // Z-Image Turbo：6B 单流 S3-DiT + Qwen3-4B 编码器（type=lumina2）+ FLUX 的 ae VAE。
      // 官方模板：ModelSamplingAuraFlow shift 3、res_multistep + simple、9 步、CFG 1。
      // 关键约束：
      //   · 9 步是官方推荐；实测加步数不会变糊，但收益递减，加时间不如加二采；
      //   · CFG 必须 1，负面提示词在 CFG 1 下无效，所以负面留空；
      //   · 强项是图里的中英文字，写文字时用引号包住要出现的词。
      id: "zimage",
      label: "Z-Image Turbo",
      kind: "Z-Image 架构",
      arch: "zimage",
      match: /z[_\- ]?image/i,
      sampler: "Res Multistep",
      scheduler: "Simple",
      shift: 3,
      clipSkip: 1,
      qualityPrefix: "",
      negativeHint: "",
      qualities: {
        gacha: { steps: 9, cfg: 1, hires: false, turbo: false },
        draft: { steps: 9, cfg: 1, hires: false, turbo: false },
        standard: { steps: 9, cfg: 1, hires: false, turbo: false },
        // 想要更多细节靠二采，不靠加步数（蒸馏模型加步会糊）
        // 实测加步数不变糊（只是收益递减），精细 16 步 / 高清 20 步
        fine: { steps: 16, cfg: 1, hires: true, scale: 1.25, denoise: 0.30, turbo: false },
        hires: { steps: 20, cfg: 1, hires: true, scale: 1.4, denoise: 0.35, turbo: false }
      }
    },
    krea: {
      // Krea 2 Turbo：12.9B DiT + Qwen3-VL 4B 编码器，8 步蒸馏。
      // 官方 README / ComfyUI 模板一致：Euler + Simple、cfg 1（= 官方 guidance 0）、
      // mu 1.15（ComfyUI 已 baked 进 Krea2.sampling_settings，无需节点）。
      // 关键约束：
      //   · 步数不能低于 8——蒸馏网格是按 8 步锚定的，6 步结构会散；
      //   · 往上加没问题：亲测 16/20 步更精细，只是每步收益递减、耗时线性增长；
      //   · Turbo 无 CFG，负面提示词无效，所以负面留空；
      //   · 原生支持 1K–2K，低于 1K 画质下降，别再套 MOSS 那套「低基准打底」。
      id: "krea",
      label: "Krea 2 Turbo",
      kind: "Krea 架构",
      arch: "krea",
      match: /krea/i,
      sampler: "Euler",
      scheduler: "Simple",
      shift: 1.15,
      clipSkip: 1,
      qualityPrefix: "",
      negativeHint: "",
      qualities: {
        // 步数：8 是速度/质量的拐点，不是上限。
        // 之前的记录里 6→8→10→12 的像素差异是递增的，我当时误读成「偏离蒸馏网格」，
        // 实际亲测是加步数确实更精细，只是每多一步的收益在衰减。
        // 所以低档仍用 8 步保速度，精细/高清放开步数。
        gacha: { steps: 8, cfg: 1, hires: false, turbo: false },
        draft: { steps: 8, cfg: 1, hires: false, turbo: false },
        standard: { steps: 8, cfg: 1, hires: false, turbo: false },
        // 精细：16 步实采 + 1.25x 低噪重绘（denoise 0.30）补纹理
        fine: { steps: 16, cfg: 1, hires: true, scale: 1.25, denoise: 0.30, turbo: false },
        // 高清：20 步 + 1.35x。倍率卡在 1.35——再往上 base 会掉到 1K 以下
        // （1328÷1.5=885），而 Krea 在 1K 以下画质明显变差，放大补不回来。
        hires: { steps: 20, cfg: 1, hires: true, scale: 1.35, denoise: 0.35, turbo: false }
      }
    },
    nova: {
      // Illustrious 系（NoobAI EPS + Illustrious v2.0 + ChenkinNoob DARE）。      // 官方：Euler a、20–30 步、CLIP skip 1–2、CFG 4–6；这里取区间中段，
      // 前缀与负面建议照抄模型页（负面只作提示，不自动写入）。
      id: "nova",
      label: "Nova Anime XL",
      kind: "动漫",
      arch: "sdxl",
      match: /nova/i,
      sampler: "Euler a",
      scheduler: "Karras",
      clipSkip: 2,
      qualityPrefix: "masterpiece, best quality, amazing quality, 4k, very aesthetic, high resolution, ultra-detailed, absurdres, newest, ",
      negativeHint: "modern, recent, old, oldest, cartoon, graphic, text, painting, crayon, graphite, abstract, glitch, deformed, mutated, ugly, disfigured, long body, lowres, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, very displeasing, (worst quality, bad quality:1.2), sketch, jpeg artifacts, signature, watermark, username, simple background, conjoined, bad ai-generated",
      qualities: {
        draft: { steps: 20, cfg: 4.5, hires: false },
        standard: { steps: 26, cfg: 5, hires: false },
        fine: { steps: 30, cfg: 5.5, hires: false },
        // 官方重绘幅度 0.65–0.8 是 img2img；Hires 沿用本机验证过的 1.25x / 0.4
        hires: { steps: 28, cfg: 5, hires: true, scale: 1.25, denoise: 0.4 }
      }
    },
    pony: {
      // 仅在检测到 CyberRealistic / Pony 系 SDXL 底模时启用。
      id: "pony",
      label: "CyberRealistic / Pony",
      kind: "写实",
      match: /(cyber|pony|real|photo)/i,
      sampler: "DPM++ 2M SDE",
      scheduler: "Karras",
      qualityPrefix: "score_9, score_8_up, score_7_up, source_photo, ",
      negativeHint: "score_4, score_5, score_6, low quality",
      qualities: {
        draft: { steps: 14, cfg: 5, hires: false },
        standard: { steps: 28, cfg: 5.5, hires: false },
        fine: { steps: 34, cfg: 5.5, hires: false },
        hires: { steps: 30, cfg: 5.5, hires: true, scale: 1.25, denoise: 0.35 }
      }
    },
    generic: {
      id: "generic",
      label: "通用 SDXL",
      kind: "",
      match: null,
      sampler: "Euler a",
      scheduler: "Karras",
      qualityPrefix: "",
      negativeHint: "",
      qualities: QUALITY_GENERIC
    }
  };
  const MOSS_STYLES = [
    { id: "cinematic", label: "电影写实", text: "电影剧照质感，真实皮肤纹理，自然光影，浅景深，35mm 胶片颗粒" },
    { id: "anime", label: "日系动画", text: "日式动画风格，赛璐璐上色，干净的线稿，明亮通透的色彩" },
    { id: "painterly", label: "厚涂插画", text: "厚涂数字绘画，明显的笔触层次，浓郁的色块，CG 插画质感" },
    { id: "watercolor", label: "水彩淡彩", text: "水彩画风格，透明晕染，纸纹可见，柔和留白，淡雅色调" },
    { id: "ink", label: "国风水墨", text: "中国水墨画风格，墨色浓淡变化，宣纸质感，写意留白" },
    { id: "cyberpunk", label: "赛博霓虹", text: "赛博朋克风格，霓虹灯强对比，青紫色调，湿润反光的地面" },
    { id: "film", label: "复古胶片", text: "复古胶片摄影，柯达暖调，轻微色差与暗角，七八十年代的怀旧氛围" },
    { id: "dark", label: "暗黑哥特", text: "暗黑哥特氛围，低调布光，深重阴影，冷冽的金属与石材质感" },
    { id: "render3d", label: "3D 渲染", text: "三维渲染质感，全局光照，次表面散射，材质细节清晰，产品级打光" },
    { id: "pixel", label: "像素风", text: "像素艺术风格，16 位色板，硬边像素块，复古游戏画面质感" },
    { id: "ukiyoe", label: "浮世绘", text: "日本浮世绘版画风格，平涂色块，粗黑轮廓线，和纸纹理，波浪与云纹装饰" },
    { id: "oilpaint", label: "古典油画", text: "古典油画风格，厚重油彩堆叠，明暗对照法，深色背景，细腻笔触" },
    { id: "sketch", label: "铅笔素描", text: "铅笔素描风格，细密排线，纸面颗粒，黑白灰层次，大面积留白" },
    { id: "woodcut", label: "木刻版画", text: "木刻版画风格，黑白高对比，刀痕肌理，粗犷有力的轮廓" },
    { id: "clay", label: "黏土定格", text: "黏土定格动画风格，手工捏塑质感，圆润造型，柔和棚拍灯光，微缩场景" },
    { id: "animation3d", label: "美式动画", text: "美式三维动画电影风格，生动夸张的表情，柔和大眼睛，光滑材质，明亮色彩" },
    { id: "surreal", label: "超现实", text: "超现实主义绘画风格，不合逻辑的空间组合，梦境般的光影，精细写实笔触" },
    { id: "poster", label: "极简海报", text: "极简主义平面海报，大色块，留白充足，几何构成，干净利落" },
    { id: "steampunk", label: "蒸汽朋克", text: "蒸汽朋克风格，维多利亚时代机械，黄铜齿轮与蒸汽管道，暖褐色调" },
    { id: "wasteland", label: "赛博废土", text: "废土风格，锈迹与涂鸦覆盖的废墟，粗粝质感，尘土飞扬" },
    { id: "vaporwave", label: "蒸汽波", text: "蒸汽波风格，紫粉渐变，网格地平线，复古电脑界面与雕像" },
    { id: "popart", label: "波普艺术", text: "波普艺术风格，高饱和色块，粗黑轮廓，网点印刷质感" },
    { id: "collage", label: "拼贴艺术", text: "拼贴艺术，剪报与照片错位重叠，撕裂边缘，复古印刷色" },
    { id: "papercut", label: "剪纸风格", text: "多层剪纸风格，硬朗边缘，层叠投影，色纸质感" },
    { id: "gouache", label: "水粉画", text: "水粉画风格，粉质颜料，覆盖力强，笔触粗放，纸面颗粒" },
    { id: "acrylic", label: "丙烯画", text: "丙烯画风格，厚涂颜料，强反光，清晰的笔刷痕迹" },
    { id: "pendrawing", label: "钢笔画", text: "钢笔画风格，细密线条，交叉排线，黑白灰层次分明" },
    { id: "crayon", label: "蜡笔童画", text: "蜡笔手绘风格，稚拙笔触，纸张纤维纹理，童趣配色" },
    { id: "stainedglass", label: "玻璃彩绘", text: "彩色玻璃窗风格，色块由铅条分割，透光的宝石色" },
    { id: "miniature", label: "微缩模型", text: "移轴微缩摄影，像玩具模型，极浅景深，俯视视角" },
    { id: "infrared", label: "红外摄影", text: "红外摄影风格，植被呈红色，天空深黑，超现实氛围" },
    { id: "double", label: "双重曝光", text: "双重曝光，人物轮廓与风景叠合，边缘半透明，梦幻感" }
  ];
  const MOSS_PRESET_GROUPS = [
    { id: "style", label: "画风", items: MOSS_STYLES },
    { id: "camera", label: "镜头", items: [
      { id: "closeup", label: "面部特写", text: "面部特写镜头，五官清晰，浅景深，背景完全虚化" },
      { id: "halfbody", label: "半身构图", text: "半身构图，人物位于画面三分线，腰部以上入画" },
      { id: "fullbody", label: "全身构图", text: "全身构图，人物完整入画，脚下留出空间，环境交代清楚" },
      { id: "lowangle", label: "低角度仰拍", text: "低角度仰拍，人物显得挺拔，透视夸张，天空作背景" },
      { id: "highangle", label: "高角度俯拍", text: "高角度俯拍，从上往下看，地面纹理与位置关系清晰" },
      { id: "wide", label: "广角", text: "广角镜头，视野开阔，边缘轻微拉伸，环境信息丰富" },
      { id: "tele", label: "长焦压缩", text: "长焦镜头，空间压缩感，背景被拉近，主体与背景层次分明" },
      { id: "macro", label: "微距", text: "微距摄影，极浅景深，细节放大，背景奶油般虚化" },
      { id: "symmetry", label: "对称构图", text: "严格对称构图，中心轴线，画面平衡稳定" },
      { id: "topdown", label: "顶视", text: "正上方垂直俯视，像平面图一样的视角" },
      { id: "following", label: "跟随视角", text: "跟拍视角，人物在前景移动，背景拉出动态模糊" },
      { id: "peek", label: "窥视视角", text: "从缝隙或门后拍摄，前景有遮挡，窥视感" },
      { id: "twoshot", label: "双人同框", text: "双人中景，两人占据画面对称两侧" },
      { id: "extremeclose", label: "极端特写", text: "极端特写，只拍到眼睛或嘴唇的局部" }
    ] },
    { id: "light", label: "光线", items: [
      { id: "golden", label: "黄金时刻", text: "黄金时刻的暖阳，低角度侧光，长长的影子，金色边缘光" },
      { id: "backlight", label: "逆光轮廓", text: "强烈逆光，人物边缘形成明亮轮廓光，正面轻微补光" },
      { id: "rembrandt", label: "伦勃朗光", text: "伦勃朗式布光，脸颊形成三角形光斑，深色背景，戏剧性明暗" },
      { id: "softbox", label: "柔光棚拍", text: "柔和的棚拍柔光箱，均匀无硬影，干净通透" },
      { id: "neonside", label: "霓虹侧光", text: "霓虹灯侧光，青紫与品红交错，皮肤上留下彩色反光" },
      { id: "volumetric", label: "体积光", text: "体积光与丁达尔效应，光束穿透薄雾，空气中可见浮尘" },
      { id: "moonlight", label: "月光", text: "清冷的月光，蓝调夜色，微弱的环境补光，安静" },
      { id: "hardflash", label: "硬闪光", text: "直射硬闪光灯，锐利阴影，高反差，街拍质感" },
      { id: "window", label: "窗光", text: "侧向窗光，明暗过渡柔和，室内自然光，安静的日常感" },
      { id: "rimlight", label: "轮廓光", text: "强烈轮廓光勾出身体边缘，主体陷入暗部" },
      { id: "dualcolor", label: "双色光", text: "左右两侧不同色温的光，冷暖对撞" },
      { id: "silhouette", label: "逆光剪影", text: "强逆光下的纯剪影，只剩轮廓" },
      { id: "raingray", label: "雨天灰光", text: "阴雨天的漫射灰光，柔和缺少方向" },
      { id: "firelight", label: "火光", text: "火堆的橙红跳动光，明暗变化剧烈" }
    ] },
    { id: "tone", label: "色调", items: [
      { id: "tealorange", label: "青橙", text: "青橙配色，阴影偏青蓝、高光偏暖橙，电影调色" },
      { id: "morandi", label: "莫兰迪", text: "莫兰迪灰调，低饱和柔和色块，克制的高级感" },
      { id: "mono", label: "黑白", text: "黑白摄影，纯灰阶层次，无彩色，强调光影与质感" },
      { id: "faded", label: "褪色胶片", text: "褪色旧胶片色调，轻微偏黄，低对比，怀旧" },
      { id: "vivid", label: "高饱和", text: "高饱和浓郁色彩，色块鲜明，视觉冲击强" },
      { id: "coolblue", label: "冷蓝", text: "冷蓝主调，整体偏青，清冷疏离" },
      { id: "warmamber", label: "暖橙", text: "暖橙主调，整体偏琥珀色，温馨慵懒" },
      { id: "pastel", label: "糖果色", text: "马卡龙糖果色，粉彩柔和，明亮轻快" },
      { id: "neongreen", label: "霓虹绿", text: "以荧光绿为主的科幻色调，冷冽刺眼" },
      { id: "deeppurple", label: "暗紫", text: "深紫主调，神秘压抑，微弱高光" },
      { id: "cream", label: "奶油白", text: "奶油白与浅米色，干净柔和的日系色调" },
      { id: "monotone", label: "单色调", text: "全画面只用一种色相的深浅变化" },
      { id: "metallic", label: "金属冷调", text: "银灰与冷蓝的金属质感，硬朗克制" }
    ] },
    { id: "detail", label: "细节", items: [
      { id: "ultradetail", label: "超高细节", text: "极高细节密度，纹理锐利清晰，放大后仍可辨认" },
      { id: "skin", label: "皮肤质感", text: "真实皮肤纹理，可见毛孔与细微红晕，不磨皮" },
      { id: "fabric", label: "布料纹理", text: "布料织纹清晰，可见经纬线与褶皱起伏" },
      { id: "raindrop", label: "雨滴水珠", text: "细密雨丝与叶面水珠，湿润反光，空气潮湿" },
      { id: "hair", label: "发丝", text: "发丝分明，碎发与逆光边缘清晰可见" },
      { id: "bokeh", label: "景深虚化", text: "明显浅景深，背景奶油般虚化，焦点锐利" },
      { id: "grain", label: "胶片颗粒", text: "细密胶片颗粒，轻微色差与暗角，模拟底片" },
      { id: "specular", label: "材质反光", text: "金属与玻璃表面的环境反射，高光锐利，材质真实" },
      { id: "vapor", label: "水汽", text: "空气中的水汽与呼吸白雾，湿润感" },
      { id: "blush", label: "皮肤红晕", text: "脸颊与耳尖的自然红晕，血色透出" },
      { id: "translucent", label: "布料透光", text: "薄布料在逆光下透出身体轮廓" },
      { id: "scratch", label: "金属划痕", text: "金属表面的细小划痕与磨损痕迹" },
      { id: "glass", label: "玻璃反光", text: "玻璃与镜面的多层反射与折射" }
    ] },
    { id: "recipe", label: "成套配方", items: [
      { id: "r_rain", label: "雨夜人像", text: "雨夜街头人像，湿漉漉的柏油路反射霓虹，暖黄路灯与冷蓝夜色交织，浅景深，电影剧照质感，真实皮肤纹理，35mm 胶片颗粒" },
      { id: "r_classroom", label: "午后教室", text: "日系动画风格，午后教室，斜射的阳光穿过窗户，空气里的浮尘，课桌与窗帘，安静治愈，柔和通透的色彩" },
      { id: "r_snow", label: "雪山日出", text: "清晨雪山日出，金色阳光照亮雪脊，远处云海，冷蓝阴影与暖橙高光对比，广角镜头，极高细节密度" },
      { id: "r_bamboo", label: "古风人像", text: "中国水墨淡彩风格，古装女子立于竹林，烟雾缭绕，宣纸纹理，写意留白，柔和墨色层次" },
      { id: "r_cyber", label: "赛博街景", text: "赛博朋克街景，密集霓虹招牌，雨后湿润反光的地面，青紫色调，体积光穿透薄雾，行人剪影，电影级构图" },
      { id: "r_product", label: "静物产品", text: "产品级静物摄影，纯色背景，柔光箱打光，金属与玻璃材质反射锐利，极高细节密度，居中对称构图" },
      { id: "r_rooftop", label: "雨夜天台", text: "雨夜的都市天台，霓虹在湿地面碎成色块，风吹起发丝，远处灯海模糊，冷蓝与品红的强对比，电影剧照质感" },
      { id: "r_festival", label: "夏日祭烟花", text: "夏日祭的夜晚，浴衣少女回头，烟花在身后炸开，暖橙与深蓝交错，浅景深，胶片颗粒" },
      { id: "r_winter", label: "冬日暖房", text: "冬日玻璃暖房，暖气与窗外积雪对比，阳光斜射进来，植物与雾气，柔和通透" },
      { id: "r_vaporwave", label: "蒸汽波房间", text: "蒸汽波风格的卧室，紫粉渐变灯光，复古显示器与磁带，网格地板，粉蓝霓虹" },
      { id: "r_deepsea", label: "深海", text: "深海之下，光柱从水面穿透，悬浮微粒，幽蓝与青绿，孤独安静，电影感" },
      { id: "r_ruins", label: "废墟探险", text: "废弃建筑内部，破窗透进的光柱，尘埃飞舞，藤蔓爬满墙壁，粗粝写实质感" }
    ] }
  ];
  const MOSS_TAG_GROUPS = [
    { id: "scene_in", name: "室内场景", hint: "房间与建筑内部", tags: [
      ["堆满书的旧书房，木质书架到顶", "旧书房"], ["铺着木地板的和室，纸门半开", "和室"],
      ["光线昏暗的走廊，尽头有一扇窗", "昏暗走廊"], ["复古咖啡馆靠窗的双人座", "咖啡馆窗边"],
      ["铺着白色床单的卧室，晨光透进窗帘", "晨光卧室"], ["堆满画具的画室，颜料罐散落", "画室"],
      ["空荡的地铁车厢，日光灯忽明忽暗", "空荡车厢"], ["老式电梯内部，黄铜按钮发亮", "老电梯"],
      ["堆满纸箱的阁楼，天窗漏下光柱", "阁楼"], ["大理石浴缸旁，水汽弥漫", "浴室水汽"],
      ["唱片店狭窄的过道，黑胶整齐排列", "唱片店"], ["深夜便利店，冷白灯光", "便利店"],
      ["图书馆高耸的书架之间", "图书馆"], ["堆着旧唱片与吉他的练琴房", "练琴房"],
      ["落地窗前的地毯，城市夜景在外", "落地窗前"], ["布满灰尘的废弃教室，课桌翻倒", "废教室"],
      ["日式汤屋的木桶与蒸汽", "汤屋"], ["小餐馆的吧台，热气腾腾", "小餐馆"],
      ["花店内部，鲜花堆到天花板", "花店"], ["地下酒吧，红色灯罩与皮沙发", "地下酒吧"]
    ] },
    { id: "scene_out", name: "室外场景", hint: "街道与城市", tags: [
      ["雨夜的霓虹街道，招牌层层叠叠", "雨夜霓虹街"], ["狭窄的老城区巷口，晾衣绳横跨", "老城巷口"],
      ["都市天台俯瞰灯海", "天台夜景"], ["潮湿的地下停车场", "地下车库"],
      ["热闹的夜市，摊位的暖黄灯串", "夜市"], ["雨中的公交站台，玻璃上全是水痕", "雨中站台"],
      ["废弃的游乐场，摩天轮停转", "废弃乐园"], ["跨海大桥的护栏边，风很大", "跨海大桥"],
      ["堆满集装箱的港口", "集装箱港"], ["雨后积水的窄巷，倒映招牌", "积水窄巷"],
      ["地铁站出口的台阶，人流模糊", "地铁出口"], ["屋顶的晾衣台，远处是密集公寓", "晾衣天台"],
      ["高架桥下，桥墩上满是涂鸦", "高架桥下"], ["正在施工的楼顶，钢筋裸露", "施工楼顶"],
      ["铁路道口，信号灯闪烁", "铁路道口"], ["海边公路，护栏外就是海浪", "海边公路"],
      ["老式商店街的拱廊，店铺打烊", "商店街拱廊"], ["城市广场的喷泉边", "广场喷泉"],
      ["停车场顶层的空旷车位", "停车楼顶层"], ["过街天桥中央，俯看车流", "过街天桥"]
    ] },
    { id: "scene_nature", name: "自然与远景", hint: "户外自然景观", tags: [
      ["长满苔藓的日式庭院", "苔藓庭院"], ["竹林深处的小径，光斑洒落", "竹林小径"],
      ["雪山脚下的木屋", "雪山木屋"], ["海边废弃的灯塔", "废弃灯塔"],
      ["繁花盛开的玻璃温室", "玻璃温室"], ["被藤蔓覆盖的废墟", "藤蔓废墟"],
      ["铺满落叶的林间空地", "落叶林间"], ["清晨的湖畔，雾气未散", "清晨湖畔"],
      ["荒芜的沙漠公路，热浪扭曲", "沙漠公路"], ["悬崖边的草地，风把草压弯", "悬崖草地"],
      ["樱花纷飞的河堤", "樱花河堤"], ["秋天的枫林，红黄交织", "秋日枫林"],
      ["星轨下的荒野", "星轨荒野"], ["礁石密布的海岸线，浪花拍打", "礁石海岸"],
      ["金色的麦田，风起时像波浪", "金色麦田"], ["山间溪流，石头上有水痕", "山间溪流"]
    ] },
    { id: "camera", name: "镜头构图", hint: "视角与取景", tags: [
      ["正面半身构图", "正面半身"], ["面部特写，五官清晰", "面部特写"],
      ["全身构图，人物完整入画", "全身"], ["低角度仰拍，人物显得挺拔", "仰拍"],
      ["高角度俯拍，从上往下看", "俯拍"], ["广角镜头，视野开阔", "广角"],
      ["长焦镜头，空间压缩感强", "长焦"], ["微距摄影，极浅景深", "微距"],
      ["严格对称构图，中心轴线", "对称构图"], ["三分法构图，主体偏一侧", "三分法"],
      ["越过肩膀的过肩视角", "过肩视角"], ["背影视角，看不见正脸", "背影"],
      ["侧面轮廓，剪影感", "侧面剪影"], ["画面留出大量负空间", "留白构图"],
      ["从背后偏头回望的视角", "回望视角"], ["贴近地面的极端低机位", "极低机位"],
      ["透过前景物体拍摄，有遮挡", "前景遮挡"], ["鱼眼镜头，边缘强烈畸变", "鱼眼"]
    ] },
    { id: "light", name: "光线", hint: "光源与明暗", tags: [
      ["黄金时刻的暖阳，低角度侧光", "黄金时刻"], ["强烈逆光，人物边缘有轮廓光", "逆光轮廓"],
      ["伦勃朗式布光，脸颊有三角光斑", "伦勃朗光"], ["柔和的棚拍柔光，均匀无硬影", "柔光棚拍"],
      ["霓虹灯侧光，青紫与品红交错", "霓虹侧光"], ["体积光穿透薄雾，可见浮尘", "体积光"],
      ["清冷的月光，蓝调夜色", "月光"], ["直射硬闪光，锐利阴影", "硬闪光"],
      ["侧向窗光，明暗过渡柔和", "窗光"], ["烛光摇曳的暖黄照明", "烛光"],
      ["顶部单灯，明暗强烈", "顶部单灯"], ["水面反射的波光粼粼", "水面反光"],
      ["屏幕冷光照亮面部", "屏幕冷光"], ["雨夜车灯的流动光斑", "车灯光斑"],
      ["百叶窗投影落在皮肤上", "百叶窗光"], ["日落后的蓝调时刻，天空深蓝", "蓝调时刻"],
      ["舞台聚光灯从上方打下", "舞台聚光"], ["火光映照，橙红跳动", "火光"]
    ] },
    { id: "weather", name: "时间天气", hint: "时辰与气候", tags: [
      ["清晨，空气清冷，光很淡", "清晨"], ["正午，光线强烈，影子很短", "正午"],
      ["午后，阳光斜射，暖意十足", "午后"], ["黄昏，天色橙红渐暗", "黄昏"],
      ["深夜，只有零星灯光", "深夜"], ["黎明前，天边泛青", "黎明前"],
      ["细雨，雨丝可见", "细雨"], ["暴雨，雨帘模糊远景", "暴雨"],
      ["雨后初晴，地面湿亮", "雨后"], ["薄雾弥漫，远处看不清", "薄雾"],
      ["大雪纷飞，雪花清晰可见", "大雪"], ["阴天，光线平坦柔和", "阴天"],
      ["大风，头发与衣摆被吹起", "大风"], ["闷热的夏夜，空气黏稠", "夏夜"],
      ["初春的微寒，枝头刚发芽", "初春"], ["深秋的凉意，落叶满地", "深秋"]
    ] },
    { id: "outfit_daily", name: "日常服装", hint: "日常与休闲", tags: [
      ["宽松的白色针织毛衣", "白毛衣"], ["磨损的皮夹克", "皮夹克"],
      ["长风衣，衣摆被风吹起", "长风衣"], ["带兜帽的连帽卫衣", "连帽卫衣"],
      ["手工编织的粗线披肩", "毛线披肩"], ["轻薄的吊带连衣裙", "吊带裙"],
      ["磨损的牛仔裤与帆布鞋", "牛仔休闲"], ["运动背心与短裤", "运动装"],
      ["格纹衬衫，袖子挽到手肘", "格纹衬衫"], ["oversize 的黑色 T 恤", "黑T恤"],
      ["百褶短裙配过膝袜", "百褶裙"], ["针织开衫，扣子没扣好", "针织开衫"],
      ["棉质睡裙，宽松柔软", "棉质睡裙"], ["连体工装，口袋很多", "连体工装"],
      ["棒球外套，背后有刺绣", "棒球外套"], ["高领毛衣，下巴埋进领口", "高领毛衣"],
      ["裹着浴巾，头发还湿着", "浴巾"], ["宽松短裤与凉拖鞋", "夏日休闲"]
    ] },
    { id: "outfit_style", name: "风格服装", hint: "主题与制服", tags: [
      ["黑色立领机能风外套", "机能外套"], ["日式水手服与百褶裙", "水手服"],
      ["绣着暗纹的传统和服", "和服"], ["剪裁利落的黑色西装", "黑西装"],
      ["荷叶边层层叠叠的洋装", "荷叶边洋装"], ["带蕾丝边的丝绸睡裙", "丝绸睡裙"],
      ["金属扣件的战术背心", "战术背心"], ["制服外套配领带", "制服领带"],
      ["巫女的白衣与红袴", "巫女服"], ["哥特风的黑色长裙与束腰", "哥特长裙"],
      ["赛博感的透明外罩与发光条", "赛博外罩"], ["皮质的短款机车夹克", "机车夹克"],
      ["学士服与方帽", "学士服"], ["厨师围裙与白衬衫", "厨师装"],
      ["护士服，微微起皱", "护士服"], ["古风的宽袖长袍，绣着云纹", "古风长袍"],
      ["毛呢大衣配围巾", "毛呢围巾"], ["泳装，水珠未干", "泳装"]
    ] },
    { id: "hair", name: "发型", hint: "长度与扎法", tags: [
      ["及肩短发，发尾微内扣", "及肩短发"], ["长直发垂到腰际", "长直发"],
      ["蓬松的卷发，发量很多", "蓬松卷发"], ["双马尾，扎得很高", "双马尾"],
      ["低马尾，留出几缕碎发", "低马尾"], ["丸子头，露出后颈", "丸子头"],
      ["侧边编发，编得很细", "侧编发"], ["齐刘海，遮住眉毛", "齐刘海"],
      ["空气刘海，很薄", "空气刘海"], ["中分长发，两侧垂到胸前", "中分长发"],
      ["凌乱的短发，像刚睡醒", "凌乱短发"], ["半扎发，上半部分束起", "半扎发"],
      ["麻花辫垂在一侧肩上", "麻花辫"], ["狼尾剪，后颈短两侧长", "狼尾剪"],
      ["湿发，水珠顺着发丝滴落", "湿发"], ["发丝被风吹得四散", "风吹发丝"],
      ["盘起的发髻，插着发簪", "盘发发簪"], ["爆炸卷，蓬松夸张", "爆炸卷"]
    ] },
    { id: "hair_color", name: "发色", hint: "颜色与光泽", tags: [
      ["乌黑的长发，泛着冷光", "乌黑"], ["淡紫色，发梢透一点青绿", "淡紫渐变"],
      ["银白色，像月光一样", "银白"], ["金发，发丝在阳光下发光", "金发"],
      ["栗棕色，温暖柔和", "栗棕"], ["酒红色，暗调偏紫", "酒红"],
      ["粉红色，明亮挑眼", "粉红"], ["冰蓝色，冷冽通透", "冰蓝"],
      ["墨绿色，低调有质感", "墨绿"], ["灰白色，带一点紫调", "灰白"],
      ["黑色配一缕红色挑染", "黑红挑染"], ["渐变发色，从深到浅", "渐变发色"],
      ["亚麻色，自然不刺眼", "亚麻"], ["荧光色，在暗处发光", "荧光发色"]
    ] },
    { id: "eyes", name: "眼睛", hint: "瞳色与眼神", tags: [
      ["橙红色发光的眼睛", "橙红发光瞳"], ["冰蓝色的眼睛，清澈见底", "冰蓝瞳"],
      ["琥珀色的眼睛，像有光在里面", "琥珀瞳"], ["灰色的眼睛，淡漠", "灰瞳"],
      ["紫色眼睛，深邃", "紫瞳"], ["绿色眼睛，像猫一样", "绿瞳"],
      ["异色瞳，左右颜色不同", "异色瞳"], ["眼睛里映出灯光", "映光瞳"],
      ["微微下垂的眼角，显得温柔", "下垂眼"], ["上挑的眼尾，锐利", "上挑眼"],
      ["半眯的眼睛，慵懒", "半眯眼"], ["含着水汽的眼睛", "水汽眼"],
      ["眼神空洞，没有焦点", "空洞眼神"], ["目光直视镜头，压迫感强", "直视镜头"]
    ] },
    { id: "expression", name: "表情", hint: "情绪与神态", tags: [
      ["神情冷淡，眼神疏离", "冷淡"], ["温柔地微笑，眼角弯起", "温柔微笑"],
      ["脸颊泛红，略显害羞", "害羞"], ["倔强地抿着嘴唇", "倔强"],
      ["放空失神的表情", "失神"], ["惊讶地睁大眼睛", "惊讶"],
      ["带着一丝倦意的慵懒", "慵懒"], ["略带挑衅的自信笑容", "挑衅笑"],
      ["眼眶微红，强忍着情绪", "隐忍"], ["安静地垂着眼", "垂眼"],
      ["开怀大笑，情绪外放", "大笑"], ["若有所思地望向远方", "若有所思"],
      ["咬着下唇，欲言又止", "咬唇"], ["轻蔑地挑起一边嘴角", "轻蔑"],
      ["疲惫地闭上眼", "闭眼疲惫"], ["带着泪光却仍在笑", "含泪微笑"]
    ] },
    { id: "pose", name: "动作姿态", hint: "姿势与动势", tags: [
      ["安静地站着，双手垂在身侧", "静立"], ["坐在窗台上，双腿交叠", "窗台坐姿"],
      ["抱膝蜷坐，下巴抵在膝上", "抱膝"], ["侧身靠在墙边", "靠墙"],
      ["回头看向镜头", "回眸"], ["低头整理衣角", "整理衣角"],
      ["伸手整理被风吹乱的头发", "撩头发"], ["双手插在口袋里", "插兜"],
      ["撑着伞站在雨中", "撑伞"], ["微微前倾，像要说话", "前倾"],
      ["背对镜头走远", "走远背影"], ["舒展开手臂仰头", "舒展仰头"],
      ["蹲下来，手撑着地面", "蹲姿"], ["一手扶着栏杆，侧身远望", "扶栏远望"],
      ["躺在床上，手臂遮住眼睛", "卧床遮眼"], ["正在奔跑，动作带残影", "奔跑"],
      ["踮起脚尖，像要够高处的东西", "踮脚"], ["整理袖口，动作很慢", "整理袖口"]
    ] },
    { id: "props", name: "配饰道具", hint: "随身物件", tags: [
      ["脖子上的细项链", "细项链"], ["耳朵上的银色耳钉", "银耳钉"],
      ["手腕上的旧手表", "旧手表"], ["手里端着一杯咖啡", "咖啡杯"],
      ["抱着一本厚书", "厚书"], ["背着的旧帆布包", "帆布包"],
      ["撑着的透明雨伞", "透明伞"], ["戴着一副圆框眼镜", "圆框眼镜"],
      ["手指间夹着一支烟", "夹烟"], ["怀里抱着一只猫", "抱着猫"],
      ["桌上放着一盏台灯", "台灯"], ["手里握着老式相机", "老相机"],
      ["戴着的耳机挂在脖子上", "挂脖耳机"], ["手指上戴着戒指", "戒指"],
      ["身旁立着一把长柄伞", "长柄伞"], ["手里提着一束花", "提着花束"]
    ] },
    { id: "mood", name: "氛围质感", hint: "整体调性", tags: [
      ["电影剧照质感，35mm 胶片颗粒", "电影颗粒"], ["柔焦朦胧的梦境感", "梦境柔焦"],
      ["高对比，青紫阴影与暖粉高光", "青紫暖粉"], ["褪色旧胶片的怀旧色调", "褪色胶片"],
      ["黑白灰阶，强调光影", "黑白"], ["莫兰迪灰调，低饱和柔和", "莫兰迪"],
      ["潮湿阴冷的雨夜气息", "潮湿雨夜"], ["温暖慵懒的午后阳光", "午后慵懒"],
      ["清冷疏离的蓝调", "清冷蓝调"], ["浓郁饱和的色彩冲击", "高饱和"],
      ["细腻真实的皮肤纹理与毛孔", "真实皮肤"], ["布料织纹与褶皱清晰可见", "布料纹理"],
      ["空气中漂浮的尘埃与光斑", "浮尘光斑"], ["轻微色差与暗角的底片感", "暗角底片"],
      ["安静到能听见呼吸的氛围", "安静氛围"], ["压抑逼仄的空间感", "压抑空间"],
      ["轻盈通透的空气感", "通透空气"], ["厚重油画般的颜料堆叠", "油画质感"]
    ] },
    { id: "style", name: "画风细化", hint: "表现手法", tags: [
      ["日式动画赛璐璐上色，线条干净", "赛璐璐"], ["厚涂数字绘画，笔触明显", "厚涂"],
      ["水彩晕染，纸纹可见", "水彩"], ["中国水墨，墨色浓淡", "水墨"],
      ["油画质感，颜料厚重", "油画"], ["铅笔素描，排线细密", "素描"],
      ["浮世绘版画，平涂色块", "浮世绘"], ["像素艺术，硬边色块", "像素风"],
      ["三维渲染，全局光照", "3D 渲染"], ["黏土定格动画质感", "黏土质感"],
      ["美式动画电影风格，造型夸张", "美式动画"], ["超现实，空间不合逻辑", "超现实"],
      ["极简平面构成，大色块", "极简"], ["复古漫画网点，高对比", "漫画网点"],
      ["油画棒与蜡笔的粗粝笔触", "油画棒"], ["玻璃质感与折射光", "玻璃质感"],
      ["金属与机械的硬表面质感", "硬表面"], ["手工纸的粗糙纤维感", "手工纸"]
    ] },
    { id: "figure", name: "体型气质", hint: "身形与气场", tags: [
      ["纤细的身形，肩膀很窄", "纤细"], ["高挑修长，比例好", "高挑"],
      ["娇小，看起来比实际年龄小", "娇小"], ["力量感明显，肩背宽阔", "力量感"],
      ["柔软圆润的轮廓", "圆润"], ["骨感到能看见锁骨", "骨感"],
      ["慵懒的体态，重心偏一侧", "慵懒体态"], ["挺拔站姿，气场强", "挺拔"],
      ["微微含胸，显得拘谨", "含胸"], ["动作利落，很有精神", "利落"],
      ["成熟稳重的气质", "成熟"], ["少年感，带一点青涩", "少年感"],
      ["冷硬的距离感", "冷硬"], ["亲和柔软，容易接近", "亲和"]
    ] },
    { id: "color", name: "色彩调配", hint: "色调与配色", tags: [
      ["青橙配色，阴影偏青、高光偏暖", "青橙"], ["粉紫与青蓝的霓虹撞色", "粉紫青蓝"],
      ["低饱和莫兰迪色块", "莫兰迪"], ["单色系，同一色相的深浅", "单色系"],
      ["黑白加一抹红色点缀", "黑白红点"], ["暖黄的复古色调", "暖黄复古"],
      ["冷蓝的夜色基调", "冷蓝夜色"], ["高饱和的糖果色", "糖果色"],
      ["大地色系，棕与米白", "大地色"], ["霓虹绿与品红的对撞", "绿品红撞色"],
      ["灰调为主，只有局部亮色", "灰调局部"], ["胶片偏黄绿的色偏", "绿黄色偏"],
      ["蓝紫色为主的冷调", "蓝紫冷调"], ["金与黑的奢华配色", "金黑"]
    ] }
  ];
  const MOSS_NEGATIVE_TAG_GROUPS = [
    { id: "quality", name: "画质缺陷", hint: "清晰度与曝光", tags: [
      ["低画质", "低画质"], ["模糊", "模糊"], ["噪点过多", "噪点"],
      ["过曝", "过曝"], ["欠曝", "欠曝"], ["严重压缩块", "压缩块"],
      ["水印", "水印"], ["文字乱码", "乱码文字"], ["签名", "签名"],
      ["边框", "边框"], ["重复纹理", "重复纹理"], ["滤镜过重", "滤镜过重"],
      ["色带断层", "色带断层"], ["锐化过度", "锐化过度"], ["塑料感皮肤", "塑料感"],
      ["油光过重", "油光"], ["灰蒙蒙不通透", "灰蒙"], ["像素化", "像素化"],
      ["画面脏污", "画面脏污"], ["对焦失误", "失焦"]
    ] },
    { id: "anatomy", name: "人体结构", hint: "手、腿、比例", tags: [
      ["多余的手指", "多余手指"], ["缺失的手指", "缺失手指"], ["畸形的手", "畸形手"],
      ["融化的手", "融化的手"], ["多余的腿", "多余腿"], ["三条腿", "三条腿"],
      ["多余的肢体", "多余肢体"], ["肢体融合", "肢体融合"], ["人体结构错误", "结构错误"],
      ["比例失调", "比例失调"], ["扭曲的关节", "扭曲关节"], ["错位的手臂", "错位手臂"],
      ["颈部过长", "颈部过长"], ["双头的错误", "双头错误"], ["脸部崩坏", "脸部崩坏"],
      ["五官错位", "五官错位"], ["不对称的眼睛", "眼不对称"], ["牙齿错乱", "牙齿错乱"],
      ["透视错误", "透视错误"], ["身体被拉伸", "拉伸变形"], ["脖子断裂", "脖子断裂"],
      ["腿与地面接触错误", "脚部接地错误"], ["重复的身体", "重复身体"], ["两套五官重叠", "五官重叠"]
    ] },
    { id: "artifact", name: "画面瑕疵", hint: "构图与元素错误", tags: [
      ["多余的人物", "多余人物"], ["重复的主体", "重复主体"],
      ["画面被切断", "画面切断"], ["主体跑到画外", "主体出框"],
      ["背景与主体粘连", "背景粘连"], ["衣服穿模", "衣服穿模"],
      ["物体漂浮在空中", "物体漂浮"], ["阴影方向不一致", "阴影错乱"],
      ["光源矛盾", "光源矛盾"], ["反光错误", "反光错误"],
      ["纹理糊成一团", "纹理糊"], ["锯齿边缘", "锯齿"],
      ["出现无关文字", "无关文字"], ["画框外的空白", "异常空白"],
      ["分屏或拼接", "分屏拼接"], ["条带撕裂", "条带撕裂"],
      ["色块断层", "色块断层"], ["噪点成团", "噪点成团"]
    ] },
    { id: "stylebreak", name: "风格失控", hint: "偏离预期画风", tags: [
      ["写实照片质感", "误成照片"], ["三维渲染感", "误成3D"],
      ["卡通过度简化", "过度卡通"], ["线条粗糙", "线条粗糙"],
      ["上色溢出", "上色溢出"], ["阴影脏黑", "阴影脏黑"],
      ["色彩浑浊", "色彩浑浊"], ["饱和度过高", "过饱和"],
      ["画面扁平", "画面扁平"], ["过度锐利", "过度锐利"],
      ["绘画感过强", "绘画感过强"], ["风格不统一", "风格不统一"],
      ["构图呆板", "构图呆板"], ["元素堆砌", "元素堆砌"]
    ] }
  ];
  const MOSS_CHARACTER_GROUPS = [
    { id: "vocaloid", name: "虚拟歌姬", hint: "常见虚拟歌手", tags: [
      ["初音未来，青绿色双马尾，蓝色眼睛，灰色无袖上衣，黑色发带", "初音未来"],
      ["初音未来，雪初音造型，白色长发，白色冬装，雪花发饰", "雪初音"],
      ["初音未来，赛车初音，蓝白赛车服，长发束起", "赛车初音"],
      ["镜音铃，金色短发，白色发箍，蓝白水手装", "镜音铃"],
      ["镜音连，金色短发，白色发箍，蓝白水手装男孩", "镜音连"],
      ["巡音流歌，粉红色长发，紫色眼睛，黑色长裙", "巡音流歌"],
      ["MEIKO，棕色短发，红色眼睛，红色短上衣", "MEIKO"],
      ["KAITO，蓝色短发，蓝色围巾，白色大衣", "KAITO"],
      ["GUMI，绿色双马尾，橙色眼睛，白色上衣", "GUMI"],
      ["洛天依，灰色长发，绿色发饰，蓝白汉服风格", "洛天依"],
      ["乐正绫，橙红色长发，红色眼睛，红色短裙", "乐正绫"],
      ["言和，白色短发，绿色眼睛，白色长袍", "言和"],
      ["结月缘，紫色长发，紫色眼睛，黑色发箍", "结月缘"],
      ["重音teto，红色双螺旋卷发，蓝色眼睛", "重音teto"],
      ["flower，白色长发，红色眼睛，黑色发带", "flower"],
      ["IA，粉白色长发，粉色眼睛，白色洋装", "IA"],
      ["可不，白色短发，蓝色眼睛，白色连衣裙", "可不"],
      ["星尘，银紫色长发，紫色眼睛，星空纹样长裙", "星尘"],
      ["心华，粉色长发，粉色眼睛，粉色和风洋装", "心华"],
      ["Mayu，黑色长发，红色眼睛，哥特洋装", "Mayu"],
      ["SeeU，金色长发，蓝色眼睛，韩式短裙", "SeeU"],
      ["结月缘与重音teto并排，紫发与红卷发，风格对比", "缘与teto"],
      ["星乃一歌，黑色短发，红色眼睛，校服", "星乃一歌"],
      ["初音未来与巡音流歌并肩，青绿与粉色长发", "初音与巡音"],
      ["鏡音铃与镜音连背靠背，金色短发双子", "镜音双子"],
      ["花谱，白色长发，紫色眼睛，虚拟歌手造型", "花谱"],
      ["理芽，黑色长发，蓝色眼睛，简约白裙", "理芽"],
      ["幸祜，粉色短发，粉色眼睛，舞台装", "幸祜"]
    ] },
    { id: "game", name: "游戏角色", hint: "常见游戏设定", tags: [
      ["八重神子，粉色长发，紫色眼睛，狐耳，巫女风格服饰", "八重神子"],
      ["雷电将军，紫色长发，紫色眼睛，和风武士服", "雷电将军"],
      ["胡桃，深棕色双马尾，红色眼睛，中式短衣与帽子", "胡桃"],
      ["甘雨，蓝紫色长发，犄角，白色紧身衣", "甘雨"],
      ["刻晴，紫色双马尾，紫色眼睛，黑色长裙", "刻晴"],
      ["荧，金色短发，金色眼睛，白色短裙", "荧"],
      ["神里绫华，银蓝色长发，蓝色眼睛，和风长裙", "神里绫华"],
      ["宵宫，橙色马尾，红色眼睛，烟花师短装", "宵宫"],
      ["莫娜，深紫色双马尾，紫色眼睛，占星师披风", "莫娜"],
      ["娜维娅，金色长发，蓝色眼睛，华丽洋装与礼帽", "娜维娅"],
      ["芙宁娜，白色短发，异色瞳，礼帽与西装", "芙宁娜"],
      ["雷电芽衣，深紫色长发，紫色眼睛，黑色制服", "雷电芽衣"],
      ["琪亚娜，白色长发，蓝色眼睛，战斗服", "琪亚娜"],
      ["布洛妮娅，银灰色双钻头，灰色眼睛，军装", "布洛妮娅"],
      ["爱莉希雅，粉紫长发，粉色眼睛，华丽的精灵风长裙", "爱莉希雅"],
      ["2B，银白短发，黑色眼罩，黑色哥特洋装", "2B"],
      ["A2，银白长发，红色眼睛，黑色战斗服", "A2"],
      ["明日香，橙红色长发，红色眼睛，驾驶服", "明日香"],
      ["绫波丽，浅蓝色短发，红色眼睛，校服", "绫波丽"],
      ["艾米莉亚，银色长发，紫色眼睛，白色长裙", "艾米莉亚"],
      ["雷姆，蓝色短发，蓝色眼睛，女仆装", "雷姆"],
      ["拉姆，粉红色短发，女仆装", "拉姆"],
      ["雷姆与拉姆并排，一蓝一粉短发，女仆装", "雷姆拉姆"],
      ["爱丽丝，金色长发，蓝色眼睛，白色衬衫与背带裙", "爱丽丝"],
      ["蒂法，黑色长发，红色眼睛，白色背心与短裙", "蒂法"],
      ["尤菲，黑色短发，绿色眼睛，忍者装", "尤菲"],
      ["劳拉，棕色马尾，探险装与背包", "劳拉"],
      ["吉尔，银色短发，蓝色眼睛，战术服", "吉尔"],
      ["镜华，紫色长发，紫色眼睛，法师长袍", "镜华"],
      ["可可萝，粉色长发，绿色眼睛，精灵耳与白裙", "可可萝"],
      ["佩可莉姆，橙色长发，绿色眼睛，骑士装", "佩可莉姆"],
      ["凯露，黑色长发，异色瞳，猫耳与魔法师装", "凯露"],
      ["白子，黑色短发，红色眼睛，运动服与耳机", "白子"],
      ["星野，粉色长发，蓝色眼睛，制服与外套", "星野"],
      ["砂狼白子，灰白色长发，红色眼睛，军事风制服", "砂狼白子"],
      ["和纱，白色长发，红色眼睛，和风短装", "和纱"],
      ["阿米娅，棕色长发，兔耳，深色大衣", "阿米娅"],
      ["能天使，红色短发，蓝色眼睛，光环与枪", "能天使"],
      ["德克萨斯，灰色长发，黄色眼睛，黑色西装", "德克萨斯"],
      ["陈，白色长发，蓝色眼睛，近卫局制服", "陈"],
      ["史尔特尔，白色长发，红色眼睛，黑红配色服装", "史尔特尔"],
      ["W，白色短发，红色眼睛，佣兵装与斗篷", "W"],
      ["斯卡蒂，银白色长发，红色眼睛，深海猎人装", "斯卡蒂"],
      ["年，白色长发，金色眼睛，中式长袍", "年"],
      ["卡芙卡，暗红色长发，紫色眼睛，黑色大衣与墨镜", "卡芙卡"],
      ["银狼，灰色短发，紫色眼睛，休闲卫衣与护目镜", "银狼"],
      ["花火，黑色长发，红色眼睛，和风短装与面具", "花火"],
      ["流萤，白色短发，蓝色眼睛，白色连衣裙", "流萤"]
    ] },
    { id: "anime", name: "动画角色", hint: "经典形象", tags: [
      ["三笠，黑色短发，灰色眼睛，深色夹克与围巾", "三笠"],
      ["亚丝娜，栗色长发，栗色眼睛，白色与红色骑士装", "亚丝娜"],
      ["时崎狂三，黑色双马尾，异色瞳，哥特洋装", "时崎狂三"],
      ["saber，金色长发，绿色眼睛，蓝白骑士裙", "saber"],
      ["远坂凛，黑色双马尾，红色眼睛，红色上衣与短裙", "远坂凛"],
      ["间桐樱，紫色长发，紫色眼睛，白色衬衫与缎带", "间桐樱"],
      ["御坂美琴，棕色短发，棕色眼睛，校服", "御坂美琴"],
      ["战场原黑仪，黑色长发，黑色眼睛，校服", "战场原黑仪"],
      ["千反田爱瑠，黑色长发，紫色眼睛，校服", "千反田爱瑠"],
      ["雪之下雪乃，黑色长发，蓝色眼睛，校服", "雪之下雪乃"],
      ["加藤惠，黑色短发，黑色眼睛，白色上衣与短裙", "加藤惠"],
      ["四宫辉夜，黑色长发，红色眼睛，秀知院制服", "四宫辉夜"],
      ["藤原千花，粉色短发，蓝色眼睛，制服与蝴蝶结", "藤原千花"],
      ["中野三玖，棕色长发，蓝色眼睛，制服与耳机", "中野三玖"],
      ["中野五月，橙红色长发，红色眼睛，制服", "中野五月"],
      ["式守，黑色长发，黑色眼睛，校服", "式守"],
      ["芙莉莲，白色长发，绿色眼睛，白色魔法师长袍", "芙莉莲"],
      ["菲伦，紫色长发，紫色眼睛，黑色魔法师装", "菲伦"],
      ["阿尼亚，粉色短发，绿色眼睛，校服", "阿尼亚"],
      ["约尔，黑色长发，红色眼睛，黑色礼裙", "约尔"],
      ["露西，粉色短发，蓝色眼睛，赛博改造服", "露西"],
      ["大卫，棕色短发，赛博改造装", "大卫"],
      ["玛奇玛，橙红色长发，黄色眼睛，白衬衫与黑西装", "玛奇玛"],
      ["帕瓦，金色长发，红色眼睛，白衬衫与领带", "帕瓦"],
      ["绫波丽与明日香并肩，蓝发与橙发", "丽与明日香"],
      ["莉可丽丝，黑色长发与白色长发双人，制服与枪", "莉可丽丝双人"],
      ["薇尔莉特，金色长发，蓝色眼睛，白色洋装", "薇尔莉特"],
      ["晓美焰，黑色长发，紫色眼睛，黑色长裙", "晓美焰"],
      ["鹿目圆，粉色双马尾，粉色眼睛，粉色洋装", "鹿目圆"],
      ["八神庵，红色长发，黑色皮衣与红手套", "八神庵"],
      ["草薙素子，紫色短发，义体与战术服", "草薙素子"],
      ["明日香与真嗣对立，驾驶服与校服", "香与真嗣"]
    ] },
    { id: "female", name: "女性人物类型", hint: "气质与外形", tags: [
      ["赛博朋克少女，机械义体接口，霓虹反光", "赛博少女"],
      ["和风巫女，白衣红袴，长直黑发", "巫女"],
      ["气质高傲的大小姐，卷发，精致妆容", "大小姐"],
      ["安静的图书管理员，圆框眼镜，低马尾", "图书管理员"],
      ["街头舞者，宽松卫衣，棒球帽反戴", "街头舞者"],
      ["旅人，背着行囊，风尘仆仆的外套", "旅人"],
      ["乐队主唱，抱着麦克风，皮衣与短裙", "乐队主唱"],
      ["咖啡师，围裙，手指沾着咖啡渍", "咖啡师"],
      ["画家，身上有颜料痕迹，宽大的衬衫", "画家"],
      ["剑士，束发，练功服，佩刀", "女剑士"],
      ["机械师，沾着油污的工装，护目镜推在额头上", "机械师"],
      ["摄影师，脖子上挂着相机，风衣", "摄影师"],
      ["调酒师，背心与领结，站在吧台后", "调酒师"],
      ["花店店主，围裙口袋里插着剪刀", "花店店主"],
      ["深夜自习的少女，桌上摊着书", "自习少女"],
      ["登山者，冲锋衣，脸颊被风吹红", "登山者"],
      ["潜水员，湿漉漉的头发，潜水服半脱", "潜水员"],
      ["芭蕾舞者，绷紧的足尖，练功服", "舞者"],
      ["滑板少女，护膝与宽松T恤", "滑板少女"],
      ["赛车手，连体赛车服，头盔夹在腋下", "赛车手"],
      ["图书修复师，桌上的镊子与旧纸", "修复师"],
      ["钟表匠，放大镜卡在眼眶上", "钟表匠"],
      ["茶道师，和服与茶碗，动作安静", "茶道师"],
      ["小提琴手，肩上的琴与弓", "小提琴手"],
      ["冲浪少女，湿透的长发，防晒背心", "冲浪少女"],
      ["陶艺师，手上沾着陶泥，围裙", "陶艺师"],
      ["调香师，玻璃瓶与滴定管", "调香师"],
      ["花式调酒师，抛瓶动作，马甲与袖箍", "花式调酒"],
      ["古董店主，老旧的开衫，手里拿着放大镜", "古董店主"],
      ["天文观测者，厚外套，望远镜旁", "观测者"],
      ["咖啡馆驻唱歌手，木吉他与麦克风", "驻唱歌手"],
      ["击剑手，白色护具与长剑", "击剑手"],
      ["弓箭手，护臂与箭袋", "弓箭手"],
      ["夜班护士，略微疲惫，护士服", "夜班护士"],
      ["电台主播，耳机与麦克风，昏暗的隔音间", "电台主播"],
      ["黑客，连帽衫与多屏显示器，冷光映脸", "黑客"],
      ["女警，制服与对讲机，站姿笔挺", "女警"],
      ["消防员，厚重防护服，脸上有灰", "消防员"],
      ["建筑师，图纸与铅笔，工地安全帽", "建筑师"],
      ["茶屋老板娘，和服，正低头沏茶", "老板娘"]
    ] },
    { id: "male", name: "男性人物类型", hint: "常见男性设定", tags: [
      ["黑色短发的年轻男子，冷静的眼神，白衬衫", "黑发青年"],
      ["银灰长发男性，金瞳，深色长大衣", "银发金瞳"],
      ["少年，乱翘的头发，宽松的黑色卫衣", "少年"],
      ["成熟男性，胡茬，磨损的皮夹克", "成熟男性"],
      ["戴眼镜的学者，衬衫与针织背心", "学者"],
      ["武术家，束发的长发，练功服", "武术家"],
      ["琴师，修长手指，深色衬衫", "琴师"],
      ["军官，制服与肩章，站姿笔挺", "军官"],
      ["侦探，风衣与礼帽，面容疲惫", "侦探"],
      ["工匠，卷起的袖子，手臂有烫伤疤", "工匠"],
      ["冲浪者，湿透的短发，晒成小麦色", "冲浪者"],
      ["吉他手，指节有茧，随性的站姿", "吉他手"],
      ["拳击手，缠着绷带的手，汗水", "拳击手"],
      ["牧羊人，粗布外套，手里拿着牧杖", "牧羊人"],
      ["送外卖的青年，头盔夹在腋下", "外卖员"],
      ["摄影师，相机挂在胸前，风衣", "男摄影师"],
      ["厨师，围裙与高帽，手上拿着菜刀", "厨师"],
      ["调酒师，马甲与袖箍，正在摇酒", "男调酒师"],
      ["剑客，束发，黑色羽织，腰间佩刀", "剑客"],
      ["学者型研究员，白大褂，眼镜反光", "研究员"],
      ["火车司机，制服与帽子，脸上有油污", "火车司机"],
      ["飞行员，飞行夹克与墨镜", "飞行员"],
      ["海员，粗线毛衣，风吹乱的头发", "海员"],
      ["流浪汉，旧大衣与围巾，眼神平静", "流浪汉"],
      ["画家，宽松衬衫，手指沾着颜料", "男画家"],
      ["钟表匠，围裙与放大镜", "男钟表匠"],
      ["僧人，深色僧衣，手持念珠", "僧人"],
      ["道士，青色道袍，背负长剑", "道士"],
      ["武士，甲胄与刀，站姿沉稳", "武士"],
      ["机械师，油污工装，护目镜", "男机械师"],
      ["教师，衬衫与领带，手里拿着书", "教师"],
      ["医生，白大褂，听诊器挂在脖子上", "医生"],
      ["快递员，制服与帽子，怀里抱着包裹", "快递员"],
      ["乐队长号手，黑色西装，正在吹奏", "号手"],
      ["登山向导，冲锋衣，绳索与背包", "登山向导"],
      ["老匠人，皱纹与老花镜，手上满是老茧", "老匠人"]
    ] },
    { id: "occupation", name: "职业设定", hint: "身份与背景", tags: [
      ["穿白大褂的研究员，胸牌与笔", "研究员"],
      ["身穿制服的空乘，推着行李箱", "空乘"],
      ["披着雨衣的邮差，怀里抱着信件", "邮差"],
      ["修女，黑色长袍与白色头巾", "修女"],
      ["骑士，破损的铠甲，手握长剑", "骑士"],
      ["法师，长袍与法杖，指尖有微光", "法师"],
      ["赏金猎人，护目镜与枪套", "赏金猎人"],
      ["考古学家，沾满沙尘的衬衫与手套", "考古学家"],
      ["图书修复师，镊子与旧纸，安静的工作台", "修复师"],
      ["钟表匠，放大镜卡在眼眶上", "钟表匠"],
      ["灯塔看守人，厚外套，风很大", "守塔人"],
      ["花匠，手套与剪刀，满身泥土", "花匠"],
      ["面包师，围裙上沾着面粉", "面包师"],
      ["邮局职员，制服与眼镜", "邮局职员"],
      ["列车员，制服帽与哨子", "列车员"],
      ["博物馆讲解员，胸牌与讲解器", "讲解员"],
      ["兽医，白大褂与听诊器，怀里抱着一只猫", "兽医"],
      ["裁缝，脖子挂着软尺，手上别着针", "裁缝"],
      ["珠宝匠，护目镜与镊子，桌上散着宝石", "珠宝匠"],
      ["制琴师，木屑与半成品小提琴", "制琴师"],
      ["书店老板，旧毛衣，正在整理书架", "书店老板"],
      ["跳水教练，运动服与秒表", "教练"],
      ["舞台灯光师，耳麦与调光台", "灯光师"],
      ["录音师，耳机与麦克风支架", "录音师"],
      ["特效化妆师，手上沾着硅胶", "化妆师"],
      ["潜水教练，潜水服与氧气瓶", "潜水教练"],
      ["护林员，制服与望远镜", "护林员"],
      ["渔夫，防水裤与渔网", "渔夫"],
      ["养蜂人，防护面罩与烟壶", "养蜂人"],
      ["药剂师，白大褂与药架", "药剂师"],
      ["牙医，口罩与器械", "牙医"],
      ["消防员，防护服与头盔，脸上有灰", "消防员"],
      ["建筑工人，安全帽与反光背心", "建筑工人"],
      ["清洁工，制服与推车，清晨的街道", "清洁工"],
      ["快递分拣员，制服与手套，仓库冷光", "分拣员"],
      ["夜班保安，制服与手电筒", "保安"]
    ] },
    { id: "fantasy", name: "幻想种族", hint: "非人类设定", tags: [
      ["精灵，尖耳，银色长发，森林纹样的斗篷", "精灵"],
      ["暗精灵，深色皮肤，白色长发，红色眼睛", "暗精灵"],
      ["高等精灵，金色长发，翠绿眼睛，长弓与皮甲", "高等精灵"],
      ["猫耳少女，毛茸茸的耳朵与尾巴", "猫耳少女"],
      ["狐妖，多尾，狐耳，和风服饰", "狐妖"],
      ["天使，白色羽翼，光环，白色长袍", "天使"],
      ["堕天使，黑色羽翼，破损的光环，暗色长袍", "堕天使"],
      ["恶魔，犄角与尖尾，暗红瞳，皮革装", "恶魔"],
      ["人鱼，鳞片与鳍，湿漉的长发，坐在礁石上", "人鱼"],
      ["半机械人，皮肤下的线路与金属接缝", "半机械人"],
      ["魔法少女，变身装与法杖，缎带飘动", "魔法少女"],
      ["龙族少女，鳞片纹路与犄角，坚硬的瞳孔", "龙族少女"],
      ["幽灵少女，半透明的身形，飘浮着", "幽灵少女"],
      ["狼人，兽耳与利爪，破损的衣物", "狼人"],
      ["吸血鬼，苍白皮肤，红色眼睛，维多利亚礼服", "吸血鬼"],
      ["树精，皮肤像树皮，发间长出枝叶", "树精"],
      ["雪女，白色长发，浅蓝和服，周围有寒气", "雪女"],
      ["猫又，双尾，猫耳，古风和服", "猫又"],
      ["凤族，羽翼与金瞳，华丽的红金长袍", "凤族"],
      ["石像鬼，石质皮肤，蹲在屋脊上", "石像鬼"],
      ["机械天使，金属羽翼，裸露的线路", "机械天使"],
      ["黏液少女，半透明的身体，流动的轮廓", "黏液少女"],
      ["半人马，马身与人形上半身", "半人马"],
      ["蛇妖，蛇尾与鳞片，竖瞳", "蛇妖"],
      ["妖精，小巧的身形，透明的翅膀", "妖精"],
      ["亡灵法师，破碎的长袍，骷髅手杖", "亡灵法师"],
      ["灵体剑士，半透明的剑与甲胄", "灵体剑士"],
      ["元素精灵，由光或水构成的形体", "元素精灵"],
      ["兽人战士，粗壮的身形，兽耳与獠牙", "兽人"],
      ["赛博僧侣，机械义肢与僧袍", "赛博僧侣"]
    ] },
    { id: "group", name: "双人与群像", hint: "多人构图", tags: [
      ["两个女孩并肩站着，一高一矮，气质对比", "双人并肩"],
      ["三人的小团体，站在街角交谈", "三人街角"],
      ["背靠背的两个人，看向相反方向", "背靠背"],
      ["一大一小的组合，像姐弟", "姐弟组合"],
      ["一男一女面对面，气氛微妙", "男女对立"],
      ["四个人围坐，桌上摊着地图", "四人围坐"],
      ["前后错落站位的双人，景深分明", "双人错位"],
      ["一个坐着，一个站在身后", "坐与站"],
      ["两人牵着手走过街道", "牵手走过"],
      ["镜像般的双胞胎，动作一致", "镜像双胞胎"],
      ["师徒二人，一前一后，年长者回头", "师徒"],
      ["对手相向而立，气氛紧张", "对峙"],
      ["母亲与孩子，牵手走在黄昏", "母子"],
      ["两人共撑一把伞", "共伞"],
      ["三人并排走，中间的人被两侧夹着", "三人并排"],
      ["一人撑伞，一人淋雨，擦肩而过", "擦肩"],
      ["两人隔着一扇玻璃对望", "隔窗对望"],
      ["聚会上的一群人，前景清晰背景模糊", "聚会群像"]
    ] },
    { id: "vibe", name: "气质与氛围", hint: "人物气场", tags: [
      ["神情疏离，像隔着一层雾", "疏离"],
      ["柔和亲切，让人放松", "亲切"],
      ["危险而克制，眼神带锋利感", "危险感"],
      ["疲惫但仍在坚持", "疲惫坚持"],
      ["天真好奇，眼睛睁得很大", "天真"],
      ["沉静内敛，话不多", "沉静"],
      ["张扬外放，动作幅度大", "张扬"],
      ["冷淡到近乎漠然", "漠然"],
      ["带一点玩世不恭的松弛", "玩世不恭"],
      ["温柔里藏着坚定", "温柔坚定"],
      ["脆弱感明显，像随时会碎", "脆弱"],
      ["成熟从容，掌控局面", "从容"],
      ["忧郁，视线总是低垂", "忧郁"],
      ["锐利果断，动作干脆", "果断"],
      ["疏懒随意，姿势松弛", "疏懒"],
      ["神秘，看不透在想什么", "神秘"],
      ["书卷气，安静专注", "书卷气"],
      ["野性，像随时会动起来", "野性"],
      ["庄重肃穆，姿态端正", "庄重"],
      ["轻盈灵动，动作像舞蹈", "灵动"]
    ] },
    { id: "scifi", name: "科幻与机甲", hint: "未来感设定", tags: [
      ["驾驶员，紧身驾驶服，插着接口线", "驾驶员"],
      ["机甲，巨大的金属机体，做旧的装甲", "机甲"],
      ["驾驶舱内部，环绕式屏幕与操纵杆", "驾驶舱"],
      ["宇航员，厚重的宇航服，面罩反光", "宇航员"],
      ["太空站内部，白色舱体与蓝色指示灯", "太空站"],
      ["仿生人，皮肤下的接缝与编号", "仿生人"],
      ["战术小队，统一的黑色装备与头盔", "战术小队"],
      ["黑客，多块悬浮屏幕，冷光映在脸上", "黑客"],
      ["无人机操作员，手握遥控器，抬头看天", "操作员"],
      ["废墟中的幸存者，改装过的护甲", "幸存者"],
      ["实验室里的克隆体，玻璃培养舱", "克隆体"],
      ["赛博医生，机械义肢与手术灯", "赛博医生"],
      ["轨道电梯内部，透明舱壁与星空", "轨道电梯"],
      ["外星地貌上的探索者，头盔与探测仪", "探索者"],
      ["全息投影的虚拟偶像，半透明质感", "全息偶像"],
      ["装甲士兵，重型护甲与发光面罩", "装甲士兵"]
    ] },
    { id: "aged", name: "年龄与年代", hint: "时代感", tags: [
      ["少女，十几岁的年纪，神情青涩", "少女"],
      ["二十出头的年轻人，刚入社会", "青年"],
      ["三十岁上下，成熟稳重", "成熟"],
      ["四十岁，眼角的细纹很明显", "中年"],
      ["上了年纪的老人，银发与皱纹", "老年"],
      ["昭和年代，复古的衣着与发型", "昭和风"],
      ["八十年代，蓬松卷发与宽肩外套", "八十年代"],
      ["九十年代，简约的牛仔与T恤", "九十年代"],
      ["民国风，旗袍与卷发", "民国风"],
      ["维多利亚时代，束腰与长裙", "维多利亚"],
      ["江户时代，和服与木屐", "江户风"],
      ["未来纪元，极简剪裁与复合材质", "未来纪元"],
      ["蒸汽时代，黄铜与皮革", "蒸汽时代"],
      ["奇幻中世纪，粗布与皮甲", "中世纪"],
      ["末日之后，拼接改造的衣物", "末日风"],
      ["古风，宽袖长袍与发冠", "古风"]
    ] }
  ];
  const KREA_PRESET_GROUPS = [
    { id: "anime", label: "二次元", items: [
      // 这一组的骨架来自 Krea 官方博客《Studio anime aesthetics with Krea 2》：
      // 官方明确说「anime 不是一种画风，而是一堆工作室美学」，并且验证了三招
      // 按强度排序的锁定方式——① 直接在提示词里点名工作室/导演（能吃下 70%），
      // ② 拿真实帧当风格参考（补上大部分剩余差距），③ 情绪板（20–40 帧）。
      // 所以下面每条都以「媒介 + 工作室名」开头，再写主体、场景、光线、配色。
      { id: "a_keyvisual", label: "现代 Key Visual", text: "a modern anime key visual: a girl with long dark hair turning back over her shoulder, wind lifting her coat, sunset behind her, clean consistent lineart, crisp cel shading with hard-edged shadows, vibrant colors, highly detailed eyes with sharp catchlights." },
      { id: "a_ghibli", label: "吉卜力", text: "anime film background painting in the aesthetic of Studio Ghibli: a small girl in a faded blue dress standing at the edge of a wheat field, a weathered wooden farmhouse behind her, soft midday light through high summer clouds, restrained palette of dusty green and warm ochre, hand-painted watercolor texture, gentle line work." },
      { id: "a_shinkai", label: "新海诚", text: "a saturated anime key visual in the style of Makoto Shinkai: two teenagers on a station platform at dusk, glowing telephone wires overhead, hyper-saturated orange and magenta sky with lens flare, wet concrete reflecting the light, CoMix Wave Films aesthetic, crisp digital lineart." },
      { id: "a_kyoani", label: "京都动画", text: "a warm anime interior in the style of Kyoto Animation: a girl doing homework at a wooden counter, a pendant lamp hanging above, framed art and a single open book on the shelf, late afternoon light through the window, careful clutter, gentle and precise line work, slice-of-life mood." },
      { id: "a_madhouse", label: "Madhouse 都市黑", text: "a cold anime scene in the style of Madhouse: a lone figure in a raincoat on a Tokyo backstreet at night, sharp cel shading with hard shadows, cold blue and green palette with sodium-yellow accents, rain on wet asphalt, urban noir, seinen register." },
      { id: "a_sunrise", label: "90s 机甲", text: "1990s Sunrise mecha anime, classic OVA cel-shading, a hand-painted white and red mecha crouched inside a ruined hangar, industrial palette of gunmetal and rust, bold line work, hard-edged shadows, dust drifting through a shaft of light." },
      { id: "a_shoujo", label: "少女漫画", text: "a shoujo manga illustration: a girl in a sailor uniform standing on a park path in spring, cherry blossom petals in the air, pastel palette of pale pink and mint, delicate thin line work, dreamy soft light, sparkle highlights in her eyes." },
      { id: "a_flat", label: "平涂", text: "Flat anime style. A courier on a scooter waiting at a crosswalk in a rainy neon city, reflections on the wet road, limited palette of magenta, teal and black, bold flat colors with minimal shading, simple clean shapes." },
      { id: "a_cel90s", label: "90s 赛璐璐", text: "a 1990s cel anime still, hand-painted cels: a boy in a green jacket leaning against a chain-link fence, DVD-era soft grain, large expressive eyes, calm nostalgic colors, simple background, TV anime framing." },
      { id: "a_manga", label: "黑白漫画", text: "a black and white manga panel: a close-up of a girl's face, screen tone dots for shadow, sharp ink hatching, high contrast, dramatic diagonal composition, empty speech bubble." },
      { id: "a_lightnovel", label: "轻小说插画", text: "a light novel illustration: a girl in a winter coat holding a paper cup, snow falling on a quiet street, warm shop light from the side, soft painterly rendering with clean lineart, gentle pastel palette, anime illustration finish." },
      { id: "a_painterly", label: "厚涂动漫", text: "a painterly anime illustration: a warrior resting against a stone wall, visible brushwork, thick impasto on the armor, dramatic rim light, muted earth palette with a single red accent, textured canvas feel." }
    ] },
    { id: "portrait", label: "人像", items: [
      { id: "k_window", label: "窗边肖像", text: "A woman in her thirties sitting by a large north-facing window, soft daylight wrapping her face, wearing a worn oatmeal linen shirt, shot on an 85mm lens at f/2, natural skin texture with visible pores, quiet morning mood." },
      { id: "k_rainstreet", label: "雨夜街头", text: "A young man waiting under a shop awning on a rainy night, warm sodium-vapor light from above, wet pavement mirroring the sign, documentary street photography, 35mm film grain." },
      { id: "k_kitchen", label: "厨房晨光", text: "An older woman kneading dough at a kitchen table, early sunlight through a side window catching flour dust in the air, flour on her forearms, warm and unhurried, photographed on 35mm film." },
      { id: "k_sculptor", label: "工作室侧光", text: "A sculptor in a clay-stained apron, hard side light from a single bare bulb, half the face in shadow, dust in the air, textured plaster background, black and white." },
      { id: "k_wheat", label: "黄昏逆光", text: "A girl standing in a wheat field at golden hour, strong backlight rimming her hair, slight lens flare, warm haze, shot on 85mm at f/1.8, shallow depth of field." },
      { id: "k_subway", label: "地铁站", text: "A commuter on a crowded platform, cold fluorescent ceiling lights, motion blur of a passing train behind, neutral expression, candid documentary framing." },
      { id: "k_backstage", label: "舞台后台", text: "A dancer resting backstage before a performance, single tungsten bulb overhead, deep shadows, tulle skirt catching the light, tired and quiet." },
      { id: "k_library", label: "图书馆", text: "A student reading at a long wooden table, afternoon light through tall arched windows, dust motes in the beam, a deep green reading lamp, shallow focus on hands and book." },
      { id: "k_rooftop", label: "屋顶夜景", text: "A person sitting on a rooftop at night, city glow from below lighting the face, cold blue ambience, distant windows out of focus." },
      { id: "k_snow", label: "雪地", text: "A figure in a heavy wool coat walking through falling snow, flat overcast light, no hard shadows, muted palette, breath visible in the cold air." },
      { id: "k_cafe", label: "咖啡馆", text: "A woman at a corner cafe table, warm late-afternoon sun through venetian blinds striping the wall, a coffee cup ring on the wood, 50mm lens." },
      { id: "k_boxer", label: "拳击手", text: "A boxer between rounds, sweat catching the overhead light, deep red corner stool, high contrast, gritty editorial sports photography." }
    ] },
    { id: "scene", label: "场景", items: [
      { id: "k_factory", label: "废弃工厂", text: "An abandoned factory floor, shattered skylights dropping columns of dusty light, rusted machinery, a single chair in the middle, cold and still." },
      { id: "k_cabin", label: "山间小屋", text: "A small timber cabin on a mountain slope at dusk, one warm window lit, low fog moving through the pines, cold blue air." },
      { id: "k_konbini", label: "便利店夜", text: "A convenience store at 2am, harsh white interior light spilling onto empty asphalt, wet road reflecting the glowing signage, nobody around." },
      { id: "k_cliff", label: "海边悬崖", text: "A grassy cliff edge above a grey sea, wind bending the grass, overcast sky with a thin band of light on the horizon, salt haze." },
      { id: "k_elevator", label: "老式电梯", text: "The inside of an old brass elevator, warm bulb above, mirrored walls repeating the space, worn carpet, a faint filament hum." },
      { id: "k_greenhouse", label: "温室", text: "A Victorian glasshouse overgrown with ferns, condensation on the panes, diffused green light, iron framework, a watering can left on the path." },
      { id: "k_parking", label: "地下停车场", text: "An empty underground carpark, rows of cold fluorescent tubes, oil stains on concrete, one distant car with headlights on." },
      { id: "k_train", label: "火车车厢", text: "The interior of a night train compartment, a single reading lamp, dark countryside sliding past the window, worn velvet seating, quiet." },
      { id: "k_pool", label: "屋顶泳池", text: "A rooftop pool at sunset, water reflecting the orange sky, city skyline behind, wet tile, long shadows across the deck." },
      { id: "k_church", label: "教堂内部", text: "A stone church interior, high windows casting coloured light onto the floor, dust in the beams, empty wooden pews, deep silence." },
      { id: "k_phonebooth", label: "电话亭雨夜", text: "A glass phone booth on a rainy street at night, interior bulb glowing, rain streaking the glass, empty sidewalk, reflections everywhere." },
      { id: "k_desert", label: "沙漠公路", text: "An empty two-lane highway cutting through red desert, heat shimmer on the asphalt, telephone poles receding, hard midday sun." }
    ] },
    { id: "object", label: "静物", items: [
      { id: "k_compass", label: "黄铜罗盘", text: "A weathered brass compass resting on an old nautical chart, scratched glass, a single window light raking across from the left, dust on the paper." },
      { id: "k_leather", label: "旧皮夹克", text: "A worn brown leather jacket draped over a wooden chair, creased at the elbows, cracked surface, soft window light from the side." },
      { id: "k_whisky", label: "威士忌", text: "A heavy crystal tumbler of whisky on a dark bar top, one ice cube, warm backlight making the amber glow, deep shadows." },
      { id: "k_watch", label: "机械表", text: "A vintage mechanical watch lying open on a workbench, exposed gears, tweezers beside it, hard focused light from a desk lamp." },
      { id: "k_perfume", label: "香水瓶", text: "A faceted glass perfume bottle on a wet stone surface, single hard light from behind, caustics on the stone, cool palette." },
      { id: "k_book", label: "旧书", text: "An open antique book with foxed pages, a pressed flower between them, warm afternoon light from the right, dust in the air." },
      { id: "k_teapot", label: "陶瓷茶壶", text: "A celadon ceramic teapot on a linen cloth, soft north window light, subtle glaze reflections, one small chip on the spout." },
      { id: "k_sneaker", label: "运动鞋", text: "A single worn running shoe on a concrete ledge, scuffed toe, laces undone, hard sunlight from above casting a sharp shadow." },
      { id: "k_camera", label: "老相机", text: "A battered rangefinder camera on a scratched desk, brass worn through the black paint, single warm desk lamp from the left." },
      { id: "k_flowers", label: "花束", text: "A loose bunch of dried flowers on a plaster shelf, muted rust and cream, soft diffused daylight, long shadows on the wall." }
    ] },
    { id: "design", label: "平面", items: [
      { id: "k_magazine", label: "杂志封面", text: "A magazine cover layout, a close-up portrait filling the frame, bold serif masthead reading \"MODERN\", thin rule lines, generous white margin, editorial art direction." },
      { id: "k_poster", label: "海报", text: "A Swiss-style event poster, a single photograph in the lower half, heavy black grotesque type at the top reading \"NIGHT SHIFT\", grid-aligned, off-white paper." },
      { id: "k_vinyl", label: "唱片封面", text: "A square record sleeve, abstract torn-paper collage in rust and indigo, small lowercase artist name in the corner, matte print texture." },
      { id: "k_package", label: "包装盒", text: "A minimal skincare box on a warm grey seamless background, soft studio light from the upper left, matte stock, one line of small type." },
      { id: "k_type", label: "字体排版", text: "An experimental typographic composition, oversized condensed letterforms cropped by the frame edge, black on uncoated cream paper, risograph grain." },
      { id: "k_menu", label: "菜单", text: "A folded paper cafe menu on a marble counter, hand-set serif listings, a coffee stain in the corner, raking morning light." },
      { id: "k_ticket", label: "票根", text: "A torn cinema ticket stub on dark fabric, faded thermal print, perforated edge, tight macro shot with shallow depth of field." },
      { id: "k_mockup", label: "品牌样机", text: "A blank cotton tote hanging on a steel hook against a concrete wall, soft side light, realistic fabric folds, product mockup framing." }
    ] },
    { id: "cinematic", label: "电影感", items: [
      { id: "k_carchase", label: "雨夜追车", text: "A car chase on a rain-soaked overpass at night, headlights smearing across wet asphalt, lens flare, anamorphic wide shot, cold blue and hot orange." },
      { id: "k_standoff", label: "沙漠对峙", text: "Two figures facing each other across a dusty desert road, long shadows from a low sun, heat haze, wide anamorphic framing, tense stillness." },
      { id: "k_interrogation", label: "审讯室", text: "A bare interrogation room, a single hanging lamp above a metal table, one figure in shadow, hard contrast, green-grey walls." },
      { id: "k_spacecraft", label: "太空舱", text: "The cramped interior of a spacecraft, instrument panels glowing amber, a small window onto deep black, condensation on the glass." },
      { id: "k_forestchase", label: "森林追逐", text: "A figure running through a dark pine forest at night, a flashlight beam cutting through fog, motion blur in the branches, handheld camera." },
      { id: "k_bar", label: "酒吧独坐", text: "A lone figure at the end of a long bar, bottles backlit in amber, smoke in the air, deep focus down the counter, film noir framing." },
      { id: "k_station", label: "车站告别", text: "Two people on a platform under a station clock, steam or fog drifting, warm lamps against cold night air, long lens compression." },
      { id: "k_trench", label: "战壕", text: "A muddy trench at dawn, soldiers silhouetted against grey light, rain, desaturated palette, handheld documentary framing." },
      { id: "k_bow", label: "船头", text: "A figure standing at the bow of a small boat, sea spray, overcast horizon, wind in the clothing, wide shot from behind." },
      { id: "k_roofstandoff", label: "屋顶对峙", text: "Two figures on a wet rooftop, city lights below, cold wind, low angle looking up, hard rim light from a nearby sign." }
    ] }
  ];
  const KREA_TAG_GROUPS = [
    { id: "light", name: "光线", hint: "写清光源位置，这一项的收益最大", tags: [
      ["soft daylight entering through a north-facing window", "北窗柔光"],
      ["a single tungsten bulb hanging above the table", "单只钨丝灯"],
      ["late-afternoon sunlight coming through venetian blinds", "百叶窗斜阳"],
      ["cold fluorescent ceiling lights", "冷白荧光灯"],
      ["warm sodium-vapor street lighting", "暖黄路灯"],
      ["golden hour backlight rimming the hair", "黄金时刻轮廓光"],
      ["flat overcast light with no hard shadows", "阴天漫射光"],
      ["neon sign glow reflecting on wet asphalt", "霓虹映湿地面"],
      ["candlelight from below, warm and flickering", "下方烛光"],
      ["a studio softbox at 45 degrees with clean falloff", "45° 柔光箱"],
      ["hard midday sun casting short sharp shadows", "正午硬光"],
      ["light spilling from a doorway behind the subject", "门后漏光"],
      ["moonlight through thin curtains", "薄帘月光"],
      ["firelight from the left, deep shadow on the right", "左侧火光"],
      ["practical lamps only, no fill light", "只用实景灯"],
      ["dappled light filtering through leaves", "树叶斑驳光"],
      ["screen glow on the face in a dark room", "屏幕反光"],
      ["a bare bulb swinging slowly, shadows sweeping the wall", "摇晃灯光"],
      ["thin band of light on the horizon under heavy cloud", "云缝天光"],
      ["strong lens flare from a low sun", "低日镜头光斑"]
    ] },
    { id: "lens", name: "镜头", hint: "焦段与机位决定画面语法", tags: [
      ["shot on a 35mm lens at f/2", "35mm f/2"],
      ["85mm portrait lens with shallow depth of field", "85mm 浅景深"],
      ["wide-angle 24mm with slight edge distortion", "24mm 广角"],
      ["telephoto compression, background stacked close", "长焦压缩"],
      ["low angle looking up", "低角度仰拍"],
      ["high angle looking down", "高角度俯拍"],
      ["eye-level straight-on framing", "平视正面"],
      ["over-the-shoulder framing", "过肩镜头"],
      ["centered symmetrical composition", "中心对称"],
      ["rule of thirds with the subject on the left", "三分法"],
      ["tight close-up on the face", "面部特写"],
      ["full body with the feet visible", "全身入画"],
      ["a subtle dutch angle tilt", "轻微荷兰角"],
      ["macro shot with extreme close detail", "微距"],
      ["shot through a doorway framing the subject", "门框取景"],
      ["reflection shot in a mirror", "镜面反射"]
    ] },
    { id: "texture", name: "质感", hint: "具体名词比 detailed 有效得多", tags: [
      ["natural skin texture with visible pores", "真实皮肤"],
      ["sun-bleached plaster with hairline cracks", "斑驳灰泥墙"],
      ["heavily rusted iron with orange corrosion", "锈蚀铁件"],
      ["deep oxblood satin", "深牛血红缎面"],
      ["raw linen with visible weave", "粗织亚麻"],
      ["wet pavement mirroring the lights", "湿地面镜面"],
      ["brushed aluminum with fine scratches", "拉丝铝"],
      ["worn leather creased at the folds", "褶皱旧皮"],
      ["frosted glass with soft diffusion", "磨砂玻璃"],
      ["fine film grain", "细颗粒"],
      ["matte paper with slight tooth", "哑光纸纹"],
      ["glossy ceramic with a hard specular highlight", "亮面陶瓷"],
      ["chipped paint over older layers", "层叠掉漆"],
      ["condensation running down cold glass", "玻璃水汽"]
    ] },
    { id: "mood", name: "氛围", hint: "空气里有什么，决定情绪", tags: [
      ["thick morning fog with low visibility", "浓晨雾"],
      ["light rain with drops on the lens", "镜头雨滴"],
      ["dust motes floating in a sunbeam", "光柱浮尘"],
      ["humid summer air with haze in the distance", "闷热潮气"],
      ["the cold blue hour before sunrise", "蓝调黎明"],
      ["smoke drifting across the frame", "烟雾穿画"],
      ["snow falling slowly and quietly", "缓雪"],
      ["heat shimmer over asphalt", "路面热浪"],
      ["steam rising from a vent", "蒸汽"],
      ["a still room with the window open", "开窗静室"],
      ["wind bending tall grass", "风吹草"],
      ["shaft of light in a dark interior", "暗室光柱"]
    ] },
    { id: "medium", name: "媒介", hint: "决定它是照片、画，还是印刷品", tags: [
      ["photographed on 35mm film with Kodak Portra tones", "35mm 胶片"],
      ["editorial fashion photography", "时装大片"],
      ["documentary street photography", "纪实街拍"],
      ["painterly illustration with visible brushwork", "厚涂绘画"],
      ["flat vector graphic with a limited palette", "扁平矢量"],
      ["risograph print with slight misregistration", "Riso 印刷"],
      ["charcoal sketch with loose hatching", "炭笔速写"],
      ["oil painting with thick impasto", "油画堆料"],
      ["anime key visual with clean lineart", "动画关键帧"],
      ["claymation still with matte plasticine", "黏土定格"],
      ["3D render with soft global illumination", "3D 渲染"],
      ["collage of torn paper and newsprint", "撕纸拼贴"],
      ["cyanotype print, deep prussian blue", "蓝晒"],
      ["ink wash on absorbent paper", "水墨晕染"],
      ["airbrushed illustration with soft gradients", "喷绘"],
      ["photocopied zine with toner speckle", "影印 zine"]
    ] },
    { id: "detail", name: "细节", hint: "一个主体一个动作，别抢", tags: [
      ["hands with visible veins and knuckles", "手部细节"],
      ["freckles across the nose and cheeks", "鼻颊雀斑"],
      ["hair pulled back with a few loose strands", "碎发"],
      ["a thin scar above the left eyebrow", "眉上旧疤"],
      ["a small enamel pin on the lapel", "翻领别针"],
      ["sleeves rolled to the elbow", "挽起袖子"],
      ["mud on the boots", "靴上泥"],
      ["a cup held with both hands", "双手捧杯"],
      ["looking away from the camera", "不看镜头"],
      ["eyes closed, breathing slowly", "闭眼"],
      ["mid-stride, one foot off the ground", "迈步瞬间"],
      ["leaning against a doorframe", "靠门框"],
      ["a coat draped over one shoulder", "外套搭肩"],
      ["turning back over the shoulder", "回首"]
    ] }
  ];
  const KREA_CHARACTER_GROUPS = [
    { id: "age", name: "年龄气质", tags: [
      ["a woman in her early twenties", "二十出头女性"],
      ["a man in his thirties", "三十多岁男性"],
      ["an elderly woman with deep laugh lines", "老年女性"],
      ["a teenager with a guarded expression", "戒备少年"],
      ["a middle-aged man, tired eyes", "中年疲惫男"],
      ["a child around seven years old", "七岁孩童"],
      ["a person of ambiguous age and gender", "中性形象"],
      ["a weathered old fisherman", "风霜渔夫"]
    ] },
    { id: "hair", name: "发型", tags: [
      ["long dark hair tied back loosely", "松散黑长发"],
      ["a short blunt bob", "齐耳短发"],
      ["curly hair with volume", "蓬松卷发"],
      ["close-cropped hair", "寸头"],
      ["silver hair swept to one side", "银发侧分"],
      ["braided hair over one shoulder", "单侧麻花辫"],
      ["wet hair clinging to the forehead", "湿发贴额"],
      ["hair shaved at the sides", "两侧剃短"]
    ] },
    { id: "wear", name: "服装", tags: [
      ["a worn oatmeal linen shirt", "燕麦色亚麻衬衫"],
      ["a heavy charcoal wool coat", "炭灰羊毛大衣"],
      ["a deep oxblood satin dress", "牛血红缎面裙"],
      ["a faded denim jacket over a white tee", "旧牛仔外套"],
      ["a black turtleneck with rolled sleeves", "黑高领"],
      ["a clay-stained work apron", "沾泥工作围裙"],
      ["a tailored navy suit, no tie", "藏青西服"],
      ["a thick knit sweater with a stretched collar", "旧粗针织衫"],
      ["a rain-soaked trench coat", "淋湿风衣"],
      ["a simple white cotton dress", "白棉布裙"]
    ] },
    { id: "pose", name: "姿态", tags: [
      ["sitting on the edge of a bed", "坐在床沿"],
      ["standing in a doorway, half turned", "门边半侧身"],
      ["leaning on a windowsill", "靠窗台"],
      ["walking away from the camera", "背向走开"],
      ["crouching down to look closer", "蹲下细看"],
      ["arms crossed, weight on one leg", "抱臂站立"],
      ["lying on the floor looking up", "躺地仰视"],
      ["paused mid-gesture, hand raised", "抬手瞬间"]
    ] }
  ];
  const SAMPLER_PRESETS = {
    sdxl: {
      balanced: { label: "均衡", sampler: "Euler a", scheduler: "Karras", note: "通用均衡：动漫与写实都能用" },
      realism: { label: "写实", sampler: "DPM++ 2M SDE", scheduler: "Karras", note: "写实细节：皮肤与布料纹理更丰富" },
      structure: { label: "结构", sampler: "DPM++ 2M", scheduler: "Karras", note: "结构清晰：构图稳定，边缘更利落" },
      soft: { label: "柔和", sampler: "Euler", scheduler: "Exponential", note: "柔和过渡：光线与皮肤更平滑" },
      lowstep: { label: "低步", sampler: "UniPC", scheduler: "Simple", note: "低步打样：6–12 步快速试构图" }
    },
    anima: {
      balanced: { label: "均衡", sampler: "Euler", scheduler: "SGM Uniform", note: "作者推荐：构图与细节平衡，适合日常出图" },
      realism: { label: "厚涂", sampler: "ER SDE", scheduler: "Beta", note: "Anima 预设默认：皮肤与材质更厚实，速度略慢" },
      structure: { label: "结构", sampler: "Res Multistep", scheduler: "Beta", note: "多步回看：构图与手指更稳，单张最慢" },
      soft: { label: "柔和", sampler: "Euler a", scheduler: "Beta", note: "带随机性：光线更柔，构图更活" },
      lowstep: { label: "低步", sampler: "Euler", scheduler: "Simple", note: "20 步内打样：先用它定构图，再换均衡出图" }
    },
    zimage: {
      // Z-Image Turbo 官方只给 res_multistep + simple；其余是在不离开这套曲线的取向变化。
      balanced: { label: "均衡", sampler: "Res Multistep", scheduler: "Simple", note: "官方配方：9 步、CFG 1、shift 3" },
      gacha: { label: "抽卡", sampler: "Euler a", scheduler: "Simple", note: "带随机性：同词出图差异更大" },
      structure: { label: "结构", sampler: "DPM++ 2M", scheduler: "Simple", note: "复杂场景与手部更稳，略慢" },
      soft: { label: "柔和", sampler: "Res Multistep", scheduler: "Beta", note: "过渡更柔，适合皮肤与雾气" },
      lowstep: { label: "快速", sampler: "Euler", scheduler: "Simple", note: "对照用：更快但层次更平" }
    },
    krea: {
      // Krea 2 Turbo 的 sigma 网格被 8 步蒸馏锚定，官方只认 Euler + Simple。
      // 其余四套都是在不离开 Euler 系太远的前提下做取向变化：
      // 换 Karras / DPM++ 这类多步曲线，在 8 步下不是糊就是出彩噪。
      balanced: { label: "均衡", sampler: "Euler", scheduler: "Simple", note: "官方 Turbo 配方：8 步、CFG 1、mu 1.15，画质最正" },
      gacha: { label: "抽卡", sampler: "Euler a", scheduler: "Simple", note: "带随机性：同提示词出图差异更大，适合挑构图" },
      structure: { label: "结构", sampler: "Res Multistep", scheduler: "Simple", note: "多步回看：多人、复杂场景与手部更稳，单张略慢" },
      soft: { label: "柔和", sampler: "Euler", scheduler: "Beta", note: "过渡更柔：适合逆光、雾气和皮肤质感" },
      lowstep: { label: "快速", sampler: "DDIM", scheduler: "Simple", note: "对照用：8 步下比 Euler 更平，适合快速看色块" }
    },
    // MOSS-Image 5B 是流匹配模型，官方配方 Euler + Simple；
    // 实测 ER SDE + Simple 配跳步缓存最快且画质几乎无损，Res Multistep 结构最稳。
    moss: {
      balanced: { label: "均衡", sampler: "Euler", scheduler: "Simple", note: "官方配方：25–50 步、CFG 2.5–3.0，画质最正" },
      realism: { label: "极速", sampler: "ER SDE", scheduler: "Simple", note: "实测最快：配跳步缓存 768² 约 13 秒，画质几乎无损" },
      structure: { label: "结构", sampler: "Res Multistep", scheduler: "Simple", note: "多步回看：复杂构图与人体更稳，单张最慢" },
      soft: { label: "柔和", sampler: "Euler", scheduler: "Beta", note: "过渡更柔：适合云雾、逆光与氛围光" },
      lowstep: { label: "低步", sampler: "Euler", scheduler: "Simple", note: "12–20 步打样：先定构图，再换均衡出图" }
    }
  };
  const RECIPES = [
    {
      id: "boudoir", name: "暖调卧室", desc: "亚麻床单、晨光与柔焦", c1: "#B9C6CE", c2: "#5C707C",
      tags: "boudoir, bedroom, morning light, linen sheets, soft focus, intimate atmosphere, warm tones, film grain"
    },
    {
      id: "neon", name: "夜色霓虹", desc: "雨夜街道、反光与电影感", c1: "#8C9DBE", c2: "#2C3348",
      tags: "city night, neon lights, rain, wet street, reflective, cinematic lighting, cyberpunk, depth of field"
    },
    {
      id: "film", name: "复古胶片", desc: "九十年代杂志、颗粒与柔调", c1: "#BDBBAE", c2: "#5F665F",
      tags: "1990s, retro, film photography, kodak portra 400, grain, warm tones, vintage, magazine cover"
    },
    {
      id: "pool", name: "泳池夏日", desc: "高调日光、水面反光", c1: "#9DC0C2", c2: "#3F6268",
      tags: "poolside, summer, sunlight, water reflection, bikini, sunglasses, high key, vibrant colors"
    },
    {
      id: "gothic", name: "暗黑哥特", desc: "烛光、黑蕾丝与丝绒", c1: "#A39BB0", c2: "#332E3F",
      tags: "gothic, black lace, candlelight, ornate interior, chiaroscuro, dark atmosphere, velvet, mysterious"
    },
    {
      id: "shirt", name: "极简白衬衫", desc: "白底、窗光与编辑感", c1: "#D5D9DA", c2: "#7C8589",
      tags: "white shirt, oversized shirt, bare legs, minimal, white background, soft window light, clean composition, editorial"
    },
    {
      id: "bath", name: "晨雾浴室", desc: "水汽、逆光与松弛感", c1: "#B4C7CB", c2: "#53686E",
      tags: "bathroom, steam, towel, wet hair, morning light, condensation, soft focus, intimate"
    },
    {
      id: "rooftop", name: "天台黄昏", desc: "金时刻、城市天际线", c1: "#A7B4C4", c2: "#5A6478",
      tags: "rooftop, dusk, golden hour, city skyline, wind, backlight, lens flare, cinematic"
    },
    {
      id: "study", name: "午后书房", desc: "旧书、百叶窗光斑与木桌", c1: "#C4B9A5", c2: "#6B6250",
      tags: "private study, afternoon sunlight, venetian blinds, wooden desk, old books, dust motes, quiet atmosphere, warm neutral tones"
    },
    {
      id: "velvet", name: "天鹅绒剧场", desc: "深红幕布、舞台灯与丝绒", c1: "#B98F8A", c2: "#4A2E33",
      tags: "theater stage, red velvet curtain, spotlight, art deco interior, dramatic shadow, rich red tones, velvet texture, theatrical atmosphere"
    },
    {
      id: "coast", name: "海崖晨雾", desc: "岩岸、海雾与亚麻衬衫", c1: "#A9BBC4", c2: "#4E6270",
      tags: "sea cliff, ocean mist, morning breeze, rocky shore, oversized linen shirt, overcast sky, cool blue tones, salt air"
    },
    {
      id: "bar", name: "深夜酒吧", desc: "琥珀灯光、酒杯与薄雾", c1: "#B99C74", c2: "#4A3826",
      tags: "cocktail bar, amber lighting, whiskey glass, smoke haze, bokeh, low key lighting, moody night, cinematic still"
    },
    {
      id: "greenhouse", name: "玻璃温室", desc: "藤蔓、磨砂玻璃与湿气", c1: "#A8B89C", c2: "#46543D",
      tags: "greenhouse, climbing vines, frosted glass, humid air, dappled light, botanical, muted green, film texture"
    },
    {
      id: "suite", name: "酒店套房", desc: "落地窗、丝绸床品与夜景", c1: "#B3B4C0", c2: "#42435A",
      tags: "hotel suite, floor to ceiling window, silk bedding, city night view, champagne, luxurious interior, soft ambient light, editorial photo"
    },
    {
      id: "cafe", name: "街角咖啡店", desc: "拉花、窗边座位与暖阳", c1: "#C9B69C", c2: "#6D5A45",
      tags: "corner cafe, latte art, window seat, afternoon sun, casual outfit, candid moment, warm beige tones, shallow depth of field"
    },
    {
      id: "cabin", name: "雪夜木屋", desc: "壁炉、羊毛毯与窗外大雪", c1: "#B7BEC3", c2: "#4C565C",
      tags: "snow cabin, wooden interior, fireplace, wool blanket, snowfall, cozy atmosphere, firelight, soft contrast"
    }
  ];
  const TAG_GROUPS = [
    {
      id: "scene", name: "场景", hint: "地点与环境",
      tags: [
        ["bedroom", "卧室"], ["hotel room", "酒店房间"], ["luxury bedroom", "豪华卧室"], ["hotel suite", "酒店套房"],
        ["luxurious bathroom", "豪华浴室"], ["marble bathroom", "大理石浴室"], ["walk-in closet", "步入式衣帽间"], ["dressing room", "更衣室"],
        ["poolside", "泳池边"], ["infinity pool", "无边泳池"], ["private beach", "私人海滩"], ["beach at dusk", "黄昏海滩"],
        ["lake dock", "湖畔码头"], ["lakeside", "湖畔"], ["rooftop", "天台"], ["balcony", "阳台"],
        ["garden terrace", "花园露台"], ["greenhouse", "玻璃温室"], ["sunroom", "阳光房"], ["forest clearing", "林间空地"],
        ["autumn forest", "秋日森林"], ["snow forest", "雪林"], ["snow cabin", "雪林木屋"], ["mountain lodge", "山间木屋"],
        ["desert oasis", "沙漠绿洲"], ["tropical villa", "热带别墅"], ["loft apartment", "阁楼公寓"], ["vintage apartment", "复古公寓"],
        ["library", "图书馆"], ["private library", "私人书房"], ["art studio", "画室"], ["photo studio", "摄影棚"],
        ["music room", "音乐室"], ["jazz bar", "爵士酒吧"], ["vintage cafe", "复古咖啡馆"], ["rainy street", "雨夜街道"],
        ["neon alley", "霓虹小巷"], ["subway station", "地铁站"], ["underground club", "地下俱乐部"], ["onsen", "温泉"],
        ["spa room", "水疗室"], ["wine cellar", "酒窖"], ["train compartment", "火车包厢"], ["observatory", "天文台"]
      ]
    },
    {
      id: "season", name: "季节", hint: "时令与自然",
      tags: [
        ["spring blossoms", "春日繁花"], ["cherry blossom petals", "樱花花瓣"], ["cherry blossom tree", "樱花树"], ["fresh green leaves", "新绿嫩叶"],
        ["spring rain", "春雨"], ["spring breeze", "春风"], ["spring garden", "春日花园"], ["spring picnic", "春日野餐"],
        ["hanami", "花见"], ["summer sunlight", "夏日阳光"], ["sun-drenched meadow", "阳光草地"], ["summer night", "夏夜"],
        ["summer heat haze", "夏日热浪"], ["summer festival", "夏日祭"], ["fireworks night", "烟花夜"], ["summer terrace", "夏日露台"],
        ["autumn leaves", "秋叶"], ["red maple leaves", "红枫叶"], ["autumn fog", "秋雾"], ["autumn park", "秋日公园"],
        ["harvest field", "丰收田野"], ["fallen leaves", "落叶"], ["winter morning", "冬日清晨"], ["first snow", "初雪"],
        ["snowfall", "落雪"], ["snow-covered pines", "雪松林"], ["frost on window", "窗上冰霜"], ["frozen lake", "冰封湖面"],
        ["melting snow", "融雪"], ["winter window", "冬日窗景"], ["winter street", "冬日街道"], ["winter resort", "冬日度假村"],
        ["rainy season", "梅雨季"], ["plum rain", "梅雨"], ["misty dawn", "雾霭清晨"], ["seasonal flowers", "时令花卉"],
        ["sunflower field", "向日葵花田"], ["lavender field", "薰衣草田"], ["dandelion seeds", "蒲公英种子"], ["fireflies", "萤火虫"]
      ]
    },
    {
      id: "interior", name: "室内", hint: "房间与陈设",
      tags: [
        ["cozy living room", "温馨客厅"], ["minimalist living room", "极简客厅"], ["mid-century interior", "中世纪现代室内"], ["art deco interior", "装饰艺术室内"],
        ["industrial loft", "工业风阁楼"], ["scandinavian interior", "北欧室内"], ["japanese tatami room", "日式榻榻米房"], ["traditional tea room", "传统茶室"],
        ["penthouse", "顶层公寓"], ["attic room", "阁楼房间"], ["reading nook", "阅读角"], ["fireplace lounge", "壁炉休息区"],
        ["kitchen island", "中岛厨房"], ["marble kitchen", "大理石厨房"], ["vanity table", "梳妆台"], ["boudoir interior", "闺房内景"],
        ["canopy bed", "帷幔床"], ["four-poster bed", "四柱床"], ["velvet sofa", "天鹅绒沙发"], ["leather armchair", "皮质扶手椅"],
        ["floor-to-ceiling window", "落地窗"], ["bay window", "飘窗"], ["spiral staircase", "旋转楼梯"], ["indoor garden", "室内花园"],
        ["home bar", "家庭吧台"], ["record room", "唱片室"], ["freestanding bathtub", "独立浴缸"], ["rain shower", "雨淋花洒"],
        ["candlelit room", "烛光房间"], ["chandelier", "水晶吊灯"], ["vintage wallpaper", "复古壁纸"], ["checkered floor", "棋盘格地板"]
      ]
    },
    {
      id: "light", name: "光线", hint: "决定氛围",
      tags: [
        ["soft window light", "柔和窗光"], ["morning light", "晨光"], ["golden hour", "黄金时刻"], ["sunset", "日落"],
        ["dusk", "黄昏"], ["blue hour", "蓝调时刻"], ["twilight", "暮光"], ["dawn light", "曙光"],
        ["overcast light", "阴天光"], ["harsh sunlight", "强烈日光"], ["dappled sunlight", "斑驳光影"], ["rim light", "轮廓光"],
        ["backlight", "逆光"], ["silhouette", "剪影"], ["candlelight", "烛光"], ["firelight", "火光"],
        ["warm lamplight", "暖色台灯"], ["neon glow", "霓虹光"], ["moonlit", "月光"], ["moonbeam", "月束"],
        ["studio softbox", "影棚柔光"], ["spotlight", "聚光灯"], ["strobe light", "闪光灯"], ["practical lights", "环境实光"],
        ["volumetric light", "体积光"], ["god rays", "丁达尔光"], ["light leaks", "漏光"], ["lens flare", "镜头光斑"],
        ["projected shadows", "投影"], ["chiaroscuro", "明暗对照"], ["low key", "低调布光"], ["high key", "高调布光"],
        ["rembrandt lighting", "伦勃朗光"], ["split lighting", "分割光"], ["colored gel lighting", "彩色滤光"], ["teal and orange lighting", "青橙光"],
        ["pastel lighting", "粉彩光"], ["soft glow", "柔光"], ["underwater light", "水下光"], ["uplighting", "底光"]
      ]
    },
    {
      id: "frame", name: "构图", hint: "景别与镜头",
      tags: [
        ["close-up", "特写"], ["extreme close-up", "极特写"], ["headshot", "头像"], ["upper body", "上半身"],
        ["waist-up", "半身像"], ["cowboy shot", "七分身"], ["full body", "全身"], ["full-length portrait", "全身肖像"],
        ["medium shot", "中景"], ["wide shot", "广角全景"], ["from above", "俯视"], ["high angle", "高角度"],
        ["from below", "仰视"], ["low angle", "低角度"], ["eye level", "平视"], ["from side", "侧面"],
        ["from behind", "背面"], ["profile", "侧脸"], ["three-quarter view", "四分之三侧"], ["over-the-shoulder", "过肩视角"],
        ["looking at viewer", "看向镜头"], ["looking back", "回望"], ["dutch angle", "斜角构图"], ["tilted frame", "倾斜画幅"],
        ["centered composition", "居中构图"], ["symmetrical composition", "对称构图"], ["rule of thirds", "三分构图"], ["diagonal composition", "对角构图"],
        ["negative space", "留白构图"], ["tight framing", "紧凑构图"], ["foreshortening", "透视压缩"], ["mirror reflection", "镜面反射"]
      ]
    },
    {
      id: "camera", name: "镜头", hint: "焦段与器材",
      tags: [
        ["85mm lens", "85mm 镜头"], ["50mm lens", "50mm 镜头"], ["35mm lens", "35mm 镜头"], ["24mm lens", "24mm 镜头"],
        ["135mm lens", "135mm 镜头"], ["anamorphic lens", "变形宽银幕"], ["fisheye lens", "鱼眼镜头"], ["tilt-shift lens", "移轴镜头"],
        ["medium format", "中画幅"], ["large format", "大画幅"], ["polaroid", "拍立得"], ["disposable camera", "一次性相机"],
        ["film camera", "胶片相机"], ["digital camera", "数码相机"], ["smartphone photo", "手机照片"], ["webcam", "网络摄像头"],
        ["security camera", "监控视角"], ["drone shot", "无人机视角"], ["aerial view", "航拍"], ["selfie", "自拍"],
        ["mirror selfie", "镜面自拍"], ["flash photography", "闪光灯摄影"], ["long exposure", "长曝光"], ["motion blur", "动态模糊"],
        ["cinestill 800t", "电影卷 800T"], ["ilford hp5", "伊尔福 HP5"], ["fujifilm", "富士胶片"]
      ]
    },
    {
      id: "style", name: "风格", hint: "质感与媒介",
      tags: [
        ["film grain", "胶片颗粒"], ["kodak portra 400", "柯达 Portra 400"], ["editorial fashion", "时尚大片"], ["editorial photography", "编辑摄影"],
        ["boudoir photography", "私房摄影"], ["glamour photography", "魅态人像"], ["fine art photography", "艺术摄影"], ["analog photography", "胶片摄影"],
        ["cinematic still", "电影剧照"], ["movie poster", "电影海报"], ["album cover", "专辑封面"], ["music video still", "MV 截图"],
        ["anime screencap", "动画截图"], ["anime coloring", "动画上色"], ["manga", "漫画"], ["comic book", "美漫"],
        ["watercolor", "水彩"], ["oil painting", "油画"], ["ink illustration", "水墨插画"], ["art nouveau", "新艺术风格"],
        ["art deco", "装饰艺术"], ["baroque", "巴洛克"], ["rococo", "洛可可"], ["impressionism", "印象派"],
        ["surrealism", "超现实"], ["minimalism", "极简主义"], ["vaporwave", "蒸汽波"], ["cyberpunk", "赛博朋克"],
        ["steampunk", "蒸汽朋克"], ["dark fantasy", "黑暗奇幻"], ["pastel goth", "粉彩哥特"], ["cottagecore", "田园风"],
        ["retro poster", "复古海报"], ["1990s magazine", "九十年代杂志"], ["photorealistic", "写实"], ["3d render", "3D 渲染"]
      ]
    },
    {
      id: "color", name: "色彩", hint: "调色与对比",
      tags: [
        ["warm tones", "暖色调"], ["cool tones", "冷色调"], ["muted colors", "低饱和"], ["vibrant colors", "鲜艳色彩"],
        ["pastel colors", "粉彩色"], ["sepia", "棕褐"], ["black and white", "黑白"], ["duotone", "双色调"],
        ["teal and orange", "青橙配色"], ["earth tones", "大地色"], ["jewel tones", "宝石色"], ["neon colors", "霓虹色"],
        ["monochromatic blue", "蓝单色"], ["soft pink palette", "柔粉"], ["cream and beige", "奶油米色"], ["deep reds", "深红"],
        ["emerald green", "祖母绿"], ["lavender palette", "薰衣草紫"], ["champagne palette", "香槟色"], ["high contrast", "高对比"],
        ["low contrast", "低对比"], ["desaturated", "去饱和"]
      ]
    },
    {
      id: "outfit", name: "服装", hint: "布料与轮廓",
      tags: [
        ["silk lingerie", "丝绸内衣"], ["lace lingerie", "蕾丝内衣"], ["sheer lingerie", "薄纱内衣"], ["lingerie set", "内衣套装"],
        ["black lace", "黑色蕾丝"], ["lace bodysuit", "蕾丝连体衣"], ["corset", "束身衣"], ["garter belt", "吊袜带"],
        ["stockings", "丝袜"], ["black stockings", "黑丝袜"], ["fishnet stockings", "渔网袜"], ["thigh-highs", "过膝袜"],
        ["ankle socks", "短袜"], ["oversized white shirt", "宽松白衬衫"], ["white shirt", "白衬衫"], ["sheer blouse", "薄纱衬衫"],
        ["silk robe", "丝绸长袍"], ["bathrobe", "浴袍"], ["knit sweater", "针织衫"], ["turtleneck", "高领毛衣"],
        ["cardigan", "开衫"], ["crop top", "短款上衣"], ["camisole", "吊带背心"], ["tank top", "背心"],
        ["tube top", "抹胸"], ["halter top", "挂脖上衣"], ["slip dress", "吊带睡裙"], ["satin dress", "缎面长裙"],
        ["sundress", "吊带裙"], ["summer dress", "夏裙"], ["backless dress", "露背裙"], ["off-shoulder dress", "露肩裙"],
        ["lace dress", "蕾丝裙"], ["sequin dress", "亮片裙"], ["velvet dress", "天鹅绒裙"], ["evening gown", "晚礼服"],
        ["cocktail dress", "鸡尾酒裙"], ["pencil skirt", "铅笔裙"], ["pleated skirt", "百褶裙"], ["denim shorts", "牛仔短裤"],
        ["high-waisted shorts", "高腰短裤"], ["leather pants", "皮裤"], ["leather jacket", "皮夹克"], ["trench coat", "风衣"],
        ["blazer", "西装外套"], ["office suit", "职业套装"], ["oversized hoodie", "宽松卫衣"], ["kimono", "和服"],
        ["yukata", "浴衣"], ["cheongsam", "旗袍"], ["bikini", "比基尼"], ["one-piece swimsuit", "连体泳衣"],
        ["high heels", "高跟鞋"], ["stiletto heels", "细高跟"], ["ankle boots", "短靴"], ["choker", "颈圈"],
        ["pearl necklace", "珍珠项链"], ["lace gloves", "蕾丝手套"], ["babydoll", "娃娃装"], ["chemise", "薄纱睡裙"],
        ["teddy lingerie", "连体情趣内衣"], ["latex dress", "乳胶裙"], ["mesh top", "网眼上衣"], ["sheer dress", "透视长裙"],
        ["deep v dress", "深 V 裙"], ["wrap dress", "裹身裙"], ["sweater dress", "针织连衣裙"], ["fur coat", "皮草大衣"],
        ["leather skirt", "皮裙"], ["tennis skirt", "网球裙"]
      ]
    },
    {
      id: "makeup", name: "妆容", hint: "眼唇与肤色",
      tags: [
        ["natural makeup", "自然妆容"], ["no-makeup look", "伪素颜"], ["dewy makeup", "水光妆"], ["matte makeup", "哑光妆"],
        ["smokey eyes", "烟熏眼妆"], ["winged eyeliner", "上扬眼线"], ["graphic eyeliner", "图形眼线"], ["cat eye makeup", "猫眼妆"],
        ["false eyelashes", "假睫毛"], ["mascara", "睫毛膏"], ["eyeshadow", "眼影"], ["shimmer eyeshadow", "珠光眼影"],
        ["glitter eyeshadow", "亮片眼影"], ["blush", "腮红"], ["rosy cheeks", "玫瑰色脸颊"], ["contoured cheeks", "修容脸颊"],
        ["highlighter", "高光"], ["bronzer", "古铜粉"], ["lip tint", "唇染"], ["matte lips", "哑光唇"],
        ["ombre lips", "渐变唇"], ["lip liner", "唇线"], ["nude makeup", "裸色妆"], ["gothic makeup", "哥特妆"],
        ["pastel makeup", "粉彩妆"], ["korean makeup", "韩系妆容"], ["japanese makeup", "日系妆容"], ["editorial makeup", "杂志妆容"],
        ["stage makeup", "舞台妆"], ["festival makeup", "节日妆容"], ["face gems", "面部宝石"], ["glitter freckles", "亮片雀斑"]
      ]
    },
    {
      id: "accessory", name: "配饰", hint: "首饰与帽子",
      tags: [
        ["gold necklace", "金项链"], ["silver necklace", "银项链"], ["pendant necklace", "吊坠项链"], ["layered necklaces", "叠戴项链"],
        ["hoop earrings", "圈形耳环"], ["drop earrings", "垂坠耳环"], ["stud earrings", "耳钉"], ["bracelet", "手链"],
        ["bangle", "手镯"], ["anklet", "脚链"], ["rings", "戒指"], ["signet ring", "印章戒指"],
        ["hairpin", "发簪"], ["hair clip", "发夹"], ["hair ribbon", "发带"], ["headband", "头箍"],
        ["beret", "贝雷帽"], ["fedora", "软呢帽"], ["wide-brim hat", "宽檐帽"], ["sun hat", "遮阳帽"],
        ["bucket hat", "渔夫帽"], ["beanie", "毛线帽"], ["veil", "面纱"], ["fascinator", "礼帽头饰"],
        ["tiara", "冠冕"], ["crown", "王冠"], ["hair scarf", "发巾"], ["silk scarf", "丝巾"],
        ["sunglasses", "太阳镜"], ["round glasses", "圆框眼镜"], ["opera gloves", "长手套"], ["leather gloves", "皮手套"],
        ["waist belt", "腰带"], ["suspenders", "背带"], ["body chain", "身体链"], ["brooch", "胸针"],
        ["cufflinks", "袖扣"], ["nose ring", "鼻环"], ["armlet", "臂环"], ["flower crown", "花冠"]
      ]
    },
    {
      id: "expression", name: "表情", hint: "眼神与神态",
      tags: [
        ["smile", "微笑"], ["soft smile", "浅笑"], ["gentle smile", "温柔微笑"], ["confident smile", "自信微笑"],
        ["playful smile", "俏皮微笑"], ["smirk", "得意笑"], ["laughing", "大笑"], ["pout", "嘟嘴"],
        ["parted lips", "微启双唇"], ["open mouth", "张嘴"], ["biting lip", "咬唇"], ["tongue out", "吐舌"],
        ["closed eyes", "闭眼"], ["half-closed eyes", "半闭眼"], ["wide eyes", "睁大眼"], ["wink", "眨眼"],
        ["playful wink", "俏皮眨眼"], ["blushing", "脸红"], ["heavy blush", "脸红耳赤"], ["teary eyes", "泪眼"],
        ["looking away", "移开视线"], ["looking up", "向上看"], ["looking down", "向下看"], ["side glance", "侧瞥"],
        ["eye contact", "眼神交流"], ["raised eyebrow", "挑眉"], ["furrowed brow", "皱眉"], ["calm expression", "平静神情"],
        ["sultry expression", "撩人神情"], ["longing gaze", "渴望目光"], ["sleepy", "困倦"], ["surprised", "惊讶"],
        ["serious", "严肃"]
      ]
    },
    {
      id: "pose", name: "姿势", hint: "身体与动作",
      tags: [
        ["standing", "站立"], ["sitting", "坐姿"], ["sitting on bed", "坐在床边"], ["sitting on floor", "坐在地上"],
        ["sitting on windowsill", "坐在窗台"], ["cross-legged", "盘腿"], ["legs crossed", "跷腿"], ["kneeling", "跪姿"],
        ["kneeling on bed", "跪在床上"], ["lying on bed", "躺在床上"], ["lying on stomach", "趴卧"], ["lying on back", "仰卧"],
        ["reclining", "斜倚"], ["side sitting", "侧坐"], ["leaning against wall", "靠墙"], ["leaning forward", "前倾"],
        ["arching back", "弓背"], ["stretching", "伸展"], ["stretching arms", "伸展手臂"], ["arms above head", "双手举过头"],
        ["arms crossed", "双臂交叉"], ["hands behind back", "双手背后"], ["hand on hip", "手扶腰"], ["hand in hair", "手抚头发"],
        ["touching face", "手触脸颊"], ["covering mouth", "捂嘴"], ["hugging knees", "抱膝"], ["hugging pillow", "抱枕"],
        ["resting chin on hand", "托腮"], ["over shoulder look", "回眸"], ["walking", "行走"], ["walking away", "走远"],
        ["dancing", "跳舞"], ["spinning", "旋转"], ["reading", "阅读"], ["holding cup", "拿杯子"],
        ["holding book", "拿书"], ["back to viewer", "背对镜头"], ["yoga pose", "瑜伽姿势"], ["on all fours", "四肢着地"],
        ["lying on side", "侧卧"], ["kneeling on floor", "跪在地上"], ["sitting on lap", "坐在腿上"], ["bending backward", "后仰"],
        ["legs up", "抬腿"], ["tiptoe", "踮脚"], ["stretching legs", "伸展双腿"]
      ]
    },
    {
      id: "mood", name: "氛围", hint: "情绪与气质",
      tags: [
        ["confident", "自信"], ["playful", "俏皮"], ["seductive gaze", "诱惑眼神"], ["contemplative", "沉思"],
        ["relaxed", "放松"], ["shy", "害羞"], ["elegant", "优雅"], ["intimate atmosphere", "亲密氛围"],
        ["dreamy", "梦幻"], ["mysterious", "神秘"], ["melancholic", "忧郁"], ["cheerful", "开朗"],
        ["aloof", "冷淡"], ["tender", "温柔"], ["mischievous", "顽皮"], ["serene", "宁静"],
        ["romantic", "浪漫"], ["sensual", "感官"], ["ethereal", "空灵"], ["nostalgic", "怀旧"],
        ["peaceful", "平和"], ["tense", "紧张"], ["luxurious", "奢华"], ["cozy", "温馨"],
        ["wild", "野性"], ["carefree", "无忧"], ["lonely", "孤独"], ["hopeful", "希望"],
        ["bittersweet", "苦甜"], ["euphoric", "愉悦"], ["languid", "慵懒"], ["smoldering", "炽热"]
      ]
    },
    {
      id: "subject", name: "人物", hint: " ",
      tags: [
        ["1girl", "单人女性"], ["1boy", "单人男性"], ["solo", "单人"], ["adult", "成年"], ["couple", "情侣"],
        ["couple", "情侣"], ["long hair", "长发"], ["short hair", "短发"], ["blonde hair", "金发"],
        ["black hair", "黑发"], ["red hair", "红发"], ["brown hair", "棕发"], ["silver hair", "银发"],
        ["pink hair", "粉发"], ["purple hair", "紫发"], ["ombre hair", "渐变发"], ["wavy hair", "卷发"],
        ["straight hair", "直发"], ["ponytail", "马尾"], ["twin tails", "双马尾"], ["braided hair", "编发"],
        ["messy bun", "凌乱丸子头"], ["updo", "盘发"], ["bob cut", "波波头"], ["pixie cut", "精灵短发"],
        ["undercut", "侧剃"], ["freckles", "雀斑"], ["dimples", "酒窝"], ["green eyes", "绿眼"],
        ["blue eyes", "蓝眼"], ["brown eyes", "棕眼"], ["hazel eyes", "榛色眼"], ["heterochromia", "异色瞳"],
        ["red lipstick", "红唇"], ["eyeliner", "眼线"], ["manicured nails", "美甲"], ["tattoo", "纹身"],
        ["piercings", "穿孔饰品"], ["earrings", "耳环"], ["glasses", "眼镜"], ["muscular", "肌肉线条"],
        ["athletic build", "运动体型"], ["curvy", "丰腴曲线"], ["slender", "纤细"], ["plus-size", "丰腴身材"],
        ["pale skin", "白皙肌肤"], ["tan skin", "小麦肤色"], ["dark skin", "深色肌肤"]
      ]
    },
    {
      id: "texture", name: "质感", hint: "细节与材质",
      tags: [
        ["satin fabric", "缎面质感"], ["silk sheets", "丝绸床单"], ["lace trim", "蕾丝镶边"], ["velvet texture", "天鹅绒质感"],
        ["sheer fabric", "薄纱"], ["wet hair", "湿发"], ["glossy lips", "水润双唇"], ["soft makeup", "柔和妆容"],
        ["dewy skin", "水光肌"], ["fine details", "精细细节"], ["soft shadows", "柔和阴影"], ["subtle grain", "细腻颗粒"],
        ["glossy skin", "光泽肌肤"], ["matte skin", "哑光肌肤"], ["wet skin", "湿润肌肤"], ["flushed skin", "泛红肌肤"],
        ["soft skin", "柔嫩肌肤"], ["detailed skin", "细腻皮肤"], ["skin texture", "皮肤纹理"], ["sweat droplet", "汗珠"],
        ["water droplets", "水珠"], ["oiled skin", "油亮肌肤"], ["lace texture", "蕾丝纹理"], ["knit texture", "针织纹理"],
        ["leather texture", "皮革纹理"], ["metal reflections", "金属反光"], ["glass reflections", "玻璃反光"], ["wet fabric", "湿衣料"],
        ["wrinkled sheets", "褶皱床单"], ["dust motes", "浮尘"], ["film halation", "胶片光晕"], ["chromatic aberration", "色差"],
        ["soft focus", "柔焦"], ["subsurface scattering", "次表面散射"], ["embroidered detail", "刺绣细节"]
      ]
    },
    {
      id: "effect", name: "特效", hint: "光效与粒子",
      tags: [
        ["bokeh", "景深光斑"], ["shallow depth of field", "浅景深"], ["double exposure", "双重曝光"], ["light painting", "光绘"],
        ["prism flare", "棱镜光斑"], ["rainbow flare", "彩虹光晕"], ["soft haze", "柔雾"], ["morning mist", "晨雾"],
        ["reflected light", "反射光"], ["bloom", "泛光"], ["vignette", "暗角"], ["film burn", "胶片烧灼"],
        ["floating embers", "飘浮余烬"], ["sparkles", "闪烁光点"], ["floating petals", "飘落花瓣"], ["rain on window", "窗上雨痕"],
        ["smoke", "烟雾"], ["ink in water", "水中墨"], ["water ripple", "水波涟漪"], ["caustics", "焦散光纹"],
        ["holographic sheen", "全息光泽"], ["iridescent glow", "虹彩光晕"], ["motion trails", "运动拖影"], ["speed lines", "速度线"],
        ["soft light streaks", "柔光条纹"], ["lens smudge", "镜头污渍"], ["puddle reflection", "水洼倒影"], ["powder burst", "粉末飞散"],
        ["paint splatter", "颜料飞溅"], ["glitter fall", "亮片飘落"], ["star filter", "星芒滤镜"], ["light bleed", "光渗"]
      ]
    },
    {
      id: "props", name: "道具", hint: "手里的物件",
      tags: [
        ["wine glass", "酒杯"], ["champagne flute", "香槟杯"], ["coffee cup", "咖啡杯"], ["teacup", "茶杯"],
        ["book", "书"], ["magazine", "杂志"], ["vinyl record", "黑胶唱片"], ["guitar", "吉他"],
        ["piano", "钢琴"], ["flowers", "花束"], ["rose petals", "玫瑰花瓣"], ["candle", "蜡烛"],
        ["incense smoke", "线香烟"], ["silk ribbon", "丝带"], ["hand mirror", "手持镜"], ["perfume bottle", "香水瓶"],
        ["jewelry box", "首饰盒"], ["fur blanket", "毛毯"], ["lace fan", "蕾丝折扇"], ["parasol", "阳伞"],
        ["umbrella", "雨伞"], ["lantern", "灯笼"], ["cigarette", "香烟"], ["camera", "相机"],
        ["phone", "手机"], ["headphones", "耳机"], ["mirror", "镜子"], ["whiskey glass", "威士忌杯"],
        ["cocktail glass", "鸡尾酒杯"], ["iced coffee", "冰咖啡"], ["cigarette holder", "烟嘴"], ["pocket watch", "怀表"],
        ["polaroid photo", "拍立得照片"], ["love letter", "情书"], ["single rose", "单支玫瑰"]
      ]
    },
    {
      id: "adult", name: "成人向", hint: "克制使用",
      tags: [
        ["lingerie", "内衣"], ["bare shoulders", "露肩"], ["cleavage", "事业线"], ["topless", "上身裸露"],
        ["nude", "全裸"], ["suggestive pose", "暗示性姿态"], ["strap slip", "肩带滑落"], ["bare back", "裸背"],
        ["see-through", "透视薄纱"], ["bedroom eyes", "迷离眼神"], ["provocative pose", "挑逗姿势"], ["thigh strap", "腿环"],
        ["harness", "束带"], ["collar", "项圈"], ["blindfold", "眼罩"], ["handcuffs", "手铐"],
        ["ropes", "绳索"], ["dominatrix", "女支配者"], ["submissive", "顺从"], ["roleplay", "角色扮演"],
        ["striptease", "脱衣舞"], ["lap dance", "膝上舞"], ["erotic", "情色"], ["sensual touch", "性感触碰"],
        ["self touch", "自我抚摸"], ["spread legs", "张开双腿"], ["presenting", "展示身体"], ["nipple slip", "露点"],
        ["undressing", "脱衣"], ["wet shirt", "湿衬衫"], ["afterglow", "余韵"], ["bare breasts", "裸露双乳"],
        ["nipples", "乳头"], ["areola", "乳晕"], ["bare ass", "裸露臀部"], ["bare thighs", "裸露大腿"],
        ["thigh gap", "大腿缝"], ["midriff", "露腰"], ["underboob", "下乳"], ["sideboob", "侧乳"],
        ["clothing aside", "衣物拨开"], ["exposed chest", "敞开胸口"], ["sweaty body", "汗湿身体"]
      ]
    }
  ];
  const NEGATIVE_TAG_GROUPS = [
    {
      id: "quality", name: "画质", hint: "低清与噪点",
      tags: [
        ["bad quality", "低质量"], ["worst quality", "最差质量"], ["low quality", "劣质"], ["normal quality", "普通质量"],
        ["lowres", "低分辨率"], ["blurry", "模糊"], ["pixelated", "像素化"], ["jpeg artifacts", "JPEG 伪影"],
        ["compression artifacts", "压缩伪影"], ["noise", "噪点"], ["grainy", "颗粒过重"], ["oversaturated", "过饱和"],
        ["undersaturated", "欠饱和"], ["oversharpened", "过度锐化"], ["flat lighting", "平光"], ["dull colors", "色彩黯淡"],
        ["harsh shadows", "生硬阴影"], ["blown highlights", "高光过曝"], ["crushed blacks", "死黑"], ["color noise", "彩色噪点"],
        ["posterization", "色阶断层"], ["blurry details", "细节模糊"], ["inconsistent lighting", "光照不一致"], ["poorly lit", "光照不佳"],
        ["muddy colors", "色彩浑浊"], ["low dynamic range", "动态范围不足"]
      ]
    },
    {
      id: "detail", name: "细节", hint: "潦草与未完成",
      tags: [
        ["worst detail", "最差细节"], ["bad detail", "细节糟糕"], ["poorly drawn", "画工粗糙"], ["rough sketch", "粗糙草稿"],
        ["unfinished", "未完成"], ["messy lines", "线条凌乱"], ["sketch", "草稿"], ["flat color", "平涂"],
        ["simple shading", "简单阴影"], ["low contrast", "低对比"]
      ]
    },
    {
      id: "anatomy", name: "人体结构", hint: "手部与比例",
      tags: [
        ["bad anatomy", "错误解剖"], ["bad proportions", "比例失调"], ["deformed", "畸形"], ["disfigured", "毁容"],
        ["mutated hands", "畸形手"], ["bad hands", "手部崩坏"], ["extra digits", "多余手指"], ["fewer digits", "缺少手指"],
        ["missing fingers", "缺失手指"], ["extra fingers", "多余手指"], ["fused fingers", "手指粘连"], ["long fingers", "过长手指"],
        ["extra limbs", "多余肢体"], ["missing limbs", "缺失肢体"], ["extra arms", "多余手臂"], ["extra legs", "多余腿"],
        ["malformed limbs", "肢体畸形"], ["long neck", "过长脖子"], ["bad feet", "脚部崩坏"], ["twisted torso", "躯干扭曲"],
        ["broken spine", "脊椎错位"], ["dislocated joints", "关节错位"], ["extra torso", "多余躯干"], ["three legs", "三条腿"],
        ["three arms", "三条手臂"], ["merged bodies", "身体粘连"], ["conjoined limbs", "肢体融合"], ["duplicate body", "重复身体"],
        ["floating limbs", "漂浮肢体"], ["missing head", "缺头"]
      ]
    },
    {
      id: "face", name: "面部", hint: "五官与表情",
      tags: [
        ["deformed face", "面部畸形"], ["asymmetrical eyes", "双眼不对称"], ["cross-eyed", "斗鸡眼"], ["lazy eye", "弱视眼"],
        ["extra eyes", "多余眼睛"], ["bad teeth", "牙齿崩坏"], ["distorted mouth", "嘴部扭曲"], ["long face", "长脸"],
        ["bad nose", "鼻子崩坏"], ["blurry face", "面部模糊"], ["mutated face", "面部变异"], ["cloned face", "重复脸"],
        ["duplicate face", "双脸"], ["multiple faces", "多张脸"]
      ]
    },
    {
      id: "text", name: "文字水印", hint: "签名与界面",
      tags: [
        ["watermark", "水印"], ["signature", "签名"], ["text", "文字"], ["username", "用户名"],
        ["logo", "标志"], ["artist name", "画师名"], ["patreon username", "Patreon 账号"], ["twitter username", "推特账号"],
        ["web address", "网址"], ["ui", "界面元素"], ["border", "边框"], ["frame", "画框"],
        ["stamp", "印章"], ["speech bubble", "对话气泡"], ["caption", "字幕"], ["qr code", "二维码"]
      ]
    },
    {
      id: "censor", name: "审查遮挡", hint: "马赛克与打码",
      tags: [
        ["censor", "审查"], ["mosaic censoring", "马赛克"], ["bar censor", "黑条打码"], ["pixelated censoring", "像素打码"],
        ["steam censor", "雾气遮挡"], ["light censor", "光斑遮挡"], ["censored", "已打码"]
      ]
    },
    {
      id: "composition", name: "构图问题", hint: "裁切与杂乱",
      tags: [
        ["cropped", "被裁切"], ["out of frame", "出画"], ["cut off", "截断"], ["close crop", "裁切过紧"],
        ["bad perspective", "透视错误"], ["bad composition", "构图糟糕"], ["cluttered background", "背景杂乱"], ["busy background", "背景繁琐"],
        ["blurry background", "背景模糊"], ["tilted", "倾斜"], ["distorted perspective", "透视变形"], ["multiple views", "多视图"]
      ]
    },
    {
      id: "artifacts", name: "画面伪影", hint: "光晕与色差",
      tags: [
        ["artifacts", "伪影"], ["glitch", "故障感"], ["banding", "色带"], ["moire", "摩尔纹"],
        ["chromatic aberration", "色差"], ["lens distortion", "镜头畸变"], ["motion blur", "动态模糊"], ["ghosting", "重影"],
        ["halo", "光晕"], ["clipping", "高光溢出"], ["white edges", "白边"], ["color fringing", "彩边"]
      ]
    },
    {
      id: "style", name: "风格排除", hint: "按需启用",
      tags: [
        ["3d", "3D"], ["cgi", "CGI"], ["photorealistic", "照片写实"], ["realistic", "写实"],
        ["photo", "照片"], ["monochrome", "单色"], ["grayscale", "灰度"], ["sepia", "棕褐"],
        ["anime style", "动漫风"], ["cartoon", "卡通"], ["low poly", "低多边形"], ["clay render", "黏土渲染"],
        ["pixel art", "像素画"], ["comic style", "漫画风"], ["oil painting style", "油画风"], ["watercolor style", "水彩风"]
      ]
    },
    {
      id: "ai", name: "AI 感", hint: "塑料与失真",
      tags: [
        ["ai generated", "AI 生成"], ["ai artifacts", "AI 伪影"], ["ai face", "AI 脸"], ["plastic skin", "塑料皮肤"],
        ["waxy skin", "蜡感皮肤"], ["overly smooth skin", "过度磨皮"], ["airbrushed skin", "喷枪磨皮"], ["doll-like", "人偶感"],
        ["uncanny valley", "恐怖谷"], ["dead eyes", "无神眼"], ["lifeless expression", "呆滞表情"], ["generic face", "大众脸"],
        ["rendered look", "渲染感"], ["perfect symmetry", "过度对称"], ["fake bokeh", "假虚化"], ["denoised skin", "过度降噪"]
      ]
    },
    {
      id: "clothing", name: "衣物问题", hint: "穿模与褶皱",
      tags: [
        ["clothing artifacts", "衣物伪影"], ["merged clothing", "衣物融合"], ["floating clothes", "衣物漂浮"], ["wrong fabric", "材质错误"],
        ["clothing clipping", "衣物穿模"], ["extra sleeves", "多余袖子"], ["impossible folds", "不合理褶皱"], ["mismatched shoes", "鞋子不成对"],
        ["missing straps", "肩带缺失"], ["stiff fabric", "布料僵硬"], ["accessory clutter", "配饰杂乱"], ["ill-fitting clothes", "不合身衣物"]
      ]
    }
  ];
  const ICONS = {
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
    dice: '<rect width="18" height="18" x="3" y="3" rx="3"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    bookmarkPlus: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="3" fill="currentColor" stroke="none"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    imagePlus: '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><line x1="16" x2="22" y1="5" y2="5"/><line x1="19" x2="19" y1="2" y2="8"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    star: '<path d="m12 2.6 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.62l-5.88 3.09 1.12-6.55L2.48 9.52l6.58-.96Z"/>',
    starFilled: '<path d="m12 2.6 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.62l-5.88 3.09 1.12-6.55L2.48 9.52l6.58-.96Z" fill="currentColor" stroke="none"/>',
    checks: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
    gallery: '<rect width="18" height="18" x="3" y="3" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-4.5-4.5L6 21"/><path d="M15.5 3H21v5.5"/>',
    upscale: '<path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"/><path d="M3 16.2V21m0 0h4.8M3 21l6-6"/><path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"/><path d="M3 7.8V3m0 0h4.8M3 3l6 6"/>',
    frame: '<path d="M22 6H2"/><path d="M22 18H2"/><path d="M6 2v20"/><path d="M18 2v20"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'
  };
  const LORA_ORDER = [
    "krea2_darkbrush",
    "krea2_dotmatrix",
    "krea2_kidsdrawing",
    "krea2_neondrip",
    "krea2_rainywindow",
    "krea2_retroanime",
    "krea2_softwatercolor",
    "krea2_sunsetblur",
    "krea2_vintagetarot",
    "krea2_realism",
    "krea2_luminous-anime-film",
    "krea2_cel-shaded-daytime-anime",
    "krea2_flat-cel-anime",
    "krea2_neon-cyberpunk-anime",
    "krea2_airy-anime-watercolor",
    "krea2_monochrome-anime-linework",
    "krea2_muted-anime-everyday",
    "krea2_bold-inked-anime-realism",
    "krea2_ghibli_fortnox",
    "krea2_celdepth_25d",
    "krea2_semi_thick_paint",
    "krea2_aquarelle",
    "krea2_manga_ink",
    "krea2_retro_akira",
    "krea2_arcane",
    "krea2_persona5",
    "krea2_jujutsu",
    "krea2_demon_slayer",
    "krea2_frieren",
    "krea2_honkai",
    "krea2_yoneyama_mai",
    "krea2_wlop",
    "krea2_guweiz",
    "krea2_kantoku",
    "krea2_anmi",
    "krea2_murata",
    "krea2_rella",
    "krea2_mika_pikazo",
    "krea2_fuzichoco",
    "krea2_loish",
    "krea2_kuvshinov",
    "krea2_huke",
    "krea2_loundraw",
    "krea2_clear_anime",
    "krea2_neon_syndicate",
    "krea2_retro_screencap",
    "krea2_painterly_game",
    "krea2_prismatica",
    "krea2_evan_cagle",
    "krea2_cinematic_layout",
    "krea2_rembrandt_light",
    "krea2_rim_light",
    "krea2_bioluminescent",
    "krea2_neon_bokeh",
    "krea2_cyberpunk_anime",
    "krea2_blue_archive",
    "krea2_retro_scifi_90s",
    "krea2_inkriot",
    "krea2_sumi_e",
    "krea2_carefull_style",
    "krea2_dark_art",
    "krea2_dark_synth",
    "krea2_neon_cyberpunk",
    "krea2_90s_aesthetic",
    "krea2_urasawa_manga",
    "krea2_3xperiment",
    "krea2_onitokyo",
    "krea2_expressions",
    "krea2_psx",
    "krea2_poster_graphics",
    "krea2_chibi_animal",
    "krea2_ghibli_background",
    "sdxl_harrlogos_text",
    "sdxl_texta_text",
    "krea2_textfusion_refusal",
    "zimage_comic_book_page",
    "anima_moriimee_gothic",
    "anima_rimix",
    "anima_anime_flat",
    "anima_anime_in_real",
    "anima_takeda_hiromitsu",
    "anima_yoneyama_mai",
    "anima_flatline",
    "anima_90s_melancholy",
    "krea2_blue_archive_style",
    "anima_char_miku",
    "anima_char_marin",
    "anima_char_kallen",
    "anima_char_pekomama",
    "krea2_char_zyloo_bundle",
    "krea2_char_anna_yamada",
    "krea2_char_genshin_cosplay",
    "zimage_char_miku",
    "zimage_char_sheet_helper",
    "zimage_hands_xl",
    "zimage_detailed_perfection",
    "krea2_style_yarn",
    "moss_style_anime_flat",
    "moss_artist_afrobull",
    "zimage_hands",
    "zimage_detail_perfection",
    "zimage_skin_texture",
    "zimage_detail_slider",
    "zimage_nsfw_master",
    "zimage_mystic_xxx",
    "zimage_pose_pack",
    "zimage_moriimee_gothic",
    "zimage_anime_flat",
    "zimage_cyberpunk_anime",
    "zimage_afrobull",
    "zimage_zankuro",
    "zimage_dart",
    "zimage_wlop_impressions",
    "krea2_environment_art",
    "krea2_rooms_background",
    "krea2_bg_detail_enhancer",
    "krea2_cyberpunk_arch",
    "krea2_forests",
    "krea2_composition_enhancer",
    "krea2_tilt_slider",
    "krea2_zoom_slider",
    "krea2_first_person",
    "krea2_centaur",
    "krea2_detail_slider",
    "krea2_weight_slider",
    "krea2_height_slider",
    "krea2_age_slider",
    "krea2_nsfw_v4",
    "krea2_nsfw_v5",
    "krea2_hentai_studio",
    "krea2_riding_scene",
    "krea2_aio_nsfw",
    "krea2_herpov_v2",
    "krea2_dbx_uncensored",
    "krea2_nsfw_fix",
    "krea2_nsfw_slider",
    "krea2_style_reference",
    "anima_turbo_v0.2",
    "anima_hentai_comic",
    "anima_female_pov",
    "anima_giant_dom",
    "anima_blueprint",
    "moss_image_sft_8steps_dmd_lora",
    "moss_hires_test_v07",
    "moss_beauty",
    "moss_gouache",
    "moss_impressionism",
    "moss_pixelart_16x16",
    "moss_camera_angle",
    "moss_taur",
    "moss_spider_legs",
    "moss_detailer",
    "moss_quality_slider",
    "moss_quality_boost",
    "moss_better_nudes",
    "moss_mystic_xxx",
    "moss_gta_style",
    "moss_sakuga",
    "moss_lineart",
    "moss_90s_anime",
    "moss_anime_flat",
    "moss_anime_superflat",
    "moss_anime_retrocel90",
    "moss_anime_bastyle",
    "moss_manga_sketch",
    "moss_ghibli",
    "moss_anime_screencap",
    "moss_anime_chibi",
    "moss_arcane",
    "moss_frieren",
    "moss_chainsaw_man",
    "moss_yoneyama_mai",
    "moss_mochizuki_kei",
    "moss_mochizuki_kei_r32",
    "moss_kantoku",
    "moss_fuzichoco",
    "moss_guweiz",
    "moss_wlop",
    "moss_murata",
    "MOSS-Image-Anime-LoRA-ComfyUI",
    "MOSS-Image-NSFW-Uncensored-LoRA-ComfyUI",
    "moss_image_edit_lora_rank_64_bf16",
    "moss_image_color_depth_control",
    "anima29b-turbolora1.1",
    "anima_turbo_4step_v3",
    "anima_highres_boost",
    "anima_rl_v0.1",
    "anima_greg_rutkowski",
    "style_diives",
    "style_eudetenis",
    "adult_body_weight_slider",
    "adult_nipple_size_slider",
    "adult_fitbutt",
    "adult_pose_spread_legs"
  ];
  const LORA_LIBRARY = {
    // ---- Krea 2 官方风格 LoRA（9 个，docs.comfy.org 给的触发词与推荐强度全为 1.0）
    // 官方 t2i 模板里 LoraLoaderModelOnly 的出厂值是 0.8，实测 0.8 风格偏淡、
    // 1.0 才到位，故默认取 1.0；叠两三个时再各自降到 0.6–0.8。
    "krea2_darkbrush": {
      title: "Krea · 单色水墨",
      weight: 1.3,
      triggers: "monochrome ink wash style",
      desc: "官方风格：黑白水墨渲染，笔触晕染、留白重。触发词 monochrome ink wash style；建议 1.3——int8 底模配 8 步蒸馏时 1.0 明显偏淡，实测 1.5 才等同官方 1.0 的观感；叠多个风格时各降到 0.9。"
    },
    "krea2_dotmatrix": {
      title: "Krea · 单色点描",
      weight: 1.3,
      triggers: "monochrome stippling style",
      desc: "官方风格：网点/点描质感，印刷感强、边缘靠点构成。触发词 monochrome stippling style；建议 1.3——int8 底模配 8 步蒸馏时 1.0 偏淡，实测 1.5 才等同官方 1.0 的观感。"
    },
    "krea2_kidsdrawing": {
      title: "Krea · 稚拙手绘",
      weight: 1.3,
      triggers: "naive expressive sketch style",
      desc: "官方风格：儿童画式的稚拙线条与色块，故意的不精确。触发词 naive expressive sketch style；建议 1.3（int8 + 8 步下 1.0 偏淡），画人物易走形属正常。"
    },
    "krea2_neondrip": {
      title: "Krea · 霓虹滴落",
      weight: 1.3,
      triggers: "textured abstract style",
      desc: "官方风格：厚涂抽象 + 霓虹色渗流，质感强烈。触发词 textured abstract style；建议 1.3（int8 + 8 步下 1.0 偏淡），主体容易被吞，适合做背景或氛围图。"
    },
    "krea2_rainywindow": {
      title: "Krea · 雨窗",
      weight: 1.3,
      triggers: "rainy window style",
      desc: "官方风格：隔着一层雨玻璃看世界，水痕、失焦、冷调。触发词 rainy window style；建议 1.3（int8 + 8 步下 1.0 偏淡），人像会得到很自然的「窗内偷拍」感。"
    },
    "krea2_retroanime": {
      title: "Krea · 紫调复古动画",
      weight: 1.3,
      triggers: "purple retro anime style",
      desc: "官方风格：80–90 年代赛璐璐动画，紫青主色、颗粒与轻微色偏。触发词 purple retro anime style；建议 1.3——int8 底模配 8 步蒸馏时 1.0 偏淡，实测 1.5 才等同官方 1.0 的观感。"
    },
    "krea2_softwatercolor": {
      title: "Krea · 装饰水彩",
      weight: 1.3,
      triggers: "art deco watercolor style",
      desc: "官方风格：装饰艺术 + 水彩，几何秩序与柔和晕染并存。触发词 art deco watercolor style；建议 1.3——int8 底模配 8 步蒸馏时 1.0 偏淡，实测 1.5 才等同官方 1.0 的观感。"
    },
    "krea2_sunsetblur": {
      title: "Krea · 空灵动态模糊",
      weight: 1.3,
      triggers: "ethereal motion blur style",
      desc: "官方风格：强动态模糊 + 暖光溢出，适合氛围与情绪片。触发词 ethereal motion blur style；建议 1.3（int8 + 8 步下 1.0 偏淡），主体轮廓会被拖开。"
    },
    "krea2_vintagetarot": {
      title: "Krea · 复古塔罗",
      weight: 1.3,
      triggers: "vintage tarot style",
      desc: "官方风格：老塔罗牌版画，粗线、有限色板、做旧纸感。触发词 vintage tarot style；建议 1.3（int8 + 8 步下 1.0 偏淡），很适合出人物卡面。"
    },
    "krea2_style_reference": {
      title: "Krea · 风格参考",
      weight: 1,
      desc: "官方风格参考 LoRA，需配专用工作流（参考图 → TextEncodeQwenImageEditPlus + ModelSamplingFlux 1.15/0.5 + SamplerCustomAdvanced）。普通文生图挂上无效，仅做占位。"
    },
    // ---- fal 训练的 Krea 2 二次元系列（ilkerzgi 移植，1600+ 风格里挑的 8 个）
    // 这批的触发词统一是「<风格名> anime style」，要放在提示词末尾；
    // 官方卡建议强度 1.0–1.25，这里默认 1.1（1.0 偏淡，1.25 开始过冲）。
    "krea2_realism": {
      title: "Krea · 写实增强",
      weight: 1,
      desc: "把 Krea 2 推向自然、生活化的真实摄影：皮肤细纹与毛孔、织物织纹、环境细节都更实，而且不需要写 photorealistic / 8k / DSLR 这类词。无触发词，8 步 CFG 1 下强度 1.0 即可；叠风格 LoRA 时降到 0.6–0.8。"
    },
    "krea2_luminous-anime-film": {
      title: "二次元 · 发光胶片",
      weight: 1.1,
      triggers: "luminous anime film style",
      desc: "剧场版动画胶片的通透感：柔光溢出、空气感强、色彩像透过滤镜。触发词 luminous anime film style；建议 1.1。"
    },
    "krea2_cel-shaded-daytime-anime": {
      title: "二次元 · 赛璐璐日间",
      weight: 1.1,
      triggers: "cel shaded daytime anime style",
      desc: "日间赛璐璐：硬边阴影、明亮实色、TV 动画质感。触发词 cel shaded daytime anime style；建议 1.1。"
    },
    "krea2_flat-cel-anime": {
      title: "二次元 · 平涂赛璐璐",
      weight: 1.1,
      triggers: "flat cel anime style",
      desc: "极简平涂：大色块、几乎无渐变，绘本/海报感。触发词 flat cel anime style；建议 1.1，配简洁构图最出效果。"
    },
    "krea2_neon-cyberpunk-anime": {
      title: "二次元 · 霓虹赛博",
      weight: 1.1,
      triggers: "neon cyberpunk anime style",
      desc: "霓虹赛博朋克动画：品红青绿对撞、湿地面反光、夜景为主。触发词 neon cyberpunk anime style；建议 1.1。"
    },
    "krea2_airy-anime-watercolor": {
      title: "二次元 · 通脱水彩",
      weight: 1.1,
      triggers: "airy anime watercolor style",
      desc: "通透水彩动画：纸纹、晕染边缘、留白多，吉卜力系的轻量版。触发词 airy anime watercolor style；建议 1.1。"
    },
    "krea2_monochrome-anime-linework": {
      title: "二次元 · 单色线稿",
      weight: 1.1,
      triggers: "monochrome anime linework style",
      desc: "单色线稿：只有线没有色，接近漫画原稿或设定稿。触发词 monochrome anime linework style；建议 1.1。"
    },
    "krea2_muted-anime-everyday": {
      title: "二次元 · 低饱和日常",
      weight: 1.1,
      triggers: "muted anime everyday style",
      desc: "低饱和日常系：灰调、生活感、安静氛围，适合场景与静物。触发词 muted anime everyday style；建议 1.1。"
    },
    "krea2_bold-inked-anime-realism": {
      title: "二次元 · 粗墨线写实",
      weight: 1.1,
      triggers: "bold inked anime realism style",
      desc: "粗墨线 + 写实光影：漫画分镜的线条配真实材质，介于动画与实拍之间。触发词 bold inked anime realism style；建议 1.1。"
    },
    // ---- Krea 2 二次元画风追加（2026-11-15 第二批，Civitai 镜像）
    // 这 6 支补的是上一批 fal 系列没有的"质感方向"：吉卜力、2.5D、厚涂、水彩、黑白漫画、80s 剧场版。
    "krea2_ghibli_fortnox": {
      title: "Krea · 吉卜力（Fortnox）",
      weight: 1,
      desc: "吉卜力式背景美术：水彩天空、灰绿暖赭的克制配色、简笔圆脸，连人物带场景一起偏过去。无触发词；建议 0.9–1.1。禁用高饱和词（neon、vivid）否则立刻破功。"
    },
    "krea2_celdepth_25d": {
      title: "Krea · 2.5D 半写实赛璐璐",
      weight: 1,
      desc: "介于动画与实拍之间：赛璐璐的硬边界 + 真实的体积和材质疑感，接近现代日系游戏立绘。无触发词；建议 0.9–1.1，和「写实」类词同用容易两头不讨好。"
    },
    "krea2_semi_thick_paint": {
      title: "Krea · 半厚涂",
      weight: 1,
      desc: "半厚涂插画：笔触可见但不糊成油画，亮部有明确色块，接近游戏宣传图。无触发词；建议 0.9–1.1，配 rim light / 逆光关键词最能出效果。"
    },
    "krea2_aquarelle": {
      title: "Krea · 复古动画水彩",
      weight: 1,
      desc: "老动画的水彩背景技法：墨线打底、水色晕染、纸面留白，90 年代 OVA 的味道。无触发词；建议 0.9–1.1，适合风景与室内，人物细节会被水色带软。"
    },
    "krea2_manga_ink": {
      title: "Krea · 黑白漫画墨水",
      weight: 1,
      desc: "《死神》式的黑白漫画墨线：粗细分明的轮廓、大面积排线阴影、网点感。无触发词；建议 0.9–1.1，配 monochrome 更稳；出彩色会变成低饱和，属正常。"
    },
    "krea2_retro_akira": {
      title: "Krea · 80s 剧场版赛璐璐",
      weight: 1,
      desc: "80 年代剧场版动画质感（Akira 一脉）：高对比硬光、手绘机械细节、轻微胶片颗粒与色偏。无触发词；建议 0.9–1.1，配 wide shot / cityscape 很吃这套。"
    },
    // ---- 作品级画风（2026-11-16）：模仿具体动画/游戏的画面语言
    // 这类 LoRA 认的是"画面气质"不是某个角色，提示词里带上作品名更稳。
    "krea2_arcane": {
      title: "Krea · 双城之战",
      weight: 1,
      desc: "Arcane 的画面语言：油画底子上的粗笔触、硬边高光、冷蓝与洋红的对撞，工业装饰艺术的城市结构。无固定触发词，提示词写 Arcane style 更稳；建议 0.9–1.15。人物脸型会被拉向该作品的雕塑感。"
    },
    "krea2_persona5": {
      title: "Krea · 女神异闻录 5",
      weight: 1,
      desc: "P5 的高对比平面设计：纯红/黑/白三色、锋利剪影、丝网印刷加漫画网点、倾斜排版感。无触发词；建议 0.9–1.1。不适合写实场景，越平面越像。"
    },
    "krea2_jujutsu": {
      title: "Krea · 咒术回战",
      weight: 1,
      desc: "咒术回战的动画质感：粗黑轮廓、冷灰低饱和、咒力描边与飞溅线条，偏战斗构图。无触发词；建议 0.9–1.1，配 dynamic pose / action shot 最对味。"
    },
    "krea2_demon_slayer": {
      title: "Krea · 鬼灭·无限城",
      weight: 1,
      desc: "剧场版无限城的画面：浮世绘纹样、粒子化的呼吸特效、紫青夜光与强逆光。无触发词；建议 0.9–1.1，超过 1.2 容易整张变成特效糊。"
    },
    "krea2_frieren": {
      title: "Krea · 芙莉莲（动画截图）",
      weight: 1,
      desc: "芙莉莲式的 TV 动画截图：柔和渐变天空、低饱和奇幻配色、人物边缘干净、宽画幅感。无触发词；建议 0.9–1.1，适合风景与静景，动作戏会偏软。"
    },
    "krea2_honkai": {
      title: "Krea · 星穹铁道",
      weight: 1,
      desc: "接近官方立绘的 3D 渲染赛璐璐：发光材质、高精度金属与布料、干净的轮廓光。无触发词；建议 0.9–1.1，配 official art / 3d render 更稳。"
    },
    // ---- 画师画风（2026-11-16）：具体插画师的笔触习惯，不是作品风格
    // 和上一组"作品级画风"的区别：作品级模仿某部动画的画面语言；画师级模仿某个人的手。
    "krea2_yoneyama_mai": {
      title: "Krea · 米山舞",
      weight: 0.9,
      desc: "米山舞的笔触：利落的轮廓、青与红的高饱和撞色、逆光雨感、人物姿态带舞蹈性的张力。提示词里写 Yoneyama Mai 更稳；建议 0.8–1.0。偏插画海报感，写实场景会被拉平。"
    },

    "krea2_wlop": {
      title: "Krea · WLOP",
      weight: 0.9,
      desc: "WLOP 的半写实厚涂：强逆光边缘、冷蓝紫调、布料与金属的细腻反射、情绪化氛围。提示词写 WLOP；建议 0.8–1.0。人物脸部会被拉向他的标准美型。"
    },
    "krea2_guweiz": {
      title: "Krea · GUWEIZ",
      weight: 0.9,
      desc: "GUWEIZ 的写实插画：电影级布光、低饱和冷调、街头与室内实景感，人物像照片又比照片干净。提示词写 Guweiz；建议 0.8–1.0，配 cinematic lighting 更稳。"
    },
    "krea2_kantoku": {
      title: "Krea · カントク",
      weight: 0.9,
      desc: "カントク（监督）的柔光少女：粉彩通透皮肤、发丝高光、制服与日常场景，空气感强。提示词写 Kantoku；建议 0.8–1.0，过 1.1 会整张发白。"
    },
    "krea2_anmi": {
      title: "Krea · Anmi",
      weight: 0.9,
      desc: "Anmi 的清透画风：水彩与厚涂混合、明亮干净的对比、少女感强。提示词写 Anmi；建议 0.8–1.0，适合日常与服装展示。"
    },
    "krea2_murata": {
      title: "Krea · 村田蓮爾",
      weight: 0.9,
      desc: "村田蓮爾的复古未来主义：圆润厚重的轮廓、铬金属与旧皮革、飞行器与制服（Last Exile 一脉）。提示词写 Range Murata；建议 0.8–1.0，机械与人物同框最出彩。"
    },
    "krea2_rella": {
      title: "Krea · rella",
      weight: 0.9,
      desc: "rella 的画风：高透明感的光与色、玻璃与水面般的反射、细碎彩虹光斑、五官精致偏冷。提示词写 rella；建议 0.8–1.0。她的强项是光打在透明材质上的层次，配 glass、crystal、stained glass 最能出效果；写实场景会被拉成插画。"
    },
    // ---- Krea 2 背景 / 场景（同批 6 支）
    // 这组的用途是「把画面交给场景」：和人物 LoRA 同挂时，它是地基，权重别抢过主体。
    "krea2_ghibli_background": {
      title: "Krea · 吉卜力风景",
      weight: 0.9,
      desc: "只做背景/风景的吉卜力风：水彩云层、远山层次、暖绿与土黄。无触发词；建议 0.8–1.0。有人物时权重降到 0.6，否则人物会被背景一起吃成简笔。"
    },
    "krea2_environment_art": {
      title: "Krea · 环境概念图",
      weight: 0.9,
      desc: "游戏/影视的环境概念设计：大气透视、明确的前中后景、尺度感强。无触发词；建议 0.8–1.0，配 concept art、matte painting 强化。"
    },
    "krea2_rooms_background": {
      title: "Krea · 室内场景",
      weight: 0.9,
      desc: "室内空镜生成器（ROOMS 系列）：房间结构、家具摆放、窗光方向都更合理。无触发词；建议 0.8–1.0，写清房间类型（bedroom / classroom / lab）效果最好。"
    },
    "krea2_bg_detail_enhancer": {
      title: "Krea · 背景细节增强",
      weight: 0.7,
      desc: "不换风格，只往背景里补信息量（砖缝、管线、杂物、植被层次）。无触发词；建议 0.5–0.8，过高会让主体也跟着碎，适合放在最后一遍细化。"
    },
    "krea2_cyberpunk_arch": {
      title: "Krea · 赛博建筑",
      weight: 0.9,
      desc: "赛博朋克建筑体块：巨型结构、外露管线、霓虹反射在湿地面。无触发词；建议 0.8–1.0，配 night / rain / neon 三联最稳。"
    },
    "krea2_forests": {
      title: "Krea · 森林自然",
      weight: 0.9,
      desc: "森林与林地风景：树干层次、雾气、地表植被与光斑。无触发词；建议 0.8–1.0，配 morning fog、sunbeam 很出片。"
    },
    // ---- 画师补充（2026-11-16 第三批）
    "krea2_mika_pikazo": {
      title: "Krea · Mika Pikazo",
      weight: 0.9,
      desc: "高饱和撞色 + 荧光渐变 + 装饰性图案，V 家海报那种炸开的用色。提示词写 Mika Pikazo；建议 0.8–1.0。适合角色立绘与宣传图，写实场景会被拉成平面海报。"
    },
    "krea2_fuzichoco": {
      title: "Krea · 藤ちょこ",
      weight: 0.9,
      desc: "华丽和风：细密纹样、金箔与朱红、繁复的服饰层次。提示词写 Fuzichoco；建议 0.8–1.0。细节量很大，权重过高会让画面碎掉，配 detail slider 负值可以压一压。"
    },
    "krea2_loish": {
      title: "Krea · Loish",
      weight: 0.9,
      desc: "松弛的厚涂笔触 + 暖调粉橘 + 圆润造型，人物表情生动不拘谨。提示词写 Loish；建议 0.8–1.0。强项是角色速写感，不适合精密机械。"
    },
    "krea2_kuvshinov": {
      title: "Krea · Ilya Kuvshinov",
      weight: 0.9,
      desc: "清冷半写实：低饱和冷色、干净的大色块、电影感打光，人物偏冷淡气质。提示词写 Ilya Kuvshinov；建议 0.8–1.0。和「写实」类词同用会往照片靠。"
    },
    "krea2_huke": {
      title: "Krea · huke",
      weight: 0.9,
      desc: "忧郁工业动画：深色背景、发光机械、金属冷光与少女剪影（黑岩射手一脉）。提示词写 huke；建议 0.8–1.1。配 mechanical、glowing 很出效果。"
    },
    "krea2_loundraw": {
      title: "Krea · loundraw",
      weight: 0.9,
      desc: "透明青春感：大面积天空与逆光、清透的蓝白调、人物偏小、情绪留白。提示词写 loundraw；建议 0.8–1.0。适合风景与背影，面部细节会简化。"
    },
    // ---- 二次元画风补充（同批）
    "krea2_clear_anime": {
      title: "Krea · 清透赛璐璐",
      weight: 1,
      desc: "干净利落的 TV 动画赛璐璐：边界清晰、上色通透、无多余纹理，接近现代番剧截图。无触发词；建议 0.9–1.1。想要「作画感」而不是「插画感」时用这支。"
    },
    "krea2_neon_syndicate": {
      title: "Krea · 霓虹赛璐璐",
      weight: 1,
      desc: "赛璐璐 + 霓虹描边的插画风：强对比冷光、角色轮廓带发光边、城市夜景背景。无触发词；建议 0.9–1.1。适合科幻/赛博题材。"
    },
    "krea2_retro_screencap": {
      title: "Krea · 90s 动画截图",
      weight: 1,
      desc: "90 年代 TV 动画截图的质感：轻微色偏、胶片颗粒、赛璐璐上色偏薄。无触发词；建议 0.9–1.1。和「retro anime」同挂会重复，二选一。"
    },
    // ---- 光影 / 构图 / 电影感（2026-11-16 第四批）
    // 这组解决的是「画面平」：同一张构图，加一层光就有了纵深和情绪。
    "krea2_painterly_game": {
      title: "Krea · 厚涂游戏插画",
      weight: 0.9,
      desc: "游戏宣传图级别的厚涂：明确的主光源、饱和但不脏的中间调、材质分得清。无触发词；建议 0.8–1.0。想让画面「一眼是作品」而不是「AI 图」，这支最稳。"
    },
    "krea2_prismatica": {
      title: "Krea · 发光漫画插画",
      weight: 0.9,
      desc: "发光描边 + 棱镜色散 + 高饱和霓虹，接近现代日系插画海报。无触发词；建议 0.8–1.0。配 glowing、iridescent 会更强，超过 1.1 高光会爆。"
    },
    "krea2_evan_cagle": {
      title: "Krea · Evan Cagle",
      weight: 0.9,
      desc: "暗黑奇幻插画：强轮廓、大片暗部里透出一点暖光、造型带神话感。提示词写 Evan Cagle；建议 0.8–1.0。适合史诗与怪物题材。"
    },
    "krea2_cinematic_layout": {
      title: "Krea · 电影布局",
      weight: 0.9,
      desc: "电影镜头的空间安排：前中后景分层、主体偏规则三分、留白有目的。无触发词；建议 0.7–0.9。它是「构图纠正器」，不是风格，权重过高会让所有图长得一样。"
    },
    "krea2_rembrandt_light": {
      title: "Krea · 伦勃朗光",
      weight: 1,
      desc: "单侧主光 + 三角面光斑 + 深背景，古典肖像的打光方式。无触发词；建议 0.9–1.2。人像和半身最能出效果，大场景会显得太戏剧。"
    },
    "krea2_rim_light": {
      title: "Krea · 轮廓光",
      weight: 1,
      desc: "主体边缘一圈亮光把人和背景分开，影棚常用。无触发词；建议 0.9–1.2。深色背景 + 浅色主体时最惊艳，白底基本无效。"
    },
    "krea2_bioluminescent": {
      title: "Krea · 生物荧光",
      weight: 1,
      desc: "青蓝色自发光：皮肤下的微光、植物与水的冷光反射，奇幻氛围强。无触发词；建议 0.8–1.1。适合夜景与水下，白天场景会显得发青。"
    },
    "krea2_neon_bokeh": {
      title: "Krea · 霓虹光斑",
      weight: 1,
      desc: "大光圈虚化的霓虹散景：前景光斑、背景色块化的城市灯。无触发词；建议 0.8–1.1。它加的是「镜头感」，不是「亮度」，画面本身不一定会变亮。"
    },
    // ---- C 站高人气风格（2026-11-16 第五批，按下载量挑的）
    "krea2_cyberpunk_anime": {
      title: "Krea · 赛博动画",
      weight: 0.9,
      desc: "赛博朋克动画风：霓虹灯牌、湿地面反射、冷蓝与品红对撞，人物仍是动画比例。无触发词；建议 0.8–1.0。C 站同类里下载量最高的一支（45k），比纯提示词更稳。"
    },
    "krea2_blue_archive": {
      title: "Krea · 蔚蓝档案",
      weight: 0.9,
      desc: "BA 的美术口径：干净平涂、明亮高饱和、柔和边光、眼睛大而清透。无触发词；建议 0.8–1.0。V2 用 64 维重训过，比早期版本更像。"
    },
    "krea2_retro_scifi_90s": {
      title: "Krea · 90s 科幻动画",
      weight: 0.9,
      desc: "90 年代科幻 TV 动画：机械设定线条、有限色板、胶片感颗粒。触发词 retro_scifi_90s_anime_style；建议 0.8–1.0。配 spaceship、cockpit 很对味。"
    },
    "krea2_inkriot": {
      title: "Krea · Inkriot 墨线",
      weight: 1,
      desc: "手绘墨线 + 赛璐璐的混沌拼贴感：粗黑轮廓、脏污纹理、街头海报气质。无触发词；建议 0.9–1.1。适合做视觉冲击强的封面。"
    },
    "krea2_sumi_e": {
      title: "Krea · 禅意水墨",
      weight: 1,
      desc: "日式水墨（Sumi-e）：枯笔飞白、留白构图、单色浓淡，配一点朱红。无触发词；建议 0.9–1.1。适合风景与静物，人物细节会被笔触吃掉。"
    },
    "krea2_carefull_style": {
      title: "Krea · Carefull Style",
      weight: 0.9,
      desc: "作者自训练的个人画风：柔和粉彩、细腻笔触、少女感强，介于插画与动画之间。无触发词；建议 0.8–1.0。"
    },
    // ---- 社区作者的风格族（2026-11-16 第六批）
    // 这几支来自三个高产作者：zura_janai（90s 复古系）、tehalex86（实验向）、Yofaraway（漫画风）。
    "krea2_dark_art": {
      title: "Krea · 暗黑插画",
      weight: 0.9,
      desc: "低明度、厚涂质感、大片阴影里透一点冷光，情绪偏压抑。无触发词；建议 0.8–1.0。作者 zura_janai 的高人气件（C 站 24.7k 下载）。"
    },
    "krea2_dark_synth": {
      title: "Krea · 暗色合成波",
      weight: 0.9,
      desc: "暗调 + synthwave 电子光：紫粉渐变、扫描线、夜景霓虹反射。无触发词；建议 0.8–1.0。和「霓虹赛博」的区别是更暗更冷、更像 80s 电子封面。"
    },
    "krea2_neon_cyberpunk": {
      title: "Krea · 复古霓虹赛博",
      weight: 0.9,
      desc: "80 年代想象的赛博朋克：铬金属、品红青绿、雨夜街景。无触发词；建议 0.8–1.0。比现代赛博风更「复古海报」，适合做封面。"
    },
    "krea2_90s_aesthetic": {
      title: "Krea · 90s 动画基调",
      weight: 0.9,
      desc: "90 年代 TV 动画的整体基调：有限色板、柔和边界、轻微胶片颗粒，不挑题材。无触发词；建议 0.8–1.0。想要「那个年代的味道」又不想限定内容时用这支。"
    },
    "krea2_urasawa_manga": {
      title: "Krea · 浦泽直树漫画",
      weight: 0.9,
      desc: "浦泽直树（怪物 / 20世纪少年）的写实漫画线：克制笔触、细密排线阴影、人物表情内敛。无触发词；建议 0.8–1.0。适合悬疑、日常、人物特写。"
    },
    "krea2_3xperiment": {
      title: "Krea · 3xperiment",
      weight: 0.9,
      desc: "作者 tehalex86 的实验风格：粗颗粒、错位色版、印刷故障感，偏实验插画。无触发词；建议 0.8–1.0。适合做视觉冲击强的封面。"
    },
    "krea2_onitokyo": {
      title: "Krea · 鬼东京",
      weight: 0.9,
      desc: "暗黑都市 + 妖异元素的风格：深夜街道、红灯笼与霓虹混色、和风怪谈气质。无触发词；建议 0.8–1.0。和风恐怖或赛博和风都能用。"
    },
    // ---- 构图 / 透视 / 体型控制（2026-11-16）
    // 这组不是「画风」，是「改画面结构」。滑块类有个共同用法：
    // 正权重增强、负权重反向（例如 Height 用 -1 会变矮），范围一般 −2 ~ +2。
    "krea2_composition_enhancer": {
      title: "Krea · 构图增强",
      weight: 0.8,
      desc: "强化画面骨架：主体位置更明确、前中后景分层、留白更讲究，偏史诗感的中心透视。无触发词；建议 0.6–1.0。构图已经很好时会显得过于「摆拍」。"
    },
    "krea2_tilt_slider": {
      title: "Krea · 倾斜构图（滑块）",
      weight: 1,
      desc: "荷兰角/倾斜机位滑块：正权重画面越歪（不安、动感），负权重回正。建议 0.8–1.5，配动作戏和惊悚题材。过头会让地平线彻底倒塌。"
    },
    "krea2_zoom_slider": {
      title: "Krea · 景别缩放（滑块）",
      weight: 1,
      desc: "等价于换镜头焦段：负值更广（环境压迫感、畸变），正值更近（特写、压缩感）。建议 ±1.0 以内；和提示词里的 wide shot / close-up 同向使用效果最稳。"
    },
    "krea2_first_person": {
      title: "Krea · 第一人称视角",
      weight: 0.9,
      desc: "把机位放到「自己眼睛」的位置（POV）：前景出现手/身体边缘，视线朝下看自己。无触发词；建议 0.8–1.1。人物面部会大幅减少，不适合要露脸的构图。"
    },
    "krea2_centaur": {
      title: "Krea · 半人马 / 多腿形体",
      weight: 1,
      desc: "半人马式的四腿人体结构：人形上身接马身，腿数与关节合理。提示词写 centaur；建议 0.9–1.2。和普通人物提示词同用会出「六条腿」的错，必须明确写 centaur。"
    },
    "krea2_detail_slider": {
      title: "Krea · 细节量（滑块）",
      weight: 1,
      desc: "控制画面信息密度：正值加纹理与微小结构（毛孔、布料织纹、锈迹），负值变干净扁平。建议 0.5–1.5；负值很适合做极简海报。"
    },
    "krea2_weight_slider": {
      title: "Krea · 体型胖瘦（滑块）",
      weight: 1,
      desc: "体型滑块：正值更丰满、负值更瘦。建议 ±1.5 以内。超过 ±2 会破坏解剖结构（不是「更胖」，而是变形）。"
    },
    "krea2_height_slider": {
      title: "Krea · 身高（滑块）",
      weight: 1,
      desc: "身高滑块：正值更高挑、负值更娇小，同时影响头身比。建议 ±1.5 以内；多人同框时它对所有人都生效，做不到「一个高一个矮」。"
    },
    "krea2_age_slider": {
      title: "Krea · 年龄（滑块）",
      weight: 1,
      desc: "年龄滑块：负值更年轻、正值更年长（皮肤质地、法令纹、发色一起变）。建议 ±1.5；注意它只做「显老/显年轻」，不改变人物身份。成年角色请勿往负方向过度使用。"
    },
    // ---- Krea 2 成人向 LoRA（Civitai 镜像，全部仅限成年角色）
    // 这一组不是"风格"，是能力补丁：Krea 2 原生对裸露 / 性场景会往时装、泳装方向修正，
    // 叠上这些才拉得回来。真正解除提示词拒答还得换编码器（见 krea2_noct 说明）。
    "krea2_nsfw_v4": {
      title: "Krea · 成人向 V4（综合）",
      weight: 1,
      desc: "综合向能力补丁，Civitai 上最常被引用的一支（迭代到 V4.1 再往后 3000 步）。无固定触发词，靠提示词；建议 0.9–1.1。和 aio 别同时开，两者作用重叠会过冲。仅限成年角色。"
    },
    "krea2_aio_nsfw": {
      title: "Krea · 全能整合包",
      weight: 1,
      desc: "All-in-one 整合：把多支场景 LoRA 合成一个，省得叠一堆。无触发词；建议 0.8–1.0，和 nsfw_v4 二选一。仅限成年角色。"
    },
    "krea2_herpov_v2": {
      title: "Krea · 第一人称视角",
      weight: 1,
      triggers: "herpov",
      desc: "第一人称 POV 构图：机位压到人眼高度，画面里带拍摄者身体。触发词 herpov（放提示词最前）；建议 0.9–1.1，配 wide angle、from above 增强透视。仅限成年角色。"
    },
    "krea2_dbx_uncensored": {
      title: "Krea · DBX 无审查基础包",
      weight: 1,
      desc: "比单支场景 LoRA 更底层的一支：直接压掉模型对裸露 / 体液的回避倾向，作为其他场景 LoRA 的地基。无触发词；建议 0.8–1.0，和其他成人 LoRA 同开时降到 0.6。仅限成年角色。"
    },
    "krea2_nsfw_fix": {
      title: "Krea · 结构修正",
      weight: 0.8,
      desc: "专门修成人构图下的结构错误（肢体粘连、比例错、接缝）。无触发词；建议 0.6–0.9，出图有小瑕疵时挂上，正常图挂了会略微趋同标准脸。仅限成年角色。"
    },
    "krea2_nsfw_slider": {
      title: "Krea · 衣物量滑块",
      weight: 0.8,
      desc: "衣物多少滑块（源方向：衣物由多到少）。负值偏保守、正值偏暴露，建议 ±1.0 以内微调；配具体服装词（dress、lingerie）效果更稳。仅限成年角色。"
    },
    "anima_turbo_v0.2": {
      title: "Anima Turbo 极速出图",
      weight: 1,
      desc: "Turbo 加速：8–12 步、CFG 1、Euler 即可出图，实测 10 步约 10 秒。CFG 1 时负面词几乎不生效，构图/细节也更随机；适合大批抽卡，选定图后关掉 Turbo 再做细化重绘。"
    },
    "moss_image_sft_8steps_dmd_lora": {
      title: "MOSS 8 步 DMD 极速出图",
      weight: 1,
      desc: "MOSS-Image 的 8 步 DMD 蒸馏：8–10 步、CFG 1、ER SDE 即可出图，实测 8 步约 20 秒。CFG 1 时负面词几乎不生效；适合抽卡，选定图后关掉再做 25 步细化。"
    },
    // ---- MOSS 质量 / 风格追加（2026-11-15 从 HF 拉的一批，都是 DiT-only）
    "moss_hires_test_v07": {
      title: "MOSS · 高清增强（实验）",
      weight: 0.8,
      desc: "comfyanonymous 自己在跑的 hires 测试 LoRA（v0.7）：专门给二采补细节，直出挂了容易发糊。无触发词；建议 0.6–0.9，只在开了高清放大时挂。"
    },
    "moss_beauty": {
      title: "MOSS · 人像美化",
      weight: 0.7,
      triggers: "moss_beauty_style",
      desc: "人像精修：皮肤质感、五官比例、发丝处理都更\"成片\"。触发词 moss_beauty_style；建议 0.6–0.8，过高会趋同网红脸。"
    },
    "moss_gouache": {
      title: "MOSS · 水粉",
      weight: 0.8,
      triggers: "moss_vgouache_style",
      desc: "水粉画质感：粉质笔触、纸纹、边缘略带干刷。触发词 moss_vgouache_style；建议 0.7–1.0。"
    },
    "moss_impressionism": {
      title: "MOSS · 印象派",
      weight: 0.8,
      desc: "印象派油画：碎笔触、冷暖色并置、轮廓不抠死。无固定触发词（训练集自带风格标签），建议 0.7–0.9；配 oil painting 更稳。"
    },
    "moss_pixelart_16x16": {
      title: "MOSS · 16×16 像素画",
      weight: 1,
      desc: "16×16 极小像素格栅：色板被压到十几色，适合做图标/精灵图。无触发词；建议 1.0–1.2，配合 nearest 放大才不糊。"
    },
    "anima_highres_boost": {
      title: "官方高清增强",
      weight: 0.6,
      desc: "Highres/Aesthetic Boost：补细节密度、材质和整体观感。无固定触发词；建议 0.5–0.8，1024px、20 步以上更明显。"
    },
    "anima_rl_v0.1": {
      title: "官方 RL 质感",
      weight: 0.6,
      desc: "官方 RL 实验件：提升美学与细节，画面偏绘画 / 厚涂。无触发词；建议 0.5–0.8，和画风同挂时各降 0.1–0.2。"
    },
    "anima_greg_rutkowski": {
      title: "Greg Rutkowski 画风",
      weight: 0.7,
      desc: "官方奇幻画风：厚涂笔触、强光影、浓郁色彩。无固定触发词；人物 0.5–0.7、场景 0.6–0.8，拉高易过曝。"
    },
    "style_diives": {
      title: "diives 兽人画风",
      weight: 0.8,
      triggers: "@diives",
      desc: "兽人 / 拟人画风：成熟脸型、硬朗上色、饱满体态。触发词 @diives；建议 0.7–0.9，人类角色也能换味。"
    },
    "style_eudetenis": {
      title: "eudetenis 画风",
      weight: 0.8,
      triggers: "@eudetenis",
      desc: "成熟人物画风：利落线条、硬朗上色。训练集含较多捆绑 / BDSM 内容，自带成人倾向；建议 0.6–0.8，非成人用途需降权。"
    },
    "adult_body_weight_slider": {
      title: "体重滑块",
      weight: 0.8,
      desc: "体重滑块：数值越高越丰满（源方向 Skinny → Fat）；建议 0.6–1.0，拉满易比例崩。仅限成年角色。"
    },
    "adult_nipple_size_slider": {
      title: "乳头尺寸滑块",
      weight: 0.8,
      desc: "乳头尺寸滑块：数值越高尺寸越大；建议 0.5–1.0 起调，极端值易坏结构。仅限成年角色。"
    },
    "adult_fitbutt": {
      title: "健身臀型",
      weight: 0.8,
      triggers: "nm_fitbutt",
      desc: "健身臀型：触发词 nm_fitbutt；建议 0.6–0.8，配 from behind、ass focus、tight clothes。正面构图几乎无效，仅限成年角色。"
    },
    "adult_pose_spread_legs": {
      title: "张腿站姿",
      weight: 0.8,
      triggers: "bowlegged pose, wide spread legs, split thighs",
      desc: "张腿 / 外八站姿：触发词 bowlegged pose、wide spread legs、split thighs；建议 0.6–0.8，依赖正面全身构图，仅限成年角色。"
    },
    // ---- MOSS 二次元风格（Civitai 镜像，2026-11-15 一批 8 支）
    // MOSS 原生偏写实摄影，这几支是把它往动画方向拽的最直接手段：
    // 平涂 / 超扁平 / 90s 赛璐璐 / 现代干净赛璐璐 / 漫画草图 / 吉卜力 / 动画截图 / Q 版。
    "moss_anime_flat": {
      title: "MOSS · 平涂二次元",
      weight: 0.9,
      desc: "基础平涂：色块分明、阴影只分两层、几乎无渐变，最百搭的一支。无固定触发词；建议 0.8–1.0，想叠加别的画风时先用它打底。"
    },
    "moss_anime_superflat": {
      title: "MOSS · 超扁平",
      weight: 0.9,
      desc: "比平涂更极端：去掉所有体积感，只剩纯色面与大色差轮廓，接近现代海报 / 扁平插画。建议 0.8–1.0，人物容易趋同模板脸，配具体服饰词补回信息量。"
    },
    "moss_anime_retrocel90": {
      title: "MOSS · 90s 赛璐璐",
      weight: 0.9,
      desc: "1990 年代电视动画质感：三色阶赛璐璐阴影、轻微色偏、胶片颗粒、手绘背景。无触发词；建议 0.8–1.0，配 \"1990s anime\" 更稳。"
    },
    "moss_anime_bastyle": {
      title: "MOSS · 干净赛璐璐（BA 系）",
      weight: 0.9,
      desc: "《蔚蓝档案》式的现代干净赛璐璐：高饱和、边缘利落、阴影带一点冷紫。v2 版本线条更稳；建议 0.8–1.0，出角色立绘很吃这套。"
    },
    "moss_manga_sketch": {
      title: "MOSS · 漫画草图",
      weight: 0.9,
      triggers: "manga sketch",
      desc: "铅笔草稿 / 分镜稿质感：保留辅助线与草稿线，黑白为主。建议 0.8–1.0，配 monochrome、sketch 强化；不适合要求成品度的场景。"
    },
    "moss_ghibli": {
      title: "MOSS · 吉卜力",
      weight: 0.9,
      triggers: "Ghibli style",
      desc: "吉卜力式背景美术：水彩天空、灰绿暖赭的克制配色、简笔圆脸。建议 0.8–1.0，禁用高饱和色词（neon、vivid）否则立刻破功。"
    },
    "moss_anime_screencap": {
      title: "MOSS · 动画截图",
      weight: 0.9,
      desc: "把画面做成「从 TV 动画里截的一帧」：轻微动态模糊、电视级色彩压缩、字幕安全区构图。v2 比 v1 少糊；建议 0.8–1.0。"
    },
    "moss_anime_chibi": {
      title: "MOSS · Q 版",
      weight: 0.9,
      desc: "二头身 Q 版：大头、短肢、简化五官，表情夸张。建议 0.8–1.1，背景容易被一并简化，需要场景时降到 0.6 再单独描述背景。"
    },
    // ---- MOSS 作品级画风（2026-11-16）
    "moss_arcane": {
      title: "MOSS · 双城之战",
      weight: 1,
      desc: "Arcane 的粗笔触油画质感与冷蓝洋红对撞。无触发词，提示词写 Arcane style 更稳；建议 0.9–1.1。MOSS 原生偏写实，这支会把材质往手绘拉。"
    },
    "moss_frieren": {
      title: "MOSS · 芙莉莲",
      weight: 1,
      desc: "芙莉莲的画面气质：柔和渐变、低饱和奇幻色、干净的空气感。无触发词；建议 0.9–1.1，适合风景与静态人物。"
    },
    "moss_chainsaw_man": {
      title: "MOSS · 电锯人（剧场版）",
      weight: 1,
      desc: "电锯人剧场版的粗线、脏旧质感与降饱和血迹红。无触发词；建议 0.9–1.1，配 gritty、film grain 更贴。"
    },
    // ---- MOSS 机位 / 异形（2026-11-16）
    "moss_camera_angle": {
      title: "MOSS · 机位角度控制",
      weight: 0.9,
      desc: "专门管相机角度的 LoRA：俯视、仰视、过肩、鸟瞰、虫视等机位比纯提示词更听话。无固定触发词，提示词里写清机位（low angle / bird's eye）配合使用；建议 0.8–1.1。"
    },
    "moss_taur": {
      title: "MOSS · 多腿形体（Taur）",
      weight: 1,
      desc: "半人马 / 多腿生物结构：人形上身接兽身，四足比例和关节合理。提示词写 taur / centaur；建议 0.9–1.2。不写清楚物种时容易退化成人骑马。"
    },
    "moss_spider_legs": {
      title: "MOSS · 蜘蛛腿 / 节肢附肢",
      weight: 1,
      desc: "从身体长出蜘蛛腿/机械足的结构（hexapod 六足训练）。提示词写 spider legs / extra arachnid limbs；建议 0.9–1.2。权重过高会让腿抢主体，人物躯干反而糊。"
    },
    // ---- MOSS 画师画风（2026-11-16）
    "moss_yoneyama_mai": {
      title: "MOSS · 米山舞",
      weight: 0.9,
      desc: "米山舞的笔触与撞色，MOSS 版。提示词写 Yoneyama Mai；建议 0.8–1.0。MOSS 原生写实，这支会把材质往插画拉。"
    },
    "moss_mochizuki_kei": {
      title: "MOSS · 望月けい",
      weight: 0.9,
      desc: "望月けい的图像设计感：大面积纯色块、极简背景、锐利线条与强对比，接近海报/唱片封面。提示词写 Mochizuki Kei；建议 0.8–1.0，留白越多越像，堆细节会失效。"
    },
    "moss_mochizuki_kei_r32": {
      title: "MOSS · 望月けい（高 rank 版）",
      weight: 0.9,
      desc: "同一画师的另一版，rank 32 + 15MP 训练，比上面那版更能压住长相和笔触，代价是更容易过拟合（权重过 1.1 会只会画这一张脸）。建议 0.7–0.9，只有一版不够像时再用它。"
    },
    // ---- MOSS 画师 / 画风补充（2026-11-16 第三批）
    "moss_kantoku": {
      title: "MOSS · カントク",
      weight: 0.9,
      desc: "柔光少女：粉彩通透皮肤、发丝高光、制服与日常场景。提示词写 Kantoku；建议 0.8–1.0。MOSS 原生偏写实，这支会把材质拉向插画。"
    },
    "moss_fuzichoco": {
      title: "MOSS · 藤ちょこ",
      weight: 0.9,
      desc: "华丽和风纹样与金红配色。提示词写 Fuzichoco；建议 0.8–1.0。细节密度高，和 8 步 DMD 同挂时权重别超 0.9。"
    },
    "moss_guweiz": {
      title: "MOSS · GUWEIZ",
      weight: 0.9,
      desc: "电影布光 + 低饱和冷调的写实插画。提示词写 Guweiz；建议 0.8–1.0。MOSS 上这支最容易出「照片级」效果。"
    },
    "moss_wlop": {
      title: "MOSS · WLOP",
      weight: 0.9,
      desc: "半写实厚涂、强逆光冷蓝紫、情绪化氛围。提示词写 WLOP；建议 0.8–1.0。体积只有 35MB，是精简版，效果比 Krea 那支弱一点。"
    },
    "moss_murata": {
      title: "MOSS · 村田蓮爾",
      weight: 0.9,
      desc: "复古未来主义：圆润厚重轮廓、铬金属与旧皮革、飞行器与制服。提示词写 Range Murata；建议 0.8–1.0。"
    },
    "moss_sakuga": {
      title: "MOSS · 现代 TV 动画作画",
      weight: 1,
      desc: "现代番剧的 sakuga（作画）截图感：镜头运动模糊、赛璐璐上色、构图有张力。无触发词；建议 0.9–1.1。想要「动画里的一帧」而不是「插画」就用这支。"
    },
    "moss_lineart": {
      title: "MOSS · 动画线稿",
      weight: 1,
      desc: "纯线稿风：干净的单色轮廓线、无上色、留白多。无触发词；建议 0.9–1.1。适合做上色底稿或设定图。"
    },
    "moss_90s_anime": {
      title: "MOSS · 90s 复古动画",
      weight: 1,
      desc: "90 年代动画质感：降低的色彩数、胶片颗粒、柔和的赛璐璐边界。无触发词；建议 0.9–1.1。"
    },
    // ---- MOSS 质量 / 细节修正（2026-11-16）
    // 注意：这几支修的是「糊、化、缺细节」，不修几何透视。MOSS 的透视问题靠它们解决不了。
    "moss_detailer": {
      title: "MOSS · 细节增强",
      weight: 0.7,
      desc: "把糊掉的细节拉回来：发丝、布料织纹、皮肤纹理、背景杂物。无触发词；建议 0.5–0.8。它只会让「现有的东西更清楚」，不会补出原本没有的结构。"
    },
    "moss_quality_slider": {
      title: "MOSS · 质量滑块",
      weight: 0.8,
      desc: "文本滑块式质量调节：靠提示词里的强度词控制幅度（high quality / low quality 方向）。建议 0.6–1.0。适合压掉 MOSS 偶发的「塑料感」，过度会让画面变脏。"
    },
    "moss_quality_boost": {
      title: "MOSS · 质量提升（V67）",
      weight: 0.8,
      desc: "在 Base 上训练的质感提升：对比度、材质层次、暗部细节更实。无触发词；建议 0.7–1.0。和 8 步 DMD 一起用时权重别超过 0.9，两者都会加强对比，叠狠了会爆高光。"
    },
    // ---- 成人向补充（2026-11-16，全部仅限成年角色）
    "krea2_nsfw_v5": {
      title: "Krea · 成人向 V5",
      weight: 0.9,
      desc: "成人内容解锁与身体细节强化，V5 是这系列最新一版。无触发词；建议 0.8–1.0。比 V4 更少出现「解锁一半」的中间态，但和 Noct 底模同用时权重别超 1.1。"
    },
    "krea2_hentai_studio": {
      title: "Krea · 成人插画质感",
      weight: 0.9,
      desc: "成人插画的画面质感：皮肤高光、体液湿润感、构图更「作品化」而非截图感。无触发词；建议 0.8–1.0。作者 zura_janai，多底模同源。"
    },
    "krea2_riding_scene": {
      title: "Krea · 骑乘位姿势",
      weight: 0.9,
      desc: "特定姿势件：稳定的上下位关系与身体接触点。无触发词；建议 0.8–1.0。姿势类 LoRA 权重过高会让构图僵化，配合自由描述使用。"
    },
    "moss_better_nudes": {
      title: "MOSS · 裸体优化",
      weight: 0.8,
      desc: "MOSS 的裸体表现修正：皮肤质感、身体比例、私处结构更合理。无触发词；建议 0.7–0.9。1.1GB 是这批里最大的，效果也最直接。"
    },
    "moss_mystic_xxx": {
      title: "MOSS · 神秘系成人",
      weight: 0.9,
      desc: "带氛围的成人风格：低照度、暖调皮肤、神秘感构图。无触发词；建议 0.8–1.0。比纯解锁件更偏「画面感」。"
    },
    "anima_hentai_comic": {
      title: "Anima · 成人漫画全彩",
      weight: 0.9,
      desc: "成人漫画的全彩质感：网点与厚涂混合、分镜感强。无触发词；建议 0.8–1.0。想要「漫画页」而不是「插画」时用。"
    },
    "anima_female_pov": {
      title: "Anima · 女性视角",
      weight: 0.9,
      desc: "女性第一人称视角的构图与身体透视。无触发词；建议 0.8–1.0。这类 POV 件对机位很敏感，配 low angle 会更强。"
    },
    "anima_giant_dom": {
      title: "Anima · 巨躯支配",
      weight: 0.9,
      desc: "体型差与支配关系的构图：巨大化、俯视视角、尺度对比。无触发词；建议 0.8–1.0。和 height slider 同用容易两头打架，选一个。"
    },
    // ---- 玩法向（2026-11-17，不是画风，是「换一种看法」）
    "krea2_expressions": {
      title: "Krea · 表情大全",
      weight: 0.9,
      desc: "把情绪拆成具体面部动作：挑眉、抿嘴、斜视、尴尬笑、哭腔。无触发词；建议 0.8–1.0。做角色立绘或连续分镜时最有用的一支，比「smile」精确得多。"
    },
    "krea2_psx": {
      title: "Krea · PS1 低多边形",
      weight: 0.9,
      desc: "初代 Playstation 的 3D 质感：低面数模型、抖动的顶点、抖动色阶、雾化远景。无触发词；建议 0.8–1.0。想要「1998 年游戏截图」就用这支，别配高清词。"
    },
    "krea2_poster_graphics": {
      title: "Krea · 海报排版",
      weight: 0.85,
      desc: "把画面往平面设计推：大面积色块、粗排版层级、留白与网格。无触发词；建议 0.7–0.9。它会给构图加「设计感」，但文字仍是乱码，别指望它写对标题。"
    },
    "krea2_chibi_animal": {
      title: "Krea · Q版动物",
      weight: 0.9,
      desc: "圆头短腿的 Q 版动物角色：大眼、简笔、贴纸感。无触发词；建议 0.8–1.0。适合做表情包与头像。"
    },
    "moss_gta_style": {
      title: "MOSS · GTA 加载画面",
      weight: 0.9,
      desc: "罪恶都市那种分格漫画式加载画面：粗描边、平涂、电影分镜构图。无触发词；建议 0.8–1.0。MOSS 的质感会让这套风格更「印刷」，比 Krea 版更像真截图。"
    },
    "anima_blueprint": {
      title: "Anima · 蓝图数据表",
      weight: 0.9,
      desc: "机械/载具的工程蓝图表：线框、标注引线、侧视顶视并列。无触发词；建议 0.8–1.0。做设定图很有说服力，人物会被拆成结构线。"
    },
    // ---- Z-Image（2026-11-17）
    // Z-Image 是蒸馏模型：LoRA 叠加强度总和建议压在 1 左右，叠三支就够，再多会糊。
    "zimage_hands": {
      title: "Z-Image · 手部修正",
      weight: 0.8,
      desc: "专治手指数量与关节：五指分明、握持关系合理。无触发词；建议 0.7–0.9。Z-Image 的手本来不算差，但双手交叠时仍会融，这支是目前最有效的补丁（C 站 31 万下载）。"
    },
    "zimage_detail_perfection": {
      title: "Z-Image · 细节极致（手/脚/脸）",
      weight: 0.7,
      desc: "同时修手、脚、面部五处：指甲、脚趾分界、眼睑层次。无触发词；建议 0.6–0.8。和手部修正二选一，别同时上——两者的修正方向会打架。"
    },
    "zimage_skin_texture": {
      title: "Z-Image · 皮肤质感",
      weight: 0.7,
      desc: "真实皮肤：毛孔、细毛、油脂高光、肤色不均。无触发词；建议 0.6–0.8。写实人像必挂，画风向的图挂上会显得脏。"
    },
    "zimage_detail_slider": {
      title: "Z-Image · 细节滑块",
      weight: 1,
      desc: "细节量滑块：正值加纹理与微小结构，负值更干净。建议 ±1.2 以内。20MB 的小件，作用是全局微调而不是加内容。"
    },
    "zimage_nsfw_master": {
      title: "Z-Image · 成人全能包",
      weight: 0.8,
      desc: "解锁 + 身体结构 + 姿势的综合包，是 Z-Image 这边下载量最高的成人件（24 万）。无触发词；建议 0.7–0.9。Z-Image 原生就不审查，这支主要提升解剖与场景合理性。"
    },
    "zimage_mystic_xxx": {
      title: "Z-Image · 神秘系成人",
      weight: 0.8,
      desc: "低照度暖调的成人风格：皮肤高光、氛围先于动作。无触发词；建议 0.7–0.9。和全能包同用时各降到 0.6。"
    },
    "zimage_pose_pack": {
      title: "Z-Image · 姿势包",
      weight: 0.8,
      desc: "常见体位组合包（多姿势训练在一个文件里，靠提示词选）。无触发词；建议 0.7–0.9。姿势类权重过高会僵，配自由描述用。"
    },
    "zimage_moriimee_gothic": {
      title: "Z-Image · 哥特霓虹",
      weight: 0.8,
      desc: "哥特 + 霓虹的画风：暗底、紫粉高光、装饰性蕾丝与金属。无触发词；建议 0.7–0.9。C 站 15 万下载，是 Z-Image 上最成熟的风格件之一。"
    },
    "zimage_anime_flat": {
      title: "Z-Image · 平涂二次元",
      weight: 0.85,
      desc: "干净平涂：色块边界清晰、无多余纹理、动画感强。无触发词；建议 0.8–1.0。Z-Image 偏写实，这支把它拉回番剧质感。"
    },
    "zimage_cyberpunk_anime": {
      title: "Z-Image · 赛博动画",
      weight: 0.85,
      desc: "霓虹赛博的动画风：湿地面反射、灯牌光污染、冷暖对撞。无触发词；建议 0.8–1.0。和 Krea 那支同名不同底模，别混用。"
    },
    // ---- Z-Image 画师（2026-11-17）
    // 现状：日系画师（米山舞/望月/カントク/藤ちょこ）在 Z-Image 上基本没有版本，
    // 目前能用的都是欧美漫画系作者，多为多底模包里的 ZIT 分卷。
    "zimage_afrobull": {
      title: "Z-Image · Afrobull",
      weight: 0.8,
      desc: "Afrobull 的欧美漫画风：饱满圆润的线条、透视夸张、表情夸张生动。无触发词；建议 0.7–0.9。C 站 2.3 万下载，来自多底模包里的 ZIT 分卷。"
    },
    "zimage_zankuro": {
      title: "Z-Image · Zankuro",
      weight: 0.8,
      desc: "Zankuro 的厚涂角色风：体积感强、暗部通透、女性角色比例偏好明显。无触发词；建议 0.7–0.9。2.6 万下载，是 Z-Image 上最成熟的画师件。"
    },
    "zimage_dart": {
      title: "Z-Image · 18DART5",
      weight: 0.8,
      desc: "D-ART（@18dart5）的个人风格：粗颗粒、硬边阴影、出版物质感。无触发词；建议 0.7–0.9。适合封面与海报。"
    },
    "zimage_wlop_impressions": {
      title: "Z-Image · WLOP 印象",
      weight: 0.85,
      desc: "WLOP 一脉的半写实厚涂：强逆光、冷蓝紫、情绪化氛围。无触发词；建议 0.8–1.0。Z-Image 上 WLOP 系下载最高的一支（6.2k），但明显弱于 Krea 那版（9.5k）。"
    },
    // ---- 优质二次元（2026-11-18，C 站高下载量 + 官方触发词）
    "anima_moriimee_gothic": {
      title: "Anima · MoriiMee 哥特霓虹",
      weight: 0.8,
      desc: "C 站 15.4 万下载的风格件，Anima 分卷。暗底霓虹、蕾丝金属、哥特洛丽塔。无触发词；建议 0.7–0.9。和 90s 怀旧叠加时各降到 0.5。"
    },

    "anima_rimix": {
      title: "Anima · Ri-mix 综合风格",
      weight: 0.75,
      desc: "5.9 万下载的多架构综合风格件（504MB），Anima 分卷。偏厚涂插画，色块与笔触都强。建议 0.6–0.8，别和画师件叠太满。"
    },
    "anima_anime_flat": {
      title: "Anima · 平涂二次元",
      weight: 0.85,
      desc: "4.3 万下载。干净色块、无多余纹理、番剧感。无触发词；建议 0.8–1.0。和 HS 风格集叠时后者降到 0.4。"
    },
    "anima_anime_in_real": {
      title: "Anima · 现实系动画",
      weight: 0.8,
      desc: "4.1 万下载。把动画角色放进写实光影环境：皮肤质感、复杂光线、反差大。建议 0.7–0.9。"
    },
    "anima_takeda_hiromitsu": {
      title: "Anima · 武田弘光",
      weight: 0.8,
      desc: "3.1 万下载的画师风格件。厚涂、体积感强、女性角色比例偏好明显。无触发词；建议 0.7–0.9。成人向作者，注意使用场景。"
    },
    "anima_yoneyama_mai": {
      title: "Anima · 米山舞",
      weight: 0.8,
      desc: "1.8 万下载的画师件（Anima 分卷，和 krea2_yoneyama_mai 不是同一文件）。强光影、锐利脸型、动感构图。无触发词；建议 0.7–0.9。"
    },
    "anima_flatline": {
      title: "Anima · Flatline",
      weight: 0.7,
      desc: "22MB 小件，2.3 万下载。触发词：@flatline。线条利落、平涂高对比。当辅料用，0.5–0.7。"
    },
    "anima_90s_melancholy": {
      title: "Anima · 90 年代忧郁",
      weight: 0.8,
      desc: "1.5 万下载。触发词：90s_melancholy, retro。旧动画的褪色质感与静谧氛围，适合情绪向插画。建议 0.7–0.9。"
    },
    "krea2_blue_archive_style": {
      title: "Krea 2 · 蔚蓝档案画风",
      weight: 0.85,
      desc: "3.2 万下载的 BArtstyle，Krea 2 分卷（895MB）。触发词：azure youth anime art style。干净明亮的日系手游立绘感。建议 0.8–1.0。"
    },
    // ---- 高下载量通用件（2026-11-19）
    "zimage_hands_xl": {
      title: "Z-Image · 手部修正 XL",
      weight: 0.7,
      desc: "31.5 万下载，Z-Image 生态里下载量最高的实用件。专治手指粘连与多指。触发词：hand, detailed。建议 0.6–0.8；画面本身手部没问题时别挂，会略微降低自然度。"
    },
    "zimage_detailed_perfection": {
      title: "Z-Image · 细节强化（手/脚/脸）",
      weight: 0.65,
      desc: "14 万下载。触发词：ultra detailed, cinematic。同时强化手、脚、面部细节，代价是画面偏「精修感」。建议 0.6–0.75，和高步数别叠加过度。"
    },
    "krea2_style_yarn": {
      title: "Krea 2 · YARN 风格集",
      weight: 0.7,
      desc: "4.7 万下载的风格合集。无触发词；偏综合画风增强，适合当主风格与画师件之间的过渡层。建议 0.6–0.8。"
    },
    "moss_style_anime_flat": {
      title: "MOSS · 平涂二次元",
      weight: 0.85,
      desc: "4.36 万下载，MOSS Image 分卷。干净色块与番剧感，弥补 MOSS 偏写实/排版的短板。无触发词；建议 0.8–1.0。"
    },
    "moss_artist_afrobull": {
      title: "MOSS · Afrobull 画风",
      weight: 0.8,
      desc: "2.3 万下载的画师件（MOSS 分卷）。触发词：zfr0。厚实人体与欧美动画质感。建议 0.7–0.9。"
    },
    // ---- 角色包（2026-11-19）
    "anima_char_miku": {
      title: "Anima · 初音未来",
      weight: 0.85,
      desc: "1.7 万下载，仅 11MB。触发词：hatsune miku（再加发型/服装标签更稳）。建议 0.8–0.9。Anima 分卷，和 krea2 的初音不是同一个文件。"
    },
    "anima_char_marin": {
      title: "Anima · 喜多川海梦",
      weight: 0.85,
      desc: "1.7 万下载。触发词：Marin Kitagawa。内置多套服装标签（校服/泳装/大衣），可直接拼在提示词后换装。建议 0.8–0.9。"
    },
    "anima_char_kallen": {
      title: "Anima · 卡莲（Code Geass）",
      weight: 0.8,
      desc: "1.75 万下载的角色合集分卷，触发词：euphem1a（加 1girl + 发色瞳孔标签）。建议 0.75–0.85。"
    },
    "anima_char_pekomama": {
      title: "Anima · 兔田妈妈",
      weight: 0.8,
      desc: "Hololive 同人角色，含三套服装。触发靠外观标签（rabbit ears / 双色头发）；建议 0.75–0.85。成人向内容较多，注意使用场景。"
    },
    "krea2_char_zyloo_bundle": {
      title: "Krea 2 · ZyloO 角色合集",
      weight: 0.85,
      desc: "7.9 万下载的多角色包（218MB），一个文件里塞了多个原创角色，靠触发词切换。示例：zy_kerrigan。建议 0.8–0.9，别叠画师件。"
    },
    "krea2_char_anna_yamada": {
      title: "Krea 2 · 山田杏奈",
      weight: 0.85,
      desc: "1.26 万下载，《我心里危险的东西》。触发词：&nn&y&m&d&（另有 gym outfit / bear hoodie 服装词）。建议 0.8–0.9。"
    },
    "krea2_char_genshin_cosplay": {
      title: "Krea 2 · 原神 cos 合集",
      weight: 0.85,
      desc: "原神角色服装合集（218MB），触发词以 WYNS_cos 开头，后面跟具体角色外观描述。建议 0.8–0.9。"
    },
    "zimage_char_miku": {
      title: "Z-Image · 初音未来",
      weight: 0.85,
      desc: "触发词：zitmiku（后面建议跟 hatsune miku 与服装标签）。样本少、下载量低，效果不如 Anima 那支稳，但 Z-Image 的字形与手部更准。建议 0.8–0.9。"
    },
    "zimage_char_sheet_helper": {
      title: "Z-Image · 角色设定表",
      weight: 0.85,
      desc: "10.3 万下载的工具件：一次出三视图 + 表情 + 服装分解的设定表。触发词：CharacterDesignIZT。做角色设定图用，不建议用于单张插画。"
    },
    // ---- 文字渲染（2026-11-18）
    "sdxl_harrlogos_text": {
      title: "SDXL · Harrlogos 文字生成",
      weight: 0.8,
      desc: "SDXL 上最知名的文字渲染 LoRA（3.5 万下载），能在画面里生成可读的英文短词。激活词：3D / Neon / Egyptian / Pastel / Viking 分别对应不同字体气质。建议 0.7–0.9。中文不行。"
    },
    "sdxl_texta_text": {
      title: "SDXL · Texta 文字生成",
      weight: 0.8,
      desc: "另一支专攻文字的 SDXL LoRA（1.9 万下载），和 Harrlogos 思路不同：更适合短标题与标识。无触发词，建议 0.7–0.9。两支别同时挂。"
    },
    "krea2_textfusion_refusal": {
      title: "Krea 2 · 文字融合解限",
      weight: 0.7,
      desc: "26MB 的小件，作用是降低 Krea 2 TextFusion 对「画面里写文字」类提示词的拒绝率。不负责字形本身，只让模型愿意画。英文有效；中文还是交给 Z-Image / MOSS。"
    },
    "zimage_comic_book_page": {
      title: "Z-Image · 漫画分镜页",
      weight: 0.8,
      desc: "带对白框、分格与拟声词的漫画页风格（ZIT 分卷）。Z-Image 本身就能写中文，这支管的是「排版成漫画页」而不是字形。建议 0.7–0.9。"
    },
    // ---- 补齐：本地有文件但之前没写介绍的
    "MOSS-Image-Anime-LoRA-ComfyUI": {
      title: "MOSS 官方二次元",
      weight: 0.8,
      desc: "Comfy-Org 随模型发布的官方二次元适配：整体往动画 / 插画方向偏，但保留 MOSS 的构图能力。无触发词；建议 0.7–0.9，和上面的风格 LoRA 叠加时降到 0.5。"
    },
    "MOSS-Image-NSFW-Uncensored-LoRA-ComfyUI": {
      title: "MOSS 官方无审查",
      weight: 0.8,
      desc: "官方 NSFW-uncensored 适配：压掉打码 / 回避倾向，把解剖拉回正常。无触发词；建议 0.7–1.0。仅限成年角色。"
    },
    "moss_image_edit_lora_rank_64_bf16": {
      title: "MOSS 编辑（指令改图）",
      weight: 1,
      desc: "指令式编辑 LoRA（rank 64 BF16）：配合图生图 + 高重绘幅度，用「把背景换成雪天」这类自然语言改已有图。建议 1.0，重绘幅度 0.6–0.85；纯文生图挂着基本没意义。"
    },
    "moss_image_color_depth_control": {
      title: "MOSS 色彩 / 景深控制",
      weight: 0.8,
      desc: "色彩与景深控制件：对饱和度、冷暖、虚化程度做定向调整，适合统一一组图的色调。无触发词；建议 0.5–0.8，过高会整体发灰或虚化过头。"
    },
    "anima29b-turbolora1.1": {
      title: "Anima 2.9B 加速 v1.1",
      weight: 1,
      desc: "Anima 2.9B 的 Turbo 加速 adapter：8–12 步、CFG 1 出图。和 anima_turbo_4step_v3 别同时开（都是同一段蒸馏，叠了只会过冲）。"
    },
    "anima_turbo_4step_v3": {
      title: "Anima 极速 4 步 v3",
      weight: 1,
      desc: "更激进的 4 步蒸馏：出图最快，但结构稳定性明显下降，适合先大量抽构图，选定后再关掉重跑细化的那一步。"
    },
    "krea2_turbo_lora_rank_64_bf16": {
      title: "Krea Turbo 差值 adapter（隐藏）",
      weight: 1,
      desc: "从 (Turbo − Raw) 权重差里 SVD 抽出来的 adapter，作用是让 Raw 底模跑出 Turbo 表现。本机底模本来就是 Turbo，再叠一层等于重复蒸馏，所以选了 Krea 时会自动隐藏——这里只留一条说明，免得你以为是丢了文件。"
    }
  };
  const CHARACTER_TAG_ZH = {
    "black hair": "黑发", "blonde hair": "金发", "platinum blonde hair": "白金发",
    "brown hair": "棕发", "red hair": "红发", "pink hair": "粉发", "blue hair": "蓝发",
    "dark blue hair": "深蓝发", "purple hair": "紫发", "green hair": "绿发",
    "silver hair": "银发", "white hair": "白发", "grey hair": "灰发", "orange hair": "橙发",
    "magenta hair": "洋红发", "aqua hair": "水色发", "long hair": "长发", "short hair": "短发",
    "twintails": "双马尾", "twin braids": "双辫", "ponytail": "马尾", "braided hair": "麻花辫",
    "wavy hair": "卷发", "bob cut": "波波头", "hair bun": "发髻", "messy hair": "凌乱发",
    "red eyes": "红瞳", "blue eyes": "蓝瞳", "green eyes": "绿瞳", "purple eyes": "紫瞳",
    "yellow eyes": "黄瞳", "orange eyes": "橙瞳", "brown eyes": "棕瞳", "grey eyes": "灰瞳",
    "aqua eyes": "水色瞳", "black eyes": "黑瞳", "closed eyes": "闭眼", "heterochromia": "异色瞳",
    "fox ears": "狐耳", "cat ears": "猫耳", "wolf ears": "狼耳", "animal ears": "兽耳",
    "bunny ears": "兔耳", "fox tail": "狐尾", "wolf tail": "狼尾", "tail": "尾巴",
    "horns": "角", "red horns": "红角", "small horns": "小角", "dragon horns": "龙角", "halo": "光环",
    "wings": "翅膀", "bat wings": "蝠翼", "white wings": "白翼", "black wings": "黑翼",
    "elf": "精灵", "pointed ears": "尖耳", "dark skin": "深肤色", "brown skin": "棕肤",
    "blue skin": "蓝肤", "red skin": "红肤", "green skin": "绿肤",
    "glasses": "眼镜", "sunglasses": "墨镜", "mask": "面罩", "blindfold": "眼罩",
    "eyepatch": "单眼罩", "fangs": "尖牙", "mole under eye": "泪痣", "scar": "伤疤",
    "tattoo": "纹身", "red lips": "红唇", "makeup": "妆容", "hair ornament": "发饰",
    "flower hair ornament": "花发饰", "star hair ornament": "星发饰", "hair ribbon": "发带",
    "hairband": "发箍", "white hairband": "白发箍", "red eyeliner": "红色眼妆", "witch hat": "女巫帽", "hat": "帽子", "beret": "贝雷帽",
    "maid headdress": "女仆头饰", "crown": "王冠", "flower crown": "花冠", "veil": "面纱",
    "black dress": "黑裙", "red dress": "红裙", "blue dress": "蓝裙", "white dress": "白裙",
    "qipao": "旗袍", "kimono": "和服", "yukata": "浴衣", "armor": "铠甲",
    "business suit": "西装", "pencil skirt": "铅笔裙", "office lady": "OL",
    "police uniform": "警服", "military uniform": "军装", "flight attendant uniform": "空乘制服",
    "lab coat": "白大褂", "trench coat": "风衣", "leather jacket": "皮衣", "fur coat": "皮草",
    "apron": "围裙", "cardigan": "开衫", "blazer": "西装外套", "vest": "马甲",
    "bikini": "比基尼", "sports bra": "运动内衣", "leggings": "紧身裤", "wetsuit": "潜水服",
    "leotard": "紧身衣", "bodysuit": "紧身战斗服", "cross": "十字架", "sword": "剑",
    "katana": "武士刀", "spear": "长枪", "bow": "弓", "revolver": "左轮",
    "camera": "相机", "piano": "钢琴", "telescope": "望远镜", "flask": "烧瓶",
    "microphone": "话筒", "headphones": "耳机", "goggles": "护目镜", "gloves": "手套",
    "vampire": "吸血鬼", "succubus": "魅魔", "demon girl": "恶魔少女", "angel": "天使",
    "fallen angel": "堕天使", "mermaid": "人鱼", "siren": "海妖", "elf": "精灵",
    "druid": "德鲁伊", "necromancer": "亡灵法师", "alchemist": "炼金术士",
    "paladin": "圣骑士", "witch": "魔女", "kunoichi": "女忍", "ninja": "忍者",
    "samurai": "武士", "cyborg": "义体人", "android": "人造人", "robot": "机械体",
    "mechanical arm": "机械臂", "prosthetic arm": "义肢", "shark tail": "鲨尾",
    "mouse ears": "鼠耳", "lion ears": "狮耳", "crocodile": "鳄鱼", "butterfly": "蝴蝶",
    "regal": "华贵", "office": "办公室", "classroom": "教室", "laboratory": "实验室",
    "library": "图书馆", "cafe": "咖啡馆", "flower shop": "花店", "art studio": "画室",
    "piano": "钢琴", "music room": "音乐室", "nightclub": "夜店", "gym": "健身房",
    "dance studio": "舞蹈室", "onsen": "温泉", "izakaya": "居酒屋", "beach": "海滩",
    "snow": "雪景", "ocean": "海洋", "space": "太空", "courtroom": "法庭",
    "blueprint": "蓝图", "handcuffs": "手铐", "magnifying glass": "放大镜",
    "silenced pistol": "消音手枪", "duster coat": "长外套", "spaceship": "飞船",
    "motorcycle": "摩托车", "fencing mask": "击剑面罩", "boxing gloves": "拳击手套",
    "racing suit": "赛车服", "pilot uniform": "飞行员制服", "aviator sunglasses": "飞行墨镜",
    "backpack": "背包", "ski suit": "滑雪服", "sports top": "运动上衣",
    "yoga pants": "瑜伽裤", "blouse": "衬衫", "frilled dress": "褶边裙",
    "gothic lolita": "哥特洛丽塔", "piercings": "穿孔", "vintage": "复古", "fur scarf": "毛围巾",
    "oiran": "花魁", "miko": "巫女", "nun": "修女", "space suit": "太空服",
    "zero suit": "零式战斗服", "coat": "外套", "hood": "兜帽", "robe": "长袍",
    "high ponytail": "高马尾", "side ponytail": "侧马尾", "drill hair": "钻头卷",
    "hime cut": "姬发式", "ahoge": "呆毛", "hair intakes": "鬓角发",
    "makeup": "妆容", "red dress": "红裙", "long eyelashes": "长睫毛", "fish tail": "鱼尾",
    "casual clothes": "便服", "school uniform": "校服", "japanese clothes": "和风服装",
    "white coat": "白大衣", "black coat": "黑大衣", "hoodie": "卫衣", "cloak": "斗篷",
    "mob cap": "睡帽", "hair tubes": "发管", "shrine maiden": "巫女",
    "purple jacket": "紫色外套", "pink dress": "粉裙", "green jacket": "绿色外套",
    "white shirt": "白衬衫", "red tie": "红领带", "light blue hair": "浅蓝发"
  };

  window.KLOCK_DATA = { QUALITY_GENERIC, REFINE_PRESETS, REFINE_PRESETS_KREA, MODEL_PROFILES, MOSS_STYLES, MOSS_PRESET_GROUPS, MOSS_TAG_GROUPS, MOSS_NEGATIVE_TAG_GROUPS, MOSS_CHARACTER_GROUPS, KREA_PRESET_GROUPS, KREA_TAG_GROUPS, KREA_CHARACTER_GROUPS, SAMPLER_PRESETS, RECIPES, TAG_GROUPS, NEGATIVE_TAG_GROUPS, ICONS, LORA_ORDER, LORA_LIBRARY, CHARACTER_TAG_ZH };
})();

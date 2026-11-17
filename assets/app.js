(() => {
  "use strict";

  // 登录页与远程访问都已移除（2026-11-15）：本机直接打开即可，不再有 401 跳转，
  // 也不再需要按 hostname 判断「是不是从外网进来的」。

  /* ------------------------------------------------------------------ data */
  const DEFAULT_PROMPT = "masterpiece, best quality, 1girl, solo, adult, mature female, long hair, looking at viewer, upper body, simple background";
  const DEFAULT_NEGATIVE = "bad quality, worst quality, worst detail, sketch, censor, mosaic censoring, lowres, jpeg artifacts, watermark, signature, text, bad anatomy, bad hands, extra digits";
  const STORE_SETTINGS = "simplegen.settings.v2";
  const STORE_PRESETS = "simplegen.presets.v1";
  const STORE_THEME = "simplegen.theme.v1";
  const STORE_MODEL_SETTINGS = "simplegen.modelsettings.v1";
  const THEMES = ["auto", "light", "dark"];
  const MAX_HISTORY = 24;

  const RATIOS = [
    { key: "1:1", w: 1024, h: 1024 },
    { key: "2:3", w: 832, h: 1216 },
    { key: "3:2", w: 1216, h: 832 },
    { key: "9:16", w: 768, h: 1344 },
    { key: "16:9", w: 1344, h: 768 }
  ];

  // Krea 2 Turbo 是「原生 1K–2K」的模型：官方 CLI 示例直接出 2048×2048，
  // 并明说「不必先出 1024 再放大」。实测 1536² 的皮肤纹理、发丝、亚麻织纹
  // 都明显优于 1024² 直出，所以同一套比例给它配高一档的像素预算。
  // 1.77MP 一档用于抽卡/速写，2.36MP 一档留给标准/精细。
  const RATIOS_KREA = [
    { key: "1:1", w: 1328, h: 1328 },
    { key: "2:3", w: 1024, h: 1536 },
    { key: "3:2", w: 1536, h: 1024 },
    { key: "9:16", w: 896, h: 1600 },
    { key: "16:9", w: 1600, h: 896 }
  ];

  function ratioTableFor(arch) {
    return arch === "krea" ? RATIOS_KREA : RATIOS;
  }

  // 二采倍率只有三档下拉（1.25 / 1.35 / 1.5）。存档值可能来自旧版本或档位预设，
  // 统一收敛到最近的一档，避免 mdui-select 拿到选项外的值后显示空白。
  const HR_SCALES = [1.25, 1.35, 1.5];
  function normalizeHrScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1.25;
    return HR_SCALES.reduce(
      (best, cur) => (Math.abs(cur - n) < Math.abs(best - n) ? cur : best), HR_SCALES[0]);
  }

  const QUALITY_KEYS = ["gacha", "draft", "standard", "fine", "hires"];
  const QUALITY_LABELS = { gacha: "抽卡", draft: "速写", standard: "标准", fine: "精细", hires: "高清" };
  // 抽卡是低步数快出，允许更大的单批张数；其余档沿用 1/2/4。
  const BATCH_BASE = [1, 2, 4];
  const BATCH_GACHA = [1, 2, 4, 8, 12];
  const BATCH_NOTES = { 1: "逐张", 2: "推荐", 4: "一轮", 8: "扩展", 12: "抽卡上限" };
  const QUALITY_GENERIC = {
    draft: { steps: 12, cfg: 5, hires: false },
    standard: { steps: 24, cfg: 5.5, hires: false },
    fine: { steps: 32, cfg: 5.5, hires: false },
    hires: { steps: 28, cfg: 5.5, hires: true, scale: 1.25, denoise: 0.38 }
  };

  // 细化重绘内置预设：提示词只写细节后缀，套用时接在原提示词末尾。
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

  // Krea 版的细化预设：同样 9 项、同样的重绘幅度，但描述体改成「英文句子」。
  // 上面那套是 Danbooru 标签串，交给 Qwen3-VL 只会被当成一串孤立名词，
  // 细腻度远不如一句话讲清「看哪里、光从哪来」。
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

  function refinePresetsFor(arch) {
    return arch === "krea" ? REFINE_PRESETS_KREA : REFINE_PRESETS;
  }

  // 各自模型的推荐档。Anima 是流匹配架构（Qwen3 编码器 + Qwen-Image VAE），
  // 每个 Anima 底模单独一份档案；Nova / Pony 是 SDXL 标签体系，各自一份；
  // 通用 SDXL 沿用原有推荐。档案按顺序匹配，先列具体模型再列通用兜底。
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
  const MODEL_PROFILE_LIST = Object.values(MODEL_PROFILES);
  // 质量前缀之间存在前缀包含关系（Anima 通用前缀是 MiaoMiao 前缀的开头），
  // 必须按长度倒序匹配，否则切换模型时只剥掉半截前缀。
  const QUALITY_PREFIXES = MODEL_PROFILE_LIST.map((profile) => profile.qualityPrefix)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  // MOSS 的画风靠自然语言，不吃 Danbooru 画师标签（@yd、artist:xxx 这类对它无效）。
  // 所以这里给的是中文风格短语，点一下直接拼进提示词，不经过 4B 转写。
  // text 就是最终写进提示词的那句，保持可读、可手改；不同组的词条可以叠加。
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

  // 按维度分组，分类条一次只显示一组，避免几十个词条把提示词区撑爆。
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
  let mossPresetGroup = "style";

  // ============================================================
  // MOSS 专用中文词库：MOSS 的 TE 读中文远比 Danbooru 标签准，
  // 所以切到 MOSS 后，标签库 / 角色库 / 负面词全部换成这一套，
  // 写入提示词的也是中文，不掺任何英文标签。
  // 结构沿用原格式：[写入提示词的片段, 界面上显示的短名]。
  // ============================================================
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

  // MOSS 角色库：用中文外貌描述写入提示词，界面上显示短名。
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

  // ============================================================
  // Krea 2 专属内容体系
  // ------------------------------------------------------------
  // Krea 2 的编码器是 Qwen3-VL-4B，不是 CLIP：它按「自然语言」理解提示词。
  // 所以这里既不是 MOSS 的中文标签，也不是 Anima 的 Danbooru 标签，而是
  // 「可直接读出口的英文描述句」。写这套时严守官方 Prompting Guide 的五条：
  //   1. 描述，别堆标签——masterpiece / 8k / best quality 在这里不是质量开关；
  //   2. 具体化——red dress → deep oxblood satin dress；
  //   3. 写清光源位置——这是官方认定的「最大单项提升」；
  //   4. 一个主体一个动作，动作崩了先简化；
  //   5. 要画面里出现文字，就用引号把原文括起来。
  // 子句之间用逗号连接即可（官方示例也是这个写法），但每段都要在「描述东西」。
  // ============================================================

  // 完整配方：一条就是一张图的全部描述，选中直接替换提示词。
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

  // 可拼装子句：每条都是「描述一件事」的短语，逗号连接进自己的句子里。
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

  // 角色描述：Krea 不懂 Danbooru 罗马音，用「年龄 + 外观 + 服装」的英文短句。
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

  // Krea Turbo 在 CFG 1 下根本不做负面分支（桥接层直接 ConditioningZeroOut），
  // 所以这些词只在用户手动把 CFG 抬到 >1 时才会真正生效——UI 上会提示这点。
  const KREA_NEGATIVE_TAG_GROUPS = [
    { id: "n_struct", name: "结构", hint: "仅 CFG>1 时生效", tags: [
      ["extra limbs", "多余肢体"],
      ["fused fingers", "手指粘连"],
      ["malformed hands", "手部畸形"],
      ["duplicated head", "头部重复"],
      ["twisted torso", "躯干扭曲"],
      ["floating objects", "物体悬空"],
      ["bad perspective", "透视错误"],
      ["cropped awkwardly", "裁切生硬"]
    ] },
    { id: "n_quality", name: "画质", hint: "仅 CFG>1 时生效", tags: [
      ["blurry", "模糊"],
      ["oversharpened", "过度锐化"],
      ["plastic skin", "塑料皮肤"],
      ["overexposed", "过曝"],
      ["underexposed", "欠曝"],
      ["banding", "色阶断层"],
      ["jpeg artifacts", "压缩噪点"],
      ["harsh flash", "生硬闪光"]
    ] },
    { id: "n_mark", name: "水印文字", hint: "仅 CFG>1 时生效", tags: [
      ["watermark", "水印"],
      ["signature", "签名"],
      ["logo", "标识"],
      ["caption text", "说明文字"],
      ["frame border", "边框"],
      ["collage", "拼图感"]
    ] }
  ];

  // 归一化成与 MOSS 预设库同构的分组，共用一套渲染器。
  // mode=replace：整段配方，点击直接替换提示词（一条就是一整张图的描述）；
  // mode=append ：可拼装子句，点击追加/移除（和 MOSS 的行为一致）。
  const KREA_LIBRARY_GROUPS = [
    ...KREA_PRESET_GROUPS.map((group) => ({
      id: `r_${group.id}`, label: `配方 · ${group.label}`, mode: "replace", items: group.items
    })),
    ...KREA_TAG_GROUPS.map((group) => ({
      id: `t_${group.id}`, label: group.name, mode: "append", hint: group.hint,
      items: group.tags.map(([text, zh]) => ({ id: text, label: zh, text }))
    })),
    ...KREA_CHARACTER_GROUPS.map((group) => ({
      id: `c_${group.id}`, label: `角色 · ${group.name}`, mode: "append",
      items: group.tags.map(([text, zh]) => ({ id: text, label: zh, text }))
    }))
  ];

  // 采样组合按架构分组。SDXL（Pony / 通用）沿用 Karras 系；
  // Anima 是流匹配模型，官方与作者推荐 Euler 系 + SGM Uniform / Beta，
  // Karras / Exponential 这类给传统扩散模型设计的 sigma 曲线不列入 Anima。
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

  const VAE_AUTO = "Automatic";
  const DEFAULT_CLIP_SKIP = 2;
  const DEFAULT_UPSCALER = "Lanczos";
  const UPSCALER_FALLBACKS = [
    { value: "Latent", label: "Latent · 最快" },
    { value: "Lanczos", label: "Lanczos · 通用" },
    { value: "Nearest", label: "Nearest · 硬边" }
  ];
  const UPSCALER_LABELS = {
    // 本地超分模型：名字直接说明擅长什么，别让人对着文件名猜。
    "4x-UltraSharp.safetensors": "UltraSharp · 通用锐利",
    "4x_foolhardy_Remacri.safetensors": "Remacri · 自然写实",
    "RealESRGAN_x4plus_anime_6B.pth": "Anime6B · 动漫线条",
    "RealESRGAN_x4plus.pth": "RealESRGAN · 写实基线",
    "4x-AnimeSharp.pth": "AnimeSharp · 动漫锐化",
    "2x-AnimeSharpV3.pth": "AnimeSharpV3 · 2x 动漫",
    "Latent": "Latent · 最快",
    "Latent (antialiased)": "Latent AA · 抗锯齿",
    "Latent (bicubic)": "Latent bicubic · 平滑",
    "Latent (bicubic antialiased)": "Latent bicubic AA",
    "Latent (nearest)": "Latent nearest · 硬边",
    "Latent (nearest-exact)": "Latent nearest-exact",
    "Lanczos": "Lanczos · 通用",
    "Nearest": "Nearest · 硬边"
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

  // 角色预设：一条写入「角色 + 系列 + 外观」多个标签，避免只写角色名时脸和发色跑偏。
  // 成年库与全年龄库分开存放、分开渲染；全年龄库不写任何成人或性化标签。
  // 数据独立放在 assets/characters.js 与 assets/characters-normal.js，与标签库分开。
  function characterGroupSource(source) {
    return (source && Array.isArray(source.groups))
      ? source.groups.filter((group) => group && Array.isArray(group.tags) && group.tags.length > 0)
      : [];
  }
  const ADULT_CHARACTER_GROUPS = characterGroupSource(window.KLOCK_CHARACTERS);
  const NORMAL_CHARACTER_GROUPS = characterGroupSource(window.KLOCK_NORMAL_CHARACTERS);
  const ADULT_CHARACTER_TOTAL = ADULT_CHARACTER_GROUPS.reduce((sum, group) => sum + group.tags.length, 0);
  const NORMAL_CHARACTER_TOTAL = NORMAL_CHARACTER_GROUPS.reduce((sum, group) => sum + group.tags.length, 0);
  const CHARACTER_LIBRARIES = {
    adult: {
      id: "adult", name: "成年角色", allAges: false,
      groups: ADULT_CHARACTER_GROUPS, total: ADULT_CHARACTER_TOTAL
    },
    allages: {
      id: "allages", name: "全年龄角色", allAges: true,
      groups: NORMAL_CHARACTER_GROUPS, total: NORMAL_CHARACTER_TOTAL
    }
  };
  const CHARACTER_TOTAL = ADULT_CHARACTER_TOTAL + NORMAL_CHARACTER_TOTAL;

  // 标签以 [写入提示词的英文, 界面中文] 成对保存；角色组第一项是逗号分隔的标签包。
  // 正向 19 个基础组（角色库独立）；负面 171 个 / 11 组。
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

  // 负面标签库只收录画质、结构、水印等排错词。
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

  const ALL_RECIPE_TAGS = [...new Set(RECIPES.flatMap((recipe) => recipe.tags.split(",").map((tag) => tag.trim())))];
  const DEFAULT_SETTINGS = {
    prompt: DEFAULT_PROMPT,
    negative: DEFAULT_NEGATIVE,
    width: 1024, height: 1024, ratioKey: "1:1",
    quality: "standard", steps: 24, cfg: 5.5,
    sampler: "Euler a", scheduler: "Karras", shift: 3.5,
    clipSkip: DEFAULT_CLIP_SKIP, vae: VAE_AUTO, hrUpscaler: DEFAULT_UPSCALER,
    seed: -1, seedLocked: false,
    batch: 1, hires: false, hrScale: 1.25, hrDenoise: 0.4,
    easyCache: true, lowVram: false,
    controlModel: "", controlStrength: 1,
    img2imgDenoise: 0.55, mode: "txt2img", loras: [],
    detailEnhance: false, detailScale: 1.25,
    // 手动评级：auto 保持 raw 直出（不写评级标签），其余档位在生成时注入。
    rating: "auto"
  };

  /* ----------------------------------------------------------------- icons */
  const ICONS = {
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
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

  function icon(name, size = 18) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.sparkles}</svg>`;
  }

  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      if (el.dataset.iconReady === "1") return;
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size || 18));
      el.dataset.iconReady = "1";
    });
  }

  /* --------------------------------------------------------------- elements */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = {
    status: $("#status"), statusText: $("#statusText"), statusShort: $("#statusShort"), statusModel: $("#statusModel"),
    modelPicker: $("#modelPicker"), modelMenu: $("#modelMenu"), modelMenuCount: $("#modelMenuCount"),
    modelOptions: $("#modelOptions"), modelMenuRefresh: $("#modelMenuRefresh"),
    modelMenuStatus: $("#modelMenuStatus"), modelMenuStatusText: $("#modelMenuStatusText"), modelMenuHint: $("#modelMenuHint"),
    galleryBtn: $("#galleryBtn"), themeBtn: $("#themeBtn"), themeMenu: $("#themeMenu"), themeIcon: $("#themeIcon"),
    themeLabel: $("#themeLabel"), themeMenuHint: $("#themeMenuHint"), helpBtn: $("#helpBtn"), modeGroup: $("#modeGroup"), myPresetsBtn: $("#myPresetsBtn"),
    prompt: $("#prompt"), negative: $("#negative"), promptCount: $("#promptCount"), negSummary: $("#negSummary"), negHelper: $("#negHelper"),
    promptDraft: $("#promptDraft"), promptDraftTitle: $("#promptDraftTitle"),
    promptDraftNote: $("#promptDraftNote"), promptDraftState: $("#promptDraftState"),
    promptDraftNotes: $("#promptDraftNotes"),
    promptDraftBody: $("#promptDraftBody"), promptDraftTools: $("#promptDraftTools"),
    promptDraftRetry: $("#promptDraftRetry"), promptDraftEdit: $("#promptDraftEdit"),
    promptDraftCopy: $("#promptDraftCopy"), promptDraftHide: $("#promptDraftHide"),
    promptDraftOpen: $("#promptDraftOpen"), promptDraftEditorWrap: $("#promptDraftEditorWrap"),
    promptDraftEditor: $("#promptDraftEditor"), promptDraftSave: $("#promptDraftSave"),
    promptDraftCancel: $("#promptDraftCancel"),
    styleStrip: $("#styleStrip"), mossLayoutHint: $("#mossLayoutHint"), dicePromptBtn: $("#dicePromptBtn"),
    cleanPromptBtn: $("#cleanPromptBtn"), copyPromptBtn: $("#copyPromptBtn"),
    openNegativeInspiration: $("#openNegativeInspiration"),
    promptConvert: $("#promptConvertBtn"),
    ratingPicker: $("#ratingPicker"), ratingBtn: $("#ratingBtn"), ratingMenu: $("#ratingMenu"),
    ratingLabel: $("#ratingLabel"),
    qualityGroup: $("#qualityGroup"), qualityHint: $("#qualityHint"), gachaQualityBtn: $("#gachaQualityBtn"), gachaHint: $("#gachaHint"), ratioGrid: $("#ratioGrid"), sizeHint: $("#sizeHint"),
    ratioSelect: $("#ratioSelect"),
    sendSummary: $("#sendSummary"), sendSummaryDetail: $("#sendSummaryDetail"),
    batchCompare: $("#batchCompare"), batchCompareStrip: $("#batchCompareStrip"), batchCompareCount: $("#batchCompareCount"),
    modelBlock: $("#modelBlock"), modelHint: $("#modelHint"), modelNote: $("#modelNote"),
    modelProfileNote: $("#modelProfileNote"), applyModelProfile: $("#applyModelProfile"),
    loraBlock: $("#loraBlock"), loraHint: $("#loraHint"), loraNote: $("#loraNote"), loraHelper: $("#loraHelper"),
    loraActiveChips: $("#loraActiveChips"), manageLorasBtn: $("#manageLorasBtn"),
    loraDialog: $("#loraDialog"), loraList: $("#loraList"), loraCats: $("#loraCats"), loraEmpty: $("#loraEmpty"),
    loraDialogHint: $("#loraDialogHint"), refreshLorasBtn: $("#refreshLorasBtn"), closeLoraDialog: $("#closeLoraDialog"),
    advanced: $("#advanced"),
    sampler: $("#sampler"), scheduler: $("#scheduler"), steps: $("#steps"), stepsOut: $("#stepsOut"),
    samplerPresets: $("#samplerPresets"), samplerPresetHint: $("#samplerPresetHint"),
    samplerAdvice: $("#samplerAdvice"),
    animaBlock: $("#animaBlock"), animaHint: $("#animaHint"), shift: $("#shift"), shiftOut: $("#shiftOut"), shiftLabel: $("#shiftLabel"),
    cfg: $("#cfg"), cfgOut: $("#cfgOut"), seedLock: $("#seedLock"), seed: $("#seed"), diceSeed: $("#diceSeed"),
    engineHint: $("#engineHint"), clipSkip: $("#clipSkip"), clipHelper: $("#clipHelper"), vae: $("#vae"), vaeHelper: $("#vaeHelper"),
    batch: $("#batch"), batchPicker: $("#batchPicker"), batchBtn: $("#batchBtn"), batchMenu: $("#batchMenu"),
    batchLabel: $("#batchLabel"), batchNote: $("#batchNote"),
    hires: $("#hires"), hiresOptions: $("#hiresOptions"), hrScale: $("#hrScale"),
    hrUpscaler: $("#hrUpscaler"), hrUpscalerHelper: $("#hrUpscalerHelper"),
    hrDenoise: $("#hrDenoise"), hrOut: $("#hrOut"), hrWarn: $("#hrWarn"),
    easyCache: $("#easyCache"), lowVram: $("#lowVram"), perfHint: $("#perfHint"),
    customW: $("#customW"), customH: $("#customH"), refBlock: $("#refBlock"),
    dropzone: $("#dropzone"), dropzoneEmpty: $("#dropzoneEmpty"), refPreview: $("#refPreview"), refImg: $("#refImg"),
    maskEnable: $("#maskEnable"), maskOptions: $("#maskOptions"), maskStage: $("#maskStage"),
    maskBase: $("#maskBase"), maskCanvas: $("#maskCanvas"),
    brushSize: $("#brushSize"), brushOut: $("#brushOut"),
    maskClear: $("#maskClear"), maskStat: $("#maskStat"),
    refName: $("#refName"), refMeta: $("#refMeta"), refSize: $("#refSize"), refActions: $("#refActions"),
    fileInput: $("#fileInput"), replaceRef: $("#replaceRef"), removeRef: $("#removeRef"), refHint: $("#refHint"),
    controlGroup: $("#controlnetGroup"), controlModel: $("#controlModel"),
    controlPickBtn: $("#controlPickBtn"), controlImageInput: $("#controlImageInput"),
    controlStrength: $("#controlStrength"), controlStrengthOut: $("#controlStrengthOut"),
    controlnetHint: $("#controlnetHint"),
    styleRefGroup: $("#styleRefGroup"), styleRefHint: $("#styleRefHint"),
    styleRefPickBtn: $("#styleRefPickBtn"), styleRefClearBtn: $("#styleRefClearBtn"),
    styleRefInput: $("#styleRefInput"), styleRefStrip: $("#styleRefStrip"),
    initDenoise: $("#initDenoise"), denoiseOut: $("#denoiseOut"),
    refinePresetsBtn: $("#refinePresetsBtn"), refineDialog: $("#refineDialog"),
    refineList: $("#refineList"), closeRefineDialog: $("#closeRefineDialog"),
    generate: $("#generate"), generateMobile: $("#generateMobile"),
    mobileProgress: $("#mobileProgress"), mobileProgressBar: $("#mobileProgressBar"),
    mobileMode: $("#mobileMode"), mobileHint: $("#mobileHint"), stopMobile: $("#stopMobile"),
    composer: $("#composer"), mobileViews: $("#mobileViews"), mobileToPrompt: $("#mobileToPrompt"),
    modeBadge: $("#modeBadge"), stage: $("#stage"),
    placeholder: $("#placeholder"), placeholderTitle: $("#placeholderTitle"), placeholderHint: $("#placeholderHint"), placeholderHintMobile: $("#placeholderHintMobile"), placeholderIdeas: $("#placeholderIdeas"),
    canvasFrame: $("#canvasFrame"), result: $("#result"), busyOverlay: $("#busyOverlay"),
    liveStage: $("#liveStage"), livePreview: $("#livePreview"), liveStep: $("#liveStep"),
    progressPanel: $("#progressPanel"), progressText: $("#progressText"), etaText: $("#etaText"),
    batchText: $("#batchText"), progressBar: $("#progressBar"), stopInline: $("#stopInline"),
    resultInfo: $("#resultInfo"), metaChips: $("#metaChips"), download: $("#download"),
    favoriteCurrent: $("#favoriteCurrent"), favoriteIcon: $("#favoriteIcon"), favoriteLabel: $("#favoriteLabel"),
    sameSeed: $("#sameSeed"), again: $("#again"), toImg2img: $("#toImg2img"), loadParams: $("#loadParams"),
    history: $("#history"), historyCount: $("#historyCount"), historyEmpty: $("#historyEmpty"), clearHistory: $("#clearHistory"),
    openGallery: $("#openGallery"), galleryDialog: $("#galleryDialog"), galleryFilter: $("#galleryFilter"),
    galleryGrid: $("#galleryGrid"), galleryStatus: $("#galleryStatus"), galleryCount: $("#galleryCount"),
    galleryEmpty: $("#galleryEmpty"), galleryEmptyTitle: $("#galleryEmptyTitle"), galleryEmptyHint: $("#galleryEmptyHint"),
    galleryMore: $("#galleryMore"), galleryMoreWrap: $("#galleryMoreWrap"), closeGallery: $("#closeGallery"),
    galleryRefresh: $("#galleryRefresh"), galleryOpenFolder: $("#galleryOpenFolder"),
    gallerySelect: $("#gallerySelect"), gallerySelectBar: $("#gallerySelectBar"),
    gallerySelectCount: $("#gallerySelectCount"), gallerySelectAll: $("#gallerySelectAll"),
    gallerySelectClear: $("#gallerySelectClear"), gallerySelectDone: $("#gallerySelectDone"),
    galleryBatchBar: $("#galleryBatchBar"), galleryBatchCount: $("#galleryBatchCount"),
    galleryBatchFavorite: $("#galleryBatchFavorite"), galleryBatchFavoriteLabel: $("#galleryBatchFavoriteLabel"),
    galleryBatchExport: $("#galleryBatchExport"), galleryBatchSend: $("#galleryBatchSend"),
    galleryBatchDelete: $("#galleryBatchDelete"),
    detailEnhance: $("#detailEnhance"), detailOptions: $("#detailOptions"),
    detailScale: $("#detailScale"), detailHint: $("#detailHint"),
    galleryInfoDialog: $("#galleryInfoDialog"), galleryInfoDesc: $("#galleryInfoDesc"),
    galleryInfoStatus: $("#galleryInfoStatus"), galleryInfoPromptSection: $("#galleryInfoPromptSection"),
    galleryInfoPrompt: $("#galleryInfoPrompt"), galleryInfoNegativeSection: $("#galleryInfoNegativeSection"),
    galleryInfoNegative: $("#galleryInfoNegative"), galleryInfoMetaSection: $("#galleryInfoMetaSection"),
    galleryInfoMeta: $("#galleryInfoMeta"), galleryInfoMetaHint: $("#galleryInfoMetaHint"),
    galleryInfoCopyPrompt: $("#galleryInfoCopyPrompt"), galleryInfoCopyNegative: $("#galleryInfoCopyNegative"),
    galleryInfoSend: $("#galleryInfoSend"), galleryInfoLoad: $("#galleryInfoLoad"), closeGalleryInfo: $("#closeGalleryInfo"),
    openOutput: $("#openOutput"), openOutputFoot: $("#openOutputFoot"),
    inspirationDialog: $("#inspirationDialog"), presetSearch: $("#presetSearch"), presetResultCount: $("#presetResultCount"),
    tagTargetSwitch: $("#tagTargetSwitch"), tagTargetCount: $("#tagTargetCount"), tagGroupNav: $("#tagGroupNav"),
    libraryScroll: $("#libraryScroll"), libraryDesc: $("#libraryDesc"), libraryNote: $("#libraryNote"),
    recipeSection: $("#recipeSection"), tagSectionTitle: $("#tagSectionTitle"), tagSectionHint: $("#tagSectionHint"),
    tagSelectedCount: $("#tagSelectedCount"), resetNegativeTags: $("#resetNegativeTags"),
    recipeGrid: $("#recipeGrid"), recipeEmpty: $("#recipeEmpty"), recipeRailCount: $("#recipeRailCount"),
    railToggle: $("#railToggle"),
    tagGroups: $("#tagGroups"), presetEmpty: $("#presetEmpty"), closeInspiration: $("#closeInspiration"),
    artistDialog: $("#artistDialog"), artistDesc: $("#artistDesc"),
    artistPicks: $("#artistPicks"), artistPickCount: $("#artistPickCount"), artistPickEmpty: $("#artistPickEmpty"),
    artistBalanceBtn: $("#artistBalanceBtn"), artistPrimaryBtn: $("#artistPrimaryBtn"), artistClearBtn: $("#artistClearBtn"),
    artistPreview: $("#artistPreview"), artistPreviewCount: $("#artistPreviewCount"), applyArtistsBtn: $("#applyArtistsBtn"),
    artistSearch: $("#artistSearch"), artistResultCount: $("#artistResultCount"), artistGroupNav: $("#artistGroupNav"),
    artistGroups: $("#artistGroups"), artistEmpty: $("#artistEmpty"), artistScroll: $("#artistScroll"),
    closeArtistDialog: $("#closeArtistDialog"),
    characterDialog: $("#characterDialog"), characterDesc: $("#characterDesc"),
    characterModeSwitch: $("#characterModeSwitch"),
    characterSearch: $("#characterSearch"), characterResultCount: $("#characterResultCount"),
    characterGroupNav: $("#characterGroupNav"), characterGroups: $("#characterGroups"),
    characterEmpty: $("#characterEmpty"), characterScroll: $("#characterScroll"),
    characterNote: $("#characterNote"),
    closeCharacterDialog: $("#closeCharacterDialog"),
    savePresetDialog: $("#savePresetDialog"), presetName: $("#presetName"), cancelSavePreset: $("#cancelSavePreset"),
    confirmSavePreset: $("#confirmSavePreset"),
    savedDialog: $("#savedDialog"), savedList: $("#savedList"), savedEmpty: $("#savedEmpty"),
    saveCurrentFromList: $("#saveCurrentFromList"), closeSaved: $("#closeSaved"),
    promptCard: $("#promptCard"), paramCard: $("#paramCard"),
    presetFileInput: $("#presetFileInput"), importPresetFile: $("#importPresetFile"),
    exportPresetFile: $("#exportPresetFile"),
    helpDialog: $("#helpDialog"), closeHelp: $("#closeHelp"),
    lightboxDialog: $("#lightboxDialog"), lightboxImg: $("#lightboxImg"), lightboxBody: $(".lightbox-body"), lightboxDownload: $("#lightboxDownload"),
    lightboxInfo: $("#lightboxInfo"), closeLightbox: $("#closeLightbox"),
    lightboxPrev: $("#lightboxPrev"), lightboxNext: $("#lightboxNext"), lightboxCounter: $("#lightboxCounter"),
    lightboxZoom: $("#lightboxZoom"), lightboxHeadActions: $("#lightboxHeadActions"),
    lightboxFavorite: $("#lightboxFavorite"), lightboxFavoriteIcon: $("#lightboxFavoriteIcon"),
    lightboxSend: $("#lightboxSend"), lightboxDelete: $("#lightboxDelete"),
    lightboxUpscale: $("#lightboxUpscale"),
    queueBtn: $("#queueBtn"), queueCount: $("#queueCount"), queueDialog: $("#queueDialog"),
    queueStatus: $("#queueStatus"), queueList: $("#queueList"), closeQueue: $("#closeQueue"),
    galleryInfoUpscale: $("#galleryInfoUpscale"),
    upscaleDialog: $("#upscaleDialog"), upscalePreview: $("#upscalePreview"), upscaleImg: $("#upscaleImg"),
    upscaleEmpty: $("#upscaleEmpty"), upscaleScale: $("#upscaleScale"), upscaleAlgo: $("#upscaleAlgo"),
    upscaleMeta: $("#upscaleMeta"), upscalePreviewBtn: $("#upscalePreviewBtn"),
    upscaleNativeHint: $("#upscaleNativeHint"), upscaleHint: $("#upscaleHint"),
    promptChips: $("#promptChips"),
    translateSwitch: $("#translateSwitch"), promptDraftConfirm: $("#promptDraftConfirm"),
    paramFold: $("#paramFold"), paramCard: $(".param-card"), paramBody: $("#paramBody"),
    interrogateBtn: $("#interrogateBtn"), interrogateFile: $("#interrogateFile"),
    upscaleSave: $("#upscaleSave"), upscaleExport: $("#upscaleExport"), closeUpscale: $("#closeUpscale")
  };

  // 远程访问时“打开本机文件夹”没有意义，隐藏入口；服务端也会拒绝。

  /* -------------------------------------------------------- mobile views */
  // ≤960 用三视图工作区代替长表单；桌面端只记状态，不参与布局。
  const MOBILE_VIEWS = ["prompt", "params", "canvas"];
  const mobileViewState = {
    current: "prompt",
    scrolls: { prompt: 0, params: 0, canvas: 0 }
  };
  function isMobileLayout() {
    return window.matchMedia("(max-width: 960px)").matches;
  }
  function setMobileView(view, { scroll = false, top = null } = {}) {
    const next = MOBILE_VIEWS.includes(view) ? view : "prompt";
    const mobile = isMobileLayout();
    if (mobile && mobileViewState.current !== next) {
      mobileViewState.scrolls[mobileViewState.current] = window.scrollY;
    }
    mobileViewState.current = next;
    if (el.composer) el.composer.dataset.mobileView = next;
    if (el.mobileViews) {
      $$(".mobile-view", el.mobileViews).forEach((button) => {
        const active = button.dataset.mobileTarget === next;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    if (!mobile || !scroll) return;
    const target = top != null ? top : (mobileViewState.scrolls[next] || 0);
    // 等视图显隐完成、页面高度稳定后再落点，否则 scrollTop 会被旧高度截断。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: target, left: 0, behavior: "auto" });
    }));
  }
  setMobileView("prompt");

  const state = {
    mode: "txt2img",
    width: 1024, height: 1024, ratioKey: "1:1", qualityKey: "standard",
    // AnimaLLLite 控制图：base64 只在内存里，太大不适合进 localStorage。
    controlImage: "",
    // Krea 风格参考图：最多 3 张，同样只存内存，不落 localStorage。
    styleRefImages: [],
    refinePresetId: "",
    busy: false,
    stopping: false,
    online: false,
    activeModel: "",
    models: [],
    modelsLoaded: false,
    modelsLoading: false,
    modelSwitching: false,
    modelProfileId: "",
    activeArch: "",
    activePreset: "",
    archByModel: {},
    animaModules: [],
    animaReady: false,
    kreaModules: [],
    kreaReady: false,
    samplerPresetArch: "",
    catalogLoaded: false,
    catalogLoading: false,
    loras: [],
    activeLoras: [],
    lorasLoaded: false,
    lorasLoading: false,
    vaeOptions: [],
    upscalerOptions: [],
    interrogating: false,
    translateEnabled: true,
    loraCategory: "all",
    promptConfirmPending: false,
    engineOptionsLoaded: false,
    engineOptionsLoading: false,
    statusSeq: 0,
    pollTimer: null,
    hideTimer: null,
    saveTimer: null,
    restoring: false,
    startedAt: 0,
    lastPreview: "",
    previewStep: "",
    lightboxItem: null,
    lightboxNavBusy: false,
    current: null,
    history: [],
    initImage: null,
    theme: "auto",
    rating: "auto",
    batchOptionsSig: "",
    tagTarget: "positive",
    activeTagGroup: "",
    characterMode: "adult",
    activeCharacterGroup: "",
    activeRecipes: new Set(),
    promptDraft: null,
    promptDraftBusy: false,
    promptDraftSeq: 0,
    promptDraftError: "",
    promptDraftCollapsed: false,
    promptDraftEditing: false,
    converting: false,
    submitting: false,
    jobPhase: "idle",
    queuePosition: 0,
    activeJobId: "",
    jobRuns: new Map(),
    pendingCount: 0,
    queueTimer: null,
    queueBusy: false,
    queuePending: 0,
    upscaleItem: null,
    upscalePreview: "",
    upscaleSavedPath: "",
    upscaleBusy: false,
    galleryInfoItem: null,
    galleryInfoData: null,
    galleryInfoSeq: 0
  };

  const galleryState = {
    items: [], filter: "all", offset: 0, fetched: 0, limit: 48,
    total: 0, favoriteTotal: 0, hasMore: false,
    loading: false, requestId: 0,
    selecting: false, selected: new Set(), batchBusy: false
  };
  const GALLERY_SELECT_MAX = 200;

  /* --------------------------------------------------------------- 画师预设 */
  const ARTIST_GROUPS = (window.KLOCK_ARTISTS && Array.isArray(window.KLOCK_ARTISTS.groups))
    ? window.KLOCK_ARTISTS.groups
    : [];
  const ARTIST_LOOKUP = new Map();
  const ARTIST_GROUP_NAMES = new Map();
  for (const group of ARTIST_GROUPS) {
    ARTIST_GROUP_NAMES.set(group.id, group.name);
    for (const artist of group.artists) {
      artist.groupId = group.id;
      ARTIST_LOOKUP.set(normalizeArtistKey(artist.tag), artist);
    }
  }
  const ARTIST_TOTAL = ARTIST_GROUPS.reduce((sum, group) => sum + group.artists.length, 0);
  const artistState = { picks: [], query: "", group: "all" };

  /* --------------------------------------------------------------- helpers */
  function splitTags(text) {
    return String(text || "")
      .replace(/\r?\n/g, ",")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function normalizePrompt(text) {
    const seen = new Set();
    const tags = [];
    for (const tag of splitTags(text)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    return tags.join(", ");
  }

  function hasTag(text, tag) {
    const key = String(tag).trim().toLowerCase();
    return splitTags(text).some((item) => item.toLowerCase() === key);
  }

  // 标签包：角色预设一条包含角色、系列与外观，点选时整组增删。
  function tagBundle(tag) {
    return String(tag).split(",").map((item) => item.trim()).filter(Boolean);
  }

  function hasBundle(text, tag) {
    return tagBundle(tag).every((item) => hasTag(text, item));
  }

  // 记录每个标签包实际新增过哪些词：取消角色预设时只撤掉自己加的词，
  // 不误删用户原本就写着的 long hair / purple eyes 等通用外观。记录存本机，刷新后仍能精确撤销。
  const BUNDLE_OWNED_KEY = "klock.bundleOwned";
  const bundleAdditions = new Map(
    Object.entries(readJSON(BUNDLE_OWNED_KEY, {})).map(([key, list]) => [key, new Set(Array.isArray(list) ? list : [])])
  );

  function persistBundleAdditions() {
    const out = {};
    for (const [key, owned] of bundleAdditions) {
      if (owned && owned.size) out[key] = [...owned];
    }
    writeJSON(BUNDLE_OWNED_KEY, out);
  }

  function mergeTags(text, tags) {
    let out = splitTags(text);
    const seen = new Set(out.map((tag) => tag.toLowerCase()));
    for (const tag of tags) {
      const clean = String(tag).trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
    return out.join(", ");
  }

  function removeTags(text, tags) {
    const removal = new Set(tags.map((tag) => String(tag).trim().toLowerCase()));
    return splitTags(text).filter((tag) => !removal.has(tag.toLowerCase())).join(", ");
  }

  function recipeIsActive(recipe) {
    return recipe.tags.split(",").map((tag) => tag.trim()).every((tag) => hasTag(el.prompt.value, tag));
  }

  function recipeById(id) {
    return RECIPES.find((recipe) => recipe.id === id);
  }

  /* ------------------------------------------------------------ 画师标签 */
  function normalizeArtistKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\\/g, "")
      .replace(/^@/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseArtistTag(raw) {
    let value = String(raw || "").trim();
    let weight = 1;
    const weighted = value.match(/^\((.*):([0-9]+(?:\.[0-9]+)?)\)$/s);
    if (weighted) {
      value = weighted[1].trim();
      weight = Number(weighted[2]);
    }
    if (!value.startsWith("@")) return null;
    const name = value.slice(1).trim();
    if (!name) return null;
    return {
      name: name.replace(/\\\(/g, "(").replace(/\\\)/g, ")"),
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1
    };
  }

  function promptArtists() {
    return splitTags(el.prompt.value)
      .map(parseArtistTag)
      .filter(Boolean)
      .map((parsed) => {
        const key = normalizeArtistKey(parsed.name);
        const found = ARTIST_LOOKUP.get(key);
        if (found) {
          return {
            key, tag: found.tag, name: found.name, styles: found.styles.slice(),
            group: found.groupId, custom: false, weight: parsed.weight
          };
        }
        return {
          key, tag: "@" + parsed.name, name: parsed.name, styles: [],
          group: "", custom: true, weight: parsed.weight
        };
      });
  }

  function stripArtistTags(text) {
    return splitTags(text).filter((tag) => !parseArtistTag(tag)).join(", ");
  }

  function formatArtistWeight(weight) {
    return String(Number(Number(weight).toFixed(2)));
  }

  function escapeArtistTag(tag) {
    return String(tag || "")
      .trim()
      .replace(/\\/g, "")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function formatArtistTag(entry) {
    const base = escapeArtistTag(entry.tag);
    const weight = clamp(Number(entry.weight) || 1, 0.2, 1.5);
    return Math.abs(weight - 1) < 0.005
      ? base
      : `(${base}:${formatArtistWeight(weight)})`;
  }

  function artistSegment() {
    return artistState.picks.map(formatArtistTag).join(", ");
  }

  const ARTIST_META_TAGS = new Set([
    "masterpiece", "best quality", "amazing quality", "very aesthetic", "high quality",
    "good quality", "normal quality", "worst quality", "low quality", "absurdres",
    "highres", "newest", "recent", "mid", "old", "early",
    "safe", "sensitive", "nsfw", "explicit", "questionable"
  ]);
  const ARTIST_COUNT_RE = /^(?:solo|no humans|male focus|female focus|\d+\+?(?:girl|boy|other)s?|multiple (?:girls|boys|others))$/;

  function isArtistMetaTag(tag) {
    const low = String(tag || "").trim().toLowerCase();
    return ARTIST_META_TAGS.has(low)
      || /^rating (?:safe|sensitive|nsfw|explicit|questionable)$/.test(low)
      || /^year \d{4}$/.test(low)
      || /^20\d\d$/.test(low)
      || /^score[_ ]\d+/.test(low);
  }

  function insertArtistTags(text, segment) {
    const tags = splitTags(text);
    if (!segment) return normalizePrompt(tags.join(", "));
    let at = 0;
    while (
      at < tags.length
      && (isArtistMetaTag(tags[at]) || ARTIST_COUNT_RE.test(tags[at].trim().toLowerCase()))
    ) {
      at += 1;
    }
    tags.splice(at, 0, ...splitTags(segment));
    return normalizePrompt(tags.join(", "));
  }

  function artistPickIndex(key) {
    return artistState.picks.findIndex((pick) => pick.key === key);
  }

  function refreshArtistChip() {
    const chip = $("#artistChip");
    if (!chip) return;
    const count = promptArtists().length;
    const badge = $("#artistChipCount");
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
    chip.title = count ? `提示词里有 ${count} 位画师` : "选择画师风格预设";
  }

  function countTags(text) {
    return splitTags(text).length;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round8(value) {
    return Math.max(8, Math.round(value / 8) * 8);
  }

  function formatDateStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn("localStorage", err);
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function dismissSnacks() {
    $$("mdui-snackbar").forEach((node) => { node.open = false; });
  }

  function snack(message, options = {}) {
    // MDUI 原生允许堆叠，连续操作会叠出好几条；这里始终只保留最新一条。
    dismissSnacks();
    const config = {
      message: escapeHtml(message),
      autoCloseDelay: options.bad ? 7000 : 3400
    };
    if (options.action) {
      config.action = options.action;
      config.onActionClick = options.onActionClick;
      config.autoCloseDelay = options.bad ? 8000 : 6000;
    }
    try {
      mdui.snackbar(config);
    } catch (err) {
      console.warn("snackbar", err);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function blobFromBase64(b64) {
    const raw = String(b64).replace(/^data:image\/\w+;base64,/, "");
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  }

  function extractError(data, status) {
    if (!data) return "HTTP " + status;
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((item) => item?.msg || JSON.stringify(item)).join("；");
    }
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
    try {
      const text = JSON.stringify(data);
      return text.length > 360 ? text.slice(0, 360) + "…" : text;
    } catch {
      return "HTTP " + status;
    }
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ---------------------------------------------------------------- theme */
  const THEME_META = { light: "#F5F8FA", dark: "#12181C" };
  const THEME_LABELS = { auto: "跟随系统", light: "浅色", dark: "深色" };
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedTheme() {
    if (state.theme === "auto") return systemDark.matches ? "dark" : "light";
    return state.theme === "dark" ? "dark" : "light";
  }

  function updateThemeMeta() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEME_META[resolvedTheme()];
  }

  function applyTheme(theme, { persist = true } = {}) {
    const next = THEMES.includes(theme) ? theme : "auto";
    state.theme = next;
    try { mdui.setTheme(next); } catch { /* ignore */ }
    const label = THEME_LABELS[next];
    el.themeIcon.innerHTML = icon(next === "dark" ? "moon" : next === "light" ? "sun" : "monitor", 19);
    el.themeLabel.textContent = label;
    el.themeBtn.title = `外观：${label}`;
    el.themeBtn.setAttribute("aria-label", `外观：${label}；打开明暗模式菜单`);
    $$(".theme-option", el.themeMenu).forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset.themeValue === next));
    });
    el.themeMenuHint.textContent = next === "auto"
      ? `当前：跟随系统 · ${resolvedTheme() === "dark" ? "深色" : "浅色"}`
      : `当前：${label}`;
    updateThemeMeta();
    if (persist) {
      try { localStorage.setItem(STORE_THEME, next); } catch { /* ignore */ }
    }
  }

  function setThemeMenu(open) {
    const next = Boolean(open);
    el.themeMenu.classList.toggle("open", next);
    el.themeBtn.setAttribute("aria-expanded", String(next));
    if (next) {
      const current = el.themeMenu.querySelector(`.theme-option[data-theme-value="${state.theme}"]`);
      current?.focus({ preventScroll: true });
    }
  }

  function closeThemeMenu({ restoreFocus = false } = {}) {
    if (!el.themeMenu.classList.contains("open")) return;
    setThemeMenu(false);
    if (restoreFocus) el.themeBtn.focus({ preventScroll: true });
  }

  /* ----------------------------------------------------------- manual rating */
  const RATINGS = ["auto", "safe", "sensitive", "nsfw", "explicit"];
  const RATING_LABELS = { auto: "自动", safe: "安全", sensitive: "敏感", nsfw: "NSFW", explicit: "露骨" };
  // Anima 直接用 Danbooru 评级标签；Pony / SDXL 用 rating_ 前缀版本，
  // 它没有 sensitive 档，最接近的 questionable 承接「敏感」与「NSFW」。
  const RATING_TAGS = {
    anima: { safe: "safe", sensitive: "sensitive", nsfw: "nsfw", explicit: "explicit" },
    sdxl: { safe: "rating_safe", sensitive: "rating_questionable", nsfw: "rating_questionable", explicit: "rating_explicit" }
  };
  const RATING_KEYS = new Set(["safe", "sensitive", "nsfw", "explicit", "general", "questionable"]);

  function normalizeRating(value) {
    const next = String(value || "auto").trim().toLowerCase();
    return RATINGS.includes(next) ? next : "auto";
  }

  function ratingKey(tag) {
    return String(tag || "").toLowerCase()
      .replace(/^rating\s*[:_-]?\s*/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isRatingTag(tag) {
    return RATING_KEYS.has(ratingKey(tag));
  }

  function ratingTag(value = state.rating) {
    const next = normalizeRating(value);
    if (next === "auto" || isKreaActive()) return "";
    const table = isAnimaActive() ? RATING_TAGS.anima : RATING_TAGS.sdxl;
    return table[next] || "";
  }

  // 质量/来源类前缀标签：手动评级要排在它们之后，Pony 的 score_9 等不能放到评级后面。
  const RATING_SKIP_TAGS = new Set([
    "masterpiece", "best quality", "great quality", "good quality", "amazing quality",
    "very aesthetic", "aesthetic", "absurdres", "highres", "newest", "recent",
    "ultra detailed", "fair skin", "high contrast",
    "source_photo", "source_anime", "source_cartoon", "source_furry", "source_pony"
  ]);

  function splitQualityPrefix(text) {
    const tags = splitTags(text);
    let index = 0;
    while (index < tags.length) {
      const key = tags[index].toLowerCase();
      if (!RATING_SKIP_TAGS.has(key) && !/^score_[4-9](?:_up)?$/.test(key)) break;
      index += 1;
    }
    if (!index) return { prefix: "", rest: text };
    return { prefix: tags.slice(0, index).join(", ") + ", ", rest: tags.slice(index).join(", ") };
  }

  // 生成时注入：auto 原样返回；手动档位先剔除原有评级词，
  // Anima 写进 Tags 行开头，纯标签提示词写在质量前缀之后。
  function applyManualRating(prompt) {
    const text = String(prompt || "");
    if (state.rating === "auto") return text;
    // MOSS 走自然语言段落，没有 safe/nsfw 标签体系，插标签会破坏句子。
    // Krea 同理：它读的是句子，塞一个裸 "safe" 进去只会被当成普通词。
    const ratingArch = activeProfile()?.arch;
    if (ratingArch === "moss" || ratingArch === "krea") return text;
    const tag = ratingTag();
    if (!tag) return text;
    const marker = text.search(/\nTags:/i);
    if (marker >= 0) {
      const head = text.slice(0, marker);
      const tags = splitTags(text.slice(marker).replace(/^\nTags:\s*/i, ""))
        .filter((item) => !isRatingTag(item));
      return head + "\nTags: " + [tag, ...tags].join(", ");
    }
    const { prefix, rest } = splitQualityPrefix(text);
    const tags = splitTags(rest).filter((item) => !isRatingTag(item));
    return (prefix || "") + [tag, ...tags].join(", ");
  }

  function updateRatingUI() {
    const next = normalizeRating(state.rating);
    el.ratingBtn.dataset.rating = next;
    el.ratingLabel.textContent = RATING_LABELS[next];
    const tag = ratingTag(next);
    el.ratingBtn.title = tag
      ? `手动评级：${RATING_LABELS[next]}（生成时写入 ${tag}）`
      : "手动评级：自动（不写评级标签，保持 raw 直出）";
    el.ratingBtn.setAttribute("aria-label", `手动评级：${RATING_LABELS[next]}；打开评级菜单`);
    $$(".rating-option", el.ratingMenu).forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset.rating === next));
    });
  }

  function applyRating(value, { persist = true, announce = false } = {}) {
    const next = normalizeRating(value);
    state.rating = next;
    updateRatingUI();
    renderPromptDraft();
    updateAdvancedSummary();
    if (persist) {
      scheduleSave();
      if (announce) {
        const tag = ratingTag(next);
        snack(tag ? `评级：${RATING_LABELS[next]} · 生成时写入 ${tag}` : "评级：自动 · 不写评级标签");
      }
    }
  }

  function setRatingMenu(open) {
    const next = Boolean(open);
    el.ratingMenu.classList.toggle("open", next);
    el.ratingBtn.setAttribute("aria-expanded", String(next));
    if (next) {
      updateRatingUI();
      const current = el.ratingMenu.querySelector(`.rating-option[data-rating="${state.rating}"]`);
      current?.focus({ preventScroll: true });
    }
  }

  function closeRatingMenu({ restoreFocus = false } = {}) {
    if (!el.ratingMenu.classList.contains("open")) return;
    setRatingMenu(false);
    if (restoreFocus) el.ratingBtn.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------- 批量张数 */
  function batchOptions() {
    if (el.qualityGroup.value === "gacha") return BATCH_GACHA;
    return BATCH_BASE;
  }

  function renderBatchOptions(options) {
    if (!el.batchMenu) return;
    el.batchMenu.replaceChildren(...options.map((value) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "batch-option";
      option.dataset.batch = String(value);
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", "false");
      const text = document.createElement("span");
      text.className = "batch-option-text";
      text.append(document.createTextNode(`${value} 张`));
      const note = BATCH_NOTES[value];
      if (note) {
        const small = document.createElement("small");
        small.textContent = note;
        text.appendChild(small);
      }
      const check = document.createElement("span");
      check.className = "batch-option-check";
      check.innerHTML = icon("check", 16);
      option.append(text, check);
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        setBatchValue(value, { announce: true });
        closeBatchMenu({ restoreFocus: true });
      });
      return option;
    }));
  }

  function syncBatchUI() {
    if (!el.batchLabel) return;
    const options = batchOptions();
    const value = Number(el.batch.value) || options[0];
    const gacha = el.qualityGroup.value === "gacha";
    el.batchLabel.textContent = `${value} 张`;
    el.batchBtn.setAttribute("aria-label", `批量张数：${value} 张；打开张数菜单`);
    el.batchBtn.title = gacha
      ? `抽卡本批 ${value} 张（单批最多 12 张）`
      : `本批 ${value} 张，按顺序生成`;
    el.batchNote.textContent = gacha ? "抽卡 · 最多 12 张" : "8GB · 建议 1–2 张";
    $$(".batch-option", el.batchMenu).forEach((option) => {
      option.setAttribute("aria-checked", String(Number(option.dataset.batch) === value));
    });
  }

  // 档位变化时重排选项；离开抽卡后把 8/12 收回 4，避免非抽卡档误发大批量。
  function syncBatchOptions({ save = true } = {}) {
    if (!el.batchMenu) return;
    const options = batchOptions();
    const signature = options.join(",");
    if (state.batchOptionsSig !== signature) {
      const wasOpen = el.batchMenu.classList.contains("open");
      renderBatchOptions(options);
      state.batchOptionsSig = signature;
      if (wasOpen) closeBatchMenu();
    }
    let value = Number(el.batch.value) || options[0];
    if (!options.includes(value)) {
      value = options.filter((item) => item <= value).pop() || options[0];
      el.batch.value = String(value);
      updateAdvancedSummary();
      if (save && !state.restoring) scheduleSave();
    }
    syncBatchUI();
    if (el.batchMenu.classList.contains("open")) positionBatchMenu();
  }

  function setBatchValue(value, { announce = false, save = true } = {}) {
    const options = batchOptions();
    const next = options.includes(Number(value)) ? Number(value) : options[0];
    const changed = Number(el.batch.value) !== next;
    el.batch.value = String(next);
    syncBatchUI();
    if (changed) {
      updateAdvancedSummary();
      if (save && !state.restoring) scheduleSave();
    }
    if (announce) {
      snack(`本批 ${next} 张 · ${next > 1 ? "完成后可在画布下方对比" : "逐张生成"}`);
    }
    return next;
  }

  // 菜单用 fixed 定位，逃出参数栏的滚动裁剪；空间不够时向上翻。
  function positionBatchMenu() {
    if (!el.batchMenu || !el.batchBtn) return;
    const rect = el.batchBtn.getBoundingClientRect();
    const menuW = el.batchMenu.offsetWidth || 176;
    const menuH = el.batchMenu.offsetHeight || 210;
    const gap = 8;
    const margin = 8;
    // 移动端底部生成条会挡住菜单，可用高度要先扣掉它。
    const bar = document.querySelector(".mobile-bar");
    const barH = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
    const below = window.innerHeight - barH - rect.bottom - gap;
    const above = rect.top - gap;
    const openUp = below < menuH && above > below;
    // 优先与按钮右缘对齐；贴屏幕左侧时改成左对齐，避免菜单孤零零贴边。
    let left = rect.right - menuW;
    if (left < margin) left = rect.left;
    left = clamp(left, margin, Math.max(margin, window.innerWidth - menuW - margin));
    el.batchMenu.style.left = `${Math.round(left)}px`;
    if (openUp) {
      el.batchMenu.style.top = "auto";
      el.batchMenu.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
    } else {
      el.batchMenu.style.bottom = "auto";
      el.batchMenu.style.top = `${Math.round(rect.bottom + gap)}px`;
    }
    el.batchMenu.classList.toggle("is-up", openUp);
  }

  function setBatchMenu(open, { focus = false } = {}) {
    const next = Boolean(open);
    if (next) positionBatchMenu();
    el.batchMenu.classList.toggle("open", next);
    el.batchBtn.setAttribute("aria-expanded", String(next));
    if (next && focus) {
      const current = el.batchMenu.querySelector('.batch-option[aria-checked="true"]')
        || el.batchMenu.querySelector(".batch-option");
      current?.focus({ preventScroll: true });
    }
  }

  function closeBatchMenu({ restoreFocus = false } = {}) {
    if (!el.batchMenu.classList.contains("open")) return;
    setBatchMenu(false);
    if (restoreFocus) el.batchBtn.focus({ preventScroll: true });
  }

  function cycleBatch() {
    const options = batchOptions();
    const current = Number(el.batch.value) || options[0];
    const index = options.indexOf(current);
    const next = options[(index + 1) % options.length] || options[0];
    setBatchValue(next, { announce: true });
  }

  /* --------------------------------------------------------------- status */
  function normalizeModelName(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .split("/").pop()
      .replace(/\.(safetensors|ckpt|pt)$/i, "")
      .trim();
  }

  function activeModelMatches(value) {
    const active = normalizeModelName(state.activeModel).toLowerCase();
    if (!active) return false;
    return normalizeModelName(value).toLowerCase() === active;
  }

  function modelKind(label) {
    const text = String(label || "");
    if (/(anima|silvermoon|miaomiao)/i.test(text)) return { text: "Anima", cls: "is-anima", hint: "Anima 架构 / Qwen3 编码器 + Qwen-Image VAE" };
    if (/(cyber|real|photo)/i.test(text)) return { text: "写实", cls: "is-real", hint: "写实人像 / Pony 标签体系" };
    if (/(anime|illust|manga|cartoon)/i.test(text)) return { text: "动漫", cls: "is-anime", hint: "动漫插画 / SDXL 标签体系" };
    return null;
  }

  function profileForModel(label) {
    const text = String(label || "");
    return MODEL_PROFILE_LIST.find((profile) => profile.match && profile.match.test(text)) || MODEL_PROFILES.generic;
  }

  function activeProfile() {
    if (state.modelProfileId && MODEL_PROFILES[state.modelProfileId]) return MODEL_PROFILES[state.modelProfileId];
    return profileForModel(state.activeModel);
  }

  // 蒸馏（turbo/DMD）底模只在 8–12 步、CFG≈1 的最佳区间工作。
  // 用 25 步 CFG 2.5 跑它，时间翻倍还换来更硬的对比和更重的"AI 味"，
  // 所以这里按底模形态把档位参数纠正回它该在的区间。
  // Krea 2 的 Noct 是 Turbo 的无审查微调版，同样是 8 步 / CFG 1 的蒸馏模型；
  // 只按名字里的 turbo 判断的话，删掉 turbo 底模后 Krea 会按 24 步 CFG 5.5 跑，
  // 蒸馏模型那样跑等于过冲。
  function isTurboCheckpoint() {
    return /turbo|noct/i.test(String(state.activeModel || ""));
  }

  function modelFormTier(tier) {
    if (!tier || !isTurboCheckpoint()) return tier;
    // 抽卡档本身就在最佳区间内，原样返回。
    if (Number(tier.steps) <= 12) return tier;
    return { ...tier, steps: 8, cfg: 1.0, turbo: true };
  }

  function qualityTier(key) {
    const profile = activeProfile();
    return modelFormTier((profile.qualities && profile.qualities[key]) || QUALITY_GENERIC[key] || null);
  }

  function qualityMatches(key, tier = qualityTier(key)) {
    if (!key || !tier) return false;
    if (Number(el.steps.value) !== Number(tier.steps)) return false;
    if (Number(el.cfg.value) !== Number(tier.cfg)) return false;
    if (Boolean(el.hires.checked) !== Boolean(tier.hires)) return false;
    if (tier.sampler && el.sampler.value !== tier.sampler) return false;
    if (tier.scheduler && el.scheduler.value !== tier.scheduler) return false;
    // LoRA 列表还没读回来时不能拿 Turbo 状态判档，否则刷新后「抽卡」会掉成自定义。
    if (tier.turbo !== undefined && state.lorasLoaded && turboLoraActive() !== Boolean(tier.turbo)) return false;
    // 二采倍数也算档位的一部分：改了倍数就不该继续显示成"高清档已应用"。
    if (tier.hires && tier.scale && Number(el.hrScale.value) !== Number(tier.scale)) return false;
    return true;
  }

  function qualityLabel(key, tier = {}) {
    const name = QUALITY_LABELS[key] || "自定义";
    if (key === "hires") return `${name} · ${tier.scale || 1.25}x`;
    // Krea 的精细档不带更多步数、而是带低噪二采，标签里要如实反映。
    const hr = tier.hires ? ` +${tier.scale || 1.25}x 二采` : "";
    return `${name} · ${tier.steps || 24} 步${hr}`;
  }

  function modelShortName(value) {
    return normalizeModelName(String(value || "")).replace(/\.(safetensors|ckpt|pt)$/i, "");
  }

  function readModelSettingsMap() {
    const map = readJSON(STORE_MODEL_SETTINGS, {});
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  }

  function writeModelSettingsMap(map) {
    return writeJSON(STORE_MODEL_SETTINGS, map);
  }

  // 推荐参数升级时，旧的 per-profile 缓存会盖掉新默认值。
  // 这里做一次性迁移：只清 MOSS 的缓存，其它模型手动调过的参数原样保留。
  const STORE_PRESET_V = "simplegen.presetdefaults.v1";
  const PRESET_VERSION = 2;
  let pendingPresetApply = false;
  function migratePresetDefaults() {
    if (Number(readJSON(STORE_PRESET_V, 0)) >= PRESET_VERSION) return false;
    const map = readModelSettingsMap();
    if (map && map.moss) {
      delete map.moss;
      writeModelSettingsMap(map);
    }
    writeJSON(STORE_PRESET_V, PRESET_VERSION);
    return true;
  }

  function captureModelSettings() {
    const key = el.qualityGroup.value;
    const tier = key ? qualityTier(key) : null;
    const matches = qualityMatches(key, tier);
    return {
      quality: matches ? key : "",
      steps: Number(el.steps.value),
      cfg: Number(el.cfg.value),
      sampler: el.sampler.value,
      scheduler: el.scheduler.value,
      shift: el.shift ? Number(el.shift.value) : 3.5,
      clipSkip: normalizeClipSkip(el.clipSkip.value),
      vae: String(el.vae.value || VAE_AUTO),
      hires: Boolean(el.hires.checked),
      hrScale: Number(el.hrScale.value),
      hrUpscaler: String(el.hrUpscaler.value || DEFAULT_UPSCALER),
      hrDenoise: Number(el.hrDenoise.value),
      easyCache: Boolean(el.easyCache?.checked),
      lowVram: Boolean(el.lowVram?.checked)
    };
  }

  function saveProfileSettings(profileId) {
    if (!profileId || profileId === "generic") return;
    const map = readModelSettingsMap();
    map[profileId] = captureModelSettings();
    writeModelSettingsMap(map);
  }

  function profileRecommendedSettings(profile) {
    // 实测最优组合（SFT 底模）：官方 50 步 / CFG 3.0 / Euler+Simple 画质最好，
    // 配 EasyCache 后 768² 约 31.7s，反而快过原来的 25 步不开缓存（41.4s）。
    // turbo 底模退回抽卡档参数（modelFormTier 会自动锁 8 步 CFG 1），别硬套 50 步。
    const isMoss = profile.arch === "moss";
    const tierKey = isMoss ? (isTurboCheckpoint() ? "gacha" : "fine") : "standard";
    const tier = modelFormTier(profile.qualities[tierKey] || profile.qualities.standard);
    return {
      quality: isMoss ? (isTurboCheckpoint() ? "gacha" : "fine") : "standard",
      steps: tier.steps,
      cfg: tier.cfg,
      sampler: tier.sampler || profile.sampler,
      scheduler: tier.scheduler || profile.scheduler,
      shift: Number(profile.shift) || 3.5,
      clipSkip: normalizeClipSkip(profile.clipSkip ?? DEFAULT_CLIP_SKIP),
      vae: VAE_AUTO,
      hires: false,
      hrScale: 1.25,
      hrUpscaler: DEFAULT_UPSCALER,
      hrDenoise: profile.qualities.hires?.denoise || 0.38,
      easyCache: true,   // Krea / MOSS 都在大步数区间，跳步缓存默认开；8 步档桥接层会跳过
      lowVram: false
    };
  }

  function resolvedProfileSettings(profile) {
    const base = profileRecommendedSettings(profile);
    const saved = readModelSettingsMap()[profile.id];
    if (!saved || typeof saved !== "object") return base;
    return {
      quality: typeof saved.quality === "string" ? saved.quality : base.quality,
      steps: Number(saved.steps) || base.steps,
      cfg: Number(saved.cfg) || base.cfg,
      // 采样器/调度器跟模型走：换模型就套该模型的推荐值，不沿用上一个模型的。
      sampler: base.sampler,
      scheduler: base.scheduler,
      shift: Number(saved.shift) ? clampShift(saved.shift) : base.shift,
      clipSkip: normalizeClipSkip(saved.clipSkip ?? base.clipSkip),
      vae: typeof saved.vae === "string" && saved.vae ? saved.vae : base.vae,
      hires: Boolean(saved.hires),
      hrScale: normalizeHrScale(saved.hrScale),
      hrUpscaler: typeof saved.hrUpscaler === "string" && saved.hrUpscaler ? saved.hrUpscaler : base.hrUpscaler,
      hrDenoise: Number(saved.hrDenoise) || base.hrDenoise,
      easyCache: typeof saved.easyCache === "boolean" ? saved.easyCache : base.easyCache,
      lowVram: typeof saved.lowVram === "boolean" ? saved.lowVram : base.lowVram
    };
  }

  function syncQualityKeyToControls() {
    const key = el.qualityGroup.value;
    if (!key) {
      state.qualityKey = "";
      return;
    }
    const tier = qualityTier(key);
    if (!qualityMatches(key, tier)) {
      el.qualityGroup.value = "";
      state.qualityKey = "";
    } else {
      state.qualityKey = key;
    }
  }

  function applyGenerationSettings(settings, { save = true } = {}) {
    const cfg = settings || {};
    const nextQuality = QUALITY_KEYS.includes(cfg.quality) ? cfg.quality : "";
    if (el.qualityGroup.value !== nextQuality) el.qualityGroup.value = nextQuality;
    el.steps.value = clamp(Number(cfg.steps) || 24, 6, 60);
    el.stepsOut.textContent = el.steps.value;
    el.cfg.value = clamp(Number(cfg.cfg) || 5.5, 1, 10);
    el.cfgOut.textContent = Number(el.cfg.value).toFixed(1);
    el.sampler.value = cfg.sampler || "Euler a";
    el.scheduler.value = cfg.scheduler || "Karras";
    if (el.shift) {
      el.shift.value = clampShift(cfg.shift);
      el.shiftOut.textContent = Number(el.shift.value).toFixed(1);
    }
    el.clipSkip.value = String(normalizeClipSkip(cfg.clipSkip));
    el.vae.value = String(cfg.vae || VAE_AUTO);
    el.hires.checked = Boolean(cfg.hires);
    el.hrScale.value = String(normalizeHrScale(cfg.hrScale));
    el.hrUpscaler.value = String(cfg.hrUpscaler || DEFAULT_UPSCALER);
    el.hrDenoise.value = clamp(Number(cfg.hrDenoise) || 0.4, 0.2, 0.6);
    el.hrOut.textContent = Number(el.hrDenoise.value).toFixed(2);
    // 应用模型预设时同步带上下发到引擎的开关，否则界面与实际不一致。
    if (el.easyCache) el.easyCache.checked = Boolean(cfg.easyCache);
    if (el.lowVram) el.lowVram.checked = Boolean(cfg.lowVram);
    updatePerfHint();
    const qualityKey = el.qualityGroup.value;
    const quality = qualityKey ? qualityTier(qualityKey) : null;
    if (quality && quality.turbo !== undefined) syncTurboLora(Boolean(quality.turbo));
    syncQualityKeyToControls();
    ensureEngineSelection();
    syncEngineAvailability();
    updateHiresUI();
    updateEngineHint();
    updateQualityHint();
    updateAdvancedSummary();
    updateSamplerPresetUI();
    if (save) scheduleSave();
  }

  function swapPromptQualityPrefix(profile) {
    const text = el.prompt.value;
    let rest = text;
    let hadPrefix = false;
    for (const prefix of QUALITY_PREFIXES) {
      if (rest.toLowerCase().startsWith(prefix.toLowerCase())) {
        rest = rest.slice(prefix.length);
        hadPrefix = true;
        break;
      }
    }
    if (!hadPrefix) return;
    const next = ((profile?.qualityPrefix || "") + rest).trim();
    if (next && next !== text) {
      setPrompt(next, { save: false });
      scheduleSave();
    }
  }

  // 采样器 / 调度器候选按架构收窄：MOSS 与 Anima 都是流匹配（官方配方 Euler + Simple），
  // SDXL 系是 UNet 扩散，各自适用的算法不一样，别让用户选到明显不搭的组合。
  const SAMPLER_SETS = {
    moss: {
      samplers: ["Euler", "ER SDE", "Res Multistep", "DPM++ 2M", "DPM++ SDE", "DDIM", "UniPC"],
      schedulers: ["Simple", "Beta", "SGM Uniform", "Karras", "Normal", "Exponential"]
    },
    anima: {
      samplers: ["Euler a", "Euler", "DPM++ 2M", "DPM++ SDE", "Res Multistep", "DDIM", "UniPC"],
      schedulers: ["Beta", "SGM Uniform", "Karras", "Simple", "Normal", "Exponential"]
    },
    // Krea 2 是 8 步蒸馏的流匹配模型：sigma 网格被蒸馏锚死在 euler/simple 上，
    // DPM++ / Karras 这类给多步 UNet 设计的曲线在 8 步下会糊或出噪点。
    // Euler a 只作「想要更多随机性」的备选，Simple 之外只留 Beta 做过渡微调。
    krea: {
      samplers: ["Euler", "Euler a", "Res Multistep", "DDIM"],
      schedulers: ["Simple", "Beta", "Normal", "SGM Uniform"]
    },
    // Z-Image Turbo：官方只给 res_multistep + simple。Euler 系留作更快/更随机的备选，
    // DPM++ 2M 给复杂构图；Karras 那类多步曲线不在官方配方里，别列。
    zimage: {
      samplers: ["Res Multistep", "Euler", "Euler a", "DPM++ 2M", "DDIM"],
      schedulers: ["Simple", "Beta", "Normal", "SGM Uniform"]
    },
    sdxl: {
      samplers: ["Euler a", "Euler", "DPM++ 2M", "DPM++ 2M SDE", "DPM++ SDE", "DDIM", "UniPC"],
      schedulers: ["Karras", "Exponential", "Normal", "Simple", "SGM Uniform"]
    }
  };

  function samplerSetFor(arch) {
    if (arch === "moss") return SAMPLER_SETS.moss;
    if (arch === "anima") return SAMPLER_SETS.anima;
    if (arch === "krea") return SAMPLER_SETS.krea;
    if (arch === "zimage") return SAMPLER_SETS.zimage;
    return SAMPLER_SETS.sdxl;
  }

  function renderSamplerOptions() {
    if (!el.sampler || !el.scheduler) return;
    const set = samplerSetFor(activeProfile()?.arch || "sdxl");
    // 只隐藏不适用项，不改 DOM 结构：mdui-select 重建选项容易出样式问题。
    const narrow = (select, allowed) => {
      select.querySelectorAll("mdui-menu-item").forEach((item) => {
        const ok = allowed.includes(item.value);
        item.disabled = !ok;
        item.hidden = !ok;
      });
      if (!allowed.includes(select.value)) select.value = allowed[0];
    };
    narrow(el.sampler, set.samplers);
    narrow(el.scheduler, set.schedulers);
  }

  function updateModelProfileUI() {
    if (!el.modelProfileNote) return;
    // 架构一变，画风条也要跟着换：MOSS 用中文画风词条，其它架构用画师/角色库。
    if (el.styleStrip) renderStyleStrip();
    updateControlnetVisibility();
    renderSamplerOptions();
    // 采样预设按钮也要跟着架构换（MOSS 有自己的五套，别沿用 SDXL 的）。
    ensureSamplerPresets();
    // 弹窗左栏在 MOSS 下是预设库、其它架构是整套配方，架构变了才重建，避免每 6 秒刷新时闪。
    const railArch = activeProfile()?.arch || "";
    // MOSS 全程中文：转写预览会生成英文草稿，对它没有意义，直接藏掉。
    if (el.promptConvert) el.promptConvert.hidden = railArch === "moss";
    if (el.recipeGrid && state._railArch !== railArch) {
      state._railArch = railArch;
      renderRecipes();
      // 词库随架构整套切换：MOSS 走中文，其它走 Danbooru。
      renderTagGroups();
      refreshCharacterCopy();
      buildCharacterGroups();
      // LoRA 列表同样按架构过滤；弹窗开着时立刻刷新。
      if (el.loraDialog?.open) renderLoraDialog();
    }
    const profile = activeProfile();
    const known = profile && profile.id !== "generic";
    if (!state.online) {
      el.modelProfileNote.textContent = "引擎离线 · 沿用当前参数";
      el.modelProfileNote.title = "";
      el.applyModelProfile.disabled = true;
      return;
    }
    if (!state.activeModel) {
      el.modelProfileNote.textContent = "读取模型后显示推荐参数";
      el.modelProfileNote.title = "";
      el.applyModelProfile.disabled = true;
      return;
    }
    if (!known) {
      el.modelProfileNote.textContent = "自定义模型 · 沿用当前参数";
      el.modelProfileNote.title = "";
      el.applyModelProfile.disabled = true;
      return;
    }
    const rec = profileRecommendedSettings(profile);
    const isAnimaProfile = profile.arch === "anima" || profile.id === "anima";
    // 推荐值必须和控件里的实际值比一遍：以前只写推荐，用户看到的却是另一套，
    // 分不清"这是推荐"还是"这就是我现在用的"。
    const current = {
      sampler: String(el.sampler?.value || ""),
      scheduler: String(el.scheduler?.value || ""),
      steps: Number(el.steps?.value) || 0,
      shift: el.shift ? Number(el.shift.value) : 0
    };
    const diffs = [];
    if (rec.sampler && current.sampler && current.sampler !== rec.sampler) {
      diffs.push(`${current.sampler} → ${rec.sampler}`);
    }
    if (rec.scheduler && current.scheduler && current.scheduler !== rec.scheduler) {
      diffs.push(`${current.scheduler} → ${rec.scheduler}`);
    }
    if (rec.steps && current.steps !== rec.steps) diffs.push(`${current.steps} → ${rec.steps} 步`);
    if (isAnimaProfile && rec.shift && Math.abs(current.shift - Number(rec.shift)) > 0.05) {
      diffs.push(`Shift ${current.shift.toFixed(1)} → ${Number(rec.shift).toFixed(1)}`);
    }
    const recommend = `${profile.sampler} · ${profile.scheduler} · ${rec.steps} 步`
      + (isAnimaProfile ? ` · Shift ${Number(rec.shift).toFixed(1)}` : "");
    el.modelProfileNote.textContent = diffs.length
      ? `推荐 ${recommend}（当前 ${diffs.join("，")}）`
      : `已与推荐一致 · ${recommend}`;
    el.applyModelProfile.disabled = state.busy || state.modelSwitching || !diffs.length;
    el.modelProfileNote.title = [
      isAnimaProfile ? "切换时自动写入 Anima 预设、Qwen3 文本编码器与 Qwen-Image VAE。" : "",
      `质量前缀：${profile.qualityPrefix.trim() || "无"}`,
      profile.negativeHint ? `负面建议：${profile.negativeHint}` : ""
    ].filter(Boolean).join("\n");
  }

  function applyRecommendedProfile() {
    const profile = activeProfile();
    if (!profile || profile.id === "generic") return;
    const map = readModelSettingsMap();
    delete map[profile.id];
    writeModelSettingsMap(map);
    applyGenerationSettings(profileRecommendedSettings(profile));
    swapPromptQualityPrefix(profile);
    snack(`已应用 ${profile.label} 推荐参数`);
  }

  function renderModelMenu() {
    if (!el.modelOptions) return;
    if (!state.models.length) {
      const empty = document.createElement("p");
      empty.className = "model-empty";
      empty.textContent = state.modelsLoading
        ? "正在读取模型列表…"
        : state.online ? "没有可用模型" : "引擎未启动，暂时读不到模型";
      el.modelOptions.replaceChildren(empty);
    } else {
      const frag = document.createDocumentFragment();
      state.models.forEach((model) => {
        const active = activeModelMatches(model.value) || activeModelMatches(model.label);
        const kind = modelKind(model.label || model.value);
        const option = document.createElement("button");
        option.type = "button";
        option.className = "model-option";
        option.setAttribute("role", "menuitemradio");
        option.setAttribute("aria-checked", String(active));
        option.dataset.value = model.value;
        option.title = kind?.hint ? `${model.file || model.label} · ${kind.hint}` : (model.file || model.label);
        option.disabled = state.busy || state.modelSwitching;
        option.innerHTML = `<span class="model-option-mark" aria-hidden="true"><span class="icon">${icon("check", 14)}</span></span>`
          + `<span class="model-option-name">${escapeHtml(model.label)}</span>`
          + (kind ? `<span class="model-type ${kind.cls}"${kind.hint ? ` title="${kind.hint}"` : ""}>${kind.text}</span>` : "");
        option.addEventListener("click", () => {
          if (option.disabled) return;
          closeModelSwitchMenu({ restoreFocus: true });
          if (!active) switchModel(model.value);
        });
        frag.appendChild(option);
      });
      el.modelOptions.replaceChildren(frag);
    }
    syncModelMenuState();
  }

  function syncModelMenuState() {
    if (!el.modelOptions) return;
    if (state.models.length) {
      $$(".model-option", el.modelOptions).forEach((option) => {
        option.setAttribute("aria-checked", String(activeModelMatches(option.dataset.value)));
        option.disabled = state.busy || state.modelSwitching;
      });
      el.modelMenuCount.textContent = state.modelsLoading ? "读取中…" : `${state.models.length} 个可用`;
    } else {
      el.modelMenuCount.textContent = state.modelsLoading ? "读取中…" : "0 个可用";
    }
    el.modelMenuStatusText.textContent = state.online ? "引擎就绪" : "引擎未启动";
    el.modelMenuStatus.classList.toggle("is-online", state.online);
    el.modelMenuStatus.classList.toggle("is-offline", !state.online);
    if (el.modelMenuRefresh) el.modelMenuRefresh.disabled = state.modelsLoading;
    let hint = "切换后自动套用该模型的推荐/记住参数，首次加载约 20–40 秒；Anima 会自动挂载 Qwen3 编码器与 Qwen-Image VAE。";
    if (!state.online) hint = "引擎未启动；启动后会自动读取模型，也可以点上方重新检查。";
    else if (state.modelSwitching) hint = "正在通知引擎切换模型…";
    else if (state.busy) hint = "正在出图，完成后才能切换模型。";
    else if (state.modelsLoading) hint = "正在读取模型列表…";
    el.modelMenuHint.textContent = hint;
  }

  function positionModelMenu() {
    if (!el.modelMenu || !el.modelPicker) return;
    const rect = el.modelPicker.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(336, viewport - 24);
    el.modelMenu.style.width = `${width}px`;
    let right = 0;
    if (rect.right > viewport - 12) right = rect.right - (viewport - 12);
    if (rect.right - right - width < 12) right = rect.right - width - 12;
    el.modelMenu.style.right = `${Math.round(right)}px`;
  }

  function setModelSwitchMenu(open) {
    if (!el.modelMenu) return;
    const next = Boolean(open);
    if (next) closeThemeMenu();
    el.modelMenu.classList.toggle("open", next);
    el.status.setAttribute("aria-expanded", String(next));
    if (!next) return;
    renderModelMenu();
    positionModelMenu();
    const checked = el.modelOptions.querySelector('.model-option[aria-checked="true"]:not(:disabled)');
    const first = checked || el.modelOptions.querySelector(".model-option:not(:disabled)");
    first?.focus({ preventScroll: true });
  }

  function closeModelSwitchMenu({ restoreFocus = false } = {}) {
    if (!el.modelMenu?.classList.contains("open")) return;
    setModelSwitchMenu(false);
    if (restoreFocus) el.status.focus({ preventScroll: true });
  }

  async function ensureModelMenuData() {
    if (state.modelsLoading) return;
    if (!state.online) await refreshStatus();
    if (state.online && !state.modelsLoaded) await loadModels({ silent: true });
    if (el.modelMenu?.classList.contains("open")) renderModelMenu();
  }

  function syncModelSelect() {
    // 模型入口只保留在顶栏状态芯片（#status + #modelMenu），旧设置卡里的下拉已移除。
    syncModelMenuState();
    renderLoraBlock();
  }

  async function loadModels({ silent = true } = {}) {
    if (state.modelsLoading) return false;
    state.modelsLoading = true;
    let ok = false;
    try {
      const res = await fetch("/api/sdapi/v1/sd-models", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      state.online = true;
      const [status] = await Promise.all([
        fetch("/api/status", { cache: "no-store" })
          .then((response) => response.json())
          .catch(() => null),
        loadEngineCatalog({ silent: true })
      ]);
      if (status?.model && !state.modelSwitching) {
        state.activeModel = status.model;
        state.modelProfileId = profileForModel(status.model).id;
        state.activeArch = status.arch || archForModel(status.model);
        state.activePreset = status.preset || "";
        el.statusModel.dataset.full = status.model;
      }
      renderVaeOptions();
      state.models = (Array.isArray(list) ? list : []).map((item) => {
        const rawLabel = String(item.model_name || normalizeModelName(item.filename) || item.title || "").trim();
        return {
          value: item.model_name || normalizeModelName(item.filename) || rawLabel,
          label: normalizeModelName(rawLabel) || rawLabel,
          file: item.filename || item.title || ""
        };
      }).filter((item) => item.value);
      state.modelsLoaded = true;
      // 模型数量在顶栏菜单里已经能看到，这里只在"没有模型"时才出声。
      el.modelHint.textContent = state.models.length ? "" : "没有模型";
      el.modelHint.hidden = Boolean(state.models.length);
      el.modelNote.textContent = "切换模型会自动套用各自的推荐参数，并记住你为该模型调过的设置。";
      el.status.classList.remove("is-checking");
      updateStatusUI();
      updateModelProfileUI();
      loadEngineOptions({ silent: true });
      ok = true;
    } catch (err) {
      state.modelsLoaded = false;
      el.modelHint.textContent = state.online ? "读取失败" : "引擎未启动";
      el.modelNote.textContent = state.online
        ? "模型列表读取失败，点右侧刷新重试。"
        : "引擎启动后会自动读取模型。";
      if (!silent) snack("模型列表读取失败：" + (err?.message || err), { bad: true });
    } finally {
      state.modelsLoading = false;
      renderModelMenu();
      syncModelSelect();
      updateGenerateButtons();
      updateAdvancedSummary();
    }
    return ok;
  }

  /* --------------------------------------------------------- engine details */
  function normalizeClipSkip(value) {
    const number = Math.round(Number(value));
    return [1, 2, 3, 4].includes(number) ? number : DEFAULT_CLIP_SKIP;
  }

  // Anima 的 Shift（Forge 内部叫 distilled_cfg_scale）常用 2–5，8GB 上不追极端值。
  function clampShift(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 3.5;
    return Math.min(6, Math.max(1, Math.round(number * 10) / 10));
  }

  function fileBaseName(value) {
    return String(value || "").split(/[\\/]/).pop() || "";
  }

  function upscalerLabel(name) {
    if (UPSCALER_LABELS[name]) return UPSCALER_LABELS[name];
    // 本地超分模型：去掉扩展名，明确标成 AI 超分（和插值算法区分开）。
    const base = String(name || "").replace(/\.(safetensors|pth|pt)$/i, "");
    return `${base} · AI 超分`;
  }

  function shortUpscaler(name) {
    return upscalerLabel(name).split(" · ")[0];
  }

  function isAnimaActive() {
    return state.activeArch === "anima" || state.activePreset === "anima";
  }

  function archForModel(label) {
    const key = modelShortName(label).toLowerCase();
    const arch = state.archByModel[key];
    if (arch && arch !== "unknown") return arch;
    if (/(anima|silvermoon|miaomiao)/i.test(String(label || ""))) return "anima";
    if (/krea/i.test(String(label || ""))) return "krea";
    if (/z[_\- ]?image/i.test(String(label || ""))) return "zimage";
    return "sdxl";
  }

  async function loadEngineCatalog({ silent = true } = {}) {
    if (state.catalogLoading) return state.catalogLoaded;
    state.catalogLoading = true;
    try {
      const res = await fetch("/local/engine/catalog", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const map = {};
      (Array.isArray(data.checkpoints) ? data.checkpoints : []).forEach((item) => {
        const name = String(item?.name || "").toLowerCase();
        if (name && item?.arch) map[name] = String(item.arch);
      });
      const anima = data.anima && typeof data.anima === "object" ? data.anima : {};
      const krea = data.krea && typeof data.krea === "object" ? data.krea : {};
      state.archByModel = map;
      state.animaModules = [anima.text_encoder?.name, anima.vae?.name]
        .map((name) => String(name || "").trim())
        .filter(Boolean);
      state.animaReady = Boolean(anima.ready);
      state.kreaModules = [krea.text_encoder?.name, krea.vae?.name]
        .map((name) => String(name || "").trim())
        .filter(Boolean);
      state.kreaReady = Boolean(krea.ready);
      state.catalogLoaded = true;
      renderVaeOptions();
      return true;
    } catch (err) {
      state.catalogLoaded = false;
      if (!silent) snack("模型架构目录读取失败：" + (err?.message || err), { bad: true });
      return false;
    } finally {
      state.catalogLoading = false;
    }
  }

  function animaModuleSet() {
    return new Set(
      [...state.animaModules, ...state.kreaModules].map((name) => name.toLowerCase())
    );
  }

  // 当前架构以 profile 为准：profile 是按模型名 match 出来的，
  // 而 state.activeArch 来自服务端 /api/status，服务端没重启时会是旧值，
  // 导致「预设组还是上一套、采样器还是 Euler a」这种错位。
  function activeArchKey() {
    const p = activeProfile();
    if (p && p.arch) return p.arch;
    return state.activeArch || "sdxl";
  }

  function isKreaActive() {
    return activeArchKey() === "krea";
  }

  function isZimageActive() {
    return activeArchKey() === "zimage";
  }

  function syncEngineAvailability() {
    const anima = isAnimaActive();
    const krea = isKreaActive();
    const zimage = isZimageActive();
    // Z-Image 也有 ModelSampling 节点（AuraFlow shift 3），滑杆是真的有效，所以进 flow 组。
    const flow = anima || krea || zimage;
    if (el.clipSkip) el.clipSkip.disabled = flow;
    if (el.vae) el.vae.disabled = flow;
    if (el.animaBlock) el.animaBlock.hidden = !flow;
    if (el.shift) {
      // Krea 2 的 shift 在蒸馏时就 baked 进 Krea2.sampling_settings（固定 1.15），
      // 普通 t2i 图里没有 ModelSampling 节点可以覆盖它——滑杆拖了也不会生效，
      // 所以对 Krea 直接锁成只读，别给用户「这个能调」的错觉。
      el.shift.disabled = krea;
      if (krea) {
        el.shift.value = "1.15";
        if (el.shiftOut) el.shiftOut.textContent = "1.15";
      } else if (zimage && el.shift.value !== "3") {
        // Z-Image 官方就是 shift 3；从别的架构切过来时别把 3.5 带过去。
        el.shift.value = "3";
        if (el.shiftOut) el.shiftOut.textContent = "3.0";
      }
    }
    if (flow && el.clipSkip && normalizeClipSkip(el.clipSkip.value) !== 1) {
      el.clipSkip.value = "1";
      scheduleSave();
    }
    if (flow && el.vae && String(el.vae.value || VAE_AUTO) !== VAE_AUTO) {
      el.vae.value = VAE_AUTO;
      scheduleSave();
    }
    if (el.clipHelper) {
      el.clipHelper.textContent = flow
        ? `${anima ? "Anima" : "Krea 2"} 使用 LLM 文本编码器，CLIP 跳过层不生效；已锁定为 1。`
        : "CLIP 跳过层 2 是 Pony / SDXL 的常用值；调高会更弱化提示词，不建议随意改。";
    }
    if (el.vaeHelper && flow) {
      const ready = anima ? state.animaReady : state.kreaReady;
      const te = anima ? "Qwen3 0.6B" : "Qwen3-VL 4B";
      el.vaeHelper.textContent = ready
        ? `${anima ? "Anima" : "Krea 2"} 的 ${te} 编码器与 Qwen-Image VAE 已随预设自动挂载，无需手选。`
        : `未找到 ${anima ? "Anima" : "Krea 2"} 配套模块，切换模型会失败；请检查 text_encoder 与 models\\vae。`;
    }
    ensureSamplerPresets();
    updateEngineHint();
  }

  function renderVaeOptions() {
    if (!el.vae) return;
    const current = String(el.vae.value || VAE_AUTO);
    const hidden = animaModuleSet();
    const usable = state.vaeOptions.filter((item) => {
      const label = String(item.label || "").toLowerCase();
      const value = fileBaseName(item.value).toLowerCase();
      return !hidden.has(label) && !hidden.has(value);
    });
    const options = [{ value: VAE_AUTO, label: "自动 · 跟随底模" }].concat(
      usable.map((item) => ({ value: item.value, label: item.label }))
    );
    if (!state.engineOptionsLoaded && current !== VAE_AUTO && !options.some((item) => item.value === current)) {
      options.push({ value: current, label: `${fileBaseName(current)} · 上次使用` });
    }
    const frag = document.createDocumentFragment();
    options.forEach((option) => {
      const item = document.createElement("mdui-menu-item");
      item.setAttribute("value", option.value);
      item.textContent = option.label;
      item.title = option.value;
      frag.appendChild(item);
    });
    el.vae.replaceChildren(frag);
    const next = options.some((item) => item.value === current)
      ? current
      : (state.engineOptionsLoaded ? VAE_AUTO : current || VAE_AUTO);
    el.vae.value = next;
    requestAnimationFrame(() => el.vae?.requestUpdate?.());
    const fellBack = state.engineOptionsLoaded && current !== VAE_AUTO && next === VAE_AUTO;
    if (fellBack) {
      if (el.vaeHelper) {
        el.vaeHelper.textContent = `上次使用的 VAE「${fileBaseName(current)}」已不在 models\\vae，已回退到自动。`;
      }
      scheduleSave();
    } else if (el.vaeHelper && !isAnimaActive() && !isKreaActive()) {
      el.vaeHelper.textContent = usable.length
        ? `已检测到 ${usable.length} 个 VAE / 模块；自动表示跟随底模。`
        : "当前未检测到独立 VAE，自动使用底模内置；把 VAE 放进 models\\vae 后刷新模型列表即可选择。";
    }
    syncEngineAvailability();
  }

  // 算法按钮是按引擎列表动态重建的，mdui 的 group.value 不一定跟着更新，
  // 所以自己记一份选中值，取值时优先用它（声明放在使用之前，避免 TDZ）。
  let upscaleAlgoValue = "Lanczos";

  // 放大对话框只留 AI 超分模型：插值（Lanczos/Bicubic/Nearest）放大后照样糊，
  // 留着只会让人以为换了算法就清晰了。一个模型都没装时才退回插值兜底。
  function nativeUpscalerOptions() {
    const all = state.upscalerOptions.length ? state.upscalerOptions : UPSCALER_FALLBACKS;
    return all.filter((item) => item.native && !/^latent/i.test(String(item.value || "")));
  }

  function upscaleNativeScale(name) {
    const value = String(name || "");
    if (!value) return 0;
    const hit = state.upscalerOptions.find((item) => item.value === value);
    if (hit?.native && Number(hit.scale) > 0) return Number(hit.scale);
    return 0;
  }

  // 超分模型的倍数是模型自带的，倍数选择器对它完全无效：
  // 直接换成"原生 4x"标签，免得选了 1.5x 却出 4x，让人以为设置没生效。
  // 注意：mdui 组件的 :host{display:block} 会盖掉 UA 的 [hidden]，所以用 class 关。
  function syncUpscaleScaleMode() {
    const native = upscaleNativeScale(upscaleAlgoValue);
    el.upscaleScale?.classList.toggle("is-off", Boolean(native));
    if (el.upscaleNativeHint) {
      el.upscaleNativeHint.classList.toggle("is-off", !native);
      el.upscaleNativeHint.textContent = native ? `原生 ${native}x` : "";
    }
    if (el.upscaleHint) {
      el.upscaleHint.textContent = native
        ? `${shortUpscaler(upscaleAlgoValue)} 固定 ${native}× 出图：不再缩回小倍数，换算法只是换风格，尺寸由模型决定。`
        : "未检测到超分模型，暂时只能用插值放大（放大后仍然偏糊）。把 4x 模型放进 models\\upscale_models 后刷新即可。";
    }
  }

  // 放大对话框用的是 extra-single-image（纯像素操作），只能跑插值和超分模型。
  // Latent 系是潜空间放大、只服务 Hires 二采，这里必须滤掉，否则选了也报错。
  function renderUpscaleAlgoOptions() {
    if (!el.upscaleAlgo) return;
    const all = state.upscalerOptions.length ? state.upscalerOptions : UPSCALER_FALLBACKS;
    const models = nativeUpscalerOptions();
    const list = models.length
      ? models
      : all.filter((item) => !/^latent/i.test(String(item.value || "")));
    if (!list.length) return;
    const current = String(el.upscaleAlgo.value || "");
    const frag = document.createDocumentFragment();
    list.forEach((option) => {
      const btn = document.createElement("mdui-segmented-button");
      btn.setAttribute("value", option.value);
      btn.textContent = shortUpscaler(option.value);
      btn.title = option.label;
      btn.addEventListener("click", () => {
        upscaleAlgoValue = option.value;
        syncUpscaleScaleMode();
      });
      frag.appendChild(btn);
    });
    el.upscaleAlgo.replaceChildren(frag);
    const keep = list.some((x) => x.value === current)
      ? current
      : String(list[0].value || "Lanczos");
    el.upscaleAlgo.value = keep;
    upscaleAlgoValue = keep;
    syncUpscaleScaleMode();
    requestAnimationFrame(() => el.upscaleAlgo?.requestUpdate?.());
  }

  function populateUpscalerSelect() {
    if (!el.hrUpscaler) return;
    const current = String(el.hrUpscaler.value || DEFAULT_UPSCALER);
    const options = (state.upscalerOptions.length ? state.upscalerOptions : UPSCALER_FALLBACKS).slice();
    if (!state.engineOptionsLoaded && current && !options.some((item) => item.value === current)) {
      options.push({ value: current, label: `${shortUpscaler(current)} · 上次使用` });
    }
    const frag = document.createDocumentFragment();
    options.forEach((option) => {
      const item = document.createElement("mdui-menu-item");
      item.setAttribute("value", option.value);
      item.textContent = option.label;
      item.title = option.value;
      frag.appendChild(item);
    });
    el.hrUpscaler.replaceChildren(frag);
    renderUpscaleAlgoOptions();
    const next = options.some((item) => item.value === current)
      ? current
      : (state.engineOptionsLoaded ? DEFAULT_UPSCALER : current || DEFAULT_UPSCALER);
    el.hrUpscaler.value = next;
    requestAnimationFrame(() => el.hrUpscaler?.requestUpdate?.());
    if (state.engineOptionsLoaded && current && next !== current) {
      if (el.hrUpscalerHelper) {
        el.hrUpscalerHelper.textContent = `放大算法「${shortUpscaler(current)}」已不可用，已回退到 Lanczos。`;
        el.hrUpscalerHelper.title = "";
      }
      scheduleSave();
    }
    updateEngineHint();
  }

  async function loadEngineOptions({ silent = true } = {}) {
    if (state.engineOptionsLoading) return false;
    state.engineOptionsLoading = true;
    const fetchJson = (url) => fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    try {
      if (!state.catalogLoaded && !state.catalogLoading) {
        await loadEngineCatalog({ silent: true });
      }
      const [modules, upscalers, latentModes] = await Promise.all([
        fetchJson("/api/sdapi/v1/sd-modules"),
        fetchJson("/api/sdapi/v1/upscalers"),
        fetchJson("/api/sdapi/v1/latent-upscale-modes")
      ]);
      if (!Array.isArray(modules) && !Array.isArray(upscalers) && !Array.isArray(latentModes)) {
        throw new Error("引擎未返回放大与 VAE 列表");
      }
      state.vaeOptions = (Array.isArray(modules) ? modules : [])
        .map((item) => ({
          value: String(item?.filename || item?.model_name || ""),
          label: String(item?.model_name || fileBaseName(item?.filename) || "").trim()
        }))
        .filter((item) => item.value && item.label)
        .sort((a, b) => a.label.localeCompare(b.label));
      const seen = new Set();
      const options = [];
      const add = (name, meta) => {
        const value = String(name || "").trim();
        if (!value || /^none$/i.test(value) || seen.has(value)) return;
        seen.add(value);
        // native/scale 来自引擎：超分模型会带上原生倍数，插值则是 null。
        // 放大弹窗要靠它显示"原生 4x、倍数不可选"。
        options.push({
          value,
          label: upscalerLabel(value),
          native: Boolean(meta?.native),
          scale: Number(meta?.scale) || 0
        });
      };
      (Array.isArray(latentModes) ? latentModes : []).forEach((item) => add(item?.name));
      (Array.isArray(upscalers) ? upscalers : []).forEach((item) => {
        if (item?.model_path && /^https?:/i.test(String(item.model_path))) return;
        add(item?.name, item);
      });
      if (!options.some((item) => item.value === DEFAULT_UPSCALER)) {
        options.push({ value: DEFAULT_UPSCALER, label: upscalerLabel(DEFAULT_UPSCALER) });
      }
      state.upscalerOptions = options;
      state.engineOptionsLoaded = true;
      renderVaeOptions();
      populateUpscalerSelect();
      if (el.hrUpscalerHelper) {
        el.hrUpscalerHelper.textContent = `${state.upscalerOptions.length} 个算法 · 超分模型会先补细节再压到二采尺寸，比插值清晰但更慢。`;
        el.hrUpscalerHelper.title = "AI 超分模型会真正补细节；Latent 最快但细节少；Lanczos 通用；Nearest 适合像素风。";
      }
      return true;
    } catch (err) {
      state.engineOptionsLoaded = false;
      state.upscalerOptions = state.upscalerOptions.length ? state.upscalerOptions : UPSCALER_FALLBACKS;
      renderVaeOptions();
      populateUpscalerSelect();
      if (!silent) snack("放大与 VAE 列表读取失败：" + (err?.message || err), { bad: true });
      return false;
    } finally {
      state.engineOptionsLoading = false;
    }
  }

  function ensureEngineSelection() {
    if (!state.engineOptionsLoaded) return;
    const vae = String(el.vae?.value || VAE_AUTO);
    if (vae !== VAE_AUTO && !state.vaeOptions.some((item) => item.value === vae)) {
      el.vae.value = VAE_AUTO;
      if (el.vaeHelper) {
        el.vaeHelper.textContent = `上次使用的 VAE「${fileBaseName(vae)}」已不在 models\\vae，已回退到自动。`;
      }
    }
    const list = state.upscalerOptions.length ? state.upscalerOptions : UPSCALER_FALLBACKS;
    const up = String(el.hrUpscaler?.value || DEFAULT_UPSCALER);
    if (!list.some((item) => item.value === up)) {
      el.hrUpscaler.value = DEFAULT_UPSCALER;
      if (el.hrUpscalerHelper) {
        el.hrUpscalerHelper.textContent = `放大算法「${shortUpscaler(up)}」已不可用，已回退到 Lanczos。`;
        el.hrUpscalerHelper.title = "";
      }
    }
  }

  // 负面提示词有没有用，完全取决于当前模型在跑不跑 CFG。
  // Krea Turbo 是 CFG-free 蒸馏（桥接层直接 ConditioningZeroOut），
  // 负面框写什么都进不了采样，必须明说，否则用户会以为是自己写得不对。
  // ---- 正负向冲突表（借自 prompt-workbench 的「负向自适应」）
  // 正向已经在要某个东西时，负向里对应的词就是在自己打自己：
  // 挂 NSFW LoRA 却留着 censor / mosaic，画 Q 版却留着 bad proportions，
  // 画纯场景却留着 1girl——这些不是"用户写错"，是模板默认值没跟着意图走。
  // 只过滤**提交给引擎的那一份**，输入框里的文本一个字都不改。
  const NEG_CONFLICT_RULES = [
    { when: /\b(uncensored|nude|naked|nsfw|topless|nipples?|areola|explicit)\b|全裸|裸露|无码/i,
      drop: ["censor", "censored", "mosaic censoring", "mosaic", "bar censor", "pixelated", "convenient censoring"] },
    { when: /\b(chibi|super deformed|super-deformed)\b|二头身|q版|q 版/i,
      drop: ["bad proportions", "bad anatomy", "deformed", "extra limbs", "long legs"] },
    { when: /\b(monochrome|greyscale|grayscale|lineart|line art|sketch)\b|线稿|黑白|素描/i,
      drop: ["greyscale", "grayscale", "monochrome", "desaturated"] },
    { when: /\b(no humans|scenery|landscape|background only|empty room)\b|无人|纯风景|只要背景/i,
      drop: ["1girl", "1boy", "multiple girls", "solo"] }
  ];

  function splitPromptTags(text) {
    return String(text || "")
      .split(/[,，\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  // 返回 { text, dropped }：text 是过滤后的负向串，dropped 是被忽略的原始片段。
  function filterNegativeConflicts(positiveText, negativeText) {
    const pos = String(positiveText || "");
    const tags = splitPromptTags(negativeText);
    if (!tags.length) return { text: "", dropped: [] };
    const dropped = [];
    const kept = tags.filter((tag) => {
      const low = tag.toLowerCase();
      const hit = NEG_CONFLICT_RULES.some(
        (rule) => rule.when.test(pos) && rule.drop.some((word) => low.includes(word))
      );
      if (hit) dropped.push(tag);
      return !hit;
    });
    return { text: kept.join(", "), dropped };
  }

  function updateNegativeHint() {
    if (!el.negHelper) return;
    const arch = activeProfile()?.arch;
    const conflicts = filterNegativeConflicts(el.prompt?.value, el.negative?.value);
    const tail = conflicts.dropped.length
      ? ` 已按当前正向自动忽略 ${conflicts.dropped.length} 条冲突项：${conflicts.dropped.slice(0, 3).join("、")}${conflicts.dropped.length > 3 ? "…" : ""}（原文未改）。`
      : "";
    if (arch === "krea") {
      el.negHelper.textContent = "Krea 2 Turbo 在 CFG 1 下不跑负面分支（桥接层直接清零），这里写什么都无效；只有把 CFG 抬到 1.5 以上才真正生效。" + tail;
    } else if (arch === "moss") {
      el.negHelper.textContent = "MOSS 要 CFG 2.5 以上负面才起作用；CFG 1（抽卡档）时负面同样无效。" + tail;
    } else {
      el.negHelper.textContent = "默认已排除低质量、文字水印相关标签，建议保留。" + tail;
    }
    // CFG 1 时负面分支被清零，这个框写了也没用——就别让它看起来还能用。
    const cfg = Number(el.cfg?.value);
    const inert = (arch === "krea" || arch === "moss") && Number.isFinite(cfg) && cfg <= 1.05;
    el.negDetails?.classList.toggle("is-inert", inert);
    if (el.negative) el.negative.disabled = false; // 仍可编辑，只是视觉降权
  }

  function updateEngineHint() {
    if (!el.engineHint) return;
    updateNegativeHint();
    const hiresText = el.hires?.checked ? ` · ${shortUpscaler(el.hrUpscaler?.value)}` : "";
    if (isKreaActive()) {
      // shift 不读滑杆：它是蒸馏时固定的，读滑杆只会显示一个假数字。
      el.engineHint.textContent = `Krea 2 · Shift 1.15（内置） · Qwen3-VL 编码器 · VAE 自动${hiresText}`;
      el.engineHint.title = el.engineHint.textContent;
      if (el.shiftLabel) el.shiftLabel.textContent = "Krea 2 位移（内置）";
      if (el.animaHint) el.animaHint.textContent = "Shift 1.15 在蒸馏时固定，普通文生图不可调";
      return;
    }
    if (isZimageActive()) {
      const shift = el.shift ? Number(el.shift.value).toFixed(1) : "3.0";
      el.engineHint.textContent = `Z-Image Turbo · Shift ${shift} · Qwen3-4B 编码器 · 9 步蒸馏${hiresText}`;
      el.engineHint.title = "官方配方：9 步 / CFG 1 / res_multistep / shift 3。加步数收益递减（实测 20–30 步不会变糊），要细节优先用二采。";
      if (el.shiftLabel) el.shiftLabel.textContent = "Z-Image 位移";
      if (el.animaHint) el.animaHint.textContent = `Shift ${shift} · 官方 3.0`;
      return;
    }
    if (isAnimaActive()) {
      const shift = el.shift ? Number(el.shift.value).toFixed(1) : "3.5";
      el.engineHint.textContent = `Anima · Shift ${shift} · Qwen3 编码器 · VAE 自动${hiresText}`;
      el.engineHint.title = el.engineHint.textContent;
      if (el.shiftLabel) el.shiftLabel.textContent = "Anima 位移";
      if (el.animaHint) el.animaHint.textContent = `Shift ${shift}`;
      return;
    }
    const clip = normalizeClipSkip(el.clipSkip?.value);
    const vaeValue = String(el.vae?.value || VAE_AUTO);
    const vaeText = vaeValue === VAE_AUTO ? "VAE 自动" : `VAE ${fileBaseName(vaeValue)}`;
    el.engineHint.textContent = `CLIP ${clip} · ${vaeText}${hiresText}`;
    el.engineHint.title = el.engineHint.textContent;
  }

  /* ------------------------------------------------------------------ lora */
  // 已安装于 D:\AI\models\loras 的 Anima LoRA；desc 会显示在 LoRA 管理弹窗。
  // 未登记的 LoRA 仍用文件名显示，启用后追加 <lora:文件名:权重>。
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
  // 已随 WAI 底模移除的四款 Illustrious LoRA；旧本地设置里可能仍留着它们。
  const RETIRED_LORAS = new Set([
    "realistic-anime-style-illustrious",
    "glossy-skin-illustrious",
    "detailer-tool-illustrious",
    "female-pov-illustrious"
  ]);

  function loraKey(value) {
    return normalizeModelName(String(value || ""))
      .replace(/\.(safetensors|ckpt|pt)$/i, "")
      .trim()
      .toLowerCase();
  }

  function loraInfo(name) {
    return LORA_LIBRARY[loraKey(name)] || null;
  }

  function loraTitle(name) {
    return loraInfo(name)?.title || String(name || "");
  }

  function loraDefaultWeight(name) {
    const base = clamp(Number(loraInfo(name)?.weight) || 0.6, 0.05, 1.5);
    // MOSS 的底模是写实先验，画师/画风类 LoRA 在 0.9 会被压回去，
    // 出图"像又不像"。这类统一抬到 1.1，其余不动。
    const key = String(name || "").toLowerCase();
    const isMossArtistic = key.startsWith("moss_")
      && !/detail|quality|slider|dmd|edit|deband|boost|color_depth|hires/.test(key);
    return isMossArtistic ? Math.max(base, 1.1) : base;
  }

  function loraWeightText(value) {
    return Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function findActiveLora(name) {
    const key = loraKey(name);
    return state.activeLoras.find((item) => loraKey(item.name) === key) || null;
  }

  // Turbo 加速 LoRA 按架构区分：Anima 用 anima_turbo_v0.2，MOSS 用 8 步 DMD 蒸馏。
  // 预合并 Turbo 底模（文件名含 turbo）本身即加速形态，不再叠加 LoRA。
  function turboLoraName() {
    const profile = activeProfile();
    if (profile && profile.arch === "moss") {
      return /turbo/i.test(String(state.activeModel || "")) ? "" : "moss_image_sft_8steps_dmd_lora";
    }
    if (profile && profile.arch === "anima") return "anima_turbo_v0.2";
    return "";
  }

  function turboLoraActive() {
    const name = turboLoraName();
    if (!name) {
      // Turbo 底模没有额外 LoRA，但抽卡加速已经生效。
      return Boolean(activeProfile() && activeProfile().arch === "moss"
        && /turbo/i.test(String(state.activeModel || "")));
    }
    return Boolean(findActiveLora(name));
  }

  function availableLora(name) {
    const key = loraKey(name);
    return state.loras.find((item) =>
      loraKey(item.name) === key ||
      (item.alias && loraKey(item.alias) === key)) || null;
  }

  function sortedLoras() {
    return [...state.loras].sort((a, b) => {
      const ai = LORA_ORDER.indexOf(loraKey(a.name));
      const bi = LORA_ORDER.indexOf(loraKey(b.name));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    });
  }

  function activeLorasPayload() {
    return state.activeLoras.map((item) => ({ name: item.name, weight: Number(item.weight) }));
  }

  function addActiveLora(name, weight) {
    const target = availableLora(name);
    if (!target) return false;
    const existing = findActiveLora(target.name);
    if (existing) {
      existing.weight = clamp(Number(weight) || existing.weight, 0.05, 1.5);
      return true;
    }
    state.activeLoras.push({
      name: target.name,
      weight: clamp(Number(weight) || loraDefaultWeight(target.name), 0.05, 1.5)
    });
    return true;
  }

  function setLoraWeight(name, weight) {
    const item = findActiveLora(name);
    if (!item) return;
    item.weight = clamp(Number(weight) || loraDefaultWeight(item.name), 0.05, 1.5);
  }

  function stripLoraTags(text, name) {
    const key = loraKey(name);
    const next = String(text || "").replace(/<\s*lora\s*:\s*([^>]+)>/gi, (whole, body) => {
      const tagName = String(body).split(":")[0].trim();
      return loraKey(tagName) === key ? "" : whole;
    });
    return next
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,，])/g, "$1")
      .replace(/,\s*,/g, ", ")
      .trim();
  }

  function rewriteLoraTags(text) {
    const active = new Map(state.activeLoras.map((item) => [loraKey(item.name), item]));
    let out = String(text || "").replace(/<\s*lora\s*:\s*([^>]+)>/gi, (whole, body) => {
      const tagName = String(body).split(":")[0].trim();
      const item = active.get(loraKey(tagName));
      if (!item) return whole;
      return `<lora:${item.name}:${loraWeightText(item.weight)}>`;
    });
    const seen = new Set();
    out.replace(/<\s*lora\s*:\s*([^>]+)>/gi, (whole, body) => {
      seen.add(loraKey(String(body).split(":")[0].trim()));
      return whole;
    });
    state.activeLoras.forEach((item) => {
      if (seen.has(loraKey(item.name))) return;
      out = out.trim();
      out += `${out ? " " : ""}<lora:${item.name}:${loraWeightText(item.weight)}>`;
    });
    return out.trim();
  }

  function setLoraEnabled(name, enabled) {
    const target = availableLora(name);
    if (!target) return;
    if (enabled) {
      addActiveLora(target.name);
    } else {
      state.activeLoras = state.activeLoras.filter((item) => loraKey(item.name) !== loraKey(target.name));
      const cleaned = stripLoraTags(el.prompt.value, target.name);
      if (cleaned !== el.prompt.value) setPrompt(cleaned, { save: false });
    }
    renderLoraBlock();
    // 等 MDUI 开关自己的 change 处理完成后再重建列表，避免其内部 inputRef 已卸载。
    setTimeout(renderLoraDialog, 0);
    scheduleSave();
  }

  function insertLoraTriggers(name) {
    const info = loraInfo(name);
    if (!info?.triggers) return;
    const tags = info.triggers.split(",").map((tag) => tag.trim()).filter(Boolean);
    const current = el.prompt.value;
    const lower = current.toLowerCase();
    const missing = tags.filter((tag) => !lower.includes(tag.toLowerCase()));
    if (!missing.length) {
      snack("触发词已经在描述框里");
      return;
    }
    let next = current.trim();
    if (next && !/[,，]\s*$/.test(next)) next += ", ";
    next += missing.join(", ");
    setPrompt(next);
    if (state.promptDraft) syncPromptDraftExtras();
    snack(`已插入 ${missing.length} 个触发词`);
  }

  function parseLorasFromPrompt(text) {
    const out = [];
    if (!state.lorasLoaded) return out;
    const seen = new Set();
    const re = /<\s*lora\s*:\s*([^>]+)>/gi;
    let match;
    while ((match = re.exec(String(text || "")))) {
      const parts = String(match[1]).split(":");
      const parsed = Number(parts[1]);
      const target = availableLora(parts[0].trim());
      const key = target ? loraKey(target.name) : "";
      if (!target || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: target.name,
        weight: Number.isFinite(parsed) ? parsed : loraDefaultWeight(target.name)
      });
    }
    return out;
  }

  function adoptLorasFromPrompt(text, { render = true } = {}) {
    if (!state.lorasLoaded) return;
    let changed = false;
    for (const item of parseLorasFromPrompt(text)) {
      if (!findActiveLora(item.name)) {
        addActiveLora(item.name, item.weight);
        changed = true;
      }
    }
    if (!changed) return;
    scheduleSave();
    // 同一轮里已经创建过开关时不要再立刻重建，MDUI 的 inputRef 会在首轮渲染前被清空。
    if (render) {
      renderLoraBlock();
      renderLoraDialog();
    }
  }

  function renderLoraBlock() {
    if (!el.loraBlock) return;
    const count = state.activeLoras.length;
    // 状态字只在这些"出问题/还在等"的时候出现；正常状态下下面的芯片已经说明一切，
    // 再挂一句「N 项启用 / 未启用」只是重复信息，占着标题行不放。
    let hint = "";
    if (!state.lorasLoaded) {
      hint = state.lorasLoading ? "读取中…" : (state.online ? "读取失败" : "引擎未启动");
    } else if (!state.loras.length) {
      hint = "未安装";
    }
    el.loraHint.textContent = hint;
    el.loraHint.hidden = !hint;
    if (el.loraActiveChips) {
      el.loraActiveChips.replaceChildren();
      state.activeLoras.forEach((item) => {
        const title = loraTitle(item.name);
        // 芯片拆成两半：左半边点开面板调权重，右半边小叉直接关掉。
        // 原来整颗都会打开面板，想关一个得进去再点一次，太绕。
        const chip = document.createElement("div");
        chip.className = "lora-chip";
        chip.dataset.lora = item.name;

        const main = document.createElement("button");
        main.type = "button";
        main.className = "lora-chip-main";
        main.title = `${title} · 点击调整权重`;
        const name = document.createElement("span");
        name.textContent = title;
        const weight = document.createElement("span");
        weight.className = "w";
        weight.textContent = loraWeightText(item.weight);
        main.append(name, weight);
        main.addEventListener("click", () => openLoraDialog());

        const close = document.createElement("button");
        close.type = "button";
        close.className = "lora-chip-close";
        close.setAttribute("aria-label", `关闭 ${title}`);
        close.title = `关闭 ${title}`;
        close.innerHTML = icon("close", 12);
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          setLoraEnabled(item.name, false);
        });

        chip.append(main, close);
        el.loraActiveChips.appendChild(chip);
      });
      el.loraActiveChips.hidden = count === 0;
    }
    if (el.loraNote) {
      if (!state.lorasLoaded) {
        el.loraNote.textContent = state.online ? "读取已安装的 LoRA…" : "引擎启动后可管理";
      } else if (!state.loras.length) {
        el.loraNote.textContent = "把 .safetensors 放进 loras 目录";
      } else if (count) {
        el.loraNote.textContent = "点芯片调权重或关闭";
      } else {
        el.loraNote.textContent = `${state.loras.length} 个可用 · 增强 / 画风 / 成人`;
      }
    }
    if (el.loraHelper) updateLoraHelper();
    if (el.manageLorasBtn) {
      el.manageLorasBtn.disabled = state.busy || !state.online || state.lorasLoading || !state.loras.length;
    }
    updateAdvancedSummary();
  }

  function updateLoraHelper() {
    if (!el.loraHelper) return;
    const count = state.activeLoras.length;
    const unknownAnima = count > 0 && isAnimaActive()
      && state.activeLoras.some((item) => !loraInfo(item.name));
    const compatWarn = count > 0 && activeProfile().id === "pony";
    const turbo = turboLoraActive();
    const steps = Number(el.steps?.value) || 0;
    const cfg = Number(el.cfg?.value) || 0;
    const turboRefine = turbo && state.mode === "img2img";
    const turboHot = turbo && !turboRefine && (steps > 12 || cfg > 1.5);
    const warn = unknownAnima || compatWarn || turboRefine || turboHot;
    el.loraHelper.hidden = !count && !warn;
    el.loraHelper.classList.toggle("warn", warn);
    el.loraHelper.textContent = turboRefine
      ? "细化重绘建议关掉 Turbo：CFG 回到 4、步数 24–28，细节才补得进去。"
      : turboHot
        ? `Turbo 需要 8–12 步、CFG 1；当前 ${steps} 步 / CFG ${loraWeightText(cfg)} 会发硬过曝。`
        : unknownAnima
          ? "当前是 Anima 底模，未登记的 LoRA 可能按 SDXL 训练、不兼容；先小权重试。"
          : compatWarn
            ? "当前是 Pony 底模，非 Pony 体系训练的 LoRA 可能不兼容；建议先 0.4 左右小权重试。"
            : turbo
              ? "Turbo 已启用：8–12 步 · CFG 1 · Euler；定稿重绘时关掉它。"
              : "启用后在提示词末尾追加 <lora:名称:权重>；触发词用「插入」写进描述框。";
  }

  // LoRA 按架构分组：MOSS 的权重只能在 MOSS 上用，Anima 的只能在 Anima 上用，
  // 混在一张表里只会让人挂错（挂错的 LoRA 不报错，只是没效果，最难排查）。
  function loraArchTag(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("krea")) return "krea";
    if (n.includes("moss")) return "moss";
    if (n.includes("anima")) return "anima";
    // Z-Image 的 LoRA 命名很杂：zimage_/z_image_/zimage-turbo 都出现过，统一吃掉。
    if (n.includes("zimage") || n.includes("z_image")) return "zimage";
    return "sdxl";
  }

  // krea2_turbo_lora_rank_64 是从 (Turbo − Raw) 权重差里 SVD 抽出来的 adapter，
  // 用途是「让 Raw 底模跑出 Turbo 的表现」。我们的底模本来就是 Turbo，
  // 再叠一层等于把同一段蒸馏重复应用，只会过冲、细节变死。
  // 官方也写明这类加速器属于 Raw 侧，故在 Turbo 底模下直接隐藏。
  function isKreaRawOnlyLora(name) {
    return /krea2_turbo_lora/i.test(String(name || ""));
  }

  function loraMatchesArch(name) {
    const target = activeProfile()?.arch || "sdxl";
    if (target === "krea" && isKreaRawOnlyLora(name)) return false;
    return loraArchTag(name) === target;
  }

  // ---- LoRA 分类：按"你拿它干什么"分，而不是按文件前缀
  // 关键词优先，命中不了就落到画风；顺序有意义（成人 > 异形 > 工具 > …）。
  const LORA_CATEGORIES = [
    { id: "all", label: "全部" },
    { id: "style", label: "画风" },
    { id: "artist", label: "画师" },
    { id: "scene", label: "场景" },
    { id: "view", label: "构图视角" },
    { id: "body", label: "人物调整" },
    { id: "beast", label: "异形" },
    { id: "adult", label: "成人向" },
    { id: "util", label: "工具" }
  ];

  const LORA_CAT_RULES = [
    ["adult", /nsfw|adult|herpov|dbx|aio|hentai|cum|bdsm|spank|porn|nipple|penis|breast|areola|pubic|modest|skimpy|body_weight|fitbutt/],
    ["beast", /centaur|taur|spider|hexapod|limbless|minotaur|chimaera|chimera/],
    ["view", /composition|tilt|zoom|first_person|perspective|camera|angle|fisheye|dutch/],
    ["body", /weight_slider|height|age_slider|detail_slider|slider_body|muscle|skin_tone|hair_volume|hair_length|monolid|ethnicity/],
    ["scene", /background|environment|forest|cyberpunk_arch|rooms|scene|landscape|interior|architecture/],
    ["artist", /anmi|guweiz|kantoku|murata|rella|wlop|yoneyama|mochizuki|morikura|greg_rutkowski|diives|eudetenis|saine|kunimoto|afrobull|zankuro|_dart|loish|kuvshinov|fuzichoco|pikazo|huke|loundraw|artist/],
    ["util", /detailer|quality|hires|beauty|color_depth|edit_lora|dmd|turbo|deband|fix|boost|style_reference|sharpen|slider/]
  ];

  function loraCategoryOf(name) {
    const key = String(name || "").toLowerCase();
    for (const [id, re] of LORA_CAT_RULES) {
      if (re.test(key)) return id;
    }
    return "style";
  }

  function loraCategoryCounts(list) {
    const counts = { all: list.length };
    for (const entry of list) {
      const id = loraCategoryOf(entry.name);
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  function renderLoraCats(list) {
    if (!el.loraCats) return;
    const counts = loraCategoryCounts(list);
    el.loraCats.replaceChildren();
    for (const cat of LORA_CATEGORIES) {
      const count = counts[cat.id] || 0;
      if (cat.id !== "all" && !count) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lora-cat" + (state.loraCategory === cat.id ? " is-active" : "");
      btn.dataset.cat = cat.id;
      btn.setAttribute("aria-pressed", state.loraCategory === cat.id ? "true" : "false");
      btn.textContent = count && cat.id !== "all" ? `${cat.label} ${count}` : cat.label;
      btn.addEventListener("click", () => {
        if (state.loraCategory === cat.id) return;
        state.loraCategory = cat.id;
        renderLoraDialog();
      });
      el.loraCats.appendChild(btn);
    }
  }

  function renderLoraDialog() {
    if (!el.loraList) return;
    const all = sortedLoras();
    const archList = all.filter((entry) => loraMatchesArch(entry.name));
    renderLoraCats(archList);
    const list = state.loraCategory === "all"
      ? archList
      : archList.filter((entry) => loraCategoryOf(entry.name) === state.loraCategory);
    const hidden = all.length - list.length;
    el.loraList.replaceChildren();
    el.loraEmpty.hidden = list.length > 0;
    if (!list.length && archList.length) {
      const cat = LORA_CATEGORIES.find((c) => c.id === state.loraCategory);
      el.loraEmpty.textContent = `当前模型下没有「${cat ? cat.label : ""}」分类的 LoRA。`;
    } else if (!list.length) {
      el.loraEmpty.textContent = "还没有安装 LoRA。把 .safetensors 放进 D:////AI////models////loras 后点刷新。";
    }
    if (el.loraDialogHint) {
      const base = state.lorasLoading
        ? "读取中…"
        : state.lorasLoaded
          ? `${list.length} 个适配当前模型 · ${state.activeLoras.length} 个启用`
          : (state.online ? "读取失败，点刷新重试" : "引擎未启动");
      el.loraDialogHint.textContent = (!state.lorasLoading && hidden > 0)
        ? `${base}（另有 ${hidden} 个属于其它架构，已隐藏）`
        : base;
    }
    list.forEach((entry) => {
      const info = loraInfo(entry.name);
      const active = findActiveLora(entry.name);
      const item = document.createElement("div");
      item.className = "lora-item" + (active ? " is-active" : "");
      item.dataset.lora = entry.name;
      const head = document.createElement("div");
      head.className = "lora-item-head";
      const main = document.createElement("div");
      main.className = "lora-item-main";
      const name = document.createElement("div");
      name.className = "lora-item-name";
      name.textContent = info?.title || entry.name;
      const file = document.createElement("div");
      file.className = "lora-item-tags is-file";
      file.textContent = entry.name;
      const tags = document.createElement("div");
      tags.className = "lora-item-tags";
      tags.textContent = info
        ? (info.triggers ? `触发词 ${info.triggers}` : "无固定触发词")
        : "未登记触发词";
      const desc = document.createElement("div");
      desc.className = "lora-item-desc";
      desc.textContent = info?.desc || "第三方 LoRA；先低权重验证。";
      main.append(name, file, tags, desc);
      const toggle = document.createElement("mdui-switch");
      toggle.checked = Boolean(active);
      toggle.setAttribute("aria-label", `启用 ${info?.title || entry.name}`);
      toggle.addEventListener("change", () => {
        setLoraEnabled(entry.name, toggle.checked);
        // 抽卡靠 Turbo 把 10 步 / CFG 1 压成可用结果；手动关掉 Turbo
        // 还留在抽卡档就会直接出废图，这里自动回到标准档。
        if (!toggle.checked
          && loraKey(entry.name) === loraKey(turboLoraName())
          && el.qualityGroup.value === "gacha") {
          // 先把 8/12 张收回到标准档的上限，避免 applyQuality 再弹一条
          // 「已离开抽卡」，两条 snack 挤在一起。
          const hadBatch = Number(el.batch.value) || 1;
          if (hadBatch > 4) setBatchValue(4, { announce: false, save: false });
          applyQuality("standard");
          snack(`已关闭 Turbo · 抽卡档需要 Turbo，已回到标准档 ${el.steps.value} 步 / CFG ${Number(el.cfg.value).toFixed(1)}${hadBatch > 4 ? ` · 本批 ${el.batch.value} 张` : ""}`);
        } else if (toggle.checked
          && loraKey(entry.name) === loraKey("anima_turbo_v0.2")
          && el.qualityGroup.value !== "gacha") {
          if (state.mode === "img2img") {
            snack("Turbo 会把重绘压成低步数：这张建议关掉 Turbo，用 28 步实采", { bad: true });
          } else if (!isAnimaActive()) {
            snack("Turbo 是 Anima 抽卡用的 LoRA，当前模型用不上", { bad: true });
          } else {
            snack("Turbo 适合 10 步 / CFG 1 的抽卡档", {
              action: "切到抽卡",
              onActionClick: () => applyQuality("gacha")
            });
          }
        }
      });
      head.append(main, toggle);
      const controls = document.createElement("div");
      controls.className = "lora-item-controls" + (active ? "" : " is-idle");
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "lora-trigger-btn";
      trigger.textContent = "插入触发词";
      trigger.disabled = !info?.triggers;
      trigger.addEventListener("click", () => insertLoraTriggers(entry.name));
      if (active) {
        const slider = document.createElement("mdui-slider");
        slider.setAttribute("min", "0.05");
        slider.setAttribute("max", "1");
        slider.setAttribute("step", "0.05");
        const sliderValue = Number(active.weight);
        slider.value = sliderValue;
        slider.setAttribute("aria-label", `${info?.title || entry.name} 权重`);
        const weight = document.createElement("span");
        weight.className = "lora-weight";
        weight.textContent = loraWeightText(sliderValue);
        slider.addEventListener("input", () => {
          weight.textContent = loraWeightText(slider.value);
          setLoraWeight(entry.name, slider.value);
        });
        slider.addEventListener("change", () => {
          setLoraWeight(entry.name, slider.value);
          renderLoraBlock();
          scheduleSave();
        });
        controls.append(slider, weight, trigger);
      } else {
        const preset = document.createElement("span");
        preset.className = "lora-default";
        preset.textContent = `启用后默认 ${loraWeightText(loraDefaultWeight(entry.name))}`;
        controls.append(preset, trigger);
      }
      item.append(head, controls);
      el.loraList.appendChild(item);
    });
  }

  async function loadLoras({ silent = true } = {}) {
    if (state.lorasLoading) return false;
    state.lorasLoading = true;
    renderLoraBlock();
    let ok = false;
    try {
      const res = await fetch("/api/sdapi/v1/loras", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      state.online = true;
      state.loras = (Array.isArray(list) ? list : []).map((item) => ({
        name: item.name || normalizeModelName(item.alias) || "",
        alias: item.alias || "",
        path: item.path || "",
        metadata: item.metadata || {}
      })).filter((item) => item.name);
      state.lorasLoaded = true;
      const available = new Set(state.loras.map((item) => loraKey(item.name)));
      state.activeLoras = state.activeLoras.filter((item) => available.has(loraKey(item.name)));
      // 列表下面的 finally 会统一重建，避免刚创建的开关被立刻替换掉。
      adoptLorasFromPrompt(el.prompt.value, { render: false });
      if (el.qualityGroup.value === "gacha") syncTurboLora(true);
      ok = true;
    } catch (err) {
      state.lorasLoaded = false;
      state.loras = [];
      if (!silent) snack("LoRA 列表读取失败：" + (err?.message || err), { bad: true });
    } finally {
      state.lorasLoading = false;
      renderLoraBlock();
      renderLoraDialog();
      updateQualityHint();
    }
    return ok;
  }

  async function refreshLoras() {
    if (state.lorasLoading) return;
    if (el.refreshLorasBtn) el.refreshLorasBtn.loading = true;
    try {
      const res = await fetch("/api/sdapi/v1/refresh-loras", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ok = await loadLoras({ silent: false });
      if (ok) snack(`已刷新 · ${state.loras.length} 个 LoRA`);
    } catch (err) {
      snack("刷新 LoRA 失败：" + (err?.message || err), { bad: true });
    } finally {
      if (el.refreshLorasBtn) el.refreshLorasBtn.loading = false;
    }
  }

  function openLoraDialog() {
    if (!el.loraDialog) return;
    dismissSnacks();
    const reveal = () => {
      el.loraDialog.fullscreen = window.innerWidth <= 720;
      renderLoraDialog();
      el.loraDialog.open = true;
      if (state.online && !state.lorasLoaded && !state.lorasLoading) loadLoras({ silent: false });
    };
    // MDUI 关闭动画结束时会强制 display:none；动画中重开会“看不见但 open 为 true”。
    if (!el.loraDialog.open && getComputedStyle(el.loraDialog).display !== "none") {
      el.loraDialog.addEventListener("closed", reveal, { once: true });
      return;
    }
    reveal();
  }

  async function switchModel(value, { preserveSettings = false, silent = false } = {}) {
    if (state.modelSwitching) return false;
    const target = state.models.find((model) => model.value === value);
    if (!target) return false;
    if (normalizeModelName(target.value).toLowerCase() === normalizeModelName(state.activeModel).toLowerCase()) {
      syncModelSelect();
      return true;
    }
    if (state.busy) {
      snack("正在出图，等这张完成后再切换模型", { bad: true });
      syncModelSelect();
      return false;
    }
    if (!state.online) {
      snack("引擎还没就绪，暂时不能切换模型", { bad: true });
      syncModelSelect();
      return false;
    }

    const previous = state.activeModel;
    const previousProfileId = state.modelProfileId || activeProfile().id;
    const previousArch = state.activeArch;
    const previousPreset = state.activePreset;
    const previousTurbo = turboLoraActive();
    if (!preserveSettings) saveProfileSettings(previousProfileId);
    state.statusSeq += 1;
    state.modelSwitching = true;
    el.modelBlock.classList.add("is-busy");
    el.status.classList.add("is-switching");
    el.status.setAttribute("aria-busy", "true");
    el.statusModel.textContent = "切换中…";
    el.modelHint.textContent = "切换中…";
    el.modelNote.textContent = "正在通知引擎切换模型…";
    syncModelSelect();
    updateGenerateButtons();
    try {
      const res = await fetch("/local/engine/select-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: target.value })
      });
      const raw = await res.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!res.ok || data.ok === false) {
        throw new Error(data.detail || extractError(data, res.status) || raw.slice(0, 200) || `HTTP ${res.status}`);
      }
      state.activeModel = target.value;
      state.modelProfileId = profileForModel(target.value).id;
      state.activeArch = data.arch || archForModel(target.value);
      state.activePreset = data.preset || (state.activeArch === "anima" ? "anima" : "sd");
      el.statusModel.dataset.full = target.value;
      renderVaeOptions();
      updateStatusUI();
      updateModelProfileUI();
      if (!preserveSettings) {
        applyGenerationSettings(resolvedProfileSettings(activeProfile()));
        swapPromptQualityPrefix(activeProfile());
        // 换架构后旧采样器常常不在新预设组里（Euler a → Z-Image 只认 Res Multistep），
        // 这时直接落到该组的「均衡」，别停在一个组里没有的「自定义」状态。
        if (!samplerPresetKey()) {
          const base = activeSamplerPresets().balanced;
          if (base) {
            el.sampler.value = base.sampler;
            el.scheduler.value = base.scheduler;
            updateSamplerPresetUI();
          }
        }
      } else {
        syncEngineAvailability();
        updateHiresUI();
      }
      // 比例的像素预算跟着架构走（Krea 原生 1K–2K）。只在尺寸仍等于旧表标准值时调整。
      alignSizeOnModelSwitch(previousArch, state.activeArch);
      // 风格参考图是 Krea 专属，切走就清掉——几张 1024² 的 base64 挂在内存里很占地方。
      if (state.activeArch !== "krea" && state.styleRefImages.length) {
        state.styleRefImages = [];
        renderStyleRefStrip();
        updateStyleRefHint();
      }
      // 空白页的示例配方与引导文案也要跟着模型换：Krea 给英文配方，其它给中文 tag。
      updatePlaceholderCopy();
      renderPlaceholderIdeas();
      // 切模型时移除所有不属于新架构的 LoRA：跨架构挂着不报错、只是完全没效果，
      // 还白占权重显存，比报错更难发现。原来的 turbo 互斥也被这条覆盖
      // （anima_turbo / moss_*_dmd 的名字本身就带架构名）。
      const staleLoras = state.activeLoras.filter(
        (item) => loraArchTag(item.name) !== state.activeArch
          || (state.activeArch === "krea" && isKreaRawOnlyLora(item.name)));
      if (staleLoras.length) {
        staleLoras.forEach((item) => setLoraEnabled(item.name, false));
        snack(`已自动移除 ${staleLoras.length} 个不属于当前模型的 LoRA`);
      }
      const turboOff = previousTurbo && !turboLoraActive();
      el.modelHint.textContent = `${state.models.length} 个可用`;
      el.modelNote.textContent = preserveSettings
        ? "已切换模型，当前参数保持不变。"
        : (state.activeArch === "anima"
          ? "已切换，并挂载 Anima 的 Qwen3 编码器与 Qwen-Image VAE。下一张首次加载约 20–40 秒。"
          : "已切换，并套用该模型记住的参数。下一张首次加载约 20–40 秒。");
      const unknownActive = state.activeLoras.filter((item) => !loraInfo(item.name)).length;
      if (state.activeArch === "anima" && unknownActive) {
        snack(`已切到 Anima；${unknownActive} 个未登记 LoRA 可能不兼容，先小权重试`, { bad: true });
      } else if (!silent) {
        snack(`已切换到 ${target.label}${turboOff ? " · Turbo 已关" : ""}`);
      }
      return true;
    } catch (err) {
      state.activeModel = previous;
      state.modelProfileId = previousProfileId;
      state.activeArch = previousArch;
      state.activePreset = previousPreset;
      el.modelNote.textContent = "切换失败，已保留原模型。";
      renderVaeOptions();
      updateModelProfileUI();
      if (!silent) snack("切换失败：" + (err?.message || err), { bad: true });
      refreshStatus();
      return false;
    } finally {
      state.modelSwitching = false;
      state.statusSeq += 1;
      el.modelBlock.classList.remove("is-busy");
      el.status.classList.remove("is-switching");
      el.status.removeAttribute("aria-busy");
      updateStatusUI();
      syncModelSelect();
      updateGenerateButtons();
    }
  }

  function updateStatusUI() {
    el.status.classList.remove("is-checking", "is-online", "is-offline");
    const model = (el.statusModel.dataset.full || "").replace(/\.(safetensors|ckpt|pt)$/i, "");
    if (state.online) {
      el.status.classList.add("is-online");
      el.statusText.textContent = "引擎就绪";
      el.statusShort.textContent = "就绪";
      el.statusModel.textContent = model || "已连接";
      el.status.title = "切换模型" + (model ? " · 当前 " + model : "") + " · 引擎就绪";
      el.status.setAttribute("aria-label", `切换模型，当前${model || "未选择"}，引擎就绪`);
    } else {
      el.status.classList.add("is-offline");
      el.statusText.textContent = "引擎未启动";
      el.statusShort.textContent = "离线";
      el.statusModel.textContent = "引擎未启动";
      el.status.title = "引擎未启动或还在加载 · 点击查看模型";
      el.status.setAttribute("aria-label", "切换模型，引擎未启动");
    }
    if (!state.online && !state.models.length && !state.modelsLoading) {
      el.modelHint.textContent = "引擎未启动";
      el.modelNote.textContent = "引擎启动后会自动读取模型；也可点右侧刷新。";
    }
    el.statusModel.title = el.statusModel.dataset.full || "";
    syncModelMenuState();
    updateModelProfileUI();
    updateQualityHint();
    updateAdvancedSummary();
  }

  async function refreshStatus() {
    if (state.busy) return;
    const seq = ++state.statusSeq;
    let data = null;
    let reachable = false;
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      data = await res.json();
      reachable = true;
    } catch {
      reachable = false;
    }
    if (seq !== state.statusSeq || state.busy || state.modelSwitching) return;
    if (reachable) {
      state.online = Boolean(data && data.online);
      if (data?.model) {
        state.activeModel = data.model;
        state.modelProfileId = profileForModel(data.model).id;
        state.activeArch = data.arch || archForModel(data.model);
        state.activePreset = data.preset || "";
        el.statusModel.dataset.full = data.model;
        syncEngineAvailability();
      }
      if (state.online) {
        el.status.classList.remove("is-checking");
      }
      // 推荐参数升级后的首次加载：等模型档案确定下来，自动套用一次新默认值。
      if (pendingPresetApply && state.online && data?.model) {
        pendingPresetApply = false;
        applyGenerationSettings(resolvedProfileSettings(activeProfile()), { save: false });
      }
      // ComfyUI 的真实显存占用（/system_stats），性能卡片直接读这个值。
      if (Number(data?.vram_total_mb) > 0) {
        state.vram = { total: Number(data.vram_total_mb), free: Number(data.vram_free_mb) || 0 };
      } else {
        state.vram = null;
      }
    } else {
      state.online = false;
    }
    updateStatusUI();
    updateGenerateButtons();
    updateMobileHint();
    updatePerfHint();
    if (state.online && !state.catalogLoaded && !state.catalogLoading) {
      loadEngineCatalog({ silent: true });
    }
    if (state.online && !state.modelsLoaded && !state.modelsLoading) {
      loadModels({ silent: true });
    } else {
      syncModelSelect();
    }
    if (state.online && !state.lorasLoaded && !state.lorasLoading) {
      loadLoras({ silent: true });
    }
  }

  function updateGenerateButtons() {
    const disabled = state.converting || !state.online;
    $$("[data-generate]").forEach((button) => {
      button.disabled = disabled;
      button.loading = state.converting;
      const label = button.querySelector(".btn-label");
      if (label) {
        if (state.converting) label.textContent = "转写中…";
        else if (state.busy) label.textContent = "加入队列";
        else label.textContent = button.id === "generateMobile" ? (state.mode === "img2img" ? "重绘" : "生成") : (state.mode === "img2img" ? "开始重绘" : "生成画面");
      }
      button.title = !state.online && !state.converting ? "等待引擎就绪" : (state.busy ? "当前任务结束后自动开始" : "");
    });
    // 提示词引擎跑在 CPU 上，和 Forge 出图互不挤显存；忙碌时也允许先把下一单转成英文再入队。
    // 转写开关关着时，"转写预览"这个入口本身就无意义，直接禁用而不是点了再弹提示。
    if (el.promptConvert) {
      el.promptConvert.disabled = state.converting || !state.translateEnabled;
      el.promptConvert.title = state.translateEnabled
        ? "把输入框里的中文描述转成当前模型的英文提示词"
        : "转写开关已关闭；打开后才能预览转写结果";
    }
    [el.stopInline, el.stopMobile].forEach((button) => { if (button) button.hidden = !state.busy; });
    el.mobileProgress.hidden = !state.busy;
    el.modeGroup.disabled = state.converting;
    syncModelMenuState();
    updateModelProfileUI();
  }

  /* ---------------------------------------------------------------- prompt */
  // 左栏的说明文字被 CSS 收成两行，完整内容放 title——鼠标悬停仍能看到原文。
  // 只写 title、不改文本，所以不会和 MutationObserver 形成回环。
  function hydrateHelperTitles(root) {
    const scope = root || document.querySelector(".side-panel");
    if (!scope) return;
    scope.querySelectorAll("p.helper").forEach((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && node.getAttribute("title") !== text) node.setAttribute("title", text);
    });
  }

  function watchHelperTitles() {
    if (state.helperObserver) return;
    const scope = document.querySelector(".side-panel");
    if (!scope) return;
    let queued = false;
    // 动态文案（负向说明、hires 提示等）随时会变，统一在下一帧补一次 title。
    state.helperObserver = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        hydrateHelperTitles();
      });
    });
    state.helperObserver.observe(scope, { childList: true, subtree: true, characterData: true });
  }

  function estimatePromptWords(text) {
    const raw = String(text || "").trim();
    if (!raw) return 0;
    let cjk = 0;
    let latinPart = "";
    for (const ch of raw) {
      const code = ch.codePointAt(0);
      if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
      else latinPart += ch;
    }
    const latin = latinPart.trim() ? latinPart.trim().split(/\s+/).filter(Boolean).length : 0;
    return latin + Math.round(cjk / 1.6);
  }

  // Krea 2 的舒适区 90–160 词，MOSS 80–150；超出这个区间要么模型自由发挥，要么后半段约束被忽略。
  // MOSS 的几个固有崩点：脚部接地、极端机位、手伸向镜头。
  // 提示词里出现这些词就先把风险标出来，省得跑完 50 步才发现。
  const MOSS_RISK = /full[- ]?body|全身|bare ?foot|赤足|standing on|from below|low angle|仰视|from above|bird'?s[- ]?eye|俯视|foreshorten|reaching (out|toward)|伸手|toward the (camera|viewer)|走向镜头/i;

  function naturalLanguageStats(text, arch) {
    if (!String(text || "").trim()) return "尚未输入";
    const words = estimatePromptWords(text);
    const [lo, hi] = arch === "moss" ? [80, 150] : [90, 160];
    let note = "适中";
    if (words < lo * 0.5) note = "偏短 · 模型会大量自由发挥";
    else if (words < lo) note = "略短 · 细节可能不够具体";
    else if (words <= hi) note = "适中";
    else if (words <= Math.round(hi * 1.25)) note = "略长";
    else note = "偏长 · 后半段约束会被忽略";
    // MOSS 特有：命中风险词时直接说清楚，并把原因写进 title。
    if (arch === "moss" && MOSS_RISK.test(String(text))) {
      return `${words} 词 · ${note} · 全身或极端机位易崩`;
    }
    return `${words} 词 · ${note}`;
  }

  function updatePromptUI() {
    const promptValue = el.prompt.value || "";
    const negativeValue = el.negative.value || "";
    // 自然语言模型关心的是"词数够不够"，不是标签个数——单位不对，提示就没意义。
    const countArch = activeProfile()?.arch;
    el.promptCount.textContent = (countArch === "krea" || countArch === "moss")
      ? naturalLanguageStats(promptValue, countArch)
      : `${countTags(promptValue)} 个标签 · ${promptValue.length} 字符`;
    el.negSummary.textContent = `${countTags(negativeValue)} 个标签`;
    // 正向/负向一改，冲突项就要跟着重算（提示里会列出被自动忽略的负向）。
    updateNegativeHint();
    renderPromptChips();
    refreshStyleChips();
    refreshArtistChip();
    if (el.inspirationDialog?.open) {
      syncTagChips();
      updateLibraryCounts();
    }
    if (el.characterDialog?.open) syncCharacterCards();
  }

  // 已插入标签条：借 prompt-workbench 的「已选区」——标签能从列表里单独删，
  // 不用在一长串逗号里找是谁。整句自然语言（Krea）只有一段时不显示。
  function renderPromptChips() {
    const wrap = el.promptChips;
    if (!wrap) return;
    const tags = splitPromptTags(el.prompt.value);
    if (tags.length < 2) {
      wrap.classList.add("is-off");
      wrap.replaceChildren();
      return;
    }
    wrap.classList.remove("is-off");
    const frag = document.createDocumentFragment();
    tags.forEach((tag, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "prompt-chip";
      chip.title = tag + "\n点击从提示词中移除";
      const text = document.createElement("span");
      text.className = "prompt-chip-text";
      text.textContent = tag.length > 26 ? tag.slice(0, 25) + "…" : tag;
      const cross = document.createElement("span");
      cross.className = "prompt-chip-x";
      cross.setAttribute("aria-hidden", "true");
      cross.textContent = "×";
      chip.append(text, cross);
      chip.addEventListener("click", () => removePromptTag(index));
      frag.appendChild(chip);
    });
    wrap.replaceChildren(frag);
  }

  function removePromptTag(index) {
    const tags = splitPromptTags(el.prompt.value);
    if (index < 0 || index >= tags.length) return;
    tags.splice(index, 1);
    setPrompt(tags.join(", "));
    el.prompt.focus?.();
  }

  // 转写开关：用 28px 的小胶囊代替整块 switch——原来那个占了一整行高度，
  // 把「0 个标签 · 0 字符」这行撑歪了。
  function setTranslateToggle(on) {
    const node = el.translateSwitch;
    if (!node) return;
    node.classList.toggle("is-on", Boolean(on));
    node.setAttribute("aria-checked", on ? "true" : "false");
  }

  function setPrompt(value, { save = true } = {}) {
    el.prompt.value = value;
    updatePromptUI();
    if (save) scheduleSave();
  }

  function setNegative(value, { save = true } = {}) {
    el.negative.value = value;
    updatePromptUI();
    if (save) scheduleSave();
  }

  function refreshStyleChips() {
    const active = RECIPES.filter((recipe) => recipeIsActive(recipe));
    const chip = $("#inspirationChip");
    if (!chip) return;
    const badge = $("#inspirationChipCount", chip);
    if (badge) {
      badge.textContent = String(active.length);
      badge.hidden = active.length === 0;
    }
    chip.classList.toggle("has-active", active.length > 0);
    const detail = active.map((recipe) => recipe.name).join("、");
    chip.title = active.length
      ? `已选风格：${detail}；点击打开灵感与标签`
      : "打开灵感与标签";
    chip.setAttribute(
      "aria-label",
      active.length ? `灵感与标签，已选 ${active.length} 套风格` : "灵感与标签"
    );
  }

  /* ------------------------------------------------------------ 中文转写 */
  const PROMPT_LLM_LABEL = "Qwen3.5-4B";
  const PROMPT_DRAFT_ARCH_LABELS = { anima: "Anima 叙事", sdxl: "SDXL 标签", moss: "MOSS 叙事", krea: "Krea 叙事" };

  function hasChineseText(text) {
    return /[\u3400-\u9fff]/.test(String(text || ""));
  }

  function promptDraftSignature(text) {
    // 评级会改变 4B 的转译口径（是否保留成人动作/不委婉），必须进签名；
    // 否则切换评级后会复用旧草稿，生成时看起来“缺斤少两”。
    return [String(text || "").trim(), state.activeModel || "", state.activeArch || "", "auto", state.rating].join("\u0001");
  }

  function promptCoreText(text = el.prompt.value) {
    return stripPromptExtras(text, collectPromptExtras(text));
  }

  function promptDraftFresh() {
    return Boolean(state.promptDraft && state.promptDraft.signature === promptDraftSignature(promptCoreText()));
  }

  function promptDraftArchLabel(arch) {
    return PROMPT_DRAFT_ARCH_LABELS[arch] || "英文提示词";
  }

  function draftArtistIdentity(tag) {
    const parsed = parseArtistTag(tag);
    if (!parsed) return "";
    // 与后端一致：hiten、@hiten (hitenkei)、(@hiten:0.6) 视为同一画师。
    return normalizeArtistKey(parsed.name).replace(/\s*\([^()]*\)\s*$/, "").trim();
  }

  // ---- 角色外观锁定（借 prompt-workbench 的「外观约束」）
  // 角色库每条标签包都自带发色/瞳色，但转写时模型经常"顺手"省略。
  // 命中角色就检查草稿里有没有外观标签，缺哪类补哪类——换角色可以换风格，
  // 同一次生成里不能把角色改成另一个人。
  let CHARACTER_LOOK_INDEX = null;

  function characterLookIndex() {
    if (CHARACTER_LOOK_INDEX) return CHARACTER_LOOK_INDEX;
    const index = new Map();
    const read = (lib) => {
      (lib?.groups || []).forEach((group) => {
        (group.tags || []).forEach((entry) => {
          if (!Array.isArray(entry) || !entry[0]) return;
          const pack = splitPromptTags(entry[0]);
          const key = String(pack[0] || "").toLowerCase();
          if (!key) return;
          const hair = pack.filter((tag) => /\bhair\b|ponytail|twintails|\bbraid/i.test(tag));
          const eyes = pack.filter((tag) => /\beyes\b/i.test(tag) && !/closed eyes/i.test(tag));
          if (hair.length || eyes.length) {
            index.set(key, { hair, eyes, name: String(entry[1] || key) });
          }
        });
      });
    };
    read(window.KLOCK_CHARACTERS);
    read(window.KLOCK_NORMAL_CHARACTERS);
    CHARACTER_LOOK_INDEX = index;
    return index;
  }

  // 只在标签模式下补（SDXL / Anima / Pony）。Krea、MOSS 是自然语言段落，
  // 往里塞 "long hair, aqua eyes" 反而会把它写成标签串，所以不动。
  function lockCharacterLook(text, draft) {
    if (!draft?.body || draft.mode !== "tags") return false;
    const index = characterLookIndex();
    if (!index.size) return false;
    const source = String(text || "").toLowerCase();
    const body = String(draft.body || "");
    const lowBody = body.toLowerCase();
    const added = [];
    index.forEach((look, key) => {
      if (!source.includes(key)) return;
      const push = (tags) => tags.forEach((tag) => {
        const low = tag.toLowerCase();
        if (!low || lowBody.includes(low) || added.includes(tag)) return;
        added.push(tag);
      });
      // 只要这一类里已经写了任意一条（比如已写 long hair），就认为外观在，
      // 不再堆同义词，避免 "long hair, short hair" 这种自相矛盾。
      if (look.hair.length && !look.hair.some((tag) => lowBody.includes(tag.toLowerCase()))) {
        push(look.hair);
      }
      if (look.eyes.length && !look.eyes.some((tag) => lowBody.includes(tag.toLowerCase()))) {
        push(look.eyes);
      }
    });
    if (!added.length) return false;
    draft.body = `${body}, ${added.join(", ")}`;
    draft.prompt = (draft.prefix || "") + draft.body;
    draft.notes = [...(draft.notes || []), `已按角色设定补回外观：${added.join(", ")}`];
    return true;
  }

  function preserveDraftArtists(text, draft) {
    // 兜底：转写接口偶尔丢掉原文的 @画师（SDXL 出口、旧缓存都会），
    // 这里按原文把缺的画师补回预览与生成用的 prompt。
    const source = splitTags(text).filter((tag) => parseArtistTag(tag));
    if (!source.length || !draft) return false;
    const present = new Set(draft.tags.map(draftArtistIdentity).filter(Boolean));
    const missing = source.filter((tag) => {
      const identity = draftArtistIdentity(tag);
      return identity && !present.has(identity);
    });
    if (!missing.length) return false;
    const segment = missing.join(", ");
    draft.tags = [...missing, ...draft.tags];
    draft.body = String(draft.body || "");
    const marker = draft.body.search(/\nTags:/i);
    if (marker >= 0) {
      const head = draft.body.slice(0, marker);
      const tail = draft.body.slice(marker).replace(/^(\nTags:\s*)/i, `$1${segment}, `);
      draft.body = head + tail;
    } else {
      draft.body = draft.body ? `${segment}, ${draft.body}` : segment;
    }
    draft.prompt = (draft.prefix || "") + draft.body;
    draft.edited = true;
    draft.notes = [...(draft.notes || []), `已按原文补回画师标签：${segment}`];
    return true;
  }

  function renderPromptDraft() {
    const draft = state.promptDraft;
    const hasDraft = Boolean(draft && draft.body);
    const visible = hasDraft || state.promptDraftBusy || Boolean(state.promptDraftError);
    const collapsed = Boolean(state.promptDraftCollapsed && hasDraft && !state.promptDraftBusy);
    el.promptDraft.hidden = !visible;
    el.promptDraft.classList.toggle("is-collapsed", collapsed);
    el.promptDraftOpen.hidden = true;
    el.promptDraft.classList.toggle("is-busy", Boolean(state.promptDraftBusy));
    el.promptDraft.classList.toggle("is-error", Boolean(state.promptDraftError));
    el.promptDraftState.hidden = collapsed || !(state.promptDraftBusy || state.promptDraftError);
    el.promptDraftState.textContent = state.promptDraftBusy
      ? "正在按当前模型转写，首次调用需加载模型，约 10–30 秒…"
      : state.promptDraftError;
    const editing = Boolean(state.promptDraftEditing && hasDraft);
    el.promptDraftEditorWrap.hidden = !editing;
    el.promptDraftBody.hidden = editing || collapsed;
    if (editing) {
      if (el.promptDraftEditor.value !== draft.body) el.promptDraftEditor.value = draft.body;
    } else {
      el.promptDraftBody.textContent = hasDraft ? draft.body : "";
    }
    const draftLabel = hasDraft ? promptDraftArchLabel(draft.arch) : "";
    el.promptDraftTitle.textContent = !hasDraft || draftLabel === "英文提示词"
      ? "英文提示词"
      : `${draftLabel} · 英文提示词`;
    if (el.promptDraftConfirm) {
      // 只有"从生成触发的转写"才显示确认键；手动点转写预览时不出现，免得误触提交。
      // 草稿必须还是当前提示词的（没被改过），否则这个确认键会提交过期内容。
      el.promptDraftConfirm.hidden = !(hasDraft && state.promptConfirmPending && promptDraftFresh());
    }
    const notes = hasDraft && Array.isArray(draft.notes) ? draft.notes : [];
    el.promptDraftNotes.hidden = collapsed || !notes.length;
    if (notes.length) {
      el.promptDraftNotes.replaceChildren(...notes.map((text) => {
        const row = document.createElement("span");
        row.textContent = String(text);
        return row;
      }));
    } else {
      el.promptDraftNotes.replaceChildren();
    }
    const bits = [];
    if (hasDraft) {
      if (draft.mode === "tags") bits.push("标签模式");
      if (draft.tags.length) bits.push(draft.tags.length + " 个标签");
      if (draft.extras?.length) bits.push(`追加 ${draft.extras.length} 组原文词`);
      if (draft.elapsed) bits.push(draft.elapsed + " ms");
      if (draft.cached) bits.push("缓存");
      if (draft.edited) bits.push("已手动修改");
      if (state.rating !== "auto") bits.push(`评级 ${RATING_LABELS[state.rating]} · ${ratingTag()}`);
      bits.push(promptDraftFresh()
        ? "生成时自动使用"
        : (hasChineseText(promptCoreText())
          ? "输入 / 模型 / 评级已变，生成时重新转写"
          : "纯英文原样发送；要改就重新预览"));
    }
    el.promptDraftNote.textContent = bits.join(" · ");
    el.promptDraftTools.hidden = !hasDraft || state.promptDraftBusy || editing;
    [el.promptDraftRetry, el.promptDraftEdit, el.promptDraftCopy].forEach((node) => {
      if (node) node.hidden = collapsed;
    });
    if (el.promptDraftHide) el.promptDraftHide.textContent = collapsed ? "展开" : "收起";
  }

  function invalidatePromptDraft() {
    state.promptDraftSeq += 1;
    state.promptDraft = null;
    state.promptDraftError = "";
    state.promptDraftEditing = false;
    state.promptDraftBusy = false;
    state.converting = false;
    state.promptDraftCollapsed = false;
    updateGenerateButtons();
    renderPromptDraft();
  }

  // ---- 不同模型的"合法提示词"不一样，转写完统一擦一遍
  // Krea/MOSS 是自然语言通道：质量词、A1111 权重语法、@ 前缀在它们眼里只是噪声字符。
  // Anima/Pony 是标签通道：必须小写 + 空格，下划线形式底模认不出来。
  const PROMPT_BOILERPLATE = /\b(masterpiece|best quality|high quality|ultra detailed|ultra-detailed|8k|4k|highres|absurdres|very aesthetic|amazing quality|newest|sharp focus|best shadow|official art)\b,?\s*/gi;

  function normalizeTagLine(line) {
    return String(line || "")
      .split(/[,，]/)
      .map((tag) => tag.trim().replace(/_/g, " ").replace(/\s{2,}/g, " ").toLowerCase())
      .filter(Boolean)
      .join(", ");
  }

  // 逐行找 "Tags:" 那行再整理，避免在源码里写转义正则（容易被编辑器/工具链吃掉反斜杠）
  function normalizeAnimaTagsLine(text) {
    const lines = String(text || "").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const head = line.slice(0, 5).toLowerCase();
      if (head === "tags:") {
        lines[i] = "Tags: " + normalizeTagLine(line.slice(5));
        break;
      }
    }
    return lines.join("\n");
  }

  function normalizeDraftForArch(arch, body) {
    let text = String(body || "").trim();
    if (!text) return text;
    // 质量词对所有架构都是冗余的：APP 会按 profile 自己加前缀，留着只会重复。
    text = text.replace(PROMPT_BOILERPLATE, " ");
    if (arch === "krea" || arch === "moss") {
      text = text.replace(/\(([^()]+):\s*\d+(?:\.\d+)?\)/g, "$1");
      text = text.replace(/\[([^\[\]]+)\]/g, "$1");
      text = text.replace(/(^|[\s,])@(?=[A-Za-z])/g, "$1");
      text = text.replace(/\s{2,}/g, " ");
      text = text.replace(/\s+([,.])/g, "$1");
      return tidySeparators(text);
    }
    if (arch === "anima") {
      return normalizeAnimaTagsLine(text);
    }
    return tidySeparators(normalizeTagLine(text));
  }

  // 反复替换会留下 "a, , b" 和行尾逗号，统一收干净。
  function tidySeparators(text) {
    return String(text || "")
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s,]+$/, "")
      .trim();
  }

  // ---- 图反推（WD14）：拖一张图 -> 一堆标签 -> 直接进提示词
  // 借 prompt-workbench 的「图反推」，但多走一步：Krea / MOSS 是自然语言模型，
  // 标签串它们读起来很别扭，所以追加完自动转写一次。
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function interrogateFromFile(file) {
    if (!file) return null;
    if (state.interrogating) return null;
    state.interrogating = true;
    if (el.interrogateBtn) {
      el.interrogateBtn.loading = true;
      el.interrogateBtn.disabled = true;
    }
    snack("正在反推标签…（首次会加载 311MB 模型，之后 1–2 秒）");
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/local/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, limit: 28 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const tags = (data.tags || []).map((item) => String(item.tag || "")).filter(Boolean);
      if (!tags.length) {
        snack("没识别出标签，换张更清楚的图试试", { bad: true });
        return null;
      }
      const current = el.prompt.value.trim();
      setPrompt(current ? `${current}, ${tags.join(", ")}` : tags.join(", "));
      snack(`已追加 ${tags.length} 个标签 · ${(Number(data.elapsed) || 0)} ms`);
      // 自然语言底模：标签串再走一遍本地 4B 转写，输出才是它们看得懂的段落。
      const arch = activeProfile()?.arch;
      if (arch === "krea" || arch === "moss") {
        convertPromptToEnglish({ announce: true });
      }
      return data;
    } catch (err) {
      snack("图反推失败：" + (err?.message || "未知错误"), { bad: true });
      return null;
    } finally {
      state.interrogating = false;
      if (el.interrogateBtn) {
        el.interrogateBtn.loading = false;
        el.interrogateBtn.disabled = false;
      }
      if (el.interrogateFile) el.interrogateFile.value = "";
    }
  }

  async function convertPromptToEnglish({ retry = false, announce = false, collapse = false, pendingConfirm = false } = {}) {
    const raw = el.prompt.value.trim();
    if (!raw || state.converting) return null;
    const extras = collectPromptExtras(raw);
    const text = stripPromptExtras(raw, extras).trim();
    if (!text) {
      snack("先写一句中文画面描述", { bad: true });
      return null;
    }
    // 页面刚打开时状态可能还没回填，先补一次，避免按未知架构写成纯标签。
    if (!state.activeModel) await refreshStatus();
    if (!state.activeModel) {
      state.promptDraftError = "引擎状态还没就绪，稍后再试";
      renderPromptDraft();
      if (announce) snack(state.promptDraftError, { bad: true });
      return null;
    }
    const signature = promptDraftSignature(text);
    state.promptDraftSeq += 1;
    const seq = state.promptDraftSeq;
    state.promptDraftBusy = true;
    state.converting = true;
    state.promptDraftError = "";
    state.promptDraftEditing = false;
    state.promptDraftCollapsed = false;
    updateGenerateButtons();
    renderPromptDraft();
    try {
      const res = await fetch("/api/prompt/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model: state.activeModel,
          style: "auto",
          // 评级不只影响最终标签：nsfw/露骨档会要求 4B 保留成人动作、
          // 不写委婉语，所以必须参与这次转译。
          rating: state.rating,
          retry: Boolean(retry)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (seq !== state.promptDraftSeq) return null;
      state.promptDraft = {
        signature,
        source: text,
        prompt: String(data.prompt || ""),
        body: String(data.body || data.prompt || ""),
        caption: String(data.caption || ""),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        prefix: String(data.prefix || ""),
        mode: data.mode === "tags" ? "tags" : "caption",
        arch: data.arch || state.activeArch || "",
        elapsed: Number(data.elapsed) || 0,
        engine: data.engine || "",
        cached: Boolean(data.cached),
        notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
        edited: false
      };
      // 按架构做一遍规范化：不同模型的"合法提示词"长得不一样，
      // 4B 偶尔会串味（给 Krea 加 @画师、给 Pony 写句子），这里统一擦干净。
      const normalized = normalizeDraftForArch(state.promptDraft.arch, state.promptDraft.body);
      if (normalized && normalized !== state.promptDraft.body) {
        state.promptDraft.body = normalized;
        state.promptDraft.prompt = (state.promptDraft.prefix || "") + normalized;
        state.promptDraft.notes = [...(state.promptDraft.notes || []), "已按当前模型的提示词规范整理格式"];
      }
      preserveDraftArtists(text, state.promptDraft);
      lockCharacterLook(text, state.promptDraft);
      // 从「生成」触发的转写先不提交，等用户在预览里确认（可自由编辑）。
      if (pendingConfirm) {
        state.promptConfirmPending = true;
        state.promptDraftCollapsed = false;
      }
      state.promptDraft.extras = extras;
      if (extras.length) {
        state.promptDraft.body = appendPromptExtras(state.promptDraft.body, extras);
        state.promptDraft.prompt = (state.promptDraft.prefix || "") + state.promptDraft.body;
        state.promptDraft.notes = [...(state.promptDraft.notes || []), "细化词与触发词已按原文追加到 Tags 行"];
      }
      if (announce) {
        snack("英文提示词已更新 · 生成时自动使用");
        el.promptDraft.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      // 生成流程里自动转写成功后收成一行，把画布和参数区让出来；
      // 手动点「AI 整提示词」仍保持展开，方便检查。
      if (collapse) {
        state.promptDraftCollapsed = true;
        renderPromptDraft();
      }
      return state.promptDraft;
    } catch (err) {
      if (seq === state.promptDraftSeq) {
        // 新输入转写失败时，旧草稿已经过期，必须清掉，避免误用上一段描述。
        if (state.promptDraft && state.promptDraft.signature !== signature) {
          state.promptDraft = null;
          state.promptDraftEditing = false;
        }
        state.promptDraftError = "转写失败：" + (err?.message || "未知错误");
        if (announce) snack(state.promptDraftError, { bad: true });
      }
      return null;
    } finally {
      if (seq === state.promptDraftSeq) {
        state.promptDraftBusy = false;
        state.converting = false;
        updateGenerateButtons();
        renderPromptDraft();
      }
    }
  }

  async function previewPromptDraft() {
    const text = el.prompt.value.trim();
    if (!text) {
      snack("先写一句中文画面描述", { bad: true });
      el.prompt.focus();
      return;
    }
    if (!state.translateEnabled) {
      snack("转写开关是关的：先打开它再用转写预览", { bad: true });
      return;
    }
    if (promptDraftFresh() && state.promptDraft?.body) {
      syncPromptDraftExtras();
      state.promptDraftCollapsed = false;
      renderPromptDraft();
      el.promptDraft.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    await convertPromptToEnglish({ announce: true });
  }

  async function resolveGenerationPrompt() {
    const raw = el.prompt.value.trim();
    const extras = collectPromptExtras(raw);
    const core = stripPromptExtras(raw, extras).trim();
    // 转写总开关：关掉就原文直送（中文也一样），不再做任何改写。
    if (!state.translateEnabled) return { ok: true, prompt: "", source: "", extras };
    // 已经有新鲜草稿（用户点过转写、或刚确认过）就直接用。
    if (promptDraftFresh() && state.promptDraft?.prompt) {
      const base = stripPromptExtras(state.promptDraft.prompt, state.promptDraft.extras || []);
      return { ok: true, prompt: appendPromptExtras(base, extras), source: core, extras };
    }
    // 纯英文标签/句子原样透传，不为了加前缀把用户的文本再送去 4B。
    if (!hasChineseText(core)) return { ok: true, prompt: "", source: "" };
    // 需要新转写：先出可自由编辑的预览，用户点「确认并生成」才真正提交。
    const draft = await convertPromptToEnglish({ pendingConfirm: true });
    if (!draft?.prompt) return { ok: false, error: state.promptDraftError || "中文转写失败，未开始生成" };
    return { ok: false, needConfirm: true };
  }

  function startPromptDraftEdit() {
    if (!state.promptDraft?.body) return;
    state.promptDraftEditing = true;
    renderPromptDraft();
    el.promptDraftEditor.focus();
  }

  function cancelPromptDraftEdit() {
    state.promptDraftEditing = false;
    renderPromptDraft();
  }

  // 用户在预览里改完、点「确认并生成」：把当前编辑内容存成草稿，再走一次生成。
  // 这一次 promptDraftFresh() 为真，直接复用草稿，不会再触发第二轮转写。
  async function confirmDraftAndGenerate() {
    if (!state.promptDraft) return;
    if (state.promptDraftEditing) savePromptDraftEdit();
    state.promptConfirmPending = false;
    state.promptDraftCollapsed = true;
    renderPromptDraft();
    await generate();
  }

  function savePromptDraftEdit() {
    if (!state.promptDraft) return;
    const value = el.promptDraftEditor.value.trim();
    if (!value) {
      snack("英文提示词不能为空", { bad: true });
      return;
    }
    state.promptDraft.body = value;
    // 预览只显示正文；生成时仍要带当前模型的质量前缀。
    state.promptDraft.prompt = (state.promptDraft.prefix || "") + value;
    state.promptDraft.edited = true;
    state.promptDraftEditing = false;
    renderPromptDraft();
    snack("已保存英文草稿 · 生成时使用");
  }

  function syncPromptDraftExtras() {
    const draft = state.promptDraft;
    if (!draft?.prompt || !promptDraftFresh()) return false;
    const extras = collectPromptExtras(el.prompt.value);
    const previous = Array.isArray(draft.extras) ? draft.extras : [];
    const basePrompt = stripPromptExtras(draft.prompt, previous);
    const baseBody = stripPromptExtras(draft.body || "", previous);
    const nextPrompt = appendPromptExtras(basePrompt, extras);
    const nextBody = appendPromptExtras(baseBody, extras);
    const changed = nextPrompt !== draft.prompt || nextBody !== draft.body;
    draft.extras = extras;
    if (!changed) return false;
    draft.prompt = nextPrompt;
    draft.body = nextBody;
    draft.edited = true;
    renderPromptDraft();
    return true;
  }

  async function copyPromptDraft() {
    const value = state.promptDraftEditing
      ? el.promptDraftEditor.value.trim()
      : String(state.promptDraft?.body || "").trim();
    if (!value) {
      snack("还没有英文草稿", { bad: true });
      return;
    }
    const ok = await copyText(value);
    snack(ok ? "英文草稿已复制" : "复制失败，请手动选择文本", { bad: !ok });
  }

  function mergeRecipe(recipe, mode = "switch") {
    const before = el.prompt.value;
    let next = before.trim() ? before : DEFAULT_PROMPT;
    if (mode === "switch") next = removeTags(next, ALL_RECIPE_TAGS);
    next = removeTags(next, ["simple background"]);
    next = mergeTags(next, recipe.tags.split(",").map((tag) => tag.trim()));
    setPrompt(next);
    refreshStyleChips();
    snack(`已${mode === "add" ? "加入" : "套用"}「${recipe.name}」`, {
      action: "撤销",
      onActionClick: () => {
        setPrompt(before);
        refreshStyleChips();
      }
    });
  }

  function removeRecipe(recipe) {
    const before = el.prompt.value;
    setPrompt(removeTags(before, recipe.tags.split(",").map((tag) => tag.trim())));
    refreshStyleChips();
    snack(`已移除「${recipe.name}」`, {
      action: "撤销",
      onActionClick: () => {
        setPrompt(before);
        refreshStyleChips();
      }
    });
  }

  function toggleRecipe(recipe) {
    if (recipeIsActive(recipe)) {
      removeRecipe(recipe);
    } else {
      mergeRecipe(recipe, "switch");
    }
  }

  function surprisePrompt() {
    const before = el.prompt.value;
    const recipe = pick(RECIPES);
    const lightTags = TAG_GROUPS.find((group) => group.id === "light").tags;
    const frameTags = TAG_GROUPS.find((group) => group.id === "frame").tags;
    const moodTags = TAG_GROUPS.find((group) => group.id === "mood").tags;
    const extras = [pick(lightTags), pick(frameTags), pick(moodTags)];
    let next = before.trim() ? before : DEFAULT_PROMPT;
    next = removeTags(next, ALL_RECIPE_TAGS);
    next = removeTags(next, ["simple background"]);
    next = mergeTags(next, recipe.tags.split(",").map((tag) => tag.trim()));
    next = mergeTags(next, extras.map(([tag]) => tag));
    setPrompt(next);
    refreshStyleChips();
    snack(`随机灵感：${recipe.name} · ${extras.map(([, zh]) => zh).join(" / ")}`, {
      action: "撤销",
      onActionClick: () => {
        setPrompt(before);
        refreshStyleChips();
      }
    });
  }

  function cleanPrompt() {
    const before = el.prompt.value;
    const cleaned = normalizePrompt(before);
    if (cleaned === before) {
      snack("标签已经很整齐了");
      return;
    }
    setPrompt(cleaned);
    snack("已去重、整理逗号与空格", {
      action: "撤销",
      onActionClick: () => setPrompt(before)
    });
  }

  async function copyPrompt() {
    const value = el.prompt.value.trim();
    if (!value) {
      snack("提示词还是空的", { bad: true });
      return;
    }
    const ok = await copyText(value);
    snack(ok ? "描述已复制" : "复制失败，请手动选择文本", { bad: !ok });
  }

  /* --------------------------------------------------------------- presets */
  function createInspirationEntryChip() {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "assist");
    chip.id = "inspirationChip";
    chip.className = "inspiration-entry-chip";
    chip.title = "打开灵感与标签";
    const mark = document.createElement("span");
    mark.setAttribute("slot", "icon");
    mark.className = "icon";
    mark.dataset.icon = "sparkles";
    const label = document.createElement("span");
    label.id = "inspirationChipLabel";
    label.textContent = "灵感与标签";
    const badge = document.createElement("span");
    badge.id = "inspirationChipCount";
    badge.className = "artist-entry-count";
    badge.hidden = true;
    chip.append(mark, label, badge);
    chip.addEventListener("click", openInspiration);
    return chip;
  }

  function createKreaHintChip() {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "assist");
    chip.className = "moss-layout-chip";
    chip.textContent = "写法要点";
    chip.title = "Krea 2 提示词写法：描述而非标签、名词具体、写清光源位置、画内文字加引号";
    chip.addEventListener("click", () => {
      snack("Krea 2：用完整句子描述而不是堆标签（8k / masterpiece 在这里无效）；名词要具体；一定写清光从哪来；画面里的文字用引号括起来。");
    });
    return chip;
  }

  function renderStyleStrip() {
    el.styleStrip.innerHTML = "";
    const arch = activeProfile()?.arch;
    const isMoss = arch === "moss";
    if (el.mossLayoutHint) el.mossLayoutHint.hidden = !isMoss;
    // MOSS / Krea 都吃自然语言，画师库与 Danbooru 标签对它们没有意义。
    // 两套词库都收进「灵感与标签」弹窗左栏，风格条上只留入口。
    if (isMoss) {
      el.styleStrip.appendChild(createInspirationEntryChip());
      el.styleStrip.appendChild(createCharacterEntryChip());
      el.styleStrip.appendChild(createMossLayoutChip());
      hydrateIcons(el.styleStrip);
      refreshStyleChips();
      return;
    }
    if (arch === "krea") {
      el.styleStrip.appendChild(createInspirationEntryChip());
      el.styleStrip.appendChild(createCharacterEntryChip());
      el.styleStrip.appendChild(createKreaHintChip());
      hydrateIcons(el.styleStrip);
      refreshStyleChips();
      return;
    }
    // 风格配方已收进「灵感与标签」弹窗左栏；这里放画师、角色库与标签库三个独立入口。
    el.styleStrip.appendChild(createArtistEntryChip());
    el.styleStrip.appendChild(createCharacterEntryChip());
    el.styleStrip.appendChild(createInspirationEntryChip());
    hydrateIcons(el.styleStrip);
    refreshStyleChips();
    refreshArtistChip();
  }

  /* -------------------------------------------------- MOSS 分组预设条 */
  function createMossGroupTabs() {
    const wrap = document.createElement("div");
    wrap.className = "moss-group-tabs";
    for (const group of MOSS_PRESET_GROUPS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "moss-group-tab" + (group.id === mossPresetGroup ? " is-active" : "");
      tab.textContent = group.label;
      tab.title = `${group.label}类预设，共 ${group.items.length} 条；可与其它分类叠加使用`;
      tab.addEventListener("click", () => {
        if (mossPresetGroup === group.id) return;
        mossPresetGroup = group.id;
        renderStyleStrip();
      });
      wrap.appendChild(tab);
    }
    return wrap;
  }

  function mossStyleApplied(preset) {
    return el.prompt.value.includes(preset.text);
  }

  function createMossStyleChip(preset) {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "filter");
    chip.className = "moss-style-chip";
    chip.dataset.styleId = preset.id;
    chip.textContent = preset.label;
    chip.title = preset.text;
    if (mossStyleApplied(preset)) chip.setAttribute("selected", "");
    chip.addEventListener("click", () => toggleMossStyle(preset));
    return chip;
  }

  function toggleMossStyle(preset) {
    const text = el.prompt.value;
    let next;
    if (text.includes(preset.text)) {
      // 取消：把词条本身抹掉，再清理残留的重复分隔符与首尾标点。
      next = text.split(preset.text).join("");
      next = next.replace(/[，,、;；]\s*(?=[，,、;；])/g, "");
      next = next.replace(/^[\s，,、;；]+|[\s，,、;；]+$/g, "");
    } else {
      const trimmed = text.trim();
      // 已有句末标点就不重复加逗号，空提示词则直接用词条开句。
      const sep = !trimmed ? "" : (/[，,。；;、]\s*$/.test(trimmed) ? "" : "，");
      next = trimmed ? trimmed + sep + preset.text : preset.text;
    }
    setPrompt(next, { save: false });
    scheduleSave();
    renderStyleStrip();
  }

  /* -------------------------------------------------- MOSS 原生布局框 */
  // 语法由 comfy_bridge._moss_layout_prompt 解析成 MOSSImageLayoutPrompt 的 JSON。
  // 坐标是 0-100 百分比（左上 -> 右下），不是像素，改分辨率也不用重算。
  const MOSS_LAYOUT_TEMPLATE = [
    "@box 5,10,45,95 | 画面左侧的主体，比如一个穿红裙的女孩",
    "@box 52,55,95,90 | 画面右侧的物体，比如一只白色的猫"
  ].join("\n");

  function createMossLayoutChip() {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "assist");
    chip.className = "moss-layout-chip";
    chip.textContent = "布局框";
    chip.title = "插入 MOSS 原生布局框：@box x0,y0,x1,y1 | 描述（0-100 百分比坐标）";
    if (el.prompt.value.includes("@box")) chip.classList.add("has-active");
    chip.addEventListener("click", insertMossLayoutTemplate);
    return chip;
  }

  function insertMossLayoutTemplate() {
    const text = el.prompt.value;
    if (text.includes("@box")) {
      snack("提示词里已经有布局框了，直接改坐标和描述即可");
      el.prompt.focus();
      return;
    }
    const next = (text.trim() ? text.trim() + "\n" : "") + MOSS_LAYOUT_TEMPLATE;
    setPrompt(next, { save: false });
    scheduleSave();
    renderStyleStrip();
    snack("已插入布局框：坐标是 0-100 百分比（左上→右下），MOSS 会按框排布物体");
    el.prompt.focus();
  }

  /* ------------------------------------------------------------ 画师弹窗 */
  function createArtistEntryChip() {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "assist");
    chip.id = "artistChip";
    chip.className = "artist-entry-chip";
    const mark = document.createElement("span");
    mark.setAttribute("slot", "icon");
    mark.className = "icon";
    mark.dataset.icon = "palette";
    const label = document.createElement("span");
    label.id = "artistChipLabel";
    label.textContent = "画师";
    const badge = document.createElement("span");
    badge.id = "artistChipCount";
    badge.className = "artist-entry-count";
    badge.hidden = true;
    chip.append(mark, label, badge);
    chip.addEventListener("click", openArtistDialog);
    return chip;
  }

  function buildArtistGroups() {
    if (!el.artistGroups || el.artistGroups.dataset.ready === "1") return;
    const fragment = document.createDocumentFragment();
    for (const group of ARTIST_GROUPS) {
      const section = document.createElement("section");
      section.className = "artist-group";
      section.dataset.group = group.id;
      const head = document.createElement("div");
      head.className = "artist-group-head";
      const title = document.createElement("h4");
      title.textContent = group.name;
      const hint = document.createElement("span");
      hint.textContent = group.hint;
      const count = document.createElement("span");
      count.className = "artist-group-count";
      count.textContent = String(group.artists.length);
      head.append(title, hint, count);
      const grid = document.createElement("div");
      grid.className = "artist-grid";
      for (const artist of group.artists) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "artist-card";
        card.dataset.artist = normalizeArtistKey(artist.tag);
        card.dataset.search = `${artist.name} ${artist.tag} ${artist.styles.join(" ")} ${group.name} ${group.hint}`.toLowerCase();
        card.setAttribute("aria-pressed", "false");
        const name = document.createElement("span");
        name.className = "artist-card-name";
        name.textContent = artist.name;
        const styles = document.createElement("span");
        styles.className = "artist-styles";
        for (const style of artist.styles) {
          const pill = document.createElement("span");
          pill.textContent = style;
          styles.appendChild(pill);
        }
        const tag = document.createElement("span");
        tag.className = "artist-tag";
        tag.textContent = artist.tag;
        const ordinal = document.createElement("span");
        ordinal.className = "artist-ordinal";
        ordinal.hidden = true;
        card.append(name, styles, tag, ordinal);
        card.addEventListener("click", () => toggleArtist(artist));
        grid.appendChild(card);
      }
      section.append(head, grid);
      fragment.appendChild(section);
    }
    el.artistGroups.replaceChildren(fragment);
    el.artistGroups.dataset.ready = "1";
    buildArtistNav();
  }

  function buildArtistNav() {
    if (!el.artistGroupNav) return;
    const items = [{ id: "all", name: "全部", count: ARTIST_TOTAL }].concat(
      ARTIST_GROUPS.map((group) => ({ id: group.id, name: group.name, count: group.artists.length }))
    );
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-nav-pill";
      button.dataset.group = item.id;
      button.append(document.createTextNode(item.name));
      const count = document.createElement("b");
      count.textContent = String(item.count);
      button.appendChild(count);
      button.addEventListener("click", () => {
        artistState.group = item.id;
        syncArtistNav();
        applyArtistFilter();
        el.artistScroll.scrollTop = 0;
      });
      fragment.appendChild(button);
    }
    el.artistGroupNav.replaceChildren(fragment);
    syncArtistNav();
  }

  function syncArtistNav() {
    $$(".tag-nav-pill", el.artistGroupNav).forEach((button) => {
      const active = button.dataset.group === artistState.group;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function applyArtistFilter() {
    if (!el.artistGroups) return;
    const query = artistState.query.trim().toLowerCase();
    const searching = Boolean(query);
    let visible = 0;
    $$(".artist-group", el.artistGroups).forEach((section) => {
      const inGroup = artistState.group === "all" || section.dataset.group === artistState.group;
      let count = 0;
      $$(".artist-card", section).forEach((card) => {
        const show = inGroup && (!searching || (card.dataset.search || "").includes(query));
        card.hidden = !show;
        if (show) count += 1;
      });
      section.hidden = count === 0;
      visible += count;
    });
    el.artistGroupNav.hidden = searching;
    el.artistEmpty.hidden = visible > 0;
    el.artistResultCount.textContent = searching
      ? `${visible} 位匹配`
      : `${visible} 位画师`;
  }

  function syncArtistCards() {
    $$(".artist-card", el.artistGroups).forEach((card) => {
      const index = artistPickIndex(card.dataset.artist);
      const selected = index >= 0;
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-locked", !selected && artistState.picks.length >= 4);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
      const ordinal = card.querySelector(".artist-ordinal");
      if (ordinal) {
        ordinal.hidden = !selected;
        if (selected) ordinal.textContent = String(index + 1);
      }
    });
  }

  function buildArtistPickRow(entry, index) {
    const row = document.createElement("div");
    row.className = "artist-pick";

    const head = document.createElement("div");
    head.className = "artist-pick-head";
    const no = document.createElement("span");
    no.className = "artist-pick-no";
    no.textContent = String(index + 1);
    const main = document.createElement("div");
    main.className = "artist-pick-main";
    const name = document.createElement("span");
    name.className = "artist-pick-name";
    name.textContent = entry.name;
    name.title = entry.tag;
    const styles = document.createElement("span");
    styles.className = "artist-pick-styles";
    const groupName = ARTIST_GROUP_NAMES.get(entry.group);
    const styleParts = entry.styles.length
      ? [groupName, ...entry.styles].filter(Boolean)
      : [];
    styles.textContent = styleParts.length ? styleParts.join(" · ") : "提示词中的自定义画师";
    styles.title = styles.textContent;
    main.append(name, styles);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "artist-pick-remove";
    remove.title = `移除 ${entry.name}`;
    remove.setAttribute("aria-label", `移除 ${entry.name}`);
    remove.innerHTML = icon("close", 13);
    remove.addEventListener("click", () => {
      artistState.picks.splice(index, 1);
      renderArtistPicks();
    });
    head.append(no, main, remove);

    const weightRow = document.createElement("div");
    weightRow.className = "artist-weight-row";
    const range = document.createElement("input");
    range.type = "range";
    range.className = "artist-weight";
    range.min = "0.2";
    range.max = "1.5";
    range.step = "0.05";
    range.value = String(entry.weight);
    range.setAttribute("aria-label", `${entry.name} 权重`);
    const out = document.createElement("output");
    out.className = "artist-weight-out";
    out.textContent = Number(entry.weight).toFixed(2);
    range.addEventListener("input", () => {
      entry.weight = clamp(Number(range.value) || 1, 0.2, 1.5);
      out.textContent = entry.weight.toFixed(2);
      renderArtistPreview();
    });
    weightRow.append(range, out);

    row.append(head, weightRow);
    return row;
  }

  function renderArtistPreview() {
    const segment = artistSegment();
    el.artistPreview.textContent = segment || "—";
    el.artistPreview.title = segment;
    el.artistPreviewCount.textContent = `${artistState.picks.length} 位`;
  }

  function renderArtistPicks() {
    el.artistPickCount.textContent = `${artistState.picks.length} / 4`;
    el.artistPickEmpty.hidden = artistState.picks.length > 0;
    const fragment = document.createDocumentFragment();
    artistState.picks.forEach((entry, index) => fragment.appendChild(buildArtistPickRow(entry, index)));
    el.artistPicks.replaceChildren(fragment);
    const empty = artistState.picks.length === 0;
    el.artistBalanceBtn.disabled = empty;
    el.artistPrimaryBtn.disabled = empty;
    el.artistClearBtn.disabled = empty;
    renderArtistPreview();
    syncArtistCards();
  }

  function toggleArtist(artist) {
    const key = normalizeArtistKey(artist.tag);
    const index = artistPickIndex(key);
    if (index >= 0) {
      artistState.picks.splice(index, 1);
      renderArtistPicks();
      return;
    }
    if (artistState.picks.length >= 4) {
      snack("最多混合 4 位；先移除一位再加");
      return;
    }
    artistState.picks.push({
      key,
      tag: artist.tag,
      name: artist.name,
      styles: artist.styles.slice(),
      group: artist.groupId,
      custom: false,
      weight: artistState.picks.length === 0 ? 1 : 0.65
    });
    renderArtistPicks();
  }

  function setAllArtistWeights(first, rest) {
    if (!artistState.picks.length) return;
    artistState.picks.forEach((entry, index) => {
      entry.weight = index === 0 ? first : rest;
    });
    renderArtistPicks();
  }

  function clearArtistPicks() {
    if (!artistState.picks.length) return;
    artistState.picks = [];
    renderArtistPicks();
  }

  function openArtistDialog() {
    dismissSnacks();
    buildArtistGroups();
    artistState.picks = promptArtists();
    artistState.query = "";
    artistState.group = "all";
    if (el.artistSearch) el.artistSearch.value = "";
    syncArtistNav();
    applyArtistFilter();
    renderArtistPicks();
    el.artistDialog.fullscreen = window.innerWidth <= 720;
    el.artistDialog.open = true;
  }

  function applyArtistPicks() {
    const before = el.prompt.value;
    const base = before.trim() ? before : DEFAULT_PROMPT;
    const stripped = stripArtistTags(base);
    const segment = artistSegment();
    const next = segment ? insertArtistTags(stripped, segment) : normalizePrompt(stripped);
    if (normalizePrompt(next) === normalizePrompt(before)) {
      snack("画师标签没有变化");
      return;
    }
    el.artistDialog.open = false;
    setPrompt(next);
    const count = artistState.picks.length;
    snack(count ? `已写入 ${count} 位画师` : "已移除提示词里的画师", {
      action: "撤销",
      onActionClick: () => setPrompt(before)
    });
  }

  /* ---------------------------------------------------------------- 角色库 */
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
  const CHARACTER_SUMMARY_SKIP = new Set(["1girl", "1boy", "solo", "adult", "mature female"]);

  // 全年龄库的硬性净化词：预设本身不写这些词，应用时再从整条提示词里兜底剔除。
  const ALL_AGES_BLOCKED_TAGS = new Set([
    "adult", "adult female", "adult woman", "mature female", "mature woman", "mature", "milf",
    "nsfw", "explicit", "sensitive", "questionable",
    "rating sensitive", "rating nsfw", "rating explicit", "rating questionable",
    "nude", "naked", "topless", "underwear", "lingerie", "bikini", "swimsuit", "cleavage",
    "large breasts", "huge breasts", "medium breasts", "small breasts", "nipples", "areola",
    "seductive", "bedroom eyes", "spread legs", "panties", "bra",
    "sex", "sexual", "sexy", "cum", "semen", "penis", "vagina", "pussy", "anus", "anal",
    "oral", "fellatio", "cunnilingus", "paizuri", "handjob", "masturbation", "orgasm",
    "ahegao", "rape", "noncon", "incest", "bondage", "bdsm", "cameltoe", "see-through",
    "wet clothes", "undressing", "clothes lift", "skirt lift", "pantyshot", "upskirt",
    "downblouse", "breast focus", "thigh focus", "ass focus", "groin", "crotch",
    "bare breasts", "exposed breasts", "pasties", "garter belt"
  ]);

  function characterTagKey(tag) {
    return String(tag || "").toLowerCase()
      .replace(/^\(+/, "").replace(/\)+$/, "")
      .replace(/:\s*[\d.]+$/, "")
      .trim();
  }

  function stripAllAgesConflicts(text, extra = []) {
    const blocked = new Set([...ALL_AGES_BLOCKED_TAGS, ...extra.map((item) => item.toLowerCase())]);
    return splitTags(text).filter((tag) => !blocked.has(characterTagKey(tag))).join(", ");
  }

  function characterLibrary() {
    // MOSS 用中文角色描述；Krea 用英文描述句——两者都读不懂 Danbooru 的罗马音角色名。
    const arch = activeProfile()?.arch;
    if (arch === "moss") {
      return {
        id: "moss",
        name: "角色描述",
        // 不用全年龄过滤逻辑（那套按英文标签剔除，对中文描述无意义也无害）。
        allAges: false,
        groups: MOSS_CHARACTER_GROUPS,
        total: MOSS_CHARACTER_GROUPS.reduce((sum, group) => sum + group.tags.length, 0)
      };
    }
    if (arch === "krea") {
      return {
        id: "krea",
        name: "角色描述",
        // Krea 的词条是「年龄 + 外观 + 服装」的英文短句，同样不走英文标签的过滤规则。
        allAges: false,
        groups: KREA_CHARACTER_GROUPS,
        total: KREA_CHARACTER_GROUPS.reduce((sum, group) => sum + group.tags.length, 0)
      };
    }
    return CHARACTER_LIBRARIES[state.characterMode] || CHARACTER_LIBRARIES.adult;
  }

  function applyAllAgesSafety(prompt, bundle) {
    const lower = new Set(bundle.map((item) => item.toLowerCase()));
    const extra = [];
    if (lower.has("1boy")) extra.push("1girl");
    if (lower.has("1girl")) extra.push("1boy");
    return stripAllAgesConflicts(prompt, extra);
  }

  function characterSummary(bundle, group) {
    const start = group.kind === "original" ? 0 : 2;
    const out = [];
    for (const tag of bundle.slice(start)) {
      const key = tag.toLowerCase();
      if (CHARACTER_SUMMARY_SKIP.has(key)) continue;
      const zh = CHARACTER_TAG_ZH[key];
      if (zh && !out.includes(zh)) out.push(zh);
      if (out.length >= 4) break;
    }
    return out.length ? out.join(" · ") : "外观描述";
  }

  function createCharacterEntryChip() {
    const chip = document.createElement("mdui-chip");
    chip.setAttribute("variant", "assist");
    chip.id = "characterChip";
    chip.className = "character-entry-chip";
    chip.title = `打开角色库（${ADULT_CHARACTER_TOTAL} 个成年角色 / ${NORMAL_CHARACTER_TOTAL} 个全年龄角色）`;
    const mark = document.createElement("span");
    mark.setAttribute("slot", "icon");
    mark.className = "icon";
    mark.dataset.icon = "person";
    const label = document.createElement("span");
    label.textContent = "角色";
    const badge = document.createElement("span");
    badge.id = "characterChipCount";
    badge.className = "character-entry-count";
    badge.textContent = String(CHARACTER_TOTAL);
    chip.append(mark, label, badge);
    chip.addEventListener("click", openCharacterDialog);
    return chip;
  }

  function buildCharacterGroups() {
    if (!el.characterGroups) return;
    const library = characterLibrary();
    if (el.characterGroups.dataset.ready === "1" && el.characterGroups.dataset.mode === library.id) return;
    const fragment = document.createDocumentFragment();
    for (const group of library.groups) {
      const section = document.createElement("section");
      section.className = "character-group";
      section.dataset.group = group.id;
      const head = document.createElement("div");
      head.className = "character-group-head";
      const title = document.createElement("h4");
      title.textContent = group.name;
      const hint = document.createElement("span");
      hint.textContent = group.hint;
      const count = document.createElement("span");
      count.className = "character-group-count";
      count.textContent = String(group.tags.length);
      head.append(title, hint, count);
      const grid = document.createElement("div");
      grid.className = "character-grid";
      for (const [tag, zh, aliases] of group.tags) {
        const bundle = tagBundle(tag);
        const summary = characterSummary(bundle, group);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "character-card";
        card.dataset.tag = tag;
        card.dataset.search = [tag, zh, group.name, group.hint, aliases || "", summary, ...bundle].join(" ").toLowerCase();
        card.title = `${zh}\n${bundle.join(", ")}`;
        card.setAttribute("aria-pressed", "false");
        const mark = document.createElement("span");
        mark.className = "character-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = Array.from(zh)[0] || "?";
        const meta = document.createElement("span");
        meta.className = "character-meta";
        const name = document.createElement("strong");
        name.textContent = zh;
        const desc = document.createElement("span");
        desc.className = "character-desc";
        desc.textContent = summary;
        const en = document.createElement("span");
        en.className = "character-en";
        en.textContent = bundle[0];
        meta.append(name, desc, en);
        card.append(mark, meta);
        card.addEventListener("click", () => toggleCharacterBundle(tag, zh, card));
        grid.appendChild(card);
      }
      section.append(head, grid);
      fragment.appendChild(section);
    }
    el.characterGroups.replaceChildren(fragment);
    el.characterGroups.dataset.ready = "1";
    el.characterGroups.dataset.mode = library.id;
    renderCharacterGroupNav();
    updateCharacterResultCount();
  }

  function renderCharacterGroupNav() {
    if (!el.characterGroupNav) return;
    const library = characterLibrary();
    el.characterGroupNav.innerHTML = "";
    for (const group of library.groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-nav-pill";
      button.dataset.group = group.id;
      button.append(document.createTextNode(group.name));
      const count = document.createElement("b");
      count.textContent = String(group.tags.length);
      button.appendChild(count);
      button.addEventListener("click", () => scrollToCharacterGroup(group.id));
      el.characterGroupNav.appendChild(button);
    }
    state.activeCharacterGroup = library.groups[0]?.id || "";
    syncCharacterNav();
  }

  function syncCharacterNav() {
    $$(".tag-nav-pill", el.characterGroupNav).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.group === state.activeCharacterGroup);
    });
  }

  function scrollToCharacterGroup(groupId) {
    if (!el.characterGroups || !el.characterScroll) return;
    const group = el.characterGroups.querySelector(`.character-group[data-group="${groupId}"]`);
    if (!group) return;
    state.activeCharacterGroup = groupId;
    syncCharacterNav();
    const navButton = el.characterGroupNav.querySelector(`.tag-nav-pill[data-group="${groupId}"]`);
    navButton?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const top = group.getBoundingClientRect().top - el.characterScroll.getBoundingClientRect().top + el.characterScroll.scrollTop - 4;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.characterScroll.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }

  function applyCharacterFilter(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!el.characterGroups) return;
    let visible = 0;
    $$(".character-group", el.characterGroups).forEach((group) => {
      let groupVisible = 0;
      $$(".character-card", group).forEach((card) => {
        const show = !q || (card.dataset.search || "").includes(q);
        card.hidden = !show;
        if (show) groupVisible += 1;
      });
      group.hidden = groupVisible === 0;
      visible += groupVisible;
    });
    el.characterGroupNav.hidden = Boolean(q);
    el.characterEmpty.hidden = visible > 0;
    updateCharacterResultCount(visible);
  }

  function characterSelectionCount() {
    if (!el.characterGroups) return 0;
    return $$(".character-card.is-selected", el.characterGroups).length;
  }

  function updateCharacterResultCount(visible) {
    if (!el.characterResultCount) return;
    const q = String(el.characterSearch?.value || "").trim();
    const shown = visible == null
      ? $$(".character-card:not([hidden])", el.characterGroups).length
      : visible;
    const selected = characterSelectionCount();
    const library = characterLibrary();
    const base = q ? `${shown} 个匹配` : `${library.total} 个${library.name}`;
    el.characterResultCount.textContent = selected ? `${base} · 已选 ${selected}` : base;
  }

  function syncCharacterCards() {
    if (!el.characterDialog?.open || !el.characterGroups) return;
    const value = el.prompt.value;
    $$(".character-card", el.characterGroups).forEach((card) => {
      const selected = hasBundle(value, card.dataset.tag);
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    updateCharacterResultCount();
  }

  function toggleCharacterBundle(tag, zh, card) {
    const value = el.prompt.value;
    const bundle = tagBundle(tag);
    if (hasBundle(value, tag)) {
      const owned = bundleAdditions.get(tag);
      let target = owned && owned.size ? bundle.filter((item) => owned.has(item.toLowerCase())) : bundle.slice(0, 2);
      // 其他已启用的角色包还在用这些词时保留，避免拆掉别人的系列或通用外观。
      // 两套库都要扫描：成年库与全年龄库可能共享 blue dress / long hair 等通用外观词。
      const inUse = new Set();
      for (const library of Object.values(CHARACTER_LIBRARIES)) {
        for (const group of library.groups) {
          for (const [otherTag] of group.tags) {
            if (otherTag === tag) continue;
            const otherBundle = tagBundle(otherTag);
            // 只认角色名是否还在：全年龄应用可能剥掉成年库包里的 adult，
            // 但角色本身仍在使用，它的发色/瞳色等共享外观不能误删。
            // 原创模板以 1girl / solo 开头，没有角色身份，不能拿来当“别人还在用”的依据。
            if (otherBundle.length < 2 || CHARACTER_SUMMARY_SKIP.has(otherBundle[0].toLowerCase())) continue;
            if (!hasTag(value, otherBundle[0])) continue;
            otherBundle.forEach((item) => inUse.add(item.toLowerCase()));
          }
        }
      }
      target = target.filter((item) => !inUse.has(item.toLowerCase()));
      setPrompt(removeTags(value, target));
      bundleAdditions.delete(tag);
      persistBundleAdditions();
    } else {
      const existing = new Set(splitTags(value).map((item) => item.toLowerCase()));
      const owned = bundle.filter((item) => !existing.has(item.toLowerCase()));
      const library = characterLibrary();
      let next = mergeTags(value, bundle);
      if (library.allAges) next = applyAllAgesSafety(next, bundle);
      setPrompt(next);
      if (library.allAges && state.rating !== "safe") {
        applyRating("safe", { announce: false });
        snack("全年龄角色：已切到安全评级，并移除成人标签");
      }
      if (owned.length) bundleAdditions.set(tag, new Set(owned.map((item) => item.toLowerCase())));
      persistBundleAdditions();
    }
    syncCharacterCards();
  }

  function refreshCharacterCopy() {
    const library = characterLibrary();
    const mossLib = library.id === "moss";
    const dialogHead = el.characterDialog?.querySelector('[slot="headline"]');
    if (dialogHead) dialogHead.textContent = mossLib ? "角色描述" : "角色库";
    if (el.characterDesc) {
      el.characterDesc.textContent = mossLib
        ? `${library.total} 条中文角色描述 · 点一次写入外貌与气质，再点撤销`
        : (library.allAges
            ? `${library.total} 个全年龄角色 · 只写角色、系列与正常服装，自动剔除成人标签`
            : `${library.total} 个成年角色 · 点一次写入角色、系列与外观，再点撤销`);
    }
    if (el.characterNote) {
      el.characterNote.textContent = mossLib
        ? "MOSS 读中文远比 Danbooru 罗马音准，所以这里全部换成中文外貌描述：发型、发色、瞳色、服装与气质。写入后可以继续补充你想要的细节。"
        : (library.allAges
            ? "全年龄库只收非性化造型：不写 adult / mature female / 暴露或性化标签；应用时会兜底剔除成人词并把评级切到「安全」。仅用于日常、肖像、旅行与场景创作。"
            : "角色包按「角色 + 系列 + 成年 + 外观」整包写入；冷门角色和原创模板只用外观描述，模型不认识角色名也能出对造型。只收成年角色。");
    }
    updateCharacterResultCount();
  }

  function setCharacterMode(mode) {
    const next = CHARACTER_LIBRARIES[mode] ? mode : "adult";
    if (next === state.characterMode) {
      if (el.characterModeSwitch) el.characterModeSwitch.value = next;
      return;
    }
    state.characterMode = next;
    if (el.characterModeSwitch) el.characterModeSwitch.value = next;
    if (el.characterSearch) el.characterSearch.value = "";
    if (el.characterGroupNav) el.characterGroupNav.hidden = false;
    if (el.characterGroups) {
      el.characterGroups.dataset.ready = "0";
      el.characterGroups.replaceChildren();
    }
    buildCharacterGroups();
    applyCharacterFilter("");
    refreshCharacterCopy();
    writeJSON("klock.characterMode", next);
  }

  function openCharacterDialog() {
    dismissSnacks();
    if (el.characterModeSwitch) el.characterModeSwitch.value = characterLibrary().id;
    refreshCharacterCopy();
    buildCharacterGroups();
    el.characterDialog.fullscreen = window.innerWidth <= 720;
    el.characterDialog.open = true;
    syncCharacterCards();
  }

  function activeTagGroups() {
    // 三套词库互不混用：
    //   MOSS  → 纯中文长句（它读不懂 Danbooru 罗马音）
    //   Krea  → 英文自然语言子句（Qwen3-VL 读描述，不读标签）
    //   Anima → Danbooru 标签
    const arch = activeProfile()?.arch;
    if (arch === "krea") {
      return state.tagTarget === "negative" ? KREA_NEGATIVE_TAG_GROUPS : KREA_TAG_GROUPS;
    }
    if (arch === "moss") {
      return state.tagTarget === "negative" ? MOSS_NEGATIVE_TAG_GROUPS : MOSS_TAG_GROUPS;
    }
    return state.tagTarget === "negative" ? NEGATIVE_TAG_GROUPS : TAG_GROUPS;
  }

  function activePromptValue() {
    return state.tagTarget === "negative" ? el.negative.value : el.prompt.value;
  }

  function applyActivePrompt(next) {
    if (state.tagTarget === "negative") setNegative(next);
    else setPrompt(next);
  }

  function renderTagGroups() {
    const groups = activeTagGroups();
    // MOSS 的 tag 本身是中文长句，再并排显示一遍会撑爆 chip，这里只留短名。
    const mossWords = activeProfile()?.arch === "moss";
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "tag-group";
      section.dataset.group = group.id;
      const head = document.createElement("div");
      head.className = "tag-group-head";
      const title = document.createElement("h4");
      title.textContent = group.name;
      const hint = document.createElement("span");
      hint.textContent = group.hint;
      const count = document.createElement("span");
      count.className = "tag-group-count";
      count.textContent = String(group.tags.length);
      head.append(title, hint, count);
      const cloud = document.createElement("div");
      cloud.className = "tag-cloud";
      for (const [tag, zh] of group.tags) {
        const bundle = tagBundle(tag);
        const chip = document.createElement("mdui-chip");
        chip.setAttribute("variant", "filter");
        chip.setAttribute("selectable", "");
        chip.dataset.tag = tag;
        chip.dataset.side = state.tagTarget;
        chip.dataset.search = `${tag} ${zh} ${group.name} ${group.hint}`.toLowerCase();
        chip.title = `${zh} · ${tag}`;
        const zhLabel = document.createElement("span");
        zhLabel.className = "tag-zh";
        zhLabel.textContent = zh;
        const enLabel = document.createElement("span");
        enLabel.className = "tag-en";
        // 角色包显示角色标签本身，系列与外观放在 title 里，避免 chip 过长。
        // MOSS 下写入值就是中文长句，已经在短名里体现，不再重复显示。
        if (mossWords) {
          enLabel.hidden = true;
        } else {
          enLabel.textContent = bundle.length > 1 ? bundle[0] : tag;
        }
        chip.append(zhLabel, enLabel);
        chip.selected = hasBundle(activePromptValue(), tag);
        // 与配方 chip 同理：selected 与对应提示词不一致才是用户操作。
        chip.addEventListener("change", () => {
          if (state.restoring) return;
          const shouldHave = hasBundle(activePromptValue(), tag);
          if (chip.selected === shouldHave) return;
          let next;
          if (chip.selected) {
            const value = activePromptValue();
            const existing = new Set(splitTags(value).map((item) => item.toLowerCase()));
            next = mergeTags(value, bundle);
            const owned = bundle.filter((item) => !existing.has(item.toLowerCase()));
            if (owned.length) bundleAdditions.set(tag, new Set(owned.map((item) => item.toLowerCase())));
          } else {
            const owned = bundleAdditions.get(tag);
            let target = owned && owned.size
              ? bundle.filter((item) => owned.has(item.toLowerCase()))
              // 重新载入页面后没有新增记录：只撤角色与系列，保留通用外观。
              : bundle.slice(0, 2);
            // 别的角色组合还在用这些词（如 genshin impact / long hair）时保留。
            const inUse = new Set();
            $$("#tagGroups mdui-chip[data-tag]").forEach((other) => {
              if (other === chip) return;
              const otherBundle = tagBundle(other.dataset.tag);
              // 只看其他角色包，不把单个外观标签当成“另一个角色还在用”。
              if (otherBundle.length < 2 || !hasBundle(activePromptValue(), other.dataset.tag)) return;
              otherBundle.forEach((item) => inUse.add(item.toLowerCase()));
            });
            target = target.filter((item) => !inUse.has(item.toLowerCase()));
            next = removeTags(activePromptValue(), target);
            bundleAdditions.delete(tag);
          }
          applyActivePrompt(next);
          syncTagChips();
          updateLibraryCounts();
        });
        cloud.appendChild(chip);
      }
      section.append(head, cloud);
      fragment.appendChild(section);
    }
    el.tagGroups.innerHTML = "";
    el.tagGroups.appendChild(fragment);
    renderTagGroupNav(groups);
  }

  function renderTagGroupNav(groups) {
    el.tagGroupNav.innerHTML = "";
    for (const group of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-nav-pill";
      button.dataset.group = group.id;
      button.append(document.createTextNode(group.name));
      const count = document.createElement("b");
      count.textContent = String(group.tags.length);
      button.appendChild(count);
      button.addEventListener("click", () => scrollToTagGroup(group.id));
      el.tagGroupNav.appendChild(button);
    }
    state.activeTagGroup = groups[0]?.id || "";
    syncTagNav();
  }

  function syncTagNav() {
    $$(".tag-nav-pill", el.tagGroupNav).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.group === state.activeTagGroup);
    });
  }

  function scrollToTagGroup(groupId) {
    const group = el.tagGroups.querySelector(`.tag-group[data-group="${groupId}"]`);
    if (!group) return;
    state.activeTagGroup = groupId;
    syncTagNav();
    const navButton = el.tagGroupNav.querySelector(`.tag-nav-pill[data-group="${groupId}"]`);
    navButton?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const top = group.getBoundingClientRect().top - el.libraryScroll.getBoundingClientRect().top + el.libraryScroll.scrollTop - 4;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.libraryScroll.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }

  function updateLibraryCounts() {
    if (!el.tagSelectedCount) return;
    const total = countTags(activePromptValue());
    el.tagSelectedCount.textContent = `当前 ${total} 个标签`;
    el.tagTargetCount.textContent = `${state.tagTarget === "negative" ? "负面" : "正向"} · ${total} 个标签`;
  }

  function setTagTarget(target, { resetSearch = true } = {}) {
    state.tagTarget = target === "negative" ? "negative" : "positive";
    el.tagTargetSwitch.value = state.tagTarget;
    const negative = state.tagTarget === "negative";
    const arch = activeProfile()?.arch;
    // MOSS / Krea 的左栏不是「整套配方」而是分组预设库，标题与说明要跟着换。
    const groupRail = !negative && (arch === "moss" || arch === "krea");
    const kreaRail = groupRail && arch === "krea";
    const railHead = el.recipeSection?.querySelector(".section-heading h3");
    if (railHead) railHead.textContent = groupRail ? `${kreaRail ? "Krea" : "MOSS"} 预设` : "整套配方";
    const railHint = el.recipeSection?.querySelector(".rail-hint");
    if (railHint) {
      railHint.textContent = kreaRail
        ? "配方（二次元 · 人像 · 场景 · 静物 · 平面 · 电影感）+ 光线/镜头/质感等子句 + 角色"
        : groupRail
          ? "画风 / 镜头 / 光线 / 色调 / 细节 / 成套配方"
          : "保留人物标签，只换场景与质感";
    }
    el.recipeSection.hidden = negative;
    el.resetNegativeTags.hidden = !negative;
    el.tagSectionTitle.textContent = negative ? "负面标签" : "正向标签";
    el.tagSectionHint.textContent = negative ? "点选追加到负面提示词，再点移除" : "点击加入，再点一次移除";
    el.libraryDesc.textContent = negative
      ? (kreaRail
          ? "Krea Turbo 在 CFG 1 下不做负面分支；这些词只在你把 CFG 抬到 1.5 以上时才真正生效。"
          : "点选会写入下方负面提示词；默认的安全与低质词由推荐配置保留。")
      : (kreaRail
          ? "「配方」点一次替换整段提示词，再点一次清空；「光线 / 镜头 / 质感」等子句是追加的，可自由叠加。"
          : groupRail
            ? "MOSS 预设：点词条追加到提示词，可跨分类叠加；再点一次移除。"
            : "先套用整套配方，再按标签微调；点选会直接写入提示词。");
    el.libraryNote.textContent = negative
      ? "这里只放画质、结构、水印与打码等排错词。"
      : (kreaRail
          ? "Krea 2 用 Qwen3-VL 读自然语言：写描述而不是堆标签，名词要具体（red dress → deep oxblood satin dress），光源位置一定写清——这是官方认定的最大单项提升。"
          : groupRail
            ? "MOSS 专用中文词库：点选写入的就是最终提示词里的中文短语，不经过转写、不掺英文标签。"
            : "角色预设已独立到风格条里的「角色」入口；这里保留场景、镜头、服装等通用标签。");
    el.presetSearch.placeholder = negative
      ? (groupRail ? "搜索负面词，例如 模糊、多余肢体…" : "搜索负面标签，例如手、水印…")
      : (kreaRail
          ? "搜索配方或英文子句，例如 window、rain、portrait…"
          : groupRail ? "搜索中文词条或分类…" : "搜索正向标签、配方或分类…");
    if (resetSearch) el.presetSearch.value = "";
    renderTagGroups();
    applyPresetFilter(el.presetSearch.value);
    updateLibraryCounts();
    el.libraryScroll.scrollTop = 0;
  }

  /* -------------------------------------------------- MOSS / Krea 预设库（弹窗左栏） */
  // 两套词库共用这一套渲染：MOSS 是 58 条中文预设，Krea 是 12 组英文配方 + 子句。
  // 点击行为由 group 的 mode 决定：追加（append）或整段替换（replace）。
  function renderMossPresetLibrary() {
    renderGroupPresetLibrary(MOSS_PRESET_GROUPS);
  }

  function renderGroupPresetLibrary(groups) {
    groups.forEach((group) => {
      const block = document.createElement("section");
      block.className = "moss-preset-block";
      block.dataset.search = (
        group.label + " " + (group.hint || "") + " " +
        group.items.map((item) => item.label + " " + item.text).join(" ")
      ).toLowerCase();

      const head = document.createElement("div");
      head.className = "moss-preset-head";
      head.textContent = group.label;
      if (group.hint) head.title = group.hint;
      block.appendChild(head);

      const wrap = document.createElement("div");
      wrap.className = "moss-preset-wrap";
      group.items.forEach((preset) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "moss-preset-item";
        btn.dataset.text = preset.text;
        btn.dataset.mode = preset.mode || "append";
        btn.dataset.search = `${preset.label} ${preset.text}`.toLowerCase();
        btn.textContent = preset.label;
        btn.title = preset.text;
        if (preset.mode === "replace") btn.classList.add("is-recipe");
        btn.addEventListener("click", () => {
          if (preset.mode === "replace") applyRecipeReplace(preset);
          else toggleMossStyle(preset);
          refreshMossPresetButtons();
        });
        wrap.appendChild(btn);
      });
      block.appendChild(wrap);
      el.recipeGrid.appendChild(block);
    });
    refreshMossPresetButtons();
  }

  // 整段配方是「一条 = 一张图」，不能像标签那样往里拼——直接替换整个提示词，
  // 再点一次同一条则清空，方便来回比对两个配方。
  function applyRecipeReplace(preset) {
    const same = el.prompt.value.trim() === preset.text;
    setPrompt(same ? "" : preset.text, { save: false });
    scheduleSave();
    if (!same) snack(`已套用配方「${preset.label}」`);
  }

  function refreshMossPresetButtons() {
    if (!el.recipeGrid) return;
    el.recipeGrid.querySelectorAll(".moss-preset-item").forEach((btn) => {
      const text = btn.dataset.text || "";
      const active = btn.dataset.mode === "replace"
        ? el.prompt.value.trim() === text
        : el.prompt.value.includes(text);
      btn.classList.toggle("is-active", active);
    });
  }

  function renderRecipes() {
    if (!el.recipeGrid) return;
    el.recipeGrid.replaceChildren();
    // MOSS 与 Krea 都吃自然语言，整套配方卡片（中文 tag 串）对它们没意义，
    // 统一换成「分组预设库」：MOSS 58 条中文预设，Krea 12 组英文配方/子句。
    const arch = activeProfile()?.arch;
    const groupMode = arch === "moss" ? "moss" : (arch === "krea" ? "krea" : "");
    el.recipeGrid.classList.toggle("is-moss-presets", Boolean(groupMode));
    if (groupMode === "moss") {
      renderMossPresetLibrary();
      return;
    }
    if (groupMode === "krea") {
      renderGroupPresetLibrary(KREA_LIBRARY_GROUPS);
      return;
    }
    RECIPES.forEach((recipe, index) => {
      const card = document.createElement("article");
      card.className = "recipe-card";
      card.dataset.recipe = recipe.id;
      card.dataset.search = (recipe.name + " " + recipe.desc + " " + recipe.tags).toLowerCase();
      card.style.setProperty("--c1", recipe.c1);
      card.style.setProperty("--c2", recipe.c2);

      const mark = document.createElement("div");
      mark.className = "recipe-mark";
      const no = document.createElement("span");
      no.className = "recipe-no";
      no.textContent = String(index + 1).padStart(2, "0");
      mark.appendChild(no);

      const body = document.createElement("div");
      body.className = "recipe-body";
      const title = document.createElement("div");
      title.className = "recipe-title";
      const strong = document.createElement("strong");
      strong.textContent = recipe.name;
      const desc = document.createElement("p");
      desc.className = "recipe-desc";
      desc.textContent = recipe.desc;
      const tags = document.createElement("p");
      tags.className = "recipe-tags";
      tags.textContent = recipe.tags;
      const actions = document.createElement("div");
      actions.className = "recipe-actions";

      const addBtn = document.createElement("mdui-button");
      addBtn.setAttribute("variant", "tonal");
      addBtn.innerHTML = `<span slot="icon" class="icon" data-icon="sparkles"></span>并入`;
      addBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        mergeRecipe(recipe, "add");
        syncTagChips();
      });
      const switchBtn = document.createElement("mdui-button");
      switchBtn.setAttribute("variant", "text");
      switchBtn.textContent = "替换";
      switchBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        mergeRecipe(recipe, "switch");
        syncTagChips();
      });
      actions.append(addBtn, switchBtn);
      title.append(strong, actions);
      body.append(title, desc, tags);
      card.append(mark, body);
      el.recipeGrid.appendChild(card);
    });
    hydrateIcons(el.recipeGrid);
  }

  function updatePlaceholderCopy() {
    if (el.placeholderHint) {
      el.placeholderHint.textContent = isKreaActive()
        ? "用一句完整的英文描述画面——写清光从哪来、名词具体一点，点「生成画面」或按 Ctrl + Enter。"
        : "写好描述，点「生成画面」或按 Ctrl + Enter。";
    }
    if (el.placeholderHintMobile) {
      el.placeholderHintMobile.textContent = isKreaActive()
        ? "完整英文描述 + 光源位置，点下方「生成」。"
        : "写好描述，点下方「生成」。";
    }
  }

  function renderPlaceholderIdeas() {
    if (!el.placeholderIdeas) return;
    el.placeholderIdeas.innerHTML = "";
    if (isKreaActive()) {
      // Krea 读自然语言：空白页直接给几条完整英文配方，点一下就能出图，
      // 比给中文 tag 串更能说明「这个模型该怎么写」。
      const dots = ["#7C8FA6", "#A6875C", "#6E8B74", "#8A6E93"];
      KREA_PRESET_GROUPS.slice(0, 4).forEach((group, index) => {
        const preset = group.items[0];
        if (!preset) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "placeholder-idea";
        button.dataset.recipe = `krea-${group.id}`;
        button.title = preset.text;
        const dot = document.createElement("span");
        dot.className = "idea-dot";
        dot.style.setProperty("--dot", dots[index % dots.length]);
        const label = document.createElement("span");
        label.textContent = `${group.label} · ${preset.label}`;
        button.append(dot, label);
        button.addEventListener("click", () => {
          setPrompt(preset.text, { save: false });
          scheduleSave();
          el.prompt.focus({ preventScroll: true });
          snack(`已套用配方「${preset.label}」`);
        });
        el.placeholderIdeas.appendChild(button);
      });
      return;
    }
    RECIPES.slice(0, 4).forEach((recipe) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "placeholder-idea";
      button.dataset.recipe = recipe.id;
      button.title = recipe.tags;
      const dot = document.createElement("span");
      dot.className = "idea-dot";
      dot.style.setProperty("--dot", recipe.c1);
      const label = document.createElement("span");
      label.textContent = recipe.name;
      button.append(dot, label);
      button.addEventListener("click", () => {
        mergeRecipe(recipe, "switch");
        el.prompt.focus({ preventScroll: true });
      });
      el.placeholderIdeas.appendChild(button);
    });
  }

  function syncTagChips() {
    if (!el.inspirationDialog.open) return;
    const value = activePromptValue();
    $$("#tagGroups mdui-chip[data-tag]").forEach((chip) => {
      const selected = hasBundle(value, chip.dataset.tag);
      if (chip.selected !== selected) chip.selected = selected;
    });
  }

  function setRecipeRailCollapsed(collapsed) {
    if (!el.recipeSection) return;
    const compact = window.innerWidth <= 1080;
    const shouldCollapse = compact && collapsed;
    el.recipeSection.classList.toggle("is-collapsed", shouldCollapse);
    if (el.railToggle) {
      el.railToggle.textContent = shouldCollapse ? "展开" : "收起";
      el.railToggle.setAttribute("aria-expanded", String(!shouldCollapse));
    }
  }

  function openLibrary(target) {
    dismissSnacks();
    syncStyleChips();
    el.inspirationDialog.fullscreen = window.innerWidth <= 720;
    setRecipeRailCollapsed(window.innerWidth <= 1080);
    setTagTarget(target);
    el.inspirationDialog.open = true;
  }

  function openInspiration() {
    openLibrary("positive");
  }

  function openNegativeInspiration() {
    openLibrary("negative");
  }

  function syncStyleChips() {
    refreshStyleChips();
  }

  function applyPresetFilter(query) {
    const q = String(query || "").trim().toLowerCase();
    const searching = Boolean(q);
    let visibleChips = 0;
    let visibleRecipes = 0;

    const mossLibrary = activeProfile()?.arch === "moss";
    if (state.tagTarget === "positive") {
      if (mossLibrary) {
        // MOSS 左栏是分组预设：先过滤块内词条，整块没剩就隐藏。
        $$("#recipeGrid .moss-preset-block").forEach((block) => {
          let shown = 0;
          block.querySelectorAll(".moss-preset-item").forEach((btn) => {
            const show = !q || (btn.dataset.search || "").includes(q);
            btn.hidden = !show;
            if (show) shown += 1;
          });
          block.hidden = shown === 0;
          visibleRecipes += shown;
        });
      } else {
        $$("#recipeGrid .recipe-card").forEach((card) => {
          const show = !q || (card.dataset.search || "").includes(q);
          card.hidden = !show;
          if (show) visibleRecipes += 1;
        });
      }
    }
    const negative = state.tagTarget === "negative";
    el.recipeSection.hidden = negative;
    el.recipeEmpty.hidden = negative || !searching || visibleRecipes > 0;
    if (el.recipeRailCount) {
      el.recipeRailCount.textContent = mossLibrary ? `${visibleRecipes} 条` : `${visibleRecipes} 套`;
    }

    $$("#tagGroups .tag-group").forEach((group) => {
      let visible = 0;
      $$("mdui-chip[data-tag]", group).forEach((chip) => {
        const show = !q || (chip.dataset.search || "").includes(q);
        chip.hidden = !show;
        if (show) visible += 1;
      });
      group.hidden = visible === 0;
      visibleChips += visible;
    });

    el.tagGroupNav.hidden = searching;
    el.presetEmpty.hidden = visibleChips > 0;
    el.presetResultCount.textContent = searching
      ? `${visibleChips} 标签${state.tagTarget === "positive" && visibleRecipes ? ` · ${visibleRecipes} 配方` : ""}`
      : `${visibleChips} 个标签`;
  }

  function restoreRecommendedNegative() {
    const before = el.negative.value;
    if (before.trim() === DEFAULT_NEGATIVE.trim()) {
      snack("已经在使用推荐负面词");
      return;
    }
    mdui.confirm({
      headline: "恢复推荐负面？",
      description: "会覆盖当前负面提示词，把低质、水印恢复到默认推荐。",
      confirmText: "恢复",
      cancelText: "取消",
      onConfirm: () => {
        setNegative(DEFAULT_NEGATIVE);
        syncTagChips();
        updateLibraryCounts();
        snack("已恢复推荐负面词", {
          action: "撤销",
          onActionClick: () => {
            setNegative(before);
            syncTagChips();
            updateLibraryCounts();
          }
        });
      }
    }).catch(() => {});
  }

  /* ------------------------------------------------ JSON 预设（导入 / 导出）
    为什么要有这一套：localStorage 里的预设只能在本机用，换个浏览器、发给别人、
    或者想给「某张画」单独配一份参数就都不行。把整组设置写成 .json，
    拖进来就能一键还原成当时的全部参数（模型 / 画质 / 采样 / 尺寸 / LoRA）。

    字段优先级：模型 → 画质档 → 显式字段（steps/cfg/sampler/shift…）→ LoRA。
    画质档会一次性写死步数/CFG/二采，所以作者再单写 steps 时以显式值为准。 */

  // 注意：外面已有一个 PRESET_VERSION（2，用于本地预设结构的迁移），
  // 这里是 JSON 文件的格式版本，两者不该混，所以另起名。
  const PRESET_FILE_VERSION = 1;

  function presetSizeOverrides(size, cfg) {
    if (!size || typeof size !== "object") return cfg;
    const w = Number(size.width);
    const h = Number(size.height);
    if (w >= 256 && h >= 256) {
      cfg.width = w;
      cfg.height = h;
      cfg.ratioKey = "custom";
      return cfg;
    }
    const ratio = String(size.ratio || "");
    if (ratio) {
      const table = ratioTableFor(activeProfile()?.arch || "sdxl");
      const opt = table.find((item) => item.key === ratio);
      if (opt) {
        cfg.ratioKey = ratio;
        cfg.width = opt.w;
        cfg.height = opt.h;
      }
    }
    return cfg;
  }

  // 模型名在 JSON 里带扩展名（anima-aesthetic-v1.1.safetensors），
  // 而模型列表里的 value 不带——之前用 === 比较，导致「和当前模型相同」也被判成找不到。
  function presetModelEntry(name) {
    const key = normalizeModelName(name).toLowerCase();
    if (!key) return null;
    return state.models.find((item) => normalizeModelName(item.value).toLowerCase() === key) || null;
  }

  function presetLoras(raw) {
    if (!Array.isArray(raw)) return { loras: [], missing: [] };
    const loras = [];
    const missing = [];
    raw.forEach((item) => {
      if (!item) return;
      const name = normalizeModelName(typeof item === "string" ? item : item.name);
      if (!name) return;
      if (!availableLora(name)) {
        missing.push(name);
        return;
      }
      const weight = typeof item === "string" ? NaN : Number(item.weight);
      loras.push({ name, weight: clamp(Number.isFinite(weight) ? weight : loraDefaultWeight(name), 0.05, 1.5) });
    });
    return { loras, missing };
  }

  // 把 JSON 里出现的、且属于设置项的字段原样搬进 config。
  // 这样导出/导入是同一套键，往返不会丢字段（之前手写白名单漏了 clipSkip / vae / seedLocked）。
  const PRESET_IGNORE = new Set(["klockui", "name", "note", "model", "loras", "size", "quality"]);

  function presetConfigOverrides(data) {
    const cfg = {};
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (PRESET_IGNORE.has(key)) return;
      if (!Object.prototype.hasOwnProperty.call(data, key)) return;
      const value = data[key];
      if (value === undefined || value === null) return;
      cfg[key] = value;
    });
    return cfg;
  }

  async function applyPresetJson(raw, { silent = false } = {}) {
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch (err) {
        snack(`JSON 解析失败：${err.message}`, { bad: true });
        return { ok: false };
      }
    }
    if (Array.isArray(data)) {
      if (!data.length) {
        snack("JSON 是空数组", { bad: true });
        return { ok: false };
      }
      if (data.length > 1) snack(`一次只载入第一组，共 ${data.length} 组`);
      data = data[0];
    }
    if (!data || typeof data !== "object") {
      snack("预设内容不是一个对象", { bad: true });
      return { ok: false };
    }
    if (Number(data.klockui) > PRESET_FILE_VERSION) {
      snack("该预设来自更新的版本，部分字段可能被忽略");
    }

    const name = String(data.name || "").trim() || "未命名预设";
    const notes = [];

    // ① 模型
    let modelSkipped = "";
    const wantModel = String(data.model || "").trim();
    if (wantModel) {
      const entry = presetModelEntry(wantModel);
      const same = activeModelMatches(wantModel);
      if (same) {
        // 已经是当前模型，什么都不做——之前这里会误报"模型未切换"
      } else if (!entry) {
        modelSkipped = wantModel;
      } else {
        const switched = await switchModel(entry.value, { preserveSettings: true, silent: true });
        if (!switched) modelSkipped = wantModel;
      }
    }

    // ② 画质档先套（它会写入步数 / CFG / 二采 / 采样器）
    const qualityKey = String(data.quality || "").trim();
    if (qualityKey && qualityTier(qualityKey)) {
      el.qualityGroup.value = qualityKey;
      applyQuality(qualityKey);
    }

    // ③ 其余字段按同名字段覆盖
    const cfg = { ...currentConfig(), ...presetConfigOverrides(data) };
    if (data.size && typeof data.size === "object") presetSizeOverrides(data.size, cfg);

    // ④ LoRA
    if (Object.prototype.hasOwnProperty.call(data, "loras")) {
      const { loras, missing } = presetLoras(data.loras);
      cfg.loras = loras;
      if (missing.length) notes.push(`缺 ${missing.length} 支 LoRA：${missing.slice(0, 3).join("、")}`);
    }

    applyConfig(cfg, { save: true });
    scheduleSave();
    if (!silent) {
      if (modelSkipped) notes.unshift(`模型未切换（缺失或引擎忙）：${modelSkipped}`);
      snack(notes.length ? `已载入「${name}」· ${notes.join("；")}` : `已载入「${name}」`);
    }
    return { ok: true, name, notes, modelSkipped };
  }

  // 导出的是完整的 currentConfig()，导入端按同名键回填，保证往返一致。
  function downloadPresetJson(data, label) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(label || "preset").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    a.href = url;
    a.download = `klockui-${safe}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    snack(`已导出「${label || "预设"}」`);
  }

  function exportPresetJson() {
    const cfg = currentConfig();
    const name = `预设 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    downloadPresetJson({
      klockui: PRESET_FILE_VERSION,
      name,
      note: "由 KlockUI 导出，可直接拖回界面还原",
      ...cfg,
      // 这两个字段在界面上是隐式的，导出时写实，方便手改
      model: state.activeModel,
      seed: cfg.seedLocked ? cfg.seed : -1,
      // 比例键与具体像素都写进去：手改时知道这是哪一档，导入时也能还原选中态
      size: { ratio: cfg.ratioKey || "custom", width: cfg.width, height: cfg.height }
    }, "当前参数");
  }


  function presetFileFromEvent(event) {
    const list = event.dataTransfer?.files;
    if (!list || !list.length) return null;
    for (const file of list) {
      if (/\.json$/i.test(file.name) || file.type === "application/json") return file;
    }
    return null;
  }

  function bindPresetDrop() {
    const zones = [el.promptCard, el.paramCard].filter(Boolean);
    if (!zones.length) return;
    let depth = 0;
    const clear = () => zones.forEach((zone) => zone.classList.remove("is-drop-target"));
    zones.forEach((zone) => {
      zone.addEventListener("dragenter", (event) => {
        if (!event.dataTransfer) return;
        const hasFile = Array.from(event.dataTransfer.types || []).includes("Files");
        if (!hasFile) return;
        event.preventDefault();
        depth += 1;
        zone.classList.add("is-drop-target");
      });
      zone.addEventListener("dragover", (event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      });
      zone.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) clear();
      });
      zone.addEventListener("drop", async (event) => {
        depth = 0;
        clear();
        const file = presetFileFromEvent(event);
        if (!file) {
          event.preventDefault();
          snack("只支持 .json 预设文件", { bad: true });
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        try {
          await applyPresetJson(await file.text());
        } catch (err) {
          snack(`读取失败：${err.message}`, { bad: true });
        }
      });
    });
    // 拖到输入框上时，浏览器默认会把它当文本插入，这里统一拦掉
    zones.forEach((zone) => {
      zone.querySelectorAll("textarea, input").forEach((node) => {
        node.addEventListener("dragover", (event) => event.preventDefault());
        node.addEventListener("drop", (event) => event.preventDefault());
      });
    });
  }

  function getSavedPresets() {
    const list = readJSON(STORE_PRESETS, []);
    return Array.isArray(list) ? list.filter((item) => item && item.id && item.name && item.config) : [];
  }

  function savePresets(list) {
    return writeJSON(STORE_PRESETS, list);
  }

  function currentConfig() {
    return {
      prompt: el.prompt.value,
      negative: el.negative.value,
      width: state.width,
      height: state.height,
      ratioKey: state.ratioKey,
      quality: el.qualityGroup.value || "",
      steps: Number(el.steps.value),
      cfg: Number(el.cfg.value),
      sampler: el.sampler.value,
      scheduler: el.scheduler.value,
      shift: el.shift ? Number(el.shift.value) : 3.5,
      clipSkip: normalizeClipSkip(el.clipSkip.value),
      vae: String(el.vae.value || VAE_AUTO),
      seed: Number(el.seed.value),
      seedLocked: Boolean(el.seedLock.checked),
      batch: Number(el.batch.value),
      hires: Boolean(el.hires.checked),
      hrScale: Number(el.hrScale.value),
      hrUpscaler: String(el.hrUpscaler.value || DEFAULT_UPSCALER),
      hrDenoise: Number(el.hrDenoise.value),
      easyCache: Boolean(el.easyCache?.checked),
      lowVram: Boolean(el.lowVram?.checked),
      translate: Boolean(state.translateEnabled),
      controlModel: String(el.controlModel?.value || ""),
      controlStrength: Number(el.controlStrength?.value || 1),
      img2imgDenoise: Number(el.initDenoise.value),
      detailEnhance: Boolean(el.detailEnhance?.checked),
      detailScale: Number(el.detailScale?.value) || 1.25,
      mode: state.mode,
      model: state.activeModel,
      rating: state.rating,
      loras: activeLorasPayload()
    };
  }

  function defaultConfig() {
    return { ...DEFAULT_SETTINGS };
  }

  function applyConfig(config = {}, { save = true } = {}) {
    const cfg = { ...DEFAULT_SETTINGS, ...config };
    state.restoring = true;
    state.translateEnabled = cfg.translate !== false;
    setTranslateToggle(state.translateEnabled);
    setPrompt(typeof cfg.prompt === "string" ? cfg.prompt : DEFAULT_PROMPT, { save: false });
    setNegative(typeof cfg.negative === "string" ? cfg.negative : DEFAULT_NEGATIVE, { save: false });
    state.activeLoras = Array.isArray(cfg.loras)
      ? cfg.loras.filter((item) => item && item.name && !RETIRED_LORAS.has(loraKey(item.name))).map((item) => ({
          name: normalizeModelName(item.name) || String(item.name),
          weight: clamp(Number(item.weight) || loraDefaultWeight(item.name), 0.05, 1.5)
        }))
      : [];

    const width = clamp(round8(Number(cfg.width) || 1024), 512, 1536);
    const height = clamp(round8(Number(cfg.height) || 1024), 512, 1536);
    state.width = width;
    state.height = height;
    state.ratioKey = typeof cfg.ratioKey === "string" ? cfg.ratioKey : "custom";
    el.customW.value = String(width);
    el.customH.value = String(height);
    updateRatioSelection();
    el.sizeHint.textContent = `${width} × ${height}`;

    el.steps.value = clamp(Number(cfg.steps) || 24, 6, 60);
    el.stepsOut.textContent = el.steps.value;
    el.cfg.value = clamp(Number(cfg.cfg) || 5.5, 1, 10);
    el.cfgOut.textContent = Number(el.cfg.value).toFixed(1);
    el.sampler.value = cfg.sampler || "Euler a";
    el.scheduler.value = cfg.scheduler || "Karras";
    if (el.shift) {
      el.shift.value = clampShift(cfg.shift);
      el.shiftOut.textContent = Number(el.shift.value).toFixed(1);
    }
    el.clipSkip.value = String(normalizeClipSkip(cfg.clipSkip));
    el.vae.value = String(cfg.vae || VAE_AUTO);
    el.batch.value = String(BATCH_GACHA.includes(Number(cfg.batch)) ? Number(cfg.batch) : 1);

    el.hires.checked = Boolean(cfg.hires);
    el.hrScale.value = String(normalizeHrScale(cfg.hrScale));
    el.hrUpscaler.value = String(cfg.hrUpscaler || DEFAULT_UPSCALER);
    el.hrDenoise.value = clamp(Number(cfg.hrDenoise) || 0.4, 0.2, 0.6);
    el.hrOut.textContent = Number(el.hrDenoise.value).toFixed(2);
    if (el.easyCache) el.easyCache.checked = Boolean(cfg.easyCache);
    if (el.lowVram) el.lowVram.checked = Boolean(cfg.lowVram);
    // 控制图本体不落盘（base64 太大），只记类型和强度。
    if (el.controlModel) el.controlModel.value = typeof cfg.controlModel === "string" ? cfg.controlModel : "";
    if (el.controlStrength) {
      el.controlStrength.value = clamp(Number(cfg.controlStrength) || 1, 0, 2);
      if (el.controlStrengthOut) el.controlStrengthOut.textContent = Number(el.controlStrength.value).toFixed(2);
    }
    updateControlnetHint();
    ensureEngineSelection();
    updateHiresUI();
    updatePerfHint();
    updateEngineHint();

    el.seedLock.checked = Boolean(cfg.seedLocked);
    el.seed.value = String(cfg.seedLocked ? (Number(cfg.seed) || -1) : -1);
    updateSeedUI({ preserve: true });

    el.initDenoise.value = clamp(Number(cfg.img2imgDenoise) || 0.55, 0.1, 0.9);
    el.denoiseOut.textContent = Number(el.initDenoise.value).toFixed(2);
    if (el.detailEnhance) el.detailEnhance.checked = Boolean(cfg.detailEnhance);
    if (el.detailScale) {
      const scale = Number(cfg.detailScale);
      el.detailScale.value = String(scale === 1 || scale === 1.5 ? scale : 1.25);
    }
    updateDetailUI();

    const nextQuality = QUALITY_KEYS.includes(cfg.quality) ? cfg.quality : "";
    if (el.qualityGroup.value !== nextQuality) el.qualityGroup.value = nextQuality;
    syncQualityKeyToControls();
    updateQualityHint();
    syncBatchOptions({ save: false });
    updateAdvancedSummary();
    ensureSamplerPresets();

    const restoredMode = cfg.mode === "img2img" ? "img2img" : "txt2img";
    setMode(restoredMode, { save: false, silent: true });
    applyRating(cfg.rating, { persist: false });
    state.restoring = false;
    renderLoraBlock();
    renderLoraDialog();
    if (save) scheduleSave();
  }

  function updateSavedList() {
    const list = getSavedPresets();
    el.savedList.innerHTML = "";
    el.savedEmpty.hidden = list.length > 0;
    for (const preset of list) {
      const item = document.createElement("div");
      item.className = "saved-item";
      const main = document.createElement("div");
      main.className = "saved-main";
      const name = document.createElement("div");
      name.className = "saved-name";
      name.textContent = preset.name;
      const meta = document.createElement("div");
      meta.className = "saved-meta";
      const cfg = preset.config || {};
      const modeLabel = cfg.mode === "img2img" ? "图生图" : "文生图";
      const modelLabel = cfg.model ? `${modelShortName(cfg.model)} · ` : "";
      meta.textContent = `${modelLabel}${modeLabel} · ${cfg.steps || 24} 步 · CFG ${cfg.cfg || 5.5} · ${cfg.width || 1024}×${cfg.height || 1024}`;
      const prompt = document.createElement("div");
      prompt.className = "saved-prompt";
      prompt.textContent = (cfg.prompt || "").replace(/\s+/g, " ").slice(0, 180);
      main.append(name, meta, prompt);
      const actions = document.createElement("div");
      actions.className = "saved-actions";
      const load = document.createElement("mdui-button");
      load.setAttribute("variant", "tonal");
      load.textContent = "载入";
      load.addEventListener("click", async () => {
        const targetModel = typeof cfg.model === "string" ? cfg.model : "";
        let switched = true;
        if (targetModel && !activeModelMatches(targetModel)) {
          if (!state.modelsLoaded && state.online) await loadModels({ silent: true });
          switched = state.online
            ? await switchModel(targetModel, { preserveSettings: true, silent: true })
            : false;
        }
        applyConfig(preset.config);
        el.savedDialog.open = false;
        if (!switched) snack(`已载入「${preset.name}」，模型未能切换`, { bad: true });
        else snack(`已载入「${preset.name}」${targetModel ? " · " + modelShortName(targetModel) : ""}`);
      });
      const remove = document.createElement("mdui-button-icon");
      remove.setAttribute("aria-label", "删除预设");
      remove.title = "删除预设";
      remove.innerHTML = `<span class="icon" data-icon="trash"></span>`;
      remove.addEventListener("click", () => {
        mdui.confirm({
          headline: "删除这个预设？",
          description: preset.name,
          confirmText: "删除",
          cancelText: "取消",
          onConfirm: () => {
            const next = getSavedPresets().filter((entry) => entry.id !== preset.id);
            savePresets(next);
            updateSavedList();
            snack("预设已删除");
          }
        }).catch(() => {});
      });
      hydrateIcons(remove);
      const exportBtn = document.createElement("mdui-button-icon");
      exportBtn.setAttribute("aria-label", "导出为 JSON");
      exportBtn.title = "导出为 JSON（可分享 / 可拖回界面）";
      exportBtn.innerHTML = `<span class="icon" data-icon="download"></span>`;
      exportBtn.addEventListener("click", () => {
        const data = {
          klockui: PRESET_FILE_VERSION,
          name: preset.name,
          note: "由 KlockUI 已存预设导出",
          ...preset.config,
          model: preset.config?.model || ""
        };
        downloadPresetJson(data, preset.name);
      });
      hydrateIcons(exportBtn);
      actions.append(load, exportBtn, remove);
      item.append(main, actions);
      el.savedList.appendChild(item);
    }
  }

  function openSavedPresets() {
    dismissSnacks();
    updateSavedList();
    el.savedDialog.fullscreen = window.innerWidth <= 720;
    el.savedDialog.open = true;
  }

  function openSavePresetDialog() {
    dismissSnacks();
    updateSavedList();
    el.presetName.value = `我的预设 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    el.presetName.error = "";
    el.presetName.invalid = false;
    el.savePresetDialog.fullscreen = window.innerWidth <= 720;
    el.savePresetDialog.open = true;
  }

  function confirmSavePreset() {
    const name = String(el.presetName.value || "").trim();
    if (!name) {
      el.presetName.error = "给预设起个名字";
      el.presetName.invalid = true;
      return;
    }
    const list = getSavedPresets();
    if (list.length >= 50) {
      snack("预设最多保存 50 个，请先删除一些", { bad: true });
      return;
    }
    const preset = {
      id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      createdAt: Date.now(),
      config: currentConfig()
    };
    list.unshift(preset);
    if (!savePresets(list)) {
      snack("保存失败：浏览器存储不可用", { bad: true });
      return;
    }
    el.savePresetDialog.open = false;
    updateSavedList();
    snack(`已保存「${name}」`, { action: "查看", onActionClick: openSavedPresets });
  }

  /* ------------------------------------------------------------ 细化预设 */
  function tidyPromptText(text) {
    return String(text || "")
      .replace(/,\s*,/g, ", ")
      .replace(/\s+([,，])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^[,\s]+|[,\s]+$/g, "")
      .trim();
  }

  // 细化预设与 LoRA 触发词是英文原文，交给 4B 会被吸进散文或改写。
  // 转写前先把它们摘出来，转写后按原文追加到 Tags 行末尾。
  function collectPromptExtras(text) {
    const source = String(text || "");
    const lower = source.toLowerCase();
    const extras = [];
    const seen = new Set();
    const push = (id, value) => {
      const clean = String(value || "").trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key) || !lower.includes(key)) return;
      seen.add(key);
      extras.push({ id, text: clean });
    };
    // 两套预设都要扫：旧提示词里可能还留着 Anima 版的词，切换模型后要能识别出来。
    for (const preset of [...REFINE_PRESETS, ...REFINE_PRESETS_KREA]) push(`refine:${preset.id}`, preset.prompt);
    for (const [name, info] of Object.entries(LORA_LIBRARY)) {
      if (!info?.triggers) continue;
      String(info.triggers).split(",").forEach((trigger) => {
        push(`lora:${name}:${String(trigger).trim().toLowerCase()}`, trigger);
      });
    }
    return extras;
  }

  function stripPromptExtras(text, extras = collectPromptExtras(text)) {
    let out = String(text || "");
    for (const extra of extras) {
      const index = out.toLowerCase().indexOf(extra.text.toLowerCase());
      if (index >= 0) out = out.slice(0, index) + out.slice(index + extra.text.length);
    }
    return tidyPromptText(out);
  }

  function stripRefinePrompts(text) {
    const extras = [...REFINE_PRESETS, ...REFINE_PRESETS_KREA]
      .filter((preset) => String(text || "").toLowerCase().includes(preset.prompt.toLowerCase()))
      .map((preset) => ({ id: `refine:${preset.id}`, text: preset.prompt }));
    return stripPromptExtras(text, extras);
  }

  function appendPromptExtras(prompt, extras = []) {
    const text = String(prompt || "").trim();
    const terms = [];
    for (const extra of extras) {
      for (const term of String(extra.text || "").split(",")) {
        const clean = term.trim();
        if (clean) terms.push(clean);
      }
    }
    if (!terms.length) return text;
    const pickNew = (existing) => {
      const seen = new Set(existing.map((tag) => tag.toLowerCase()));
      const adds = [];
      for (const term of terms) {
        const key = term.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        adds.push(term);
      }
      return adds;
    };
    const marker = text.search(/\nTags:/i);
    if (marker >= 0) {
      const head = text.slice(0, marker);
      const tail = text.slice(marker).replace(/^(\nTags:\s*)/i, "");
      const lines = tail.split("\n");
      const tagLine = lines.shift() || "";
      const rest = lines.length ? "\n" + lines.join("\n") : "";
      const adds = pickNew(splitTags(tagLine));
      const merged = [tagLine.trim().replace(/,$/, ""), ...adds].filter(Boolean).join(", ");
      return `${head}\nTags: ${merged}${rest}`;
    }
    const adds = pickNew(splitTags(text));
    return [text, ...adds].filter(Boolean).join(", ");
  }

  function setRefineBase(denoise = 0.35) {
    const krea = isKreaActive();
    const anima = isAnimaActive();
    // Krea 的步数必须留 8：10 步以上是偏离蒸馏网格，重绘同样适用。
    const steps = krea ? 8 : (anima ? 28 : 24);
    const cfg = krea ? 1 : (anima ? 4 : 5.5);
    // 细化只针对当前这一张：从抽卡或批量继承来的 4/8/12 张，
    // 会让人点一次就悄悄跑出一批 28 步重绘，这里统一收回 1 张。
    setBatchValue(1, { announce: false, save: false });
    el.hires.checked = false;
    el.steps.value = steps;
    el.stepsOut.textContent = String(steps);
    el.cfg.value = cfg;
    el.cfgOut.textContent = Number(cfg).toFixed(1);
    if (anima) {
      el.sampler.value = "Euler a";
      el.scheduler.value = "Beta";
    }
    if (krea) {
      // 重绘同样只认官方 euler + simple，别沿用上一个模型的采样器。
      el.sampler.value = "Euler";
      el.scheduler.value = "Simple";
    }
    el.initDenoise.value = String(denoise);
    el.denoiseOut.textContent = Number(denoise).toFixed(2);
    markCustomQuality();
    updateHiresUI();
    updateSamplerPresetUI();
    updateAdvancedSummary();
  }

  function applyRefinePreset(id) {
    const preset = refinePresetsFor(activeProfile()?.arch).find((item) => item.id === id);
    if (!preset) return;
    const hadTurbo = turboLoraActive();
    const hadBatch = Number(el.batch.value) || 1;
    if (hadTurbo) setLoraEnabled("anima_turbo_v0.2", false);
    if (state.mode !== "img2img") setMode("img2img", { save: false, silent: true });
    const base = stripRefinePrompts(el.prompt.value);
    const next = base ? appendPromptExtras(base, [{ text: preset.prompt }]) : preset.prompt;
    setRefineBase(preset.denoise);
    state.refinePresetId = preset.id;
    setPrompt(next);
    if (state.promptDraft) syncPromptDraftExtras();
    scheduleSave();
    el.refineDialog.open = false;
    const suffix = state.initImage
      ? (hadBatch > 1 ? ` · 本批回到 1 张` : "")
      : " · 先补参考图";
    snack(`已套用「${preset.name}」· ${el.steps.value} 步实采 / CFG ${el.cfg.value} / 重绘 ${Number(preset.denoise).toFixed(2)}${hadTurbo ? " · Turbo 已关" : ""}${suffix}`,
      state.initImage ? {} : { bad: true });
  }

  function renderRefineList() {
    if (!el.refineList) return;
    el.refineList.replaceChildren();
    refinePresetsFor(activeProfile()?.arch).forEach((preset) => {
      const item = document.createElement("div");
      item.className = "refine-item";
      item.dataset.refine = preset.id;
      const main = document.createElement("div");
      main.className = "refine-item-main";
      const head = document.createElement("div");
      head.className = "refine-item-head";
      const name = document.createElement("span");
      name.className = "refine-item-name";
      name.textContent = preset.name;
      const badge = document.createElement("span");
      badge.className = "refine-item-badge";
      badge.textContent = `重绘 ${Number(preset.denoise).toFixed(2)}`;
      head.append(name, badge);
      const desc = document.createElement("div");
      desc.className = "refine-item-desc";
      desc.textContent = preset.desc;
      const prompt = document.createElement("div");
      prompt.className = "refine-item-prompt";
      prompt.textContent = preset.prompt;
      main.append(head, desc, prompt);
      const apply = document.createElement("mdui-button");
      apply.setAttribute("variant", "tonal");
      apply.className = "refine-apply";
      apply.textContent = "套用";
      apply.addEventListener("click", () => applyRefinePreset(preset.id));
      item.append(main, apply);
      el.refineList.appendChild(item);
    });
  }

  function openRefineDialog() {
    if (!el.refineDialog) return;
    dismissSnacks();
    renderRefineList();
    el.refineDialog.fullscreen = window.innerWidth <= 720;
    el.refineDialog.open = true;
  }

  /* ---------------------------------------------------------------- quality */
  // 抽卡档支持 Anima / MOSS / Krea：三者都是低步数蒸馏路线
  // （Anima → anima_turbo LoRA；MOSS → 8 步 DMD LoRA 或预合并 Turbo 底模；
  //  Krea → 底模本身就是 8 步 Turbo，单张约 28s，抽卡性价比最高）。
  function gachaSupported() {
    const profile = activeProfile();
    return Boolean(profile && (profile.arch === "anima" || profile.arch === "moss"
      || profile.arch === "krea"));
  }

  function updateGachaAvailability() {
    if (!el.gachaQualityBtn) return;
    // 模型名还没读回来时先保留抽卡档，避免刷新后被误判成 SDXL 而清掉；
    // 状态一到，不支持抽卡的模型会立刻隐藏并退回自定义。
    const known = Boolean(state.activeArch || state.activePreset || state.activeModel);
    const show = gachaSupported() || !known;
    el.gachaQualityBtn.hidden = !show;
    if (!show && el.qualityGroup.value === "gacha") {
      el.qualityGroup.value = "";
      state.qualityKey = "";
      scheduleSave();
    }
  }

  function updateGachaHint() {
    if (!el.gachaHint) return;
    const show = gachaSupported() && el.qualityGroup.value === "gacha";
    el.gachaHint.hidden = !show;
    if (!show) return;
    const turboName = turboLoraName();
    const gacha = (activeProfile().qualities && activeProfile().qualities.gacha) || {};
    const params = `${gacha.steps || 10} 步 / CFG ${gacha.cfg ?? 1}`;
    el.gachaHint.textContent = !turboName
      ? `抽卡：当前是预合并 Turbo 底模，${params}，无需再挂 LoRA。`
      : availableLora(turboName)
        ? `抽卡：Turbo 已挂，${params}；选中图送去重绘会自动切到细化参数。`
        : state.lorasLoaded
          ? `抽卡参数已设好，但没找到 ${turboName}；把 LoRA 放进 loras 目录后刷新。`
          : "抽卡参数已设好；LoRA 列表读取完成后会尝试挂上 Turbo。";
  }

  function syncTurboLora(enabled) {
    const key = turboLoraName();
    // 预合并 Turbo 底模无需额外 LoRA，档位本身已生效。
    if (!key) return Boolean(enabled);
    const active = Boolean(findActiveLora(key));
    if (Boolean(enabled) === active) return true;
    if (!state.lorasLoaded) return false;
    const target = availableLora(key);
    if (!target) return false;
    setLoraEnabled(target.name, Boolean(enabled));
    return true;
  }

  function updateQualityHint() {
    updateGachaAvailability();
    updateGachaHint();
    syncBatchOptions();
    const key = el.qualityGroup.value;
    const tier = key ? qualityTier(key) : null;
    // turbo 底模被纠正到蒸馏区间时，明确说一句，免得用户以为步数滑杆坏了。
    const turboNote = isTurboCheckpoint() && tier && Number(tier.steps) <= 12 && key !== "gacha"
      ? " · turbo 底模按 8 步/CFG 1"
      : "";
    if (key && tier && qualityMatches(key, tier)) {
      // 档位里的倍数是"出厂值"，用户可能改过放大倍数；这里一律显示实际值，
      // 免得状态字写着 1.25x、下面的下拉框却是 1.5x。
      const actualScale = Number(el.hrScale?.value) || 1.25;
      let text;
      if (key === "hires") {
        text = `${QUALITY_LABELS[key] || "高清"} · ${actualScale}x`;
      } else if (tier.hires) {
        text = `${QUALITY_LABELS[key] || key} · ${tier.steps || 24} 步 +${actualScale}x 二采`;
      } else {
        text = qualityLabel(key, tier);
      }
      el.qualityHint.textContent = text + turboNote;
    } else {
      const hires = el.hires.checked ? ` · Hires ${el.hrScale.value}x` : "";
      el.qualityHint.textContent = `自定义 · ${el.steps.value} 步${hires}` + turboNote;
    }
    el.qualityHint.title = el.qualityHint.textContent;
  }

  function applyQuality(key) {
    const quality = qualityTier(key);
    if (!quality) return;
    if (key === "gacha" && state.mode !== "txt2img") {
      // 按钮虽在重绘里隐藏，但 MDUI 的 change 已经把组值改成 gacha；
      // 不还原会留下「看不见的抽卡档」，下次切回文生图还会带着 8/12 张。
      el.qualityGroup.value = state.qualityKey || "";
      updateQualityHint();
      snack("抽卡档只用于文生图；重绘请调重绘幅度或用细化预设", { bad: true });
      return;
    }
    if (key === "hires" && state.mode !== "txt2img") {
      // 重绘没有 Hires 二采（buildRequest 会强制关掉），选中它只会让档位说谎。
      el.qualityGroup.value = state.qualityKey || "";
      updateQualityHint();
      snack("高清档的 Hires 二采只用于文生图；重绘请调步数或重绘幅度", { bad: true });
      return;
    }
    const beforeBatch = Number(el.batch.value) || 1;
    el.steps.value = quality.steps;
    el.stepsOut.textContent = quality.steps;
    el.cfg.value = quality.cfg;
    el.cfgOut.textContent = Number(quality.cfg).toFixed(1);
    el.hires.checked = quality.hires;
    if (quality.hires) {
      // 二采开关就在采样卡里；卡片被折叠时选「高清」会看不到它，自动展开一次。
      setParamFolded(false, { save: true });
      el.hrScale.value = String(quality.scale);
      el.hrDenoise.value = String(quality.denoise);
      el.hrOut.textContent = Number(quality.denoise).toFixed(2);
    }
    // 采样器跟随档位：档位自己定义了就用自己的（如官方配方的 Euler），
    // 没定义就回到当前模型的推荐值，避免切档后还留着上一档的采样器。
    const nowProfile = activeProfile();
    const tierSampler = quality.sampler || nowProfile?.sampler;
    const tierScheduler = quality.scheduler || nowProfile?.scheduler;
    if (tierSampler) el.sampler.value = tierSampler;
    if (tierScheduler) el.scheduler.value = tierScheduler;
    const turboReady = quality.turbo === undefined
      ? true
      : syncTurboLora(Boolean(quality.turbo));
    if (el.qualityGroup.value !== key) el.qualityGroup.value = key;
    state.qualityKey = key;
    updateSamplerPresetUI();
    updateHiresUI();
    updateQualityHint();
    updateAdvancedSummary();
    scheduleSave();
    if (quality.turbo && !turboReady) {
      snack("参数已设好；Turbo LoRA 还没读到，请稍后在 LoRA 里手动开启", { bad: true });
    } else if (quality.turbo) {
      snack(`抽卡模式：${quality.steps} 步 / CFG ${loraWeightText(quality.cfg)} · Turbo 已开`);
    } else if (beforeBatch > Number(el.batch.value)) {
      snack(`已离开抽卡，本批张数回到 ${el.batch.value} 张`);
    }
  }

  function markCustomQuality() {
    if (el.qualityGroup.value) el.qualityGroup.value = "";
    state.qualityKey = "";
    updateQualityHint();
  }

  function updateHiresUI() {
    el.hiresOptions.hidden = !el.hires.checked;
    const flowHires = el.hires.checked && (isAnimaActive() || isKreaActive());
    el.hrWarn.hidden = el.hrScale.value !== "1.5" && !flowHires;
    if (isKreaActive()) {
      // 实测 1536² 直出在 8GB 上没问题（约 70s），二采反而更容易糊，
      // 所以这里不是「警告爆显存」，而是说清楚二采对 Krea 什么时候才划算。
      el.hrWarn.hidden = false;
      el.hrWarn.textContent = "Krea 2 原生支持 1K–2K，直出通常比「低分辨率打底 + 二采」更清晰（实测 1328² 直出边缘细节明显高于二采）。二采留给超过 1536 的尺寸，倍率别过 1.35，否则打底会掉到 1K 以下。";
    } else if (flowHires) {
      el.hrWarn.textContent = `Anima 在 8GB 显存上 1024 级别 + Hires 很容易爆显存；建议先关 Hires，或降到 832×1216。`;
    } else {
      el.hrWarn.textContent = "1.5x 在 8GB 显存上可能不足，建议先用 1.25x。";
    }
    updateEngineHint();
    updateMobileHint();
    updateHiresScaleHint();
  }

  // 二采这里最容易误会：选了 4× 超分模型，界面却还是 1.5×。
  // 那 1.5× 是「二采后成图的尺寸倍数」，模型只负责在这步里补真实纹理，
  // 补出来的 4× 会被压回到这个尺寸（不压的话二次采样要跑在 4 倍分辨率上，8G 直接爆）。
  // 想要原生 4× 得走作品库的「无损放大」——那条链路才是原尺寸出图。
  function updateHiresScaleHint() {
    if (!el.hrUpscalerHelper) return;
    const up = String(el.hrUpscaler?.value || "");
    const hit = state.upscalerOptions.find((item) => item.value === up);
    if (hit?.native && Number(hit.scale) > 0) {
      const modelScale = Number(hit.scale);
      const outScale = Number(el.hrScale.value) || 1.5;
      el.hrUpscalerHelper.textContent =
        `${shortUpscaler(up)} 是固定 ${modelScale}× 模型：二采先补到 ${modelScale}× 再压回 ${outScale}× —— `
        + `${outScale}× 是你选的成图尺寸，不是模型倍数。要原生 ${modelScale}× 出图，去作品库点「无损放大」。`;
      el.hrUpscalerHelper.title = "二采的成图尺寸只由「放大倍数」决定；超分模型负责在放大过程中补真实纹理。";
      return;
    }
    el.hrUpscalerHelper.textContent =
      `${state.upscalerOptions.length || 8} 个算法 · Lanczos 通用、Latent 最快；想真补细节就选 AI 超分模型。`;
    el.hrUpscalerHelper.title = "Latent 最快但细节少；Lanczos 通用；Nearest 适合像素风；AI 超分模型会真正补纹理。";
  }

  /* -------------------------------------------------- Anima LLLite 控制图 */
  function updateControlnetVisibility() {
    if (!el.controlGroup) return;
    const arch = activeProfile()?.arch || "";
    el.controlGroup.hidden = arch !== "anima";
    // Krea 的「风格参考」走的是另一条采样图（参考图 -> conditioning），
    // 和控制图约束构图不是一回事，所以单独一块 UI，只在 Krea 下出现。
    if (el.styleRefGroup) {
      el.styleRefGroup.hidden = arch !== "krea";
      if (arch === "krea") {
        renderStyleRefStrip();
        updateStyleRefHint();
      }
    }
  }

  /* -------------------------------------------------- Krea 风格参考图 */
  function updateStyleRefHint() {
    if (!el.styleRefHint) return;
    const n = state.styleRefImages.length;
    if (!n) {
      el.styleRefHint.textContent = "未选参考图";
      return;
    }
    const hasLora = state.loras.some(
      (item) => loraKey(item.name) === loraKey("krea2_style_reference"));
    el.styleRefHint.textContent = hasLora
      ? `已选 ${n} 张 · 画风参考`
      : `已选 ${n} 张 · 缺少 style_reference LoRA`;
    el.styleRefHint.classList.toggle("is-bad", !hasLora);
  }

  function renderStyleRefStrip() {
    if (!el.styleRefStrip) return;
    const list = state.styleRefImages;
    el.styleRefStrip.hidden = list.length === 0;
    el.styleRefStrip.replaceChildren();
    list.forEach((src, index) => {
      const cell = document.createElement("div");
      cell.className = "style-ref-item";
      const img = document.createElement("img");
      img.src = src;
      img.alt = `风格参考 ${index + 1}`;
      const no = document.createElement("span");
      no.className = "style-ref-no";
      no.textContent = String(index + 1);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "style-ref-del";
      del.textContent = "×";
      del.title = "移除这张参考图";
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        state.styleRefImages.splice(index, 1);
        renderStyleRefStrip();
        updateStyleRefHint();
        updateAdvancedSummary();
      });
      cell.append(img, no, del);
      el.styleRefStrip.appendChild(cell);
    });
  }

  const STYLE_REF_MAX = 3;

  function queueStyleRefFiles(files) {
    const picked = [...files].filter((file) => file && /^image\//.test(file.type));
    if (!picked.length) return;
    const room = STYLE_REF_MAX - state.styleRefImages.length;
    if (room <= 0) {
      snack(`风格参考最多 ${STYLE_REF_MAX} 张，先移除一张再加`, { bad: true });
      return;
    }
    const batch = picked.slice(0, room);
    let pending = batch.length;
    batch.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        state.styleRefImages.push(String(reader.result || ""));
        pending -= 1;
        if (pending === 0) {
          renderStyleRefStrip();
          updateStyleRefHint();
          updateAdvancedSummary();
          // 缺 LoRA 时明确提醒一次：参考图没有 LoRA 是彻底不生效的。
          const hasLora = state.loras.some(
            (item) => loraKey(item.name) === loraKey("krea2_style_reference"));
          snack(hasLora
            ? `已加入 ${batch.length} 张风格参考图`
            : "参考图已加入，但没找到 krea2_style_reference LoRA，需要它才生效",
            { bad: !hasLora });
        }
      };
      reader.onerror = () => {
        pending -= 1;
      };
      reader.readAsDataURL(file);
    });
    if (picked.length > room) {
      snack(`只加入前 ${room} 张，风格参考最多 ${STYLE_REF_MAX} 张`);
    }
  }

  function updateControlnetHint() {
    if (!el.controlnetHint) return;
    const model = String(el.controlModel?.value || "");
    const has = Boolean(state.controlImage);
    if (!model && !has) el.controlnetHint.textContent = "未选控制图";
    else if (!has) el.controlnetHint.textContent = "还没选控制图";
    else if (!model) el.controlnetHint.textContent = "已选图 · 未选类型";
    else el.controlnetHint.textContent = `已启用 · 强度 ${Number(el.controlStrength?.value || 1).toFixed(2)}`;
  }

  function updatePerfHint() {
    if (!el.perfHint) return;
    const active = [];
    if (el.easyCache?.checked) active.push("跳步缓存");
    if (el.lowVram?.checked) active.push("低显存");
    const vram = state.vram;
    if (vram && vram.total > 0) {
      const used = (vram.total - vram.free) / 1024;
      const total = vram.total / 1024;
      active.push(`显存 ${used.toFixed(1)}/${total.toFixed(1)}G`);
    }
    el.perfHint.textContent = active.length ? active.join(" · ") : "默认";
  }

  /* ------------------------------------------------------- sampler presets */
  // 架构切换时整组换掉：SDXL 与 Anima 的采样器/调度器不是同一套直觉，
  // 混在一排卡片里会让人以为 Karras 也适合流匹配模型。
  function activeSamplerPresets() {
    if (isKreaActive()) return SAMPLER_PRESETS.krea;
    if (isZimageActive()) return SAMPLER_PRESETS.zimage;
    if (activeProfile()?.arch === "moss") return SAMPLER_PRESETS.moss;
    return SAMPLER_PRESETS[isAnimaActive() ? "anima" : "sdxl"];
  }

  function renderSamplerPresets() {
    if (!el.samplerPresets) return;
    const presets = activeSamplerPresets();
    const frag = document.createDocumentFragment();
    Object.entries(presets).forEach(([key, preset]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sampler-preset";
      button.dataset.preset = key;
      button.setAttribute("aria-pressed", "false");
      if (preset.note) button.title = preset.note;
      const name = document.createElement("span");
      name.className = "sp-name";
      name.textContent = preset.label;
      const combo = document.createElement("span");
      combo.className = "sp-combo";
      combo.textContent = `${preset.sampler} · ${preset.scheduler}`;
      button.append(name, combo);
      frag.appendChild(button);
    });
    el.samplerPresets.replaceChildren(frag);
    const anima = isAnimaActive();
    const krea = isKreaActive();
    const zimage = isZimageActive();
    const moss = activeProfile()?.arch === "moss";
    if (el.samplerAdvice) {
      el.samplerAdvice.textContent = zimage
        ? "Z-Image Turbo 官方配方是 Res Multistep + Simple、9 步、shift 3。实测加到 20–30 步不会变糊，只是收益递减、时间翻倍；要细节用 1.25x 二采更划算。"
        : moss
          ? "MOSS 是流匹配 5B：官方配 Euler + Simple；要快就 ER SDE + Simple（配合跳步缓存）；复杂构图试 Res Multistep。"
          : krea
            ? "Krea 2 是流匹配模型：Euler + Simple、CFG 1 是基准，8 步是速度拐点；加步数确实更精细（收益递减），换 Beta 构图更稳。"
            : anima
              ? "Anima 是流匹配模型：优先 Euler 系 + SGM Uniform / Beta。Karras 一类传统 sigma 曲线留作对照，不作推荐。"
              : "不确定采样器时选 Euler a + Karras；写实可换 DPM++ 2M SDE。";
    }
  }

  function ensureSamplerPresets() {
    const arch = isKreaActive() ? "krea"
      : (activeProfile()?.arch === "moss" ? "moss" : (isAnimaActive() ? "anima" : "sdxl"));
    if (state.samplerPresetArch === arch) {
      updateSamplerPresetUI();
      return;
    }
    state.samplerPresetArch = arch;
    renderSamplerPresets();
  }

  function samplerPresetKey(sampler = el.sampler.value, scheduler = el.scheduler.value) {
    const presets = activeSamplerPresets();
    return Object.keys(presets).find((key) => {
      const preset = presets[key];
      return preset.sampler === sampler && preset.scheduler === scheduler;
    }) || "";
  }

  function updateSamplerPresetUI() {
    if (!el.samplerPresets) return;
    const presets = activeSamplerPresets();
    const key = samplerPresetKey();
    $$(".sampler-preset", el.samplerPresets).forEach((button) => {
      const active = button.dataset.preset === key;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const baseLabel = key ? presets[key].label : "自定义";
    // 折叠后种子就看不见了，把它并进标题行，至少知道这一批用的是哪个种子。
    const folded = el.paramCard?.classList.contains("is-folded");
    const seedText = el.seedLock?.checked ? `seed ${el.seed.value || "-1"}` : "seed 随机";
    el.samplerPresetHint.textContent = folded ? `${baseLabel} · ${seedText}` : baseLabel;
  }

  function applySamplerPreset(key) {
    const preset = activeSamplerPresets()[key];
    if (!preset) return;
    el.sampler.value = preset.sampler;
    el.scheduler.value = preset.scheduler;
    updateSamplerPresetUI();
    updateAdvancedSummary();
    scheduleSave();
    snack(`采样组合：${preset.label} · ${preset.sampler} · ${preset.scheduler}`);
  }

  /* ------------------------------------------------ 命令条 / 参数托盘 */
  const RATIO_KEYS = ["1:1", "2:3", "3:2", "9:16", "16:9"];

  function anyDialogOpen() {
    return ["loraDialog", "inspirationDialog", "characterDialog", "galleryDialog", "savePresetDialog", "savedDialog", "helpDialog", "lightboxDialog", "galleryInfoDialog", "refineDialog", "queueDialog", "upscaleDialog"]
      .some((key) => Boolean(el[key]?.open));
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return Boolean(target.closest("mdui-text-field, mdui-select, mdui-slider"));
  }

  function updateAdvancedSummary() {
    if (!el.sendSummary) return;
    updateLoraHelper();
    updateGachaHint();
    const sampler = el.sampler.value || "Euler a";
    const scheduler = el.scheduler.value || "Karras";
    const steps = Number(el.steps.value) || 24;
    const cfg = Number(el.cfg.value) || 5.5;
    const batch = Number(el.batch.value) || 1;
    const profile = activeProfile();
    const model = modelShortName(state.activeModel) || "未连接模型";
    // 画质档与滑杆脱钩时（例如载入了自定义预设），按当前数值反推档位，
    // 避免摘要永远显示「自定义」而实际就是标准档。
    const selectedQuality = el.qualityGroup.value && qualityMatches(el.qualityGroup.value, qualityTier(el.qualityGroup.value))
      ? el.qualityGroup.value
      : "";
    const matchedQuality = selectedQuality || QUALITY_KEYS.find((key) => qualityMatches(key, qualityTier(key))) || "";
    const quality = matchedQuality ? (QUALITY_LABELS[matchedQuality] || "自定义") : "自定义";
    const detailTarget = state.mode === "img2img" && state.initImage && el.detailEnhance?.checked
      ? detailTargetSize()
      : null;
    const size = state.mode === "img2img"
      ? (state.initImage
          ? `${state.initImage.width} × ${state.initImage.height}${detailTarget ? ` → ${detailTarget.width} × ${detailTarget.height}` : ""}`
          : "未选参考图")
      : `${state.width} × ${state.height}`;
    const hires = state.mode === "txt2img" && el.hires.checked
      ? `Hires ${el.hrScale.value}x ${shortUpscaler(el.hrUpscaler.value)}`
      : "";
    const clip = normalizeClipSkip(el.clipSkip.value);
    const flowArch = isAnimaActive() || isKreaActive();
    const clipText = flowArch || clip === DEFAULT_CLIP_SKIP ? "" : `CLIP ${clip}`;
    const shiftText = flowArch && el.shift
      ? `Shift ${Number(el.shift.value).toFixed(1)}${isKreaActive() ? "（内置）" : ""}`
      : "";
    const seed = el.seedLock.checked ? `seed ${el.seed.value || "-1"}` : "seed 随机";
    const loraText = state.activeLoras.length ? `${state.activeLoras.length} LoRA` : "";
    const rating = state.rating !== "auto" ? `评级 ${RATING_LABELS[state.rating]}` : "";
    const modeText = state.mode === "img2img" ? `重绘 ${Number(el.initDenoise.value).toFixed(2)}` : "";
    // 图生图请求带 img2img_fix_steps，所选步数就是实际采样步数，摘要里直说清楚。
    const stepsText = state.mode === "img2img" ? `${steps} 步实采` : `${steps} 步`;
    const perfText = [el.easyCache?.checked ? "跳步缓存" : "", el.lowVram?.checked ? "低显存" : ""].filter(Boolean).join(" · ");
    // 风格参考会整体接管采样图，摘要里必须显形，否则用户会以为参数没生效。
    const styleRefText = isKreaActive() && state.styleRefImages.length
      ? `风格参考 ${state.styleRefImages.length} 张`
      : "";
    // 局部重绘会改写采样范围（噪声只铺在蒙版内），摘要里也要标出来。
    const maskText = state.mode === "img2img" && el.maskEnable?.checked
      ? (maskState.painted ? "局部重绘" : "局部重绘 · 未涂")
      : "";

    const chip = [sampler, scheduler, stepsText];
    if (batch > 1) chip.push(`${batch} 张`);
    if (hires) chip.push("Hires");
    el.sendSummary.textContent = chip.join(" · ");

    const detail = [
      model,
      profile.id !== "generic" ? profile.label : "",
      quality,
      size,
      stepsText,
      `CFG ${cfg}`,
      `${sampler} · ${scheduler}`,
      shiftText,
      clipText,
      hires,
      batch > 1 ? `${batch} 张` : "",
      seed,
      modeText,
      maskText,
      loraText,
      styleRefText,
      rating,
      perfText
    ].filter(Boolean);
    if (el.sendSummaryDetail) {
      const text = `本次将发送 · ${detail.join(" · ")}`;
      el.sendSummaryDetail.textContent = text;
      el.sendSummaryDetail.title = text;
      // 底部只显示一行摘要，完整参数挂在悬停提示上
      el.sendSummary.parentElement?.setAttribute("title", text);
    }
  }

  /* ------------------------------------------------------------------ seed */
  function updateSeedUI({ preserve = false } = {}) {
    const locked = Boolean(el.seedLock.checked);
    el.seed.disabled = !locked;
    el.diceSeed.disabled = !locked;
    if (!locked) {
      if (!preserve) el.seed.value = "-1";
    } else if (!preserve && (!el.seed.value || Number(el.seed.value) < 0)) {
      const currentSeed = state.current?.seed;
      el.seed.value = String(currentSeed ?? Math.floor(Math.random() * 2147483647));
    }
    el.seed.toggleAttribute("readonly", !locked);
    updateAdvancedSummary();
  }

  function randomSeed() {
    el.seed.value = String(Math.floor(Math.random() * 2147483647));
    updateAdvancedSummary();
    snack("已换一个新种子");
  }

  /* ------------------------------------------------------------------ mode */
  function setMode(mode, { save = true, silent = false } = {}) {
    const next = mode === "img2img" ? "img2img" : "txt2img";
    state.mode = next;
    document.body.dataset.mode = next;
    // 只在值真的变了才写：重复写会触发 segmented group 重渲染，
    // 那一帧内部 part 会短暂丢圆角，看着就是"方一下"。
    if (el.modeGroup.value !== next) el.modeGroup.value = next;
    el.modeBadge.textContent = next === "img2img" ? "图生图" : "文生图";
    el.mobileMode.textContent = next === "img2img" ? "图生图重绘" : "文生图";
    el.placeholderTitle.textContent = next === "img2img" ? "把参考图放进来" : "还没有画面";
    el.placeholderHint.textContent = next === "img2img"
      ? "选择参考图，写清想要的风格，再调整重绘幅度。"
      : "写好描述，点「生成画面」或按 Ctrl + Enter。";
    if (el.placeholderHintMobile) {
      el.placeholderHintMobile.textContent = next === "img2img"
        ? "先放参考图，写清风格，再调重绘幅度。"
        : "写好描述，点下方「生成」。";
    }
    // 抽卡是文生图档：10 步 / CFG 1 / Turbo 带进重绘只会得到发灰的低步数结果。
    // 切到图生图时统一转成当前模型的细化参数，保留用户已选的重绘幅度。
    if (next === "img2img" && el.qualityGroup.value === "gacha") {
      if (turboLoraActive()) {
        const turboName = turboLoraName();
        if (turboName) setLoraEnabled(turboName, false);
      }
      const denoise = Number(el.initDenoise.value) || 0.35;
      setRefineBase(denoise);
      if (!silent) {
        snack(`抽卡档只用于文生图；已转为细化 ${el.steps.value} 步实采 / CFG ${el.cfg.value} / 重绘 ${denoise.toFixed(2)} · 本批 1 张`);
      }
    } else if (next === "img2img" && el.qualityGroup.value === "hires") {
      // Hires 二采在重绘里不生效，档位留在组里会让摘要写「高清 · 1.25x」。
      el.qualityGroup.value = "";
      state.qualityKey = "";
      updateQualityHint();
      if (!silent) snack(`高清二采只用于文生图；重绘按 ${el.steps.value} 步实采`);
    }
    updateGenerateButtons();
    updateMobileHint();
    updateAdvancedSummary();
    if (save) scheduleSave();
    if (!silent && next !== "txt2img" && !state.initImage) {
      setTimeout(() => el.refBlock.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    }
  }

  function updateMobileHint() {
    if (state.mode === "img2img") {
      const size = state.initImage ? `${state.initImage.width}×${state.initImage.height}` : "未选参考图";
      const detail = state.initImage && el.detailEnhance?.checked ? detailTargetSize() : null;
      const sizeText = detail ? `${size}→${detail.width}×${detail.height}` : size;
      el.mobileHint.textContent = `重绘 ${Number(el.initDenoise.value).toFixed(2)} · ${el.steps.value} 步实采 · ${sizeText}`;
    } else {
      el.mobileHint.textContent = `${el.steps.value} 步 · ${state.width} × ${state.height}${el.hires.checked ? " · Hires" : ""}`;
    }
  }

  /* ------------------------------------------------------------------ ratio */
  function updateRatioSelection() {
    $$(".ratio-tile", el.ratioGrid).forEach((tile) => {
      const active = tile.dataset.key === state.ratioKey;
      tile.classList.toggle("is-selected", active);
      tile.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (el.ratioSelect) {
      el.ratioSelect.value = RATIO_KEYS.includes(state.ratioKey) ? state.ratioKey : "custom";
    }
  }

  function selectRatio(tile) {
    // 比例块是静态 DOM，尺寸要按当前架构查表：Krea 走 1.77–2.36MP 那一档。
    const key = tile.dataset.key;
    const row = ratioTableFor(activeProfile()?.arch).find((item) => item.key === key);
    applySize(
      row ? row.w : Number(tile.dataset.w),
      row ? row.h : Number(tile.dataset.h),
      key
    );
  }

  function applySize(width, height, ratioKey) {
    state.width = width;
    state.height = height;
    state.ratioKey = ratioKey;
    el.customW.value = String(width);
    el.customH.value = String(height);
    el.sizeHint.textContent = `${width} × ${height}`;
    updateRatioSelection();
    updateMobileHint();
    updateGachaHint();
    updateAdvancedSummary();
    scheduleSave();
  }

  // 切模型时把比例对应的像素预算跟上：只有在当前尺寸「正好等于旧表里某个比例」
  // 时才改写（说明用户没自定义），自定义尺寸一律不动，避免冲掉手调结果。
  function alignSizeOnModelSwitch(prevArch, nextArch) {
    if (prevArch === nextArch) return;
    const prevTable = ratioTableFor(prevArch);
    const nextTable = ratioTableFor(nextArch);
    const hit = prevTable.find((row) => row.w === state.width && row.h === state.height);
    if (!hit) return;
    const target = nextTable.find((row) => row.key === hit.key);
    if (!target || (target.w === state.width && target.h === state.height)) return;
    applySize(target.w, target.h, hit.key);
    if (nextArch === "krea") {
      snack(`Krea 2 原生 1K–2K，已把 ${hit.key} 调到 ${target.w}×${target.h}`);
    }
  }

  function applyCustomSize({ announce = true } = {}) {
    const rawW = Number(el.customW.value);
    const rawH = Number(el.customH.value);
    if (!Number.isFinite(rawW) || !Number.isFinite(rawH)) {
      el.customW.value = String(state.width);
      el.customH.value = String(state.height);
      if (announce) snack("宽高需要是数字", { bad: true });
      return;
    }
    // 上限放到 2048：Krea 2 官方支持 2K 直出，1536 会把 2:3 竖幅卡掉。
    const width = clamp(round8(rawW), 512, 2048);
    const height = clamp(round8(rawH), 512, 2048);
    state.width = width;
    state.height = height;
    state.ratioKey = "custom";
    el.customW.value = String(width);
    el.customH.value = String(height);
    el.sizeHint.textContent = `${width} × ${height}`;
    updateRatioSelection();
    updateMobileHint();
    updateGachaHint();
    updateAdvancedSummary();
    scheduleSave();
    if (announce && (width !== rawW || height !== rawH)) {
      snack(`尺寸已调整为 ${width} × ${height}`);
    }
  }

  /* --------------------------------------------------------------- img2img */
  // 8GB 实测：28 步 / CFG 4 下 1248×1824 峰值约 6.9GB，1.5× 可用；
  // 参考图长边本就压到 1280，所以目标长边硬上限 1920，不再往上加。
  const DETAIL_MAX_LONG_EDGE = 1920;

  function detailTargetSize(scale = Number(el.detailScale?.value) || 1) {
    if (!state.initImage) return null;
    const factor = clamp(Number(scale) || 1, 1, 1.5);
    let width = round8(state.initImage.width * factor);
    let height = round8(state.initImage.height * factor);
    const longEdge = Math.max(width, height);
    if (longEdge > DETAIL_MAX_LONG_EDGE) {
      const k = DETAIL_MAX_LONG_EDGE / longEdge;
      width = round8(width * k);
      height = round8(height * k);
    }
    return { width, height, factor };
  }

  function updateDetailUI() {
    if (!el.detailEnhance) return;
    const on = Boolean(el.detailEnhance.checked);
    if (el.detailOptions) el.detailOptions.hidden = !on;
    if (!on) return;
    const init = state.initImage;
    if (!init) {
      el.detailHint.textContent = "先选参考图，再设置放大倍数；提示词可留空。";
      return;
    }
    const target = detailTargetSize();
    if (!target) return;
    const factor = target.width / init.width;
    const scaleText = Math.abs(factor - 1) < 0.01 ? "原尺寸补细节" : `${factor.toFixed(2)}×`;
    el.detailHint.textContent = `输出 ${target.width} × ${target.height}（原 ${init.width} × ${init.height}，${scaleText}）· 提示词可留空 · 建议重绘幅度 0.25–0.4，越大改动越多。`;
  }

  function setDetailEnhance(on, { announce = true } = {}) {
    if (!el.detailEnhance) return;
    el.detailEnhance.checked = Boolean(on);
    if (on) {
      // 细节增强的常用区间比“换风格”低；只在高幅度时压回建议值，保留用户已调好的低幅度。
      // 重绘幅度滑杆步进 0.05，写 0.30 而不是 0.32，避免界面文字与实际取值不一致。
      if (Number(el.initDenoise.value) > 0.45) {
        el.initDenoise.value = "0.30";
        el.denoiseOut.textContent = "0.30";
      }
      updateDetailUI();
      if (announce) {
        snack(state.initImage
          ? `细节增强已开 · ${el.detailScale.value}× · 重绘 ${Number(el.initDenoise.value).toFixed(2)}`
          : "细节增强已开；选好参考图后生效");
      }
    } else {
      updateDetailUI();
      if (announce) snack("已关闭细节增强");
    }
    updateMobileHint();
    updateAdvancedSummary();
    scheduleSave();
  }

  function renderRef() {
    const has = Boolean(state.initImage);
    el.dropzoneEmpty.hidden = has;
    el.refPreview.hidden = !has;
    el.refActions.hidden = !has;
    if (has) {
      const init = state.initImage;
      el.refImg.src = init.dataUrl;
      el.refName.textContent = init.name || "参考图";
      el.refMeta.textContent = `原始 ${init.originalWidth} × ${init.originalHeight}`
        + (init.format ? ` · ${init.format}` : "")
        + (init.compressed ? " · 已压缩" : "");
      el.refSize.textContent = `${init.width} × ${init.height} · ${(init.bytes / 1024 / 1024).toFixed(2)} MB`;
      el.refHint.textContent = `${init.width} × ${init.height}`;
    } else {
      el.refImg.removeAttribute("src");
      el.refName.textContent = "";
      el.refMeta.textContent = "";
      el.refSize.textContent = "";
      el.refHint.textContent = "选一张图开始";
    }
    updateDetailUI();
    updateMobileHint();
    // 换图/清图都要丢掉旧蒙版：蒙版是按上一张图的尺寸画的，留着必然错位。
    resetMaskCanvas();
  }

  /* -------------------------------------------------- 局部重绘蒙版 */
  // 蒙版画布的真实像素尺寸 = 原图尺寸（向上对齐到 16），CSS 只负责缩放显示。
  // 绘制用半透明红笔画给人看，导出时按 alpha 转成黑白（白=重绘）。
  const maskState = { ctx: null, drawing: false, last: null, painted: 0 };

  function maskTargetSize(init) {
    // 必须 16 的倍数：Qwen-Image / Anima 的 VAE 是 8 倍下采样再 2 倍 patch。
    // 局部重绘时后端不会再去对齐尺寸（对齐会让蒙版和 latent 错位），所以前端先算好。
    const w = Math.max(16, Math.round(init.width / 16) * 16);
    const h = Math.max(16, Math.round(init.height / 16) * 16);
    return { w, h };
  }

  function resetMaskCanvas() {
    maskState.painted = 0;
    maskState.drawing = false;
    maskState.last = null;
    if (!el.maskCanvas) return;
    const ctx = el.maskCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, el.maskCanvas.width, el.maskCanvas.height);
    syncMaskStage();
    updateMaskStat();
  }

  // 没图或没开开关时整个画布区不可用
  function syncMaskStage() {
    const usable = Boolean(state.initImage) && Boolean(el.maskEnable?.checked);
    if (el.maskOptions) el.maskOptions.hidden = !el.maskEnable?.checked;
    if (el.maskStage) el.maskStage.dataset.disabled = usable ? "" : "1";
  }

  function initMaskCanvas() {
    if (!el.maskCanvas || !state.initImage) return;
    const { w, h } = maskTargetSize(state.initImage);
    if (el.maskCanvas.width !== w || el.maskCanvas.height !== h) {
      el.maskCanvas.width = w;
      el.maskCanvas.height = h;
    }
    if (el.maskBase) el.maskBase.src = state.initImage.dataUrl;
    maskState.ctx = el.maskCanvas.getContext("2d");
    resetMaskCanvas();
  }

  function updateMaskStat() {
    if (!el.maskStat) return;
    const empty = maskState.painted === 0;
    el.maskStat.textContent = empty ? "未涂抹 · 不会生效" : "已涂抹，其余区域保持原样";
    el.maskStat.classList.toggle("is-empty", empty);
  }

  function maskPoint(event) {
    const cv = el.maskCanvas;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * (cv.width / rect.width),
      y: (event.clientY - rect.top) * (cv.height / rect.height)
    };
  }

  function maskStroke(from, to) {
    const ctx = maskState.ctx;
    if (!ctx) return;
    const cv = el.maskCanvas;
    const rect = cv.getBoundingClientRect();
    // 笔刷数值是「屏幕像素」，画布坐标要按显示比例放大，否则大图上笔迹细得看不见。
    const scale = rect.width ? cv.width / rect.width : 1;
    ctx.strokeStyle = "rgba(255, 64, 64, 0.55)";
    ctx.fillStyle = "rgba(255, 64, 64, 0.55)";
    ctx.lineWidth = Math.max(1, Number(el.brushSize?.value || 48) * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    // 单击（没有移动）用圆点补一下，否则点一下没反应
    ctx.beginPath();
    ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    maskState.painted += 1;
  }

  function beginMaskStroke(event) {
    if (!el.maskEnable?.checked || !state.initImage || !maskState.ctx) return;
    const p = maskPoint(event);
    if (!p) return;
    event.preventDefault();
    el.maskCanvas.setPointerCapture?.(event.pointerId);
    maskState.drawing = true;
    maskState.last = p;
    maskStroke(p, p);
    updateMaskStat();
  }

  function moveMaskStroke(event) {
    if (!maskState.drawing) return;
    const p = maskPoint(event);
    if (!p || !maskState.last) return;
    event.preventDefault();
    maskStroke(maskState.last, p);
    maskState.last = p;
  }

  function endMaskStroke(event) {
    if (!maskState.drawing) return;
    maskState.drawing = false;
    maskState.last = null;
    el.maskCanvas.releasePointerCapture?.(event.pointerId);
    updateMaskStat();
    updateAdvancedSummary();
  }

  // 导出黑白蒙版：透明处为黑（保留），涂过的地方为白（重绘）。
  function buildMaskDataUrl() {
    const cv = el.maskCanvas;
    if (!cv || !maskState.painted || !cv.width) return "";
    const out = document.createElement("canvas");
    out.width = cv.width;
    out.height = cv.height;
    const octx = out.getContext("2d");
    octx.fillStyle = "#000";
    octx.fillRect(0, 0, out.width, out.height);
    const src = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    const dst = octx.getImageData(0, 0, out.width, out.height);
    const s = src.data;
    const d = dst.data;
    for (let i = 0; i < s.length; i += 4) {
      if (s[i + 3] > 24) {
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      }
    }
    octx.putImageData(dst, 0, 0);
    return out.toDataURL("image/png");
  }

  function setMaskEnabled(on) {
    if (!el.maskEnable) return;
    el.maskEnable.checked = Boolean(on);
    if (on && !state.initImage) {
      snack("先选一张参考图，再涂蒙版", { bad: true });
      el.maskEnable.checked = false;
      syncMaskStage();
      return;
    }
    // 细节增强会把图放大，放大后尺寸变了蒙版就对不上，两者只能二选一。
    if (on && el.detailEnhance?.checked) {
      el.detailEnhance.checked = false;
      updateDetailUI();
      snack("局部重绘与细节放大互斥，已关闭放大");
    }
    if (el.detailEnhance) el.detailEnhance.disabled = Boolean(on);
    // 局部重绘的噪声只铺在蒙版里，denoise 低了等于没改，开蒙版时顺手抬到位。
    if (on && el.initDenoise && Number(el.initDenoise.value) < 0.85) {
      el.initDenoise.value = "0.85";
      if (el.denoiseOut) el.denoiseOut.textContent = "0.85";
    }
    syncMaskStage();
    if (on) initMaskCanvas();
    updateAdvancedSummary();
    scheduleSave();
  }

  // 图库和结果都是 Forge 的 PNG；细化会反复拿它当底图，每轮再压成 JPEG
  // 就等于在脸上叠加压缩噪点。PNG/WEBP 源优先无损，超过预算才退回 JPEG。
  const INIT_PNG_BUDGET = 6 * 1024 * 1024;

  function encodeInitImage(canvas, type) {
    const source = String(type || "").toLowerCase();
    const lossless = source === "image/png" || source === "image/webp";
    if (lossless) {
      const png = canvas.toDataURL("image/png");
      // data URL 里是 base64，按字符数直接比 6MB 会把实际阈值砍到 4.5MB。
      if ((png.length * 3) / 4 <= INIT_PNG_BUDGET) return png;
    }
    return canvas.toDataURL("image/jpeg", 0.94);
  }

  async function handleImageFile(file, { announce = true } = {}) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      snack("只支持 PNG / JPG / WEBP", { bad: true });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      snack("图片超过 25MB，请先压缩", { bad: true });
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const originalWidth = bitmap.width;
      const originalHeight = bitmap.height;
      const maxEdge = 1280;
      const scale = Math.min(1, maxEdge / Math.max(originalWidth, originalHeight));
      const width = clamp(round8(originalWidth * scale), 64, 1280);
      const height = clamp(round8(originalHeight * scale), 64, 1280);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === "function") bitmap.close();
      const dataUrl = encodeInitImage(canvas, file.type);
      const base64 = dataUrl.split(",")[1] || "";
      state.initImage = {
        dataUrl, base64, width, height,
        originalWidth, originalHeight,
        compressed: scale < 1,
        format: dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG",
        name: file.name || "粘贴的图片",
        bytes: Math.round((base64.length * 3) / 4)
      };
      el.fileInput.value = "";
      renderRef();
      if (announce) {
        snack(scale < 1 ? `参考图已压到 ${width}×${height}（原 ${originalWidth}×${originalHeight}）` : `参考图已就绪 · ${width}×${height}`);
      }
    } catch (err) {
      el.fileInput.value = "";
      snack("读取图片失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  function clearRefImage() {
    const previous = state.initImage;
    state.initImage = null;
    renderRef();
    snack("已移除参考图", {
      action: "撤销",
      onActionClick: () => {
        // 二进制只在本页内存里；只要期间没有换图，就直接恢复，不再让用户重选。
        if (state.initImage || !previous) {
          snack("参考图已更换，无法撤销", { bad: true });
          return;
        }
        state.initImage = previous;
        renderRef();
        snack("已恢复参考图");
      }
    });
  }

  /* ----------------------------------------------------------------- result */
  function makeMetaChips(item) {
    el.metaChips.innerHTML = "";
    const add = (iconName, text, options = {}) => {
      const node = document.createElement(options.click ? "button" : "span");
      node.className = "meta-chip";
      if (options.click) {
        node.type = "button";
        node.addEventListener("click", options.click);
        if (options.title) node.title = options.title;
      }
      const ic = document.createElement("span");
      ic.className = "icon";
      ic.innerHTML = icon(iconName, 12);
      node.appendChild(ic);
      const label = document.createElement("span");
      label.textContent = text;
      node.appendChild(label);
      el.metaChips.appendChild(node);
    };

    add("frame", `${item.finalWidth} × ${item.finalHeight}`);
    if (item.interrupted) add("stop", "中途停止");
    add("sliders", `${item.steps} 步 · CFG ${item.cfg}`);
    add("clock", `${item.totalElapsed.toFixed(1)} 秒${item.batchTotal > 1 ? ` · 第 ${item.batchIndex}/${item.batchTotal} 张` : ""}`);
    if (item.mode === "img2img" && item.kind !== "postprocess" && item.denoise != null) {
      add("image", `重绘 ${Number(item.denoise).toFixed(2)}`);
    }
    if (item.kind === "postprocess" && item.scale) {
      add("upscale", `${Number(item.scale)}x ${item.upscaler || "Lanczos"}`);
    }
    if (item.mode === "img2img" && item.config?.detailEnhance) {
      const scale = Number(item.config.detailScale) || 1;
      add("sparkles", scale > 1 ? `细节 ${scale}×` : "细节增强");
    }
    if (item.hires) add("sparkles", `Hires ${item.hrScale}x`);
    add("dice", `seed ${item.seed ?? "—"}`, {
      click: () => {
        if (item.seed == null) {
          snack("这张没有记录种子", { bad: true });
          return;
        }
        copyText(String(item.seed)).then((ok) => snack(ok ? `种子已复制：${item.seed}` : "复制失败", { bad: !ok }));
      },
      title: "点击复制种子"
    });
  }

  function resultTimeWindow(item) {
    const createdAt = Number(item?.createdAt) || Date.now();
    const elapsed = Math.max(0, Number(item?.totalElapsed) || 0) * 1000;
    const started = Number(item?.startedAtEpoch) || createdAt - elapsed;
    const finished = Number(item?.finishedAtEpoch) || createdAt;
    return { started: Math.min(started, finished), finished: Math.max(started, finished) };
  }

  function updateFavoriteButton() {
    if (!el.favoriteCurrent) return;
    const item = state.current;
    const on = Boolean(item?.favorite);
    const pending = Boolean(item?.favoritePending);
    el.favoriteCurrent.disabled = !item || state.busy || pending;
    el.favoriteCurrent.loading = pending;
    el.favoriteCurrent.classList.toggle("is-favorite", on);
    el.favoriteCurrent.setAttribute("aria-pressed", on ? "true" : "false");
    el.favoriteCurrent.title = on ? "取消收藏" : (item ? "收藏这张到作品库" : "");
    el.favoriteIcon.innerHTML = icon(on ? "starFilled" : "star", 18);
    el.favoriteLabel.textContent = on ? "已收藏" : "收藏";
  }

  async function fetchGalleryPage(offset, limit = 96) {
    const res = await fetch(`/local/gallery?offset=${offset}&limit=${limit}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  // 画布只有 base64 结果，磁盘路径要从作品库按“时间窗 + 种子 + 模式”反查。
  async function resolveGeneratedGallery(items) {
    const pending = (items || []).filter((item) => item && !item.galleryPath);
    if (!pending.length) return;
    const windows = pending.map(resultTimeWindow);
    const startSec = Math.floor(Math.min(...windows.map((entry) => entry.started)) / 1000) - 4;
    const endSec = Math.ceil(Math.max(...windows.map((entry) => entry.finished)) / 1000) + 4;
    const candidates = [];
    let offset = 0;
    for (let page = 0; page < 8; page += 1) {
      const data = await fetchGalleryPage(offset);
      const pageItems = Array.isArray(data.items) ? data.items : [];
      pageItems.forEach((entry) => {
        const mtime = Number(entry.mtime) || 0;
        if (mtime >= startSec && mtime <= endSec) candidates.push(entry);
      });
      const oldest = pageItems.length ? Number(pageItems[pageItems.length - 1].mtime) || 0 : 0;
      if (!pageItems.length || !data.has_more || (oldest && oldest < startSec)) break;
      offset += pageItems.length;
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => Number(a.mtime) - Number(b.mtime) || String(a.path).localeCompare(String(b.path)));
    const used = new Set();
    pending.forEach((item) => {
      const window = resultTimeWindow(item);
      const start = Math.floor(window.started / 1000) - 4;
      const end = Math.ceil(window.finished / 1000) + 4;
      const seed = item.seed == null ? "" : String(item.seed);
      let match = null;
      candidates.forEach((entry) => {
        if (used.has(entry.path)) return;
        if (item.mode && entry.mode !== item.mode) return;
        const mtime = Number(entry.mtime) || 0;
        if (mtime < start || mtime > end) return;
        if (seed && String(entry.seed) !== seed) return;
        if (!match || mtime > Number(match.mtime)) match = entry;
      });
      if (!match) return;
      used.add(match.path);
      item.galleryPath = match.path;
      item.galleryName = match.name || String(match.path).split("/").pop() || "";
      item.favorite = Boolean(match.favorite);
    });
    if (state.current && pending.includes(state.current)) updateFavoriteButton();
  }

  function trackGeneratedGallery(items) {
    if (!Array.isArray(items) || !items.length) return;
    const lookup = resolveGeneratedGallery(items).catch(() => {});
    items.forEach((item) => { item.galleryLookup = lookup; });
    lookup.then(() => {
      items.forEach((item) => {
        if (!item.galleryPath) delete item.galleryLookup;
      });
      if (state.current && items.includes(state.current)) updateFavoriteButton();
    });
  }

  async function ensureResultGalleryPath(item) {
    if (!item) return "";
    if (item.galleryPath) return item.galleryPath;
    if (item.galleryLookup) {
      await item.galleryLookup;
      if (item.galleryPath) return item.galleryPath;
    }
    const lookup = resolveGeneratedGallery([item]).catch(() => {});
    item.galleryLookup = lookup;
    await lookup;
    if (!item.galleryPath) delete item.galleryLookup;
    return item.galleryPath || "";
  }

  async function toggleCurrentFavorite() {
    const item = state.current;
    if (!item || item.favoritePending) return;
    item.favoritePending = true;
    updateFavoriteButton();
    try {
      const target = await ensureResultGalleryPath(item);
      if (!target) throw new Error("没找到这张的磁盘文件，可能还没落盘，稍后再点");
      const next = !item.favorite;
      const res = await fetch("/local/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target, favorite: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (typeof data.path === "string" && data.path) {
        item.galleryPath = data.path;
        item.galleryName = data.path.split("/").pop() || item.galleryName;
        // 历史恢复项直接用磁盘 URL 预览；收藏会移动文件，路径变了要同步，否则缩略图会 404。
        if (typeof item.url === "string" && item.url.startsWith("/local/gallery/file")) {
          item.url = galleryFileUrl({ path: data.path });
          if (state.current === item) {
            el.result.src = item.url;
            if (el.lightboxDialog.open && !state.lightboxItem) el.lightboxImg.src = item.url;
          }
          renderHistory();
        }
      }
      item.favorite = next;
      if (galleryState.favoriteTotal || galleryState.items.length) {
        galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal + (next ? 1 : -1));
        updateGalleryCount();
      }
      if (el.galleryDialog.open) loadGallery({ reset: true });
      snack(next ? "已收藏 · 可在作品库里查看" : "已取消收藏");
    } catch (err) {
      snack("收藏失败：" + (err?.message || "未知错误"), { bad: true });
    } finally {
      item.favoritePending = false;
      updateFavoriteButton();
    }
  }

  function showResult(item, { scroll = false } = {}) {
    if (!item) return;
    state.current = item;
    el.result.src = item.url;
    el.result.alt = `生成的画面，seed ${item.seed ?? "未知"}`;
    el.canvasFrame.hidden = false;
    el.placeholder.hidden = true;
    el.resultInfo.hidden = false;
    makeMetaChips(item);
    updateFavoriteButton();
    renderHistory();
    if (scroll && isMobileLayout()) {
      setTimeout(() => setMobileView("canvas", { scroll: true, top: 0 }), 80);
    }
  }

  function setHistoryActive() {
    $$(".thumb", el.history).forEach((thumb, index) => {
      const item = state.history[index];
      thumb.classList.toggle("is-active", Boolean(item && state.current && item.url === state.current.url));
    });
  }

  function renderHistory() {
    // remove existing thumbs but keep the empty hint node
    $$(".thumb", el.history).forEach((node) => node.remove());
    el.historyCount.textContent = String(state.history.length);
    el.historyEmpty.hidden = state.history.length > 0;
    state.history.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb";
      button.title = `${item.finalWidth}×${item.finalHeight} · seed ${item.seed ?? "—"}`;
      button.setAttribute("aria-label", `查看生成记录 ${item.finalWidth}×${item.finalHeight}`);
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = "历史生成";
      img.loading = "lazy";
      const badge = document.createElement("span");
      badge.className = "thumb-badge";
      badge.textContent = item.interrupted
        ? "中途"
        : item.kind === "postprocess"
          ? "放大"
          : item.mode === "img2img"
            ? "重绘"
            : "生成";
      button.append(img, badge);
      button.addEventListener("click", () => showResult(item));
      el.history.appendChild(button);
    });
    setHistoryActive();
    el.clearHistory.disabled = state.history.length === 0;
    renderBatchCompare();
  }

  // 服务端历史记录（.cache/history.json）→ 画布可用的结果项。
  // makeMetaChips 会直接对 steps/cfg/totalElapsed 做格式化，因此这里全部兜底成数值或占位符。
  function historyItemFromRecord(record) {
    if (!record || !record.path) return null;
    const created = Number(record.created) || Date.now();
    const elapsed = Number(record.elapsed) || 0;
    return {
      id: "r" + (record.id || Math.random().toString(36).slice(2)),
      url: galleryFileUrl({ path: record.path }),
      mode: record.mode === "img2img" ? "img2img" : "txt2img",
      kind: record.kind === "postprocess" ? "postprocess" : "generate",
      seed: record.seed ?? null,
      finalWidth: Number(record.width) || 0,
      finalHeight: Number(record.height) || 0,
      steps: Number(record.steps) || 0,
      cfg: record.cfg ?? "—",
      sampler: record.sampler || "",
      scheduler: record.scheduler || "",
      totalElapsed: elapsed,
      batchId: record.batchId || "",
      batchIndex: Number(record.batchIndex) || 1,
      batchTotal: Math.max(1, Number(record.batchTotal) || 1),
      denoise: record.denoise ?? null,
      interrupted: Boolean(record.interrupted),
      hires: Boolean(record.hires),
      hrScale: 1.25,
      config: null,
      createdAt: created,
      startedAtEpoch: created - elapsed * 1000,
      finishedAtEpoch: created,
      galleryPath: record.path,
      galleryName: String(record.path).split("/").pop() || "",
      favorite: String(record.path).startsWith("favorites/"),
      persistedId: record.id || "",
      scale: Number(record.scale) || null,
      upscaler: record.upscaler || "",
      source: record.source || ""
    };
  }

  async function restoreServerHistory() {
    try {
      const res = await fetch("/local/history?limit=" + MAX_HISTORY, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const records = Array.isArray(data.items) ? data.items : [];
      const restored = records.map(historyItemFromRecord).filter(Boolean);
      if (!restored.length) return;
      const known = new Set(state.history.map((item) => item.persistedId).filter(Boolean));
      const knownPaths = new Set(state.history.map((item) => item.galleryPath).filter(Boolean));
      const fresh = restored.filter((item) => !known.has(item.persistedId) && !knownPaths.has(item.galleryPath));
      if (!fresh.length) return;
      state.history = [...state.history, ...fresh].slice(0, MAX_HISTORY);
      renderHistory();
    } catch {
      /* 历史读取失败不打扰 */
    }
  }

  function currentBatchGroup() {
    const item = state.current;
    if (!item || !item.batchId) return [];
    return state.history
      .filter((entry) => entry.batchId === item.batchId)
      .sort((a, b) => (a.batchIndex || 0) - (b.batchIndex || 0));
  }

  function renderBatchCompare() {
    if (!el.batchCompare || !el.batchCompareStrip) return;
    const group = currentBatchGroup();
    const show = group.length > 1;
    el.batchCompare.hidden = !show;
    if (el.batchCompareCount) el.batchCompareCount.textContent = String(show ? group.length : 0);
    if (!show) {
      el.batchCompareStrip.replaceChildren();
      return;
    }
    el.batchCompareStrip.replaceChildren(...group.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "batch-thumb";
      button.classList.toggle("is-active", Boolean(state.current && item.url === state.current.url));
      button.title = `第 ${item.batchIndex}/${item.batchTotal} 张 · seed ${item.seed ?? "—"}`;
      button.setAttribute("aria-label", `查看本批第 ${item.batchIndex} 张`);
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = `本批第 ${item.batchIndex} 张`;
      img.loading = "lazy";
      button.appendChild(img);
      button.addEventListener("click", () => showResult(item));
      return button;
    }));
  }

  function addHistory(items) {
    if (!items.length) return;
    // 同一批共享 batchId，供画布下方的「本批对比」按顺序取图；只存在内存，不落盘。
    if (items.length > 1) {
      const batchId = `b${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      items.forEach((item) => { item.batchId = batchId; });
    }
    state.history.unshift(...items);
    while (state.history.length > MAX_HISTORY) {
      const old = state.history.pop();
      if (old && old.url !== state.current?.url) URL.revokeObjectURL(old.url);
    }
    renderHistory();
  }

  function clearHistory() {
    mdui.confirm({
      headline: "清空最近作品？",
      description: "会清掉最近作品列表和跨会话历史索引；磁盘上的图片不会被删除，仍可在作品库里找到。",
      confirmText: "清空",
      cancelText: "取消",
      onConfirm: () => {
        for (const item of state.history) {
          if (item.url !== state.current?.url) URL.revokeObjectURL(item.url);
        }
        if (state.current?.url) URL.revokeObjectURL(state.current.url);
        state.history = [];
        state.current = null;
        el.result.removeAttribute("src");
        el.canvasFrame.hidden = true;
        el.placeholder.hidden = false;
        el.resultInfo.hidden = true;
        el.metaChips.innerHTML = "";
        updateFavoriteButton();
        if (el.lightboxDialog.open) el.lightboxDialog.open = false;
        renderHistory();
        fetch("/local/history/clear", { method: "POST" }).catch(() => {});
        snack("最近作品已清空");
      }
    }).catch(() => {});
  }

  /* ---------------------------------------------------------------- gallery */
  function galleryFileUrl(item, download = false) {
    const path = typeof item === "string" ? item : item.path;
    return `/local/gallery/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
  }

  function galleryThumbUrl(item) {
    return `/local/gallery/thumb?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;
  }

  function galleryTime(ts) {
    const date = new Date(ts * 1000);
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const prefix = date.getFullYear() === now.getFullYear() ? "" : date.getFullYear() + "-";
    return `${prefix}${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateGalleryCount() {
    if (galleryState.filter === "favorite") {
      el.galleryCount.textContent = `收藏 ${galleryState.total} 张`;
    } else {
      el.galleryCount.textContent = `共 ${galleryState.total} 张 · 收藏 ${galleryState.favoriteTotal}`;
    }
  }

  function setGalleryStatus(text, bad = false) {
    el.galleryStatus.hidden = !text;
    el.galleryStatus.classList.toggle("is-bad", Boolean(text) && bad);
    el.galleryStatus.textContent = text || "";
  }

  function galleryEmptyCopy() {
    if (galleryState.filter === "favorite") {
      return ["还没有收藏", "在作品右上角点星标，收藏会移入收藏文件夹；右上角文件夹按钮可直接打开。"];
    }
    if (galleryState.filter === "txt2img") {
      return ["还没有文生图作品", "生成第一张画面后，作品会自动出现在这里。"];
    }
    if (galleryState.filter === "img2img") {
      return ["还没有图生图作品", "选一张参考图重绘后，结果会自动出现在这里。"];
    }
    return ["还没有作品", "生成第一张画面后，作品会自动出现在这里。"];
  }

  function renderGallery() {
    const scrollTop = el.galleryGrid.scrollTop;
    el.galleryGrid.innerHTML = "";
    galleryState.items.forEach((item) => {
      el.galleryGrid.appendChild(buildGalleryCard(item));
    });
    const empty = galleryState.items.length === 0;
    el.galleryEmpty.hidden = !empty;
    if (empty) {
      const [title, hint] = galleryEmptyCopy();
      el.galleryEmptyTitle.textContent = title;
      el.galleryEmptyHint.textContent = hint;
    }
    el.galleryMoreWrap.hidden = !galleryState.hasMore;
    updateGalleryCount();
    updateGallerySelectionUI();
    el.galleryGrid.scrollTop = scrollTop;
  }

  function buildGalleryCard(item) {
    const card = document.createElement("article");
    card.className = "gallery-card";
    card.dataset.path = item.path;
    card.classList.toggle("is-selected", galleryState.selected.has(item.path));

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "gallery-thumb-wrap";

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "gallery-thumb";
    thumb.title = galleryState.selecting ? "选择这张作品" : "查看大图";
    thumb.setAttribute("aria-label", galleryState.selecting ? `选择 ${item.name}` : `查看 ${item.name} 大图`);
    const img = document.createElement("img");
    img.src = galleryThumbUrl(item);
    img.alt = item.mode === "img2img" ? "图生图作品" : "文生图作品";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      img.style.opacity = ".22";
      img.alt = "缩略图读取失败";
    });
    thumb.appendChild(img);
    thumb.addEventListener("click", () => {
      if (galleryState.selecting) toggleGallerySelection(item);
      else openGalleryPreview(item);
    });

    const mode = document.createElement("span");
    mode.className = "gallery-mode";
    mode.textContent = item.mode === "img2img" ? "图生图" : "文生图";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "gallery-fav" + (item.favorite ? " is-on" : "");
    fav.title = item.favorite ? "取消收藏" : "收藏";
    fav.setAttribute("aria-label", fav.title);
    fav.setAttribute("aria-pressed", item.favorite ? "true" : "false");
    fav.innerHTML = icon(item.favorite ? "starFilled" : "star", 16);
    fav.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGalleryFavorite(item, fav);
    });

    const check = document.createElement("span");
    check.className = "gallery-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = icon("check", 15);

    thumbWrap.append(thumb, mode, fav, check);

    const info = document.createElement("div");
    info.className = "gallery-info";
    const time = document.createElement("span");
    time.textContent = galleryTime(item.mtime);
    const seed = document.createElement("span");
    seed.className = "gallery-seed";
    seed.textContent = item.seed ? `seed ${item.seed}` : item.name;
    info.append(time, seed);

    const actions = document.createElement("div");
    actions.className = "gallery-actions";
    const action = (label, iconName, handler, danger = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-action" + (danger ? " is-danger" : "");
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = icon(iconName, 16);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
      });
      return button;
    };
    actions.append(
      action("查看参数", "sliders", () => openGalleryInfo(item)),
      action("送去图生图", "send", () => sendGalleryToImg2img(item)),
      action("导出原图", "download", () => exportGalleryItem(item)),
      action("删除作品", "trash", () => deleteGalleryItem(item), true)
    );

    card.append(thumbWrap, info, actions);
    return card;
  }

  /* ------------------------------------------------------ gallery selection */
  function selectedGalleryItems() {
    return galleryState.items.filter((item) => galleryState.selected.has(item.path));
  }

  function updateGallerySelectionUI() {
    if (!el.gallerySelectBar) return;
    const count = galleryState.selected.size;
    const pageSelected = galleryState.items.filter((item) => galleryState.selected.has(item.path)).length;
    const pageAll = galleryState.items.length > 0 && pageSelected === galleryState.items.length;
    el.gallerySelectCount.textContent = `已选 ${count} 张`;
    el.galleryBatchCount.textContent = `已选 ${count} 张`;
    el.gallerySelectAll.textContent = pageAll ? "取消本页" : "全选本页";
    el.gallerySelectAll.disabled = galleryState.items.length === 0 || galleryState.batchBusy;
    el.gallerySelectClear.disabled = count === 0 || galleryState.batchBusy;
    el.gallerySelectDone.disabled = galleryState.batchBusy;
    const busy = galleryState.batchBusy;
    const any = count > 0 && !busy;
    el.galleryBatchFavorite.disabled = !any;
    el.galleryBatchExport.disabled = !any;
    el.galleryBatchDelete.disabled = !any;
    el.galleryBatchSend.disabled = count !== 1 || busy;
    const selectedItems = selectedGalleryItems();
    const allFavorite = selectedItems.length > 0 && selectedItems.every((item) => item.favorite);
    el.galleryBatchFavoriteLabel.textContent = allFavorite ? "取消收藏" : "收藏";
    el.galleryBatchFavorite.dataset.favorite = allFavorite ? "0" : "1";
    const favIcon = el.galleryBatchFavorite.querySelector(".icon");
    if (favIcon) favIcon.innerHTML = icon(allFavorite ? "starFilled" : "star", 16);
    $$(".gallery-card", el.galleryGrid).forEach((card) => {
      card.classList.toggle("is-selected", galleryState.selected.has(card.dataset.path));
      const thumb = card.querySelector(".gallery-thumb");
      if (thumb) {
        thumb.title = galleryState.selecting ? "选择这张作品" : "查看大图";
        thumb.setAttribute("aria-label", galleryState.selecting ? "选择这张作品" : "查看大图");
      }
    });
    el.gallerySelect.classList.toggle("is-on", galleryState.selecting);
    el.gallerySelect.title = galleryState.selecting ? "退出多选" : "多选";
    el.gallerySelect.setAttribute("aria-label", el.gallerySelect.title);
    el.gallerySelect.setAttribute("aria-pressed", galleryState.selecting ? "true" : "false");
  }

  function setGallerySelecting(on) {
    const next = Boolean(on);
    galleryState.selecting = next;
    if (!next) galleryState.selected.clear();
    el.galleryDialog.classList.toggle("is-selecting", next);
    el.gallerySelectBar.hidden = !next;
    el.galleryBatchBar.hidden = !next;
    updateGallerySelectionUI();
  }

  function toggleGallerySelection(item) {
    if (!galleryState.selecting) return;
    if (galleryState.selected.has(item.path)) {
      galleryState.selected.delete(item.path);
    } else {
      if (galleryState.selected.size >= GALLERY_SELECT_MAX) {
        snack(`一次最多选 ${GALLERY_SELECT_MAX} 张`, { bad: true });
        return;
      }
      galleryState.selected.add(item.path);
    }
    updateGallerySelectionUI();
  }

  function toggleGallerySelectAllPage() {
    if (galleryState.batchBusy) return;
    const page = galleryState.items;
    if (!page.length) return;
    const all = page.every((item) => galleryState.selected.has(item.path));
    if (all) {
      page.forEach((item) => galleryState.selected.delete(item.path));
    } else {
      for (const item of page) {
        if (galleryState.selected.size >= GALLERY_SELECT_MAX) break;
        galleryState.selected.add(item.path);
      }
      if (page.some((item) => !galleryState.selected.has(item.path))) {
        snack(`一次最多选 ${GALLERY_SELECT_MAX} 张，已选满`, { bad: true });
      }
    }
    updateGallerySelectionUI();
  }

  function setGalleryBatchBusy(busy) {
    galleryState.batchBusy = Boolean(busy);
    el.galleryBatchBar.classList.toggle("is-busy", galleryState.batchBusy);
    el.galleryBatchBar.setAttribute("aria-busy", galleryState.batchBusy ? "true" : "false");
    updateGallerySelectionUI();
  }

  let galleryLoadPromise = null;
  const LIGHTBOX_ZOOM_MAX = 6;
  const lightboxView = { zoom: 1, x: 0, y: 0 };

  function loadGallery({ reset = false } = {}) {
    // 同一时刻只允许一个请求；后来者拿到的就是正在跑的那个 Promise，
    // 这样大图预览翻到列表末尾时能真正等到新一页落地再继续。
    if (galleryState.loading && !reset) {
      return galleryLoadPromise || Promise.resolve();
    }
    const promise = loadGalleryPage({ reset });
    galleryLoadPromise = promise;
    const clear = () => {
      if (galleryLoadPromise === promise) galleryLoadPromise = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  async function loadGalleryPage({ reset = false } = {}) {
    const requestId = ++galleryState.requestId;
    if (reset) {
      galleryState.offset = 0;
      galleryState.fetched = 0;
      galleryState.total = 0;
      galleryState.hasMore = false;
      galleryState.items = [];
      galleryState.selected.clear();
      el.galleryGrid.innerHTML = "";
      el.galleryEmpty.hidden = true;
      el.galleryMoreWrap.hidden = true;
      el.galleryCount.textContent = "读取中…";
    }
    galleryState.loading = true;
    setGalleryStatus("正在读取本机作品…");
    const params = new URLSearchParams({
      offset: String(reset ? 0 : galleryState.offset),
      limit: String(galleryState.limit)
    });
    if (galleryState.filter === "favorite") params.set("favorite", "1");
    else if (galleryState.filter !== "all") params.set("mode", galleryState.filter);
    try {
      const res = await fetch("/local/gallery?" + params.toString(), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (requestId !== galleryState.requestId) return;
      const raw = Array.isArray(data.items) ? data.items : [];
      // 生成中翻页时新图会插到最前，按 offset 分页会重叠；按路径去重，
      // 游标用服务端真实条数，避免重复卡片和翻页“原地踏步”。
      const seen = new Set(reset ? [] : galleryState.items.map((entry) => entry.path));
      const items = raw.filter((entry) => {
        if (!entry?.path || seen.has(entry.path)) return false;
        seen.add(entry.path);
        return true;
      });
      galleryState.items = reset ? items : galleryState.items.concat(items);
      galleryState.fetched = (reset ? 0 : galleryState.fetched) + raw.length;
      galleryState.offset = galleryState.fetched;
      galleryState.total = Number(data.total) || 0;
      galleryState.favoriteTotal = Number(data.counts?.favorite) || 0;
      galleryState.hasMore = Boolean(data.has_more);
      setGalleryStatus("");
      renderGallery();
      if (el.lightboxDialog.open) updateLightboxNav();
      if (data.root_exists === false) {
        setGalleryStatus("输出目录还不存在，先在右侧生成一张画面。", true);
      }
    } catch (err) {
      if (requestId !== galleryState.requestId) return;
      setGalleryStatus("读取作品库失败：" + (err?.message || "未知错误"), true);
    } finally {
      if (requestId === galleryState.requestId) galleryState.loading = false;
    }
  }

  function openGallery() {
    dismissSnacks();
    setGallerySelecting(false);
    galleryState.filter = el.galleryFilter.value || "all";
    refreshGalleryFolderButton();
    el.galleryDialog.fullscreen = window.innerWidth <= 900;
    el.galleryDialog.open = true;
    loadGallery({ reset: true });
  }

  function openGalleryPreview(item) {
    dismissSnacks();
    state.lightboxNavBusy = false;
    showLightboxItem(item);
    el.lightboxDialog.open = true;
  }

  function lightboxIndex() {
    if (!state.lightboxItem) return -1;
    return galleryState.items.findIndex((entry) => entry.path === state.lightboxItem.path);
  }

  function preloadLightboxNeighbors(index) {
    if (index < 0) return;
    for (const offset of [-1, 1]) {
      const item = galleryState.items[index + offset];
      if (!item) continue;
      const img = new Image();
      img.src = galleryFileUrl(item);
    }
  }

  function lightboxTarget() {
    return state.lightboxItem || state.current || null;
  }

  function updateLightboxActions() {
    const item = lightboxTarget();
    el.lightboxHeadActions.hidden = !item;
    if (!item) return;
    const on = Boolean(item.favorite);
    el.lightboxFavorite.classList.toggle("is-on", on);
    el.lightboxFavorite.setAttribute("aria-pressed", on ? "true" : "false");
    el.lightboxFavorite.title = on ? "取消收藏" : "收藏";
    el.lightboxFavorite.setAttribute("aria-label", el.lightboxFavorite.title);
    el.lightboxFavoriteIcon.innerHTML = icon(on ? "starFilled" : "star", 17);
    el.lightboxFavorite.disabled = Boolean(item.favoritePending);
    const fromGallery = Boolean(state.lightboxItem);
    el.lightboxSend.title = fromGallery ? "送去图生图" : "送去重绘";
    el.lightboxSend.setAttribute("aria-label", el.lightboxSend.title);
    el.lightboxDelete.title = fromGallery ? "删除作品" : "删除磁盘文件";
    el.lightboxDelete.setAttribute("aria-label", el.lightboxDelete.title);
  }

  function clampLightboxPan() {
    const img = el.lightboxImg;
    const maxX = Math.max(0, (img.clientWidth * (lightboxView.zoom - 1)) / 2);
    const maxY = Math.max(0, (img.clientHeight * (lightboxView.zoom - 1)) / 2);
    lightboxView.x = Math.min(maxX, Math.max(-maxX, lightboxView.x));
    lightboxView.y = Math.min(maxY, Math.max(-maxY, lightboxView.y));
  }

  function applyLightboxView() {
    const { zoom, x, y } = lightboxView;
    const active = zoom > 1.001;
    el.lightboxImg.style.transform = active
      ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${zoom.toFixed(3)})`
      : "";
    el.lightboxBody.classList.toggle("is-zoomed", active);
    el.lightboxZoom.hidden = !active;
    if (active) el.lightboxZoom.textContent = `${Math.round(zoom * 100)}%`;
  }

  function resetLightboxView() {
    lightboxView.zoom = 1;
    lightboxView.x = 0;
    lightboxView.y = 0;
    applyLightboxView();
  }

  function zoomLightboxAt(nextZoom, clientX, clientY) {
    if (!el.lightboxImg.getAttribute("src")) return;
    const previous = lightboxView.zoom;
    const zoom = Math.min(LIGHTBOX_ZOOM_MAX, Math.max(1, nextZoom));
    if (Math.abs(zoom - previous) < 0.001) return;
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const rect = el.lightboxImg.getBoundingClientRect();
      const px = clientX - (rect.left + rect.width / 2);
      const py = clientY - (rect.top + rect.height / 2);
      const ratio = zoom / previous;
      lightboxView.x = px - (px - lightboxView.x) * ratio;
      lightboxView.y = py - (py - lightboxView.y) * ratio;
    }
    lightboxView.zoom = zoom;
    if (zoom === 1) {
      lightboxView.x = 0;
      lightboxView.y = 0;
    }
    clampLightboxPan();
    applyLightboxView();
  }

  function updateLightboxNav() {
    const index = lightboxIndex();
    // 列表刷新后指向新的条目对象，收藏等状态才不会停留在旧数据上。
    if (index >= 0) state.lightboxItem = galleryState.items[index];
    updateLightboxActions();
    const count = galleryState.items.length;
    const navigable = index >= 0 && count > 1;
    el.lightboxPrev.hidden = !navigable;
    el.lightboxNext.hidden = !navigable;
    el.lightboxCounter.hidden = !navigable;
    if (!navigable) return;
    const total = galleryState.total > count ? galleryState.total : count;
    el.lightboxCounter.textContent = `${index + 1} / ${total}`;
    el.lightboxPrev.disabled = index <= 0;
    el.lightboxNext.disabled = index >= count - 1 && !galleryState.hasMore;
  }

  function showLightboxItem(item) {
    if (!item) return;
    state.lightboxItem = item;
    el.lightboxImg.src = galleryFileUrl(item);
    resetLightboxView();
    updateLightboxNav();
    preloadLightboxNeighbors(lightboxIndex());
  }

  async function stepLightbox(delta) {
    if (!el.lightboxDialog.open || state.lightboxNavBusy) return;
    state.lightboxNavBusy = true;
    try {
      let index = lightboxIndex();
      if (index < 0) return;
      let target = index + delta;
      // 翻到当前已加载列表的末尾时，先把下一页拉回来再接上，避免卡在 48 张边界。
      let attempts = 0;
      while (target >= galleryState.items.length && galleryState.hasMore && attempts < 4) {
        await loadGallery();
        attempts += 1;
        index = lightboxIndex();
        if (index < 0) return;
        target = index + delta;
      }
      if (target < 0 || target >= galleryState.items.length) {
        updateLightboxNav();
        return;
      }
      showLightboxItem(galleryState.items[target]);
    } finally {
      state.lightboxNavBusy = false;
    }
  }

  const GALLERY_META_LABELS = {
    Model: "模型",
    "Model hash": "模型哈希",
    VAE: "VAE",
    "VAE hash": "VAE 哈希",
    Size: "生成尺寸",
    Steps: "步数",
    Sampler: "采样器",
    "Schedule type": "调度器",
    "CFG scale": "CFG",
    Seed: "种子",
    RNG: "随机源",
    "Denoising strength": "重绘幅度",
    "Hires upscale": "Hires 倍率",
    "Hires upscaler": "Hires 算法",
    "Hires steps": "Hires 步数",
    "Hires CFG Scale": "Hires CFG",
    "Hires Module 1": "Hires 模块",
    "Clip skip": "CLIP 跳过层",
    "VAE/TE": "VAE / 模块",
    "Lora hashes": "LoRA",
    Version: "Forge 版本"
  };
  const GALLERY_META_ORDER = [
    "Model", "Size", "Steps", "Sampler", "Schedule type", "CFG scale", "Seed",
    "RNG", "Denoising strength", "Hires upscale", "Hires upscaler", "Hires steps",
    "Hires CFG Scale", "Hires Module 1", "Clip skip", "VAE", "VAE hash", "VAE/TE",
    "Lora hashes", "Model hash", "Version"
  ];

  function selectHasOption(select, value) {
    return $$("mdui-menu-item", select).some(
      (item) => (item.value || item.getAttribute("value") || "") === value
    );
  }

  function renderGalleryInfo(data) {
    const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    const prompt = String(data.prompt || "").trim();
    const negative = String(data.negative || "").trim();
    el.galleryInfoPrompt.textContent = prompt;
    el.galleryInfoPromptSection.hidden = !prompt;
    el.galleryInfoNegative.textContent = negative;
    el.galleryInfoNegativeSection.hidden = !negative;
    el.galleryInfoMeta.replaceChildren();
    const seen = new Set();
    const addMeta = (key, label, value) => {
      const text = String(value ?? "").trim();
      if (!text) return;
      const row = document.createElement("div");
      row.className = "gallery-meta-item";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = text;
      row.append(dt, dd);
      el.galleryInfoMeta.appendChild(row);
      seen.add(key);
    };
    if (data.width && data.height) addMeta("__dims__", "文件尺寸", `${data.width}×${data.height}`);
    for (const key of GALLERY_META_ORDER) {
      if (Object.prototype.hasOwnProperty.call(meta, key)) {
        addMeta(key, GALLERY_META_LABELS[key] || key, meta[key]);
      }
    }
    for (const [key, value] of Object.entries(meta)) {
      if (!seen.has(key)) addMeta(key, GALLERY_META_LABELS[key] || key, value);
    }
    el.galleryInfoMetaSection.hidden = el.galleryInfoMeta.children.length === 0;
    el.galleryInfoMetaHint.textContent = el.galleryInfoMeta.children.length
      ? `共 ${el.galleryInfoMeta.children.length} 项`
      : "";
    const item = state.galleryInfoItem;
    if (item) el.galleryInfoDesc.textContent = `${item.name} · ${galleryTime(item.mtime)}`;
    if (!prompt && !el.galleryInfoMeta.children.length) {
      el.galleryInfoStatus.hidden = false;
      el.galleryInfoStatus.classList.remove("is-bad");
      el.galleryInfoStatus.textContent = "这张图没有内嵌生成参数（可能不是 Forge 生成或元数据已被清除）。";
      el.galleryInfoLoad.disabled = true;
    } else {
      el.galleryInfoStatus.hidden = true;
      el.galleryInfoLoad.disabled = false;
    }
  }

  function openGalleryInfo(item) {
    if (!item) return;
    dismissSnacks();
    state.galleryInfoItem = item;
    state.galleryInfoData = null;
    const seq = ++state.galleryInfoSeq;
    el.galleryInfoDesc.textContent = item.name;
    el.galleryInfoStatus.hidden = false;
    el.galleryInfoStatus.classList.remove("is-bad");
    el.galleryInfoStatus.textContent = "正在读取 PNG 生成参数…";
    el.galleryInfoPrompt.textContent = "";
    el.galleryInfoNegative.textContent = "";
    el.galleryInfoPromptSection.hidden = true;
    el.galleryInfoNegativeSection.hidden = true;
    el.galleryInfoMetaSection.hidden = true;
    el.galleryInfoMeta.replaceChildren();
    el.galleryInfoMetaHint.textContent = "";
    el.galleryInfoLoad.disabled = true;
    el.galleryInfoDialog.fullscreen = window.innerWidth <= 720;
    el.galleryInfoDialog.open = true;
    fetch("/local/gallery/info?path=" + encodeURIComponent(item.path), { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (seq !== state.galleryInfoSeq) return;
        state.galleryInfoData = data;
        renderGalleryInfo(data);
      })
      .catch((err) => {
        if (seq !== state.galleryInfoSeq) return;
        el.galleryInfoStatus.hidden = false;
        el.galleryInfoStatus.classList.add("is-bad");
        el.galleryInfoStatus.textContent = "读取参数失败：" + (err?.message || "未知错误");
      });
  }

  async function copyGalleryInfoField(field) {
    const data = state.galleryInfoData;
    const text = field === "negative" ? data?.negative : data?.prompt;
    if (!text) {
      snack("没有可复制的内容", { bad: true });
      return;
    }
    const ok = await copyText(text);
    snack(ok ? "已复制" : "复制失败", { bad: !ok });
  }

  async function loadGalleryInfoParams() {
    const data = state.galleryInfoData;
    if (!data) return;
    const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    const base = currentConfig();
    const toInt = (value, fallback) => {
      const number = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
      return Number.isFinite(number) ? number : fallback;
    };
    const toFloat = (value, fallback) => {
      const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
      return Number.isFinite(number) ? number : fallback;
    };
    let width = base.width;
    let height = base.height;
    const sizeMatch = String(meta.Size || "").match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (sizeMatch) {
      width = clamp(round8(toInt(sizeMatch[1], width)), 512, 1536);
      height = clamp(round8(toInt(sizeMatch[2], height)), 512, 1536);
    }
    const sampler = selectHasOption(el.sampler, meta.Sampler) ? meta.Sampler : base.sampler;
    const scheduler = selectHasOption(el.scheduler, meta["Schedule type"])
      ? meta["Schedule type"]
      : base.scheduler;
    const steps = clamp(toInt(meta.Steps, base.steps), 6, 40);
    const cfg = clamp(toFloat(meta["CFG scale"], base.cfg), 1, 10);
    const clipSkip = clamp(toInt(meta["Clip skip"], base.clipSkip), 1, 4);
    const seed = toInt(meta.Seed, null);
    const hiresScale = toFloat(meta["Hires upscale"], 0);
    const hires = hiresScale > 1;
    // Forge 的图生图参数只写 Denoising strength，不写 Hires upscale。
    // 之前把它当成 Hires 二采幅度丢掉，导致「载入参数」后重绘幅度永远是当前值。
    const denoiseMeta = toFloat(meta["Denoising strength"], NaN);
    const img2imgParams = Number.isFinite(denoiseMeta) && !hires;
    const img2imgDenoise = img2imgParams ? clamp(denoiseMeta, 0.1, 0.9) : base.img2imgDenoise;
    const restoredMode = img2imgParams ? "img2img" : base.mode;
    const hrScale = hiresScale >= 1.5 ? 1.5 : 1.25;
    const hrUpscalerMeta = String(meta["Hires upscaler"] || "").trim();
    const hrUpscaler = hrUpscalerMeta && selectHasOption(el.hrUpscaler, hrUpscalerMeta)
      ? hrUpscalerMeta
      : (hrUpscalerMeta ? DEFAULT_UPSCALER : base.hrUpscaler);
    const vaeMeta = String(meta.VAE || "").trim();
    const vaeMatch = vaeMeta
      ? state.vaeOptions.find((item) => item.value === vaeMeta || item.label === vaeMeta)
      : null;
    const vae = vaeMatch ? vaeMatch.value : (vaeMeta && !/^automatic$/i.test(vaeMeta) ? VAE_AUTO : base.vae);
    const hrDenoise = img2imgParams
      ? base.hrDenoise
      : clamp(toFloat(meta["Denoising strength"], base.hrDenoise), 0.2, 0.6);
    const modelName = String(meta.Model || "").trim();
    const needsSwitch = Boolean(modelName && !activeModelMatches(modelName));
    let modelOk = true;
    let switched = false;
    if (needsSwitch && state.online) {
      if (!state.modelsLoaded) await loadModels({ silent: true });
      const target = state.models.find(
        (model) => normalizeModelName(model.value).toLowerCase() === normalizeModelName(modelName).toLowerCase()
      );
      if (target) {
        modelOk = await switchModel(target.value, { preserveSettings: true, silent: true });
        switched = modelOk;
      } else {
        modelOk = false;
      }
    }
    applyConfig({
      ...base,
      prompt: data.prompt || base.prompt,
      negative: data.negative ? data.negative : base.negative,
      width,
      height,
      ratioKey: "custom",
      quality: "",
      steps,
      cfg,
      sampler,
      scheduler,
      clipSkip,
      vae,
      seed: seed === null ? base.seed : seed,
      seedLocked: seed === null ? base.seedLocked : true,
      hires,
      hrScale,
      hrUpscaler,
      hrDenoise,
      img2imgDenoise,
      batch: base.batch,
      mode: restoredMode,
      model: state.activeModel,
      loras: parseLorasFromPrompt(data.prompt || base.prompt)
    });
    refreshStyleChips();
    el.galleryInfoDialog.open = false;
    el.lightboxDialog.open = false;
    el.galleryDialog.open = false;
    if (isMobileLayout()) setMobileView("prompt", { scroll: true, top: 0 });
    setTimeout(() => el.prompt.scrollIntoView({ behavior: "smooth", block: "center" }), 220);
    const notes = [];
    if (data.prompt) notes.push("提示词");
    if (seed !== null) notes.push("种子已锁定");
    if (img2imgParams) notes.push(state.initImage ? "图生图参数" : "图生图 · 参考图需重选");
    if (hires) notes.push(`Hires ${hrScale}×`);
    if (vaeMeta && !vaeMatch) notes.push("VAE 未安装");
    if (hrUpscalerMeta && hrUpscaler !== hrUpscalerMeta) notes.push("放大算法已回退");
    if (needsSwitch && !switched) notes.push("模型未切换");
    snack(`已载入${notes.length ? " · " + notes.join(" · ") : ""}`, {
      bad: Boolean(needsSwitch && state.online && !modelOk)
    });
  }

  async function toggleGalleryFavorite(item, button) {
    if (button.disabled) return;
    const next = !item.favorite;
    button.disabled = true;
    try {
      const res = await fetch("/local/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, favorite: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      item.favorite = next;
      const movedPath = typeof data.path === "string" ? data.path : "";
      if (movedPath && movedPath !== item.path) {
        item.path = movedPath;
        item.name = movedPath.split("/").pop() || item.name;
        const card = button.closest(".gallery-card");
        if (card) {
          card.dataset.path = item.path;
          const img = card.querySelector(".gallery-thumb img");
          if (img) img.src = galleryThumbUrl(item);
          const stem = item.name.replace(/\.[^.]+$/, "");
          const tail = stem.split("-").pop() || "";
          item.seed = /^\d+$/.test(tail) ? tail : "";
          const seed = card.querySelector(".gallery-seed");
          if (seed) seed.textContent = item.seed ? `seed ${item.seed}` : item.name;
        }
      }
      button.classList.toggle("is-on", next);
      button.innerHTML = icon(next ? "starFilled" : "star", 16);
      button.title = next ? "取消收藏" : "收藏";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", next ? "true" : "false");
      galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal + (next ? 1 : -1));
      if (!next && galleryState.filter === "favorite") {
        await loadGallery({ reset: true });
      } else {
        updateGalleryCount();
      }
      snack(next ? "已收藏 · 已移入收藏文件夹" : (data.moved ? "已取消收藏 · 已移回原目录" : "已取消收藏"));
    } catch (err) {
      snack("收藏失败：" + (err?.message || "未知错误"), { bad: true });
    } finally {
      button.disabled = false;
    }
  }

  function syncGalleryCard(previousPath, item) {
    const card = $$(".gallery-card", el.galleryGrid).find((node) => node.dataset.path === previousPath);
    if (!card) return;
    card.dataset.path = item.path;
    const img = card.querySelector(".gallery-thumb img");
    if (img) img.src = galleryThumbUrl(item);
    const seed = card.querySelector(".gallery-seed");
    if (seed) seed.textContent = item.seed ? `seed ${item.seed}` : item.name;
    const fav = card.querySelector(".gallery-fav");
    if (fav) {
      fav.classList.toggle("is-on", Boolean(item.favorite));
      fav.innerHTML = icon(item.favorite ? "starFilled" : "star", 16);
      fav.title = item.favorite ? "取消收藏" : "收藏";
      fav.setAttribute("aria-label", fav.title);
      fav.setAttribute("aria-pressed", item.favorite ? "true" : "false");
    }
  }

  async function toggleGalleryFavoriteFromLightbox(item) {
    if (item.favoritePending) return;
    const next = !item.favorite;
    const previousPath = item.path;
    item.favoritePending = true;
    updateLightboxActions();
    try {
      const res = await fetch("/local/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, favorite: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      item.favorite = next;
      const movedPath = typeof data.path === "string" ? data.path : "";
      if (movedPath && movedPath !== item.path) {
        item.path = movedPath;
        item.name = movedPath.split("/").pop() || item.name;
        const stem = item.name.replace(/\.[^.]+$/, "");
        const tail = stem.split("-").pop() || "";
        item.seed = /^\d+$/.test(tail) ? tail : "";
        if (state.lightboxItem === item) el.lightboxImg.src = galleryFileUrl(item);
        syncGalleryCard(previousPath, item);
      }
      galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal + (next ? 1 : -1));
      updateGalleryCount();
      if (!next && galleryState.filter === "favorite") {
        const index = lightboxIndex();
        await loadGallery({ reset: true });
        if (el.lightboxDialog.open) {
          if (!galleryState.items.length) {
            el.lightboxDialog.open = false;
            state.lightboxItem = null;
          } else {
            showLightboxItem(galleryState.items[Math.min(Math.max(index, 0), galleryState.items.length - 1)]);
          }
        }
      }
      snack(next ? "已收藏 · 已移入收藏文件夹" : (data.moved ? "已取消收藏 · 已移回原目录" : "已取消收藏"));
    } catch (err) {
      snack("收藏失败：" + (err?.message || "未知错误"), { bad: true });
    } finally {
      item.favoritePending = false;
      updateLightboxActions();
    }
  }

  async function toggleLightboxFavorite() {
    if (state.lightboxItem) {
      await toggleGalleryFavoriteFromLightbox(state.lightboxItem);
      return;
    }
    if (!state.current) return;
    const task = toggleCurrentFavorite();
    updateLightboxActions();
    await task;
    updateLightboxActions();
  }

  function sendLightboxToImg2img() {
    if (state.lightboxItem) {
      const item = state.lightboxItem;
      el.lightboxDialog.open = false;
      state.lightboxItem = null;
      sendGalleryToImg2img(item);
      return;
    }
    if (!state.current) return;
    el.lightboxDialog.open = false;
    sendCurrentToImg2img();
  }

  function deleteResultLightboxItem(item) {
    mdui.confirm({
      headline: "删除这张作品？",
      description: "会从磁盘删除当前画面的文件，无法恢复。",
      confirmText: "删除",
      cancelText: "取消",
      onConfirm: async () => {
        try {
          const target = await ensureResultGalleryPath(item);
          if (!target) throw new Error("这张还没落到磁盘，稍后再试");
          const res = await fetch("/local/gallery/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: target })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
          const card = $$(".gallery-card", el.galleryGrid).find((node) => node.dataset.path === target);
          if (card) card.remove();
          galleryState.items = galleryState.items.filter((entry) => entry.path !== target);
          galleryState.total = Math.max(0, galleryState.total - 1);
          if (item.favorite) {
            item.favorite = false;
            galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal - 1);
          }
          item.galleryPath = "";
          item.galleryName = "";
          updateGalleryCount();
          updateFavoriteButton();
          el.lightboxDialog.open = false;
          snack("已删除磁盘作品，画布预览会保留到本次会话结束");
        } catch (err) {
          snack("删除失败：" + (err?.message || "未知错误"), { bad: true });
        }
      }
    }).catch(() => {});
  }

  function exportGalleryItem(item) {
    const a = document.createElement("a");
    a.href = galleryFileUrl(item, true);
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    snack("已开始导出 " + item.name);
  }

  /* --------------------------------------------------------- upscale bench */
  // 独立后处理：原图走服务端 /local/postprocess。算法是插值时本地 PIL 处理，
  // 选中了超分模型就转去 ComfyUI 跑 UpscaleModelLoader（真正补细节）。
  let upscaleSeq = 0;
  let upscalePending = false;
  function upscaleSettings() {
    // 优先读控件当前值（重建按钮后我们自己写过 value，比内存变量更跟手）。
    const upscaler = String(el.upscaleAlgo?.value || upscaleAlgoValue || "Lanczos");
    const native = upscaleNativeScale(upscaler);
    return {
      // 超分模型一律按原生倍数出图，这里传原生倍数；插值兜底时才用用户选的倍数。
      scale: native || Number(el.upscaleScale.value) || 2,
      upscaler
    };
  }

  function upscaleSettingsKey() {
    const { scale, upscaler } = upscaleSettings();
    return `${scale}|${upscaler}`;
  }

  async function upscaleItemDataUrl(item) {
    if (!item?.url) throw new Error("没有可放大的图片");
    if (String(item.url).startsWith("data:")) return item.url;
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`读取原图失败 HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取原图失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function upscaleRequest(save) {
    const item = state.upscaleItem;
    if (!item) throw new Error("先选一张作品");
    const { scale, upscaler } = upscaleSettings();
    const body = { scale, upscaler, save: Boolean(save) };
    const path = item.path || item.galleryPath || "";
    if (path) {
      body.path = path;
    } else {
      body.image = await upscaleItemDataUrl(item);
    }
    const res = await fetch("/local/postprocess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  async function runUpscalePreview({ save = false } = {}) {
    if (!state.upscaleItem) return null;
    if (state.upscaleBusy) {
      // 预览进行中又改了倍数/算法：记下来，等当前请求结束再补一次，避免并发压引擎。
      if (!save) upscalePending = true;
      return null;
    }
    const seq = ++upscaleSeq;
    state.upscaleBusy = true;
    el.upscalePreviewBtn.loading = true;
    el.upscalePreviewBtn.disabled = true;
    el.upscaleSave.disabled = true;
    el.upscaleExport.disabled = true;
    el.upscaleMeta.classList.remove("is-bad");
    el.upscaleMeta.textContent = save ? "正在保存…" : "正在放大…";
    try {
      const data = await upscaleRequest(save);
      if (seq !== upscaleSeq) return null;
      state.upscalePreview = data.image || "";
      state.upscaleKey = upscaleSettingsKey();
      if (data.image) {
        el.upscaleImg.src = data.image;
        el.upscaleImg.hidden = false;
        el.upscaleEmpty.hidden = true;
      }
      // 超分模型出的是原生倍数，服务端返回的 scale 是"实际倍数"（按出图尺寸反推），
      // 所以这里直接用它，不再回显用户点的 1.5x/2x。
      const realScale = Number(data.scale) || 2;
      const scaleText = Math.abs(realScale - Math.round(realScale)) < 0.01
        ? `${Math.round(realScale)}x`
        : `${realScale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
      const label = data.native
        ? `${data.width}×${data.height} · 原生 ${scaleText} ${shortUpscaler(data.upscaler)} · ${(Number(data.elapsed) || 0).toFixed(2)} 秒`
        : `${data.width}×${data.height} · ${scaleText} ${data.upscaler || "Lanczos"} · ${(Number(data.elapsed) || 0).toFixed(2)} 秒`;
      // 大图预览是同尺寸 JPEG（只是换编码，像素没缩），保存/导出才是原始 PNG。
      const labelText = data.preview ? `${label} · 预览为 JPEG，尺寸不变` : label;
      if (save && data.path) {
        state.upscaleSavedPath = data.path;
        el.upscaleMeta.textContent = `${labelText} · 已保存`;
        snack("已保存到作品库");
        if (el.galleryDialog.open) loadGallery({ reset: true });
      } else {
        el.upscaleMeta.textContent = labelText;
      }
      return data;
    } catch (err) {
      if (seq !== upscaleSeq) return null;
      const prefix = save ? "保存失败：" : "放大失败：";
      el.upscaleMeta.classList.add("is-bad");
      el.upscaleMeta.textContent = prefix + (err?.message || "未知错误");
      if (!save && !state.upscalePreview) {
        el.upscaleEmpty.hidden = false;
        el.upscaleEmpty.textContent = "预览失败，可重试";
        el.upscaleImg.hidden = true;
      }
      snack(prefix + (err?.message || "未知错误"), { bad: true });
      return null;
    } finally {
      if (seq === upscaleSeq) {
        state.upscaleBusy = false;
        el.upscalePreviewBtn.loading = false;
        el.upscalePreviewBtn.disabled = false;
        el.upscaleSave.disabled = !state.upscalePreview;
        el.upscaleExport.disabled = !state.upscaleSavedPath;
        if (upscalePending) {
          upscalePending = false;
          setTimeout(() => runUpscalePreview(), 0);
        }
      }
    }
  }

  function openUpscale(item) {
    const target = item || state.lightboxItem || state.current;
    if (!target) {
      snack("先选一张作品再放大", { bad: true });
      return;
    }
    dismissSnacks();
    // 放大弹窗在 DOM 里靠前，叠在作品库/灯箱下面会被盖住；先收起其他弹窗再打开。
    if (el.galleryDialog.open) el.galleryDialog.open = false;
    if (el.galleryInfoDialog.open) el.galleryInfoDialog.open = false;
    if (el.lightboxDialog.open) el.lightboxDialog.open = false;
    state.upscaleItem = target;
    state.upscalePreview = "";
    state.upscaleSavedPath = "";
    state.upscaleKey = "";
    state.upscaleBusy = false;
    upscaleSeq += 1;
    el.upscaleImg.removeAttribute("src");
    el.upscaleImg.hidden = true;
    el.upscaleEmpty.hidden = false;
    el.upscaleEmpty.textContent = "正在准备原图…";
    el.upscaleMeta.classList.remove("is-bad");
    el.upscaleMeta.textContent = "正在生成预览…";
    el.upscaleSave.disabled = true;
    el.upscaleExport.disabled = true;
    el.upscalePreviewBtn.loading = false;
    el.upscalePreviewBtn.disabled = false;
    // 手机上让放大工作台占满视口，预览、倍数与操作按钮不用在小面板里互相挤。
    el.upscaleDialog.fullscreen = window.innerWidth <= 720;
    el.upscaleDialog.open = true;
    // 模型列表可能是打开弹窗之后才拉回来的，进来再校一次倍数行显隐。
    syncUpscaleScaleMode();
    // 不自动放大：改成「选算法 → 点开始放大 → 再保存」的确认式流程。
    // 打开就跑有两个毛病：算法还没挑就已经烧掉一次 4× 算力；大图要等十几秒，
    // 界面上只有一行「正在放大…」，看起来就是卡住了。
    prepareUpscaleIdle(target);
    // 冷启动就点放大时，超分模型列表可能还没回来：拉完再重置一次，别让用户
    // 误以为这台机器只有插值可用。
    if (!state.engineOptionsLoaded && !state.engineOptionsLoading) {
      loadEngineOptions({ silent: true }).then((ok) => {
        if (!ok || !el.upscaleDialog.open) return;
        renderUpscaleAlgoOptions();
      }).catch(() => {});
    }
  }

  // 放大弹窗的"待命"状态：预览区显示原图，保存/导出锁住，等用户按开始。
  function prepareUpscaleIdle(item) {
    const target = item || state.upscaleItem;
    state.upscalePreview = "";
    state.upscaleSavedPath = "";
    state.upscaleKey = "";
    el.upscaleSave.disabled = true;
    el.upscaleExport.disabled = true;
    el.upscalePreviewBtn.loading = false;
    el.upscalePreviewBtn.disabled = false;
    el.upscaleMeta.classList.remove("is-bad");
    el.upscaleMeta.textContent = target?.url
      ? "当前是原图 · 选好算法后点「开始放大」"
      : "选好算法后点「开始放大」";
    if (target?.url) {
      el.upscaleImg.src = target.url;
      el.upscaleImg.hidden = false;
      el.upscaleEmpty.hidden = true;
    } else {
      el.upscaleImg.removeAttribute("src");
      el.upscaleImg.hidden = true;
      el.upscaleEmpty.hidden = false;
      el.upscaleEmpty.textContent = "选好算法后点「开始放大」";
    }
  }

  async function saveUpscale() {
    if (state.upscaleBusy) return;
    await runUpscalePreview({ save: true });
  }

  async function exportUpscale() {
    if (state.upscaleBusy) return;
    let path = state.upscaleSavedPath;
    if (!path || state.upscaleKey !== upscaleSettingsKey()) {
      const data = await runUpscalePreview({ save: true });
      path = data?.path || "";
    }
    if (!path) return;
    const a = document.createElement("a");
    a.href = galleryFileUrl({ path }, true);
    a.download = String(path).split("/").pop() || "upscale.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    snack("已开始导出放大图");
  }

  function handleUpscaleSettingChange() {
    if (!el.upscaleDialog.open || !state.upscaleItem) return;
    // 换算法只把旧结果作废，不自动重跑——确认式流程里由用户决定什么时候算。
    prepareUpscaleIdle();
  }

  function openUpscaleFromLightbox() {
    const item = state.lightboxItem || state.current;
    if (!item) return;
    el.lightboxDialog.open = false;
    state.lightboxItem = null;
    openUpscale(item);
  }

  function openUpscaleFromInfo() {
    const item = state.galleryInfoItem;
    if (!item) return;
    el.galleryInfoDialog.open = false;
    el.lightboxDialog.open = false;
    state.lightboxItem = null;
    openUpscale(item);
  }


  /* -------------------------------------------------- gallery batch actions */
  async function batchToggleGalleryFavorite() {
    const items = selectedGalleryItems();
    if (!items.length || galleryState.batchBusy) return;
    const favorite = el.galleryBatchFavorite.dataset.favorite === "1";
    setGalleryBatchBusy(true);
    try {
      const res = await fetch("/local/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: items.map((item) => item.path), favorite })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const results = Array.isArray(data.results) ? data.results : [];
      const failed = results.filter((result) => !result.ok);
      let changed = 0;
      let delta = 0;
      for (const result of results) {
        if (!result.ok) continue;
        const previous = String(result.previous || result.path || "");
        const item = galleryState.items.find((entry) => entry.path === previous || entry.path === result.path);
        if (!item) continue;
        const wasFavorite = Boolean(item.favorite);
        if (favorite && !wasFavorite) delta += 1;
        if (!favorite && wasFavorite) delta -= 1;
        galleryState.selected.delete(previous);
        galleryState.selected.delete(item.path);
        item.path = String(result.path || item.path);
        item.name = item.path.split("/").pop() || item.name;
        item.favorite = favorite;
        const stem = item.name.replace(/\.[^.]+$/, "");
        const tail = stem.split("-").pop() || "";
        item.seed = /^\d+$/.test(tail) ? tail : "";
        galleryState.selected.add(item.path);
        syncGalleryCard(previous, item);
        changed += 1;
      }
      galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal + delta);
      const verb = favorite ? "收藏" : "取消收藏";
      if (!favorite && galleryState.filter === "favorite") {
        await loadGallery({ reset: true });
        snack(failed.length ? `已${verb} ${changed} 张，${failed.length} 张失败` : `已${verb} ${changed} 张`, { bad: failed.length > 0 });
      } else {
        updateGalleryCount();
        updateGallerySelectionUI();
        snack(failed.length ? `已${verb} ${changed} 张，${failed.length} 张失败` : `已${verb} ${changed} 张${favorite ? " · 已移入收藏文件夹" : ""}`, { bad: failed.length > 0 });
      }
    } catch (err) {
      snack("批量收藏失败：" + (err?.message || "未知错误"), { bad: true });
    } finally {
      setGalleryBatchBusy(false);
    }
  }

  async function batchExportGallery() {
    const items = selectedGalleryItems();
    if (!items.length || galleryState.batchBusy) return;
    setGalleryBatchBusy(true);
    try {
      const res = await fetch("/local/gallery/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: items.map((item) => item.path) })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (!blob.size) throw new Error("导出文件为空");
      const disposition = res.headers.get("Content-Disposition") || "";
      let name = "";
      const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf) {
        try { name = decodeURIComponent(utf[1]); } catch { name = ""; }
      }
      if (!name) {
        const plain = disposition.match(/filename="([^"]+)"/i);
        if (plain) name = plain[1];
      }
      if (!name) {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
        name = `KlockUI-作品-${stamp}.zip`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      snack(`已导出 ${items.length} 张 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      snack("导出失败：" + (err?.message || "未知错误"), { bad: true });
    } finally {
      setGalleryBatchBusy(false);
    }
  }

  function batchDeleteGallery() {
    const items = selectedGalleryItems();
    if (!items.length || galleryState.batchBusy) return;
    const count = items.length;
    mdui.confirm({
      headline: `删除选中的 ${count} 张作品？`,
      description: "会从磁盘永久删除这些文件，收藏记录与缩略图一并移除，无法恢复。",
      confirmText: "删除",
      cancelText: "取消",
      onConfirm: async () => {
        setGalleryBatchBusy(true);
        try {
          const res = await fetch("/local/gallery/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: items.map((item) => item.path) })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
          const results = Array.isArray(data.results) ? data.results : [];
          const removed = new Set(
            results.filter((result) => result.ok).map((result) => String(result.previous || result.path || ""))
          );
          const failed = results.filter((result) => !result.ok);
          let removedFavorite = 0;
          for (const path of removed) {
            const item = galleryState.items.find((entry) => entry.path === path);
            if (item?.favorite) removedFavorite += 1;
            galleryState.selected.delete(path);
          }
          galleryState.items = galleryState.items.filter((item) => !removed.has(item.path));
          galleryState.total = Math.max(0, galleryState.total - removed.size);
          galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal - removedFavorite);
          renderGallery();
          snack(failed.length ? `已删除 ${removed.size} 张，${failed.length} 张失败` : `已删除 ${removed.size} 张`, { bad: failed.length > 0 });
          if (!galleryState.items.length && galleryState.hasMore) await loadGallery();
        } catch (err) {
          snack("删除失败：" + (err?.message || "未知错误"), { bad: true });
        } finally {
          setGalleryBatchBusy(false);
        }
      }
    }).catch(() => {});
  }

  function sendSelectedGalleryToImg2img() {
    const items = selectedGalleryItems();
    if (items.length !== 1 || galleryState.batchBusy) return;
    setGallerySelecting(false);
    sendGalleryToImg2img(items[0]);
  }

  function deleteGalleryItem(item) {
    mdui.confirm({
      headline: "删除这张作品？",
      description: `会从磁盘删除 ${item.name}，缩略图与收藏记录一并移除，无法恢复。`,
      confirmText: "删除",
      cancelText: "取消",
      onConfirm: async () => {
        try {
          const res = await fetch("/local/gallery/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: item.path })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
          const wasLightbox = state.lightboxItem?.path === item.path;
          const deletedIndex = galleryState.items.findIndex((entry) => entry.path === item.path);
          galleryState.items = galleryState.items.filter((entry) => entry.path !== item.path);
          galleryState.total = Math.max(0, galleryState.total - 1);
          if (item.favorite) galleryState.favoriteTotal = Math.max(0, galleryState.favoriteTotal - 1);
          const card = $$(".gallery-card", el.galleryGrid).find((node) => node.dataset.path === item.path);
          if (card) card.remove();
          if (wasLightbox) state.lightboxItem = null;
          if (!galleryState.items.length) {
            if (galleryState.hasMore) await loadGallery();
            else renderGallery();
          } else {
            updateGalleryCount();
          }
          // 从预览里删除时接着看下一张，不用重开一遍。
          if (wasLightbox && el.lightboxDialog.open) {
            if (galleryState.items.length) {
              const nextIndex = Math.min(Math.max(deletedIndex, 0), galleryState.items.length - 1);
              showLightboxItem(galleryState.items[nextIndex]);
            } else {
              el.lightboxDialog.open = false;
            }
          }

          snack("已删除 " + item.name);
        } catch (err) {
          snack("删除失败：" + (err?.message || "未知错误"), { bad: true });
        }
      }
    }).catch(() => {});
  }

  async function fetchGalleryInfo(item) {
    try {
      const res = await fetch(
        "/local/gallery/info?path=" + encodeURIComponent(item.path),
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      return res.ok && data.ok ? data : null;
    } catch {
      return null;
    }
  }

  function loadGallerySourcePrompt(data) {
    const raw = String(data?.prompt || "").trim();
    if (!raw) {
      snack("这张没有可载入的提示词", { bad: true });
      return;
    }
    const preset = refinePresetsFor(activeProfile()?.arch).find((entry) => entry.id === state.refinePresetId);
    // 只有当前挂着细化预设时才去掉原词里的预设词，避免两套细节词叠加；
    // 没有预设时按原样载入，才真的是「原词」。
    const source = preset ? stripRefinePrompts(raw) : raw;
    // 预设词按当前模型的写法落位：Anima 的 Tags 行、SDXL 的标签列表。
    setPrompt(preset ? appendPromptExtras(source, [{ text: preset.prompt }]) : source);
    if (data.negative) setNegative(String(data.negative).trim());
    adoptLorasFromPrompt(raw);
    // adopt 只补缺失项；原词里已经挂着的 LoRA 权重也要按原词对齐，否则
    // 生成时 rewriteLoraTags 会把 <lora:x:0.8> 改写成当前面板权重。
    for (const item of parseLorasFromPrompt(raw)) addActiveLora(item.name, item.weight);
    renderLoraBlock();
    renderLoraDialog();
    invalidatePromptDraft();
    scheduleSave();
    snack(`已载入原图提示词${data.negative ? "与负面词" : ""}${preset ? ` · 保留「${preset.name}」细化词` : ""}`);
  }

  async function sendGalleryToImg2img(item) {
    try {
      const [res, info] = await Promise.all([
        fetch(galleryFileUrl(item)),
        fetchGalleryInfo(item)
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error("图片为空");
      const file = new File([blob], item.name, { type: blob.type || "image/png" });
      await handleImageFile(file, { announce: false });
      if (!state.initImage) throw new Error("读取参考图失败");
      const draftHandoff = el.qualityGroup.value === "gacha" || turboLoraActive();
      const hadBatch = Number(el.batch.value) || 1;
      const sourcePrompt = String(info?.prompt || "").trim();
      const promptAction = sourcePrompt
        ? { action: "载入原词", onActionClick: () => loadGallerySourcePrompt(info) }
        : {};
      const batchNote = hadBatch > 1 ? " · 本批 1 张" : "";
      const promptNote = sourcePrompt ? " · 原图带提示词" : "";
      el.galleryDialog.open = false;
      setMode("img2img", { silent: true });
      setBatchValue(1, { announce: false, save: false });
      if (draftHandoff) {
        if (turboLoraActive()) {
          const turboName = turboLoraName();
          if (turboName) setLoraEnabled(turboName, false);
        }
        // 重绘幅度按架构给：Krea 只有 8 步，0.35 只跑 2.8 步等于没改。
        const refineDn = isKreaActive() ? 0.5 : 0.35;
        setRefineBase(refineDn);
        state.refinePresetId = "";
        snack(`已切到细化：${el.steps.value} 步实采 / CFG ${el.cfg.value} / 重绘 ${refineDn.toFixed(2)}${batchNote}${promptNote}`, promptAction);
      } else {
        el.initDenoise.value = "0.55";
        el.denoiseOut.textContent = "0.55";
        updateAdvancedSummary();
        snack(`已放入参考图 · 重绘 0.55${batchNote}${promptNote}`, promptAction);
      }
      updateMobileHint();
      scheduleSave();
      if (isMobileLayout()) setMobileView("prompt", { scroll: true, top: 0 });
      setTimeout(() => el.refBlock.scrollIntoView({ behavior: "smooth", block: "center" }), 260);
    } catch (err) {
      snack("送去重绘失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  /* ---------------------------------------------------------------- payload */
  function finalDimensions(cfg) {
    // 高清档已经改成「基础按 1/scale 缩、再放大回来」，所以 cfg.width 就是最终尺寸；
    // 这里不再乘一次，否则元信息会记成放大后的尺寸。
    return {
      width: Math.round(cfg.width),
      height: Math.round(cfg.height)
    };
  }

  // Forge 返回的是 PNG。Hires 时 Anima 会按自己的分桶把 1040×1520 落到 1024×1536，
  // 只按请求参数推算会写错元信息；这里直接读 PNG 头里的真实宽高。
  function imageSizeFromBase64(b64) {
    try {
      const raw = String(b64 || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
      const head = atob(raw.slice(0, 64));
      if (head.slice(1, 4) !== "PNG") return null;
      const bytes = new Uint8Array(24);
      for (let i = 0; i < bytes.length && i < head.length; i++) bytes[i] = head.charCodeAt(i);
      const view = new DataView(bytes.buffer);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      return width > 0 && height > 0 ? { width, height } : null;
    } catch {
      return null;
    }
  }

  function buildRequest({ promptOverride = "", sourcePrompt = "" } = {}) {
    const cfg = currentConfig();
    if (sourcePrompt) cfg.sourcePrompt = sourcePrompt;
    if (state.mode === "img2img") {
      if (!state.initImage) {
        snack("先选一张参考图", { bad: true });
        el.fileInput.click();
        return null;
      }
      cfg.width = state.initImage.width;
      cfg.height = state.initImage.height;
      cfg.hires = false;
      if (el.detailEnhance?.checked) {
        const target = detailTargetSize();
        if (target) {
          cfg.width = target.width;
          cfg.height = target.height;
        }
      }
    }
    const seed = cfg.seedLocked ? Number(el.seed.value) : -1;
    const validSeed = Number.isFinite(seed) ? Math.trunc(seed) : -1;
    const anima = isAnimaActive();
    const krea = isKreaActive();
    const flow = anima || krea;
    // Anima 的 Qwen3 编码器没有 CLIP 跳过层，沿用 A/B 验证过的 1；Krea 2 同样不用 CLIP skip。
    const overrideSettings = {
      CLIP_stop_at_last_layers: flow ? 1 : normalizeClipSkip(cfg.clipSkip)
    };
    if (state.mode === "img2img") {
      // Forge 默认只跑 steps × 重绘幅度 的尾段（28 × 0.5 = 15 步）。
      // 打开 img2img_fix_steps 后，界面写多少步就实际采样多少步。
      overrideSettings.img2img_fix_steps = true;
    }
    const payload = {
      // 手动评级只改写最终 prompt（Anima 的 Tags 行 / Pony 标签列表），文本草稿与中文输入保持原样。
      prompt: applyManualRating(rewriteLoraTags(promptOverride || cfg.prompt)).trim(),
      // 负向先过一遍冲突过滤：正向要裸露/要 Q 版/要纯风景时，模板里的
      // censor、bad proportions、1girl 之类只会把结果拉回来。
      negative_prompt: filterNegativeConflicts(cfg.prompt, cfg.negative).text,
      steps: cfg.steps,
      cfg_scale: cfg.cfg,
      width: cfg.width,
      height: cfg.height,
      sampler_name: cfg.sampler,
      scheduler: cfg.scheduler,
      seed: validSeed,
      batch_size: 1,
      n_iter: cfg.batch,
      send_images: true,
      save_images: true,
      override_settings: overrideSettings
    };
    // 自定义 VAE：ComfyUI 里编码器与 VAE 分开加载，任何架构都该生效（含 Anima / MOSS）。
    if (cfg.vae && cfg.vae !== VAE_AUTO) payload.vae = cfg.vae;
    // 加速脚本每轮显式下发：NeverOOM 用 false 复位全局开关，避免上一轮的低显存模式残留。
    // Spectrum 是 Forge 专属扩展，ComfyUI 不认，已换成原生 EasyCache（单独字段）。
    payload.alwayson_scripts = {
      "Never OOM Integrated": { args: [Boolean(cfg.lowVram), Boolean(cfg.lowVram)] }
    };
    if (cfg.easyCache) {
      // 桥接层只在步数 >= 16 时真正插入缓存节点，8 步 turbo 抽卡会自动跳过。
      payload.klock_easy_cache = { type: "EasyCache", threshold: 0.2 };
    }
    // Anima LLLite：控制图和类型都齐了才生效；其它架构界面上没有这个入口。
    if ((activeProfile()?.arch || "") === "anima") {
      const cnModel = String(el.controlModel?.value || "");
      if (cnModel && state.controlImage) {
        payload.klock_controlnet = {
          model: cnModel,
          image: state.controlImage,
          strength: Number(el.controlStrength?.value || 1)
        };
      }
    }
    // Krea 风格参考：参考图只提供画风，桥接层会切到独立的采样图
    // （ModelSamplingFlux + FluxKontextMultiReferenceLatentMethod + SamplerCustomAdvanced）。
    if ((activeProfile()?.arch || "") === "krea" && state.styleRefImages.length) {
      payload.klock_style_ref = { images: state.styleRefImages.slice(0, STYLE_REF_MAX) };
    }
    // Anima 的 Shift 走 Forge 的 distilled_cfg_scale；Hires 二次采样用 hr_distilled_cfg。
    if (anima) {
      const shift = clampShift(cfg.shift);
      payload.distilled_cfg_scale = shift;
      payload.hr_distilled_cfg = shift;
    }
    if (state.mode === "txt2img") {
      if (cfg.hires) {
        // 低基准 + 二采：用户设的尺寸当「最终目标」，基础分辨率按 1/scale 缩减。
        // 实测复杂构图（仰视全身、交叠腿、长裙）在 768 以上直出时肢体易崩，
        // 512–640 打底全局结构明显更稳，再二采放大补细节，最终尺寸不变。
        const hrScale = Math.max(1.2, Math.min(2.0, Number(cfg.hrScale) || 1.25));
        payload.width = Math.max(384, Math.round(cfg.width / hrScale / 8) * 8);
        payload.height = Math.max(384, Math.round(cfg.height / hrScale / 8) * 8);
        payload.enable_hr = true;
        payload.hr_scale = hrScale;
        payload.hr_upscaler = cfg.hrUpscaler || DEFAULT_UPSCALER;
        // Krea 的二采是「低噪微调」而不是「补一半步数」：官方两段式配 4 步
        // denoise 0.3，跑满 base 步数纯属浪费——8 步 Turbo 一半也是 8 步。
        payload.hr_second_pass_steps = isKreaActive()
          ? Math.max(2, Math.min(8, Math.round(cfg.steps / 2)))
          : Math.max(8, Math.round(cfg.steps / 2));
        payload.denoising_strength = Math.round(Number(cfg.hrDenoise) * 1000) / 1000;
        // Forge 的 Hires 模块只能显式继承主采：[] 会清掉 Anima 预设挂载的 VAE
        // （报 “You do not have VAE state dict!”），省略则报 NoneType not iterable；
        // SDXL 下也保证自定义 VAE 在二采继续生效。
        payload.hr_additional_modules = ["Use same choices"];
      }
      return { endpoint: "txt2img", payload, cfg, mode: state.mode };
    }
    payload.init_images = [state.initImage.base64];
    // 局部重绘：蒙版和 latent 必须同尺寸，所以输出尺寸锁成画布尺寸（画布已是 16 的倍数），
    // 同时关掉放大——放大改了尺寸，蒙版就跟不上了。
    if (el.maskEnable?.checked && el.maskCanvas?.width) {
      const maskUrl = buildMaskDataUrl();
      if (maskUrl) {
        payload.klock_mask = maskUrl;
        payload.width = el.maskCanvas.width;
        payload.height = el.maskCanvas.height;
      } else {
        snack("还没涂蒙版，这次按整张重绘处理");
      }
    }
    payload.denoising_strength = Math.round(Number(cfg.img2imgDenoise) * 1000) / 1000;
    payload.resize_mode = 0;
    payload.include_init_images = false;
    return { endpoint: "img2img", payload, cfg, mode: state.mode };
  }

  /* -------------------------------------------------------------- generate */
  function setBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle("is-busy", busy);
    updateGenerateButtons();
    updateFavoriteButton();
    if (!busy) {
      el.busyOverlay.hidden = true;
    } else {
      // 手机画面页是唯一可见的进度窗口：首张生成也要给出「正在绘制」角标。
      el.busyOverlay.hidden = !state.current && !isMobileLayout();
    }
  }

  function previewDataUrl(b64) {
    if (b64.startsWith("data:")) return b64;
    if (b64.startsWith("/9j/")) return "data:image/jpeg;base64," + b64;
    if (b64.startsWith("UklGR")) return "data:image/webp;base64," + b64;
    return "data:image/png;base64," + b64;
  }

  function clearLivePreview() {
    state.lastPreview = "";
    state.previewStep = "";
    el.liveStage.hidden = true;
    el.livePreview.removeAttribute("src");
    el.liveStep.textContent = "实时预览";
  }

  function startPolling(batch = 1) {
    stopPolling();
    const total = clamp(Number(batch) || 1, 1, 12);
    let inFlight = false;
    el.progressBar.value = 0;
    el.mobileProgressBar.value = 0;
    el.progressText.textContent = "正在准备…";
    el.etaText.textContent = "";
    el.batchText.textContent = total > 1 ? `本批 ${total} 张 · 顺序生成` : "";
    state.pollTimer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/sdapi/v1/progress?skip_current_image=false", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!state.busy) return;
        if (state.jobPhase === "queued") {
          const position = Number(state.queuePosition) || 0;
          el.progressText.textContent = position > 0 ? `排队中 · 第 ${position} 位` : "排队中…";
          el.etaText.textContent = "";
          el.batchText.textContent = "到号后自动开始 · 可以继续加任务";
          el.progressBar.value = 0;
          el.mobileProgressBar.value = 0;
          el.liveStage.hidden = true;
          return;
        }
        const progress = clamp(Number(data.progress) || 0, 0, 1);
        const jobCount = Number(data.state?.job_count) || 1;
        const jobNo = Number(data.state?.job_no) || 0;
        const step = Math.max(0, Number(data.state?.sampling_step) || 0);
        const steps = Math.max(0, Number(data.state?.sampling_steps) || 0);
        const overall = jobCount > 1 ? ((jobNo + progress) / jobCount) * 100 : progress * 100;
        const pct = Math.max(0, Math.min(100, Math.round(overall)));
        el.progressBar.value = pct;
        el.mobileProgressBar.value = pct;
        const stepText = steps > 0 ? `第 ${Math.min(step, steps)}/${steps} 步` : "";
        if (stepText) {
          state.previewStep = stepText;
          el.liveStep.textContent = stepText;
        }
        if (pct < 2) {
          el.progressText.textContent = "正在准备…";
        } else {
          // Forge 的 job_count 会额外算上末尾的拼图任务；展示时用真实张数，进度仍按 job_count。
          const prefix = total > 1 ? `第 ${Math.min(jobNo + 1, total)}/${total} 张 · ` : "";
          el.progressText.textContent = `${prefix}${stepText ? stepText + " · " : ""}生成中 ${pct}%`;
        }
        el.batchText.textContent = total > 1 ? `本批 ${total} 张 · 顺序生成` : "";
        if (Number(data.eta_relative) > 0.5) {
          el.etaText.textContent = "约 " + Math.ceil(data.eta_relative) + " 秒";
        }
        // 实时步预览：Forge 每步更新 current_image；base64 与上一步相同就不重设，避免闪烁。
        if (typeof data.current_image === "string" && data.current_image) {
          if (data.current_image !== state.lastPreview) {
            state.lastPreview = data.current_image;
            el.livePreview.src = previewDataUrl(data.current_image);
            el.liveStage.hidden = false;
          }
        }
      } catch {
        /* 轮询失败不打扰 */
      } finally {
        inFlight = false;
      }
    }, 650);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  class QueueCancelledError extends Error {
    constructor(message = "已取消") {
      super(message);
      this.name = "QueueCancelledError";
    }
  }

  async function runQueuedGeneration(request) {
    // 本机与远程统一入队：公网 524 由服务端任务承接，本机也能排队与跨刷新恢复。
    const res = await fetch("/local/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: request.endpoint, payload: request.payload, model: state.activeModel || "" })
    });
    const start = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(start.detail || `HTTP ${res.status}`);
    if (!start.id) throw new Error("任务没有返回 id");
    const jobId = start.id;
    state.activeJobId = jobId;
    state.jobRuns.set(jobId, { cancelled: false });
    state.jobPhase = "queued";
    state.queuePosition = Number(start.position) || 0;
    refreshQueueBadge();
    if (el.queueDialog.open) refreshQueueDialog();
    let networkFailures = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const run = state.jobRuns.get(jobId);
      if (run?.cancelled) {
        state.jobRuns.delete(jobId);
        throw new QueueCancelledError();
      }
      let job;
      try {
        const statusRes = await fetch("/local/generate/status?id=" + encodeURIComponent(jobId), { cache: "no-store" });
        job = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok) throw new Error(job.detail || `HTTP ${statusRes.status}`);
      } catch (err) {
        // 手机切后台或隧道短暂抖动时重试网络错误；业务错误直接抛出。
        if (err instanceof TypeError && networkFailures < 4) {
          networkFailures += 1;
          await new Promise((resolve) => setTimeout(resolve, 1800));
          continue;
        }
        throw err;
      }
      networkFailures = 0;
      const isActive = state.activeJobId === jobId;
      if (job.status === "queued") {
        if (isActive) {
          state.jobPhase = "queued";
          state.queuePosition = Number(job.position) || 0;
        }
        if (el.queueDialog.open) refreshQueueDialog();
        continue;
      }
      if (job.status === "cancelled") {
        state.jobRuns.delete(jobId);
        if (state.activeJobId === jobId) state.activeJobId = "";
        if (isActive) state.queuePosition = 0;
        throw new QueueCancelledError();
      }
      if (job.status === "running") {
        // 始终指向真正在跑的那个任务：进度面板跟它走，停止按钮也不会误伤下一单。
        state.activeJobId = jobId;
        state.jobPhase = "running";
        state.queuePosition = 0;
        continue;
      }
      if (job.status === "done") {
        state.jobRuns.delete(jobId);
        if (state.activeJobId === jobId) state.activeJobId = "";
        if (!job.response || typeof job.response !== "object") throw new Error("任务没有返回结果");
        return { response: job.response, interrupted: Boolean(job.interrupted), history: Array.isArray(job.history) ? job.history : [] };
      }
      if (job.status === "error") {
        state.jobRuns.delete(jobId);
        if (state.activeJobId === jobId) state.activeJobId = "";
        throw new Error(job.detail || "生成失败");
      }
    }
  }

  async function refreshQueueBadge() {
    if (!el.queueBtn) return;
    try {
      const res = await fetch("/local/generate/list", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.items) ? data.items : [];
      const pending = list.filter((job) => job.status === "queued" || job.status === "running").length;
      const running = list.some((job) => job.status === "running");
      el.queueCount.hidden = pending === 0;
      el.queueCount.textContent = String(pending);
      el.queueBtn.classList.toggle("is-busy", running);
      el.queueBtn.title = pending
        ? `生成队列 · ${running ? "正在绘制" : "等待中"}${pending > 1 ? " · " + pending + " 个任务" : ""}`
        : "生成队列";
      // 刷新页面后原任务仍在服务端跑：等它结束再把新落盘的作品补进最近列表。
      if (!pending && state.queuePending > 0) {
        restoreServerHistory();
        if (el.galleryDialog.open) loadGallery({ reset: true });
      }
      state.queuePending = pending;
    } catch {
      /* 状态查询失败不打扰 */
    }
  }

  const QUEUE_STATUS_TEXT = {
    queued: "排队中",
    running: "正在绘制",
    done: "已完成",
    error: "失败",
    cancelled: "已取消"
  };

  async function refreshQueueDialog() {
    if (!el.queueDialog || !el.queueDialog.open || state.queueBusy) return;
    state.queueBusy = true;
    try {
      const res = await fetch("/local/generate/list", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const list = Array.isArray(data.items) ? data.items : [];
      const pending = list.filter((job) => job.status === "queued" || job.status === "running");
      el.queueStatus.classList.remove("is-bad");
      if (!list.length) {
        el.queueStatus.textContent = "队列是空的，生成后会出现在这里。";
      } else if (pending.length) {
        el.queueStatus.textContent = data.running
          ? `正在绘制 · 还有 ${Math.max(0, pending.length - 1)} 个在排队（上限 ${data.queue_max || 12}）`
          : `${pending.length} 个任务在排队（上限 ${data.queue_max || 12}）`;
      } else {
        el.queueStatus.textContent = "没有等待中的任务；下面是本次会话的最近任务。";
      }
      el.queueList.innerHTML = "";
      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "queue-empty";
        empty.textContent = "还没有任务。写点描述，点「生成画面」就会入队。";
        el.queueList.appendChild(empty);
      }
      list.forEach((job) => {
        const row = document.createElement("div");
        row.className = "queue-item";
        const main = document.createElement("div");
        main.className = "queue-item-main";
        const title = document.createElement("div");
        title.className = "queue-item-title";
        const meta = job.meta || {};
        title.textContent = meta.prompt || (job.endpoint === "img2img" ? "图生图任务" : "文生图任务");
        const info = document.createElement("div");
        info.className = "queue-item-meta";
        const badge = document.createElement("span");
        badge.className = "queue-badge is-" + (job.status || "queued");
        let statusText = QUEUE_STATUS_TEXT[job.status] || job.status;
        if (job.status === "queued" && job.position) statusText += ` · 第 ${job.position} 位`;
        badge.textContent = statusText;
        info.appendChild(badge);
        const size = document.createElement("span");
        size.textContent = `${meta.width || "?"}×${meta.height || "?"}${meta.steps ? " · " + meta.steps + " 步" : ""}`;
        info.appendChild(size);
        if (job.status === "queued" || job.status === "running") {
          const wait = document.createElement("span");
          wait.textContent = job.status === "running" ? "可停止" : "可取消";
          info.appendChild(wait);
        } else if (job.finished && job.started) {
          const cost = document.createElement("span");
          cost.textContent = `${Math.max(0, Math.round(job.finished - job.started))} 秒`;
          info.appendChild(cost);
        }
        main.append(title, info);
        row.appendChild(main);
        if (job.status === "queued" || job.status === "running") {
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "queue-item-btn" + (job.status === "running" ? " is-danger" : "");
          cancel.textContent = job.status === "running" ? "停止" : "取消";
          cancel.addEventListener("click", () => cancelQueuedJob(job));
          row.appendChild(cancel);
        }
        el.queueList.appendChild(row);
      });
    } catch (err) {
      el.queueStatus.textContent = "读取队列失败：" + (err?.message || "未知错误");
      el.queueStatus.classList.add("is-bad");
    } finally {
      state.queueBusy = false;
    }
  }

  async function cancelQueuedJob(job) {
    try {
      const res = await fetch("/local/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      snack(data.status === "cancelled" ? "已从队列移除" : "正在停止，保留已生成的部分…");
      refreshQueueDialog();
      refreshQueueBadge();
    } catch (err) {
      snack("取消失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  function openQueueDialog() {
    dismissSnacks();
    el.queueDialog.open = true;
    refreshQueueDialog();
    refreshQueueBadge();
    if (state.queueTimer) clearInterval(state.queueTimer);
    state.queueTimer = setInterval(() => {
      if (!el.queueDialog.open) {
        clearInterval(state.queueTimer);
        state.queueTimer = null;
        return;
      }
      refreshQueueDialog();
      refreshQueueBadge();
    }, 1600);
  }

  async function generate() {
    // 忙时也可以继续提交：按钮会变成「加入队列」，由服务端按顺序执行。
    if (state.submitting) return;
    if (!state.online) {
      snack("引擎还没就绪，先点右上角状态检查", { bad: true });
      refreshStatus();
      return;
    }
    // 细节增强本质是放大补细节，参考图本身就是内容来源；提示词留空也应当能跑。
    const detailPass = state.mode === "img2img" && Boolean(el.detailEnhance?.checked);
    if (!el.prompt.value.trim() && !detailPass) {
      snack("先写一点画面描述", { bad: true });
      el.prompt.focus();
      return;
    }
    if (state.converting) return;
    state.submitting = true;
    let request = null;
    try {
      // 中文自然语言先按当前模型转成英文提示词；转写失败不会把中文送进 Forge。
      // 加速 LoRA（MOSS 8 步 DMD / Anima Turbo）是蒸馏件：只在 8–12 步成立。
      // 手动把步数拖到 50 而它仍挂着，等于拿 50 步去跑一个只学过 8 步的权重，
      // 结果是糊 + 结构崩——这是"偶尔崩、换句话又好了"最常见的来源。
      const turboName = turboLoraName();
      if (turboName && findActiveLora(turboName) && Number(el.steps.value) > 20) {
        setLoraEnabled(turboName, false);
        snack(`已自动关闭加速 LoRA：${Number(el.steps.value)} 步下它会和采样互相打架`);
      }
      const resolved = await resolveGenerationPrompt();
      if (resolved.needConfirm) {
        // 转写只完成了一半：先让用户看/改，确认后才提交这一单。
        snack("转写完成 · 检查或修改后点「确认并生成」");
        el.promptDraft?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      if (!resolved.ok) {
        snack(resolved.error || "中文转写失败，未开始生成", { bad: true });
        return;
      }
      request = buildRequest({ promptOverride: resolved.prompt, sourcePrompt: resolved.source });
    } finally {
      state.submitting = false;
    }
    if (!request) return;

    const startedAt = performance.now();
    const startedEpoch = Date.now();
    state.stopping = false;
    state.pendingCount += 1;
    clearTimeout(state.hideTimer);
    clearLivePreview();
    el.progressPanel.hidden = false;
    el.progressBar.value = 0;
    el.mobileProgressBar.value = 0;
    setBusy(true);
    if (isMobileLayout()) setMobileView("canvas", { scroll: true, top: 0 });
    startPolling(request.cfg.batch);
    refreshQueueBadge();

    try {
      const result = await runQueuedGeneration(request);
      const data = result.response;
      if (!Array.isArray(data.images) || !data.images.length) {
        throw new Error("接口没有返回图片");
      }
      const interrupted = Boolean(result.interrupted);
      const records = Array.isArray(result.history) ? result.history : [];
      const elapsed = (performance.now() - startedAt) / 1000;
      const finishedEpoch = Date.now();
      let info = data.info;
      if (typeof info === "string") {
        try { info = JSON.parse(info); } catch { info = {}; }
      }
      info = info && typeof info === "object" ? info : {};
      // 后端会标记疑似「latent patch 拆错」的废图（条带伪影），提醒重抽而不是默默存下。
      if (Array.isArray(info.fragmented) && info.fragmented.length) {
        const nums = info.fragmented.map((n) => Number(n) + 1).join("、");
        snack(`第 ${nums} 张疑似解码条带异常，建议用「同种子」重抽一次`, { bad: true });
      }
      const seeds = Array.isArray(info.all_seeds) ? info.all_seeds : (info.seed != null ? [info.seed] : []);
      const finals = finalDimensions(request.cfg);
      // 多图时 Forge 可能把拼图放在最前面；拼图不是单张作品，按实际生成数从末尾截取。
      const expected = Math.max(1, seeds.length || (Number(request.payload.n_iter) || 1) * (Number(request.payload.batch_size) || 1));
      const images = data.images.length > expected ? data.images.slice(-expected) : data.images;
      const items = images.map((image, index) => {
        const b64 = String(image);
        const record = records[index] || null;
        const seed = record?.seed ?? seeds[index] ?? seeds[0] ?? (request.payload.seed >= 0 ? request.payload.seed : null);
        const actual = imageSizeFromBase64(b64);
        return {
          id: "g" + Date.now().toString(36) + "-" + index,
          url: URL.createObjectURL(blobFromBase64(b64)),
          seed,
          mode: request.mode,
          steps: request.cfg.steps,
          cfg: request.cfg.cfg,
          finalWidth: actual?.width || record?.width || (request.mode !== "txt2img" ? request.cfg.width : finals.width),
          finalHeight: actual?.height || record?.height || (request.mode !== "txt2img" ? request.cfg.height : finals.height),
          totalElapsed: elapsed,
          batchIndex: index + 1,
          batchTotal: images.length,
          denoise: request.cfg.img2imgDenoise,
          interrupted,
          hires: request.mode === "txt2img" && request.cfg.hires,
          hrScale: request.cfg.hrScale,
          config: { ...request.cfg, mode: request.mode },
          createdAt: Date.now(),
          startedAtEpoch: startedEpoch,
          finishedAtEpoch: finishedEpoch,
          galleryPath: record?.path || "",
          galleryName: record?.path ? String(record.path).split("/").pop() : "",
          persistedId: record?.id || "",
          kind: "generate"
        };
      });

      addHistory(items);
      if (el.galleryDialog.open) loadGallery({ reset: true });
      showResult(items[0], { scroll: true });
      trackGeneratedGallery(items);
      const remaining = Math.max(0, state.pendingCount - 1);
      const finalPct = interrupted ? el.progressBar.value : 100;
      el.progressBar.value = finalPct;
      el.mobileProgressBar.value = finalPct;
      el.progressText.textContent = remaining > 0 ? "上一张完成 · 队列继续" : (interrupted ? "已停止" : "完成");
      el.etaText.textContent = elapsed.toFixed(1) + " 秒";
      el.batchText.textContent = interrupted
        ? "已停止 · 中途结果已保留"
        : (images.length > 1 ? `本批 ${images.length} 张` : "");
      snack(interrupted
        ? `已停止 · 保留中途结果 ${elapsed.toFixed(1)} 秒`
        : `完成 · ${images.length > 1 ? images.length + " 张 · " : ""}${elapsed.toFixed(1)} 秒`);

      if (!el.seedLock.checked && items[0].seed != null) {
        // 让「同种子」能直接拿到这次结果；随机模式下字段仍显示 -1。
        el.seed.dataset.actual = String(items[0].seed);
      }
    } catch (err) {
      const cancelled = err?.name === "QueueCancelledError";
      el.progressBar.value = 0;
      el.mobileProgressBar.value = 0;
      el.etaText.textContent = "";
      if (cancelled) {
        el.progressText.textContent = "已取消";
        el.batchText.textContent = "";
        snack("已取消排队任务");
      } else {
        el.progressText.textContent = "失败";
        snack("生成失败：" + (err?.message || "未知错误"), { bad: true });
      }
    } finally {
      state.pendingCount = Math.max(0, state.pendingCount - 1);
      clearLivePreview();
      if (state.pendingCount === 0) {
        stopPolling();
        setBusy(false);
        state.stopping = false;
        state.jobPhase = "idle";
        state.queuePosition = 0;
        state.activeJobId = "";
        state.hideTimer = setTimeout(() => { el.progressPanel.hidden = true; }, 1200);
      } else {
        setBusy(true);
      }
      refreshQueueBadge();
      if (el.queueDialog.open) refreshQueueDialog();
      setTimeout(refreshStatus, 700);
    }
  }

  async function interrupt() {
    if (!state.busy) {
      snack("当前没有正在生成的任务");
      return;
    }
    const id = state.activeJobId;
    if (!id) {
      snack("任务还没登记，稍等一下再停止", { bad: true });
      return;
    }
    state.stopping = true;
    try {
      const res = await fetch("/local/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (data.status === "cancelled") {
        snack("已从队列移除");
      } else {
        // 运行中的任务交给服务端 interrupt，轮询继续等到中途结果落盘后再展示。
        snack("正在停止，保留已生成的部分…");
      }
      refreshQueueBadge();
      if (el.queueDialog.open) refreshQueueDialog();
    } catch (err) {
      state.stopping = false;
      snack("停止请求失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  /* --------------------------------------------------------------- actions */
  function downloadCurrent() {
    if (!state.current) return;
    const item = state.current;
    const a = document.createElement("a");
    a.href = item.url;
    a.download = `klockui-${item.mode}-${item.seed ?? "seed"}-${formatDateStamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    snack("已开始下载 PNG");
  }

  function downloadLightbox() {
    if (state.lightboxItem) {
      exportGalleryItem(state.lightboxItem);
      return;
    }
    downloadCurrent();
  }

  function sameSeed() {
    if (!state.current || state.current.seed == null) {
      snack("这张没有记录种子，先换一张试试", { bad: true });
      return;
    }
    el.seedLock.checked = true;
    el.seed.value = String(state.current.seed);
    updateSeedUI({ preserve: true });
    scheduleSave();
    snack(`已固定种子 ${state.current.seed}`);
    generate();
  }

  function again() {
    el.seedLock.checked = false;
    el.seed.value = "-1";
    updateSeedUI({ preserve: true });
    scheduleSave();
    generate();
  }

  function loadCurrentParams() {
    if (!state.current?.config) {
      snack("这张没有可载入的参数", { bad: true });
      return;
    }
    applyConfig(state.current.config);
    if (isMobileLayout()) setMobileView("params", { scroll: true, top: 0 });
    const needsImage = state.current.mode !== "txt2img";
    const hint = needsImage ? "；参考图需要重新选择" : "";
    snack("参数已载入" + hint, { bad: needsImage && !state.initImage });
  }

  async function sendCurrentToImg2img() {
    if (!state.current) return;
    try {
      const response = await fetch(state.current.url);
      const blob = await response.blob();
      const ext = blob.type.includes("jpeg") ? "jpg" : "png";
      const file = new File([blob], `result-${state.current.seed ?? "seed"}.${ext}`, { type: blob.type || "image/png" });
      const draftHandoff = el.qualityGroup.value === "gacha" || turboLoraActive();
      const hadBatch = Number(el.batch.value) || 1;
      await handleImageFile(file, { announce: false });
      setMode("img2img", { silent: true });
      setBatchValue(1, { announce: false, save: false });
      const batchNote = hadBatch > 1 ? " · 本批 1 张" : "";
      if (draftHandoff) {
        if (turboLoraActive()) {
          const turboName = turboLoraName();
          if (turboName) setLoraEnabled(turboName, false);
        }
        const refineDn2 = isKreaActive() ? 0.5 : 0.35;
        setRefineBase(refineDn2);
        state.refinePresetId = "";
        snack(`已切到细化：${el.steps.value} 步实采 / CFG ${el.cfg.value} / 重绘 ${refineDn2.toFixed(2)}${batchNote}`);
      } else {
        el.initDenoise.value = "0.55";
        el.denoiseOut.textContent = "0.55";
        snack(`已放入参考图 · 重绘 0.55${batchNote}`);
      }
      updateMobileHint();
      scheduleSave();
      if (isMobileLayout()) setMobileView("prompt", { scroll: true, top: 0 });
      setTimeout(() => el.refBlock.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } catch (err) {
      snack("送去重绘失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  async function openOutputFolder() {
    try {
      const res = await fetch("/local/open-output", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.detail || "无法打开目录");
      snack("已打开出图目录");
    } catch (err) {
      snack("打开目录失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  function galleryFolderIsFavorites() {
    return galleryState.filter === "favorite";
  }

  function refreshGalleryFolderButton() {
    const label = galleryFolderIsFavorites() ? "打开收藏文件夹" : "打开出图目录";
    el.galleryOpenFolder.title = label;
    el.galleryOpenFolder.setAttribute("aria-label", label);
  }

  async function openGalleryFolder() {
    const favorites = galleryFolderIsFavorites();
    try {
      const res = await fetch(favorites ? "/local/open-favorites" : "/local/open-output", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.detail || "无法打开文件夹");
      snack(favorites ? "已打开收藏文件夹" : "已打开出图目录");
    } catch (err) {
      snack("打开文件夹失败：" + (err?.message || "未知错误"), { bad: true });
    }
  }

  function openLightbox() {
    if (!state.current) return;
    dismissSnacks();
    state.lightboxItem = null;
    state.lightboxNavBusy = false;
    el.lightboxImg.src = state.current.url;
    resetLightboxView();
    updateLightboxNav();
    el.lightboxDialog.open = true;
  }

  function resetAll() {
    mdui.confirm({
      headline: "恢复默认设置？",
      description: "会重置描述、画质、尺寸和采样参数；我的预设与最近作品不会被删除。",
      confirmText: "恢复默认",
      cancelText: "取消",
      onConfirm: () => {
        state.initImage = null;
        renderRef();
        applyConfig(defaultConfig(), { save: false });
        const profile = activeProfile();
        if (profile.id !== "generic") applyGenerationSettings(profileRecommendedSettings(profile), { save: false });
        try {
          localStorage.removeItem(STORE_SETTINGS);
          localStorage.removeItem(STORE_MODEL_SETTINGS);
        } catch { /* ignore */ }
        updateModelProfileUI();
        scheduleSave();
        snack("已恢复默认设置");
      }
    }).catch(() => {});
  }

  /* ------------------------------------------------------------ persistence */
  function scheduleSave() {
    if (state.restoring) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveSettings, 320);
  }

  function saveSettings() {
    if (state.restoring) return;
    writeJSON(STORE_SETTINGS, currentConfig());
  }

  function restoreSettings() {
    const saved = readJSON(STORE_SETTINGS, null);
    if (!saved || typeof saved !== "object") {
      applyConfig(defaultConfig(), { save: false });
      return;
    }
    if (typeof saved.model === "string" && saved.model) {
      state.modelProfileId = profileForModel(saved.model).id;
    }
    applyConfig({ ...DEFAULT_SETTINGS, ...saved }, { save: false });
  }

  /* ----------------------------------------------------------------- events */
  // 采样与步数是"定完画质才偶尔改"的低频区，默认收起，标题行可直接点开。
  function setParamFolded(folded, { save = true } = {}) {
    const card = el.paramCard;
    if (!card) return;
    card.classList.toggle("is-folded", Boolean(folded));
    if (el.paramFold) el.paramFold.setAttribute("aria-expanded", String(!folded));
    updateSamplerPresetUI();
    if (save) writeJSON("klock.paramFolded", Boolean(folded));
  }

  function bindEvents() {
    el.themeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeModelSwitchMenu();
      setThemeMenu(!el.themeMenu.classList.contains("open"));
    });
    $$(".theme-option", el.themeMenu).forEach((option) => {
      option.addEventListener("click", () => {
        applyTheme(option.dataset.themeValue);
        closeThemeMenu({ restoreFocus: true });
      });
    });
    document.addEventListener("click", (event) => {
      if (!el.themeMenu.classList.contains("open")) return;
      if (event.target instanceof Element && event.target.closest("#themePicker")) return;
      closeThemeMenu();
    });
    document.addEventListener("click", (event) => {
      if (!el.modelMenu.classList.contains("open")) return;
      if (event.target instanceof Element && event.target.closest("#modelPicker")) return;
      closeModelSwitchMenu();
    });
    el.ratingBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeModelSwitchMenu();
      closeThemeMenu();
      setRatingMenu(!el.ratingMenu.classList.contains("open"));
    });
    $$(".rating-option", el.ratingMenu).forEach((option) => {
      option.addEventListener("click", () => {
        applyRating(option.dataset.rating, { announce: true });
        closeRatingMenu({ restoreFocus: true });
      });
    });
    document.addEventListener("click", (event) => {
      if (!el.ratingMenu.classList.contains("open")) return;
      if (event.target instanceof Element && event.target.closest("#ratingPicker")) return;
      closeRatingMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeThemeMenu({ restoreFocus: true });
        closeModelSwitchMenu({ restoreFocus: true });
        closeRatingMenu({ restoreFocus: true });
        closeBatchMenu({ restoreFocus: true });
      }
      if (el.modelMenu.classList.contains("open")) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = $$(".model-option:not(:disabled)", el.modelMenu);
          if (items.length) {
            const index = items.indexOf(document.activeElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(index + step + items.length) % items.length]?.focus();
          }
          return;
        }
      }
      if (el.batchMenu.classList.contains("open")) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const options = $$(".batch-option", el.batchMenu);
          if (event.key === "Home" || event.key === "End") {
            options[event.key === "Home" ? 0 : options.length - 1]?.focus();
            return;
          }
          const index = options.indexOf(document.activeElement);
          const step = event.key === "ArrowDown" ? 1 : -1;
          options[(index + step + options.length) % options.length]?.focus();
          return;
        }
      }
      if (el.ratingMenu.classList.contains("open")) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const options = $$(".rating-option", el.ratingMenu);
          const index = options.indexOf(document.activeElement);
          const step = event.key === "ArrowDown" ? 1 : -1;
          options[(index + step + options.length) % options.length]?.focus();
          return;
        }
      }
      if (!el.themeMenu.classList.contains("open")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const options = $$(".theme-option", el.themeMenu);
      const index = options.indexOf(document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      options[(index + step + options.length) % options.length]?.focus();
    });
    el.helpBtn.addEventListener("click", () => { dismissSnacks(); el.helpDialog.fullscreen = window.innerWidth <= 720; el.helpDialog.open = true; });
    el.closeHelp.addEventListener("click", () => { el.helpDialog.open = false; });
    el.status.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !el.modelMenu.classList.contains("open");
      setModelSwitchMenu(willOpen);
      if (willOpen) ensureModelMenuData();
    });
    el.modelMenuRefresh.addEventListener("click", async (event) => {
      event.stopPropagation();
      const ok = await loadModels({ silent: false });
      renderModelMenu();
      if (ok) snack(`模型列表已刷新，共 ${state.models.length} 个`);
    });
    el.modelMenuStatus.addEventListener("click", async (event) => {
      event.stopPropagation();
      el.modelMenuStatusText.textContent = "检查中…";
      await refreshStatus();
      syncModelMenuState();
      snack(state.online ? "引擎可用" : "还没连上引擎，请稍等或检查启动窗口");
    });
    window.addEventListener("resize", () => {
      if (el.modelMenu.classList.contains("open")) positionModelMenu();
      const fullscreen = window.innerWidth <= 720;
      if (el.savedDialog.open) el.savedDialog.fullscreen = fullscreen;
      if (el.helpDialog.open) el.helpDialog.fullscreen = fullscreen;
      if (el.savePresetDialog.open) el.savePresetDialog.fullscreen = fullscreen;
      if (el.loraDialog.open) el.loraDialog.fullscreen = fullscreen;
      if (el.artistDialog.open) el.artistDialog.fullscreen = fullscreen;
    });
    el.applyModelProfile.addEventListener("click", applyRecommendedProfile);
    el.manageLorasBtn.addEventListener("click", openLoraDialog);
    el.closeLoraDialog.addEventListener("click", () => { el.loraDialog.open = false; });
    el.refreshLorasBtn.addEventListener("click", refreshLoras);

    el.modeGroup.addEventListener("change", () => {
      if (el.modeGroup.value) setMode(el.modeGroup.value);
    });
    el.myPresetsBtn.addEventListener("click", openSavedPresets);

    el.prompt.addEventListener("input", () => {
      updatePromptUI();
      if (hasChineseText(el.prompt.value)) renderPromptDraft();
      else if (state.promptDraft || state.promptDraftError) invalidatePromptDraft();
      scheduleSave();
    });
    el.negative.addEventListener("input", () => {
      updatePromptUI();
      scheduleSave();
    });
    el.prompt.addEventListener("change", () => {
      updatePromptUI();
      adoptLorasFromPrompt(el.prompt.value);
    });
    el.negative.addEventListener("change", updatePromptUI);

    el.dicePromptBtn.addEventListener("click", surprisePrompt);
    el.cleanPromptBtn.addEventListener("click", cleanPrompt);
    el.copyPromptBtn.addEventListener("click", copyPrompt);
    el.paramFold?.addEventListener("click", (event) => {
      event.stopPropagation();
      setParamFolded(!el.paramCard?.classList.contains("is-folded"));
    });
    el.paramCard?.querySelector(".side-card-head")?.addEventListener("click", () => {
      setParamFolded(!el.paramCard.classList.contains("is-folded"));
    });
    el.promptDraftConfirm?.addEventListener("click", () => { confirmDraftAndGenerate(); });
    el.translateSwitch?.addEventListener("click", () => {
      state.translateEnabled = !state.translateEnabled;
      setTranslateToggle(state.translateEnabled);
      // 关掉开关时清掉待确认状态，避免"预览在等确认、实际已经不需要转写"的错位
      if (!state.translateEnabled) state.promptConfirmPending = false;
      // 同步"转写预览"入口的可用状态
      if (el.promptConvert) {
        el.promptConvert.disabled = !state.translateEnabled;
        el.promptConvert.title = state.translateEnabled
          ? "把输入框里的中文描述转成当前模型的英文提示词"
          : "转写开关已关闭；打开后才能预览转写结果";
      }
      renderPromptDraft();
      snack(state.translateEnabled
        ? "转写已开启：中文先按当前模型改写，确认后再生成"
        : "转写已关闭：提示词原文直接提交（含中文）");
      scheduleSave();
    });
    el.interrogateBtn?.addEventListener("click", () => el.interrogateFile?.click());
    el.interrogateFile?.addEventListener("change", () => {
      const file = el.interrogateFile.files && el.interrogateFile.files[0];
      if (file) interrogateFromFile(file);
    });
    el.openNegativeInspiration.addEventListener("click", openNegativeInspiration);
    el.railToggle.addEventListener("click", () => {
      const collapsed = !el.recipeSection.classList.contains("is-collapsed");
      setRecipeRailCollapsed(collapsed);
    });
    el.promptConvert.addEventListener("click", () => previewPromptDraft());
    el.promptDraftRetry.addEventListener("click", () => convertPromptToEnglish({ retry: true, announce: true }));
    el.promptDraftEdit.addEventListener("click", () => startPromptDraftEdit());
    el.promptDraftCancel.addEventListener("click", () => cancelPromptDraftEdit());
    el.promptDraftSave.addEventListener("click", () => savePromptDraftEdit());
    el.promptDraftCopy.addEventListener("click", () => copyPromptDraft());
    el.promptDraftHide.addEventListener("click", () => { state.promptDraftCollapsed = !state.promptDraftCollapsed; renderPromptDraft(); });
    el.promptDraftOpen.addEventListener("click", () => { state.promptDraftCollapsed = false; renderPromptDraft(); });
    el.closeInspiration.addEventListener("click", () => { el.inspirationDialog.open = false; });
    el.artistBalanceBtn.addEventListener("click", () => setAllArtistWeights(1, 1));
    el.artistPrimaryBtn.addEventListener("click", () => setAllArtistWeights(1, 0.55));
    el.artistClearBtn.addEventListener("click", clearArtistPicks);
    el.applyArtistsBtn.addEventListener("click", applyArtistPicks);
    el.closeArtistDialog.addEventListener("click", () => { el.artistDialog.open = false; });
    el.artistSearch.addEventListener("input", (event) => {
      artistState.query = event.target.value;
      applyArtistFilter();
    });
    el.closeCharacterDialog.addEventListener("click", () => { el.characterDialog.open = false; });
    el.characterModeSwitch?.addEventListener("change", () => setCharacterMode(el.characterModeSwitch.value));
    el.characterSearch.addEventListener("input", (event) => applyCharacterFilter(event.target.value));
    let characterScrollTick = 0;
    el.characterScroll.addEventListener("scroll", () => {
      if (!el.characterDialog.open || el.characterGroupNav.hidden) return;
      cancelAnimationFrame(characterScrollTick);
      characterScrollTick = requestAnimationFrame(() => {
        const groups = $$(".character-group:not([hidden])", el.characterGroups);
        const base = el.characterScroll.getBoundingClientRect().top + 12;
        let current = state.activeCharacterGroup;
        for (const group of groups) {
          if (group.getBoundingClientRect().top <= base + 26) current = group.dataset.group;
        }
        const sc = el.characterScroll;
        if (groups.length && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) {
          current = groups[groups.length - 1].dataset.group;
        }
        if (current && current !== state.activeCharacterGroup) {
          state.activeCharacterGroup = current;
          syncCharacterNav();
          const navButton = el.characterGroupNav.querySelector(`.tag-nav-pill[data-group="${current}"]`);
          navButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    });
    el.presetSearch.addEventListener("input", (event) => applyPresetFilter(event.target.value));
    el.tagTargetSwitch.addEventListener("change", () => {
      const next = el.tagTargetSwitch.value;
      if (next && next !== state.tagTarget) setTagTarget(next);
    });
    el.resetNegativeTags.addEventListener("click", restoreRecommendedNegative);
    let tagScrollTick = 0;
    el.libraryScroll.addEventListener("scroll", () => {
      if (!el.inspirationDialog.open || el.tagGroupNav.hidden) return;
      cancelAnimationFrame(tagScrollTick);
      tagScrollTick = requestAnimationFrame(() => {
        const groups = $$(".tag-group:not([hidden])", el.tagGroups);
        const base = el.libraryScroll.getBoundingClientRect().top + 12;
        let current = state.activeTagGroup;
        for (const group of groups) {
          if (group.getBoundingClientRect().top <= base + 26) current = group.dataset.group;
        }
        const sc = el.libraryScroll;
        if (groups.length && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) {
          current = groups[groups.length - 1].dataset.group;
        }
        if (current && current !== state.activeTagGroup) {
          state.activeTagGroup = current;
          syncTagNav();
          const navButton = el.tagGroupNav.querySelector(`.tag-nav-pill[data-group="${current}"]`);
          navButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    });

    el.qualityGroup.addEventListener("change", () => {
      if (el.qualityGroup.value) {
        applyQuality(el.qualityGroup.value);
      } else if (state.qualityKey) {
        // 再点一次已选中的画质档时 MDUI 会把整组清空，这里保持原档不变。
        el.qualityGroup.value = state.qualityKey;
        updateQualityHint();
      }
    });
    el.steps.addEventListener("input", () => {
      el.stepsOut.textContent = el.steps.value;
      markCustomQuality();
      updateAdvancedSummary();
      updateModelProfileUI();
      updateMobileHint();
      scheduleSave();
    });
    el.cfg.addEventListener("input", () => {
      el.cfgOut.textContent = Number(el.cfg.value).toFixed(1);
      updateNegativeHint();
      markCustomQuality();
      updateAdvancedSummary();
      scheduleSave();
    });
    el.sampler.addEventListener("change", () => { updateSamplerPresetUI(); updateAdvancedSummary(); updateModelProfileUI(); scheduleSave(); });
    el.scheduler.addEventListener("change", () => { updateSamplerPresetUI(); updateAdvancedSummary(); updateModelProfileUI(); scheduleSave(); });
    el.shift?.addEventListener("input", () => {
      el.shiftOut.textContent = Number(el.shift.value).toFixed(1);
      updateEngineHint();
      updateAdvancedSummary();
      updateModelProfileUI();
      scheduleSave();
    });
    el.clipSkip.addEventListener("change", () => { updateEngineHint(); updateAdvancedSummary(); scheduleSave(); });
    el.vae.addEventListener("change", () => { updateEngineHint(); scheduleSave(); });
    el.samplerPresets.addEventListener("click", (event) => {
      const button = event.target.closest(".sampler-preset");
      if (button) applySamplerPreset(button.dataset.preset);
    });
    el.batchBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeModelSwitchMenu();
      closeThemeMenu();
      closeRatingMenu();
      setBatchMenu(!el.batchMenu.classList.contains("open"));
    });
    el.batchBtn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !el.batchMenu.classList.contains("open");
        setBatchMenu(willOpen, { focus: willOpen });
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      if (!el.batchMenu.classList.contains("open")) setBatchMenu(true);
      const options = $$(".batch-option", el.batchMenu);
      const current = el.batchMenu.querySelector('.batch-option[aria-checked="true"]');
      const target = event.key === "ArrowDown"
        ? (current || options[0])
        : (current || options[options.length - 1]);
      target?.focus({ preventScroll: true });
    });
    document.addEventListener("click", (event) => {
      if (!el.batchMenu.classList.contains("open")) return;
      if (event.target instanceof Element && event.target.closest("#batchPicker")) return;
      closeBatchMenu();
    });
    window.addEventListener("resize", () => closeBatchMenu());
    window.addEventListener("scroll", () => closeBatchMenu(), true);
    el.hires.addEventListener("change", () => {
      updateHiresUI();
      updateAdvancedSummary();
      markCustomQuality();
      scheduleSave();
    });
    el.hrScale.addEventListener("change", () => {
      updateHiresUI();
      updateAdvancedSummary();
      markCustomQuality();
      scheduleSave();
    });
    el.hrUpscaler.addEventListener("change", () => {
      updateHiresUI();
      updateAdvancedSummary();
      markCustomQuality();
      scheduleSave();
    });
    el.hrDenoise.addEventListener("input", () => {
      el.hrOut.textContent = Number(el.hrDenoise.value).toFixed(2);
      markCustomQuality();
      scheduleSave();
    });
    if (el.easyCache) el.easyCache.addEventListener("change", () => { updatePerfHint(); updateAdvancedSummary(); scheduleSave(); });
    if (el.lowVram) el.lowVram.addEventListener("change", () => { updatePerfHint(); updateAdvancedSummary(); scheduleSave(); });
    el.seedLock.addEventListener("change", () => { updateSeedUI(); scheduleSave(); });
    el.seed.addEventListener("input", () => { updateAdvancedSummary(); scheduleSave(); });
    el.diceSeed.addEventListener("click", randomSeed);
    el.initDenoise.addEventListener("input", () => {
      el.denoiseOut.textContent = Number(el.initDenoise.value).toFixed(2);
      updateMobileHint();
      updateAdvancedSummary();
      scheduleSave();
    });
    el.detailEnhance?.addEventListener("change", () => {
      setDetailEnhance(el.detailEnhance.checked);
    });
    el.detailScale?.addEventListener("change", () => {
      if (!el.detailEnhance.checked) return;
      const target = detailTargetSize();
      updateDetailUI();
      updateMobileHint();
      updateAdvancedSummary();
      scheduleSave();
      if (target) snack(`细节增强输出：${target.width} × ${target.height}`);
    });
    el.customW.addEventListener("change", () => applyCustomSize());
    el.customH.addEventListener("change", () => applyCustomSize());

    el.ratioGrid.addEventListener("click", (event) => {
      const tile = event.target.closest(".ratio-tile");
      if (tile) selectRatio(tile);
    });

    el.dropzone.addEventListener("click", () => el.fileInput.click());
    el.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.fileInput.click();
      }
    });
    el.dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      el.dropzone.classList.add("is-drag");
    });
    el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("is-drag"));
    el.dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      el.dropzone.classList.remove("is-drag");
      const file = event.dataTransfer?.files?.[0];
      if (file) handleImageFile(file);
    });
    el.fileInput.addEventListener("change", () => {
      const file = el.fileInput.files?.[0];
      if (file) handleImageFile(file);
    });

    // ---- 局部重绘蒙版
    if (el.maskEnable) {
      el.maskEnable.addEventListener("change", () => setMaskEnabled(el.maskEnable.checked));
    }
    if (el.brushSize && el.brushOut) {
      el.brushOut.textContent = el.brushSize.value;
      el.brushSize.addEventListener("input", () => {
        el.brushOut.textContent = el.brushSize.value;
      });
    }
    if (el.maskClear) {
      el.maskClear.addEventListener("click", () => {
        if (!state.initImage) return;
        resetMaskCanvas();
        snack("蒙版已清除");
      });
    }
    if (el.maskCanvas) {
      el.maskCanvas.addEventListener("pointerdown", beginMaskStroke);
      el.maskCanvas.addEventListener("pointermove", moveMaskStroke);
      el.maskCanvas.addEventListener("pointerup", endMaskStroke);
      el.maskCanvas.addEventListener("pointercancel", endMaskStroke);
    }

    // ---- Anima LLLite 控制图
    if (el.controlPickBtn) {
      el.controlPickBtn.addEventListener("click", () => el.controlImageInput?.click());
    }
    if (el.controlImageInput) {
      el.controlImageInput.addEventListener("change", () => {
        const file = el.controlImageInput.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            state.controlImage = String(reader.result || "");
            updateControlnetHint();
            updateAdvancedSummary();
            scheduleSave();
            snack("控制图已选，挑一个控制类型才生效");
          };
          reader.readAsDataURL(file);
        }
        el.controlImageInput.value = "";
      });
    }
    if (el.controlModel) {
      el.controlModel.addEventListener("change", () => {
        updateControlnetHint();
        updateAdvancedSummary();
        scheduleSave();
      });
    }
    // ---- Krea 风格参考图（只在 Krea 下显示）
    if (el.styleRefPickBtn) {
      el.styleRefPickBtn.addEventListener("click", () => el.styleRefInput?.click());
    }
    if (el.styleRefInput) {
      el.styleRefInput.addEventListener("change", () => {
        if (el.styleRefInput.files?.length) queueStyleRefFiles(el.styleRefInput.files);
        el.styleRefInput.value = "";
      });
    }
    if (el.styleRefClearBtn) {
      el.styleRefClearBtn.addEventListener("click", () => {
        if (!state.styleRefImages.length) return;
        state.styleRefImages = [];
        renderStyleRefStrip();
        updateStyleRefHint();
        updateAdvancedSummary();
        snack("已清空风格参考图");
      });
    }
    if (el.controlStrength) {
      el.controlStrength.addEventListener("input", () => {
        if (el.controlStrengthOut) el.controlStrengthOut.textContent = Number(el.controlStrength.value).toFixed(2);
        updateControlnetHint();
        updateAdvancedSummary();
        scheduleSave();
      });
    }
    el.replaceRef.addEventListener("click", (event) => { event.stopPropagation(); el.fileInput.click(); });
    el.removeRef.addEventListener("click", (event) => { event.stopPropagation(); clearRefImage(); });

    $$("[data-generate]").forEach((button) => button.addEventListener("click", generate));
    el.stopInline.addEventListener("click", interrupt);
    el.stopMobile.addEventListener("click", interrupt);
    if (el.mobileViews) {
      $$(".mobile-view", el.mobileViews).forEach((button) => {
        button.addEventListener("click", () => {
          const target = button.dataset.mobileTarget;
          if (target === mobileViewState.current && isMobileLayout()) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          setMobileView(target, { scroll: true });
        });
      });
    }
    if (el.mobileToPrompt) {
      el.mobileToPrompt.addEventListener("click", () => {
        setMobileView("prompt", { scroll: true, top: 0 });
        setTimeout(() => el.prompt.focus(), 140);
      });
    }

    el.result.addEventListener("click", openLightbox);
    el.result.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLightbox();
      }
    });
    el.download.addEventListener("click", downloadCurrent);
    el.favoriteCurrent.addEventListener("click", toggleCurrentFavorite);
    el.sameSeed.addEventListener("click", sameSeed);
    el.again.addEventListener("click", again);
    el.toImg2img.addEventListener("click", sendCurrentToImg2img);
    el.loadParams.addEventListener("click", loadCurrentParams);
    el.clearHistory.addEventListener("click", clearHistory);
    el.galleryBtn.addEventListener("click", openGallery);
    el.openGallery.addEventListener("click", openGallery);
    el.closeGallery.addEventListener("click", () => { el.galleryDialog.open = false; });
    el.galleryDialog.addEventListener("closed", () => {
      if (galleryState.selecting) setGallerySelecting(false);
    });
    el.galleryRefresh.addEventListener("click", () => loadGallery({ reset: true }));
    el.galleryOpenFolder.addEventListener("click", openGalleryFolder);
    el.galleryMore.addEventListener("click", () => loadGallery());
    el.gallerySelect.addEventListener("click", () => setGallerySelecting(!galleryState.selecting));
    el.gallerySelectAll.addEventListener("click", toggleGallerySelectAllPage);
    el.gallerySelectClear.addEventListener("click", () => {
      if (galleryState.batchBusy) return;
      galleryState.selected.clear();
      updateGallerySelectionUI();
    });
    el.gallerySelectDone.addEventListener("click", () => {
      if (galleryState.batchBusy) return;
      setGallerySelecting(false);
    });
    el.galleryBatchFavorite.addEventListener("click", batchToggleGalleryFavorite);
    el.galleryBatchExport.addEventListener("click", batchExportGallery);
    el.galleryBatchSend.addEventListener("click", sendSelectedGalleryToImg2img);
    el.galleryBatchDelete.addEventListener("click", batchDeleteGallery);
    el.galleryFilter.addEventListener("change", () => {
      if (galleryState.selecting) setGallerySelecting(false);
      galleryState.filter = el.galleryFilter.value || "all";
      refreshGalleryFolderButton();
      loadGallery({ reset: true });
    });
    el.openOutput.addEventListener("click", openOutputFolder);
    el.openOutputFoot.addEventListener("click", openOutputFolder);
    el.lightboxDownload.addEventListener("click", downloadLightbox);
    el.lightboxPrev.addEventListener("click", () => stepLightbox(-1));
    el.lightboxNext.addEventListener("click", () => stepLightbox(1));
    // 触屏左右轻扫同样翻页；只认单指水平位移，避免误触竖直操作。
    let lightboxSwipe = null;
    let lightboxPinch = null;
    el.lightboxBody.addEventListener("touchstart", (event) => {
      if (!el.lightboxDialog.open || event.touches.length !== 1) return;
      const touch = event.touches[0];
      lightboxSwipe = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }, { passive: true });
    el.lightboxBody.addEventListener("touchcancel", () => { lightboxSwipe = null; lightboxPinch = null; }, { passive: true });
    el.lightboxBody.addEventListener("touchend", (event) => {
      lightboxPinch = null;
      if (!lightboxSwipe) return;
      const start = lightboxSwipe;
      lightboxSwipe = null;
      if (lightboxView.zoom > 1.001) return;
      const touch = event.changedTouches[0];
      if (!touch || Date.now() - start.at > 700) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) >= 45 && Math.abs(dx) >= Math.abs(dy) * 1.4) {
        stepLightbox(dx < 0 ? 1 : -1);
        return;
      }
      // 1× 时下滑关闭：手机单手退出大图，比够右上角更顺。
      if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        el.lightboxDialog.open = false;
        state.lightboxItem = null;
        resetLightboxView();
      }
    }, { passive: true });
    // 双指缩放：以双指中点为中心，1×–6×；与左右滑翻页共用 touch 通道。
    el.lightboxBody.addEventListener("touchstart", (event) => {
      if (!el.lightboxDialog.open || event.touches.length !== 2) return;
      const [a, b] = event.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      if (dist < 8) return;
      lightboxPinch = {
        startDist: dist,
        startZoom: lightboxView.zoom,
        centerX: (a.clientX + b.clientX) / 2,
        centerY: (a.clientY + b.clientY) / 2
      };
      lightboxSwipe = null;
    }, { passive: true });
    el.lightboxBody.addEventListener("touchmove", (event) => {
      if (!lightboxPinch || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = event.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      if (dist < 8) return;
      zoomLightboxAt(lightboxPinch.startZoom * (dist / lightboxPinch.startDist), lightboxPinch.centerX, lightboxPinch.centerY);
    }, { passive: false });
    el.lightboxFavorite.addEventListener("click", () => { toggleLightboxFavorite(); });
    el.lightboxSend.addEventListener("click", sendLightboxToImg2img);
    el.lightboxDelete.addEventListener("click", () => {
      if (state.lightboxItem) deleteGalleryItem(state.lightboxItem);
      else if (state.current) deleteResultLightboxItem(state.current);
    });
    // 滚轮缩放：以指针位置为锚点，1×–6×。
    el.lightboxBody.addEventListener("wheel", (event) => {
      if (!el.lightboxDialog.open) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const delta = event.deltaY * unit;
      if (!delta) return;
      event.preventDefault();
      zoomLightboxAt(lightboxView.zoom * Math.exp(-delta * 0.0015), event.clientX, event.clientY);
    }, { passive: false });
    let lightboxDrag = null;
    el.lightboxImg.addEventListener("pointerdown", (event) => {
      if (!el.lightboxDialog.open || lightboxView.zoom <= 1.001 || event.button !== 0) return;
      lightboxDrag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: lightboxView.x,
        panY: lightboxView.y
      };
      el.lightboxImg.setPointerCapture(event.pointerId);
      el.lightboxBody.classList.add("is-dragging");
    });
    el.lightboxImg.addEventListener("pointermove", (event) => {
      if (!lightboxDrag || event.pointerId !== lightboxDrag.id) return;
      lightboxView.x = lightboxDrag.panX + (event.clientX - lightboxDrag.x);
      lightboxView.y = lightboxDrag.panY + (event.clientY - lightboxDrag.y);
      clampLightboxPan();
      applyLightboxView();
    });
    const endLightboxDrag = (event) => {
      if (!lightboxDrag || (event && event.pointerId !== lightboxDrag.id)) return;
      lightboxDrag = null;
      el.lightboxBody.classList.remove("is-dragging");
    };
    el.lightboxImg.addEventListener("pointerup", endLightboxDrag);
    el.lightboxImg.addEventListener("pointercancel", endLightboxDrag);
    el.lightboxImg.addEventListener("load", () => {
      if (lightboxView.zoom > 1.001) {
        clampLightboxPan();
        applyLightboxView();
      }
    });
    el.lightboxImg.addEventListener("dblclick", () => {
      if (!el.lightboxDialog.open) return;
      zoomLightboxAt(lightboxView.zoom > 1.001 ? 1 : 2.5);
    });
    document.addEventListener("keydown", (event) => {
      if (!el.lightboxDialog.open || el.galleryInfoDialog.open) return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tag = String(event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
      event.preventDefault();
      stepLightbox(event.key === "ArrowLeft" ? -1 : 1);
    });
    el.lightboxInfo.addEventListener("click", () => {
      if (state.lightboxItem) openGalleryInfo(state.lightboxItem);
    });
    el.lightboxUpscale.addEventListener("click", openUpscaleFromLightbox);
    el.galleryInfoUpscale.addEventListener("click", openUpscaleFromInfo);
    el.closeUpscale.addEventListener("click", () => { el.upscaleDialog.open = false; });
    el.upscalePreviewBtn.addEventListener("click", () => runUpscalePreview());
    el.upscaleSave.addEventListener("click", saveUpscale);
    el.upscaleExport.addEventListener("click", exportUpscale);
    el.upscaleScale.addEventListener("change", handleUpscaleSettingChange);
    el.upscaleAlgo.addEventListener("change", handleUpscaleSettingChange);
    el.upscaleDialog.addEventListener("closed", () => {
      upscaleSeq += 1;
      state.upscaleBusy = false;
      state.upscalePreview = "";
      state.upscaleSavedPath = "";
      state.upscaleKey = "";
      el.upscaleImg.removeAttribute("src");
      el.upscaleImg.hidden = true;
    });
    el.queueBtn.addEventListener("click", openQueueDialog);
    el.closeQueue.addEventListener("click", () => { el.queueDialog.open = false; });
    el.queueDialog.addEventListener("closed", () => {
      if (state.queueTimer) {
        clearInterval(state.queueTimer);
        state.queueTimer = null;
      }
      refreshQueueBadge();
    });
    el.closeLightbox.addEventListener("click", () => {
      el.lightboxDialog.open = false;
      state.lightboxItem = null;
      resetLightboxView();
    });
    el.closeGalleryInfo.addEventListener("click", () => { el.galleryInfoDialog.open = false; });
    el.galleryInfoCopyPrompt.addEventListener("click", () => copyGalleryInfoField("prompt"));
    el.galleryInfoCopyNegative.addEventListener("click", () => copyGalleryInfoField("negative"));
    el.galleryInfoLoad.addEventListener("click", loadGalleryInfoParams);
    el.galleryInfoSend.addEventListener("click", () => {
      const item = state.galleryInfoItem;
      if (!item) return;
      el.galleryInfoDialog.open = false;
      el.lightboxDialog.open = false;
      sendGalleryToImg2img(item);
    });

    el.cancelSavePreset.addEventListener("click", () => { el.savePresetDialog.open = false; });
    el.confirmSavePreset.addEventListener("click", confirmSavePreset);
    el.presetName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSavePreset();
      }
    });
    el.saveCurrentFromList.addEventListener("click", () => { el.savedDialog.open = false; openSavePresetDialog(); });
    el.closeSaved.addEventListener("click", () => { el.savedDialog.open = false; });
    if (el.importPresetFile && el.presetFileInput) {
      el.importPresetFile.addEventListener("click", () => el.presetFileInput.click());
      el.presetFileInput.addEventListener("change", async () => {
        const files = Array.from(el.presetFileInput.files || []);
        el.presetFileInput.value = "";
        if (!files.length) return;
        // 多选时依次应用，最后一份生效——和拖拽只取第一个文件保持一致的心智模型
        for (const file of files) {
          try {
            await applyPresetJson(await file.text());
          } catch (err) {
            snack(`${file.name}：${err.message}`, { bad: true });
          }
        }
      });
    }
    if (el.exportPresetFile) el.exportPresetFile.addEventListener("click", exportPresetJson);
    bindPresetDrop();
    el.refinePresetsBtn.addEventListener("click", openRefineDialog);
    el.closeRefineDialog.addEventListener("click", () => { el.refineDialog.open = false; });

    const advancedReset = document.createElement("button");
    advancedReset.type = "button";
    advancedReset.className = "text-link";
    advancedReset.textContent = "恢复默认设置";
    advancedReset.addEventListener("click", resetAll);
    ($(".side-reset", el.advanced) || el.advanced).appendChild(advancedReset);

    // 下拉方向自己定：优先向下，下方放不下才向上；两侧都不够就按可用空间收缩，
    // 避免 MDUI 的 auto 在长菜单时突然左右弹或盖住字段。
    const selectFromEvent = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      return path.find((node) => node instanceof HTMLElement && node.tagName === "MDUI-SELECT") || null;
    };
    const prepareSelectMenu = (select) => {
      if (!select || select.disabled) return;
      const items = select.querySelectorAll("mdui-menu-item").length;
      if (!items) return;
      const box = select.getBoundingClientRect();
      const cap = Math.min(window.innerHeight * 0.4, 320);
      const content = Math.min(items * 48, cap);
      // 统一向下：下方不够就按可用高度收缩并内部滚动，只有快到屏幕底部
      // （不足 140px）才向上翻，避免菜单在相邻字段之间上上下下。
      const below = window.innerHeight - box.bottom - 10;
      const above = box.top - 10;
      let placement = "bottom";
      if (below < 140 && above > below) placement = "top";
      // 只改内部 dropdown 的方向，不改 select 自己的 placement：
      // 后者会触发 select 重渲染，把用户正按下的文本框换掉，点击就丢了。
      const dropdown = select.shadowRoot?.querySelector("mdui-dropdown");
      if (dropdown) dropdown.placement = placement === "bottom" ? "bottom-start" : "top-start";
      // 用宿主上的 CSS 变量而不是菜单内联样式：下拉重渲染后仍然生效。
      const space = Math.max(0, placement === "bottom" ? below : above);
      if (space < content) {
        select.style.setProperty("--select-menu-max", `${Math.max(120, Math.floor(space))}px`);
      } else {
        select.style.removeProperty("--select-menu-max");
      }
    };
    document.addEventListener("pointerdown", (event) => {
      prepareSelectMenu(selectFromEvent(event));
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
      prepareSelectMenu(selectFromEvent(event));
    }, true);

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (anyDialogOpen()) return;
        if (state.busy) interrupt();
        else generate();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target) || anyDialogOpen()) return;
      if (event.key >= "1" && event.key <= "4") {
        event.preventDefault();
        const tierKey = ["draft", "standard", "fine", "hires"][Number(event.key) - 1];
        el.qualityGroup.value = tierKey;
        applyQuality(tierKey);
        snack(`画质：${qualityLabel(tierKey, qualityTier(tierKey) || {})}`);
        return;
      }
      if (event.key === "5" && isAnimaActive()) {
        event.preventDefault();
        el.qualityGroup.value = "gacha";
        applyQuality("gacha");
        return;
      }
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        cycleBatch();
      }
    });

    window.addEventListener("beforeunload", () => {
      saveSettings();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        saveSettings();
      }
    });
  }

  /* ------------------------------------------------------------------- init */
  function init() {
    hydrateIcons();
    const storedTheme = (() => { try { return localStorage.getItem(STORE_THEME); } catch { return null; } })();
    applyTheme(storedTheme || "auto", { persist: false });
    if (typeof systemDark.addEventListener === "function") {
      systemDark.addEventListener("change", () => {
        if (state.theme !== "auto") return;
        updateThemeMeta();
        el.themeMenuHint.textContent = `当前：跟随系统 · ${resolvedTheme() === "dark" ? "深色" : "浅色"}`;
      });
    }

    pendingPresetApply = migratePresetDefaults();
    renderStyleStrip();
    renderRecipes();
    renderPlaceholderIdeas();
    hydrateIcons();
    bindEvents();
    const positiveTotal = TAG_GROUPS.reduce((sum, group) => sum + group.tags.length, 0);
    const negativeTotal = NEGATIVE_TAG_GROUPS.reduce((sum, group) => sum + group.tags.length, 0);
    const helpTagCount = $("#helpTagCount");
    const helpNegTagCount = $("#helpNegTagCount");
    if (helpTagCount) helpTagCount.textContent = String(positiveTotal);
    if (helpNegTagCount) helpNegTagCount.textContent = String(negativeTotal);
    if (el.artistDesc) {
      el.artistDesc.textContent = `${ARTIST_TOTAL} 位画师 · ${ARTIST_GROUPS.length} 个风格族，全部来自 Anima 训练索引；1 位最稳，2–4 位按权重混合。`;
    }
    if (el.artistResultCount) el.artistResultCount.textContent = `${ARTIST_TOTAL} 位画师`;
    const savedCharacterMode = readJSON("klock.characterMode", "adult");
    state.characterMode = CHARACTER_LIBRARIES[savedCharacterMode] ? savedCharacterMode : "adult";
    if (el.characterModeSwitch) el.characterModeSwitch.value = state.characterMode;
    refreshCharacterCopy();

    restoreSettings();
    renderVaeOptions();
    populateUpscalerSelect();
    updatePromptUI();
    updateSeedUI({ preserve: true });
    setMode(state.mode, { save: false, silent: true });
    updateRatioSelection();
    updateHiresUI();
    // 恢复上次的折叠状态（首次运行默认展开，不擅自藏东西）
    setParamFolded(readJSON("klock.paramFolded", false) === true, { save: false });
    updateQualityHint();
    updateAdvancedSummary();
    updateMobileHint();
    hydrateHelperTitles();
    watchHelperTitles();
    renderRef();
    renderHistory();
    restoreServerHistory();
    refreshQueueBadge();
    refreshStatus();
    loadModels({ silent: true });
    loadLoras({ silent: true });
    setInterval(() => {
      refreshStatus();
      refreshQueueBadge();
    }, 6000);

    // 只读调试入口：仅供本地自动化验收读取内部状态，不属于公开 API。
    window.__klockui = {
      loraState: () => ({
        loaded: state.lorasLoaded,
        available: state.loras.map((item) => item.name),
        active: activeLorasPayload()
      }),
      loraPrompt: () => rewriteLoraTags(currentConfig().prompt),
      ratingState: () => ({
        rating: state.rating,
        tag: ratingTag(),
        prompt: applyManualRating(rewriteLoraTags(currentConfig().prompt))
      }),
      config: () => currentConfig(),
      promptDraftState: () => ({
        busy: state.promptDraftBusy,
        error: state.promptDraftError,
        collapsed: state.promptDraftCollapsed,
        fresh: promptDraftFresh(),
        draft: state.promptDraft ? {
          body: state.promptDraft.body,
          prompt: state.promptDraft.prompt,
          prefix: state.promptDraft.prefix,
          mode: state.promptDraft.mode,
          arch: state.promptDraft.arch,
          tags: state.promptDraft.tags,
          edited: state.promptDraft.edited
        } : null
      }),
      requestPreview: () => {
        const request = buildRequest();
        return request ? { endpoint: request.endpoint, payload: request.payload, config: request.cfg } : null;
      }
    };
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();


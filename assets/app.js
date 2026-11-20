(() => {
  "use strict";

  // 公共件集中在 assets/ui.js：建元素、架构名、绑定关弹窗、防抖。
  const { h, archLabel, bindDialog, debounce } = window.KUI || {};
  // 只读数据在 assets/data.js，必须先加载
  const { QUALITY_GENERIC, REFINE_PRESETS, REFINE_PRESETS_KREA, MODEL_PROFILES, MOSS_STYLES, MOSS_PRESET_GROUPS, MOSS_TAG_GROUPS, MOSS_NEGATIVE_TAG_GROUPS, MOSS_CHARACTER_GROUPS, KREA_PRESET_GROUPS, KREA_TAG_GROUPS, KREA_CHARACTER_GROUPS, SAMPLER_PRESETS, RECIPES, TAG_GROUPS, NEGATIVE_TAG_GROUPS, ICONS, LORA_ORDER, LORA_LIBRARY, CHARACTER_TAG_ZH } = window.KLOCK_DATA;

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

  // 细化重绘内置预设：提示词只写细节后缀，套用时接在原提示词末尾。

  // Krea 版的细化预设：同样 9 项、同样的重绘幅度，但描述体改成「英文句子」。
  // 上面那套是 Danbooru 标签串，交给 Qwen3-VL 只会被当成一串孤立名词，
  // 细腻度远不如一句话讲清「看哪里、光从哪来」。

  function refinePresetsFor(arch) {
    return arch === "krea" ? REFINE_PRESETS_KREA : REFINE_PRESETS;
  }

  // 各自模型的推荐档。Anima 是流匹配架构（Qwen3 编码器 + Qwen-Image VAE），
  // 每个 Anima 底模单独一份档案；Nova / Pony 是 SDXL 标签体系，各自一份；
  // 通用 SDXL 沿用原有推荐。档案按顺序匹配，先列具体模型再列通用兜底。
  const MODEL_PROFILE_LIST = Object.values(MODEL_PROFILES);
  // 质量前缀之间存在前缀包含关系（Anima 通用前缀是 MiaoMiao 前缀的开头），
  // 必须按长度倒序匹配，否则切换模型时只剥掉半截前缀。
  const QUALITY_PREFIXES = MODEL_PROFILE_LIST.map((profile) => profile.qualityPrefix)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  // MOSS 的画风靠自然语言，不吃 Danbooru 画师标签（@yd、artist:xxx 这类对它无效）。
  // 所以这里给的是中文风格短语，点一下直接拼进提示词，不经过 4B 转写。
  // text 就是最终写进提示词的那句，保持可读、可手改；不同组的词条可以叠加。

  // 按维度分组，分类条一次只显示一组，避免几十个词条把提示词区撑爆。
  let mossPresetGroup = "style";

  // ============================================================
  // MOSS 专用中文词库：MOSS 的 TE 读中文远比 Danbooru 标签准，
  // 所以切到 MOSS 后，标签库 / 角色库 / 负面词全部换成这一套，
  // 写入提示词的也是中文，不掺任何英文标签。
  // 结构沿用原格式：[写入提示词的片段, 界面上显示的短名]。
  // ============================================================


  // MOSS 角色库：用中文外貌描述写入提示词，界面上显示短名。

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

  // 可拼装子句：每条都是「描述一件事」的短语，逗号连接进自己的句子里。

  // 角色描述：Krea 不懂 Danbooru 罗马音，用「年龄 + 外观 + 服装」的英文短句。

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

  // 负面标签库只收录画质、结构、水印等排错词。

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
    loraSearch: $("#loraSearch"), loraOnlyActive: $("#loraOnlyActive"),
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
    zoomCurrent: $("#zoomCurrent"),
    history: $("#history"), historyCount: $("#historyCount"), historyEmpty: $("#historyEmpty"), clearHistory: $("#clearHistory"),
    openGallery: $("#openGallery"), galleryDialog: $("#galleryDialog"), galleryFilter: $("#galleryFilter"),
    galleryGrid: $("#galleryGrid"), galleryStatus: $("#galleryStatus"), galleryCount: $("#galleryCount"),
    galleryEmpty: $("#galleryEmpty"), galleryEmptyTitle: $("#galleryEmptyTitle"), galleryEmptyHint: $("#galleryEmptyHint"),
    galleryMore: $("#galleryMore"), galleryMoreWrap: $("#galleryMoreWrap"), closeGallery: $("#closeGallery"),
    galleryRefresh: $("#galleryRefresh"), galleryOpenFolder: $("#galleryOpenFolder"),
    gallerySelect: $("#gallerySelect"),
    gallerySelectCount: $("#gallerySelectCount"),
    gallerySelectClear: $("#gallerySelectClear"), gallerySelectDone: $("#gallerySelectDone"),
    galleryBatchBar: $("#galleryBatchBar"),
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
    repoPresets: $("#repoPresets"), repoPresetCount: $("#repoPresetCount"),
    promptHistoryBtn: $("#promptHistoryBtn"), promptHistoryDialog: $("#promptHistoryDialog"),
    promptHistoryList: $("#promptHistoryList"), promptHistorySearch: $("#promptHistorySearch"),
    promptHistoryClear: $("#promptHistoryClear"), promptHistoryClose: $("#promptHistoryClose"),
    openCompare: $("#openCompare"), compareDialog: $("#compareDialog"), compareA: $("#compareA"),
    compareB: $("#compareB"), compareMetaA: $("#compareMetaA"), compareMetaB: $("#compareMetaB"),
    compareDiff: $("#compareDiff"), compareSwap: $("#compareSwap"), comparePrev: $("#comparePrev"),
    compareNext: $("#compareNext"), compareClose: $("#compareClose"),
    presetEditDialog: $("#presetEditDialog"), presetEditFile: $("#presetEditFile"),
    presetEditText: $("#presetEditText"), presetEditStatus: $("#presetEditStatus"),
    formatPresetEdit: $("#formatPresetEdit"), cancelPresetEdit: $("#cancelPresetEdit"),
    savePresetEdit: $("#savePresetEdit"), repoPresetNew: $("#repoPresetNew"),
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
    loraQuery: "",
    loraOnlyActive: false,
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
    previewStream: null,
    sseActive: false,
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
    items: [], filter: "all", offset: 0, fetched: 0, limit: 60,
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
      el.shiftOut.textContent = String(Number(el.shift.value));
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
    // 保留两位：Krea 2 的内置 shift 是 1.15，按一位取整会被抹成 1.1 或 1.2。
    return Math.min(6, Math.max(1, Math.round(number * 100) / 100));
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

  // 180 支 LoRA 时光靠分类翻太慢，加一个即时过滤：名称 / 文件名 / 触发词 / 说明都参与匹配。
  function loraMatchesQuery(entry, query) {
    if (!query) return true;
    const info = loraInfo(entry.name);
    const hay = [
      entry.name,
      info?.title || "",
      info?.triggers || "",
      info?.desc || ""
    ].join(" ").toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
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
    { id: "character", label: "角色" },
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
    // 角色包统一用 _char_ 命名，判据简单可靠；再兜几个常见角色名
    ["character", /_char_|hatsune|miku|marin_kitagawa|pekomama|zyloo|anna_yamada|kallen/],
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
    const query = String(state.loraQuery || "").trim();
    const catList = state.loraCategory === "all"
      ? archList
      : archList.filter((entry) => loraCategoryOf(entry.name) === state.loraCategory);
    let list = query ? catList.filter((entry) => loraMatchesQuery(entry, query)) : catList;
    if (state.loraOnlyActive) {
      list = list.filter((entry) => Boolean(findActiveLora(entry.name)));
    }
    // 已启用的排前面：调权重时不用回滚列表找
    list = [...list].sort((a, b) => Number(Boolean(findActiveLora(b.name))) - Number(Boolean(findActiveLora(a.name))));
    // 隐藏数只算「别的架构」，别把当前过滤条件也算进去（否则 3 条时会显示隐藏 177 条）
    const hidden = all.length - archList.length;
    el.loraList.replaceChildren();
    el.loraEmpty.hidden = list.length > 0;
    if (!list.length && state.loraOnlyActive) {
      el.loraEmpty.textContent = "当前架构下还没有启用任何 LoRA。";
    } else if (!list.length && query) {
      el.loraEmpty.textContent = `没有匹配「${query}」的 LoRA。`;
    } else if (!list.length && archList.length) {
      const cat = LORA_CATEGORIES.find((c) => c.id === state.loraCategory);
      el.loraEmpty.textContent = `当前模型下没有「${cat ? cat.label : ""}」分类的 LoRA。`;
    } else if (!list.length) {
      el.loraEmpty.textContent = "还没有安装 LoRA。把 .safetensors 放进 D:////AI////models////loras 后点刷新。";
    }
    if (el.loraDialogHint) {
      const base = state.lorasLoading
        ? "读取中…"
        : state.lorasLoaded
          ? (state.loraOnlyActive
              ? `${list.length} 个已启用 · 共 ${archList.length} 个适配当前模型`
              : `${archList.length} 个适配当前模型 · ${state.activeLoras.length} 个启用`)
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
    // 每次打开都重置搜索：否则上次的过滤词会让人以为 LoRA 没了
    if (state.loraQuery) {
      state.loraQuery = "";
      if (el.loraSearch) el.loraSearch.value = "";
    }
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
    const ratio = String(size.ratio || "").trim();
    const w = Number(size.width);
    const h = Number(size.height);
    // 先认比例键：它决定界面上哪一档高亮，比像素更能表达作者意图。
    if (ratio) {
      const table = ratioTableFor(activeProfile()?.arch || "sdxl");
      const opt = table.find((item) => item.key === ratio);
      if (opt) {
        cfg.ratioKey = ratio;
        // 没有显式像素时才用档位默认值；有就用作者的
        cfg.width = w >= 256 ? w : opt.w;
        cfg.height = h >= 256 ? h : opt.h;
        return cfg;
      }
    }
    if (w >= 256 && h >= 256) {
      cfg.width = w;
      cfg.height = h;
      cfg.ratioKey = "custom";
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
    // 三级匹配：指定模型 → 同架构任意模型 → 保持当前。
    // 配方是拿去分享的，写死的模型名大概率对方没有（同一个架构有一堆微调），
    // 所以 arch 兜底比死磕文件名实用。
    let modelSkipped = "";
    let modelNote = "";
    const wantModel = String(data.model || "").trim();
    const wantArch = String(data.arch || "").trim().toLowerCase();
    const currentArch = (activeProfile()?.arch || "").toLowerCase();
    const entry = wantModel ? presetModelEntry(wantModel) : null;
    if (wantModel && activeModelMatches(wantModel)) {
      // 已经是当前模型，什么都不做
    } else if (entry) {
      const switched = await switchModel(entry.value, { preserveSettings: true, silent: true });
      if (!switched) modelSkipped = wantModel;
    } else if (wantArch) {
      const candidates = state.models.filter((item) => (archForModel(item.value) || "") === wantArch);
      const pick = candidates.find((item) => !activeModelMatches(item.value)) || null;
      if (currentArch === wantArch) {
        // 当前模型就是同架构的，直接用，不折腾切换
        if (wantModel) modelNote = `配方指定 ${modelShortName(wantModel)}，已用同架构的当前模型`;
      } else if (pick) {
        const switched = await switchModel(pick.value, { preserveSettings: true, silent: true });
        if (switched) modelNote = `配方指定 ${modelShortName(wantModel) || wantArch}，已改用同架构的 ${modelShortName(pick.value)}`;
        else modelSkipped = wantModel || wantArch;
      } else {
        modelSkipped = wantModel || wantArch;
      }
    } else if (wantModel) {
      modelSkipped = wantModel;
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
      else if (modelNote) notes.unshift(modelNote);
      snack(notes.length ? `已载入「${name}」· ${notes.join("；")}` : `已载入「${name}」`);
    }
    return { ok: true, name, notes, modelSkipped, modelNote };
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
      el.shiftOut.textContent = String(Number(el.shift.value));
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

  // 仓库自带的 presets/*.json：直接从服务端读，省得用户去文件管理器翻目录
  let repoPresetCache = null;

  async function loadRepoPresets(force = false) {
    if (!el.repoPresets) return;
    if (repoPresetCache && !force) {
      renderRepoPresets(repoPresetCache);
      return;
    }
    try {
      const res = await fetch("/local/presets", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      repoPresetCache = Array.isArray(data.items) ? data.items : [];
    } catch {
      repoPresetCache = [];
    }
    renderRepoPresets(repoPresetCache);
  }

  /* ------------------------------------------------------- 提示词历史 */
  // 本地保存最近 30 条提交过的提示词。生成很贵，重跑一次旧配置比重新打字划算。
  const STORE_PROMPT_HISTORY = "simplegen.promptHistory.v1";
  const PROMPT_HISTORY_MAX = 30;

  function loadPromptHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_PROMPT_HISTORY) || "[]");
      return Array.isArray(raw) ? raw.filter((item) => item && item.prompt) : [];
    } catch {
      return [];
    }
  }

  function rememberPrompt(prompt, negative) {
    const text = String(prompt || "").trim();
    if (text.length < 4) return;
    const list = loadPromptHistory().filter((item) => item.prompt !== text);
    list.unshift({
      prompt: text,
      negative: String(negative || "").trim(),
      model: state.activeModel || "",
      steps: Number(el.steps?.value) || 0,
      at: Date.now()
    });
    try {
      localStorage.setItem(STORE_PROMPT_HISTORY, JSON.stringify(list.slice(0, PROMPT_HISTORY_MAX)));
    } catch {
      /* 配额满就算了，历史不是关键路径 */
    }
  }

  function renderPromptHistory() {
    if (!el.promptHistoryList) return;
    const query = String(el.promptHistorySearch?.value || "").trim().toLowerCase();
    const all = loadPromptHistory();
    const list = query
      ? all.filter((item) => `${item.prompt} ${item.negative}`.toLowerCase().includes(query))
      : all;
    el.promptHistoryList.replaceChildren();
    if (!list.length) {
      el.promptHistoryList.appendChild(
        h("div", { class: "compare-empty", text: query ? "没有匹配的历史提示词。" : "还没有历史。生成一次之后这里会留下最近的提示词。" })
      );
      return;
    }
    list.forEach((item) => {
      const when = new Date(item.at || Date.now());
      const stamp = `${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const meta = [stamp, item.steps ? `${item.steps} 步` : "", item.model ? item.model.replace(/\.safetensors$/, "") : ""]
        .filter(Boolean).join(" · ");
      el.promptHistoryList.appendChild(
        h("button", { class: "prompt-history-item", type: "button", on: { click: () => applyPromptHistory(item) } },
          h("span", { class: "prompt-history-text", text: item.prompt }),
          h("span", { class: "prompt-history-meta", text: meta })
        )
      );
    });
  }

  function applyPromptHistory(item) {
    if (!item) return;
    if (el.prompt) el.prompt.value = item.prompt;
    if (el.negative && item.negative !== undefined) el.negative.value = item.negative;
    saveSettings();
    state.promptDraft = null;
    el.promptHistoryDialog.open = false;
    snack("已载入历史提示词");
  }

  /* ------------------------------------------------------- 画面对比 */
  // 只做「看」的事：不写文件、不改状态，A/B 只是历史里的两个索引。
  const compareState = { a: 0, b: 1, scale: 1, x: 0, y: 0 };

  function compareableHistory() {
    return state.history.filter((item) => item && item.url);
  }

  function fmtCompareMeta(item) {
    if (!item) return "—";
    const bits = [`${item.finalWidth}×${item.finalHeight}`];
    if (item.steps) bits.push(`${item.steps} 步`);
    if (item.cfg !== undefined && item.cfg !== "—") bits.push(`CFG ${item.cfg}`);
    if (item.sampler) bits.push(`${item.sampler}${item.scheduler ? " · " + item.scheduler : ""}`);
    if (item.seed !== null && item.seed !== undefined) bits.push(`seed ${item.seed}`);
    return bits.join(" · ");
  }

  function compareFieldRows(a, b) {
    const norm = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
    const rows = [
      ["提示词", a.prompt, b.prompt],
      ["负面词", a.negative, b.negative],
      ["模型", a.model, b.model],
      ["尺寸", `${a.finalWidth}×${a.finalHeight}`, `${b.finalWidth}×${b.finalHeight}`],
      ["步数", a.steps, b.steps],
      ["CFG", a.cfg, b.cfg],
      ["采样器", a.sampler, b.sampler],
      ["调度器", a.scheduler, b.scheduler],
      ["种子", a.seed, b.seed],
      ["重绘幅度", a.denoise, b.denoise],
      ["二采", a.hires ? `开 ×${a.hrScale || 1.25}` : "关", b.hires ? `开 ×${b.hrScale || 1.25}` : "关"],
      // 耗时放进来：加步数/开二采的代价一眼能看到，比只看画面更能量化
      ["耗时", a.totalElapsed ? `${Number(a.totalElapsed).toFixed(1)}s` : "—",
               b.totalElapsed ? `${Number(b.totalElapsed).toFixed(1)}s` : "—"]
    ];
    return rows
      .map(([key, va, vb]) => [key, norm(va), norm(vb)])
      .filter(([, va, vb]) => va !== vb);
  }

  function applyCompareTransform() {
    const t = `translate(${compareState.x}px, ${compareState.y}px) scale(${compareState.scale})`;
    [el.compareA, el.compareB].forEach((img) => {
      if (img) img.style.transform = t;
    });
  }

  function renderCompare() {
    const items = compareableHistory();
    if (!items.length) {
      if (el.compareEmpty) el.compareEmpty.hidden = false;
      return;
    }
    compareState.a = Math.min(compareState.a, items.length - 1);
    compareState.b = Math.min(compareState.b, items.length - 1);
    const a = items[compareState.a];
    const b = items[compareState.b];
    if (el.compareA) el.compareA.src = a.url;
    if (el.compareB) el.compareB.src = b.url;
    if (el.compareMetaA) el.compareMetaA.textContent = `A · ${fmtCompareMeta(a)}`;
    if (el.compareMetaB) el.compareMetaB.textContent = `B · ${fmtCompareMeta(b)}`;
    if (!el.compareDiff) return;
    el.compareDiff.replaceChildren();
    const rows = compareFieldRows(a, b);
    if (!rows.length) {
      el.compareDiff.appendChild(h("div", { class: "compare-empty", text: "两张图的参数完全一致（只有画面内容不同）。" }));
      return;
    }
    rows.forEach(([key, va, vb]) => {
      el.compareDiff.appendChild(
        h("div", { class: "compare-row" },
          h("span", { class: "k", text: key }),
          h("span", { class: "v is-diff", text: va }),
          h("span", { class: "v is-diff", text: vb })
        )
      );
    });
    applyCompareTransform();
  }

  function openCompareDialog() {
    const items = compareableHistory();
    if (items.length < 2) {
      snack("至少要有两张作品才能对比", { bad: true });
      return;
    }
    compareState.a = 0;
    compareState.b = 1;
    compareState.scale = 1;
    compareState.x = 0;
    compareState.y = 0;
    renderCompare();
    el.compareDialog.open = true;
  }

  function bindCompareInteractions() {
    if (!el.compareDialog) return;
    const panes = el.compareDialog.querySelectorAll(".compare-frame");
    panes.forEach((frame) => {
      frame.addEventListener("wheel", (event) => {
        event.preventDefault();
        const next = compareState.scale * (event.deltaY > 0 ? 0.92 : 1.08);
        compareState.scale = Math.min(4, Math.max(0.6, next));
        applyCompareTransform();
      }, { passive: false });

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let baseX = 0;
      let baseY = 0;
      frame.addEventListener("pointerdown", (event) => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        baseX = compareState.x;
        baseY = compareState.y;
        frame.setPointerCapture(event.pointerId);
      });
      frame.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        compareState.x = baseX + (event.clientX - startX);
        compareState.y = baseY + (event.clientY - startY);
        applyCompareTransform();
      });
      const stop = (event) => {
        dragging = false;
        try { frame.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
      };
      frame.addEventListener("pointerup", stop);
      frame.addEventListener("pointercancel", stop);
    });

    bindDialog(el.compareDialog, el.compareClose);
    if (el.compareSwap) {
      el.compareSwap.addEventListener("click", () => {
        [compareState.a, compareState.b] = [compareState.b, compareState.a];
        renderCompare();
      });
    }
    // 更早 / 更新的：整组往后或往前挪一张
    const shift = (delta) => {
      const total = compareableHistory().length;
      const nextA = compareState.a + delta;
      const nextB = compareState.b + delta;
      if (nextA < 0 || nextB < 0 || nextA >= total || nextB >= total) return;
      compareState.a = nextA;
      compareState.b = nextB;
      renderCompare();
    };
    if (el.comparePrev) el.comparePrev.addEventListener("click", () => shift(1));
    if (el.compareNext) el.compareNext.addEventListener("click", () => shift(-1));
  }

  // 用 h() 重写：原来 30 行 createElement/append 的堆叠，现在是一棵结构清晰的树。
  function renderRepoPresets(items) {
    if (!el.repoPresets) return;
    el.repoPresets.replaceChildren();
    el.repoPresets.hidden = !items.length;
    if (el.repoPresetCount) el.repoPresetCount.textContent = items.length ? `${items.length} 个` : "";

    items.forEach((item) => {
      const meta = [
        archLabel(item.arch),
        item.steps ? `${item.steps} 步` : "",
        item.loras ? `${item.loras} 支 LoRA` : ""
      ].filter(Boolean).join(" · ");

      el.repoPresets.appendChild(
        h("div", { class: "repo-preset" },
          h("div", { class: "repo-preset-main" },
            h("div", { class: "repo-preset-name", text: item.name }),
            h("div", { class: "repo-preset-meta", text: meta })
          ),
          h("div", { class: "repo-preset-actions" },
            h("mdui-button", { variant: "text", text: "导入", on: { click: () => importRepoPreset(item) } }),
            h("mdui-button", { variant: "text", text: "编辑",
              on: { click: (event) => openInlinePresetEditor(item.file, "", event.currentTarget.closest(".repo-preset")) } })
          )
        )
      );
    });
  }

  /* ------------------------------------------------------- 配方编辑器 */
  function presetJsonError(text) {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) return "顶层必须是一个对象（不是数组或值）";
      if (!data.prompt && !data.name) return "至少要有 name 或 prompt";
      return "";
    } catch (err) {
      // V8 的报错是英文的，前面加中文标签，至少知道是哪一类问题
      const raw = String(err.message || "无法解析");
      const hint = /Unexpected end/i.test(raw) ? "内容不完整，可能少了一个右括号"
        : /Expected property name/i.test(raw) ? "属性名要用双引号包起来"
        : /Unexpected token/i.test(raw) ? "有多余或缺失的符号"
        : /Unexpected non-whitespace/i.test(raw) ? "对象结束后还有多余内容"
        : raw;
      return `JSON 语法错误：${hint}`;
    }
  }

  function setPresetEditStatus(message, ok) {
    if (!el.presetEditStatus) return;
    el.presetEditStatus.textContent = message || "";
    el.presetEditStatus.classList.toggle("is-ok", Boolean(ok && message));
    el.presetEditStatus.classList.toggle("is-bad", Boolean(!ok && message));
  }

  /* -------------------------------------------------- 配方内联编辑
   * 原来点「编辑」弹一个 mdui-dialog，但它是从「我的预设」这个 modal 里再开的
   * 第二个 modal —— 嵌套后打不开。改成直接把编辑区插到被点的那张卡片下面，
   * 既绕开嵌套弹窗，位置也对得上「编辑这张」的直觉。
   */
  let inlinePresetEditor = null;

  function closeInlinePresetEditor() {
    if (!inlinePresetEditor) return;
    inlinePresetEditor.box.remove();
    if (inlinePresetEditor.anchor) inlinePresetEditor.anchor.classList.remove("is-editing");
    inlinePresetEditor = null;
  }

  async function openInlinePresetEditor(file, presetText, anchor) {
    closeInlinePresetEditor();
    let text = presetText;
    if (!text && file) {
      try {
        const res = await fetch(`/local/preset?file=${encodeURIComponent(file)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } catch (err) {
        snack(`读取失败：${err.message}`, { bad: true });
        return;
      }
    }
    if (!text) {
      const cfg = currentConfig();
      text = JSON.stringify({
        klockui: 1, name: "新配方", model: cfg.model, arch: activeProfile()?.arch || "krea",
        prompt: cfg.prompt, negative: cfg.negative, quality: cfg.quality,
        size: { ratio: cfg.ratioKey, width: cfg.width, height: cfg.height },
        steps: cfg.steps, cfg: cfg.cfg, sampler: cfg.sampler, scheduler: cfg.scheduler,
        loras: cfg.loras
      }, null, 2);
    }

    const fileName = file || `preset-${Date.now()}.json`;
    const status = h("span", { class: "preset-edit-status" });
    const area = h("textarea", { class: "preset-edit-text", spellcheck: "false" });
    area.value = text;

    const setStatus = (message, ok) => {
      status.textContent = message || "";
      status.classList.toggle("is-ok", Boolean(ok && message));
      status.classList.toggle("is-bad", Boolean(!ok && message));
    };
    const check = () => {
      const err = presetJsonError(area.value);
      setStatus(err || "格式有效", !err);
      return err;
    };
    check();
    area.addEventListener("input", debounce(check, 260));

    const save = h("mdui-button", {
      variant: "filled", text: "保存",
      on: { click: async () => {
        const err = check();
        if (err) {
          snack("JSON 还有问题，先修一下", { bad: true });
          return;
        }
        let body;
        try { body = JSON.parse(area.value); } catch { return; }
        save.disabled = true;
        try {
          const res = await fetch("/local/preset/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: fileName, json: body })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
          closeInlinePresetEditor();
          repoPresetCache = null;
          await loadRepoPresets(true);
          snack(`已保存 ${fileName}`);
        } catch (error) {
          snack(`保存失败：${error.message}`, { bad: true });
        } finally {
          save.disabled = false;
        }
      } }
    });

    const box = h("div", { class: "preset-inline-editor" },
      h("div", { class: "preset-edit-bar" },
        h("span", { class: "preset-edit-file", text: fileName }),
        status
      ),
      area,
      h("div", { class: "preset-inline-actions" },
        h("mdui-button", {
          variant: "text", text: "格式化",
          on: { click: () => {
            try {
              area.value = JSON.stringify(JSON.parse(area.value), null, 2);
              check();
            } catch (err) {
              setStatus(`JSON 语法错误，无法格式化`, false);
            }
          } }
        }),
        h("mdui-button", { variant: "text", text: "收起", on: { click: closeInlinePresetEditor } }),
        save
      )
    );

    const host = anchor && anchor.isConnected ? anchor : (el.repoPresets || el.savedList);
    if (!host) return;
    host.after(box);
    if (anchor) anchor.classList.add("is-editing");
    inlinePresetEditor = { box, file: fileName, anchor };
    area.focus();
    area.scrollTop = 0;   // focus 会把光标放开头，但滚动位置可能停在中间
    area.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function openPresetEditor(file, presetText) {
    if (!el.presetEditDialog) return;
    el.presetEditFile.textContent = file || "新配方.json";
    el.presetEditFile.dataset.file = file || "";
    let text = presetText;
    if (!text && file) {
      try {
        const res = await fetch(`/local/preset?file=${encodeURIComponent(file)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } catch (err) {
        snack(`读取失败：${err.message}`, { bad: true });
        return;
      }
    }
    if (!text) {
      const cfg = currentConfig();
      text = JSON.stringify({
        klockui: 1, name: "新配方", model: cfg.model, arch: activeProfile()?.arch || "krea",
        prompt: cfg.prompt, negative: cfg.negative, quality: cfg.quality,
        size: { ratio: cfg.ratioKey, width: cfg.width, height: cfg.height },
        steps: cfg.steps, cfg: cfg.cfg, sampler: cfg.sampler, scheduler: cfg.scheduler,
        loras: cfg.loras
      }, null, 2);
    }
    el.presetEditText.value = text;
    const err = presetJsonError(text);
    setPresetEditStatus(err || "格式有效", !err);
    el.presetEditDialog.open = true;
  }

  async function savePresetEdit() {
    const file = el.presetEditFile.dataset.file || `preset-${Date.now()}.json`;
    const text = el.presetEditText.value;
    const err = presetJsonError(text);
    if (err) {
      setPresetEditStatus(err, false);
      snack("JSON 还有问题，先修一下", { bad: true });
      return;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    el.savePresetEdit.disabled = true;
    try {
      const res = await fetch("/local/preset/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, json: body })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      el.presetEditDialog.open = false;
      repoPresetCache = null;
      await loadRepoPresets(true);
      snack(`已保存 ${file}`);
    } catch (error) {
      snack(`保存失败：${error.message}`, { bad: true });
    } finally {
      el.savePresetEdit.disabled = false;
    }
  }

  async function importRepoPreset(item) {
    try {
      const res = await fetch(`/local/preset?file=${encodeURIComponent(item.file)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await applyPresetJson(await res.text());
      el.savedDialog.open = false;
      loadRepoPresets();
    } catch (err) {
      snack(`导入失败：${err.message}`, { bad: true });
    }
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
    loadRepoPresets();
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

  // 耗时预估：只用「同尺寸」的历史样本，不做跨尺寸外推。
  // 曾按 秒/(步数·百万像素) 归一，结果 512 图的开销（模型加载/TE）被摊到每像素上，
  // 估出来的大图时间只有实际的三分之一 —— 宁可显示「—」，也别给错数。
  function medianOf(list) {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
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
    if (el.zoomCurrent) el.zoomCurrent.hidden = false;
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


  // 最近作品条：鼠标滚轮上下 → 横向滚动（触控板横向手势也能用）
  // 最近作品条：滚轮上下 → 横向滚动。挂在 document 上做委托，
  // 这样缩略图反复重渲染也不用重新绑定。
  function bindHistoryWheel() {
    if (document.body.dataset.historyWheel === "1") return;
    document.body.dataset.historyWheel = "1";
    document.addEventListener("wheel", (event) => {
      const strip = event.target instanceof Element ? event.target.closest(".history-strip") : null;
      if (!strip || event.shiftKey) return;         // Shift+滚轮 保留原生纵向行为
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      if (!delta) return;
      const max = strip.scrollWidth - strip.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, strip.scrollLeft + delta));
      if (next === strip.scrollLeft) return;
      event.preventDefault();
      strip.scrollLeft = next;
    }, { passive: false });
  }

  function renderHistory() {
    bindHistoryWheel();
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
      img.src = historyThumbUrl(item);
      img.alt = "历史生成";
      img.loading = "lazy";
      img.decoding = "async";
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
      // 对比视图要用的三项：服务端一直在存，前端之前没接出来
      prompt: record.prompt || "",
      negative: record.negative || "",
      model: record.model || "",
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
      img.src = historyThumbUrl(item);
      img.alt = `本批第 ${item.batchIndex} 张`;
      img.loading = "lazy";
      img.decoding = "async";
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
        if (el.zoomCurrent) el.zoomCurrent.hidden = true;
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

  // 历史条 / 批次的缩略图：走服务端 480px 缓存，别直接塞原图。
  // 60 张 1024×1536 的原图解码后约 360MB 显存/内存，而 480px 只要几 MB。
  function historyThumbUrl(item) {
    const rel = item.galleryPath || item.path;
    if (!rel) return item.url;
    return `/local/gallery/thumb?path=${encodeURIComponent(rel)}`;
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
    // 常驻选择圈：不用先进「多选」模式，点圈就是选中
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "gallery-pick";
    pick.setAttribute("aria-label", "选择这张作品");
    pick.innerHTML = icon("check", 14);
    pick.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!galleryState.selecting) setGallerySelecting(true);
      toggleGallerySelection(item);
      if (!galleryState.selected.size) setGallerySelecting(false);
    });
    // 选中的多张时，卡片上的「导出 / 删除」直接作用于选中集合，
    // 不用再跑到弹窗底部找批量条。
    const bulk = () => galleryState.selected.size > 1;
    actions.append(
      pick,
      action("查看参数", "sliders", () => openGalleryInfo(item)),
      action("送去图生图", "send", () => sendGalleryToImg2img(item)),
      action("导出原图", "download", () => (bulk() ? batchExportGallery() : exportGalleryItem(item))),
      action("删除作品", "trash", () => (bulk() ? batchDeleteGallery() : deleteGalleryItem(item)), true)
    );

    card.append(thumbWrap, info, actions);
    return card;
  }

  /* ------------------------------------------------------ gallery selection */
  function selectedGalleryItems() {
    return galleryState.items.filter((item) => galleryState.selected.has(item.path));
  }

  function updateGallerySelectionUI() {
    // 常驻圈跟着选中状态亮起来
    $$(".gallery-pick", el.galleryDialog).forEach((node) => {
      const card = node.closest(".gallery-card");
      const path = card?.dataset.path || "";
      const on = galleryState.selected.has(path);
      node.classList.toggle("is-on", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const count = galleryState.selected.size;
    const selecting = count > 0;
    // 总数是常驻的；「已选 N 张 清空 完成」额外出现在工具栏右侧，仅选中时显示。
    // 不要再互相替换 —— 用户要的是两块同时看得见。
    if (el.galleryCount) el.galleryCount.hidden = false;
    if (el.gallerySelectCount) {
      el.gallerySelectCount.hidden = !selecting;
      el.gallerySelectCount.textContent = `已选 ${count} 张`;
    }
    [
      ["#gallerySelectClear", el.gallerySelectClear],
      ["#gallerySelectDone", el.gallerySelectDone]
    ].forEach(([, node]) => { if (node) node.hidden = !selecting; });
    if (el.gallerySelectClear) el.gallerySelectClear.disabled = count === 0 || galleryState.batchBusy;
    if (el.gallerySelectDone) el.gallerySelectDone.disabled = galleryState.batchBusy;
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
    if (el.gallerySelect) el.gallerySelect.setAttribute("aria-pressed", galleryState.selecting ? "true" : "false");
  }

  function setGallerySelecting(on) {
    const next = Boolean(on);
    galleryState.selecting = next;
    if (!next) galleryState.selected.clear();
    el.galleryDialog.classList.toggle("is-selecting", next);
    if (el.galleryBatchBar) el.galleryBatchBar.hidden = !next;
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
    // 把模型钉在请求里：任务在队列里排队期间用户可能切了底模，
    // 不钉的话执行时取的是「当前模型」，会拿错架构的模型和 LoRA 去跑。
    if (state.activeModel) overrideSettings.sd_model_checkpoint = state.activeModel;
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

  function stopPreviewStream() {
    if (state.previewStream) {
      try { state.previewStream.close(); } catch { /* 已关闭 */ }
      state.previewStream = null;
    }
    state.sseActive = false;
  }

  // 步预览走 SSE：桥接层每收到一帧就推过来，延迟从「轮询间隔」降到十几毫秒。
  // 连不上就退回轮询（state.sseActive=false 时轮询会带图）。
  function startPreviewStream() {
    stopPreviewStream();
    if (typeof EventSource === "undefined") return;
    try {
      const stream = new EventSource("/local/progress/stream");
      state.previewStream = stream;
      stream.onopen = () => { state.sseActive = true; };
      stream.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.step) {
          el.liveStep.textContent = data.steps ? `第 ${data.step}/${data.steps} 步` : "实时预览";
        }
        if (typeof data.image === "string" && data.image && data.image !== state.lastPreview) {
          state.lastPreview = data.image;
          el.livePreview.src = previewDataUrl(data.image);
          el.liveStage.hidden = false;
        }
      };
      stream.addEventListener("end", stopPreviewStream);
      stream.onerror = () => {
        // EventSource 会自己重连；这里只标记回退，让轮询带图，避免两端都空
        state.sseActive = false;
      };
    } catch {
      stopPreviewStream();
    }
  }

  function startPolling(batch = 1) {
    // 标签页不可见时不轮询：预览是给人看的，后台跑纯烧电。
    // 可见性变化时由 loop 自己恢复（下一轮直接取最新状态）。
    const paused = () => document.visibilityState === "hidden";
    stopPolling();
    startPreviewStream();
    const total = clamp(Number(batch) || 1, 1, 12);
    let inFlight = false;
    el.progressBar.value = 0;
    el.mobileProgressBar.value = 0;
    el.progressText.textContent = "正在准备…";
    el.etaText.textContent = "";
    el.batchText.textContent = total > 1 ? `本批 ${total} 张 · 顺序生成` : "";
    state.pollTimer = setInterval(async () => {
      if (inFlight) return;
      if (paused()) return;   // 后台页签不轮询，切回来下一轮自动追上
      inFlight = true;
      try {
        const skip = state.sseActive ? "true" : "false";
        const res = await fetch(`/api/sdapi/v1/progress?skip_current_image=${skip}`, { cache: "no-store" });
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
            // 直接设 src：预加载再替换的写法在这里反而会让预览整段不出现
            // （onload 依赖消息时序，漏一次就再也不显示），保持简单可靠。
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
    stopPreviewStream();
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
      // 提交前记一条历史：生成很贵，重跑旧配置比重新打字划算
      rememberPrompt(el.prompt.value, el.negative?.value);
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
        const wasRunning = state.stoppedRunning;
        el.progressText.textContent = wasRunning ? "已停止" : "已取消";
        el.batchText.textContent = "";
        snack(wasRunning ? "已停止生成" : "已取消排队任务");
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
        state.stoppedRunning = false;
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
    // 区分「排队中取消」与「跑到一半停止」：两者的文案不一样
    state.stoppedRunning = state.jobPhase === "running";
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
    bindDialog(el.helpDialog, el.closeHelp);
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
    if (el.openCompare) el.openCompare.addEventListener("click", openCompareDialog);
    if (el.promptHistoryBtn) {
      el.promptHistoryBtn.addEventListener("click", () => {
        if (el.promptHistorySearch) el.promptHistorySearch.value = "";
        renderPromptHistory();
        el.promptHistoryDialog.open = true;
      });
      bindDialog(el.promptHistoryDialog, el.promptHistoryClose);
      el.promptHistorySearch?.addEventListener("input", debounce(renderPromptHistory, 120));
      el.promptHistorySearch?.addEventListener("search", renderPromptHistory);
      el.promptHistoryClear?.addEventListener("click", () => {
        try { localStorage.removeItem(STORE_PROMPT_HISTORY); } catch { /* 忽略 */ }
        renderPromptHistory();
        snack("已清空提示词历史");
      });
    }
    bindCompareInteractions();
    bindDialog(el.loraDialog, el.closeLoraDialog);
    el.refreshLorasBtn.addEventListener("click", refreshLoras);
    if (el.loraOnlyActive) {
      el.loraOnlyActive.addEventListener("change", () => {
        state.loraOnlyActive = Boolean(el.loraOnlyActive.checked);
        renderLoraDialog();
      });
    }
    if (el.loraSearch) {
      const paintList = debounce(renderLoraDialog, 120);
      const onLoraSearch = () => {
        state.loraQuery = el.loraSearch.value || "";
        paintList();
      };
      el.loraSearch.addEventListener("input", onLoraSearch);
      el.loraSearch.addEventListener("change", onLoraSearch);
      // 原生 <input type="search"> 的清除按钮会发 search 事件
      el.loraSearch.addEventListener("search", onLoraSearch);
    }

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
    el.artistSearch.addEventListener("search", () => applyArtistFilter());
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
    el.presetSearch.addEventListener("search", (event) => applyPresetFilter(event.target.value));
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
      el.shiftOut.textContent = String(Number(el.shift.value));
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
    if (el.zoomCurrent) el.zoomCurrent.addEventListener("click", openLightbox);
    el.clearHistory.addEventListener("click", clearHistory);
    bindHistoryWheel();   // 委托绑定一次，历史为空时也要生效
    bindHistoryWheel();   // 委托绑定一次，历史为空时也要生效
    el.galleryBtn.addEventListener("click", openGallery);
    el.openGallery.addEventListener("click", openGallery);
    el.closeGallery.addEventListener("click", () => { el.galleryDialog.open = false; });
    el.galleryDialog.addEventListener("closed", () => {
      if (galleryState.selecting) setGallerySelecting(false);
    });
    el.galleryRefresh.addEventListener("click", () => loadGallery({ reset: true }));
    el.galleryOpenFolder.addEventListener("click", openGalleryFolder);
    el.galleryMore.addEventListener("click", () => loadGallery());
    /* 顶部「多选」按钮已移除：常驻选择圈就是入口。
       注意：这行如果还留着 el.gallerySelect.addEventListener，会因节点不存在抛错，
       导致 bindEvents 后面的灯箱 / 键盘绑定全部失效 —— 踩过一次。 */
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

    bindDialog(el.savePresetDialog, el.cancelSavePreset);
    el.confirmSavePreset.addEventListener("click", confirmSavePreset);
    el.presetName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSavePreset();
      }
    });
    el.saveCurrentFromList.addEventListener("click", () => { el.savedDialog.open = false; openSavePresetDialog(); });
    bindDialog(el.savedDialog, el.closeSaved);
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
    if (el.presetEditDialog) {
      bindDialog(el.presetEditDialog, el.cancelPresetEdit);
      el.savePresetEdit.addEventListener("click", savePresetEdit);
      el.formatPresetEdit.addEventListener("click", () => {
        const text = el.presetEditText.value;
        const err = presetJsonError(text);
        if (err) { setPresetEditStatus(err, false); return; }
        el.presetEditText.value = JSON.stringify(JSON.parse(text), null, 2);
        setPresetEditStatus("格式有效", true);
      });
      el.presetEditText.addEventListener("input", debounce(() => {
        const err = presetJsonError(el.presetEditText.value);
        setPresetEditStatus(err || "格式有效", !err);
      }, 200));
    }
    if (el.repoPresetNew) {
      el.repoPresetNew.addEventListener("click", () => openInlinePresetEditor("", "", el.repoPresets));
    }
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


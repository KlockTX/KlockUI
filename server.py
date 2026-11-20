#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""KlockUI 本地服务：静态页 + ComfyUI 引擎适配（Forge/A1111 API 兼容层）。"""
import base64
import getpass
import gzip
import hashlib
import hmac
import html
import io
import json
import logging
import os
import random
import re
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from urllib.parse import parse_qs, quote, urlparse

import comfy_bridge  # Forge/A1111 API -> ComfyUI 工作流适配层（同目录）
import interrogate   # WD14 图反推（懒加载 onnxruntime，不点就不占内存）

try:
    from PIL import Image, ImageOps
except Exception:  # noqa: BLE001
    Image = None
    ImageOps = None


class PromptSafetyError(RuntimeError):
    """用户输入无法生成有效提示词。"""


# 版本号：issue 里请带上它，能省掉一轮"你装的哪版"
VERSION = "0.1.0"

ROOT = os.path.dirname(os.path.abspath(__file__))
# 模型根目录由桥接层统一解析（环境变量 + 目录探测），这里直接复用，避免两套路径。
MODELS_ROOT = comfy_bridge.MODELS_ROOT
# 引擎已由 Forge Neo(7860) 迁移为 ComfyUI(8188)。FORGE 仅为历史命名别名，
# 所有 /sdapi/v1/* 由 comfy_bridge.dispatch 翻译成 ComfyUI 工作流。
ENGINE = os.environ.get("KLOCK_COMFY_URL", "http://127.0.0.1:8188")
FORGE = ENGINE
# 出图根目录：环境变量 → 同级 outputs（老布局）→ 仓库内 outputs。
# 加同级探测是为了兼容「仓库放在 D:/AI/KlockUI、图在 D:/AI/outputs」这种历史用法：
# 只看仓库内目录的话，老历史和缩略图会全部 404。
def _detect_output_root():
    env = os.environ.get("KLOCK_OUTPUT_DIR")
    if env:
        return os.path.abspath(os.path.expanduser(env))
    local = os.path.join(ROOT, "outputs")
    legacy = os.path.join(os.path.dirname(ROOT), "outputs")
    legacy_images = os.path.join(legacy, "txt2img-images")
    if os.path.isdir(legacy_images):
        try:
            if any(True for _root, _dirs, files in os.walk(legacy_images) for _ in files):
                return legacy
        except OSError:
            pass
    return local


OUTPUT_ROOT = _detect_output_root()
PORT = int(os.environ.get("KLOCKUI_PORT", "7861"))
MAX_JSON_BYTES = 1024 * 1024
MAX_PROXY_BYTES = 64 * 1024 * 1024
STATIC_DIRS = ("vendor", "assets")

# 远程访问：密码只存 scrypt 派生值；会话用 HMAC 签名的 HttpOnly Cookie。
AUTH_DIR = os.path.join(ROOT, ".private")
AUTH_FILE = os.environ.get("KLOCK_AUTH_FILE") or os.path.join(AUTH_DIR, "auth.json")
SESSION_COOKIE = "klock_session"
SESSION_TTL = int(os.environ.get("KLOCK_SESSION_DAYS", "30")) * 86400
LOGIN_WINDOW = 15 * 60
LOGIN_MAX_FAILS = 5
GENERATION_JOB_TTL = 15 * 60
GENERATION_JOB_MAX = 12
GENERATION_QUEUE_MAX = 12
IDLE_UNLOAD_SECONDS = int(os.environ.get("KLOCK_IDLE_UNLOAD_SECONDS", "600"))
# 4B 常驻约 2GB 物理内存，而它只在 Anima/SDXL 需要中文转英文时才用得上。
# 空闲这么久就直接退出，下次需要时冷启动（约 10-30 秒）。设 0 可关闭该行为。
PROMPT_LLM_IDLE_SECONDS = int(os.environ.get("KLOCK_PROMPT_IDLE_SECONDS", "600"))
HISTORY_MAX = 60
# 缓存目录（历史、缩略图、导出）。支持改路径，方便多实例并存或做干净演示环境。
CACHE_DIR = os.environ.get("KLOCK_CACHE_DIR") or os.path.join(ROOT, ".cache")
HISTORY_FILE = os.path.join(CACHE_DIR, "history.json")
JOBS = {}
JOB_QUEUE = []
JOBS_LOCK = threading.Lock()
_QUEUE_ACTIVE = False
HISTORY_LOCK = threading.Lock()
_ACTIVITY_LOCK = threading.Lock()
_last_activity = time.time()
SCRYPT_N = 32768
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MEM = 64 * 1024 * 1024
# 只服务本机：远程访问（Cloudflare Tunnel）功能已移除（2026-11-15）。
LOCAL_HOSTS = frozenset(("127.0.0.1:%d" % PORT, "localhost:%d" % PORT))
LOCAL_ORIGINS = frozenset(("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT))
ALLOWED_HOSTS = LOCAL_HOSTS

HTML_FRAME_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
}
LOGIN_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; "
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    ),
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
}

# 模型架构与配套模块：只读 safetensors 头部，供工作台切换 Anima 时自动配置预设。
# 统一模型库：D:/AI/models 是唯一来源，ComfyUI/models 只留占位文件。
#   checkpoints/        SDXL 整模型
#   diffusion_models/   DiT 族（Anima 2.9B + MOSS-Image）
CHECKPOINT_DIRS = (
    comfy_bridge.CKPT_DIR,
    comfy_bridge.DIFF_DIR,
)
TEXT_ENCODER_DIRS = (
    comfy_bridge.TE_DIR,
)
MODULE_VAE_DIRS = (
    comfy_bridge.VAE_DIR,
)
ENGINE_CATALOG_TTL = 20
_ENGINE_CATALOG = {"stamp": 0.0, "payload": None}
_ENGINE_CATALOG_LOCK = threading.Lock()
_HEADER_KEYS = {}
_HEADER_KEYS_LOCK = threading.Lock()

# 本地提示词生成：Qwen3.5-4B abliterated（中文直出）+ llama.cpp（CPU，不占显存）。
# llama-engine 只放运行时，模型放在 D:\AI\models 下，升级运行时不必搬模型。
LLAMA_ENGINE_DIR = os.environ.get("KLOCK_LLAMA_DIR") or os.path.join(MODELS_ROOT, "..", "llama-engine")
PROMPT_LLM = {
    "alias": "qwen3.5-4b-abliterated",
    "label": "Qwen3.5-4B abliterated",
    "port": int(os.environ.get("KLOCK_PROMPT_LLM_PORT", "7865")),
    "ctx": 4096,
    "threads": int(os.environ.get("KLOCK_PROMPT_LLM_THREADS", "10")),
    "model": os.environ.get(
        "KLOCK_PROMPT_LLM_MODEL",
        os.environ.get("KLOCK_PROMPT_LLM_MODEL") or os.path.join(MODELS_ROOT, "prompt-llm", "prompt-llm.gguf"),
    ),
    "exe": os.path.join(LLAMA_ENGINE_DIR, "llama", "llama-server.exe"),
    "log": "llama-prompt-llm",
    "no_think": True,
}
def _discover_prompt_llm_model():
    """默认文件名不存在时，扫 prompt-llm/ 下唯一的 .gguf 顶上。

    官方发行包里的模型叫 Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf，
    而历史默认路径写的是 prompt-llm.gguf —— 不自动发现的话转写开箱即坏。
    用户通过 KLOCK_PROMPT_LLM_MODEL 显式指定时永远优先，不覆盖。
    """
    model = PROMPT_LLM.get("model") or ""
    if os.path.isfile(model):
        return model
    if os.environ.get("KLOCK_PROMPT_LLM_MODEL"):
        return model  # 显式指定就是用户说了算，缺失就报缺失，别偷偷换
    folder = os.path.dirname(model)
    if not folder or not os.path.isdir(folder):
        return model
    found = sorted(
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.lower().endswith(".gguf") and os.path.isfile(os.path.join(folder, name))
    )
    if len(found) == 1:
        return found[0]
    return model  # 0 个还是坏；多个不猜，交给用户指定


PROMPT_LLM["model"] = _discover_prompt_llm_model()
PROMPT_LLM["url"] = "http://127.0.0.1:%d" % PROMPT_LLM["port"]
PROMPT_LLM["err_log"] = os.path.join(LLAMA_ENGINE_DIR, PROMPT_LLM["log"] + ".err.log")
PROMPT_LLM["last_error"] = ""
PROMPT_LLM["proc"] = None
# 空闲退出用：idle_seconds 为阈值，last_used 是最后一次真正调用 4B 的时间戳。
PROMPT_LLM["idle_seconds"] = PROMPT_LLM_IDLE_SECONDS
PROMPT_LLM["last_used"] = 0.0
PROMPT_LLM["lock"] = threading.Lock()
PROMPT_LLM["start_lock"] = threading.Lock()
PROMPT_CACHE = {}
PROMPT_CACHE_LOCK = threading.Lock()
PROMPT_CACHE_TTL = 1800
PROMPT_CACHE_MAX = 48

STYLE_TAGS = {
    "photo": ["photorealistic", "realistic", "natural skin texture"],
    "cinematic": ["cinematic lighting", "film grain", "depth of field"],
    "illustration": ["illustration", "painterly", "detailed"],
    "anime": ["anime coloring", "cel shading", "clean lineart"],
}

# 2026-10-27 晚：按要求清空提示词层的评级过滤词。
# 不再做 auto 评级、不再注入 safe/sensitive/nsfw/explicit，模型写的评级标签也会被剔除；
# 画面内容完全由 nude/sex/lingerie 这类内容标签表达。
RATING_TAG_RE = re.compile(
    r"(?:rating[:_ ]?)?(?:general|safe|sensitive|questionable|nsfw|explicit)"
)
# 手动评级：默认 auto 不写评级标签，保持 raw 直出；用户选定后才注入一个。
MANUAL_RATINGS = ("auto", "safe", "sensitive", "nsfw", "explicit")
RATING_TAGS_BY_ARCH = {
    "anima": {"safe": "safe", "sensitive": "sensitive", "nsfw": "nsfw", "explicit": "explicit"},
    # Ponydiffusion 系的评级标签是 rating_safe / rating_questionable / rating_explicit，
    # 没有 sensitive，用最接近的 questionable 承接敏感档。
    "sdxl": {
        "safe": "rating_safe",
        "sensitive": "rating_questionable",
        "nsfw": "rating_questionable",
        "explicit": "rating_explicit",
    },
}


def normalize_manual_rating(value):
    rating = str(value or "auto").strip().lower()
    return rating if rating in MANUAL_RATINGS else "auto"


def manual_rating_tag(rating, arch):
    value = normalize_manual_rating(rating)
    if value == "auto":
        return ""
    if arch == "krea":
        # Krea 2 不用 booru 评级标签，评级只影响提示词语义。
        return ""
    table = RATING_TAGS_BY_ARCH.get("sdxl" if arch == "sdxl" else "anima", {})
    return table.get(value, "")


TAG_ALIASES = {
    "2girl": "2girls", "3girl": "3girls", "4girl": "4girls", "5girl": "5girls",
    "2boy": "2boys", "3boy": "3boys", "4boy": "4boys", "5boy": "5boys",
    "swimming suit": "swimsuit", "swimwear": "swimsuit",
    "shoulders exposed": "bare shoulders", "shoulder reveal": "bare shoulders",
    "shoulder exposed": "bare shoulders", "kissing": "kiss",
    "movie style": "cinematic lighting", "looking at camera": "looking at viewer",
    "hands behind back": "arms behind back",
    "adult female": "mature female", "adult male": "mature male",
    "adult woman": "mature female", "adult man": "mature male",
    "smiling": "smile", "kimonos": "kimono", "back to camera": "from behind",
    "full nude": "completely nude", "fully nude": "completely nude",
    "naked": "nude",
    "big breasts": "large breasts", "huge breasts": "large breasts",
    "one person": "solo", "single person": "solo",
    "double-tail": "twintails", "double tail": "twintails",
    "twin-tail": "twintails", "twin tails": "twintails",
    "twin ponytails": "twintails", "twin ponytail": "twintails",
    "twin-ponytails": "twintails", "twin-ponytail": "twintails",
    "compact framing": "tight framing", "compact composition": "tight framing",
    "tight composition": "tight framing", "tightly framed": "tight framing",
    "flat coloring": "flat color", "flat colour": "flat color",
    "flat colours": "flat color", "flat colors": "flat color",
    "flat shading": "flat color", "flat tone": "flat color", "flat tones": "flat color",
    "half-body": "upper body", "half body": "upper body",
    # 4B 对中文镜头词的字面翻译：统一成 Danbooru 能认的写法。
    "seven-part portrait": "cowboy shot", "seven part portrait": "cowboy shot",
    "seven-body": "cowboy shot", "seven body": "cowboy shot",
    "mid-body": "upper body", "midbody": "upper body",
    "standing pose": "standing",
    "full-body": "full body", "fullbody": "full body",
    "upper-body": "upper body", "upperbody": "upper body",
    "cowboy-shot": "cowboy shot",
    "cosswoy shot": "cowboy shot", "cossboy shot": "cowboy shot",
    "cowboi shot": "cowboy shot", "cowbow shot": "cowboy shot",
    "cowboyy shot": "cowboy shot",
    # 连字符机位写法先归一，CAMERA_ANGLE_TAGS 才能按原文决定保留/删除。
    "wide-angle": "wide angle", "low-angle": "low angle",
    "high-angle": "high angle", "dutch-angle": "dutch angle",
    "wide-shot": "wide shot", "extreme-wide-shot": "wide shot",
    "side-view": "side view", "front-view": "front view",
    "back-view": "back view", "eye-level": "eye level",
    # 4B 爱把 night 拆成多个同义词；统一后由去重收敛，避免占满标签位。
    "night time": "night", "nighttime": "night", "night scene": "night",
    "night city": "city night", "night cityscape": "city night",
    "close up": "close-up", "closeup": "close-up",
    "waist up": "upper body", "waist-up": "upper body", "waistup": "upper body",
    "full length": "full body", "full-length": "full body",
    "seven-part": "cowboy shot", "seven part": "cowboy shot",
    "seven-part view": "cowboy shot", "seven part view": "cowboy shot",
    "mid-body shot": "upper body", "midbody shot": "upper body",
    # 4B 常把双马尾写成 double braid；归一后由发型冲突清理接管。
    "double braid": "braid", "double braids": "braid",
    "twin braid": "braid", "twin braids": "braid",
    "cyber-punk": "cyberpunk", "cyber punk": "cyberpunk",
    # 4B 常见手部姿势错拼。
    "head on hip": "hand on hip", "hand on hips": "hand on hip",
}
# 4B 偶尔把中文术语直接音译成拼音标签（pingtuo、jifan yishu），
# 这些不是 Danbooru 标签，按固定术语翻译回来。
TAG_ALIASES.update({
    "pingtuo": "flat color", "ping tu": "flat color", "pingtu": "flat color",
    "jifan yishu": "maximalism", "jifan zhuyi": "maximalism", "jifan": "maximalism",
    "ji fan yi": "maximalism", "jifanyi": "maximalism",
    "jijian zhuyi": "minimalism", "jijian": "minimalism",
    "houtu": "impasto", "hou tu": "impasto",
    "sailulu": "cel shading", "sai lu lu": "cel shading",
    "banxieshi": "semi-realistic", "ban xieshi": "semi-realistic",
    "jincou goutu": "tight framing", "jincou": "tight framing",
    "flat tone": "flat color", "flat tones": "flat color",
    "shangbanshen": "upper body", "shang banshen": "upper body",
    "banshen": "upper body",
    "qifenshen": "cowboy shot", "qifen shen": "cowboy shot",
    "quanshen": "full body", "quan shen": "full body",
    "texie": "close-up",
    "zhanzi": "standing", "zuozi": "sitting",
    "tangzi": "lying", "pazi": "on stomach",
    "rouhe guangxian": "soft lighting",
    "ziran guang": "natural lighting",
    "niguang": "backlighting", "ceguang": "side lighting",
    "jingshen": "depth of field", "liubai": "negative space",
})
QUALITY_TAGS = frozenset({
    "masterpiece", "best quality", "great quality", "good quality", "normal quality",
    "low quality", "worse quality", "worst quality", "very aesthetic", "aesthetic",
    "displeasing", "very displeasing", "newest", "recent", "mid", "early", "old",
    "absurdres", "highres", "amazing quality", "score_9", "score_8_up", "score_7_up",
    "score_6_up", "score_5_up", "score_4_up", "source_anime", "source_cartoon",
    "source_furry", "source_pony", "source_photo",
})
# 4B 爱写的“元标签”：不是画面内容，占位置还会稀释主体。直接丢。
META_TAGS = frozenset({
    "detailed", "details", "detailed illustration", "highly detailed", "intricate details",
    "intricate detail", "extreme detail", "extreme details", "ultra detailed", "ultra-detailed",
    "hyper detailed", "hyper-detailed", "sharp detail", "sharp details", "fine detail",
    "fine details", "crisp detail", "crisp details", "pure tone", "central focus", "soft focus",
    "straightforward pose", "animation",
    "dynamic composition", "tension composition", "tense composition",
    "camera angle", "viewing angle", "eye level", "eye-level",
    "eye level shot", "eye-level shot",
    "image quality", "high resolution", "composition", "framing", "shot type",
    "excessive style", "excessive detail", "excessive details",
    "confident pose", "dynamic pose", "pose", "dense style", "dense details",
    "artist tag", "auto-quality", "auto quality",
    # 4B 偶尔把 compact composition 拼成 compacted composition；
    # 用户自己写的 clean composition 保留，不要做通配过滤。
    "compacted composition", "compact composition", "compressed composition",
    # 4B 给夜景补的“氛围”同义词，不改变画面内容，只占标签位。
    "night atmosphere", "night ambiance", "night ambience",
    "night vibe", "night vibes", "night mood",
})
# 混合输入（英文标签 + 中文短语）会整段交给 4B，模型容易改写或丢掉英文标签。
# 这里维护两类确定性回填：固定中文术语的英文对应，以及“看起来就是标签”的英文段。
ZH_TAG_GLOSSARY = {
    "极繁主义": "maximalism",
    "极简主义": "minimalism",
    "厚涂": "impasto",
    "赛璐璐": "cel shading",
    "半写实": "semi-realistic",
    "平涂": "flat color",
    "紧凑构图": "tight framing",
    "上半身": "upper body",
    "半身": "upper body",
    "七分身": "cowboy shot",
    "全身": "full body",
    "特写": "close-up",
    "站姿": "standing",
    "坐姿": "sitting",
    "躺姿": "lying",
    "趴姿": "on stomach",
    "柔和光线": "soft lighting",
    "自然光": "natural lighting",
    "逆光": "backlighting",
    "侧光": "side lighting",
    "景深": "depth of field",
    "留白": "negative space",
}
# 用户点名具体服装时，4B 常换成同类但不同的款式（皮夹克→风衣、牛仔裤→西裤）。
# 这里按“原文词 → 标准标签 + 需要替换掉的同类词”确定性校正。
IDEA_GARMENT_RULES = (
    (
        re.compile(r"皮夹克|皮衣|皮外套|leather jacket", re.I),
        "leather jacket",
        re.compile(r"\b(?:trench coat|overcoat|coat|jacket|blazer|parka|windbreaker)\b", re.I),
    ),
    (
        re.compile(r"风衣|大衣|trench coat", re.I),
        "trench coat",
        re.compile(r"\b(?:leather jacket|overcoat|coat|jacket|blazer|parka)\b", re.I),
    ),
    (
        re.compile(r"牛仔裤|jeans", re.I),
        "jeans",
        re.compile(r"\b(?:pants|trousers|slacks)\b", re.I),
    ),
    (
        re.compile(r"连衣裙|one[- ]piece dress", re.I),
        "dress",
        re.compile(r"\b(?:skirt|gown|kimono)\b", re.I),
    ),
    (
        re.compile(r"短裙|迷你裙|miniskirt|short skirt", re.I),
        "skirt",
        re.compile(r"\b(?:dress|gown)\b", re.I),
    ),
    (
        re.compile(r"白衬衫|白色衬衫|white shirt", re.I),
        "white shirt",
        re.compile(r"\b(?:shirt|blouse)\b", re.I),
    ),
    (
        re.compile(r"黑衬衫|黑色衬衫|black shirt", re.I),
        "black shirt",
        re.compile(r"\b(?:shirt|blouse)\b", re.I),
    ),
    (
        re.compile(r"毛衣|sweater", re.I),
        "sweater",
        re.compile(r"\b(?:cardigan|pullover)\b", re.I),
    ),
    (
        re.compile(r"卫衣|连帽衫|hoodie", re.I),
        "hoodie",
        re.compile(r"\b(?:sweatshirt|sweater)\b", re.I),
    ),
    (
        re.compile(r"制服|uniform", re.I),
        "uniform",
        re.compile(r"\b(?:suit|outfit)\b", re.I),
    ),
    (
        re.compile(r"高跟鞋|high heels", re.I),
        "high heels",
        re.compile(r"\b(?:heels|stilettos)\b", re.I),
    ),
)
USER_TAG_SPLIT_RE = re.compile(r"[,，;；\n]+")# Anima 的画师标签以 @ 开头；混合输入回填时必须原样保留 @，否则画风会失效。
USER_TAG_CHARS_RE = re.compile(r"^@?[a-z0-9][a-z0-9 '\-+().]*$")
# 画师权重写作 (@wlop:1.2)；消歧括号在提示词里转义成 \( \)，否则会被当成权重。
ARTIST_WEIGHT_RE = re.compile(r"^\((.+):([0-9]+(?:\.[0-9]+)?)\)$")


def split_artist_tag(tag):
    """拆出画师名与权重文本；不是画师标签时返回 None。"""
    value = str(tag or "").strip()
    weight = ""
    match = ARTIST_WEIGHT_RE.match(value)
    if match:
        value = match.group(1).strip()
        weight = match.group(2)
    if not value.startswith("@"):
        return None
    name = value[1:].strip()
    if not name:
        return None
    return name, weight


def artist_tag_identity(tag):
    """去重用：hiten、@hiten (hitenkei)、(@hiten:0.6) 视为同一画师。"""
    parts = split_artist_tag(tag)
    if not parts:
        return ""
    value = parts[0].replace("\\", "").strip().lower()
    return re.sub(r"\s*\([^()]*\)\s*$", "", value).strip()

# 已知 Danbooru 画师标签：用户漏写 @ 时补上，避免 Anima 把它当普通词或角色名。
KNOWN_ARTIST_TAGS = frozenset({"miku master"})
# 英文散文里常见的虚词；命中就整段放弃，交回 4B 转写。
USER_TAG_PROSE_RE = re.compile(
    r"\b(?:a|an|the|she|he|her|his|him|they|them|their|we|our|i|you|your|"
    r"is|are|was|were|be|been|being|has|have|had|with|without|while|when|"
    r"because|that|this|these|those)\b",
    re.I,
)
TAG_DENYLIST = frozenset({
    "artist name", "web address", "patreon username", "fanbox username", "twitter username",
    "english text", "signature", "watermark", "logo", "text", "speech bubble",
    "censored", "bar censor", "mosaic censoring", "blurry", "jpeg artifacts",
    "reference sheet", "character sheet", "multiple views", "comic", "4koma", "scan",
    # 构图/质量/元信息不是内容标签，留给下面的 caption 与质量前缀。
    "camera angle", "viewing angle", "composition",
    "framing", "shot type", "image quality", "high resolution", "eye level", "eye-level",
    "two people", "three people", "mature", "intimate", "passion", "mood",
    "atmosphere", "vibe", "body", "skin",
    # 模型名/档案名常被 4B 当成标签写回来，必须挡掉。
    "miaomiao", "miao miao", "miaomiao harem", "miaomiaoharem", "harem",
    "silvermoon", "silvermoonmix", "silvermoon mix", "cyberrealistic",
    "cyberrealisticpony", "pony", "sdxl", "anima",
    "female", "male", "1 person", "2 person", "one person", "two people",
    # 4B 爱补的元信息：不是 Danbooru 内容标签，直接丢掉。
    "18+", "adult", "adult female", "adult woman", "adult male", "adult man",
    "1 adult", "1 adult female", "1 adult male", "environment",
    # 泛主体词：Anima 本身就是动漫模型，写这些只会稀释角色与服装。
    "anime girl", "anime boy", "anime woman", "anime man",
    # 4B 对中文“日系/立绘”一类词的错拼噪声，原文没写就当不存在。
    "rika",
})
HAIR_COLORS = frozenset({
    "black hair", "blonde hair", "brown hair", "red hair", "silver hair", "white hair",
    "grey hair", "gray hair", "blue hair", "pink hair", "purple hair", "green hair",
    "orange hair", "aqua hair", "two-tone hair", "multicolored hair", "colored inner hair",
})
EYE_COLORS = frozenset({
    "blue eyes", "red eyes", "green eyes", "brown eyes", "yellow eyes", "purple eyes",
    "grey eyes", "gray eyes", "gold eyes", "aqua eyes", "pink eyes", "black eyes",
})
# 颜色保真：模型爱给没写发色/衣服颜色的角色补颜色，按原始描述做确定性过滤。
COLOR_WORDS = {
    "black": r"黑|black",
    "white": r"白|white",
    "red": r"红|red",
    "blue": r"蓝|blue",
    "green": r"绿|green",
    "yellow": r"黄|yellow",
    "pink": r"粉|pink",
    "purple": r"紫|purple",
    "brown": r"棕|褐|brown",
    "grey": r"灰|grey|gray",
    "silver": r"银|silver",
    "gold": r"金|gold|golden|blonde",
    "orange": r"橙|橘|orange",
    "aqua": r"青|水色|aqua|cyan",
}
COLOR_TAG_RE = re.compile(
    r"\b(black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|silver|gold|golden|blonde|orange|aqua|cyan)\b",
    re.I,
)
COLOR_ALIAS = {"gray": "grey", "golden": "gold", "blonde": "gold", "cyan": "aqua"}


def _idea_color_words(text):
    """按 COLOR_WORDS 同时识别中英文颜色词，避免只认英文。"""
    return {name for name, pattern in COLOR_WORDS.items() if re.search(pattern, str(text or ""), re.I)}


def _color_key(word):
    word = str(word or "")
    for name, pattern in COLOR_WORDS.items():
        if re.search(pattern, word, re.I):
            return name
    return ""


# 发色/瞳色只在颜色与部位相邻时才算数：避免 "long hair ... white background"
# 被误判成“用户写了白色头发”，进而挡掉角色官方发色。
IDEA_HAIR_COLOR_RE = re.compile(
    r"(?P<color>black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|blonde|orange|aqua|cyan|黑|白|红|蓝|绿|黄|粉|紫|棕|褐|灰|银|金|橙|青)"
    r"(?:色)?(?:的)?(?:长|短|中长|及腰)?"
    r"(?:头发|发丝|发|hair|双马尾|马尾|丸子头|发髻|麻花辫|编发|"
    r"twintails?|twin[- ]?tails?|twin[- ]?ponytails?|ponytail|braids?|"
    r"double[- ]?buns?|double[- ]?bunch)",
    re.I,
)
IDEA_EYE_COLOR_RE = re.compile(
    r"(?P<color>black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|orange|aqua|cyan|黑|白|红|蓝|绿|黄|粉|紫|棕|褐|灰|银|金|橙|青)"
    r"(?:色)?(?:的)?(?:眼睛|眼眸|瞳孔|瞳|眼|eyes?|iris)",
    re.I,
)
# 英文常写 "hair is red" / 中文 "头发是红色"，颜色不在部位前面。
IDEA_HAIR_COLOR_LINK_RE = re.compile(
    r"(?:头发|发丝|hair)\s*(?:是|为|is|are|was|were)\s*"
    r"(?P<color>black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|orange|aqua|cyan|黑|白|红|蓝|绿|黄|粉|紫|棕|褐|灰|银|金|橙|青)(?:色)?",
    re.I,
)
IDEA_EYE_COLOR_LINK_RE = re.compile(
    r"(?:眼睛|眼眸|瞳孔|瞳|眼|eyes?|iris)\s*(?:是|为|is|are|was|were)\s*"
    r"(?P<color>black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|orange|aqua|cyan|黑|白|红|蓝|绿|黄|粉|紫|棕|褐|灰|银|金|橙|青)(?:色)?",
    re.I,
)


def _idea_attribute_colors(text, kind="hair"):
    patterns = (
        (IDEA_HAIR_COLOR_RE, IDEA_HAIR_COLOR_LINK_RE)
        if kind == "hair"
        else (IDEA_EYE_COLOR_RE, IDEA_EYE_COLOR_LINK_RE)
    )
    found = set()
    for pattern in patterns:
        for match in pattern.finditer(str(text or "")):
            key = _color_key(match.group("color"))
            if key:
                found.add(key)
    return found


def _character_attribute_colors(idea, kind="hair"):
    """用户没写该部位颜色时，允许官方设定的颜色进入 caption/标签。"""
    text = str(idea or "")
    # 用户自己写了该部位的颜色就以用户为准；另一部位仍按官方设定补。
    if _idea_attribute_colors(text, kind):
        return set()
    suffix = " hair" if kind == "hair" else " eyes"
    colors = set()
    for pattern, char_tag, _series in CHARACTER_TAG_RULES:
        if not pattern.search(text):
            continue
        for tag in CHARACTER_APPEARANCE.get(char_tag, ()):
            if not tag.endswith(suffix):
                continue
            for word in COLOR_TAG_RE.findall(tag):
                colors.add(COLOR_ALIAS.get(word.lower(), word.lower()))
    return colors


def _character_color_allowance(idea):
    """用户没写发色/瞳色时，允许官方设定的颜色进入 caption/标签。"""
    return (
        _character_attribute_colors(idea, "hair")
        | _character_attribute_colors(idea, "eyes")
    )


IDEA_HAIR_COLOR_ADJ_RE = re.compile(
    r"\b(?:black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|blonde|orange|aqua|cyan)[- ]haired\b",
    re.I,
)
IDEA_EYE_COLOR_ADJ_RE = re.compile(
    r"\b(?:black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
    r"silver|gold|golden|orange|aqua|cyan)[- ]eyed\b",
    re.I,
)


def _strip_attribute_color_phrases(text):
    out = str(text or "")
    for pattern in (
        IDEA_HAIR_COLOR_RE,
        IDEA_HAIR_COLOR_LINK_RE,
        IDEA_HAIR_COLOR_ADJ_RE,
        IDEA_EYE_COLOR_RE,
        IDEA_EYE_COLOR_LINK_RE,
        IDEA_EYE_COLOR_ADJ_RE,
    ):
        out = pattern.sub(" ", out)
    return out


def _idea_object_color_words(idea):
    """只统计挂在衣服/道具/背景上的颜色；发色不算，避免红发染红裙子。"""
    raw = str(idea or "")
    if re.search(r"彩色|多彩|多色|colorful|multicolor", raw, re.I):
        return None
    return _idea_color_words(_strip_attribute_color_phrases(raw))


def allowed_colors(idea):
    """原文明确写给衣服/背景等普通标签的颜色。"""
    return _idea_object_color_words(idea)


def color_tag_ok(tag, allowed, idea=None):
    if allowed is None:
        return True
    low_tag = str(tag or "").lower()
    # 发色/瞳色单独判断：白色背景不代表可以给角色补白头发。
    if idea is not None:
        if low_tag.endswith(" hair"):
            allowed = (
                _idea_attribute_colors(idea, "hair")
                | _character_attribute_colors(idea, "hair")
            )
        elif low_tag.endswith(" eyes"):
            allowed = (
                _idea_attribute_colors(idea, "eyes")
                | _character_attribute_colors(idea, "eyes")
            )
    for word in COLOR_TAG_RE.findall(low_tag):
        key = COLOR_ALIAS.get(word.lower(), word.lower())
        if key not in allowed:
            return False
    return True


def _scrub_caption_sentence(sentence, hair_allowed, eye_allowed, object_allowed):
    text = str(sentence or "")
    removed_attribute = False
    for match in reversed(list(COLOR_TAG_RE.finditer(text))):
        key = COLOR_ALIAS.get(match.group(0).lower(), match.group(0).lower())
        before = text[max(0, match.start() - 28):match.start()].lower()
        after = text[match.end():match.end() + 28].lower()
        if (
            re.match(r"[- ]?haired\b", after)
            or re.match(r"\s+hair\b", after)
            or re.match(
                r"\s+(?:double[- ]?)?(?:bunch|bun|braid|tail|ponytail)s?\b",
                after,
            )
        ):
            category = "hair"
        elif re.match(r"[- ]?eyed\b", after) or re.match(r"\s+eyes?\b", after):
            category = "eye"
        elif re.search(r"\bhair\s+(?:is|are|was|were)\s*$", before):
            category = "hair"
        elif re.search(r"\beyes?\s+(?:is|are|was|were)\s*$", before):
            category = "eye"
        else:
            category = "object"
        allowed = (
            hair_allowed if category == "hair"
            else eye_allowed if category == "eye"
            else object_allowed
        )
        if key in allowed:
            continue
        if re.search(r"\b(?:is|are|was|were)\s*$", before):
            # 颜色作表语（Her dress is red.）时删掉颜色会留下病句，整句放弃。
            return ""
        tail = re.match(r"[- ]?(?:haired|eyed)\b", after)
        if tail:
            text = text[:match.start()] + text[match.end() + tail.end():]
        else:
            end = match.end()
            if end < len(text) and text[end] == " ":
                end += 1
            text = text[:match.start()] + text[end:]
        if category in ("hair", "eye"):
            removed_attribute = True
    if removed_attribute:
        # 删掉发色/瞳色后可能留下 "hair and eyes" 这类残句。
        text = re.sub(r"\b(hair|eyes)\s+and\s+(?:eyes|hair)\b", r"\1", text, flags=re.I)
        text = re.sub(r",\s*(?:and\s+)?(?:eyes|hair)\b", "", text, flags=re.I)
        text = re.sub(r"\s+and\s+(?:eyes|hair)\b", "", text, flags=re.I)
    text = re.sub(r"\s{2,}", " ", text).strip()
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


def scrub_caption_colors(caption, idea):
    """按部位清理未提及的颜色，保留句子而不是整句删掉。"""
    text = str(caption or "").strip()
    object_allowed = _idea_object_color_words(idea)
    if not text or object_allowed is None:
        return text
    hair_allowed = (
        _idea_attribute_colors(idea, "hair")
        | _character_attribute_colors(idea, "hair")
    )
    eye_allowed = (
        _idea_attribute_colors(idea, "eyes")
        | _character_attribute_colors(idea, "eyes")
    )
    kept = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        cleaned = _scrub_caption_sentence(sentence, hair_allowed, eye_allowed, object_allowed)
        if cleaned:
            kept.append(cleaned.strip())
    return " ".join(part for part in kept if part).strip()
NUDITY_TAGS = frozenset({
    "nude", "completely nude", "nude only", "naked", "topless", "bottomless",
})
# 4B 会把普通舞台/睡姿/泳装场景补成性行为；原文没有性/裸体线索时全部剔除。
SEX_CONTENT_TAGS = frozenset({
    "sex", "having sex", "sex scene", "vaginal", "anal", "oral", "fellatio",
    "blowjob", "paizuri", "handjob", "masturbation", "doggy style", "missionary",
    "girl on top", "cowgirl position", "cowgirl", "reverse cowgirl", "creampie",
    "cum", "cumshot", "cum in pussy", "cum on body", "facial", "bukkake",
    "squirting", "sex from behind", "standing sex", "spread legs", "pussy",
    "penis", "vagina", "anus", "nipples", "areola", "areolae", "penetration",
    "ejaculation", "completely nude", "nude", "nude only", "naked",
    "topless", "bottomless", "no bra", "no panties", "pantyshot",
})
SEX_CAPTION_RE = re.compile(
    r"\b(?:having sex|has sex|sex scene|sex act|sexual act|girl on top|cowgirl|missionary|"
    r"doggy style|fellatio|blowjob|paizuri|handjob|masturbat\w*|creampie|"
    r"cumshot|cumming|squirting|penetrat\w+|ejaculat\w+|"
    r"spread(?:ing)? (?:her|their|the) legs|genitals?|"
    r"nude|naked|topless|bottomless)\b",
    re.I,
)
# 4B 会把底模/档案名当画风词写进 caption，必须整句剔除。
MODEL_CAPTION_RE = re.compile(
    r"\b(?:miaomiao|miao miao|silvermoon(?:mix)?|cyberrealistic(?: pony)?|"
    r"anima|pony|sdxl|auto[- ]quality|score_\d)\b",
    re.I,
)
POSE_TAGS = frozenset({
    "lying on side", "on side", "on back", "lying on back", "on stomach", "lying on stomach",
    "seiza", "standing", "sitting",
})
BASE_GARMENTS = frozenset({
    "shirt", "dress", "coat", "jacket", "skirt", "pants", "shorts", "jeans",
    "uniform", "sweater", "hoodie", "vest", "robe", "cloak", "cape",
})
# 原文没有人物时，4B 会虚构一个“站在湖边的人”并给他穿衣服；
# 这些衣服标签只有原文提到对应中文/英文词时才保留。
GARMENT_IDEA_HINTS = {
    "shirt": ("衬衫", "shirt"),
    "dress": ("裙", "dress", "gown"),
    "coat": ("外套", "大衣", "风衣", "coat"),
    "jacket": ("夹克", "外套", "jacket"),
    "skirt": ("裙", "skirt"),
    "pants": ("裤", "pants", "trousers"),
    "shorts": ("短裤", "shorts"),
    "jeans": ("牛仔裤", "jeans"),
    "uniform": ("制服", "uniform"),
    "sweater": ("毛衣", "sweater"),
    "hoodie": ("卫衣", "hoodie"),
    "vest": ("马甲", "背心", "vest"),
    "robe": ("长袍", "robe"),
    "cloak": ("斗篷", "披风", "cloak"),
    "cape": ("斗篷", "披风", "cape"),
}
# 这些名词前的颜色可以安全地删除；其他标签（如 blue archive）不做词内删除，
# 避免把系列名拆成 archive。
COLORABLE_NOUNS = frozenset({
    "shirt", "dress", "skirt", "coat", "jacket", "pants", "shorts", "jeans",
    "uniform", "sweater", "hoodie", "vest", "robe", "swimsuit", "bikini",
    "lingerie", "bra", "panties", "stockings", "thighhighs", "kimono", "gown",
    "suit", "tie", "scarf", "gloves", "hat", "boots", "shoes", "heels",
    "sandals", "socks", "background", "wall", "walls", "floor", "ceiling",
    "bed", "sheet", "sheets", "blanket", "pillow", "curtain", "curtains",
    "carpet", "sky", "cloud", "clouds", "snow", "sand", "water", "sea",
    "ocean", "lake", "mountain", "mountains", "grass", "flower", "flowers",
    "rose", "roses", "hair", "eyes", "skin", "lips", "nails",
})


def sanitize_color_tag(tag, allowed, idea=None):
    """未提及的颜色优先从可染色名词里删掉，整条标签保留。

    red dress -> dress，white background -> background；
    系列名/角色名里的颜色（blue archive）不能拆词，整条丢弃。
    """
    low = re.sub(r"\s+", " ", str(tag or "").lower()).strip()
    if not low or allowed is None:
        return low
    # 发色/瞳色整条按部位判断，避免把 "red hair" 修成 "hair"。
    if idea is not None and low.endswith((" hair", " eyes")):
        return low if color_tag_ok(low, allowed, idea) else ""
    if re.search(r"\b(?:haired|eyed)\b", low):
        return low if color_tag_ok(low, allowed, idea) else ""
    words = low.split()
    if not any(word in COLORABLE_NOUNS for word in words):
        return low if color_tag_ok(low, allowed, idea) else ""
    out = low
    for word in COLOR_TAG_RE.findall(low):
        key = COLOR_ALIAS.get(word.lower(), word.lower())
        if key in allowed:
            continue
        out = re.sub(r"\b%s\b\s*" % re.escape(word), "", out)
    out = re.sub(r"^(?:a|an|the|and|of|with)\s+", "", out.strip())
    out = re.sub(r"\s{2,}", " ", out).strip(" ,-")
    return out
PERSON_TAG_RE = re.compile(r"^(\d+)\+?(girl|girls|boy|boys|other|others)$")
PERSON_TAGS = frozenset({
    "solo", "multiple girls", "multiple boys", "multiple others", "male focus", "female focus",
})
PERSON_WORD_RE = re.compile(r"女|男|人|娘|少女|男孩|女孩|woman|girl|boy|man|male|female|person|couple|lady", re.I)
# 明确的非人物主体：只有这类描述才允许服务端推翻 4B 的人物标签。
# 街头、海边、樱花树下这类场景不算，避免把“初音未来在海边”误判成风景。
NON_PERSON_SUBJECT_RE = re.compile(
    r"(?:一只|一头|一匹|一条|一群|两只|两头)[^，。；,;]{0,10}"
    r"(?:猫|狗|鸟|鱼|马|牛|羊|兔子|动物|昆虫)"
    r"|(?:一座|一片|一条|一泓|一汪|一湾)[^，。；,;]{0,8}"
    r"(?:山|雪山|山峰|湖|湖泊|湖面|河|河流|森林|沙漠|草原|海|大海|星空|银河|城市)"
    r"|纯风景|静物|无人物|没有人物|不要人物"
    r"|\b(?:landscape|scenery|still life|no people|no person)\b",
    re.I,
)
# 无人物场景里，4B 有时仍会写一个“站在湖边的人”。caption 出现这些词
# 就整句丢弃，避免风景图凭空多出一个与输入无关的角色。
NO_PERSON_CAPTION_RE = re.compile(
    r"\b(?:adult|figure|silhouette|person|people|someone|anyone|"
    r"woman|women|man|men|girl|boy|female|male|lady|gentleman|"
    r"she|he|her|his|him|they|their|"
    r"standing|sitting|walking|running|kneeling|lying|"
    r"wearing|dressed|hands?|arms?|legs?|hair|eyes|pose|poses)\b",
    re.I,
)
# 用确定性映射修正 4B 的拼写/音译错误。
# 只修正常见角色，未列出的角色仍由 4B 自己给 Danbooru 标签。
CHARACTER_TAG_RULES = (
    # "miku master" 是画师标签，不是初音未来；不能把它当角色名。
    (re.compile(r"(?:初音未来|初音ミク|hatsune miku|\bmiku\b)(?![\s_]+master\b)", re.I), "hatsune miku", "vocaloid"),
    (re.compile(r"雷电将军|雷电影|raiden shogun|raiden shougun", re.I), "raiden shogun", "genshin impact"),
    (re.compile(r"八重神子|yae miko", re.I), "yae miko", "genshin impact"),
    (re.compile(r"甘雨|ganyu", re.I), "ganyu", "genshin impact"),
    (re.compile(r"刻晴|keqing", re.I), "keqing", "genshin impact"),
    (re.compile(r"胡桃|hu tao", re.I), "hu tao", "genshin impact"),
    (re.compile(r"芙宁娜|furina", re.I), "furina", "genshin impact"),
    (re.compile(r"神里绫华|kamisato ayaka", re.I), "kamisato ayaka", "genshin impact"),
    (re.compile(r"优菈|eula", re.I), "eula", "genshin impact"),
    (re.compile(r"蒂法|tifa lockhart", re.I), "tifa lockhart", "final fantasy vii"),
    (re.compile(r"\b2b\b|ヨルハ2号b型", re.I), "2b", "nier:automata"),
    (re.compile(r"不知火舞|mai shiranui", re.I), "mai shiranui", "fatal fury"),
    (re.compile(r"春丽|chun-li", re.I), "chun-li", "street fighter"),
    (re.compile(r"艾达王|ada wong", re.I), "ada wong", "resident evil"),
    (re.compile(r"劳拉|laracroft|lara croft", re.I), "lara croft", "tomb raider"),
)
CHARACTER_TAG_FUZZ = {
    "hatsune miku": re.compile(r"(?:hatsune miku|hatune miku|\bmiku\b)(?![\s_]+master\b)", re.I),
    "raiden shogun": re.compile(r"raiden|raiten|shogun|shougun|genryu|genryuu", re.I),
    "yae miko": re.compile(r"yae|miko", re.I),
    "ganyu": re.compile(r"ganyu|gan yue", re.I),
    "keqing": re.compile(r"keqing|ke qing", re.I),
    "hu tao": re.compile(r"hu ?tao|hutao", re.I),
    "furina": re.compile(r"furina", re.I),
    "kamisato ayaka": re.compile(r"kamisato|ayaka", re.I),
    "eula": re.compile(r"eula", re.I),
    "tifa lockhart": re.compile(r"tifa", re.I),
    "2b": re.compile(r"\b2b\b|yorha", re.I),
    "mai shiranui": re.compile(r"shiranui|mai shiranui", re.I),
    "chun-li": re.compile(r"chun[- ]?li", re.I),
    "ada wong": re.compile(r"ada wong", re.I),
    "lara croft": re.compile(r"lara croft", re.I),
}
# caption 里的角色名同样要归一到 Danbooru 的拼写。
CHARACTER_DISPLAY = {
    "hatsune miku": (
        re.compile(r"(?:\b(?:hatune|hatsune)\s+miku\b|\bmiku\b)(?![\s_]+master\b)", re.I),
        "Hatsune Miku",
    ),
    "raiden shogun": (
        re.compile(r"\b(?:genryu|genryuu|raiden)\s+(?:shougun|shogun)\b|\braiden shogun\b", re.I),
        "Raiden Shogun",
    ),
    "yae miko": (re.compile(r"\byae\s+miko\b|\bmiko\b", re.I), "Yae Miko"),
    "ganyu": (re.compile(r"\bganyu\b", re.I), "Ganyu"),
    "keqing": (re.compile(r"\bke ?qing\b", re.I), "Keqing"),
    "hu tao": (re.compile(r"\bhu ?tao\b", re.I), "Hu Tao"),
    "furina": (re.compile(r"\bfurina\b", re.I), "Furina"),
    "kamisato ayaka": (re.compile(r"\b(?:kamisato\s+)?ayaka\b", re.I), "Kamisato Ayaka"),
    "eula": (re.compile(r"\beula\b", re.I), "Eula"),
    "tifa lockhart": (re.compile(r"\btifa(?:\s+lockhart)?\b", re.I), "Tifa Lockhart"),
    "2b": (re.compile(r"\b2b\b", re.I), "2B"),
    "mai shiranui": (re.compile(r"\b(?:mai\s+)?shiranui\b", re.I), "Mai Shiranui"),
    "chun-li": (re.compile(r"\bchun[- ]?li\b", re.I), "Chun-Li"),
    "ada wong": (re.compile(r"\bada\s+wong\b", re.I), "Ada Wong"),
    "lara croft": (re.compile(r"\blara\s+croft\b", re.I), "Lara Croft"),
}
# Anima 的 caption 权重很高；只写角色标签、不写外观时，角色容易退回通用脸。
# 用户没指定发色/瞳色时，补 2-3 个官方设定里的可见特征（不写服装，避免和用户服装冲突）。
CHARACTER_APPEARANCE = {
    "hatsune miku": ("twintails", "aqua hair", "aqua eyes"),
    "raiden shogun": ("purple hair", "purple eyes", "braid"),
    "yae miko": ("pink hair", "purple eyes", "fox ears"),
    "ganyu": ("blue hair", "purple eyes", "horns"),
    "keqing": ("purple hair", "purple eyes", "twintails"),
    "hu tao": ("brown hair", "red eyes", "twin tails"),
    "furina": ("white hair", "blue eyes", "heterochromia"),
    "kamisato ayaka": ("light blue hair", "blue eyes"),
    "eula": ("blue hair", "blue eyes"),
    "tifa lockhart": ("black hair", "red eyes"),
    "2b": ("white hair", "blue eyes"),
    "mai shiranui": ("brown hair", "brown eyes"),
    "chun-li": ("brown hair", "brown eyes"),
    "ada wong": ("black hair", "brown eyes"),
    "lara croft": ("brown hair", "brown eyes"),
}
NON_PERSON_EXTRA = frozenset({
    "animal ears", "cat ears", "dog ears", "fox ears", "fake animal ears", "kemonomimi",
    "tail", "cat tail", "humanization", "personification", "looking at viewer", "looking back",
    "full body", "cowboy shot", "upper body",
    "standing", "sitting", "walking", "running", "kneeling", "lying",
    "facing away", "from behind", "from side", "profile", "three-quarter view",
})
HAIR_LENGTH = frozenset({
    "short hair", "medium hair", "long hair", "very long hair", "absurdly long hair",
})
# 无人物场景里，4B 会顺手补上“站在湖边的人”穿/拿的东西；原文没提就一并清掉。
NO_PERSON_PROP_HINTS = {
    "boots": ("靴", "boots"),
    "shoes": ("鞋", "shoes"),
    "sneakers": ("鞋", "sneakers"),
    "sandals": ("凉鞋", "sandals"),
    "heels": ("高跟鞋", "heels"),
    "hat": ("帽", "hat"),
    "gloves": ("手套", "gloves"),
    "scarf": ("围巾", "scarf"),
    "bag": ("包", "bag", "backpack"),
    "backpack": ("背包", "backpack", "包"),
    "coffee cup": ("咖啡", "杯", "coffee", "cup", "mug"),
    "cup": ("杯", "cup", "mug"),
    "coffee": ("咖啡", "coffee"),
    "food": ("食物", "food", "餐"),
    "drink": ("饮料", "drink", "杯"),
    # 手持道具同样是“虚构人物”的伴生物；原文没提就清掉。
    "wooden staff": ("木杖", "法杖", "长棍", "staff", "杖", "棍"),
    "staff": ("木杖", "法杖", "长棍", "staff", "杖", "棍"),
    "sword": ("剑", "刀", "sword", "katana"),
    "katana": ("剑", "刀", "katana"),
    "umbrella": ("伞", "umbrella"),
    "lantern": ("灯笼", "提灯", "lantern"),
    "bouquet": ("花束", "bouquet"),
    "microphone": ("麦克风", "话筒", "microphone", "mic"),
    "book": ("书", "book"),
    "phone": ("手机", "phone"),
}
HUMAN_EXPRESSIONS = frozenset({
    "smile", "grin", "open mouth", "closed mouth", "parted lips", "blush", "laughing", "tears",
})
HUMAN_BODY = frozenset({
    "barefoot", "bare feet", "feet", "toes", "soles", "breasts", "large breasts", "cleavage",
    "ass", "thighs", "navel", "collarbone", "skin", "pale skin", "tan",
})
FAVORITES_DIRNAME = "favorites"
FAVORITES_DIR = os.path.join(OUTPUT_ROOT, FAVORITES_DIRNAME)
IMAGE_DIRS = ("txt2img-images", "img2img-images", FAVORITES_DIRNAME)
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
THUMB_DIR = os.path.join(CACHE_DIR, "thumbs")
FAVORITES_FILE = os.path.join(ROOT, "gallery-favorites.json")
GALLERY_LOCK = threading.Lock()
GALLERY_BATCH_MAX = 200
GALLERY_EXPORT_MAX_BYTES = 500 * 1024 * 1024
# 后处理预览的字节预算：超分模型按原生 4x 出图后，全尺寸 PNG 有 20–70MB，
# base64 塞进 JSON 会卡住浏览器。超过就**同尺寸**转 JPEG 回传（像素不减），
# 只有保存 / 导出才落原始 PNG。
UPSCALE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".zip": "application/zip",
    ".ico": "image/x-icon",
}

LOG_FILE = os.environ.get("KLOCK_LOG_FILE", os.path.join(ROOT, "server.log"))
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[_handler])
log = logging.getLogger("klockui")

_AUTH_CACHE = {"stamp": None, "data": None}
_AUTH_LOCK = threading.Lock()


def load_auth():
    """读取 auth.json；文件变了自动重载，损坏时返回 None（由调用方 fail-closed）。"""
    try:
        st = os.stat(AUTH_FILE)
    except OSError:
        return None
    stamp = (st.st_mtime_ns, st.st_size)
    with _AUTH_LOCK:
        if _AUTH_CACHE["stamp"] == stamp:
            return _AUTH_CACHE["data"]
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict) or not data.get("hash") or not data.get("session_secret"):
            data = None
    except (OSError, ValueError):
        data = None
    with _AUTH_LOCK:
        _AUTH_CACHE["stamp"] = stamp
        _AUTH_CACHE["data"] = data
    return data


def hash_password(password, salt=None, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P):
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=32,
        maxmem=SCRYPT_MEM,
    )
    return salt, derived


def verify_password(auth, password):
    try:
        salt = base64.b64decode(auth["salt"])
        expected = base64.b64decode(auth["hash"])
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(auth["n"]),
            r=int(auth["r"]),
            p=int(auth["p"]),
            dklen=len(expected),
            maxmem=SCRYPT_MEM,
        )
        return hmac.compare_digest(actual, expected)
    except Exception:  # noqa: BLE001
        return False


def password_tag(auth):
    return hashlib.sha256(base64.b64decode(auth["hash"])).hexdigest()[:16]


def make_session(auth):
    expires = int(time.time()) + SESSION_TTL
    message = ("v1|%d|%s" % (expires, password_tag(auth))).encode("ascii")
    signature = base64.urlsafe_b64encode(
        hmac.new(base64.b64decode(auth["session_secret"]), message, hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return "%d.%s" % (expires, signature)


def session_ok(auth, token):
    try:
        expires_text, signature = token.split(".", 1)
        expires = int(expires_text)
    except (ValueError, AttributeError):
        return False
    now = int(time.time())
    if expires < now or expires > now + SESSION_TTL + 3600:
        return False
    message = ("v1|%d|%s" % (expires, password_tag(auth))).encode("ascii")
    expected = base64.urlsafe_b64encode(
        hmac.new(base64.b64decode(auth["session_secret"]), message, hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return hmac.compare_digest(expected, signature)


def safe_next(value):
    value = (value or "/").strip()
    if (
        not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or "\r" in value
        or "\n" in value
    ):
        return "/"
    return value[:512]


class LoginLimiter:
    """按客户端 IP 记录登录失败；进程内有效，重启清零。"""

    def __init__(self):
        self._lock = threading.Lock()
        self._fails = {}

    def _items(self, ip, now):
        items = [stamp for stamp in self._fails.get(ip, []) if now - stamp < LOGIN_WINDOW]
        if items:
            self._fails[ip] = items
        else:
            self._fails.pop(ip, None)
        return items

    def retry_after(self, ip):
        now = time.time()
        with self._lock:
            items = self._items(ip, now)
            if len(items) >= LOGIN_MAX_FAILS:
                return max(1, int(LOGIN_WINDOW - (now - items[0])))
            return 0

    def fail(self, ip):
        now = time.time()
        with self._lock:
            items = self._items(ip, now)
            items.append(now)
            self._fails[ip] = items
            if len(self._fails) > 4096:
                self._fails.clear()

    def reset(self, ip):
        with self._lock:
            self._fails.pop(ip, None)


LOGIN_LIMITER = LoginLimiter()


def _prune_jobs_locked():
    now = time.time()
    expired = [
        job_id
        for job_id, job in JOBS.items()
        if job.get("status") not in ("running", "queued")
        and now - float(job.get("finished") or job.get("created") or 0) > GENERATION_JOB_TTL
    ]
    for job_id in expired:
        JOBS.pop(job_id, None)
    JOB_QUEUE[:] = [job_id for job_id in JOB_QUEUE if JOBS.get(job_id)]
    if len(JOBS) > GENERATION_JOB_MAX:
        finished = sorted(
            (job.get("finished") or job.get("created") or 0, job_id)
            for job_id, job in JOBS.items()
            if job.get("status") not in ("running", "queued")
        )
        for _, job_id in finished[:max(0, len(JOBS) - GENERATION_JOB_MAX)]:
            JOBS.pop(job_id, None)


def _queue_position_locked(job_id):
    """排队位置：前面还在排的 + 正在跑的 + 自己；运行中/已结束返回 0。"""
    running = any(job.get("status") == "running" for job in JOBS.values())
    ahead = 0
    for candidate in JOB_QUEUE:
        job = JOBS.get(candidate)
        if not job or job.get("status") != "queued":
            continue
        if candidate == job_id:
            return ahead + (1 if running else 0) + 1
        ahead += 1
    return 0


def _queue_length_locked():
    return sum(1 for candidate in JOB_QUEUE if (JOBS.get(candidate) or {}).get("status") == "queued")


def _job_public_locked(job):
    status = job.get("status") or "queued"
    return {
        "id": job.get("id"),
        "endpoint": job.get("endpoint"),
        "status": status,
        "created": job.get("created"),
        "started": job.get("started"),
        "finished": job.get("finished"),
        "position": _queue_position_locked(job.get("id")) if status == "queued" else 0,
        "detail": job.get("detail") or "",
        "upstream_status": job.get("upstream_status"),
        "interrupted": bool(job.get("interrupted")),
        "queue_length": _queue_length_locked(),
        "meta": job.get("meta") or {},
    }


def _pump_queue_locked():
    global _QUEUE_ACTIVE
    if _QUEUE_ACTIVE:
        return
    _QUEUE_ACTIVE = True
    threading.Thread(target=_queue_worker_loop, name="klock-generation-queue", daemon=True).start()


def _queue_worker_loop():
    global _QUEUE_ACTIVE
    while True:
        with JOBS_LOCK:
            job_id = None
            for candidate in list(JOB_QUEUE):
                job = JOBS.get(candidate)
                if not job or job.get("status") != "queued":
                    continue
                job["status"] = "running"
                job["started"] = time.time()
                job["detail"] = ""
                job_id = candidate
                break
            JOB_QUEUE[:] = [candidate for candidate in JOB_QUEUE if (JOBS.get(candidate) or {}).get("status") == "queued"]
            if job_id is None:
                _QUEUE_ACTIVE = False
                return
            job = JOBS[job_id]
            endpoint = job.get("endpoint")
            payload = job.get("payload")
        finished_job = None
        if not isinstance(payload, dict) or endpoint not in ("txt2img", "img2img"):
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job:
                    job.update(status="error", detail="任务参数丢失", finished=time.time())
            continue
        try:
            _run_generation_job(job_id, endpoint, payload)
        except Exception as exc:  # noqa: BLE001
            log.warning("queue worker failed on %s: %s", job_id, exc)
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job and job.get("status") not in ("done", "error"):
                    job.update(status="error", detail="任务执行异常：%s" % exc, finished=time.time())
        finally:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job:
                    job["payload"] = None
                    if job.get("status") == "running" and isinstance(job.get("response"), dict):
                        finished_job = dict(job)
            if finished_job:
                records = []
                try:
                    records = _record_history(finished_job) or []
                except Exception as exc:  # noqa: BLE001
                    log.warning("history record failed for %s: %s", job_id, exc)
                with JOBS_LOCK:
                    job = JOBS.get(job_id)
                    if job is not None:
                        job["history"] = records
                        job["status"] = "done"
                        if not job.get("finished"):
                            job["finished"] = time.time()
            _touch_activity()


def _interrupt_forge():
    """中断当前生成：转交 ComfyUI /interrupt。"""
    ok = comfy_bridge.interrupt()
    if not ok:
        log.warning("interrupt failed (ComfyUI unreachable)")
    return ok


def _touch_activity():
    global _last_activity
    with _ACTIVITY_LOCK:
        _last_activity = time.time()


def _idle_unload_loop():
    if IDLE_UNLOAD_SECONDS <= 0:
        return
    while True:
        time.sleep(15)
        with _ACTIVITY_LOCK:
            idle = time.time() - _last_activity
        if idle < IDLE_UNLOAD_SECONDS:
            continue
        with JOBS_LOCK:
            if any(job.get("status") in ("running", "queued") for job in JOBS.values()):
                continue
        try:
            comfy_bridge.unload()
            log.info("idle %.0fs, ComfyUI models unloaded to free RAM", idle)
        except Exception as exc:  # noqa: BLE001
            log.debug("idle unload skipped: %s", exc)
        _touch_activity()


def _run_generation_job(job_id, endpoint, payload):
    _touch_activity()
    # 图片由 KlockUI 统一落盘；ComfyUI 侧只负责生成并回传 PNG 字节。
    payload = dict(payload)
    payload["save_images"] = False
    try:
        result = comfy_bridge.generate(endpoint, payload)
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                # 先只登记结果，等工作线程把图落盘、写完历史后再置 done，
                # 避免前端拿到 done 时 history 还是空的，导致最近作品出现重复项。
                job.update(
                    response=result,
                    http_status=200,
                    interrupted=bool(job.get("interrupt_requested")),
                    finished=time.time(),
                )
    except comfy_bridge.JobInterrupted:
        # 用户自己点的停止：不是失败，别弹「生成失败」
        log.info("generation job %s interrupted by user", job_id)
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                job.update(status="cancelled", detail="已停止", finished=time.time())
    except comfy_bridge.EngineError as exc:
        log.warning("generation job %s failed: %s", job_id, exc)
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                # 兜底：已经点过停止的，其它形态的引擎报错也按「已停止」处理
                if job.get("interrupt_requested"):
                    job.update(status="cancelled", detail="已停止", finished=time.time())
                else:
                    job.update(status="error", detail=str(exc), finished=time.time())
    except Exception as exc:  # noqa: BLE001
        log.warning("generation job %s failed: %s", job_id, exc)
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                job.update(status="error", detail="引擎错误：%s" % exc, finished=time.time())
    finally:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job and not job.get("finished"):
                job["finished"] = time.time()
        _touch_activity()


# --- 历史持久化与出图落盘 ---
def _b64_bytes(value):
    text = str(value or "")
    if text.startswith("data:"):
        _, _, text = text.partition(",")
    try:
        return base64.b64decode(text)
    except Exception:  # noqa: BLE001
        return b""


def _image_size_bytes(data):
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if len(data) >= 2 and data[:2] == b"\xff\xd8":
        index = 2
        while index + 9 <= len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                index += 2
                continue
            if marker == 0xDA:
                break
            length = struct.unpack(">H", data[index + 2:index + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", data[index + 5:index + 9])
                return width, height
            index += 2 + max(2, length)
    if len(data) >= 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X":
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
        if kind == b"VP8 ":
            width, height = struct.unpack("<HH", data[26:30])
            return width & 0x3FFF, height & 0x3FFF
        if kind == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if Image is not None:
        try:
            with Image.open(io.BytesIO(data)) as image:
                return image.size
        except Exception:  # noqa: BLE001
            pass
    return 0, 0


def _png_with_parameters(data, text):
    """在 IEND 前插入 iTXt(parameters)，格式与 A1111/Forge 保存的 PNG 一致。"""
    if not text or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data
    index = data.rfind(b"IEND")
    if index < 4:
        return data
    payload = b"parameters\x00\x00\x00\x00\x00" + str(text).encode("utf-8", "replace")
    chunk = struct.pack(">I", len(payload)) + b"iTXt" + payload + struct.pack(">I", zlib.crc32(b"iTXt" + payload) & 0xFFFFFFFF)
    return data[:index - 4] + chunk + data[index - 4:]


def _save_generated_image(data, endpoint, seed, index, infotext, kind="generate"):
    folder = "img2img-images" if endpoint == "img2img" else "txt2img-images"
    directory = os.path.join(OUTPUT_ROOT, folder, time.strftime("%Y-%m-%d"))
    os.makedirs(directory, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    seed_text = re.sub(r"[^0-9A-Za-z_-]", "", str(seed if seed is not None else "na")) or "na"
    prefix = "post" if kind == "postprocess" else "klockui"
    name = "%s-%s-%02d-%s.png" % (prefix, stamp, int(index or 1), seed_text)
    full = _unique_dest(directory, name)
    body = _png_with_parameters(data, infotext)
    tmp = full + ".%s.%s.tmp" % (os.getpid(), threading.get_ident())
    with open(tmp, "wb") as handle:
        handle.write(body)
    os.replace(tmp, full)
    return _output_rel(full), len(body)


def _load_history():
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    result = []
    for item in items:
        if isinstance(item, dict) and item.get("path"):
            result.append(item)
    return result[:HISTORY_MAX]


def _write_history(items):
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    tmp = HISTORY_FILE + ".%s.tmp" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump({"updated": int(time.time()), "items": items[:HISTORY_MAX]}, handle, ensure_ascii=False)
    os.replace(tmp, HISTORY_FILE)


def _history_add(records):
    if not records:
        return
    with HISTORY_LOCK:
        seen = set()
        merged = []
        for item in list(records) + _load_history():
            path = item.get("path")
            if not path or path in seen:
                continue
            seen.add(path)
            merged.append(item)
        _write_history(merged)


def _history_remove(path=None):
    with HISTORY_LOCK:
        items = _load_history()
        if path:
            items = [item for item in items if item.get("path") != path]
        else:
            items = []
        _write_history(items)
    return len(items)


def _history_rename(old, new):
    if not old or not new or old == new:
        return
    with HISTORY_LOCK:
        items = _load_history()
        changed = False
        for item in items:
            if item.get("path") == old:
                item["path"] = new
                changed = True
            if item.get("source") == old:
                item["source"] = new
                changed = True
        if changed:
            _write_history(items)


def _job_meta(endpoint, payload, model=""):
    width = int(payload.get("width") or 0)
    height = int(payload.get("height") or 0)
    if endpoint == "txt2img" and payload.get("enable_hr"):
        try:
            scale = float(payload.get("hr_scale") or 1)
        except (TypeError, ValueError):
            scale = 1
        width = int(round(width * scale / 8) * 8) if width else width
        height = int(round(height * scale / 8) * 8) if height else height
    return {
        "prompt": str(payload.get("prompt") or "")[:4000],
        "negative": str(payload.get("negative_prompt") or "")[:2000],
        "width": width,
        "height": height,
        "steps": payload.get("steps"),
        "cfg": payload.get("cfg_scale"),
        "sampler": payload.get("sampler_name") or "",
        "scheduler": payload.get("scheduler") or "",
        "seed": payload.get("seed"),
        "batch": max(1, int(payload.get("n_iter") or 1) * int(payload.get("batch_size") or 1)),
        "hires": bool(payload.get("enable_hr")),
        "denoise": payload.get("denoising_strength") if endpoint == "img2img" else None,
        # 统一存完整文件名：界面里的 activeModel 是不带扩展名的 stem，
        # 两种写法混在历史里会让按模型分组（对比、耗时统计）对不上。
        "model": str(comfy_bridge.resolve_model_file(model) or "")[:200],
    }


def _record_history(job):
    _invalidate_scan()
    response = job.get("response")
    if not isinstance(response, dict):
        return []
    images = response.get("images")
    if not isinstance(images, list) or not images:
        return []
    info = response.get("info")
    if isinstance(info, str):
        try:
            info = json.loads(info)
        except (ValueError, TypeError):
            info = {}
    info = info if isinstance(info, dict) else {}
    seeds = info.get("all_seeds")
    if not isinstance(seeds, list):
        seeds = [info["seed"]] if info.get("seed") is not None else []
    infotexts = info.get("infotexts")
    if not isinstance(infotexts, list):
        infotexts = []
    meta = job.get("meta") or {}
    endpoint = job.get("endpoint") or "txt2img"
    finished = float(job.get("finished") or time.time())
    started = float(job.get("started") or job.get("created") or finished)
    expected = max(1, len(seeds) or int(meta.get("batch") or 1))
    picked = images[-expected:] if len(images) > expected else images
    batch_id = "j" + str(job.get("id") or "")[-10:]
    records = []
    for index, image in enumerate(picked):
        data = _b64_bytes(image)
        if not data:
            continue
        seed = seeds[index] if index < len(seeds) else (meta.get("seed") if isinstance(meta.get("seed"), int) and meta["seed"] >= 0 else None)
        width, height = _image_size_bytes(data)
        try:
            rel, _size = _save_generated_image(
                data,
                endpoint,
                seed,
                index + 1,
                infotexts[index] if index < len(infotexts) else "",
                "generate",
            )
        except OSError as exc:
            log.warning("save generated image failed: %s", exc)
            continue
        records.append({
            "id": "h" + secrets.token_urlsafe(9),
            "path": rel,
            "mode": "img2img" if endpoint == "img2img" else "txt2img",
            "kind": "generate",
            "created": int(finished * 1000),
            "finished": int(finished * 1000),
            "seed": seed,
            "width": width or int(meta.get("width") or 0),
            "height": height or int(meta.get("height") or 0),
            "steps": meta.get("steps"),
            "cfg": meta.get("cfg"),
            "sampler": meta.get("sampler") or "",
            "scheduler": meta.get("scheduler") or "",
            "prompt": meta.get("prompt") or "",
            "negative": meta.get("negative") or "",
            "model": meta.get("model") or "",
            "hires": bool(meta.get("hires")),
            "denoise": meta.get("denoise"),
            "batchId": batch_id,
            "batchIndex": index + 1,
            "batchTotal": len(picked),
            "elapsed": round(max(0.0, finished - started), 1),
            "interrupted": bool(job.get("interrupted")),
            "scale": None,
            "source": "",
        })
    if records:
        # 多张抽卡必须整批入库；原先在循环内 return 只记第一张，后几张成了孤儿文件。
        _history_add(records)
        log.info("history recorded %d image(s) for job %s", len(records), job.get("id"))
    return records


AUTH_SETUP_PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>KlockUI 远程访问</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3f7;color:#1c1b1f;
font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{width:min(420px,calc(100vw - 32px));padding:28px 24px;border-radius:22px;background:#fff;
box-shadow:0 18px 50px rgba(0,0,0,.12);line-height:1.7}
h1{margin:0 0 10px;font-size:22px}p{margin:8px 0;color:#49454f}
code{display:inline-block;padding:2px 7px;border-radius:7px;background:#f0ecf4;color:#1c1b1f;font-size:13px}
</style></head><body><main>
<h1>远程访问未启用</h1>
<p>隧道已经连到这台电脑，但还没有设置访问密码。</p>
<p>请先在电脑上运行：</p>
<p><code>python server.py --set-password</code></p>
<p>设置完成后刷新本页。</p>
</main></body></html>"""

AUTH_BROKEN_PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>KlockUI 认证异常</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3f7;color:#1c1b1f;
font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{width:min(420px,calc(100vw - 32px));padding:28px 24px;border-radius:22px;background:#fff;
box-shadow:0 18px 50px rgba(0,0,0,.12);line-height:1.7}
h1{margin:0 0 10px;font-size:22px}p{margin:8px 0;color:#49454f}
</style></head><body><main>
<h1>认证配置损坏</h1>
<p><code>.private/auth.json</code> 存在但无法读取，服务已拒绝所有访问，避免退回无密码状态。</p>
<p>请在电脑上重新运行 <code>python server.py --set-password</code>。</p>
</main></body></html>"""

LOGIN_PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>KlockUI 登录</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
background:radial-gradient(1100px 600px at 15% 0%,#efe7ff 0%,transparent 58%),
radial-gradient(900px 520px at 100% 100%,#e7f2ff 0%,transparent 55%),#f7f5fa;
color:#1c1b1f;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{width:min(360px,100%);padding:30px 26px 26px;border-radius:26px;background:rgba(255,255,255,.84);
border:1px solid rgba(255,255,255,.9);box-shadow:0 24px 70px rgba(52,35,85,.16);
backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.mark{width:40px;height:40px;border-radius:14px;background:linear-gradient(135deg,#7c4dff,#3d8bfd);
box-shadow:0 8px 20px rgba(92,74,255,.28);margin-bottom:18px}
h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
.sub{margin:0 0 22px;color:#625b71;font-size:13.5px}
label{display:block;margin:0 0 7px;font-size:12.5px;color:#625b71}
input{width:100%;height:48px;border-radius:14px;border:1px solid #d9d2e3;background:#fff;
padding:0 14px;font-size:16px;color:#1c1b1f;outline:none}
input:focus{border-color:#7c4dff;box-shadow:0 0 0 4px rgba(124,77,255,.14)}
button{width:100%;height:48px;margin-top:14px;border:0;border-radius:14px;cursor:pointer;
background:#6750a4;color:#fff;font-size:15px;font-weight:600;letter-spacing:.02em}
button:active{transform:scale(.985)}
.err{min-height:20px;margin:10px 1px 0;font-size:12.5px;color:#ba1a1a}
.foot{margin:18px 0 0;text-align:center;font-size:11.5px;color:#8a8297}
@media (prefers-color-scheme:dark){
body{background:radial-gradient(1100px 600px at 15% 0%,#2b2140 0%,transparent 58%),
radial-gradient(900px 520px at 100% 100%,#172538 0%,transparent 55%),#121016;color:#e9e3f1}
main{background:rgba(32,28,40,.86);border-color:rgba(255,255,255,.08);box-shadow:0 24px 70px rgba(0,0,0,.5)}
.sub,label{color:#b9b0c7}input{background:#1b1822;border-color:#3d354a;color:#f3eef8}
.err{color:#ffb4ab}.foot{color:#8f879d}button{background:#9b86d8;color:#17121f}
}
</style></head><body><main>
<div class="mark"></div>
<h1>KlockUI</h1>
<p class="sub">输入访问密码继续</p>
<form method="post" action="/login">
<input type="hidden" name="next" value="__NEXT__">
<label for="password">访问密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">进入</button>
</form>
<p class="err" role="alert">__ERROR__</p>
<p class="foot">仅限本人使用</p>
</main></body></html>"""


def _mode_from_rel(rel):
    return "img2img" if str(rel or "").startswith("img2img-images/") else "txt2img"


def load_favorites():
    """读取收藏记录：{当前相对路径: {mode, origin, at}}，兼容旧的纯路径列表。"""
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        values = data.get("favorites", []) if isinstance(data, dict) else data
        favorites = {}
        for item in values:
            if isinstance(item, str):
                rel = item.replace("\\", "/").strip().lstrip("/")
                if not rel:
                    continue
                in_favorites = rel.startswith(FAVORITES_DIRNAME + "/")
                favorites[rel] = {
                    "mode": _mode_from_rel(rel),
                    "origin": "" if in_favorites else rel,
                    "at": 0,
                }
            elif isinstance(item, dict):
                rel = str(item.get("path") or "").replace("\\", "/").strip().lstrip("/")
                if not rel:
                    continue
                favorites[rel] = {
                    "mode": "img2img" if item.get("mode") == "img2img" else "txt2img",
                    "origin": str(item.get("origin") or "").replace("\\", "/").strip().lstrip("/"),
                    "at": int(item.get("at") or 0),
                }
        return favorites
    except FileNotFoundError:
        return {}
    except Exception as exc:  # noqa: BLE001
        log.warning("read favorites failed: %s", exc)
        return {}


def save_favorites(favorites):
    tmp = FAVORITES_FILE + ".tmp"
    os.makedirs(os.path.dirname(FAVORITES_FILE), exist_ok=True)
    records = []
    for rel in sorted(favorites):
        meta = favorites[rel] or {}
        records.append({
            "path": rel,
            "mode": "img2img" if meta.get("mode") == "img2img" else "txt2img",
            "origin": str(meta.get("origin") or ""),
            "at": int(meta.get("at") or 0),
        })
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"favorites": records}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, FAVORITES_FILE)


# 图片目录扫描缓存：3000 张图 os.walk + os.stat 约 180ms，
# 而作品库翻页每页都要扫一次 —— 缓存 30 秒复用；生成/删除/收藏等写操作会显式失效。
_GZIP_CACHE = {}
_SCAN_CACHE = {"at": 0.0, "items": None}
_SCAN_TTL = 30.0


def _invalidate_scan():
    _SCAN_CACHE["items"] = None


def scan_images(force=False):
    now = time.time()
    if not force and _SCAN_CACHE["items"] is not None and now - _SCAN_CACHE["at"] < _SCAN_TTL:
        # 浅拷贝：调用方会往 item 里塞 favorite / mode，别污染缓存
        return [dict(item) for item in _SCAN_CACHE["items"]]
    items = []
    for folder in IMAGE_DIRS:
        base = os.path.join(OUTPUT_ROOT, folder)
        if not os.path.isdir(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [name for name in dirs if not name.startswith(".")]
            for name in files:
                ext = os.path.splitext(name)[1].lower()
                if ext not in IMAGE_EXTS:
                    continue
                full = os.path.join(root, name)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = os.path.relpath(full, OUTPUT_ROOT).replace("\\", "/")
                rel_folder = rel.split("/", 1)[0]
                stem = os.path.splitext(name)[0]
                tail = stem.rsplit("-", 1)[-1]
                items.append({
                    "path": rel,
                    "name": name,
                    "folder": rel_folder,
                    "mode": "img2img" if rel_folder == "img2img-images" else "txt2img",
                    "mtime": int(st.st_mtime),
                    "size": st.st_size,
                    "seed": tail if tail.isdigit() else "",
                })
    items.sort(key=lambda item: (item["mtime"], item["path"]), reverse=True)
    _SCAN_CACHE["at"] = now
    _SCAN_CACHE["items"] = items
    return [dict(item) for item in items]


def safe_image_path(rel):
    rel = str(rel or "").replace("\\", "/").strip().lstrip("/")
    parts = [part for part in rel.split("/") if part not in ("", ".")]
    if not parts or ".." in parts or parts[0] not in IMAGE_DIRS:
        return None, None
    if os.path.splitext(parts[-1])[1].lower() not in IMAGE_EXTS:
        return None, None
    base = os.path.realpath(OUTPUT_ROOT)
    full = os.path.realpath(os.path.join(OUTPUT_ROOT, *parts))
    if not full.startswith(base + os.sep):
        return None, None
    return full, "/".join(parts)


def thumb_cache_path(rel, st):
    key = f"{rel}|{st.st_mtime_ns}|{st.st_size}".encode("utf-8")
    return os.path.join(THUMB_DIR, hashlib.sha1(key).hexdigest() + ".jpg")


def _output_rel(full):
    return os.path.relpath(full, OUTPUT_ROOT).replace("\\", "/")


def _unique_dest(directory, name):
    """同名文件不覆盖：foo.png -> foo-2.png。"""
    stem, ext = os.path.splitext(name)
    candidate = os.path.join(directory, name)
    index = 2
    while os.path.exists(candidate):
        candidate = os.path.join(directory, "%s-%d%s" % (stem, index, ext))
        index += 1
    return candidate


def _remove_thumb(rel, st):
    try:
        cache_path = thumb_cache_path(rel, st)
        if os.path.isfile(cache_path):
            os.remove(cache_path)
    except OSError:
        pass


def favorite_image(rel, full, favorites):
    """把图片移进 favorites/，返回 (新相对路径, 是否发生移动)。"""
    if rel.startswith(FAVORITES_DIRNAME + "/"):
        meta = favorites.get(rel) or {}
        favorites[rel] = {
            "mode": meta.get("mode") or "txt2img",
            "origin": meta.get("origin") or "",
            "at": meta.get("at") or int(time.time()),
        }
        return rel, False
    st = os.stat(full)
    os.makedirs(FAVORITES_DIR, exist_ok=True)
    dest = _unique_dest(FAVORITES_DIR, os.path.basename(full))
    shutil.move(full, dest)
    new_rel = _output_rel(dest)
    favorites.pop(rel, None)
    favorites[new_rel] = {
        "mode": _mode_from_rel(rel),
        "origin": rel,
        "at": int(time.time()),
    }
    _remove_thumb(rel, st)
    return new_rel, True


def _restore_dir(origin):
    """只允许把收藏还原到 txt2img-images / img2img-images 内的原目录。"""
    rel = str(origin or "").replace("\\", "/").strip().lstrip("/")
    parts = [part for part in rel.split("/") if part not in ("", ".")]
    base = os.path.realpath(OUTPUT_ROOT)
    if parts and ".." not in parts and parts[0] in ("txt2img-images", "img2img-images"):
        directory = os.path.join(OUTPUT_ROOT, *parts[:-1]) if len(parts) > 1 else os.path.join(OUTPUT_ROOT, parts[0])
        if os.path.realpath(directory).startswith(base + os.sep):
            return directory
    return os.path.join(OUTPUT_ROOT, "txt2img-images")


def unfavorite_image(rel, full, favorites):
    """取消收藏：favorites/ 里的图片按记录还原到原目录，返回 (新相对路径, 是否发生移动)。"""
    meta = favorites.pop(rel, None) or {}
    if not rel.startswith(FAVORITES_DIRNAME + "/"):
        return rel, False
    st = os.stat(full)
    directory = _restore_dir(meta.get("origin"))
    os.makedirs(directory, exist_ok=True)
    origin_name = os.path.basename(str(meta.get("origin") or "").replace("\\", "/"))
    if os.path.splitext(origin_name)[1].lower() not in IMAGE_EXTS:
        origin_name = os.path.basename(full)
    dest = _unique_dest(directory, origin_name)
    shutil.move(full, dest)
    new_rel = _output_rel(dest)
    _remove_thumb(rel, st)
    return new_rel, True


def migrate_favorites():
    """旧版收藏仍散落在出图目录时，启动后统一搬进 favorites/。"""
    try:
        os.makedirs(FAVORITES_DIR, exist_ok=True)
    except OSError as exc:
        log.warning("favorites dir unavailable: %s", exc)
        return
    with GALLERY_LOCK:
        favorites = load_favorites()
        changed = False
        for rel in list(favorites):
            if rel.startswith(FAVORITES_DIRNAME + "/"):
                continue
            full, safe_rel = safe_image_path(rel)
            if not full or not os.path.isfile(full):
                favorites.pop(rel, None)
                changed = True
                continue
            try:
                favorite_image(safe_rel, full, favorites)
                changed = True
            except OSError as exc:
                log.warning("migrate favorite failed %s: %s", safe_rel, exc)
        if changed:
            try:
                save_favorites(favorites)
            except OSError as exc:
                log.warning("save favorites failed: %s", exc)


GALLERY_INFO_CACHE = {}
GALLERY_INFO_LOCK = threading.Lock()


def parse_generation_parameters(raw):
    """把 Forge/A1111 的 parameters 文本拆成正向、负面和参数字典。"""
    text = str(raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return "", "", {}
    lines = text.split("\n")
    meta_start = -1
    for index in range(len(lines) - 1, -1, -1):
        if lines[index].lstrip().startswith("Steps:"):
            meta_start = index
            break
    prompt_text = "\n".join(lines[:meta_start]).strip() if meta_start >= 0 else text
    meta = {}
    if meta_start >= 0:
        meta_line = " ".join(line.strip() for line in lines[meta_start:] if line.strip())
        for part in re.split(r",\s*(?=[^,:]{1,40}:\s)", meta_line):
            key, sep, value = part.partition(":")
            key = key.strip()
            value = value.strip()
            if sep and key and value:
                meta[key] = value
    if prompt_text.startswith("Negative prompt:"):
        positive = ""
        negative = prompt_text[len("Negative prompt:"):].strip()
    elif "\nNegative prompt:" in prompt_text:
        positive, negative = prompt_text.split("\nNegative prompt:", 1)
        positive = positive.strip()
        negative = negative.strip()
    else:
        positive, negative = prompt_text, ""
    return positive, negative, meta


def _png_text_value(ctype, data):
    """解出 PNG 的 tEXt/zTXt/iTXt 文本块。"""
    try:
        if ctype == b"tEXt":
            keyword, _, value = data.partition(b"\x00")
            if not keyword or not value:
                return None
            try:
                text = value.decode("utf-8")
            except UnicodeDecodeError:
                text = value.decode("latin-1", "replace")
            return keyword.decode("latin-1", "replace"), text
        if ctype == b"zTXt":
            keyword, _, rest = data.partition(b"\x00")
            if not keyword or len(rest) < 2 or rest[0] != 0:
                return None
            text = zlib.decompress(rest[1:]).decode("utf-8", "replace")
            return keyword.decode("latin-1", "replace"), text
        if ctype == b"iTXt":
            keyword, _, rest = data.partition(b"\x00")
            if not keyword or len(rest) < 3:
                return None
            compressed = rest[0] == 1
            parts = rest[2:].split(b"\x00", 2)
            if len(parts) < 3:
                return None
            value = parts[2]
            if compressed:
                value = zlib.decompress(value)
            return keyword.decode("latin-1", "replace"), value.decode("utf-8", "replace")
    except (zlib.error, ValueError, UnicodeDecodeError):
        return None
    return None


def read_png_info(full):
    """只读 PNG 头与文本块，不依赖 Pillow，返回 (宽, 高, 文本字典)。"""
    texts = {}
    try:
        with open(full, "rb") as handle:
            if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                return 0, 0, texts
            width = height = 0
            for _ in range(4096):
                head = handle.read(8)
                if len(head) < 8:
                    break
                length, ctype = struct.unpack(">I4s", head)
                if length > 16 * 1024 * 1024:
                    break
                data = handle.read(length)
                if len(data) < length:
                    break
                handle.read(4)  # CRC
                if ctype == b"IHDR" and len(data) >= 8:
                    width, height = struct.unpack(">II", data[:8])
                elif ctype in (b"tEXt", b"zTXt", b"iTXt"):
                    parsed = _png_text_value(ctype, data)
                    if parsed:
                        texts[parsed[0]] = parsed[1]
                elif ctype == b"IEND":
                    break
            return width, height, texts
    except OSError:
        return 0, 0, {}


def read_gallery_info(full, rel, st):
    """读取图片内嵌生成参数；按 mtime/size 缓存，避免重复解码大图。"""
    key = (rel, st.st_mtime_ns, st.st_size)
    with GALLERY_INFO_LOCK:
        cached = GALLERY_INFO_CACHE.get(key)
    if cached is not None:
        return cached
    width, height, texts = read_png_info(full)
    raw = texts.get("parameters") or texts.get("Parameters") or texts.get("Comment") or ""
    if not raw and Image is not None:
        try:
            with Image.open(full) as image:
                width, height = image.size
                raw = image.info.get("parameters") or ""
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            raw = ""
    raw = str(raw or "").strip()
    positive, negative, meta = parse_generation_parameters(raw)
    info = {
        "prompt": positive,
        "negative": negative,
        "meta": meta,
        "width": width,
        "height": height,
        "raw": raw[:20000],
    }
    with GALLERY_INFO_LOCK:
        if len(GALLERY_INFO_CACHE) >= 96:
            GALLERY_INFO_CACHE.clear()
        GALLERY_INFO_CACHE[key] = info
    return info


def _engine_health(cfg, timeout=1.2):
    try:
        with urllib.request.urlopen(cfg["url"] + "/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001
        return False


def prompt_llm_health(timeout=1.2):
    return _engine_health(PROMPT_LLM, timeout)


def _rotate_log(path, limit=2 * 1024 * 1024):
    """llama.cpp 日志按 2 MB 轮转，只留一份 .1 备份，避免无限增长。"""
    try:
        if os.path.isfile(path) and os.path.getsize(path) > limit:
            os.replace(path, path + ".1")
    except OSError:
        pass


def _available_mb():
    """当前可用物理内存（MB）；psutil 不可用时返回 None。"""
    try:
        import psutil
        return int(psutil.virtual_memory().available / (1024 * 1024))
    except Exception:  # noqa: BLE001
        return None


def _port_pid(port):
    """返回监听指定本地端口的进程 PID。"""
    try:
        import psutil
        for conn in psutil.net_connections(kind="inet"):
            if conn.status == psutil.CONN_LISTEN and conn.laddr and conn.laddr.port == port:
                return conn.pid
    except Exception:  # noqa: BLE001
        return None
    return None


def _trim_working_set(pid):
    """让 Windows 回收目标进程的工作集，给提示词模型腾出物理内存。"""
    if not pid or os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        psapi.EmptyWorkingSet.argtypes = [wintypes.HANDLE]
        psapi.EmptyWorkingSet.restype = wintypes.BOOL
        # PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION
        handle = kernel32.OpenProcess(0x0100 | 0x0400, False, int(pid))
        if not handle:
            return False
        try:
            return bool(psapi.EmptyWorkingSet(handle))
        finally:
            kernel32.CloseHandle(handle)
    except Exception:  # noqa: BLE001
        return False


def _forge_busy():
    """引擎是否正在出图；忙时不裁剪工作集/卸载，避免拖慢任务。"""
    return comfy_bridge.busy()


def _relieve_llm_memory(need_mb=3072):
    """转写前确保有足够物理内存；不足时裁剪 Forge 工作集。"""
    free = _available_mb()
    if free is None or free >= need_mb:
        return free
    if _forge_busy():
        log.info("prompt llm low memory (%sMB) but forge busy; skip trim", free)
        return free
    pid = _port_pid(8188)
    before = free
    if pid and _trim_working_set(pid):
        time.sleep(0.5)
        free = _available_mb()
        log.info("prompt llm memory relief: trimmed forge pid=%s, free %sMB -> %sMB",
                 pid, before, free)
    return free


def _forge_unload_checkpoint():
    """切换模型前卸掉旧权重，释放 ComfyUI 的模型缓存。"""
    return comfy_bridge.unload()


def _stop_engine(cfg, reason="", soft=False):
    """停掉引擎；soft=True 表示主动释放（空闲/切到不需要它的架构），不算故障。"""
    proc = cfg.get("proc")
    cfg["proc"] = None
    stopped = False
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
            stopped = True
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
                stopped = True
            except Exception:  # noqa: BLE001
                pass
    if not stopped:
        pid = _port_pid(cfg["port"])
        if pid:
            try:
                import psutil
                p = psutil.Process(pid)
                p.terminate()
                try:
                    p.wait(timeout=3)
                except psutil.TimeoutExpired:
                    p.kill()
                stopped = True
            except Exception:  # noqa: BLE001
                pass
    if soft:
        # 主动释放不是故障：别把 "engine restarted after ..." 写进状态面板。
        cfg["last_error"] = ""
        log.info("prompt engine released: %s", reason or "idle")
    else:
        cfg["last_error"] = "engine restarted after %s" % (reason or "timeout")
        log.warning("prompt engine stopped: %s", reason or "timeout")


def _start_engine(cfg):
    """按需启动 llama.cpp 引擎；已运行则直接复用。"""
    if _engine_health(cfg):
        return True
    with cfg["start_lock"]:
        if _engine_health(cfg):
            return True
        exe = cfg["exe"]
        if not os.path.isfile(exe):
            cfg["last_error"] = "找不到 llama-server.exe：%s" % exe
            log.warning(cfg["last_error"])
            return False
        if not os.path.isfile(cfg["model"]):
            cfg["last_error"] = "找不到提示词模型：%s" % cfg["model"]
            log.warning(cfg["last_error"])
            return False
        threads = str(cfg.get("threads") or max(4, min(8, (os.cpu_count() or 8) // 2)))
        args = [
            exe,
            "--model", cfg["model"],
            "--host", "127.0.0.1",
            "--port", str(cfg["port"]),
            "--ctx-size", str(cfg["ctx"]),
            "--threads", threads,
            "--threads-batch", threads,
            "--parallel", "1",
            "--no-ui",
            "--alias", cfg["alias"],
        ]
        if cfg.get("no_think"):
            # Qwen3.5 混合推理模板：预算 0 = 立即结束思考段，提示词任务不需要思维链。
            args += ["--reasoning-budget", "0", "--reasoning-format", "none"]
        _relieve_llm_memory()
        flags = 0
        if os.name == "nt":
            # 隐藏启动的 KlockUI 可能继承 BelowNormal；显式提到 Normal，避免 CPU 被前台应用饿死。
            flags = (getattr(subprocess, "CREATE_NO_WINDOW", 0)
                     | getattr(subprocess, "NORMAL_PRIORITY_CLASS", 0))
        out_path = os.path.join(LLAMA_ENGINE_DIR, cfg["log"] + ".out.log")
        err_path = cfg.get("err_log") or os.path.join(LLAMA_ENGINE_DIR, cfg["log"] + ".err.log")
        try:
            os.makedirs(LLAMA_ENGINE_DIR, exist_ok=True)
            _rotate_log(err_path)
            _rotate_log(out_path)
            with open(out_path, "ab") as out, open(err_path, "ab") as err:
                cfg["proc"] = subprocess.Popen(
                    args,
                    cwd=LLAMA_ENGINE_DIR,
                    stdout=out,
                    stderr=err,
                    stdin=subprocess.DEVNULL,
                    creationflags=flags,
                )
        except Exception as exc:  # noqa: BLE001
            cfg["last_error"] = "启动 llama-server 失败：%s" % exc
            log.warning(cfg["last_error"])
            return False
        deadline = time.time() + 90
        while time.time() < deadline:
            if _engine_health(cfg, 1.0):
                cfg["last_error"] = ""
                log.info("prompt engine ready on %s", cfg["url"])
                return True
            if cfg["proc"].poll() is not None:
                break
            time.sleep(0.25)
        cfg["last_error"] = "llama-server 未在 90 秒内就绪，请检查 %s" % err_path
        log.warning(cfg["last_error"])
        return False


def ensure_prompt_llm():
    return _start_engine(PROMPT_LLM)


def release_prompt_llm(reason="idle"):
    """停掉 4B，把约 2GB 物理内存还给系统。

    4B 只在 Anima/SDXL 需要中文转英文时用得上；MOSS 的 TE 本身就是
    Qwen3.5-9B、中文长文本原生支持，转写层已关闭。所以切到 MOSS 或空闲
    够久时没有任何理由让它继续占着内存。下次真正需要时 ensure_prompt_llm()
    会冷启动，功能不受影响。
    """
    if not prompt_llm_health(0.5):
        PROMPT_LLM["last_used"] = 0.0
        return False
    # 有请求正在跑就不动它，交给下一轮空闲检查。
    if not PROMPT_LLM["lock"].acquire(blocking=False):
        return False
    try:
        _stop_engine(PROMPT_LLM, reason, soft=True)
        PROMPT_LLM["last_used"] = 0.0
    finally:
        PROMPT_LLM["lock"].release()
    return True


def _prompt_idle_loop():
    """4B 空闲到点自动退出，避免常驻吃内存。"""
    idle_limit = int(PROMPT_LLM.get("idle_seconds") or 0)
    if idle_limit <= 0:
        return
    while True:
        time.sleep(30)
        try:
            if not prompt_llm_health(0.5):
                continue
            last = float(PROMPT_LLM.get("last_used") or 0)
            if not last:
                # 进程是本服务拉起但还没记过时间，从现在开始计时。
                PROMPT_LLM["last_used"] = time.time()
                continue
            idle = time.time() - last
            if idle < idle_limit:
                continue
            if release_prompt_llm("idle %.0fs" % idle):
                log.info("prompt LLM released after %.0fs idle (freed ~2GB RAM)", idle)
        except Exception as exc:  # noqa: BLE001
            log.debug("prompt idle check skipped: %s", exc)


def _engine_post(cfg, path, payload, timeout=120):
    if not cfg["lock"].acquire(timeout=timeout):
        raise TimeoutError("engine busy")
    try:
        req = urllib.request.Request(
            cfg["url"] + path,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except TimeoutError:
            # 卡死的生成会继续占用唯一 slot，下一次请求必须换一个干净进程。
            _stop_engine(cfg, "request timeout")
            raise
    finally:
        cfg["lock"].release()


def split_tag_text(raw):
    text = re.sub(r"<\|[^>]*\|>", " ", str(raw or ""))
    # 4B 爱用 Markdown 加粗：**Tags:**、**1girl**、- **solo**。
    # 星号和反引号不是 Danbooru 标签的一部分，先整体剔除再分词。
    text = text.replace("`", "").replace("*", "")
    # U+2010/U+2011 等排版连字符统一成 ASCII，否则 double‑tail 无法命中别名表。
    text = text.translate({0x2010: "-", 0x2011: "-", 0x2013: "-", 0x2014: "-"})
    text = re.sub(r"^\s*(?:tags?|output|prompt)\s*[:：]\s*", "", text.strip(), flags=re.I)
    tags = []
    for part in re.split(r"[,\n]", text):
        tag = part.strip().strip('"').strip("'").strip(".").strip()
        tag = re.sub(r"^(?:[-–—•]|\d+[.)、])\s*", "", tag)
        tag = tag.strip().strip("#").strip()
        tag = re.sub(r"\s+", " ", tag)
        if RAW_PROMPT:
            # 原样模式：这里先保留大小写、重复项、CJK 与超长标签，
            # Anima 的英文出口清洗统一在 _finish_llm_prompt_raw 里做。
            if tag:
                tags.append(tag)
            continue
        tag = tag.lower()
        tag = TAG_ALIASES.get(tag, tag)
        if tag and len(tag) <= 80 and tag not in tags:
            tags.append(tag)
    return tags


def _person_counts(tags):
    girls = boys = others = 0
    multiple = False
    for tag in tags:
        match = PERSON_TAG_RE.match(tag)
        if match:
            count = int(match.group(1))
            kind = match.group(2)
            if kind.startswith("girl"):
                girls += count
            elif kind.startswith("boy"):
                boys += count
            else:
                others += count
        elif tag in ("multiple girls", "multiple boys", "multiple others"):
            multiple = True
    return girls, boys, others, multiple


def apply_pose_hints(tags, idea):
    """Qwen 常把侧躺/趴翻成 lying on back；这里按中文原意做确定性修正。"""
    low = str(idea or "")
    out = [TAG_ALIASES.get(tag, tag) for tag in tags]
    if "侧躺" in low or "侧卧" in low:
        out = [tag for tag in out if tag not in ("lying on back", "on back", "on stomach", "lying on stomach")]
        out.append("lying on side")
    elif "仰卧" in low or "平躺" in low:
        out = [tag for tag in out if tag not in ("lying on side", "on side", "on stomach", "lying on stomach")]
        out.append("on back")
    elif "趴" in low or "俯卧" in low:
        out = [tag for tag in out if tag not in ("lying on side", "on side", "on back", "lying on back")]
        out.append("on stomach")
    if "背对" in low:
        out = [tag for tag in out if tag not in ("looking at viewer", "looking back", "facing viewer")]
        out.append("from behind")
    return out


def preserve_user_tags(idea, existing):
    """把用户亲手写的英文标签按原文补回，抵消 4B 的改写与丢标签。

    只处理明确像标签的段：纯英文、≤5 词、不含句读与散文虚词、不是质量/评级/模型名。
    通用中文句子仍交给 4B 转写；中文只做 ZH_TAG_GLOSSARY 的精确匹配。
    少于 3 个英文标签且没有 2 个以上术语命中时视为普通描述，不启用回填。
    """
    idea_text = str(idea or "")
    segments = [part.strip() for part in USER_TAG_SPLIT_RE.split(idea_text) if part.strip()]
    english = []
    glossary = []
    character_words = {
        char_tag for rule, char_tag, _series in CHARACTER_TAG_RULES if rule.search(idea_text)
    }

    for segment in segments:
        low = re.sub(r"\s+", " ", segment).strip().lower()
        if not low:
            continue
        if re.search(r"[\u4e00-\u9fff]", low):
            mapped = ZH_TAG_GLOSSARY.get(low)
            if mapped:
                glossary.append(mapped)
            continue
        low = low.rstrip(".").strip()
        if not low or len(low) > 80:
            continue
        if split_artist_tag(low):
            # 画师标签（含权重与转义括号）必须按原文保留，不走普通标签的字符白名单。
            if low not in english:
                english.append(low)
            continue
        if not USER_TAG_CHARS_RE.match(low):
            continue
        if re.search(r"[.!?;:。！？；：]", low):
            continue
        if len(low.split()) > 5:
            continue
        if USER_TAG_PROSE_RE.search(low):
            continue
        if low in QUALITY_TAGS or low in TAG_DENYLIST or low in META_TAGS:
            continue
        if RATING_TAG_RE.fullmatch(low):
            continue
        # 角色名交给 apply_character_tags 统一补写，避免这里先塞一个错拼。
        if any(
            fuzz and (fuzz.fullmatch(low) or (len(low) >= 3 and fuzz.search(low)))
            for char_tag, fuzz in CHARACTER_TAG_FUZZ.items()
            if char_tag in character_words
        ):
            continue
        if low not in english:
            english.append(low)

    # @画师 是显式标记，数量再少也必须按原文回填；普通英文标签仍要 3 个以上。
    if len(english) < 3 and not glossary and not any(split_artist_tag(tag) for tag in english):
        return []

    def words_of(text):
        return {word for word in re.split(r"[^a-z0-9]+", str(text).lower()) if len(word) > 2}

    existing_set = set(existing)
    existing_words = set()
    for tag in existing:
        existing_words |= words_of(tag)

    out = []
    for tag in apply_pose_hints(english, idea) + glossary:
        tag = TAG_ALIASES.get(tag, tag)
        if not tag or tag in out or tag in existing_set:
            continue
        if split_artist_tag(tag):
            # 画师标签（含权重）必须保留 @；调用方会把同名的裸版本删掉。
            out.append(tag)
            continue
        # soft window light 与已有的 window light + soft lighting 语义重合，按词覆盖跳过。
        tag_words = words_of(tag)
        if tag_words and tag_words <= existing_words:
            continue
        out.append(tag)
        existing_words |= tag_words
    return out


def normalize_seed_tags(tags, idea=""):
    out = []
    for tag in apply_pose_hints(tags, idea):
        tag = TAG_ALIASES.get(tag, tag)
        if not tag or tag in QUALITY_TAGS or tag in TAG_DENYLIST or tag in META_TAGS:
            continue
        if tag not in out:
            out.append(tag)

    low = str(idea or "").lower()
    girls, boys, others, multiple = _person_counts(out)
    has_person = girls + boys + others > 0 or bool(PERSON_WORD_RE.search(low))
    if girls + boys + others == 0 and not multiple and has_person:
        if re.search(r"两位|两个|两名|2\s*位|two\s+(?:women|girls)", low):
            out = ["2girls", "multiple girls"] + out
            girls = 2
        elif re.search(r"女|woman|girl|lady|female", low):
            out = ["1girl", "solo", "mature female"] + out
            girls = 1
        elif re.search(r"男|man|boy|male", low):
            out = ["1boy", "solo", "mature male"] + out
            boys = 1

    if not has_person:
        out = [tag for tag in out if tag not in ("solo", "solo focus")]
    elif girls + boys + others <= 1 and not multiple:
        if "solo" not in out:
            out.insert(1 if out and out[0] in ("1girl", "1boy") else 0, "solo")
    else:
        out = [tag for tag in out if tag not in ("solo", "solo focus")]

    def seed_priority(tag):
        if PERSON_TAG_RE.match(tag) or tag in ("multiple girls", "multiple boys", "multiple others"):
            return 0
        if tag in ("solo", "male focus", "female focus"):
            return 1
        if tag in ("mature female", "mature male"):
            return 2
        return 3

    out.sort(key=seed_priority)
    final = []
    for tag in out:
        if tag not in final:
            final.append(tag)
    return final[:24]


def is_human_only_tag(tag):
    if tag in NON_PERSON_EXTRA or tag in HAIR_LENGTH or tag in HUMAN_EXPRESSIONS or tag in HUMAN_BODY:
        return True
    if tag in HAIR_COLORS or tag in EYE_COLORS:
        return True
    if "hair" in tag:
        return True
    # 风景/静物里 4B 会补 "amber eyes" 这类未登记色名的眼睛标签，一律按人物特征清掉。
    if re.search(r"\beyes?\b", tag):
        return True
    # 手/腰/肩/腿这类身体部位与姿势标签，在风景/静物里同样没有对象。
    if re.search(
        r"\b(?:hands?|arms?|legs?|fingers?|fingernails?|shoulders?|hips?|waist|"
        r"knees?|thighs?|feet|foot|toes?|face|chest|breasts?|cleavage|navel|"
        r"collarbone|skin)\b",
        tag,
    ):
        return True
    # 4B 在风景里会写 "lone adult" / "gaze directed toward peaks" 这类
    # 带人物但不符合 PERSON_TAG_RE 的短语。
    if re.search(
        r"\b(?:adult|figure|silhouette|person|people|someone|anyone|"
        r"woman|women|man|men|girl|boy|female|male|lady|gentleman|"
        r"gazes?|gazing|stares?|staring|looking|expressions?|"
        r"standing|sitting|walking|running|kneeling|lying|wearing|dressed|poses?)\b",
        tag,
    ):
        return True
    return any(word in tag for word in BASE_GARMENTS)


def strip_unwanted_person(tags, idea):
    """Qwen 会无条件塞 1girl；没有人物线索的场景要清掉人物与看镜头标签。"""
    if PERSON_WORD_RE.search(str(idea or "")):
        return tags
    idea_low = str(idea or "").lower()
    drop = set(PERSON_TAGS) | {"mature female", "mature male"}
    out = []
    for tag in tags:
        if tag in drop or PERSON_TAG_RE.match(tag) or is_human_only_tag(tag):
            continue
        hints = NO_PERSON_PROP_HINTS.get(tag)
        # 风景里 4B 常顺手补“靴子/咖啡杯”，原文没提就一起清掉。
        if hints and not any(hint in idea_low for hint in hints):
            continue
        # 同理，虚构人物的衣服也要清掉，除非原文自己写了这类服装。
        garment = next(
            (word for word in BASE_GARMENTS if re.search(r"\b%s\b" % word, tag)),
            "",
        )
        if garment and not any(
            hint in idea_low for hint in GARMENT_IDEA_HINTS.get(garment, ())
        ):
            continue
        out.append(tag)
    return out


def looks_like_tag_list(text):
    low = str(text or "").lower()
    if re.search(r"[\u4e00-\u9fff]", low):
        return False
    if "," not in low or re.search(r"[.!?;。！？；]", low):
        return False
    parts = [part.strip() for part in low.split(",") if part.strip()]
    if len(parts) < 3:
        return False
    words = sum(len(part.split()) for part in parts)
    return words / len(parts) <= 4


def merge_tags(seed, extra, allow_person=True):
    seed_set = set(seed)
    hair = {tag for tag in seed_set if tag in HAIR_COLORS}
    eyes = {tag for tag in seed_set if tag in EYE_COLORS}
    girls, boys, others, multiple = _person_counts(seed)
    seed_has_person = bool(girls or boys or others or multiple)
    clothing_words = (
        "lingerie", "shirt", "dress", "coat", "skirt", "pants", "shorts", "jeans",
        "swimsuit", "bikini", "bra", "panties", "uniform", "sweater", "hoodie", "vest", "robe",
    )
    has_clothing = any(any(word in tag for word in clothing_words) for tag in seed)
    has_base_garment = any(any(word in tag for word in BASE_GARMENTS) for tag in seed)

    out = list(seed)
    view_visible = {"looking at viewer", "looking back", "facing viewer"}
    frame_tags = {"upper body", "full body", "cowboy shot", "portrait"}
    seed_view_visible = bool(view_visible & seed_set)
    seed_from_behind = "from behind" in seed_set
    seed_frame = frame_tags & seed_set
    seed_pose = POSE_TAGS & seed_set
    for tag in extra:
        if tag in seed_set or tag in out:
            continue
        if tag in QUALITY_TAGS or tag in TAG_DENYLIST:
            continue
        if (tag in PERSON_TAGS or PERSON_TAG_RE.match(tag)) and (seed_has_person or not allow_person):
            continue
        if not allow_person and is_human_only_tag(tag):
            continue
        if allow_person and tag in ("scenery", "no humans"):
            continue
        if tag in HAIR_COLORS and hair and tag not in hair:
            continue
        if tag in EYE_COLORS and eyes and tag not in eyes:
            continue
        if tag in NUDITY_TAGS and has_clothing:
            continue
        if has_base_garment and any(word in tag for word in BASE_GARMENTS):
            continue
        if tag == "from behind" and seed_view_visible:
            continue
        if tag in view_visible and seed_from_behind:
            continue
        if tag in frame_tags and seed_frame:
            continue
        if tag in POSE_TAGS and seed_pose:
            continue
        if tag == "closed eyes" and seed_view_visible:
            continue
        out.append(tag)
        if len(out) >= 45:
            break

    girls2, boys2, others2, multiple2 = _person_counts(out)
    if allow_person and girls2 + boys2 + others2 <= 1 and not multiple2:
        if "solo" not in out:
            out.insert(1 if out and out[0] in ("1girl", "1boy") else 0, "solo")
    else:
        out = [tag for tag in out if tag not in ("solo", "solo focus")]
    return out


def quality_prefix(model, style):
    text = str(model or "").lower()
    if "cyber" in text or "pony" in text:
        return "score_9, score_8_up, score_7_up, source_photo, "
    if "nova" in text:
        # Nova Anime XL 官方 Illustrious 前缀（模型页原文）。
        return ("masterpiece, best quality, amazing quality, 4k, very aesthetic, "
                "high resolution, ultra-detailed, absurdres, newest, ")
    if "miaomiao" in text or "miao" in text:
        return ("masterpiece, best quality, score_7, score_9, very aesthetic, "
                "ultra detailed, fair skin, high contrast, ")
    if "anima" in text or "silvermoon" in text:
        return "masterpiece, best quality, "
    if "krea" in text or "moss" in text:
        # Krea 2 / MOSS 走自然语言，标签式质量前缀会污染句子。
        return ""
    if style == "anime":
        return "masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, "
    return ""


# ---- 中文自然语言直出提示词：Qwen3.5-4B（CPU，llama.cpp）----
# Anima 用「英文画面描述 + 标签行」，Pony/SDXL 用纯 Danbooru 标签行。
PROMPT_LLM_SYSTEM_ANIMA = """You are the prompt writer for Anima 2.9B anime image models.
The user is an adult writing an image idea in Chinese or English. Turn it into one generation prompt.

Describe only what the camera sees: no smell, sound, taste, thoughts or backstory.

Return exactly two parts, no markdown, no commentary:
1) An English caption of 2-3 sentences, 30-80 words, describing one frozen frame: subject, pose, expression, exact clothing or nudity state, body type, camera angle, environment, lighting and mood. Present tense, concrete visual nouns.
2) A line starting with "Tags:" followed by 8-24 lowercase Danbooru tags separated by commas. Cover subject count and gender, mature female or mature male, hair, eyes, pose, clothing state, sexual acts if requested, location, lighting, camera angle."""


# 原样模式使用的系统提示：不做“保留细节/不要发明”的保真清单，
# 只按 Anima 官方规范约束输出结构（英文 caption + Danbooru 标签行）。
PROMPT_LLM_SYSTEM_ANIMA_RAW = """You write generation prompts for Anima, an anime image model that reads Danbooru tags and natural English.

Reply with exactly two parts and nothing else:
1) An English caption of 2-4 sentences (40-90 words) describing one frozen frame: subject, appearance, pose, expression, clothing or nudity state, camera angle, setting, light and mood. Present tense, visible details only.
2) A line starting with "Tags:" followed by 10-24 comma-separated English Danbooru tags.

Rules:
- Write English only. Never output Chinese, Japanese, pinyin, or translated duplicates.
- Every tag must be a real Danbooru tag: a short noun or attribute, never a sentence or a description.
- Tags are lowercase with spaces, never underscores: long hair, not long_hair.
- Only add 1girl or 1boy when the idea contains a person; for an animal, object or landscape, tag that subject itself (orange cat, cityscape).
- Order tags from the subject outward: appearance first, then pose and clothes, then place and light.
- Never write category words such as subject, appearance, pose, clothing, setting or lighting as tags.
- For a known character, write the character tag and its series tag.
- Artist names start with @.
- Skip quality, rating and model tags (masterpiece, best quality, highres, score_7, safe, nsfw, anima, pony, sdxl); the app adds them.
- No markdown, bullets, or commentary."""

PROMPT_LLM_SYSTEM_KREA = """You write generation prompts for Krea 2, an image model that reads long natural-language descriptions rather than Danbooru tags.

Reply with one English paragraph of 90-160 words and nothing else. Describe one frozen frame: subject and age, face and hair, expression, clothing or nudity state, pose and gesture, what the hands hold, the room or landscape, foreground and background, camera distance and angle, light source and direction, color palette, and the art style if the idea names one. Present tense, visible details only, no smell, sound, taste, thoughts or backstory.

Rules:
- Write English only. Never output Chinese, Japanese, pinyin, or translated duplicates.
- Use flowing sentences. Never output a comma-separated tag list, a "Tags:" line, markdown, bullets, or commentary.
- Open by naming the subject with an explicit age band: "a woman in her late twenties", "a man in his thirties", "a couple in their twenties". Never rely on the bare word "adult"; it makes Krea 2 draw elderly faces.
- Keep the requested framing: if the idea says close-up, stay close; if it says wide, stay wide.
- Do not add props, accessories, second people, camera angles or story events that the idea does not mention. If the idea names nothing in the hands, say nothing about the hands. Never write a bag, watch, phone, cup, jewelry, hat or cigarette unless the idea names it.
- Name each garment once, with the exact type the idea gives: a trench coat stays a trench coat, never a windbreaker or a jacket.
- Artist and character names may be written as plain names inside the sentence."""

PROMPT_LLM_SYSTEM_MOSS = """You write generation prompts for MOSS-Image, a 5B diffusion model whose text encoder is a language model (Qwen3.5-9B).

Reply with one English paragraph of 80-150 words and nothing else. Describe one frozen frame: subject and age, appearance, expression, clothing or nudity state, pose and hands, setting with foreground and background, camera distance and angle, light source and direction, color palette, and art style if the idea names one. Present tense, visible details only, no smell, sound, taste, thoughts or backstory.

Rules:
- Write English only. Never output Chinese, Japanese, pinyin, or translated duplicates.
- Flowing sentences only. Never output a comma-separated tag list, a "Tags:" line, markdown, bullets, or commentary.
- MOSS follows long, specific prompts far better than short ones. Keep every concrete noun: garment type, material, color, prop, location, light source.
- Do not invent props, second people, camera angles or story events the idea does not mention.
- Name each garment once with the exact type the idea gives; a trench coat stays a trench coat.
- Artist and character names may appear as plain names inside the sentence; no @ prefix and no weight syntax.
- Skip quality boilerplate (masterpiece, best quality, 8k, highres, absurdres); MOSS does not need it."""

# 4B 默认会“总结”描述：换掉服装/地点、把动作写到另一个人身上、只留氛围词。
# 这段保真约束追加在系统提示末尾（模型对末尾指令更敏感），不改变上面的输出格式。
PROMPT_LLM_FIDELITY_RULES = """Fidelity rules (must follow):
- The Idea is a checklist, not inspiration. Keep every concrete detail: number of people, adult age, gender, hair, eyes, body, clothing or nudity state, pose, who does what to whom, props, room, time of day, light source, camera distance, camera angle and art style.
- Open the caption by naming the subject (adult woman, adult man, or couple) with age, hair, eyes and clothing or nudity state; never start with a body part, a bare pronoun, or an action.
- Never swap roles or directions. If the man holds her waist, the man holds her waist; if she is on top, she is on top.
- Never replace a requested garment, place, camera angle or style with a different one.
- Do not invent details the Idea does not contain.
- Every requested detail must survive in either the caption or the Tags line; the Tags line must repeat the key visual details, not only mood and quality.
- All characters are adults. Completeness beats brevity."""

PROMPT_LLM_FIDELITY_RULES_KREA = PROMPT_LLM_FIDELITY_RULES.replace(
    "Every requested detail must survive in either the caption or the Tags line; "
    "the Tags line must repeat the key visual details, not only mood and quality.",
    "Every requested detail must survive in the paragraph; do not trade concrete "
    "details for mood or quality words.",
).replace(
    "Open the caption by naming the subject (adult woman, adult man, or couple) with age, hair, eyes and clothing or nudity state;",
    "Open the caption by naming the subject with an explicit age band (late twenties, thirties), hair, eyes and clothing or nudity state;",
)

PROMPT_LLM_FIDELITY_RULES_MOSS = PROMPT_LLM_FIDELITY_RULES.replace(
    "Every requested detail must survive in either the caption or the Tags line; "
    "the Tags line must repeat the key visual details, not only mood and quality.",
    "Every requested detail must survive in the paragraph; do not trade concrete "
    "details for mood or quality words.",
).replace(
    "Open the caption by naming the subject (adult woman, adult man, or couple) with age, hair, eyes and clothing or nudity state;",
    "Open the paragraph by naming the subject (adult woman, adult man, or couple) with age, hair, eyes and clothing or nudity state;",
)

# nsfw / explicit 档专用。只放开用户明确写出的成人内容，不允许自行加戏。
PROMPT_LLM_ADULT_RULES = """Adult rating: {rating}. The user is an adult requesting consensual adult content between adults.
- Do not censor, sanitize, euphemize, soften or fade to black. Write nudity and sexual acts directly with standard Danbooru wording when the Idea asks for them.
- Never write "making love", "intimate moment", "romance" or "sensual pose" in place of the requested act.
- Translate only the terms the Idea names: 做爱/性交 -> sex, 口交 -> fellatio, 女上位/骑乘 -> girl on top, 后入 -> doggy style, 全裸 -> completely nude, 射精 -> cum. If a term is absent, do not add its tag.
- Never add an act, fluid, body part or partner the Idea does not mention; keep the requested level.
- When the Idea is dense, use up to 5 caption sentences and 16-28 tags so no detail is lost."""

PROMPT_LLM_ADULT_RULES_MOSS = PROMPT_LLM_ADULT_RULES.replace(
    "- Write nudity and sexual acts directly with standard Danbooru wording when the Idea asks for them.",
    "- Write nudity and sexual acts directly in plain visual English when the Idea asks for them.",
).replace(
    "- When the Idea is dense, use up to 5 caption sentences and 16-28 tags so no detail is lost.",
    "- When the Idea is dense, use up to 200 words so no detail is lost.",
)


PROMPT_LLM_SYSTEM_TAGS_RAW = """You turn an image idea into comma-separated Danbooru tags for a Pony/SDXL anime model.
The idea may be written in Chinese; translate it and answer with lowercase English tags only.
Return only the tags, no caption, no commentary, no Chinese text."""


def _strip_think(text):
    out = str(text or "")
    # 用 \x3c 写尖括号，避免编辑链路把标签本身吞掉。
    out = re.sub(r"(?is)\x3cthink\x3e.*?\x3c/think\x3e", " ", out)
    out = re.sub(r"(?is)\x3credacted_reasoning\x3e.*?\x3c/redacted_reasoning\x3e", " ", out)
    out = out.replace("\x3cthink\x3e", " ").replace("\x3c/think\x3e", " ")
    return out.strip()


def _llm_chat(system, user, temperature, max_tokens=420):
    # 4B 在 8GB 显存/16GB 内存的本机上会被 Forge 的模型缓存挤到换页，
    # 表现为 prompt 处理完但生成停滞；转写前先腾出物理内存。
    _relieve_llm_memory()
    payload = {
        "model": PROMPT_LLM["alias"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "top_p": 0.9,
        "top_k": 40,
        "repeat_penalty": 1.05,
        "max_tokens": max_tokens,
        "seed": random.randint(0, 2**31 - 1),
        "stream": False,
        "cache_prompt": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    try:
        data = _engine_post(PROMPT_LLM, "/v1/chat/completions", payload, timeout=240)
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
        # 老模板不认 enable_thinking；服务已用 --reasoning-budget 0 关闭思考。
        payload.pop("chat_template_kwargs", None)
        data = _engine_post(PROMPT_LLM, "/v1/chat/completions", payload, timeout=240)
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    content = message.get("content") if isinstance(message, dict) else ""
    if not content:
        content = message.get("reasoning_content", "") if isinstance(message, dict) else ""
    return _strip_think(content)


def _clean_caption(text):
    out = str(text or "").strip()
    # 去掉 4B 的 Markdown 包装：**Caption:**、```、# 标题、反引号。
    out = out.replace("`", "").replace("*", "")
    out = out.translate({0x2010: "-", 0x2011: "-", 0x2013: "-", 0x2014: "-"})
    out = re.sub(r"^\s*#+\s*", "", out)
    out = re.sub(r"^\s*(?:caption|description|prompt|画面描述|描述)\s*[:：]\s*", "", out, flags=re.I)
    # 模型名/档案名会被 4B 当成场景标题回显；原样模式下不再替它剥掉。
    if not RAW_PROMPT:
        out = re.sub(
            r"^\s*(?:miaomiao(?: ?harem)?|silvermoon(?: ?mix)?|cyberrealistic(?: ?pony)?|"
            r"anima|pony|sdxl)\s*[:：\-–—]\s*",
            "",
            out,
            flags=re.I,
        )
    out = out.lstrip(":-–— ").strip()
    out = out.strip().strip('"').strip("'").strip()
    out = re.sub(r"\s+", " ", out)
    # Anima 的 caption 必须是英文；原样模式下不再丢弃中文 caption，
    # 也不截句、不数字数，4B 写多少就返回多少。
    if RAW_PROMPT:
        return out
    if re.search(r"[\u4e00-\u9fff]", out):
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", out)
    kept = []
    words = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(kept) >= 4:
            break
        count = len(sentence.split())
        if kept and (words + count > 100 or len(kept) >= 3):
            break
        kept.append(sentence)
        words += count
    result = " ".join(kept).strip()
    if result and result[-1] not in ".!?":
        result += "."
    return result[:900]


def _parse_llm_reply(text, arch):
    cleaned = _strip_think(text).strip()
    cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    # 4B 常用 **Caption:** / **Tags:** 包裹；先去掉星号与反引号，
    # 后面的标签行标记和 caption 清洗才认得出来。
    cleaned = cleaned.replace("`", "").replace("*", "")
    cleaned = cleaned.translate({0x2010: "-", 0x2011: "-", 0x2013: "-", 0x2014: "-"})
    if arch == "moss":
        # MOSS 只吃自然语言段落；4B 若多写 Tags 行，直接截掉。
        cut = re.search(r"(?im)^\s*(?:tags?|标签)\s*[:：]", cleaned)
        body = cleaned[:cut.start()] if cut else cleaned
        return _clean_caption(body), []
    if arch not in ("anima", "krea"):
        return "", split_tag_text(cleaned)
    marker = re.search(r"(?im)^\s*(?:tags?|标签)\s*[:：]", cleaned)
    if not marker:
        marker = re.search(r"(?im)\btags?\s*[:：]", cleaned)
    if not marker:
        return _clean_caption(cleaned), []
    caption = _clean_caption(cleaned[:marker.start()])
    tag_text = cleaned[marker.end():].strip()
    # 标签区只取前 4 行，避免模型多写的解释混进标签。
    tag_text = "\n".join(tag_text.splitlines()[:4])
    return caption, split_tag_text(tag_text)


def _reconcile_people(tags, idea):
    """按中文原意校正人数与性别，避免 4B 把男女场景写成 solo。"""
    low = str(idea or "")
    female = bool(re.search(r"女性|女人|女士|女子|女孩|女伴|woman|women|girl|lady|female", low, re.I))
    male = bool(re.search(r"男性|男人|男士|男子|男孩|男伴|man\b|men\b|boy\b|male", low, re.I))
    if not female and not male:
        return tags
    out = [tag for tag in tags if tag not in ("solo", "solo focus")]
    two_female = bool(re.search(
        r"(?:两位|两个|两名|2\s*位|two\s+(?:women|girls))[^，。]{0,10}(?:女|woman|girl|female)",
        low, re.I,
    ))
    two_male = bool(re.search(
        r"(?:两位|两个|两名|2\s*位|two\s+(?:men|boys))[^，。]{0,10}(?:男|man|boy|male)",
        low, re.I,
    ))
    pair = bool(re.search(
        r"(?:女性|女人|女士|女子|女孩)[^，。]{0,12}(?:和|与|跟|及|、)[^，。]{0,12}(?:男性|男人|男士|男子|男孩)"
        r"|(?:男性|男人|男士|男子|男孩)[^，。]{0,12}(?:和|与|跟|及|、)[^，。]{0,12}(?:女性|女人|女士|女子|女孩)",
        low, re.I,
    ))
    if two_female and not male:
        out = [tag for tag in out if not PERSON_TAG_RE.match(tag) and tag != "multiple girls"]
        return ["2girls", "multiple girls"] + out
    if two_male and not female:
        out = [tag for tag in out if not PERSON_TAG_RE.match(tag) and tag != "multiple boys"]
        return ["2boys", "multiple boys"] + out
    if pair or (female and male and re.search(r"[和与跟]", low)):
        out = [tag for tag in out if not PERSON_TAG_RE.match(tag)
               and tag not in ("multiple girls", "multiple boys")]
        return ["1girl", "1boy"] + out
    if female and not male and not any(PERSON_TAG_RE.match(tag) for tag in out):
        return ["1girl"] + out
    if male and not female and not any(PERSON_TAG_RE.match(tag) for tag in out):
        return ["1boy"] + out
    return out


EXPLICIT_HINTS = (
    ("做爱", "sex"), ("做爱", "nude"), ("性交", "sex"), ("性交", "nude"),
    ("性爱", "sex"), ("性爱", "nude"),
    ("口交", "fellatio"), ("乳交", "paizuri"), ("舔阴", "cunnilingus"),
    ("后入", "doggy style"), ("骑乘", "girl on top"), ("骑在", "girl on top"),
    ("女上位", "girl on top"), ("男上位", "missionary"), ("传教士", "missionary"),
    ("指交", "fingering"), ("足交", "footjob"),
    ("自慰", "masturbation"), ("潮吹", "squirting"), ("内射", "creampie"),
    ("射精", "cum"), ("颜射", "facial"), ("肛交", "anal"),
    ("全裸", "completely nude"), ("裸体", "nude"), ("一丝不挂", "completely nude"),
    ("捆绑", "bondage"), ("汗水", "sweat"), ("出汗", "sweat"),
    ("阴茎", "penis"), ("乳房", "breasts"), ("乳头", "nipples"), ("臀部", "ass"),
    ("blowjob", "fellatio"), ("handjob", "handjob"), ("paizuri", "paizuri"),
    ("creampie", "creampie"), ("doggy style", "doggy style"), ("missionary", "missionary"),
    ("cowgirl", "girl on top"), ("girl on top", "girl on top"),
    ("reverse cowgirl", "reverse cowgirl"), ("cunnilingus", "cunnilingus"),
    ("fingering", "fingering"), ("footjob", "footjob"), ("bondage", "bondage"),
    ("masturbation", "masturbation"), ("facial", "facial"), ("squirting", "squirting"),
)

# 4B 仍会把性行为写成委婉语；caption 是 Anima 的主提示词，必须去委婉。
EUPHEMISM_REWRITES = (
    (re.compile(r"\bmaking love\b", re.I), "having sex"),
    (re.compile(r"\bmade love\b", re.I), "had sex"),
    (re.compile(r"\bmake love\b", re.I), "have sex"),
    (re.compile(r"\ban intimate moment\b", re.I), "a sex scene"),
    (re.compile(r"\ban intimate scene\b", re.I), "a sex scene"),
    (re.compile(r"\bintimate moment\b", re.I), "sex scene"),
    (re.compile(r"\bintimate scene\b", re.I), "sex scene"),
    (re.compile(r"\bthe intimacy of the moment\b", re.I), "the sex act"),
    (re.compile(r"\bintimacy of the moment\b", re.I), "sex act"),
    (re.compile(r"\bintimate act\b", re.I), "sex act"),
    (re.compile(r"\bintimate pose\b", re.I), "sex position"),
    (re.compile(r"\bintimate passion\b", re.I), "sexual passion"),
    (re.compile(r"\bintimate kiss\b", re.I), "kiss"),
    (re.compile(r"\bunclothed\b", re.I), "nude"),
    # 4B 对“写实厚涂/中景”的直译，Anima 读不懂。
    (re.compile(r"\breal[- ]?thick painting\b", re.I), "impasto painting"),
    (re.compile(r"\bthick[- ]?painted\b", re.I), "impasto"),
    (re.compile(r"\bthick[- ]?paint\b", re.I), "impasto"),
    (re.compile(r"\bmid[- ]scene\b", re.I), "medium shot"),
)


def de_euphemize(text):
    for pattern, replacement in EUPHEMISM_REWRITES:
        text = pattern.sub(replacement, text)
    return text


def strip_sex_caption(caption):
    """原文没有性/裸体线索时，删掉 4B 自补的性行为句子，而不是整条丢弃。"""
    text = str(caption or "").strip()
    if not text:
        return text
    kept = [
        sentence for sentence in re.split(r"(?<=[.!?])\s+", text)
        if not SEX_CAPTION_RE.search(sentence)
    ]
    return " ".join(part.strip() for part in kept if part.strip()).strip()


def strip_model_caption(caption, idea=""):
    """删掉 4B 把底模名/质量档写成画风的句子（...snapshot of Anima in ...）。"""
    text = str(caption or "").strip()
    if not text:
        return text
    idea_low = str(idea or "").lower()
    # “小马/pony”本身可能是画面主体，不能当成 Pony 底模名删掉。
    keep_pony = bool(re.search(r"小马|马驹|\bpony\b|\bmlp\b", idea_low, re.I))
    kept = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        match = MODEL_CAPTION_RE.search(sentence)
        if match and not (keep_pony and match.group(0).lower() == "pony"):
            continue
        kept.append(sentence)
    return " ".join(part.strip() for part in kept if part.strip()).strip()


def _explicit_hints(idea):
    low = str(idea or "").lower()
    hits = []
    for word, tag in EXPLICIT_HINTS:
        if word in low and tag not in hits:
            hits.append(tag)
    if re.search(r"\b(?:sex|anal|oral|vaginal|penetration)\b", low) and "sex" not in hits:
        hits.append("sex")
    if re.search(r"\bnude\b|\bnaked\b|\btopless\b|\bbottomless\b", low) and "nude" not in hits:
        hits.append("nude")
    return hits


# 只在成人档生效：4B 爱写“sexual / intimate / romance”这类非 Danbooru 氛围词，
# 既占标签位又不表达动作，清掉后把原文里的动作/裸体标签补到前排。
ANIMA_ADULT_WEAK_TAGS = frozenset({
    "sexual", "intimate", "intimacy", "romance", "romantic", "love",
    "sensual", "passion", "passionate", "desire", "body contact", "texture",
    "sensual pose", "intimate pose", "sexual pose", "couple pose",
})
ANIMA_ADULT_WEAK_PREFIX_RE = re.compile(r"^(?:intimate|sexual|romantic|romance|love)\b")
ANIMA_PERSON_LEAD_RE = re.compile(
    r"^(?:1girl|1boy|2girls|2boys|multiple girls|multiple boys|solo|solo focus)$"
)
# 动作标签只能由原文触发；模型自行补的口交/射精等一律删掉。
ANIMA_ACT_HINTS = {
    "sex": ("做爱", "性交", "性爱", "sex"),
    "fellatio": ("口交", "blowjob", "fellatio"),
    "paizuri": ("乳交", "paizuri"),
    "cunnilingus": ("舔阴", "cunnilingus"),
    "fingering": ("指交", "fingering"),
    "footjob": ("足交", "footjob"),
    "girl on top": ("女上位", "骑乘", "骑在", "cowgirl", "girl on top"),
    "reverse cowgirl": ("反向骑乘", "reverse cowgirl"),
    "missionary": ("男上位", "传教士", "missionary"),
    "doggy style": ("后入", "doggy style"),
    "masturbation": ("自慰", "masturbation"),
    "squirting": ("潮吹", "squirting"),
    "creampie": ("内射", "creampie"),
    "cum": ("射精", "cum", "ejaculation"),
    "facial": ("颜射", "facial"),
    "anal": ("肛交", "anal"),
    "bondage": ("捆绑", "bondage"),
    "kiss": ("吻", "kiss"),
}


def _adult_detail_guard(tags, idea):
    forced = _explicit_hints(idea)
    existing = set(tags)
    if "completely nude" in existing:
        forced = [tag for tag in forced if tag != "nude"]
    low = str(idea or "").lower()
    out = []
    for tag in tags:
        if tag in ANIMA_ADULT_WEAK_TAGS or ANIMA_ADULT_WEAK_PREFIX_RE.match(tag):
            continue
        # 模型自行加的动作标签：原文没写就删。
        if tag in ANIMA_ACT_HINTS and not any(word in low for word in ANIMA_ACT_HINTS[tag]):
            continue
        out.append(tag)
    hints = set(_explicit_hints(idea))
    if not ({"nude", "completely nude"} & hints):
        out = [tag for tag in out if tag not in ("nude", "completely nude", "naked", "bare")]
    elif "completely nude" in out:
        out = [tag for tag in out if tag not in ("nude", "naked", "bare")]
    pos = 0
    # 评级标签/人数标签留在最前，动作标签插在它们之后。
    while pos < len(out) and (
        RATING_TAG_RE.fullmatch(out[pos]) or ANIMA_PERSON_LEAD_RE.match(out[pos])
    ):
        pos += 1
    for tag in reversed(forced):
        if tag not in out:
            out.insert(pos, tag)
    if "completely nude" in out:
        out = [tag for tag in out if tag not in ("nude", "naked", "bare")]
    if "girl on top" in out:
        out = [tag for tag in out if tag != "on top"]
    return out[:ANIMA_TAG_MAX]


# 4B 对明确写出的服装/地点/镜头仍会换词（吊带袜→suspenders、椅子→hotel lobby、
# 中景→mid-range）。这里按原文做确定性命中，只补正确的标准标签并删掉错词。
ANIMA_DETAIL_TAG_RULES = (
    (
        re.compile(r"吊带袜|吊带丝袜"),
        ("thighhighs", "garter straps"),
        re.compile(r"^(?:suspenders?|suspendings?|suspender socks|garter belt)$"),
    ),
    (
        re.compile(r"正面中景|正面中景构图"),
        ("front view", "medium shot"),
        re.compile(
            r"^(?:front mid[- ]?(?:range|shot)|frontal mid[- ]?shot|frontal|"
            r"front medium shot|medium[- ]close(?:[- ]up)?|medium close up|"
            r"mid[- ]range|mid range|full[- ]?body|cowboy shot|"
            r"close[- ]?up|closeup)$"
        ),
    ),
    (
        re.compile(r"侧面中景|侧面中景构图"),
        ("side view", "medium shot"),
        re.compile(
            r"^(?:side mid[- ]?(?:range|shot)|side midshot|side medium(?: shot)?|"
            r"side-mid|mid[- ]range|mid range|full[- ]?body|cowboy shot|"
            r"close[- ]?up|closeup)$"
        ),
    ),
)


def _fix_role_swap_caption(caption, idea):
    """4B 会把“男人扶着她的腰”写成 her hands supporting his waist；按原文换回。"""
    text = str(idea or "")
    cap = str(caption or "")
    male_holds_female = re.search(
        r"(?:男人|男方|他)[^，。]{0,8}(?:双手|手|胳膊)[^，。]{0,8}(?:扶|搂|抱|揽)"
        r"[^，。]{0,6}(?:她|女方|女人)的腰",
        text,
    )
    female_holds_male = re.search(
        r"(?:女人|女方|她)[^，。]{0,8}(?:双手|手|胳膊)[^，。]{0,8}(?:扶|搂|抱|揽)"
        r"[^，。]{0,6}(?:他|男方|男人)的腰",
        text,
    )

    def verb_fix(value):
        return re.sub(r"\b(?:supporting|support|gripping|grip)\b", "holding", value)

    def sentence_case(value, start):
        if start == 0 or re.search(r"[.!?]\s*$", cap[:start]):
            return value[:1].upper() + value[1:]
        return value

    if male_holds_female:
        cap = re.sub(
            r"\bher hands?\b([^.]{0,50}?)\b(?:his|him) (?:waist|hips)\b",
            lambda m: sentence_case(
                "his hands" + verb_fix(m.group(1)) + "her waist", m.start()
            ),
            cap,
            flags=re.I,
        )
        cap = re.sub(
            r"\bshe (?:supports?|grips?|holds?) (?:his|him) (?:waist|hips)\b",
            "he holds her waist",
            cap,
            flags=re.I,
        )
    elif female_holds_male:
        cap = re.sub(
            r"\bhis hands?\b([^.]{0,50}?)\bher (?:waist|hips)\b",
            lambda m: sentence_case(
                "her hands" + verb_fix(m.group(1)) + "his waist", m.start()
            ),
            cap,
            flags=re.I,
        )
        cap = re.sub(
            r"\bhe (?:supports?|grips?|holds?) her (?:waist|hips)\b",
            "she holds his waist",
            cap,
            flags=re.I,
        )
    return re.sub(r"\s+", " ", cap).strip()


def _apply_anima_detail_rules(tags, idea, caption):
    text = str(idea or "")
    out = list(tags)
    cap = str(caption or "")
    # 4B 对“写实厚涂/中景”的直译，Anima 读不懂。
    cap = re.sub(r"\brealistic thick[- ]?painting\b", "impasto painting", cap, flags=re.I)
    cap = re.sub(r"\brealistic thick[- ]?paint\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\breal[- ]?thick(?:[- ]?painting)?\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\bthick[- ]?painted\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\bthick[- ]?paint\b", "impasto", cap, flags=re.I)
    # 只换成 “side view”，否则 “casting a side-mid-range glow” 会被改成病句。
    cap = re.sub(r"\bside[- ]?mid[- ]?range(?:d)?\b", "side view", cap, flags=re.I)
    cap = re.sub(r"\bside[- ]?midshot\b", "side view", cap, flags=re.I)
    cap = re.sub(
        r"\bside[- ]?mid(?:[- ]?(?:view|distance|shot|angle))?\b",
        "side view",
        cap,
        flags=re.I,
    )
    cap = re.sub(
        r"\bfront[- ]?on medium shot\b|\bfront[- ]?mid[- ]?(?:shot|range)\b|"
        r"\bfront[- ]?cent(?:er|re)(?:ed)?(?: medium shot)?\b",
        "front-lit medium shot",
        cap,
        flags=re.I,
    )
    cap = re.sub(r"\bfront[- ]on\b", "front view", cap, flags=re.I)
    cap = re.sub(r"\bmedium[- ]distance\b", "medium shot", cap, flags=re.I)
    cap = re.sub(r"\bmedium[- ]close(?:[- ]up)?\b", "medium shot", cap, flags=re.I)
    cap = re.sub(r"\bmid[- ]range\b", "medium shot", cap, flags=re.I)
    cap = re.sub(r"\bmiddle shot\b", "medium shot", cap, flags=re.I)
    cap = re.sub(r"\brealistic thick[- ]?brush(?:ed)?\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\bthick[- ]?brush(?:ed)?\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\brealistic thick[- ]?coat\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\bthick[- ]?coat\b", "impasto", cap, flags=re.I)
    cap = re.sub(r"\ba impasto\b", "an impasto", cap, flags=re.I)
    cap = re.sub(r"\bon top on\b", "on top of", cap, flags=re.I)
    cap = re.sub(r"\bas they sex\b", "as they have sex", cap, flags=re.I)
    cap = re.sub(r"\bsensual moment\b", "sex act", cap, flags=re.I)
    cap = re.sub(r"\bintimate and raw\b", "sexual and raw", cap, flags=re.I)
    # 4B 偶尔写成 “medium shot shot / medium shot, medium shot”，去重。
    cap = re.sub(
        r"\b(medium|full|close|wide|cowboy)\s+shot\s+shot\b", r"\1 shot", cap, flags=re.I
    )
    cap = re.sub(
        r"\b(medium|full|close|wide|cowboy)\s+shot\s*,\s*\1\s+shot\b",
        r"\1 shot",
        cap,
        flags=re.I,
    )
    cap = re.sub(r"\b(side|front|rear|back) view view\b", r"\1 view", cap, flags=re.I)
    # 原文没写亲吻时，删掉或改写 4B 自补的 kiss。
    if not re.search(r"吻|kiss|亲", text, re.I):
        cap = re.sub(
            r"\s+(?:and\s+)?(?:to\s+)?kiss(?:es|ing)?\s+(?:him|her|the man|the woman)\b",
            "",
            cap,
            flags=re.I,
        )
        if _explicit_hints(text):
            cap = re.sub(r"\ba slow,?\s+kiss\b", "a slow sexual moment", cap, flags=re.I)
            cap = re.sub(r"\bshare\s+(?:a|the)\s+kiss\b", "share a sexual moment", cap, flags=re.I)
            cap = re.sub(r"\bare kissing\b", "are having sex", cap, flags=re.I)
        else:
            cap = re.sub(r"\b(?:a|the)\s+kiss\b", "a quiet moment", cap, flags=re.I)
            cap = re.sub(r"\bare kissing\b", "are close", cap, flags=re.I)
    # 原文写女上位时，4B 仍可能写 “lies on her back”，按原文纠正。
    if re.search(r"女上位|骑乘位?|女上男下", text) and not re.search(
        r"躺|仰卧|平躺|趴|侧卧", text
    ):
        cap = re.sub(
            r"\b(?:lies|lying|lay|is lying)\s+on\s+her\s+back\b",
            "is on top",
            cap,
            flags=re.I,
        )
        # 主语可能是 woman 也可能是 couple，统一改成中性的“在床上做爱”。
        cap = re.sub(
            r"\b(?:lies|lying|lay|is lying)\s+on\s+(?:a|the)\s+(?:[\w-]+\s+){0,2}bed\b",
            "is having sex on the bed",
            cap,
            flags=re.I,
        )
        cap = re.sub(
            r"\b(?:lies|lying|lay|is lying)\s+on\s+(?:a|the)\s+(?:[\w-]+\s+){0,2}sheet\b",
            "is on top on the rumpled sheet",
            cap,
            flags=re.I,
        )
        cap = re.sub(r"\bon top on\b", "on top of", cap, flags=re.I)
        out = [tag for tag in out if tag not in ("lying down", "on back", "lying on back")]
    for pattern, additions, conflicts in ANIMA_DETAIL_TAG_RULES:
        if not pattern.search(text):
            continue
        if conflicts is not None:
            out = [tag for tag in out if not conflicts.match(tag)]
        for tag in additions:
            if tag not in out:
                out.append(tag)
    if "吊带袜" in text or "吊带丝袜" in text:
        cap = re.sub(r"\bsuspender socks?\b", "thighhighs with garter straps", cap, flags=re.I)
        cap = re.sub(r"\bsuspenders?\b", "thighhighs with garter straps", cap, flags=re.I)
        cap = re.sub(r"\bsuspendings?\b", "thighhighs with garter straps", cap, flags=re.I)
        cap = re.sub(r"\bsocks?\b", "thighhighs", cap, flags=re.I)
        # 4B 常把吊带袜再拆出一份 socks / stockings，和 thighhighs 重复。
        out = [tag for tag in out if tag not in ("socks", "sock", "stockings", "pantyhose")]
    if "蕾丝" in text:
        lace = "black lace" if "黑" in text else "lace"
        if "black lace" not in out and "lace" not in out:
            out.append(lace)
        if "黑" in text:
            out = ["black lace lingerie" if tag == "black lingerie" else tag for tag in out]
    if "内衣" in text and "lingerie" not in out:
        out.append("lingerie")
    out = [tag for tag in out if tag not in ("underwear", "black underwear")]
    if "椅子" in text or "座椅" in text:
        if "chair" not in out:
            out.append("chair")
        if not re.search(r"大堂|大厅|lobby|休息区|lounge", text, re.I):
            out = [tag for tag in out if tag not in ("hotel lobby", "lounge")]
            cap = re.sub(r"\bhotel lobby\b", "hotel room", cap, flags=re.I)
    if "落地窗" in text:
        if "floor-to-ceiling window" not in out:
            out.append("floor-to-ceiling window")
        out = [tag for tag in out if tag != "window"]
        if not re.search(r"玻璃|反射|倒影", text):
            out = [tag for tag in out if tag != "glass"]
    if "酒店" in text and "hotel" not in out:
        out.append("hotel")
    if "城市灯光" in text and "city lights" not in out:
        out.append("city lights")
    if "卧室" in text and "bedroom" not in out:
        out.append("bedroom")
    if re.search(r"深夜|夜晚|夜间|黑夜|夜景", text) and "night" not in out:
        out.append("night")
    if re.search(r"床上|床(?!单)", text) and "bed" not in out and "bedroom" not in out:
        out.append("bed")
    if "台灯" in text and not ({"warm lamp", "bedside lamp", "lamp"} & set(out)):
        out.append("warm lamp")
    if "床头" in text and "bedside lamp" not in out:
        out.append("bedside lamp")
    elif re.search(r"暖灯", text) and not ({"bedside lamp", "warm lamp"} & set(out)):
        out.append("bedside lamp")
    if re.search(r"床单|被单", text):
        if not ({"sheet", "messy sheet", "rumpled sheet"} & set(out)):
            out.append("messy sheet" if re.search(r"凌乱|乱", text) else "sheet")
    if re.search(r"汗", text) and not ({"sweat", "sweaty", "sweating"} & set(out)):
        out.append("sweaty")
    if re.search(r"抬.{0,2}腿|抬腿|一条腿", text) and "one leg up" not in out:
        out.append("one leg up")
    if re.search(r"手指.{0,4}(?:勾|钩|拉|捏)|勾着|钩着", text) and "finger on strap" not in out:
        out.append("finger on strap")
    if re.search(r"直视|盯着镜头|看向镜头|看镜头", text) and "looking at viewer" not in out:
        out.append("looking at viewer")
    # 组合标签已表达时去掉拆开的重复项。
    if "black lace lingerie" in out:
        out = [tag for tag in out if tag not in ("black lace", "lingerie")]
    if "hotel room" in out:
        out = [tag for tag in out if tag != "hotel"]
    cap = _fix_role_swap_caption(cap, text)
    # “at night. he holds...” 句号后的小写主语顺手大写。
    cap = re.sub(r"(?<=[.!?])\s+([a-z])", lambda m: " " + m.group(1).upper(), cap)
    return out[:ANIMA_TAG_MAX], cap


_CN_DIGITS = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
}
_EN_ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
)
_EN_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def _cn_number_to_int(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if text == "十":
        return 10
    if "十" in text:
        left, _, right = text.partition("十")
        tens = _CN_DIGITS.get(left, 1) if left else 1
        ones = _CN_DIGITS.get(right, 0) if right else 0
        return tens * 10 + ones
    if len(text) == 1:
        return _CN_DIGITS.get(text)
    return None


def _int_to_en(n):
    if 0 <= n < 20:
        return _EN_ONES[n]
    if 20 <= n < 100:
        tens, ones = divmod(n, 10)
        return _EN_TENS[tens] + (("-" + _EN_ONES[ones]) if ones else "")
    return str(n)


def _ensure_age_caption(caption, idea):
    """原文写了几岁，就把年龄写进 caption，避免 4B 只写 adult woman。"""
    cap = str(caption or "")
    match = re.search(r"([零一二两三四五六七八九十0-9]{1,3})\s*岁", str(idea or ""))
    if not match:
        return cap
    age = _cn_number_to_int(match.group(1))
    if not age or age < 18 or age > 99:
        return cap
    word = _int_to_en(age)
    if re.search(
        r"\b(?:" + re.escape(word) + r"|" + str(age) + r")[- ]year[- ]old\b", cap, re.I
    ):
        return cap
    cap, count = re.subn(
        r"\b(?:adult\s+)?(woman|man)\b",
        lambda m: "%s-year-old %s" % (word, m.group(1)),
        cap,
        count=1,
        flags=re.I,
    )
    if count:
        if word[:1] in "aeiou":
            cap = re.sub(r"\bA " + re.escape(word) + r"-year-old", "An " + word + "-year-old", cap)
        else:
            cap = re.sub(r"\bAn " + re.escape(word) + r"-year-old", "A " + word + "-year-old", cap)
        return cap
    return "A %s-year-old adult, " % word + cap[0].lower() + cap[1:]


KREA_META_SENTENCE_RE = re.compile(
    r"^(?:"
    r"All details are present\b"
    r"|Every requested detail\b"
    r"|The art style is (?:auto|unspecified)\b"
    r"|The style is auto\b"
    r")",
    re.I,
)
KREA_AGE_BAND_RE = re.compile(
    r"\b(?:in (?:her|his|their) (?:late |early |mid-?)?(?:twenties|thirties|forties|fifties)"
    r"|year[- ]old|[1-9]\d[- ]year[- ]old)\b",
    re.I,
)


def _krea_caption_guard(caption):
    """Krea 2 专用：4B 会把校验清单当正文回显；只写 adult 会让 Krea 画成老年人。"""
    sentences = re.split(r"(?<=[.!?])\s+", str(caption or "").strip())
    sentences = [s for s in sentences if s.strip() and not KREA_META_SENTENCE_RE.match(s.strip())]
    text = " ".join(s.strip() for s in sentences).strip()
    if not text:
        return text
    text = re.sub(r"\bA adult\b", "An adult", text)
    text = re.sub(r"\ba adult\b", "an adult", text)
    if KREA_AGE_BAND_RE.search(text):
        return text
    bands = {"woman": "in her late twenties", "man": "in his early thirties",
             "couple": "in their late twenties"}
    for word in ("couple", "woman", "man"):
        pattern = re.compile(r"\b(?:adult\s+)?" + word + r"\b", re.I)
        if pattern.search(text):
            text = pattern.sub(lambda m, w=word: "%s %s" % (w, bands[w]), text, count=1)
            text = re.sub(r"\bAn (?=(?:woman|man|couple)\b)", "A ", text)
            text = re.sub(r"\ban (?=(?:woman|man|couple)\b)", "a ", text)
            break
    return text


def _ensure_caption_subject(caption, idea):
    """4B 偶尔从身体部位起句，caption 里没有人物；补一个成年主体。"""
    text = str(caption or "").strip()
    if not text:
        return text
    first = re.split(r"(?<=[.!?])\s+", text)[0]
    if ANIMA_PERSON_CAPTION_RE.search(first):
        return text
    low = str(idea or "")
    male = bool(ANIMA_MALE_HINT_RE.search(low))
    female = bool(ANIMA_FEMALE_HINT_RE.search(low))
    if male and not female:
        subject = "An adult man, "
    elif female and not male:
        subject = "An adult woman, "
    else:
        subject = "An adult, "
    return subject + text[0].lower() + text[1:]


def _caption_artist_guard(caption, idea):
    """画师标签不能当人物名：4B 会把 miku master / @rella 写成“谁站在…”。"""
    text = str(caption or "")
    if not text:
        return text
    # 直接去掉 @ 开头的画师标签本身。
    text = re.sub(r"(?<!\w)@[a-z0-9][a-z0-9'\-+().]*", "", text, flags=re.I)
    names = {"miku master"}
    for part in USER_TAG_SPLIT_RE.split(str(idea or "")):
        raw = part.strip()
        if raw.startswith("@") and len(raw) > 1:
            names.add(raw[1:].strip().lower())
    for name in sorted(names, key=len, reverse=True):
        if len(name) < 3:
            continue
        name_re = re.compile(r"\b" + re.escape(name) + r"\b", re.I)
        if not name_re.search(text):
            continue
        if name_re.match(text):
            text = name_re.sub("", text, count=1)
        text = name_re.sub("the adult", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    # 去掉句首 @画师 后可能只剩 "stands in ..."；补回一个主语。
    text = re.sub(
        r"^(stands|sits|lies|walks|gazes|looks|wears|is)\b",
        r"The adult \1",
        text,
        flags=re.I,
    )
    if text:
        text = text[0].upper() + text[1:]
    return text


def _inject_character_name(caption, display_name):
    text = str(caption or "").strip()
    if not text or display_name.lower() in text.lower():
        return text
    replaced = re.sub(
        r"^(?:She|He|The woman|A woman|The girl|A girl|The man|A man|An adult|The adult|The subject)\b",
        display_name,
        text,
        count=1,
        flags=re.I,
    )
    if replaced != text:
        return replaced
    return display_name + ", " + text[0].lower() + text[1:]




def fix_character_caption(caption, idea, notes=None):
    """把 caption 里的角色名归一。"""
    text = str(caption or "")
    if not text:
        return text
    idea_text = str(idea or "")
    text = _caption_artist_guard(text, idea_text)
    for pattern, char_tag, _series in CHARACTER_TAG_RULES:
        if not pattern.search(idea_text):
            continue
        display = CHARACTER_DISPLAY.get(char_tag)
        if not display:
            continue
        name_re, display_name = display
        if name_re.search(text):
            text = name_re.sub(display_name, text)
        else:
            text = _inject_character_name(text, display_name)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def _attribute_color_tag_value(color, kind):
    if kind == "hair":
        # Danbooru 用 blonde hair，不写 gold hair。
        return "blonde hair" if color == "gold" else "%s hair" % color
    return "yellow eyes" if color == "gold" else "%s eyes" % color


def _is_attribute_color_tag(tag, kind):
    low = str(tag or "").lower()
    suffix = " hair" if kind == "hair" else " eyes"
    return low.endswith(suffix) and bool(COLOR_TAG_RE.search(low))


def _explicit_hair_lengths(text):
    found = set()
    if re.search(r"及腰长发|very long hair", text, re.I):
        found.add("very long hair")
    if re.search(r"中长发|medium hair", text, re.I):
        found.add("medium hair")
    if re.search(r"短发|short hair", text, re.I):
        found.add("short hair")
    if (
        re.search(r"长发|long hair", text, re.I)
        and not re.search(r"及腰长发|very long hair|中长发", text, re.I)
    ):
        found.add("long hair")
    return found


def _explicit_hair_styles(text):
    found = set()
    if re.search(r"双马尾|twintails?|twin[- ]?tails?|twin[- ]?ponytails?", text, re.I):
        found.add("twintails")
    if re.search(r"(?<!双)马尾|(?<!twin )(?<!twin-)ponytail", text, re.I):
        found.add("ponytail")
    if re.search(r"丸子头|发髻|hair bun", text, re.I):
        found.add("hair bun")
    if re.search(r"麻花辫|编发|braid", text, re.I):
        found.add("braid")
    return found


GARMENT_GROUPS = {
    "leather jacket": "outerwear",
    "trench coat": "outerwear",
    "jeans": "bottom",
    "skirt": "bottom",
    "dress": "dress",
    "white shirt": "top",
    "black shirt": "top",
    "sweater": "knit",
    "hoodie": "knit",
    "uniform": "uniform",
    "high heels": "shoes",
}


def _matched_idea_garments(text):
    """每种服装只取一条；同一类（外套/上衣）写了多件时不去猜，交回 4B。"""
    by_group = {}
    for pattern, canonical, conflict in IDEA_GARMENT_RULES:
        if not pattern.search(str(text or "")):
            continue
        group = GARMENT_GROUPS.get(canonical, canonical)
        by_group.setdefault(group, []).append((pattern, canonical, conflict))
    matched = []
    for items in by_group.values():
        if len(items) == 1:
            matched.append(items[0])
    return matched


def _idea_garment_color(text, pattern):
    match = re.search(
        r"(?P<color>black|white|red|blue|green|yellow|pink|purple|brown|grey|gray|"
        r"silver|gold|golden|orange|aqua|cyan|黑|白|红|蓝|绿|黄|粉|紫|棕|褐|灰|银|金|橙|青)"
        r"(?:色)?(?:的)?\s*(?:" + pattern.pattern + r")",
        str(text or ""),
        re.I,
    )
    return _color_key(match.group("color")) if match else ""


def fix_idea_garments_caption(caption, idea):
    """用户点名的服装被 4B 换款时，按原文改回标准英文。"""
    text = str(caption or "")
    # 用户亲手写的英文标签（如 oversized shirt）必须原样保留，
    # 不能被“白衬衫”规则改写或吞掉。
    protected = []
    for part in USER_TAG_SPLIT_RE.split(str(idea or "")):
        part = part.strip()
        if part and len(part.split()) <= 5 and not re.search(r"[\u4e00-\u9fff]", part):
            protected.append(part)
    placeholders = {}
    for index, phrase in enumerate(sorted(set(protected), key=len, reverse=True)):
        placeholder = "\u0001%d\u0001" % index
        placeholders[placeholder] = phrase
        text = re.sub(re.escape(phrase), placeholder, text, flags=re.I)
    for index, (_pattern, canonical, conflict) in enumerate(_matched_idea_garments(idea)):
        # “white t-shirt” 本身就是白衬衫的合理写法，不能再套一次 white shirt。
        if canonical.endswith("shirt"):
            color = canonical.split()[0]
            if re.search(
                r"\b%s\b[^.!?]{0,16}(?:t[- ]?shirt|shirt|blouse|tee)\b" % color,
                text,
                re.I,
            ):
                continue
        placeholder = "\u0000%d\u0000" % index
        text = re.sub(re.escape(canonical), placeholder, text, flags=re.I)
        text = conflict.sub(canonical, text)
        text = text.replace(placeholder, canonical)
    for placeholder, phrase in placeholders.items():
        text = text.replace(placeholder, phrase)
    return text


def apply_idea_garments(tags, idea, notes=None):
    """把用户点名的服装钉死为原文款式，清掉 4B 换成的同类服装。"""
    matched = _matched_idea_garments(idea)
    if not matched:
        return tags
    text = str(idea or "")
    tags = [str(tag) for tag in tags]
    canonicals = {canonical for _pattern, canonical, _conflict in matched}
    kept = []
    removed = []
    for tag in tags:
        low = tag.lower()
        if any(canonical in low for canonical in canonicals):
            kept.append(tag)
            continue
        # 用户亲手写的英文标签（oversized shirt）不是 4B 的换款，保留。
        if low in text.lower():
            kept.append(tag)
            continue
        if any(conflict.search(tag) for _pattern, _canonical, conflict in matched):
            removed.append(tag)
            continue
        kept.append(tag)
    additions = []
    for pattern, canonical, _conflict in matched:
        color = _idea_garment_color(text, pattern)
        if color and _color_key(canonical.split()[0]) == color:
            color = ""
        current = [tag for tag in kept if canonical in tag.lower()]
        if current:
            # 4B 写了 leather jacket 但丢了原文的黑色；升级成 black leather jacket。
            if color and not any(color in tag.lower() for tag in current):
                kept = [tag for tag in kept if tag not in current]
                addition = "%s %s" % (color, canonical)
                if addition not in kept and addition not in additions:
                    additions.append(addition)
            continue
        addition = ("%s %s" % (color, canonical)) if color else canonical
        if addition not in kept and addition not in additions:
            additions.append(addition)
    if additions:
        insert_at = 0
        for index, tag in enumerate(kept):
            if PERSON_TAG_RE.match(tag) or tag in ("solo", "mature female", "mature male"):
                insert_at = index + 1
        for value in reversed(additions):
            kept.insert(insert_at, value)
    if notes is not None and (additions or removed):
        parts = []
        if additions:
            parts.append("补 " + "、".join(additions))
        if removed:
            parts.append("清理换款 " + "、".join(dict.fromkeys(removed)))
        note = "按原文校正服装：" + "；".join(parts)
        if note not in notes:
            notes.append(note)
    return kept


# 原文明确写“白底/纯色背景/影棚”时，4B 仍会补城市夜景、街道、房间等外景标签。
PLAIN_BACKGROUND_IDEA_RE = re.compile(
    r"白底|白色背景|纯白背景|纯色背景|无背景|影棚|棚拍|"
    r"white background|plain background|solid background|studio backdrop|studio background",
    re.I,
)
BACKGROUND_CONFLICT_HINTS = {
    "city": ("城市", "都市", "city"),
    "city night": ("城市", "都市", "city"),
    "city lights": ("城市", "都市", "city"),
    "street": ("街", "street"),
    "night": ("夜", "night"),
    "night sky": ("夜空", "night sky"),
    "outdoors": ("户外", "室外", "outdoor"),
    "outdoor": ("户外", "室外", "outdoor"),
    "forest": ("森林", "forest"),
    "beach": ("海滩", "沙滩", "beach"),
    "ocean": ("海洋", "海边", "ocean", "sea"),
    "sky": ("天空", "sky"),
    "clouds": ("云", "cloud"),
    "room": ("房间", "室内", "room"),
    "bedroom": ("卧室", "bedroom"),
    "indoors": ("室内", "indoor"),
    "indoor": ("室内", "indoor"),
}


# 无人风景里 4B 会补 city night/street；原文没提城市就不该出现。
CITY_TAG_RE = re.compile(
    r"\b(?:city|urban|street|downtown|metropolis|skyline|cityscape)\b", re.I
)
CITY_IDEA_RE = re.compile(
    r"城市|都市|街道|街头|市区|高楼|天际线|city|urban|street|downtown|skyline", re.I
)
# 原文写明清晨/白天时，夜景标签属于自相矛盾；只有原文也写夜才保留。
MORNING_IDEA_RE = re.compile(
    r"清晨|早晨|早上|日出|黎明|白天|正午|中午|morning|sunrise|dawn|daylight|noon", re.I
)
NIGHT_IDEA_RE = re.compile(r"夜晚|夜里|夜间|深夜|午夜|晚上|夜|night|midnight|evening", re.I)
NIGHT_TAG_RE = re.compile(r"\b(?:night|midnight|nighttime)\b", re.I)


def apply_idea_background(tags, idea, notes=None, allow_person=True):
    """白底/影棚、无人风景与清晨输入不许 4B 换成城市夜景或夜间背景。"""
    idea_text = str(idea or "")
    if not idea_text:
        return tags
    idea_low = idea_text.lower()
    plain = bool(PLAIN_BACKGROUND_IDEA_RE.search(idea_text))
    morning = bool(MORNING_IDEA_RE.search(idea_text)) and not NIGHT_IDEA_RE.search(idea_text)
    no_city = not CITY_IDEA_RE.search(idea_text)
    if not (plain or morning or (not allow_person and no_city)):
        return tags
    kept = []
    removed = []
    for tag in tags:
        low = tag.lower()
        if plain:
            hints = BACKGROUND_CONFLICT_HINTS.get(low)
            if hints and not any(hint in idea_low for hint in hints):
                removed.append(tag)
                continue
        if morning and NIGHT_TAG_RE.search(low):
            removed.append(tag)
            continue
        if not allow_person and no_city and CITY_TAG_RE.search(low):
            removed.append(tag)
            continue
        kept.append(tag)
    if notes is not None and removed:
        note = "按原文清理背景冲突：%s" % "、".join(dict.fromkeys(removed))
        if note not in notes:
            notes.append(note)
    return kept


def apply_idea_attributes(tags, idea, notes=None):
    """把用户明确写的发色/瞳色/发长/发型确定性写进标签，避免 4B 漏掉或写反。"""
    text = str(idea or "")
    if not text:
        return tags
    tags = [str(tag) for tag in tags]
    additions = []
    changed_parts = []
    for kind, label in (("hair", "发色"), ("eyes", "瞳色")):
        colors = _idea_attribute_colors(text, kind)
        if not colors:
            continue
        wanted = [_attribute_color_tag_value(color, kind) for color in sorted(colors)]
        keep = {tag.lower() for tag in wanted}
        kept = [
            tag for tag in tags
            if not _is_attribute_color_tag(tag, kind) or tag.lower() in keep
        ]
        if len(kept) != len(tags):
            changed_parts.append("清理冲突%s" % label)
            tags = kept
        existing_low = {item.lower() for item in tags}
        for tag in wanted:
            if tag.lower() not in existing_low and tag not in additions:
                additions.append(tag)
    # 用户只写了一种发长/发型时钉死；同时写了两种则保留矛盾，不替用户裁决。
    lengths = _explicit_hair_lengths(text)
    if len(lengths) == 1:
        hair_length = next(iter(lengths))
        pool = {"very long hair", "long hair", "medium hair", "short hair"}
        kept = [tag for tag in tags if tag not in pool or tag == hair_length]
        if len(kept) != len(tags):
            changed_parts.append("清理冲突发长")
            tags = kept
        if hair_length not in tags and hair_length not in additions:
            additions.append(hair_length)
    elif lengths:
        for hair_length in sorted(lengths):
            if hair_length not in tags and hair_length not in additions:
                additions.append(hair_length)
    styles = _explicit_hair_styles(text)
    if len(styles) == 1:
        hair_style = next(iter(styles))
        pool = {"twintails", "ponytail", "hair bun", "braid"}
        kept = [tag for tag in tags if tag not in pool or tag == hair_style]
        if len(kept) != len(tags):
            changed_parts.append("清理冲突发型")
            tags = kept
        if hair_style not in tags and hair_style not in additions:
            additions.append(hair_style)
    elif styles:
        for hair_style in sorted(styles):
            if hair_style not in tags and hair_style not in additions:
                additions.append(hair_style)
    if additions:
        insert_at = 0
        for index, tag in enumerate(tags):
            if PERSON_TAG_RE.match(tag) or tag in ("solo", "mature female", "mature male"):
                insert_at = index + 1
        for value in reversed(additions):
            if value not in tags:
                tags.insert(insert_at, value)
    if notes is not None and (additions or changed_parts):
        parts = []
        if additions:
            parts.append("补 " + "、".join(additions))
        if changed_parts:
            parts.append("、".join(dict.fromkeys(changed_parts)))
        note = "按原文校正外观：" + "；".join(parts)
        if note not in notes:
            notes.append(note)
    return tags


def apply_character_tags(tags, idea, notes=None):
    """用确定性映射修正 4B 的角色标签拼写。"""
    idea_text = str(idea or "")
    additions = []
    for pattern, char_tag, series_tag in CHARACTER_TAG_RULES:
        if not pattern.search(idea_text):
            continue
        fuzz = CHARACTER_TAG_FUZZ.get(char_tag)
        if fuzz:
            # 先清掉 hatune miku / genryu shougun 这类近音错拼。
            tags = [tag for tag in tags if not fuzz.search(tag)]
        additions.extend([char_tag, series_tag])
        # 去掉 series 的裸词碎片（如 genshin impact 旁的 genshin）。
        tags = [tag for tag in tags if tag not in series_tag.split()]
        # 用户没写发色/瞳色/发型时，补官方设定的可见特征：
        # Anima 的 caption 权重很高，只给角色名容易退回通用脸。
        # 只锁对应部位：用户写了发色仍可补瞳色，反之亦然。
        user_hair_color = bool(_idea_attribute_colors(idea_text, "hair"))
        user_eye_color = bool(_idea_attribute_colors(idea_text, "eyes"))
        user_twintails = bool(
            re.search(
                r"双马尾|twintails?|twin[- ]?tails?|twin[- ]?ponytails?",
                idea_text,
                re.I,
            )
        )
        user_other_hair = bool(
            re.search(
                r"马尾|丸子头|发髻|发型|编发|长发|短发|ponytail|buns?|braid"
                r"|long hair|short hair|hair style",
                idea_text,
                re.I,
            )
        ) and not user_twintails
        for value in CHARACTER_APPEARANCE.get(char_tag, ()):
            if value in tags or value in additions:
                continue
            if "hair" in value and user_hair_color:
                continue
            if "eyes" in value and user_eye_color:
                continue
            if value == "twintails" and user_other_hair:
                continue
            if value in ("braid", "hair bun") and (user_twintails or user_other_hair):
                continue
            additions.append(value)

    if not additions:
        return tags
    insert_at = 0
    for index, tag in enumerate(tags):
        if PERSON_TAG_RE.match(tag) or tag in ("solo", "mature female", "mature male"):
            insert_at = index + 1
    for value in reversed(additions):
        if value and value not in tags:
            tags.insert(insert_at, value)
    if notes is not None:
        added = [value for value in additions if value in tags]
        appearance = [
            value for value in added if value in sum(CHARACTER_APPEARANCE.values(), ())
        ]
        if appearance:
            message = "已按官方设定补角色外观：%s" % "、".join(appearance)
            if message not in notes:
                notes.append(message)
    return tags


FRAMING_IDEA_RULES = (
    (re.compile(r"七分身|七分像"), "cowboy shot"),
    (re.compile(r"半身|上半身"), "upper body"),
    (re.compile(r"全身|全身像"), "full body"),
    (re.compile(r"特写|近景"), "close-up"),
    (re.compile(r"大头照"), "portrait"),
)
FRAMING_TAGS = frozenset(tag for _pattern, tag in FRAMING_IDEA_RULES)
# 机位/视角标签只在原文明确写了角度时保留；4B 默认爱补 low angle / side view。
CAMERA_ANGLE_TAGS = frozenset({
    "from above", "from below", "from side", "from behind", "front view",
    "side view", "three-quarter view", "three quarter view", "dutch angle",
    "low angle", "high angle", "wide angle", "fisheye", "wide shot",
    "extreme wide shot",
    "center framing", "centered composition", "center composition",
    "symmetrical composition", "looking back",
    "front-facing", "front facing", "front camera", "frontal", "back view", "rear view",
    "over-the-shoulder", "over the shoulder", "birds-eye view",
    "bird's-eye view", "worm's-eye view", "worms-eye view",
})
CAMERA_ANGLE_IDEA_RE = re.compile(
    r"仰视|俯视|低角度|高角度|广角|鱼眼|侧面|侧脸|正面|背影|回头看|镜头|视角|远景|全景"
    r"|from above|from below|low angle|high angle|wide angle|fisheye|wide shot|"
    r"side view|front view|from side|from behind|dutch angle|looking back",
    re.I,
)
FRAMING_CORE = (
    r"(?:full[- ]?body shot|full[- ]?length(?: shot)?|head[- ]?to[- ]?toe|"
    r"cowboy shot|upper[- ]?body shot|mid[- ]?body shot|seven[- ]?part(?: view)?|"
    r"close[- ]?up|portrait)"
)
FRAMING_PHRASE_RE = re.compile(
    # 必须带 shot 或本身就是构图词；裸的 "upper body" 常是身体部位，
    # 直接替换会把 "over her upper body" 改成病句。
    r"\b" + FRAMING_CORE + r"\b",
    re.I,
)
FRAMING_PHRASES = {
    "cowboy shot": "a cowboy shot",
    "upper body": "an upper-body shot",
    "full body": "a full-body shot",
    "close-up": "a close-up",
    "portrait": "a portrait",
}


def _framing_from_idea(idea):
    """中文构图词取最早出现的一个，避免 cowboy shot 与 upper body 同时存在。"""
    matches = []
    for pattern, tag in FRAMING_IDEA_RULES:
        match = pattern.search(str(idea or ""))
        if match:
            matches.append((match.start(), tag))
    if not matches:
        return ""
    return sorted(matches)[0][1]


def resolve_framing_tags(tags, idea, notes=None, allow_person=True):
    chosen = _framing_from_idea(idea)
    if not allow_person:
        # 风景/静物不需要任何人身构图标签。
        return [tag for tag in tags if tag not in FRAMING_TAGS]
    if not chosen:
        # 用户没指定构图时，4B 仍可能同时写 full body + cowboy shot；
        # 保留第一个，避免两种取景互相拉扯。
        present = [tag for tag in tags if tag in FRAMING_TAGS]
        if len(present) <= 1:
            return tags
        chosen = present[0]
    dropped = [tag for tag in tags if tag in FRAMING_TAGS and tag != chosen]
    out = []
    for tag in tags:
        if tag in FRAMING_TAGS and tag != chosen:
            continue
        if tag not in out:
            out.append(tag)
    if chosen not in out:
        insert_at = 0
        for index, tag in enumerate(out):
            if PERSON_TAG_RE.match(tag) or tag in ("solo", "mature female", "mature male"):
                insert_at = index + 1
        out.insert(insert_at, chosen)
    if dropped and notes is not None:
        message = "构图冲突已收敛为 %s（移除 %s）" % (chosen, "、".join(dict.fromkeys(dropped)))
        if message not in notes:
            notes.append(message)
    return out


def reorder_artist_tags(tags):
    """Anima 的 @画师（含权重形式）放在人物/角色/外观之后、普通描述之前，权重更稳。"""
    artists = [tag for tag in tags if split_artist_tag(tag)]
    if not artists:
        return tags
    rest = [tag for tag in tags if not split_artist_tag(tag)]
    identity = set()
    for _pattern, char_tag, series_tag in CHARACTER_TAG_RULES:
        identity.add(char_tag)
        identity.add(series_tag)
        identity.update(CHARACTER_APPEARANCE.get(char_tag, ()))
    insert_at = 0
    for index, tag in enumerate(rest):
        if (
            PERSON_TAG_RE.match(tag)
            or tag in ("solo", "mature female", "mature male")
            or tag in identity
        ):
            insert_at = index + 1
    return rest[:insert_at] + artists + rest[insert_at:]


def fix_framing_caption(caption, idea, chosen=None):
    chosen = chosen or _framing_from_idea(idea)
    text = str(caption or "")
    if not text or not chosen:
        return text
    # 4B 偶尔把 cowboy 拼成 cosswoy/cowboi，取景短语就不会被识别。
    text = re.sub(
        r"\b(?:cosswoy|cossboy|cowbow|cowboi|cowboyy|cowbay|cowbwoy)\b",
        "cowboy",
        text,
        flags=re.I,
    )
    phrase = FRAMING_PHRASES[chosen]
    bare = {
        "cowboy shot": "cowboy shot",
        "upper body": "upper-body shot",
        "full body": "full-body shot",
        "close-up": "close-up",
        "portrait": "portrait",
    }[chosen]
    verb_full = re.compile(
        r"\b(stands?|sits?|lies?|walks?|standing|sitting|lying|walking)\s+"
        r"(?:full[- ]?body|full[- ]?length|head[- ]?to[- ]?toe)\b",
        re.I,
    )
    # caption 里已经有另一种取景短语时，先删掉裸的 full-body，避免出现两个取景。
    if FRAMING_PHRASE_RE.search(text):
        text = verb_full.sub(lambda m: m.group(1), text)
    else:
        text = verb_full.sub(lambda m: "%s in %s" % (m.group(1), phrase), text)

    def replace(match):
        raw = match.group(0)
        normalized = re.sub(r"[- ]+", " ", raw.lower()).strip()
        before = text[max(0, match.start() - 18):match.start()]
        after_article = bool(re.search(
            r"\b(?:a|an|the|her|his|their|my|your|its|this|that)\s+$",
            before,
            re.I,
        ))
        # 逗号/形容词之后（a crisp, upper-body shot）不能再塞冠词。
        after_comma = bool(re.search(r",\s*$", before))
        # 冠词后还有形容词（a crisp, compact upper-body shot）时同样只换名词。
        after_adjective = bool(re.search(
            r"\b(?:a|an|the|her|his|their|my|your|its|this|that)\s+"
            r"[a-z][a-z-]*(?:(?:,\s*|\s+)[a-z][a-z-]*)*\s+$",
            before,
            re.I,
        ))
        # 已经是正确写法就不动，避免 "a crisp upper-body shot" 变成
        # "a crisp an upper-body shot"。
        if chosen == "cowboy shot" and normalized == "cowboy shot":
            return raw
        if chosen == "upper body" and normalized == "upper body shot":
            return bare if (after_article or after_adjective or after_comma) else phrase
        if chosen == "full body" and normalized in (
            "full body shot", "full length", "head to toe"
        ):
            return bare if (after_article or after_adjective or after_comma) else phrase
        if chosen == "close-up" and normalized == "close up":
            return bare if (after_article or after_adjective or after_comma) else phrase
        if chosen == "portrait" and normalized == "portrait":
            return raw
        # 已有冠词/物主代词/形容词时只换名词，避免 "her an upper-body shot"。
        if after_article or after_comma or after_adjective:
            return bare
        replacement = phrase
        if match.start() == 0:
            replacement = replacement[0].upper() + replacement[1:]
        return replacement

    text = FRAMING_PHRASE_RE.sub(replace, text)
    # 4B 会把 upper-body 与 mid-body shot 叠写：upper-body an upper-body shot。
    text = re.sub(
        r"\b(upper|full|mid)[- ]?body\s+(?:(?:a|an|the)\s+)?\1[- ]body shot\b",
        r"\1-body shot",
        text,
        flags=re.I,
    )
    # 连续重复的取景短语与「形容词, 冠词」病句收尾。
    for _ in range(2):
        text = re.sub(
            r"\b((?:a|an|the)\s+)?(full-body shot|upper-body shot|cowboy shot|"
            r"close-up|portrait)\s+(?:a|an|the)\s+\2\b",
            lambda m: (m.group(1) or "") + m.group(2),
            text,
            flags=re.I,
        )
    text = re.sub(
        r",\s+(?:a|an|the)\s+(?=(?:full-body shot|upper-body shot|cowboy shot|close-up|portrait)\b)",
        lambda m: " " if re.search(
            r"\b(?:a|an|the)\s+[a-z][a-z-]*$", m.string[:m.start()], re.I
        ) else ", ",
        text,
        flags=re.I,
    )
    text = re.sub(r"\b(a|an)\s+(a|an)\b", r"\2", text, flags=re.I)
    # 同一句里重复出现取景短语时只保留第一处（含前面的介词/冠词一起删）。
    core = FRAMING_CORE
    sentences = re.split(r"(?<=[.!?])\s+", text)
    rebuilt = []
    for sentence in sentences:
        matches = list(re.finditer(core, sentence, re.I))
        if len(matches) > 1:
            for match in reversed(matches[1:]):
                prefix = re.search(
                    r"(?:\b(?:in|from|with|at|on|into)\s+)?(?:\b(?:a|an|the)\s+)?$",
                    sentence[:match.start()],
                    re.I,
                )
                cut = prefix.start() if prefix else match.start()
                tail = sentence[match.end():].lstrip()
                sentence = sentence[:cut].rstrip(" ,") + (" " + tail if tail else "")
            sentence = re.sub(r"\s{2,}", " ", sentence).strip()
        rebuilt.append(sentence)
    text = " ".join(rebuilt)
    # "framing her full body in a full-body shot" → "framing her in a full-body shot"。
    text = re.sub(
        r"\b(her|his|their)\s+full[- ]?body\s+in\s+(?:a|an|the)\s+full-body shot",
        r"\1 in a full-body shot",
        text,
        flags=re.I,
    )
    # 介词后残留的裸取景短语补冠词：from full-body shot → from a full-body shot。
    text = re.sub(
        r"\b(in|from|with|at)\s+(full-body shot|cowboy shot|portrait)\b",
        r"\1 a \2", text, flags=re.I,
    )
    text = re.sub(
        r"\b(in|from|with|at)\s+(upper-body shot|close-up)\b",
        r"\1 an \2", text, flags=re.I,
    )
    # 冠词与元音开头的取景词/常见形容词对齐：a upper-body shot → an upper-body shot。
    def fix_article(match):
        article = match.group(1)
        replacement = "An" if article[0].isupper() else "an"
        return replacement + " " + match.group(2)
    text = re.sub(
        r"\b(a)\s+((?:upper[- ]?body|eye[- ]level|oversized|editorial|adult|"
        r"aqua|auburn|orange|hourglass|explicit)\b)",
        fix_article,
        text,
        flags=re.I,
    )
    text = re.sub(r"\s+([.,;!?])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def strip_camera_angle_caption(caption, idea):
    """原文没写角度时，caption 里的 low-angle / eye-level 也要删，否则会和标签打架。"""
    text = str(caption or "")
    if not text or CAMERA_ANGLE_IDEA_RE.search(str(idea or "")):
        return text
    text = re.sub(
        r"\bfrom\s+an?\s+(?:low|high|wide|dutch)[- ]angle(?:\s+(?:shot|view))?\b",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\bat\s+eye\s+level\b", "", text, flags=re.I)
    text = re.sub(r"\bfrom\s+(?:an?\s+)?eye\s+level\b", "", text, flags=re.I)
    text = re.sub(r"\bfrom\s+(?:above|below)\b", "", text, flags=re.I)
    # "captured in a wide shot that shows" -> "captured in a shot that shows"。
    text = re.sub(
        r"\bin\s+an?\s+(?:extreme\s+)?wide[- ]shot\b", "in a shot", text, flags=re.I
    )
    text = re.sub(
        r"\b(?:extreme\s+)?wide[- ]shot\s+of\b", "shot of", text, flags=re.I
    )
    text = re.sub(r"\b(?:extreme\s+)?wide[- ]shot\b", "shot", text, flags=re.I)
    # "in a low-angle shot" -> "in a shot"；保留句子结构，避免出现悬空从句。
    text = re.sub(
        r"\b(?:low|high|eye|wide|dutch|side|front|back)[- ](?:angle|level)"
        r"(?=\s+(?:shot|view|angle))",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\b(a|an)\s+(a|an)\b", r"\2", text, flags=re.I)
    # "clean, eye-level shot" 删掉机位后会留下 "clean, shot"。
    text = re.sub(r",\s+(?=(?:shot|view)\b)", " ", text, flags=re.I)
    text = re.sub(r"\s+([,.;!?])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def strip_caption_framing(caption):
    """风景/静物 caption 里的取景词没有对象（full-body shot capturing nature），删掉。"""
    text = str(caption or "")
    if not text:
        return text
    text = re.sub(
        r"\b(?:a|an|the)\s+" + FRAMING_CORE + r"\s*(?:of|capturing|showing)?\s*"
        r"|\b" + FRAMING_CORE + r"\s*(?:of|capturing|showing)?\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\s+([.,;!?])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


TWINTAIL_IDEA_RE = re.compile(
    r"双马尾|双马尾辫|twin[- ]?tails?|twintails?|twin[- ]?ponytails?", re.I
)
BUN_TAG_RE = re.compile(r"(?:double|twin|hair)?[\s-]*buns?", re.I)


def normalize_twintails(tags, idea):
    """原文写了双马尾时，4B 的 double bun（丸子头）要改回 twintails。"""
    idea_text = str(idea or "")
    if not TWINTAIL_IDEA_RE.search(idea_text):
        return tags
    # 用户自己也点名了丸子头/发髻时，bun 是有效需求，不动。
    if re.search(r"丸子头|发髻|\bbuns?\b", idea_text, re.I):
        return tags
    tags = [tag for tag in tags if not BUN_TAG_RE.fullmatch(tag)]
    if "twintails" in tags:
        return tags
    insert_at = 0
    for index, tag in enumerate(tags):
        if PERSON_TAG_RE.match(tag) or tag in ("solo", "mature female", "mature male"):
            insert_at = index + 1
    tags.insert(insert_at, "twintails")
    return tags


def fix_twintail_caption(caption, idea):
    """caption 里的 double bun / double-twin hair 同样归一，避免和 twintails 标签打架。"""
    text = str(caption or "")
    idea_text = str(idea or "")
    if not text or not TWINTAIL_IDEA_RE.search(idea_text):
        return text
    if re.search(r"丸子头|发髻|\bbuns?\b", idea_text, re.I):
        return text
    return re.sub(
        r"\b(?:double|twin)[- ]+(?:twin[- ]+)?"
        r"(?:tails?(?:\s+hair)?|ponytails?(?:\s+hair)?|braids?(?:\s+hair)?|"
        r"bunch(?:es)?(?:\s+hair)?|hair|buns?)\b",
        "twin-tails",
        text,
        flags=re.I,
    )


def upgrade_artist_tags(tags, notes=None):
    """已知画师标签漏写 @ 时补上；已有 @ 版本时删掉裸版本。"""
    out = []
    for tag in tags:
        if tag in KNOWN_ARTIST_TAGS:
            if "@" + tag in tags:
                continue
            value = "@" + tag
            if value not in out:
                out.append(value)
                if notes is not None:
                    message = "画师标签已补 @ 前缀：%s" % value
                    if message not in notes:
                        notes.append(message)
            continue
        if tag not in out:
            out.append(tag)
    return out

# 原样模式：不做语义改写与保真纠偏，但 Anima 的出口仍按官方规范清洗
# （英文 caption + 英文 Danbooru 标签）。需要旧的整套保真清洗时设 KLOCK_PROMPT_RAW=0。
RAW_PROMPT = os.environ.get("KLOCK_PROMPT_RAW", "1").strip().lower() not in (
    "0", "false", "no", "off"
)

ANIMA_CJK_RE = re.compile(
    r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]"
)
ANIMA_MODEL_PREFIX_RE = re.compile(
    r"^\s*(?:miaomiao(?: ?harem)?|silvermoon(?: ?mix)?|anima)\s*[:：\-–—]\s*",
    re.I,
)
# 4B 偶尔把输出标题写成“Tags:”“Prompt:”这类包装词，或把规则里的类别词抄成标签。
ANIMA_TAG_JUNK = frozenset({
    "tag", "tags", "prompt", "caption", "output", "outputs", "description",
    "danbooru", "anime style", "auto", "animate", "anima",
    "model", "checkpoint", "lora",
    "close", "clear", "sharp", "crisp", "vivid", "high detail", "highly detailed",
    "subject", "appearance", "pose", "clothing", "setting", "lighting",
    "location", "expression", "angle", "place",
    "night atmosphere", "night ambiance", "night ambience",
    "night vibe", "night vibes", "night mood",
    "bedroom night", "bedroom scene", "hotel room scene", "detailed portrait",
    "adult rating", "ana", "focused", "clear detail", "city glow", "warm glow",
    "ambient glow", "interior light", "sharp detail",
    "mature female", "mature male", "adult couple",
    "detailed", "focused expression", "detailed clothing", "clear details",
    "soft lighting", "interior room", "warm tones", "auto style", "indoor lighting",
    "bedding", "realism", "room", "time of day", "art style",
})
ANIMA_TAG_MAX = 28
# 4B 实测常写的描述性词 → Anima 能认的标签写法。只处理原样模式，
# 不并入全局 TAG_ALIASES，避免影响 KLOCK_PROMPT_RAW=0 的旧链路。
ANIMA_TAG_ALIASES = {
    "indoor setting": "indoors",
    "indoor": "indoors",
    "interior": "indoors",
    "outdoor setting": "outdoors",
    "urban setting": "city",
    "night light": "night",
    "cinematic glow": "cinematic lighting",
    "cinematic light": "cinematic lighting",
    "glowing sticks": "glowstick",
    "glow sticks": "glowstick",
    "fluorescent sticks": "glowstick",
    "blue twin-tails": "twintails",
    "twin-tails": "twintails",
    "twin tails": "twintails",
    "long tail": "tail",
    "cel-shaded": "cel shading",
    "thick coat": "impasto",
    "thick coat painting": "impasto",
    "thick-coat": "impasto",
    "realistic thick-coat": "impasto",
    "realistic thick coat": "impasto",
    "realistic thick paint": "impasto",
    "realistic thick painting": "impasto",
    "realistic thick-painting": "impasto",
    "thick-painting": "impasto",
    "thick-paint": "impasto",
    "thick paint": "impasto",
    "thick painted": "impasto",
    "realistic thick-paint": "impasto",
    "realistic thick-brush": "impasto",
    "realistic thick-brushed": "impasto",
    "realistic thick brush": "impasto",
    "realistic thick brushwork": "impasto",
    "thick-brush": "impasto",
    "thick-brushed": "impasto",
    "thick brush": "impasto",
    "thick brushwork": "impasto",
    "thick-brushed realism": "impasto",
    "thick brush realism": "impasto",
    "realistic thick-brushed realism": "impasto",
    "middle shot": "medium shot",
    "middle frame": "medium shot",
    "medium close": "medium shot",
    "medium close-up": "medium shot",
    "mid-range": "medium shot",
    "mid-scene": "medium shot",
    "mid-range shot": "medium shot",
    "medium distance": "medium shot",
    "medium-distance view": "medium shot",
    "medium-distance": "medium shot",
    "front on": "front view",
    "front-on": "front view",
    "front-mid shot": "front view",
    "side medium": "side view",
    "side-mid": "side view",
    "side-mid-range": "side view",
    "side mid-range": "side view",
    "side midrange": "side view",
    "side-midrange": "side view",
    "side mid-scene": "side view",
    "side-midshot": "side view",
    "side midshot": "side view",
    "side-mid view": "side view",
    "side mid view": "side view",
    "side-mid distance": "side view",
    "front-center medium shot": "front view",
    "front-centre medium shot": "front view",
    "front mid-body": "front view",
    "thigh high socks": "thighhighs",
    "thigh-high socks": "thighhighs",
    "thigh highs": "thighhighs",
    "staring": "looking at viewer",
    "staring at camera": "looking at viewer",
    "looking at camera": "looking at viewer",
    "night city outside": "city lights",
    "night city light": "city lights",
    "night time bedroom": "bedroom",
    "bedroom setting": "bedroom",
    "bedroom at night": "bedroom",
    "seated": "sitting",
    "finger hooking strap": "finger on strap",
    "finger curling strap": "finger on strap",
    "finger curl": "finger on strap",
    "finger hook": "finger on strap",
    "black lace underwear": "black lace lingerie",
    "lace underwear": "lingerie",
    "floor to ceiling window": "floor-to-ceiling window",
    "city light": "city lights",
    "city night": "city lights",
    "leg up": "one leg up",
    "holding waist": "hands on waist",
    "waist hold": "hands on waist",
    "man holding waist": "hands on waist",
    "man holds waist": "hands on waist",
    "holds waist": "hands on waist",
    "messy bed": "messy sheet",
    "messy bedsheet": "messy sheet",
    "untidy sheet": "messy sheet",
    "messy sheets": "messy sheet",
    "rumpled sheets": "rumpled sheet",
    "holding her waist": "hands on waist",
    "holding his waist": "hands on waist",
    "his hands on her waist": "hands on waist",
    "her hands on his waist": "hands on waist",
    "strap": "shoulder strap",
    "night lamp": "bedside lamp",
    "bedroom interior": "bedroom",
    "hotel chair": "chair",
    "one girl": "1girl",
    "one boy": "1boy",
    "male knight": "knight",
    "female knight": "knight",
    "mature male knight": "knight",
    "mature female knight": "knight",
    "mature female elf": "elf",
    "mature male elf": "elf",
    "female elf": "elf",
    "male elf": "elf",
    "forest elf": "elf",
}
ANIMA_ANIMAL_WORD_RE = re.compile(
    r"猫|狗|鸟|鱼|马|牛|羊|兔子|动物|昆虫|"
    r"\b(?:cat|dog|bird|fish|horse|animal|rabbit|bunny|fox)\b",
    re.I,
)
ANIMA_SCENE_WORD_RE = re.compile(
    r"猫|狗|鸟|鱼|马|动物|雪山|山峰|山峦|湖泊|湖面|大海|海边|海面|海浪|森林|沙漠|草原|星空|银河|"
    r"城市|街道|建筑|夜景|雨夜|雪景|风景|水乡|古镇|石桥|小桥|桥梁|乌篷船|河面|江面|湖水|峡谷|山谷|田野|"
    r"\b(?:cat|dog|bird|fish|horse|animal|mountain|lake|ocean|sea|forest|desert|grassland|"
    r"starry sky|night sky|city|street|architecture|scenery|landscape|still life|"
    r"water town|canal|bridge)\b",
    re.I,
)


def _clean_moss_caption(text):
    """MOSS 吃自然语言长句：清掉 4B 可能补的 Tags 行、markdown 与样板质量词。"""
    out = str(text or "").strip()
    out = re.split(r"(?im)^\s*Tags?\s*:", out)[0].strip()
    out = re.sub(r"(?im)^\s*(?:Caption|Prompt)\s*:\s*", "", out)
    out = re.sub(r"\*\*|__|`{1,3}", "", out)
    out = re.sub(r"(?im)^\s*#+\s*", "", out)
    out = re.sub(
        r"(?i)^\s*(?:masterpiece|best quality|high quality|amazing quality|"
        r"ultra[ -]?detailed|highres|absurdres|8k)\s*[,，]\s*", "", out)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _clean_anima_caption(text):
    """Anima 的 caption 必须是英文：去 Markdown/标题壳，丢掉夹带中文的句子。"""
    out = str(text or "").strip()
    out = out.replace("`", "").replace("*", "")
    out = out.translate({0x2010: "-", 0x2011: "-", 0x2013: "-", 0x2014: "-"})
    out = re.sub(r"^\s*#+\s*", "", out)
    out = re.sub(
        r"^\s*(?:caption|description|prompt|画面描述|描述)\s*[:：]\s*", "", out, flags=re.I
    )
    out = ANIMA_MODEL_PREFIX_RE.sub("", out)
    out = re.sub(r"\s+", " ", out).strip().strip('"').strip("'").strip()
    if ANIMA_CJK_RE.search(out):
        pieces = re.split(r"(?<=[.!?])\s+", out)
        out = " ".join(piece for piece in pieces if piece.strip() and not ANIMA_CJK_RE.search(piece))
    out = re.sub(r"\s+", " ", out).strip()
    if out and out[-1] not in ".!?":
        out += "."
    return out


def _clean_anima_tags(tags, prefix):
    """把 4B 的标签行收成标准英文 Danbooru 形态，返回 (标签, 丢弃数)。"""
    banned = {part.strip().lower() for part in str(prefix or "").split(",") if part.strip()}
    out = []
    dropped = 0
    for tag in tags:
        value = str(tag or "").replace("`", "").replace("*", "")
        # 4B 常用 U+2011 非断行连字符，别名表按 ASCII "-" 写，先归一。
        value = value.translate({0x2010: "-", 0x2011: "-", 0x2013: "-", 0x2014: "-"})
        value = re.sub(r"\s+", " ", value).strip().strip('"').strip("'").strip(".").strip()
        value = re.sub(r"^(?:[-–—•]|\d+[.)、])\s*", "", value)
        if not value:
            continue
        if not re.match(r"(?i)^score_", value):
            value = re.sub(r"_+", " ", value)
        value = re.sub(r"\s+", " ", value).strip().lower()
        value = TAG_ALIASES.get(value, value)
        value = ANIMA_TAG_ALIASES.get(value, value)
        if split_artist_tag(value):
            # 画师标签含权重与转义括号，不能被普通标签的白名单/散文判断误杀。
            if value not in out:
                out.append(value)
            continue
        if re.search(r"\b(?:mood|vibe|vibes|atmosphere|ambiance|ambience)$", value):
            dropped += 1
            continue
        if (
            not value
            or ANIMA_CJK_RE.search(value)
            or len(value) > 80
            or value in ANIMA_TAG_JUNK
            or value in TAG_DENYLIST
            or value in banned
            or RATING_TAG_RE.fullmatch(value)
            or USER_TAG_PROSE_RE.search(value)
        ):
            dropped += 1
            continue
        if value not in out:
            out.append(value)
        if len(out) >= ANIMA_TAG_MAX:
            break
    return out, dropped


ANIMA_PERSON_CAPTION_RE = re.compile(
    r"\b(?:woman|women|man|men|girl|girls|boy|boys|person|people|lady|female|male|couple)\b",
    re.I,
)
# 4B 有时只写 “mature male knight / female elf” 这类描述，漏掉人物计数标签。
# 只在输入明确写了性别、且输出完全没有人物计数标签时补一个，不猜性别。
ANIMA_MALE_HINT_RE = re.compile(
    r"成年男|男性|男人|男生|少年|男孩|男骑士|男角色|"
    r"\b(?:man|men|male|boy|father|king|prince|gentleman)\b",
    re.I,
)
ANIMA_FEMALE_HINT_RE = re.compile(
    r"成年女|女性|女人|女生|少女|女孩|姑娘|女骑士|女角色|"
    r"\b(?:woman|women|female|girl|lady|mother|queen|princess)\b",
    re.I,
)


def _ensure_anima_person_tag(tags, idea):
    text = str(idea or "")
    male = bool(ANIMA_MALE_HINT_RE.search(text))
    female = bool(ANIMA_FEMALE_HINT_RE.search(text))
    if male == female:
        return tags
    want = "1boy" if male else "1girl"
    opposite = "1girl" if male else "1boy"
    # 4B 偶发把成年男性写成 1girl；用户原文明确性别时以原文为准。
    if opposite in tags:
        tags = [tag for tag in tags if tag != opposite]
        if want not in tags:
            tags.insert(0, want)
        return tags
    if any(PERSON_TAG_RE.match(tag) or tag in PERSON_TAGS for tag in tags):
        return tags
    return [want] + tags


def _anima_non_person_guard(tags, caption, prefix, idea):
    """输入明确是动物/风景时，不让人物标签和 fair skin 污染画面。"""
    text = str(idea or "")
    person_hint = bool(PERSON_WORD_RE.search(text)) or any(
        rule.search(text) for rule, _char, _series in CHARACTER_TAG_RULES
    )
    if person_hint:
        return tags, caption, prefix, False
    if not (NON_PERSON_SUBJECT_RE.search(text) or ANIMA_SCENE_WORD_RE.search(text)):
        return tags, caption, prefix, False
    if ANIMA_ANIMAL_WORD_RE.search(text):
        # 动物不是人：只清人物/衣物，保留 tail、paws、pose 这些动物也成立的标签。
        kept = []
        for tag in tags:
            if PERSON_TAG_RE.match(tag) or tag in PERSON_TAGS:
                continue
            if tag in ("mature female", "mature male", "woman", "man", "girl", "boy"):
                continue
            if ANIMA_PERSON_CAPTION_RE.search(tag):
                continue
            if tag in HUMAN_EXPRESSIONS or tag in HUMAN_BODY:
                continue
            if re.search(r"\b(?:hair|eyes?)\b", tag):
                continue
            garment = next(
                (word for word in BASE_GARMENTS if re.search(r"\b%s\b" % word, tag)),
                "",
            )
            if garment and not any(
                hint in text.lower() for hint in GARMENT_IDEA_HINTS.get(garment, ())
            ):
                continue
            kept.append(tag)
    else:
        # 风景/静物复用旧的“无人物清理”词表：人物计数、发色/瞳色、表情、
        # 身体部位、姿势、原文没提的衣物和手持道具一并清掉。
        kept = strip_unwanted_person(tags, idea)
    if ANIMA_PERSON_CAPTION_RE.search(caption):
        # 只丢含人物的句子，保留仍然成立的场景描写。
        pieces = re.split(r"(?<=[.!?])\s+", caption)
        caption = " ".join(
            piece.strip() for piece in pieces
            if piece.strip() and not ANIMA_PERSON_CAPTION_RE.search(piece)
        ).strip()
        if caption and caption[-1] not in ".!?":
            caption += "."
    return kept, caption, prefix.replace("fair skin, ", ""), True


def _merge_preserved_artist_tags(idea, tags):
    """把原文里的 @画师（含权重）按原样补回，清掉模型改写出的同身份变体。"""
    artist_tags = [
        tag for tag in preserve_user_tags(idea, tags) if split_artist_tag(tag)
    ]
    if not artist_tags:
        return tags
    identities = {artist_tag_identity(tag) for tag in artist_tags}
    out = []
    for tag in tags:
        identity = artist_tag_identity(tag)
        if identity:
            if identity in identities:
                continue
        elif str(tag or "").strip().lower().lstrip("@") in identities:
            continue
        out.append(tag)
    return artist_tags + out


def _finish_llm_prompt_raw(caption, tags, idea, model, arch, style, rating):
    # 原样模式：不改写语义、不补料，只做 Anima 的英文出口清洗。
    notes = []
    prefix = quality_prefix(model, style)
    if arch in ("anima", "krea"):
        # 原文里的 @画师（含权重）优先：4B 可能改写或直接丢掉。清洗前塞回最前面，
        # 避免 28 个标签上限把画师截掉；最后再统一按人物/外观之后排序。
        artist_tags = [
            tag for tag in preserve_user_tags(idea, tags) if split_artist_tag(tag)
        ]
        if artist_tags:
            identities = {artist_tag_identity(tag) for tag in artist_tags}
            tags = artist_tags + [
                tag for tag in tags if artist_tag_identity(tag) not in identities
            ]
        cleaned_caption = _clean_anima_caption(caption)
        raw_tags, dropped = _clean_anima_tags(tags, prefix)
        before_tags = len(raw_tags)
        before_caption = cleaned_caption
        raw_tags, cleaned_caption, prefix, no_person = _anima_non_person_guard(
            raw_tags, cleaned_caption, prefix, idea
        )
        raw_tags, cleaned_caption = _apply_anima_detail_rules(
            raw_tags, idea, cleaned_caption
        )
        if not no_person:
            # 发色/瞳色/发长/发型按原文钉死，避免 4B 写反或同时写 long hair + short hair。
            raw_tags = apply_idea_attributes(raw_tags, idea, notes)
            # 已知角色：沿用工作台的角色/系列映射，4B 漏写角色名时兜底。
            raw_tags = apply_character_tags(raw_tags, idea, notes)
            raw_tags = _ensure_anima_person_tag(raw_tags, idea)
        raw_tags = reorder_artist_tags(raw_tags)
        if dropped:
            notes.append("已清理 %d 个非英文/模型名标签" % dropped)
        if no_person and (
            len(raw_tags) < before_tags or cleaned_caption != before_caption
        ):
            notes.append("无人物主体：已移除人物描绘")
        caption = cleaned_caption
    elif arch == "moss":
        # MOSS 吃自然语言段落：不做 Danbooru 清洗，只清掉 4B 可能补的
        # "Tags:" 行、markdown 和样板质量词。
        caption = _clean_moss_caption(caption)
        raw_tags = []
        no_person = False
    else:
        caption = str(caption or "").strip()
        raw_tags = []
        for tag in tags:
            value = re.sub(r"\s+", " ", str(tag)).strip()
            if value:
                raw_tags.append(value)
        # SDXL 出口同样要保住原文的 @画师：4B 常把它写成裸名或直接丢掉。
        raw_tags = _merge_preserved_artist_tags(idea, raw_tags)
    rating = normalize_manual_rating(rating)
    # MOSS 没有 safe/nsfw 标签体系，别把评级标签塞进自然语言段落。
    rating_tag = "" if arch == "moss" else manual_rating_tag(rating, arch)
    if rating_tag:
        raw_tags = [tag for tag in raw_tags if not RATING_TAG_RE.fullmatch(tag)]
        raw_tags.insert(0, rating_tag)
    # 评级只管标签；画面内容按原文保真。选了 nsfw/露骨，或原文本身就写了
    # 成人内容（自动/敏感档）时，去掉 4B 的委婉语并把原文动作补回标签。
    adult = rating in ("nsfw", "explicit") or (
        rating in ("auto", "sensitive") and bool(_explicit_hints(idea))
    )
    if arch in ("anima", "krea", "moss") and adult:
        # 成人档不出现 youth 描述词，统一写回 adult，避免年龄歧义。
        caption = re.sub(r"\bA young couple\b", "An adult couple", caption)
        caption = re.sub(r"\ba young couple\b", "an adult couple", caption)
        caption = re.sub(r"\byoung couple\b", "adult couple", caption, flags=re.I)
        caption = re.sub(r"\byoung woman\b", "adult woman", caption, flags=re.I)
        caption = re.sub(r"\byoung man\b", "adult man", caption, flags=re.I)
        caption = re.sub(r"\bA adult\b", "An adult", caption)
        caption = re.sub(r"\ba adult\b", "an adult", caption)
        # 只有原文真的写了成人内容才做委婉语替换；否则 4B 自补的
        # “sex scene / intimate moment”会把普通内衣场景改成性场景。
        if _explicit_hints(idea):
            caption = de_euphemize(caption)
        else:
            caption = strip_sex_caption(caption)
        raw_tags = _adult_detail_guard(raw_tags, idea)
    if arch in ("anima", "krea") and caption and not no_person:
        caption = _ensure_caption_subject(caption, idea)
        caption = _ensure_age_caption(caption, idea)
    elif arch == "moss" and caption:
        # MOSS 段落只做年龄安全兜底，不强行插主体短语。
        caption = _ensure_age_caption(caption, idea)
    if arch == "krea" and caption:
        caption = _krea_caption_guard(caption)
    if arch in ("anima", "krea", "moss") and caption:
        # Krea 2 / MOSS 只吃自然语言，不追 Tags 行；标签仍返回给工作台做增删。
        body = caption
        if raw_tags and arch == "anima":
            body += "\nTags: " + ", ".join(raw_tags)
        prompt = prefix + body if prefix else body
    else:
        body = ", ".join(raw_tags)
        prompt = prefix + body if prefix else body
    if not prompt.strip():
        raise PromptSafetyError("没能生成有效提示词，请把画面描述得更具体一些")
    return {
        "prompt": prompt,
        "caption": caption if arch in ("anima", "krea", "moss") else "",
        "tags": raw_tags,
        "body": body,
        "prefix": prefix,
        "mode": "caption" if arch in ("anima", "krea", "moss") and caption else "tags",
        "rating": rating if rating != "auto" else "raw",
        "rating_tag": rating_tag,
        "notes": notes,
    }


def _finish_llm_prompt(caption, tags, idea, model, arch, style, rating="auto"):
    if RAW_PROMPT or arch in ("krea", "moss"):
        # Krea 2 / MOSS 走自然语言出口，不套 Anima/SDXL 的标签清洗。
        return _finish_llm_prompt_raw(caption, tags, idea, model, arch, style, rating)

    notes = []
    alias_notes = []
    meta_dropped = []
    merged = []
    for tag in tags:
        raw_tag = re.sub(r"\s+", " ", str(tag).lower()).strip()
        tag = TAG_ALIASES.get(raw_tag, raw_tag)
        # 用户写了双马尾时，4B 的 black double-bunch hair / twin braid 交给
        # apply_idea_attributes 统一补 black hair + twintails，避免残留错发型。
        if TWINTAIL_IDEA_RE.search(str(idea or "")) and re.search(
            r"\b(?:double|twin)[- ]+(?:twin[- ]+)?(?:bunch|braid|ponytail|tail)",
            tag,
            re.I,
        ):
            continue
        if tag in ("cowboy shot", "upper body", "full body", "close-up") and tag != raw_tag:
            alias_notes.append("%s→%s" % (raw_tag, tag))
        if tag in META_TAGS and raw_tag not in QUALITY_TAGS:
            meta_dropped.append(raw_tag)
        if not tag or len(tag) > 80 or tag in QUALITY_TAGS or tag in TAG_DENYLIST or tag in META_TAGS:
            continue
        if re.search(r"[\u4e00-\u9fff]", tag):
            continue
        if re.fullmatch(r"\d+", tag):
            continue
        if re.fullmatch(
            r"(?:(?:a|an|the|one|two|three|four|five|several|\d+)\s+)?(?:adult\s+)?"
            r"(?:woman|women|man|men|female|females|male|males|person|people|girl|girls|boy|boys|lady|ladies)",
            tag,
        ):
            continue
        if tag not in merged:
            merged.append(tag)

    colors = allowed_colors(idea)
    color_fixes = []
    sanitized = []
    for tag in merged:
        cleaned = sanitize_color_tag(tag, colors, idea)
        if cleaned != tag and len(color_fixes) < 4:
            color_fixes.append("%s→%s" % (tag, cleaned or "移除"))
        if cleaned and cleaned not in sanitized:
            sanitized.append(cleaned)
    merged = sanitized
    if color_fixes:
        note = "按原文移除未写颜色：%s" % "、".join(color_fixes)
        if note not in notes:
            notes.append(note)
    caption = de_euphemize(scrub_caption_colors(caption, idea))
    caption = strip_model_caption(caption, idea)
    caption = fix_idea_garments_caption(caption, idea)
    caption = fix_character_caption(caption, idea, notes)
    caption = fix_twintail_caption(caption, idea)
    caption = fix_framing_caption(caption, idea)
    caption = strip_camera_angle_caption(caption, idea)

    # caption 是 Anima 的主提示词：标签已经写了 sex/nude，caption 也必须同调，
    # 否则 4B 容易把它写成“拥抱接吻”的软场景。
    hints = _explicit_hints(idea)
    if not hints and caption:
        caption = strip_sex_caption(caption)
    if cap_text := caption.strip():
        extra_sentences = []
        if ("nude" in hints or "completely nude" in hints) and not re.search(
            r"\b(nude|naked)\b", cap_text, re.I
        ):
            extra_sentences.append("They are completely nude.")
        if "sex" in hints and not re.search(r"\bsex\b", cap_text, re.I):
            extra_sentences.append("They are having sex.")
        if extra_sentences:
            caption = cap_text + " " + " ".join(extra_sentences)

    idea_text = str(idea or "")
    evidence = " ".join(str(tag) for tag in tags) + " " + caption
    model_person = bool(re.search(
        r"\b(?:1girl|1boy|2girls|2boys|multiple girls|multiple boys|solo|"
        r"mature female|mature male|woman|women|man|men|female|male|girl|boy|she|he|her|his)\b",
        evidence,
        re.I,
    ))
    # 人物判断：原文有人物词、点名了内置角色，或者 4B 明确写了人物且原文不是
    # “一只猫/一座山”这类非人物主体。角色名本身即人物线索：4B 这次没写任何人物标签
    # 时也要补 1girl/solo/mature female，避免“初音未来，双马尾，舞台”变成无人场景。
    character_named = any(rule.search(idea_text) for rule, _char, _series in CHARACTER_TAG_RULES)
    allow_person = bool(PERSON_WORD_RE.search(idea_text)) or character_named or (
        model_person and not NON_PERSON_SUBJECT_RE.search(idea_text)
    )
    if not allow_person and NO_PERSON_CAPTION_RE.search(caption):
        caption = ""
    if not allow_person:
        caption = strip_caption_framing(caption)
        merged = strip_unwanted_person(merged, idea)

    merged = normalize_seed_tags(merged, idea)
    merged = _reconcile_people(merged, idea)
    if allow_person and not any(
        PERSON_TAG_RE.match(tag) or tag in ("multiple girls", "multiple boys", "multiple others")
        for tag in merged
    ):
        male_only = bool(re.search(r"\b(?:male|man|men|boy|1boy)\b", evidence, re.I)) and not bool(
            re.search(r"\b(?:female|woman|women|girl|1girl)\b", evidence, re.I)
        )
        merged = (
            ["1boy", "solo", "mature male"] if male_only else ["1girl", "solo", "mature female"]
        ) + merged
    merged = normalize_seed_tags(merged, idea)
    # 混合输入里的英文标签由 4B 转写后常被改写/丢掉；在人物校正之后、角色标签之前
    # 按原文补回，再做一次去重，避免与已生成标签重复。
    for tag in preserve_user_tags(idea, merged):
        identity = artist_tag_identity(tag)
        if identity:
            # 4B 常把 @artist 写成 artist 或改写消歧括号；以用户原文为准，
            # 同一画师的所有变体（含权重）先清掉再加回。
            merged = [item for item in merged if artist_tag_identity(item) != identity]
            if tag not in merged:
                merged.append(tag)
                note = "画师标签已按原文加回 @ 前缀：%s" % tag
                if note not in notes:
                    notes.append(note)
        elif tag not in merged:
            merged.append(tag)
    # 用户明确写的发色/瞳色/发长/发型优先：4B 漏掉时补回，写反时纠正。
    merged = apply_idea_attributes(merged, idea, notes)
    merged = apply_idea_garments(merged, idea, notes)
    merged = apply_idea_background(merged, idea, notes, allow_person=allow_person)
    merged = upgrade_artist_tags(merged, notes)
    # 角色标签最后加，避免被 24 标签上限截掉。
    merged = apply_character_tags(merged, idea, notes)
    merged = normalize_twintails(merged, idea)
    merged = resolve_framing_tags(merged, idea, notes, allow_person=allow_person)
    # 4B 的标签与 caption 可能各说一个取景；标签收敛后让 caption 跟着走。
    if allow_person:
        anchored = [tag for tag in merged if tag in FRAMING_TAGS]
        if len(anchored) == 1:
            caption = fix_framing_caption(caption, idea, chosen=anchored[0])
    merged = reorder_artist_tags(merged)
    # 原文没说角度时，清掉 4B 补的机位/视角标签，避免人物朝向和构图跑偏。
    if not CAMERA_ANGLE_IDEA_RE.search(str(idea or "")):
        merged = [tag for tag in merged if tag not in CAMERA_ANGLE_TAGS]
    for hint in _explicit_hints(idea):
        if hint not in merged:
            merged.append(hint)
    for tag in STYLE_TAGS.get(style, []):
        if tag not in merged:
            merged.append(tag)

    # 清空评级过滤词：默认不判断档位、不注入 safe/sensitive/nsfw/explicit，
    # 4B 自己写的评级标签也一并剔除，只保留 nude/sex/lingerie 这类内容标签。
    merged = [tag for tag in merged if not RATING_TAG_RE.fullmatch(tag)]
    # 只有用户手动选了评级才注入一个；auto 保持 raw。
    rating = normalize_manual_rating(rating)
    rating_tag = manual_rating_tag(rating, arch)
    if rating_tag:
        merged.insert(0, rating_tag)

    # 原文完全没有性/裸体线索时，4B 会把舞台、睡姿、泳装补成性行为
    # （girl on top / sex），画面会彻底跑偏；这里确定性剔除。
    if not hints:
        sex_dropped = [tag for tag in merged if tag in SEX_CONTENT_TAGS]
        if sex_dropped:
            merged = [tag for tag in merged if tag not in SEX_CONTENT_TAGS]
            note = "原文没有性/裸体描述，已剔除模型自补：%s" % "、".join(
                dict.fromkeys(sex_dropped)
            )
            if note not in notes:
                notes.append(note)

    # 裸体与内衣互斥：原文没写内衣/丝袜时，去掉模型自补的内衣标签。
    if any(tag in ("nude", "completely nude", "naked") for tag in merged) and not re.search(
        r"内衣|蕾丝|胸罩|内裤|丝袜|吊袜|lingerie|bra\b|panties|stockings|garter|thighhighs",
        str(idea or ""),
        re.I,
    ):
        merged = [
            tag for tag in merged
            if tag not in (
                "lingerie", "in lingerie", "lace lingerie", "black lingerie", "white lingerie",
                "red lingerie", "underwear", "bra", "panties", "stockings", "thighhighs",
                "garter belt", "pantyshot", "no panties",
            )
        ]

    # 反向同理：原文明确穿着内衣/丝袜、又没写裸体时，去掉模型自补的 nude。
    if re.search(
        r"内衣|蕾丝|胸罩|内裤|丝袜|吊袜|lingerie|bra\b|panties|stockings|garter|thighhighs",
        str(idea or ""),
        re.I,
    ) and not re.search(r"全裸|裸体|一丝不挂|naked|\bnude\b", str(idea or ""), re.I):
        merged = [
            tag for tag in merged
            if tag not in ("nude", "completely nude", "naked", "nude only")
        ]

    girls, boys, _, _ = _person_counts(merged)
    if girls and "mature female" not in merged:
        insert_at = 0
        for index, tag in enumerate(merged):
            if PERSON_TAG_RE.match(tag) or tag == "solo":
                insert_at = index + 1
        merged.insert(insert_at, "mature female")
    if boys and "mature male" not in merged:
        insert_at = 0
        for index, tag in enumerate(merged):
            if PERSON_TAG_RE.match(tag) or tag == "solo":
                insert_at = index + 1
        merged.insert(insert_at, "mature male")

    if not allow_person and not merged and not caption:
        raise PromptSafetyError("没能生成有效提示词，请把画面描述得更具体一些")

    prefix = quality_prefix(model, style)
    if not allow_person:
        prefix = prefix.replace("fair skin, ", "")
    if arch == "anima" and caption:
        body = caption
        if merged:
            body += "\nTags: " + ", ".join(merged)
        prompt = prefix + body if prefix else body
    else:
        body = ", ".join(merged)
        prompt = prefix + body if prefix else body
    if not prompt.strip():
        raise PromptSafetyError("没能生成有效提示词，请把画面描述得更具体一些")
    if alias_notes:
        notes.append("构图词已归一：" + "、".join(dict.fromkeys(alias_notes)))
    if meta_dropped:
        notes.append("已剔除空泛构图/渲染词：" + "、".join(dict.fromkeys(meta_dropped)))
    return {
        "prompt": prompt,
        "caption": caption if arch == "anima" else "",
        "tags": merged,
        "body": body,
        "prefix": prefix,
        "mode": "caption" if arch == "anima" and caption else "tags",
        "rating": rating if rating != "auto" else "raw",
        "rating_tag": rating_tag,
        "notes": notes,
    }


def generate_prompt_llm(idea, model, arch, style, retry=False, rating="auto"):
    rating = normalize_manual_rating(rating)
    key = (str(idea).strip(), str(model or ""), arch, style, rating)
    now = time.time()
    if not retry:
        with PROMPT_CACHE_LOCK:
            entry = PROMPT_CACHE.get(key)
            if entry and now - entry[0] < PROMPT_CACHE_TTL:
                body = dict(entry[1])
                body["cached"] = True
                body["elapsed"] = 0
                return body
    # 先记时间再启动：冷启动期间空闲循环不该把它当"没人用"收走。
    PROMPT_LLM["last_used"] = time.time()
    if not ensure_prompt_llm():
        raise RuntimeError(
            PROMPT_LLM.get("last_error")
            or "提示词模型没有启动成功，请检查 %s" % PROMPT_LLM["err_log"]
        )
    if arch == "krea":
        system = PROMPT_LLM_SYSTEM_KREA
    elif arch == "moss":
        system = PROMPT_LLM_SYSTEM_MOSS
    elif RAW_PROMPT:
        system = PROMPT_LLM_SYSTEM_ANIMA_RAW if arch == "anima" else PROMPT_LLM_SYSTEM_TAGS_RAW
    else:
        system = PROMPT_LLM_SYSTEM_ANIMA if arch == "anima" else PROMPT_LLM_SYSTEM_TAGS_RAW
    if arch in ("anima", "krea", "moss"):
        # 原样模式只约束出口格式，保真清单必须显式给到 4B；
        # 成人档再追加“不委婉、不加戏”的规则。
        system += "\n\n" + (
            PROMPT_LLM_FIDELITY_RULES_KREA if arch == "krea"
            else (PROMPT_LLM_FIDELITY_RULES_MOSS if arch == "moss"
                  else PROMPT_LLM_FIDELITY_RULES)
        )
        adult = rating in ("nsfw", "explicit") or (
            rating in ("auto", "sensitive") and bool(_explicit_hints(idea))
        )
        if adult:
            rules = PROMPT_LLM_ADULT_RULES_MOSS if arch == "moss" else PROMPT_LLM_ADULT_RULES
            system += "\n\n" + rules.format(rating=rating)
    style_line = "auto"
    if style != "auto":
        style_line = "%s (%s)" % (style, ", ".join(STYLE_TAGS.get(style, [])))
    # 不要把底模文件名写进用户消息：4B 会把 miaomiao/harem 当标签回显。
    user = (
        "Architecture: %s\nStyle: %s\nRating: %s\nLanguage: English only\n\nIdea:\n%s"
        % (
            "Anima" if arch == "anima" else (
                "Krea 2 (natural language)" if arch == "krea" else (
                    "MOSS-Image (natural language)" if arch == "moss" else "Pony/SDXL")),
            style_line,
            rating,
            idea,
        )
    )
    started = time.time()
    raw = _llm_chat(
        system,
        user,
        0.7 if retry else 0.4,
        560 if arch in ("krea", "moss") else (480 if arch == "anima" else 200),
    )
    caption, tags = _parse_llm_reply(raw, arch)
    finished = _finish_llm_prompt(caption, tags, idea, model, arch, style, rating=rating)
    finished["elapsed"] = round((time.time() - started) * 1000)
    finished["cached"] = False
    PROMPT_LLM["last_used"] = time.time()
    if finished["prompt"]:
        with PROMPT_CACHE_LOCK:
            if len(PROMPT_CACHE) >= PROMPT_CACHE_MAX:
                oldest = sorted(PROMPT_CACHE.items(), key=lambda item: item[1][0])[:16]
                for old_key, _ in oldest:
                    PROMPT_CACHE.pop(old_key, None)
            PROMPT_CACHE[key] = (time.time(), dict(finished))
    return finished


def _list_model_files(dirs, exts=(".safetensors", ".ckpt", ".pt")):
    seen = set()
    found = []
    for base in dirs:
        try:
            names = sorted(os.listdir(base))
        except OSError:
            continue
        for name in names:
            if not name.lower().endswith(exts):
                continue
            path = os.path.join(base, name)
            if not os.path.isfile(path):
                continue
            key = os.path.abspath(path).lower()
            if key in seen:
                continue
            seen.add(key)
            found.append(os.path.abspath(path))
    return found


def _safetensors_keys(path):
    """返回 tensor 名集合；缓存按 (路径, 大小, mtime) 命中，只读头部不读权重。"""
    try:
        stat = os.stat(path)
    except OSError:
        return frozenset()
    cache_key = (os.path.abspath(path).lower(), stat.st_size, stat.st_mtime_ns)
    with _HEADER_KEYS_LOCK:
        cached = _HEADER_KEYS.get(cache_key)
    if cached is not None:
        return cached
    keys = frozenset()
    try:
        with open(path, "rb") as fh:
            head = fh.read(8)
            if len(head) == 8:
                size = struct.unpack("<Q", head)[0]
                if 0 < size <= 64 * 1024 * 1024:
                    header = json.loads(fh.read(size).decode("utf-8", "replace"))
                    if isinstance(header, dict):
                        keys = frozenset(name for name in header if name != "__metadata__")
    except (OSError, ValueError, struct.error):
        keys = frozenset()
    with _HEADER_KEYS_LOCK:
        if len(_HEADER_KEYS) > 64:
            _HEADER_KEYS.clear()
        _HEADER_KEYS[cache_key] = keys
    return keys


def _classify_checkpoint(keys):
    if not keys:
        return "unknown"
    # Krea 2：DiT 头键含 txtfusion.projector，且不带 model.diffusion_model 前缀。
    if any(name.endswith("txtfusion.projector.weight") for name in keys):
        return "krea"
    # MOSS-Image 5B：shared_block_modulation + proj.ffn_up_gate（与 ComfyUI
    # model_detection.py 的判据一致）。
    if any(name.endswith("shared_block_modulation.weight") for name in keys) and any(
            name.endswith("layers.0.proj.ffn_up_gate.weight") for name in keys):
        return "moss"
    if any(
        name.startswith("conditioner.")
        or "input_blocks." in name
        or name.startswith("first_stage_model.")
        for name in keys
    ):
        return "sdxl"
    if any("llm_adapter" in name or ".blocks." in name for name in keys):
        return "anima"
    return "unknown"


def _classify_module(keys):
    if not keys:
        return "unknown"
    if any(name.startswith("model.layers.") or name.startswith("model.embed_tokens")
           or name.startswith("model.language_model.") or name.startswith("lm_head.") for name in keys):
        return "text_encoder"
    if "conv1.weight" in keys and any(name.startswith("encoder.") for name in keys):
        return "vae"
    # FLUX.2 小 VAE 没有 conv1.weight，用 encoder + decoder/quant_conv 兜底。
    if any(name.startswith("encoder.") for name in keys) and any(
            name.startswith("decoder.") or name.startswith("quant_conv") for name in keys):
        return "vae"
    if any(name.startswith("first_stage_model.") for name in keys):
        return "vae"
    return "unknown"


def _pick_anima_module(modules, kind):
    pool = [item for item in modules if item["kind"] == kind]
    if not pool:
        return None

    def score(item):
        name = item["name"].lower()
        hinted = ("qwen" in name) if kind == "text_encoder" else ("qwen" in name or "vae" in name)
        return (0 if hinted else 1, len(name), name)

    return sorted(pool, key=score)[0]


def _engine_catalog():
    now = time.time()
    with _ENGINE_CATALOG_LOCK:
        payload = _ENGINE_CATALOG["payload"]
        if payload and now - _ENGINE_CATALOG["stamp"] < ENGINE_CATALOG_TTL:
            return payload
    checkpoints = []
    for path in _list_model_files(CHECKPOINT_DIRS):
        checkpoints.append({
            "name": os.path.splitext(os.path.basename(path))[0],
            "file": path,
            "arch": _classify_checkpoint(_safetensors_keys(path)),
        })
    modules = []
    for path in _list_model_files(TEXT_ENCODER_DIRS) + _list_model_files(MODULE_VAE_DIRS):
        if any(item["file"].lower() == path.lower() for item in modules):
            continue
        kind = _classify_module(_safetensors_keys(path))
        if kind in ("text_encoder", "vae"):
            modules.append({"name": os.path.basename(path), "file": path, "kind": kind})
    text_encoder = _pick_anima_module(modules, "text_encoder")
    vae = _pick_anima_module(modules, "vae")
    # Krea 2 用 Qwen3-VL 4B 文本编码器；和 Anima 的 Qwen3 0.6B 同时存在，
    # 必须按文件名区分，不能沿用“最短名字”规则。
    krea_candidates = [
        item for item in modules
        if item["kind"] == "text_encoder"
        and ("qwen3vl" in item["name"].lower() or "qwen3_vl" in item["name"].lower())
    ]
    krea_te = sorted(krea_candidates, key=lambda item: len(item["name"]))[0] if krea_candidates else None
    # MOSS 用 Qwen3.5-9B w4a8 编码器 + FLUX.2 小 VAE，与 Anima 的 Qwen3-0.6B 不同。
    moss_te = next((item for item in modules if item["kind"] == "text_encoder"
                    and "qwen3.5_9b" in item["name"].lower()), None)
    moss_vae = next((item for item in modules if item["kind"] == "vae"
                     and "flux2-vae" in item["name"].lower()), None)
    payload = {
        "checkpoints": checkpoints,
        "anima": {
            "text_encoder": text_encoder,
            "vae": vae,
            "modules": [item["file"] for item in (text_encoder, vae) if item],
            "ready": bool(text_encoder and vae),
        },
        "krea": {
            "text_encoder": krea_te,
            "vae": vae,
            "modules": [item["file"] for item in (krea_te, vae) if item],
            "ready": bool(krea_te and vae),
        },
        "moss": {
            "text_encoder": moss_te,
            "vae": moss_vae,
            "modules": [item["file"] for item in (moss_te, moss_vae) if item],
            "ready": bool(moss_te and moss_vae),
        },
        # SeedVR2 一步扩散超分：模型和 ComfyUI 节点都在才算可用。
        # 前端据此决定放大弹窗里是否显示「SeedVR2」这个算法。
        "seedvr2": {
            "dit": comfy_bridge.SEEDVR2_DIT,
            "vae": comfy_bridge.SEEDVR2_VAE,
            "ready": (
                os.path.isfile(os.path.join(comfy_bridge.SEEDVR2_DIR, comfy_bridge.SEEDVR2_DIT))
                and os.path.isfile(os.path.join(comfy_bridge.SEEDVR2_DIR, comfy_bridge.SEEDVR2_VAE))
            ),
        },
        "generated_at": int(now),
    }
    with _ENGINE_CATALOG_LOCK:
        _ENGINE_CATALOG["payload"] = payload
        _ENGINE_CATALOG["stamp"] = now
    return payload


def _checkpoint_stem(name):
    """只剥掉真正的权重扩展名；模型名本身可以带小数点（如 V2.3）。"""
    base = os.path.basename(str(name or "").replace("\\", "/")).strip()
    lower = base.lower()
    for ext in (".safetensors", ".ckpt", ".pt"):
        if lower.endswith(ext):
            return base[: -len(ext)]
    return base


def _checkpoint_entry(name):
    stem = _checkpoint_stem(name).lower()
    if not stem:
        return None
    try:
        for item in _engine_catalog()["checkpoints"]:
            if item["name"].lower() == stem:
                return item
    except Exception:  # noqa: BLE001
        return None
    return None


def _resolve_checkpoint(catalog, value):
    """把前端传来的模型名解析为目录条目；只接受目录里真实存在的文件。"""
    raw = str(value or "").strip().replace("\\", "/")
    if not raw:
        return None
    base = os.path.basename(raw).lower()
    stem = _checkpoint_stem(raw).lower()
    for item in catalog.get("checkpoints") or []:
        if item["name"].lower() == stem or os.path.basename(item["file"]).lower() == base:
            return item
    return None


def _model_arch(name, preset=""):
    stem = _checkpoint_stem(name).lower()
    entry = _checkpoint_entry(name)
    if entry and entry["arch"] != "unknown":
        return entry["arch"]
    if str(preset or "").lower() == "anima":
        return "anima"
    if re.search(r"krea", stem):
        return "krea"
    if re.search(r"moss", stem):
        return "moss"
    if re.search(r"anima|silvermoon|miaomiao", stem):
        return "anima"
    return "sdxl" if stem else "unknown"


def _active_model_name():
    """提示词端点没带 model 时，回退到当前底模。"""
    return comfy_bridge.current_model()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "KlockUI/1.0"

    def log_message(self, fmt, *args):
        # 进度轮询与状态轮询会淹没日志，其余请求照常记录。
        if "/sdapi/v1/progress" in self.path or self.path.startswith("/api/status"):
            return
        log.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store", extra_headers=None):
        bodyless = code in (204, 304)
        self.send_response(code)
        if not bodyless:
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if not bodyless and self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _host_ok(self):
        host = (self.headers.get("Host") or "").strip().lower()
        return not host or host in ALLOWED_HOSTS

    def _request_guard(self, mutating=False):
        if not self._host_ok():
            log.warning("forbidden host: %s", self.headers.get("Host"))
            self.close_connection = True
            self._send(403, b'{"detail":"Forbidden host"}')
            return False
        if mutating and not self._origin_ok():
            log.warning("forbidden origin: %s", self.headers.get("Origin"))
            # 拒绝发生在读取请求体之前；必须断开，否则 keep-alive 会把残留 body 当成下一条请求。
            self.close_connection = True
            self._send(403, b'{"detail":"Forbidden origin"}')
            return False
        return True

    def _send_file(self, path, cache="no-store", download=False):
        ext = os.path.splitext(path)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            handle = open(path, "rb")
            size = os.fstat(handle.fileno()).st_size
        except OSError as exc:
            self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
            return
        headers = {"X-Content-Type-Options": "nosniff"}
        # ETag：用 修改时间+大小 生成弱校验，配合 no-cache 让浏览器每次回源校验。
        # 这样改完 CSS/JS 不会因为 max-age 缓存而"改了不生效"（踩过）。
        try:
            st = os.stat(path)
            etag = 'W/"%x-%x"' % (int(st.st_mtime), st.st_size)
        except OSError:
            etag = None
        if etag:
            headers["ETag"] = etag
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", cache)
                self.end_headers()
                handle.close()
                return
        if ext == ".html":
            headers.update(HTML_FRAME_HEADERS)
        if download:
            name = os.path.basename(path)
            ascii_name = name.encode("ascii", "ignore").decode() or "image" + ext
            headers["Content-Disposition"] = (
                "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(name))
            )
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", cache)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            if self.command != "HEAD":
                shutil.copyfileobj(handle, self.wfile, 256 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            handle.close()

    GZIP_TYPES = {".js", ".css", ".html", ".json", ".svg"}

    def _send_static_gzip(self, full):
        """文本类静态资源按需 gzip。开发机上肉眼看不出差别，但跨设备/局域网访问差 4 倍。"""
        ext = os.path.splitext(full)[1].lower()
        accepts = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if not accepts or ext not in self.GZIP_TYPES or not os.path.isfile(full):
            return False
        try:
            st = os.stat(full)
        except OSError:
            return False
        etag = 'W/"gz-%x-%x"' % (int(st.st_mtime), st.st_size)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return True
        key = (full, st.st_mtime_ns, st.st_size)
        blob = _GZIP_CACHE.get(key)
        if blob is None:
            try:
                with open(full, "rb") as handle:
                    raw = handle.read()
                blob = gzip.compress(raw, 6)
            except OSError:
                return False
            if len(_GZIP_CACHE) > 32:
                _GZIP_CACHE.clear()
            _GZIP_CACHE[key] = blob
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(blob)
            except (BrokenPipeError, ConnectionResetError):
                pass
        return True

    def _serve_static(self, path):
        rel = path.lstrip("/")
        top = rel.split("/", 1)[0]
        if top not in STATIC_DIRS:
            self._send(404, b'{"detail":"Not Found"}')
            return
        base = os.path.realpath(os.path.join(ROOT, top))
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not (full == base or full.startswith(base + os.sep)) or not os.path.isfile(full):
            self._send(404, b'{"detail":"Not Found"}')
            return
        # no-cache：允许缓存但每次校验（ETag 命中回 304），避免静态资源"改了不生效"
        if self._send_static_gzip(full):
            return
        self._send_file(full, "no-cache")

    def do_GET(self):
        if not self._request_guard():
            return
        if not self._auth_guard():
            return
        path = self.path.split("?", 1)[0]
        if path == "/local/engine/catalog":
            self._engine_catalog()
            return
        if path in ("/", "/index.html"):
            index_file = os.path.join(ROOT, "index.html")
            if not self._send_static_gzip(index_file):
                self._send_file(index_file, "no-cache")
            return
        if path == "/favicon.ico":
            self._send(204, b"")
            return
        if path.startswith("/assets/") or path.startswith("/vendor/"):
            self._serve_static(path)
            return
        if path == "/local/interrogate/status":
            self._interrogate_status()
            return
        if path == "/local/gallery":
            self._gallery_list()
            return
        if path == "/local/gallery/thumb":
            self._gallery_thumb()
            return
        if path == "/local/gallery/file":
            self._gallery_file()
            return
        if path == "/local/gallery/info":
            self._gallery_info()
            return
        if path == "/local/progress/stream":
            self._progress_stream()
            return
        if path == "/local/generate/status":
            self._generate_status()
            return
        if path == "/local/generate/list":
            self._generate_list()
            return
        if path == "/local/history":
            self._history_list()
            return
        if path == "/local/presets":
            self._presets_list()
            return
        if path == "/local/preset":
            self._preset_one()
            return
        if path == "/api/status":
            self._status()
            return
        if path == "/api/prompt/status":
            self._prompt_status()
            return
        if path.startswith("/api/"):
            self._proxy("GET", self.path[4:], None)
            return
        self._send(404, b'{"detail":"Not Found"}')

    def do_POST(self):
        if not self._request_guard(mutating=True):
            return
        if not self._auth_guard():
            return
        path = self.path.split("?", 1)[0]
        if path == "/local/generate":
            self._generate_submit()
            return
        if path == "/local/generate/cancel":
            self._generate_cancel()
            return
        if path == "/local/history/clear":
            self._history_clear()
            return
        if path == "/local/history/remove":
            self._history_remove()
            return
        if path == "/local/postprocess":
            self._postprocess()
            return
        if path == "/local/preset/save":
            self._preset_save()
            return
        if path == "/local/preset/delete":
            self._preset_delete()
            return
        if path == "/local/open-output":
            self._open_output()
            return
        if path == "/local/open-favorites":
            self._open_favorites()
            return
        if path == "/local/engine/select-model":
            self._engine_select_model()
            return
        if path == "/local/gallery/favorite":
            self._gallery_favorite()
            return
        if path == "/local/gallery/delete":
            self._gallery_delete()
            return
        if path == "/local/gallery/export":
            self._gallery_export()
            return
        if path == "/local/interrogate":
            self._interrogate()
            return
        if path == "/api/prompt/expand":
            self._prompt_ai()
            return
        if path.startswith("/api/"):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length < 0 or length > MAX_PROXY_BYTES:
                self.close_connection = True
                body = json.dumps({"detail": "请求体过大"}, ensure_ascii=False)
                self._send(413, body.encode("utf-8"))
                return
            data = self.rfile.read(length) if length else b""
            self._proxy("POST", self.path[4:], data)
            return
        # 未读 body 就 404，keep-alive 会把残留 body 当成下一条请求，直接断开。
        self.close_connection = True
        self._send(404, b'{"detail":"Not Found"}')

    def do_HEAD(self):
        self.do_GET()

    def _status(self):
        try:
            body = comfy_bridge.status()
            body["version"] = VERSION
            self._send(200, json.dumps(body, ensure_ascii=False).encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            log.info("status offline: %s", exc)
            self._send(200, b'{"online": false, "model": ""}')

    def _engine_catalog(self):
        try:
            payload = _engine_catalog()
        except Exception as exc:  # noqa: BLE001
            log.warning("engine catalog failed: %s", exc)
            self._send(500, json.dumps({"ok": False, "detail": str(exc)}, ensure_ascii=False).encode("utf-8"))
            return
        self._send(200, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _engine_select_model(self):
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        model = str(data.get("model") or "").strip()
        if not model:
            self._send(400, b'{"ok":false,"detail":"missing model"}')
            return
        try:
            catalog = _engine_catalog()
        except Exception as exc:  # noqa: BLE001
            log.warning("engine catalog failed: %s", exc)
            self._send(500, json.dumps({"ok": False, "detail": str(exc)}, ensure_ascii=False).encode("utf-8"))
            return
        entry = _resolve_checkpoint(catalog, model)
        if not entry:
            body = json.dumps({
                "ok": False,
                "detail": "模型不在目录中：%s" % model,
            }, ensure_ascii=False)
            self._send(400, body.encode("utf-8"))
            return
        model = entry["name"]
        arch = entry["arch"] if entry["arch"] in ("anima", "krea", "moss", "sdxl") else "sdxl"
        if arch == "anima":
            modules = catalog["anima"]["modules"]
            if len(modules) < 2:
                self._send(409, json.dumps({
                    "ok": False,
                    "arch": arch,
                    "detail": "缺少 Anima 的 Qwen3 文本编码器或 Qwen-Image VAE",
                }, ensure_ascii=False).encode("utf-8"))
                return
            anima_name = os.path.basename(entry["file"])
            payload = {
                "forge_preset": "anima",
                "forge_checkpoint_anima": anima_name,
                "forge_additional_modules_anima": modules,
                "forge_additional_modules": modules,
                "sd_model_checkpoint": model,
            }
        elif arch == "krea":
            modules = catalog["krea"]["modules"]
            if len(modules) < 2:
                self._send(409, json.dumps({
                    "ok": False,
                    "arch": arch,
                    "detail": "缺少 Krea 2 的 Qwen3-VL 4B 文本编码器或 Qwen-Image VAE",
                }, ensure_ascii=False).encode("utf-8"))
                return
            payload = {
                "forge_preset": "sd",
                "sd_model_checkpoint": model,
                "forge_additional_modules": modules,
            }
        elif arch == "moss":
            modules = catalog["moss"]["modules"]
            if len(modules) < 2:
                self._send(409, json.dumps({
                    "ok": False,
                    "arch": arch,
                    "detail": "缺少 MOSS 的 Qwen3.5-9B 文本编码器或 FLUX.2 小 VAE",
                }, ensure_ascii=False).encode("utf-8"))
                return
            payload = {
                "forge_preset": "moss",
                "sd_model_checkpoint": model,
                "forge_additional_modules": modules,
            }
        else:
            payload = {
                "forge_preset": "sd",
                "sd_model_checkpoint": model,
                "forge_additional_modules": [],
            }
        # 切模型只更新适配层状态并让 ComfyUI 释放旧权重；
        # 工作流在每次生成时按当前底模构造，无需引擎侧 options 往返。
        if not _forge_busy():
            _forge_unload_checkpoint()
        result, code = comfy_bridge.select_model(model, catalog)
        if code != 200:
            self._send(code, json.dumps(result, ensure_ascii=False).encode("utf-8"))
            return
        log.info("select model: %s -> arch=%s", model, result.get("arch"))
        if (result.get("arch") or arch) == "moss":
            # MOSS 的 TE 就是 Qwen3.5-9B，转写层已关闭，4B 留着纯属白占约 2GB。
            # 后台线程里放，避免拖慢切模型的响应。
            threading.Thread(
                target=release_prompt_llm,
                args=("switched to moss",),
                daemon=True,
                name="prompt-release",
            ).start()
        body = json.dumps({
            "ok": True,
            "model": model,
            "arch": result.get("arch") or arch,
            "preset": payload["forge_preset"],
            "modules": [os.path.basename(item) for item in payload.get("forge_additional_modules") or []],
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _open_output(self):
        if not self._origin_ok():
            self.close_connection = True
            self._send(403, b'{"detail":"Forbidden"}')
            return
        # 这个端点不收 body；若客户端仍发了 body，断开以免残留字节污染 keep-alive。
        try:
            if int(self.headers.get("Content-Length") or 0) > 0:
                self.close_connection = True
        except ValueError:
            self.close_connection = True
        if not os.path.isdir(OUTPUT_ROOT):
            body = json.dumps({"ok": False, "detail": "输出目录还不存在"}, ensure_ascii=False)
            self._send(404, body.encode("utf-8"))
            return
        try:
            os.startfile(OUTPUT_ROOT)  # type: ignore[attr-defined]
            body = json.dumps({"ok": True, "path": OUTPUT_ROOT}, ensure_ascii=False)
            self._send(200, body.encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            log.warning("open output failed: %s", exc)
            body = json.dumps({"ok": False, "detail": str(exc)}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))

    def _open_favorites(self):
        if not self._origin_ok():
            self.close_connection = True
            self._send(403, b'{"detail":"Forbidden"}')
            return
        try:
            if int(self.headers.get("Content-Length") or 0) > 0:
                self.close_connection = True
        except ValueError:
            self.close_connection = True
        try:
            os.makedirs(FAVORITES_DIR, exist_ok=True)
            os.startfile(FAVORITES_DIR)  # type: ignore[attr-defined]
            body = json.dumps({"ok": True, "path": FAVORITES_DIR}, ensure_ascii=False)
            self._send(200, body.encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            log.warning("open favorites failed: %s", exc)
            body = json.dumps({"ok": False, "detail": str(exc)}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))

    def _read_json(self):
        self._json_oversized = False
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_JSON_BYTES:
            # 不读取超长请求体：关闭连接，避免 keep-alive 下残留字节污染下一个请求。
            self._json_oversized = True
            self.close_connection = True
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            return data if isinstance(data, dict) else None
        except Exception:  # noqa: BLE001
            return None

    def _reject_json(self):
        if getattr(self, "_json_oversized", False):
            self._send(413, b'{"detail":"Request body too large"}')
        else:
            self._send(400, b'{"detail":"Invalid JSON"}')

    def _origin_ok(self):
        origin = (self.headers.get("Origin") or "").strip().lower().rstrip("/")
        return not origin or origin in LOCAL_ORIGINS

    def _client_ip(self):
        return (self.client_address[0] if self.client_address else "")[:64]

    def _cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            key, sep, value = part.strip().partition("=")
            if sep and key == name:
                return value
        return ""

    def _session_cookie(self, token, max_age=SESSION_TTL):
        secure = ""  # 远程访问已移除，只用 HTTP 本机
        return "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s" % (
            SESSION_COOKIE,
            token,
            max_age,
            secure,
        )

    def _expired_cookie(self):
        return self._session_cookie("", 0)

    def _deny_auth(self, code, body, ctype="text/html; charset=utf-8", headers=None):
        # 拒绝发生在读 body 之前；POST 必须断开，否则 keep-alive 会把残留 body 当成下一条请求。
        if self.command == "POST":
            self.close_connection = True
        payload = body.encode("utf-8") if isinstance(body, str) else body
        self._send(code, payload, ctype, extra_headers=headers)

    def _auth_guard(self):
        # 访问密码功能已按用户要求移除（2026-11-15）：本机工作台不再需要登录页。
        # 保留这个空实现，只为不惊动 do_GET / do_POST 的调用点。
        return True

    def _login_page(self, error="", next_path="/", status=200, extra=None):
        page = (
            LOGIN_PAGE.replace("__ERROR__", html.escape(error))
            .replace("__NEXT__", html.escape(safe_next(next_path), quote=True))
        )
        headers = dict(LOGIN_SECURITY_HEADERS)
        if extra:
            headers.update(extra)
        self._send(status, page.encode("utf-8"), "text/html; charset=utf-8", extra_headers=headers)

    def _login_submit(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._login_page()
            return
        if length > 4096:
            self.close_connection = True
            self._send(413, b'{"detail":"Request body too large"}')
            return
        raw = self.rfile.read(length).decode("utf-8", "replace")
        form = parse_qs(raw, keep_blank_values=True)
        password = (form.get("password") or [""])[0]
        next_path = safe_next((form.get("next") or ["/"])[0])
        ip = self._client_ip()
        wait = LOGIN_LIMITER.retry_after(ip)
        if wait:
            minutes = max(1, (wait + 59) // 60)
            self._login_page(
                "尝试次数过多，请 %d 分钟后再试" % minutes,
                next_path,
                429,
                {"Retry-After": str(wait)},
            )
            return
        auth = load_auth()
        if not auth:
            self._deny_auth(
                503,
                AUTH_BROKEN_PAGE if os.path.exists(AUTH_FILE) else AUTH_SETUP_PAGE,
                headers=LOGIN_SECURITY_HEADERS,
            )
            return
        if verify_password(auth, password):
            LOGIN_LIMITER.reset(ip)
            log.info("login ok ip=%s", ip)
            self._send(
                303,
                b"",
                extra_headers={
                    "Location": next_path,
                    "Set-Cookie": self._session_cookie(make_session(auth)),
                },
            )
            return
        LOGIN_LIMITER.fail(ip)
        log.warning("login failed ip=%s", ip)
        time.sleep(0.35)
        self._login_page("密码不正确", next_path, 401)

    def _logout(self):
        log.info("logout ip=%s", self._client_ip())
        self._send(
            303,
            b"",
            extra_headers={"Location": "/login", "Set-Cookie": self._expired_cookie()},
        )

    def _generate_submit(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send(400, '{"detail":"缺少生成参数"}'.encode("utf-8"))
            return
        if length > MAX_PROXY_BYTES:
            self.close_connection = True
            self._send(413, b'{"detail":"Request body too large"}')
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, b'{"detail":"Invalid JSON"}')
            return
        if not isinstance(data, dict):
            self._send(400, b'{"detail":"Invalid JSON"}')
            return
        endpoint = str(data.get("endpoint") or "").strip().lower()
        payload = data.get("payload")
        # 兜底：请求里带了 model 但 payload 没钉，补进 override_settings，
        # 否则排队期间切换底模会让这个任务跑在别的模型上。
        if isinstance(payload, dict) and data.get("model"):
            override = payload.get("override_settings")
            if not isinstance(override, dict):
                override = {}
            if not override.get("sd_model_checkpoint"):
                override["sd_model_checkpoint"] = data["model"]
                payload["override_settings"] = override
        if endpoint not in ("txt2img", "img2img") or not isinstance(payload, dict) or not payload:
            self._send(400, '{"detail":"endpoint 必须是 txt2img 或 img2img"}'.encode("utf-8"))
            return
        model = str(data.get("model") or "")
        with JOBS_LOCK:
            _prune_jobs_locked()
            queued = _queue_length_locked()
            if queued >= GENERATION_QUEUE_MAX:
                self._send(
                    429,
                    json.dumps({"detail": "队列已满（%d 个任务在等），等一会儿再加" % queued}, ensure_ascii=False).encode("utf-8"),
                )
                return
            job_id = secrets.token_urlsafe(12)
            JOBS[job_id] = {
                "id": job_id,
                "endpoint": endpoint,
                "status": "queued",
                "created": time.time(),
                "started": None,
                "finished": None,
                "response": None,
                "payload": payload,
                "meta": _job_meta(endpoint, payload, model),
                "detail": "",
                "upstream_status": None,
                "interrupt_requested": False,
            }
            JOB_QUEUE.append(job_id)
            position = _queue_position_locked(job_id)
            _pump_queue_locked()
        log.info("generation job %s queued (%s, position %s)", job_id, endpoint, position)
        body = json.dumps({"id": job_id, "status": "queued", "position": position}, ensure_ascii=False)
        self._send(202, body.encode("utf-8"))

    def _progress_stream(self):
        """SSE：把桥接层收到的步预览即时推给浏览器。

        轮询模式的延迟来自「间隔 + 一次性取走」：650ms 轮询在看 5.8s/步时还行，
        但帧会被取走，晚一拍就丢；改成推送后延迟压到十几毫秒，且不重复传图。
        """
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        last_seq = -1
        last_step = -1
        idle = 0
        try:
            while True:
                body = comfy_bridge.progress(consume_preview=False)
                state = body.get("state") or {}
                step = int(state.get("sampling_step") or 0)
                steps = int(state.get("sampling_steps") or 0)
                seq = int(body.get("preview_seq") or 0)
                image = body.get("current_image") or ""
                running = steps > 0 and not state.get("interrupted")
                if running and (seq != last_seq or step != last_step):
                    payload = {"step": step, "steps": steps,
                               "progress": body.get("progress"), "eta": body.get("eta_relative")}
                    if image and seq != last_seq:
                        payload["image"] = image
                    chunk = "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                    last_seq = seq
                    last_step = step
                    idle = 0
                else:
                    idle += 1
                    if idle % 20 == 0:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                # 任务结束后再空转 1.5s 收尾，避免最后一帧被截断
                if not running:
                    if idle > 15:
                        self.wfile.write(b"event: end\ndata: {}\n\n")
                        self.wfile.flush()
                        return
                time.sleep(0.12)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _generate_status(self):
        query = parse_qs(urlparse(self.path).query)
        job_id = (query.get("id") or [""])[0]
        snapshot = None
        response = None
        with JOBS_LOCK:
            _prune_jobs_locked()
            job = JOBS.get(job_id)
            if job:
                snapshot = _job_public_locked(job)
                response = job.get("response") if job["status"] == "done" else None
                if job["status"] == "done":
                    snapshot["history"] = job.get("history") or []
        if snapshot is None:
            self._send(404, '{"detail":"任务不存在或已过期"}'.encode("utf-8"))
            return
        if response is not None:
            snapshot["response"] = response
        body = json.dumps(snapshot, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _generate_list(self):
        with JOBS_LOCK:
            _prune_jobs_locked()
            jobs = sorted(JOBS.values(), key=lambda job: job.get("created") or 0, reverse=True)
            items = [_job_public_locked(job) for job in jobs]
            queued = _queue_length_locked()
            running = any(job.get("status") == "running" for job in JOBS.values())
        body = json.dumps({
            "items": items,
            "queued": queued,
            "running": running,
            "queue_max": GENERATION_QUEUE_MAX,
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _generate_cancel(self):
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        job_id = str(data.get("id") or "")
        status = ""
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                status = job.get("status") or ""
                if status == "queued":
                    job["status"] = "cancelled"
                    job["detail"] = "已取消"
                    job["finished"] = time.time()
                    job["payload"] = None
                elif status == "running":
                    job["interrupt_requested"] = True
        if not status:
            self._send(404, '{"detail":"任务不存在或已过期"}'.encode("utf-8"))
            return
        interrupted = False
        if status == "running":
            interrupted = _interrupt_forge()
        log.info("generation job %s cancel (%s)", job_id, status)
        body = json.dumps({
            "ok": True,
            "id": job_id,
            "status": "cancelled" if status == "queued" else "stopping",
            "interrupted": interrupted,
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    # 仓库自带的示例配方：让用户不必去文件管理器里翻 presets/ 目录。
    PRESET_DIRS = (os.path.join(ROOT, "presets"),)

    def _preset_files(self):
        found = []
        for base in self.PRESET_DIRS:
            if not os.path.isdir(base):
                continue
            for name in sorted(os.listdir(base)):
                if not name.lower().endswith(".json"):
                    continue
                full = os.path.join(base, name)
                if not os.path.isfile(full):
                    continue
                found.append((name, full))
        return found

    def _presets_list(self):
        items = []
        for name, full in self._preset_files():
            try:
                with open(full, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception:
                continue
            items.append({
                "file": name,
                "name": str(data.get("name") or name[:-5]),
                "arch": data.get("arch") or "",
                "model": data.get("model") or "",
                "steps": data.get("steps"),
                "loras": len(data.get("loras") or []),
            })
        self._send(200, json.dumps({"items": items, "total": len(items)}, ensure_ascii=False).encode("utf-8"))

    def _preset_save(self):
        """把前端编辑的配方写回 presets/。

        安全边界：文件名只允许 [A-Za-z0-9._-] 且必须以 .json 结尾，
        内容必须是能解析的 JSON 对象——不做这两条就等于开了个任意写接口。
        """
        data = self._read_json()
        name = str(data.get("file") or "").strip()
        body = data.get("json")
        if not name or not name.lower().endswith(".json"):
            self._send(400, b'{"detail":"file must end with .json"}')
            return
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", name):
            self._send(400, b'{"detail":"invalid file name"}')
            return
        if not isinstance(body, dict):
            self._send(400, b'{"detail":"json must be an object"}')
            return
        pretty = json.dumps(body, ensure_ascii=False, indent=2) + "\n"
        base = self.PRESET_DIRS[0]
        os.makedirs(base, exist_ok=True)
        target = os.path.join(base, name)
        # 覆盖前留一份 .bak，误保存还能捞回来
        if os.path.isfile(target):
            try:
                shutil.copy2(target, target + ".bak")
            except OSError:
                pass
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(pretty)
        os.replace(tmp, target)
        self._send(200, json.dumps({"ok": True, "file": name}, ensure_ascii=False).encode("utf-8"))

    def _preset_delete(self):
        """删除 presets/ 下的配方文件。

        内置配方和自存配方在界面上权限一致，所以要能删。删之前留 .bak，
        git 里也有原始版本，误删能从两边捞回来。
        """
        data = self._read_json()
        name = str((data or {}).get("file") or "").strip()
        if not name or not name.lower().endswith(".json"):
            self._send(400, b'{"detail":"file must end with .json"}')
            return
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", name):
            self._send(400, b'{"detail":"invalid file name"}')
            return
        base = self.PRESET_DIRS[0]
        target = os.path.join(base, name)
        # 白名单校验已经挡掉 ../，再确认一次真实路径没跑出 presets/
        if os.path.dirname(os.path.abspath(target)) != os.path.abspath(base):
            self._send(400, b'{"detail":"invalid path"}')
            return
        if not os.path.isfile(target):
            self._send(404, b'{"detail":"not found"}')
            return
        try:
            shutil.copy2(target, target + ".bak")
        except OSError:
            pass
        os.remove(target)
        self._send(200, json.dumps({"ok": True, "file": name}, ensure_ascii=False).encode("utf-8"))

    def _preset_one(self):
        query = parse_qs(urlparse(self.path).query)
        want = (query.get("file") or [""])[0]
        # 只允许 presets 目录里的文件：basename 对比，挡掉 ../ 之类
        for name, full in self._preset_files():
            if name == want:
                try:
                    with open(full, "r", encoding="utf-8") as handle:
                        body = handle.read()
                except OSError as exc:
                    self._send(500, json.dumps({"detail": str(exc)}, ensure_ascii=False).encode("utf-8"))
                    return
                self._send(200, body.encode("utf-8"))
                return
        self._send(404, b'{"detail":"preset not found"}')

    def _history_list(self):
        query = parse_qs(urlparse(self.path).query)
        try:
            limit = min(60, max(1, int((query.get("limit") or ["24"])[0])))
        except ValueError:
            limit = 24
        items = _load_history()
        body = json.dumps({
            "items": items[:limit],
            "total": len(items),
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _history_clear(self):
        _history_remove(None)
        log.info("history cleared")
        self._send(200, b'{"ok":true}')

    def _history_remove(self):
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        path = str(data.get("path") or "")
        total = _history_remove(path)
        body = json.dumps({"ok": True, "total": total}, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _postprocess(self):
        _invalidate_scan()
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send(400, '{"detail":"缺少图片参数"}'.encode("utf-8"))
            return
        if length > MAX_PROXY_BYTES:
            self.close_connection = True
            self._send(413, b'{"detail":"Request body too large"}')
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, b'{"detail":"Invalid JSON"}')
            return
        if not isinstance(data, dict):
            self._send(400, b'{"detail":"Invalid JSON"}')
            return
        try:
            scale = float(data.get("scale") or 2)
        except (TypeError, ValueError):
            scale = 2
        scale = min(4.0, max(1.5, round(scale, 2)))
        # 只取文件名，挡掉 "../" 之类的路径穿越。
        upscaler = os.path.basename(str(data.get("upscaler") or "Lanczos").replace("\\", "/"))
        # 以前这里只放行 Lanczos/Nearest，导致界面上选了超分模型也被悄悄降级成插值。
        # 现在插值三种 + 本地超分模型都放行，最终由 comfy_bridge.upscale_image
        # 自己判断（文件存在就走 UpscaleModelLoader，否则退回 PIL）。
        _interp = ("Lanczos", "Nearest", "Bicubic")
        if (upscaler != "SeedVR2" and upscaler not in _interp
                and upscaler not in comfy_bridge._upscale_model_names()):
            upscaler = "Lanczos"
        save = bool(data.get("save"))
        rel = str(data.get("path") or "").strip()
        blob = b""
        source_info = {}
        source_mode = "txt2img"
        if rel:
            full, rel = safe_image_path(rel)
            if not full or not os.path.isfile(full):
                self._send(404, b'{"detail":"Image not found"}')
                return
            try:
                st = os.stat(full)
                source_info = read_gallery_info(full, rel, st)
                with open(full, "rb") as handle:
                    blob = handle.read()
            except OSError as exc:
                body = json.dumps({"detail": "读取原图失败：%s" % exc}, ensure_ascii=False)
                self._send(500, body.encode("utf-8"))
                return
            source_mode = "img2img" if rel.split("/", 1)[0] == "img2img-images" else "txt2img"
        else:
            blob = _b64_bytes(data.get("image"))
            if not blob:
                self._send(400, '{"detail":"缺少原图"}'.encode("utf-8"))
                return
        start = time.time()
        src_w, src_h = _image_size_bytes(blob)
        # 选了本地超分模型时，comfy_bridge 会按模型原生倍数出图（不再缩回 scale），
        # 所以下面的"实际倍数"要按出图尺寸反推，不能直接写用户选的值。
        is_model = upscaler not in _interp and upscaler in comfy_bridge._upscale_model_names()
        try:
            # 插值走本地 PIL；选了超分模型则转去 ComfyUI 跑 UpscaleModelLoader。
            out_data = comfy_bridge.upscale_image(blob, scale, upscaler)
        except Exception as exc:  # noqa: BLE001
            body = json.dumps({"detail": "放大失败：%s" % exc}, ensure_ascii=False)
            self._send(502, body.encode("utf-8"))
            return
        width, height = _image_size_bytes(out_data)
        if src_w and width:
            real_scale = round(width / float(src_w), 3)
        else:
            real_scale = scale
        # 4x 出图动辄 20–70MB PNG，base64 塞进 JSON 会把浏览器标签拖死。
        # 但**不能再缩尺寸**——用户就是要原生 4x，缩了等于白干。
        # 所以只换编码：超预算就原尺寸转 JPEG(q92)，像素一个不减，体积掉到 1/5。
        # 磁盘上 / 保存导出的仍是原始 PNG。
        preview_bytes, preview_mime, preview_ready = out_data, "image/png", False
        if is_model and len(out_data) > UPSCALE_PREVIEW_MAX_BYTES and Image is not None:
            try:
                with Image.open(io.BytesIO(out_data)) as big:
                    buffer = io.BytesIO()
                    big.convert("RGB").save(buffer, format="JPEG", quality=92,
                                            optimize=True, progressive=True)
                    preview_bytes = buffer.getvalue()
                    preview_mime, preview_ready = "image/jpeg", True
            except Exception:  # noqa: BLE001
                preview_bytes, preview_mime, preview_ready = out_data, "image/png", False
        elapsed = round(time.time() - start, 2)
        meta = source_info.get("meta") if isinstance(source_info.get("meta"), dict) else {}
        infotext = str(source_info.get("raw") or "").strip()
        if is_model:
            note = "Postprocess upscale: %s (native %sx -> %dx%d)" % (
                upscaler, ("%g" % real_scale), width, height)
        else:
            note = "Postprocess upscale: %sx %s" % (("%g" % scale), upscaler)
        infotext = (infotext + ", " + note) if infotext else note
        out_path = ""
        if save:
            seed_text = ""
            for key in ("Seed", "seed"):
                match = re.search(r"-?\d+", str(meta.get(key) or ""))
                if match:
                    seed_text = match.group(0)
                    break
            try:
                out_path, _size = _save_generated_image(
                    out_data, source_mode, seed_text, 1, infotext, "postprocess"
                )
            except OSError as exc:
                body = json.dumps({"detail": "保存放大结果失败：%s" % exc}, ensure_ascii=False)
                self._send(500, body.encode("utf-8"))
                return
            steps = meta.get("Steps")
            cfg = meta.get("CFG scale")
            record = {
                "id": "h" + secrets.token_urlsafe(9),
                "path": out_path,
                "mode": source_mode,
                "kind": "postprocess",
                "created": int(time.time() * 1000),
                "finished": int(time.time() * 1000),
                "seed": seed_text or None,
                "width": width,
                "height": height,
                "steps": int(steps) if str(steps or "").isdigit() else steps,
                "cfg": cfg,
                "sampler": meta.get("Sampler") or "",
                "scheduler": meta.get("Schedule type") or "",
                "prompt": source_info.get("prompt") or "",
                "negative": source_info.get("negative") or "",
                "model": meta.get("Model") or "",
                "hires": False,
                "denoise": None,
                "batchId": "",
                "batchIndex": 1,
                "batchTotal": 1,
                "elapsed": elapsed,
                "interrupted": False,
                "scale": real_scale,
                "upscaler": upscaler,
                "source": rel,
            }
            _history_add([record])
            log.info("postprocess saved %s (%.2fx %s, %.2fs)", out_path, real_scale, upscaler, elapsed)
        body = json.dumps({
            "ok": True,
            "image": "data:%s;base64,%s" % (
                preview_mime, base64.b64encode(preview_bytes).decode("ascii")),
            "width": width,
            "height": height,
            "preview": preview_ready,
            "scale": real_scale,
            "requestedScale": scale,
            "native": bool(is_model),
            "sourceWidth": src_w,
            "sourceHeight": src_h,
            "upscaler": upscaler,
            "elapsed": elapsed,
            "path": out_path,
            "mode": source_mode,
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _prompt_status(self):
        ready = prompt_llm_health(0.8)
        detail = ""
        if not ready:
            detail = PROMPT_LLM.get("last_error") or "提示词模型未加载，需要时自动启动（约 10–30 秒）"
        last_used = float(PROMPT_LLM.get("last_used") or 0)
        body = json.dumps({
            "ready": ready,
            "engine": PROMPT_LLM["alias"] if ready else "",
            "label": PROMPT_LLM["label"],
            "mode": "auto",
            "ctx": PROMPT_LLM["ctx"],
            "detail": detail,
            # 空闲退出：idle_seconds 是阈值，idle_for 是当前已空闲秒数。
            "idle_seconds": int(PROMPT_LLM.get("idle_seconds") or 0),
            "idle_for": round(time.time() - last_used) if (ready and last_used) else 0,
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _prompt_ai(self):
        if not self._origin_ok():
            self._send(403, b'{"detail":"Forbidden"}')
            return
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        idea = str(data.get("text") or "").strip()
        if not idea:
            body = json.dumps({"detail": "先写一句画面想法，中英文都行"}, ensure_ascii=False)
            self._send(400, body.encode("utf-8"))
            return
        if len(idea) > 1200:
            body = json.dumps({"detail": "描述太长，请精简到 1200 字以内"}, ensure_ascii=False)
            self._send(400, body.encode("utf-8"))
            return
        style = str(data.get("style") or "auto").strip().lower()
        if style not in STYLE_TAGS:
            style = "auto"
        model = str(data.get("model") or "").strip()
        if not model:
            model = _active_model_name()
        retry = bool(data.get("retry"))
        rating = normalize_manual_rating(data.get("rating"))
        has_zh = bool(re.search(r"[\u4e00-\u9fff]", idea))
        started = time.time()

        early_arch = _model_arch(model)

        # MOSS 的文本编码器就是 Qwen3.5-9B，中文/英文长文本原生支持。
        # 再过一遍 4B 转写只会丢细节、多等十几秒，整条转写链路直接关掉、原文透传。
        if early_arch == "moss":
            body = json.dumps({
                "ok": True,
                "prompt": idea,
                "elapsed": round((time.time() - started) * 1000),
                "translated": False,
                "style": style,
                "rating": rating if rating != "auto" else "raw",
                "rating_mode": rating if rating != "auto" else "raw",
                "rating_tag": "",
                "engine": "passthrough",
                "label": "MOSS 直接读中文",
                "mode": "caption",
                "arch": "moss",
                "caption": idea,
                "tags": [],
                "prefix": "",
                "body": idea,
                "cached": False,
                "notes": [
                    "MOSS 的 TE 是 Qwen3.5-9B，中文长文本原生支持，已跳过 4B 转写",
                ],
            }, ensure_ascii=False)
            self._send(200, body.encode("utf-8"))
            return

        # 纯英文标签列表直接透传，不经过 4B，省 10 秒且不改变用户原意。
        if not has_zh and looks_like_tag_list(idea):
            notes = []
            tags = resolve_framing_tags(split_tag_text(idea), idea, notes)
            tags = reorder_artist_tags(tags)
            for tag in STYLE_TAGS.get(style, []):
                if tag not in tags:
                    tags.append(tag)
            rating_tag = manual_rating_tag(rating, _model_arch(model))
            if rating_tag:
                # 手动评级覆盖用户/模型写过的评级标签，只保留选中的一个。
                tags = [tag for tag in tags if not RATING_TAG_RE.fullmatch(tag)]
                tags.insert(0, rating_tag)
            prefix = quality_prefix(model, style)
            prompt = prefix + ", ".join(tags) if prefix else ", ".join(tags)
            body = json.dumps({
                "ok": True,
                "prompt": prompt,
                "elapsed": round((time.time() - started) * 1000),
                "translated": False,
                "style": style,
                "rating": rating if rating != "auto" else "raw",
                "rating_mode": rating if rating != "auto" else "raw",
                "rating_tag": rating_tag,
                "engine": "passthrough",
                "label": "英文标签直通",
                "mode": "tags",
                "arch": _model_arch(model),
                "caption": "",
                "tags": tags,
                "prefix": prefix,
                "body": ", ".join(tags),
                "cached": False,
                "notes": notes,
            }, ensure_ascii=False)
            self._send(200, body.encode("utf-8"))
            return

        arch = early_arch
        try:
            result = generate_prompt_llm(idea, model, arch, style, retry=retry, rating=rating)
        except PromptSafetyError as exc:
            body = json.dumps({"ok": False, "detail": str(exc)}, ensure_ascii=False)
            self._send(422, body.encode("utf-8"))
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("prompt llm failed: %s", exc)
            body = json.dumps({
                "ok": False,
                "detail": "提示词模型响应失败：%s" % exc,
            }, ensure_ascii=False)
            self._send(502, body.encode("utf-8"))
            return
        body = json.dumps({
            "ok": True,
            "prompt": result["prompt"],
            "elapsed": result["elapsed"],
            "translated": has_zh,
            "style": style,
            "rating": result.get("rating", "raw"),
            "rating_mode": result.get("rating", "raw"),
            "rating_tag": result.get("rating_tag", ""),
            "engine": PROMPT_LLM["alias"],
            "label": PROMPT_LLM["label"],
            "mode": result["mode"],
            "arch": arch,
            "caption": result["caption"],
            "tags": result["tags"],
            "prefix": result["prefix"],
            "body": result["body"],
            "cached": result["cached"],
            "notes": result.get("notes", []),
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    # ---- 图反推（WD14）：本地 ONNX，CPU 跑，1–2 秒
    def _interrogate_status(self):
        body = json.dumps(interrogate.status(), ensure_ascii=False)
        self._send(200, body.encode("utf-8"), "application/json; charset=utf-8")

    def _interrogate(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 48 * 1024 * 1024:
            self.close_connection = True
            self._send(400, json.dumps({"detail": "请求体为空或过大"}, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, json.dumps({"detail": "参数不是合法 JSON"}, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
            return
        if not isinstance(data, dict):
            self._send(400, json.dumps({"detail": "参数不是合法 JSON"}, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
            return
        blob = b""
        rel = str(data.get("path") or "").strip()
        if rel:
            full, _rel = safe_image_path(rel)
            if not full or not os.path.isfile(full):
                self._send(404, json.dumps({"detail": "图片不存在"}, ensure_ascii=False).encode("utf-8"),
                           "application/json; charset=utf-8")
                return
            try:
                with open(full, "rb") as handle:
                    blob = handle.read()
            except OSError as exc:
                self._send(500, json.dumps({"detail": "读取图片失败：%s" % exc}, ensure_ascii=False).encode("utf-8"),
                           "application/json; charset=utf-8")
                return
        else:
            blob = _b64_bytes(data.get("image"))
        if not blob:
            self._send(400, json.dumps({"detail": "缺少图片"}, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
            return
        try:
            result = interrogate.interrogate(
                blob,
                general_th=float(data.get("general_threshold") or 0.35),
                character_th=float(data.get("character_threshold") or 0.85),
                limit=max(1, min(200, int(data.get("limit") or 40))),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("interrogate failed: %s", exc)
            self._send(502, json.dumps({"detail": "图反推失败：%s" % exc}, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
            return
        self._send(200, json.dumps(result, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _gallery_list(self):
        query = parse_qs(urlparse(self.path).query)

        def first(name, default=""):
            values = query.get(name)
            return values[0] if values else default

        try:
            offset = max(0, int(first("offset", "0")))
        except ValueError:
            offset = 0
        try:
            limit = min(96, max(1, int(first("limit", "48"))))
        except ValueError:
            limit = 48
        mode = first("mode")
        favorite_only = first("favorite") in ("1", "true", "yes")

        with GALLERY_LOCK:
            favorites = load_favorites()
        items = scan_images()
        for item in items:
            if item["folder"] == FAVORITES_DIRNAME:
                # favorites/ 目录本身就是收藏；旧记录只用来恢复原架构与目录。
                item["favorite"] = True
                meta = favorites.get(item["path"]) or {}
                if meta.get("mode") in ("txt2img", "img2img"):
                    item["mode"] = meta["mode"]
            else:
                item["favorite"] = item["path"] in favorites

        counts = {"all": len(items), "txt2img": 0, "img2img": 0, "favorite": 0}
        for item in items:
            counts[item["mode"]] = counts.get(item["mode"], 0) + 1
            if item["favorite"]:
                counts["favorite"] += 1

        filtered = items
        if mode in ("txt2img", "img2img"):
            filtered = [item for item in filtered if item["mode"] == mode]
        if favorite_only:
            filtered = [item for item in filtered if item["favorite"]]
        total = len(filtered)
        page = filtered[offset:offset + limit]
        body = json.dumps({
            "items": page,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(page) < total,
            "counts": counts,
            "root_exists": os.path.isdir(OUTPUT_ROOT),
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _gallery_thumb(self):
        query = parse_qs(urlparse(self.path).query)
        rel = (query.get("path") or [""])[0]
        full, rel = safe_image_path(rel)
        if not full or not os.path.isfile(full):
            self._send(404, b'{"detail":"Image not found"}')
            return
        try:
            st = os.stat(full)
        except OSError as exc:
            self._send(404, json.dumps({"detail": str(exc)}).encode("utf-8"))
            return
        cache_path = thumb_cache_path(rel, st)
        if not os.path.isfile(cache_path):
            if Image is None:
                self._send_file(full, "private, max-age=3600")
                return
            try:
                os.makedirs(THUMB_DIR, exist_ok=True)
                with Image.open(full) as image:
                    image = ImageOps.exif_transpose(image)
                    image.thumbnail((480, 480), Image.Resampling.LANCZOS)
                    if image.mode != "RGB":
                        image = image.convert("RGB")
                    tmp = cache_path + ".%s.%s.tmp" % (os.getpid(), threading.get_ident())
                    image.save(tmp, "JPEG", quality=82, optimize=True)
                os.replace(tmp, cache_path)
            except Exception as exc:  # noqa: BLE001
                log.warning("thumbnail failed %s: %s", rel, exc)
                self._send_file(full, "private, max-age=3600")
                return
        self._send_file(cache_path, "private, max-age=604800")

    def _gallery_file(self):
        query = parse_qs(urlparse(self.path).query)
        rel = (query.get("path") or [""])[0]
        full, rel = safe_image_path(rel)
        if not full or not os.path.isfile(full):
            self._send(404, b'{"detail":"Image not found"}')
            return
        download = (query.get("download") or [""])[0] in ("1", "true", "yes")
        self._send_file(full, "private, max-age=3600", download=download)

    def _gallery_info(self):
        query = parse_qs(urlparse(self.path).query)
        rel = (query.get("path") or [""])[0]
        full, rel = safe_image_path(rel)
        if not full or not os.path.isfile(full):
            self._send(404, b'{"detail":"Image not found"}')
            return
        try:
            st = os.stat(full)
            info = read_gallery_info(full, rel, st)
        except Exception as exc:  # noqa: BLE001
            log.warning("gallery info failed %s: %s", rel, exc)
            body = json.dumps({"ok": False, "detail": "读取生成参数失败：%s" % exc}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))
            return
        payload = {"ok": True, "path": rel}
        payload.update(info)
        self._send(200, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _gallery_favorite(self):
        _invalidate_scan()
        if not self._origin_ok():
            self._send(403, b'{"detail":"Forbidden"}')
            return
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        if isinstance(data.get("paths"), list):
            self._gallery_favorite_batch(data)
            return
        full, rel = safe_image_path(data.get("path"))
        if not full or not os.path.isfile(full):
            self._send(404, b'{"detail":"Image not found"}')
            return
        favorite = bool(data.get("favorite"))
        try:
            with GALLERY_LOCK:
                favorites = load_favorites()
                if favorite:
                    new_rel, moved = favorite_image(rel, full, favorites)
                else:
                    new_rel, moved = unfavorite_image(rel, full, favorites)
                save_favorites(favorites)
        except OSError as exc:
            log.warning("favorite failed %s: %s", rel, exc)
            body = json.dumps({"detail": "收藏操作失败：%s" % exc}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))
            return
        if moved:
            _history_rename(rel, new_rel)
        body = json.dumps({
            "ok": True,
            "path": new_rel,
            "previous": rel,
            "favorite": favorite,
            "moved": moved,
        }, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _gallery_delete(self):
        _invalidate_scan()
        if not self._origin_ok():
            self._send(403, b'{"detail":"Forbidden"}')
            return
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        if isinstance(data.get("paths"), list):
            self._gallery_delete_batch(data)
            return
        full, rel = safe_image_path(data.get("path"))
        if not full or not os.path.isfile(full):
            self._send(404, b'{"detail":"Image not found"}')
            return
        try:
            st = os.stat(full)
            cache_path = thumb_cache_path(rel, st)
            os.remove(full)
        except OSError as exc:
            log.warning("delete failed %s: %s", rel, exc)
            body = json.dumps({"detail": "删除失败：%s" % exc}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))
            return
        try:
            if os.path.isfile(cache_path):
                os.remove(cache_path)
        except OSError:
            pass
        with GALLERY_LOCK:
            favorites = load_favorites()
            if rel in favorites:
                favorites.pop(rel, None)
                save_favorites(favorites)
        log.info("gallery deleted %s", rel)
        _history_remove(rel)
        body = json.dumps({"ok": True, "path": rel}, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _gallery_batch_paths(self, data):
        raw = data.get("paths")
        if not isinstance(raw, list):
            self._send(400, b'{"detail":"paths \\u5fc5\\u9808\\u662f\\u6570\\u7ec4"}')
            return None
        paths = []
        seen = set()
        for item in raw:
            text = str(item or "").replace("\\", "/").strip().lstrip("/")
            if text and text not in seen:
                seen.add(text)
                paths.append(text)
        if not paths:
            self._send(400, b'{"detail":"\\u6ca1\\u6709\\u8981\\u5904\\u7406\\u7684\\u56fe\\u7247"}')
            return None
        if len(paths) > GALLERY_BATCH_MAX:
            body = json.dumps({"detail": "一次最多处理 %d 张" % GALLERY_BATCH_MAX}, ensure_ascii=False)
            self._send(400, body.encode("utf-8"))
            return None
        return paths

    def _gallery_favorite_batch(self, data):
        paths = self._gallery_batch_paths(data)
        if paths is None:
            return
        favorite = bool(data.get("favorite"))
        results = []
        for source in paths:
            full, rel = safe_image_path(source)
            if not full or not os.path.isfile(full):
                results.append({
                    "ok": False,
                    "path": rel or source,
                    "previous": source,
                    "detail": "图片不存在",
                })
                continue
            try:
                with GALLERY_LOCK:
                    favorites = load_favorites()
                    if favorite:
                        new_rel, moved = favorite_image(rel, full, favorites)
                    else:
                        new_rel, moved = unfavorite_image(rel, full, favorites)
                    save_favorites(favorites)
            except OSError as exc:
                log.warning("batch favorite failed %s: %s", rel, exc)
                results.append({
                    "ok": False,
                    "path": rel,
                    "previous": rel,
                    "detail": str(exc),
                })
                continue
            if moved:
                _history_rename(rel, new_rel)
            results.append({
                "ok": True,
                "path": new_rel,
                "previous": rel,
                "favorite": favorite,
                "moved": moved,
            })
        body = json.dumps({"ok": True, "results": results}, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _gallery_delete_batch(self, data):
        paths = self._gallery_batch_paths(data)
        if paths is None:
            return
        results = []
        for source in paths:
            full, rel = safe_image_path(source)
            if not full or not os.path.isfile(full):
                results.append({
                    "ok": False,
                    "path": rel or source,
                    "previous": source,
                    "detail": "图片不存在",
                })
                continue
            try:
                st = os.stat(full)
                cache_path = thumb_cache_path(rel, st)
                os.remove(full)
            except OSError as exc:
                log.warning("batch delete failed %s: %s", rel, exc)
                results.append({
                    "ok": False,
                    "path": rel,
                    "previous": rel,
                    "detail": str(exc),
                })
                continue
            try:
                if os.path.isfile(cache_path):
                    os.remove(cache_path)
            except OSError:
                pass
            with GALLERY_LOCK:
                favorites = load_favorites()
                if rel in favorites:
                    favorites.pop(rel, None)
                    save_favorites(favorites)
            log.info("gallery deleted %s", rel)
            _history_remove(rel)
            results.append({"ok": True, "path": rel, "previous": rel})
        body = json.dumps({"ok": True, "results": results}, ensure_ascii=False)
        self._send(200, body.encode("utf-8"))

    def _gallery_export(self):
        data = self._read_json()
        if data is None:
            self._reject_json()
            return
        paths = self._gallery_batch_paths(data)
        if paths is None:
            return
        files = []
        total = 0
        skipped = 0
        for source in paths:
            full, rel = safe_image_path(source)
            if not full or not os.path.isfile(full):
                skipped += 1
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                skipped += 1
                continue
            total += size
            if total > GALLERY_EXPORT_MAX_BYTES:
                body = json.dumps({"detail": "导出内容超过 500 MB，请分批导出"}, ensure_ascii=False)
                self._send(413, body.encode("utf-8"))
                return
            files.append((full, rel))
        if not files:
            self._send(404, b'{"detail":"Selected images not found"}')
            return
        stamp = time.strftime("%Y%m%d-%H%M")
        name = "KlockUI-作品-%s.zip" % stamp
        export_root = os.path.join(CACHE_DIR, "exports")
        tmp_dir = ""
        try:
            os.makedirs(export_root, exist_ok=True)
            tmp_dir = tempfile.mkdtemp(prefix="export-", dir=export_root)
            zip_path = os.path.join(tmp_dir, name)
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for full, rel in files:
                    archive.write(full, arcname=rel)
        except OSError as exc:
            log.warning("export failed: %s", exc)
            if tmp_dir:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            body = json.dumps({"detail": "打包失败：%s" % exc}, ensure_ascii=False)
            self._send(500, body.encode("utf-8"))
            return
        log.info("gallery export %d files (%d skipped)", len(files), skipped)
        try:
            self._send_file(zip_path, download=True)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def _proxy(self, method, path, data):
        handled = comfy_bridge.dispatch(method, path, data or b"")
        if handled is not None:
            code, body, ctype = handled
            self._send(code, body, ctype)
            return
        url = FORGE + path
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=900) as resp:
                self._send(resp.status, resp.read(), resp.headers.get("Content-Type") or "application/json")
        except urllib.error.HTTPError as exc:
            body = exc.read()
            log.warning("upstream %s %s -> %s", method, path, exc.code)
            self._send(exc.code, body, exc.headers.get("Content-Type") or "application/json")
        except Exception as exc:  # noqa: BLE001
            log.warning("proxy error %s %s: %s", method, path, exc)
            body = json.dumps({"detail": "引擎未启动或连接失败：%s" % exc}, ensure_ascii=False)
            self._send(502, body.encode("utf-8"))


def main():
    migrate_favorites()
    # 访问密码已移除：不再读取 auth.json，也不会因为缺文件而拒服务。
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    if IDLE_UNLOAD_SECONDS > 0:
        threading.Thread(target=_idle_unload_loop, daemon=True, name="idle-unload").start()
        log.info("idle unload enabled: %ss", IDLE_UNLOAD_SECONDS)
    if PROMPT_LLM_IDLE_SECONDS > 0:
        threading.Thread(target=_prompt_idle_loop, daemon=True, name="prompt-idle").start()
        log.info("prompt LLM idle exit: %ss", PROMPT_LLM_IDLE_SECONDS)
    log.info("KlockUI listening on http://127.0.0.1:%s", PORT)
    print("KlockUI on http://127.0.0.1:%d" % PORT, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    if "--set-password" in sys.argv[1:]:
        print("访问密码功能已移除（2026-11-15）。直接运行 python server.py 即可。")
    else:
        main()

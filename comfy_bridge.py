#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""KlockUI -> ComfyUI 深度适配层（Forge/A1111 API 兼容 + 工作流优化）。

设计目标：KlockUI 的 server.py 与前端 app.js 仍说 Forge 的 /sdapi/v1/* 方言，
本模块把这些请求翻译成 ComfyUI 0.45.0 的工作流 API，并把结果包装回 A1111
格式（{images:[base64], info:"..."}），前端 8000+ 行业务代码无需改动。

相对"最小兼容层"的深度适配：
  1. Hires 按 hr_upscaler 分流：Lanczos/Nearest -> 像素放大（VAEDecode +
     ImageScale + VAEEncode），Latent* -> 潜空间放大。与 KlockUI 默认
     DEFAULT_UPSCALER="Lanczos" 的语义一致（上一版固定 Latent 是错的）。
  2. CLIP skip -> CLIPSetLastLayer（SDXL 生效；Anima 的 LLM 编码器不适用）。
  3. VAE 覆盖：override_settings.forge_additional_modules 里指定的 VAE 生效。
  4. img2img 按 resize_mode 对齐到目标尺寸，避免尺寸不符导致的构图漂移。
  5. 真实进度：WebSocket /ws 订阅 progress/executing 事件，不再是时间估算。
  6. 动态超时（按步数与架构），切模型按可用内存决定是否卸载。
  7. 节点错误可读化，ComfyUI 未启动/超时给出明确中文提示。

引擎：http://127.0.0.1:8188（仅本机）
模型：D:/AI/models 硬链接挂载，见 ComfyUI/extra_model_paths.yaml
"""
import base64
import glob
import io
import json
import logging
import os
import random
import re
import secrets
import socket
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

try:
    from PIL import Image
except Exception:  # noqa: BLE001
    Image = None

log = logging.getLogger("comfy_bridge")

BASE = os.environ.get("KLOCK_COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
HOST, PORT = "127.0.0.1", 8188
try:
    _parsed = urllib.parse.urlparse(BASE)
    HOST = _parsed.hostname or HOST
    PORT = _parsed.port or PORT
except Exception:  # noqa: BLE001
    pass

# 本机有全局 http_proxy，访问回环地址必须绕过，否则 502。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CLIENT_ID = str(uuid.uuid4())

# 模型根目录：优先环境变量，其次仓库同级 / 内部的 models 目录。
# 以前这里写死 D:/AI/models，换台机器克隆下来就找不到模型。
def _detect_models_root():
    env = os.environ.get("KLOCK_MODELS_ROOT")
    if env:
        return os.path.abspath(os.path.expanduser(env))
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (
        os.path.join(os.path.dirname(here), "models"),
        os.path.join(here, "models"),
        os.path.join(os.path.dirname(here), "ComfyUI", "models"),
    ):
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(here, "models")


MODELS_ROOT = _detect_models_root()
# 统一模型库：DiT 族全部在 diffusion_models，整模型只在 checkpoints。
DIFF_DIR = os.environ.get("KLOCK_DIFFUSION_DIR") or os.path.join(MODELS_ROOT, "diffusion_models")
CKPT_DIR = os.environ.get("KLOCK_CHECKPOINT_DIR") or os.path.join(MODELS_ROOT, "checkpoints")
ANIMA_DIR = DIFF_DIR   # 兼容旧引用
SDXL_DIR = CKPT_DIR    # 兼容旧引用
LORA_DIR = os.environ.get("KLOCK_LORA_DIR") or os.path.join(MODELS_ROOT, "loras")
UPSCALE_DIR = os.environ.get("KLOCK_UPSCALE_DIR") or os.path.join(MODELS_ROOT, "upscale_models")
TE_DIR = os.environ.get("KLOCK_TE_DIR") or os.path.join(MODELS_ROOT, "text_encoders")
VAE_DIR = os.environ.get("KLOCK_VAE_DIR") or os.path.join(MODELS_ROOT, "vae")

ANIMA_TE = "qwen_3_06b_base.safetensors"
ANIMA_VAE = "qwen_image_vae.safetensors"

# MOSS-Image 5B：DiT 在 ComfyUI 自己的 diffusion_models 里，
# 编码器是 Qwen3.5-9B w4a8（7GB），VAE 是 FLUX.2 小 VAE（128ch latent）。
MOSS_DIR = DIFF_DIR
MOSS_TE = "qwen3.5_9b_w4a8_gptq.safetensors"
MOSS_VAE = "flux2-vae_small.safetensors"

# Krea 2：12.9B dense DiT + Qwen3-VL-4B 编码器（CLIPLoader 必须用 type="krea2"）
# + Qwen-Image VAE（与 Anima 共用同一份）。Turbo 是 8 步蒸馏，CFG 1。
KREA_TE = "qwen3vl_4b_fp8_scaled.safetensors"
KREA_VAE = ANIMA_VAE
# 风格参考 LoRA：把参考图的画风/色调搬到新图上。必须配专用采样图
# （ModelSamplingFlux + FluxKontextMultiReferenceLatentMethod + SamplerCustomAdvanced），
# 普通文生图挂上不起作用。
KREA_STYLE_LORA = "krea2_style_reference.safetensors"

# Z-Image Turbo（阿里通义）：6B 单流 S3-DiT + Qwen3-4B 编码器（CLIPLoader type="lumina2"）
# + FLUX 的 ae VAE（16ch）。官方模板：ModelSamplingAuraFlow shift=3、
# res_multistep + simple、Turbo 9 步 / CFG 1（Base 才是 25–50 步 / CFG 4）。
ZIMAGE_TE = "qwen_3_4b_fp8_mixed.safetensors"
ZIMAGE_VAE = "ae.safetensors"

# 统一在这里维护，别在多处手写元组（漏一个就会被静默改写）。
ALLOWED_ARCHS = ("anima", "sdxl", "moss", "krea", "zimage")

SAMPLER_MAP = {
    "euler": "euler", "euler a": "euler_ancestral", "er sde": "er_sde",
    "res multistep": "res_multistep", "dpm++ 2m": "dpmpp_2m",
    "dpm++ 2m sde": "dpmpp_2m_sde", "dpm++ sde": "dpmpp_sde",
    "dpm++ 2m sde gpu": "dpmpp_2m_sde_gpu", "unipc": "uni_pc",
    "ddim": "ddim", "lms": "lms", "heun": "heun",
}
SCHEDULER_MAP = {
    "sgm uniform": "sgm_uniform", "karras": "karras", "simple": "simple",
    "exponential": "exponential", "beta": "beta", "beta57": "beta",
    "linear quadratic": "linear_quadratic", "normal": "normal",
    "ddim uniform": "ddim_uniform", "kl optimal": "kl_optimal",
}
PIXEL_UPSCALERS = {
    "lanczos": "lanczos", "nearest": "nearest-exact", "nearest-exact": "nearest-exact",
    "bicubic": "bicubic", "bilinear": "bilinear", "area": "area",
}

VALID_SAMPLERS = set()
VALID_SCHEDULERS = set()

_STATE_LOCK = threading.Lock()
# 不再写死某个模型名：迁移前那句 oneObsessionAnima_v30 早被删了，写死的结果是
# 每次重启界面都顶着一个不存在的模型（列表里 4 个可用却一个都不高亮）。
# 留空 → 首次查询时按实际目录挑一个（Krea 优先），文件被删也会自动换。
_CURRENT_MODEL = ""
_CURRENT_ARCH = ""
_JOB_START = 0.0
_JOB_STEPS = 20
_JOB_INDEX = 0      # 本批第几张（0 基），前端显示「第 N/总数 张」
_JOB_COUNT = 1      # 本批总张数（n_iter）
_CLASSIFY_CACHE = {}


class EngineError(RuntimeError):
    pass


# ---------------------------------------------------------------- HTTP
def _open(req, timeout=60):
    return OPENER.open(req, timeout=timeout)


def _get_json(path, timeout=30):
    with _open(BASE + path, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_json(path, obj, timeout=60):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with _open(req, timeout) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8")) if raw else {}


def _ping():
    try:
        with _open(BASE + "/system_stats", 3) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001
        return False


def _object_info_names():
    global VALID_SAMPLERS, VALID_SCHEDULERS
    if VALID_SAMPLERS:
        return
    try:
        info = _get_json("/object_info/KSampler", timeout=15)
        required = info["KSampler"]["input"]["required"]
        VALID_SAMPLERS = set(required["sampler_name"][0])
        VALID_SCHEDULERS = set(required["scheduler"][0])
    except Exception:  # noqa: BLE001
        VALID_SAMPLERS = set(SAMPLER_MAP.values())
        VALID_SCHEDULERS = set(SCHEDULER_MAP.values())


# ---------------------------------------------------------------- 进度 WebSocket
class _ProgressWS(threading.Thread):
    """订阅 ComfyUI /ws，拿真实采样步数，替代时间估算。断线自动重连。"""

    def __init__(self):
        super().__init__(name="comfy-progress-ws", daemon=True)
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()
        self._sock = None
        self._buf = b""
        self._progress_state = {"value": 0, "max": 0, "base": 0, "prompt_id": None,
                       "executing": False, "node": None, "connected": False,
                       "preview": "", "preview_seq": 0}

    def stop(self):
        self._stop_event.set()
        try:
            if self._sock:
                self._sock.close()
        except Exception:  # noqa: BLE001
            pass

    def snapshot(self):
        with self._state_lock:
            return dict(self._progress_state)

    def _set(self, **kw):
        with self._state_lock:
            self._progress_state.update(kw)

    def take_preview(self):
        """取走最新预览图（base64），取一次即清空。

        保留给旧调用方；新代码用 peek_preview()：预览改为粘性后，
        轮询晚到不会丢帧，前端用序号去重即可。
        """
        with self._state_lock:
            value = self._progress_state.get("preview") or ""
            self._progress_state["preview"] = ""
        return value

    def peek_preview(self):
        """读取最新预览图与序号，不清空。序号每次新帧 +1，供前端去重。"""
        with self._state_lock:
            return (self._progress_state.get("preview") or "",
                    int(self._progress_state.get("preview_seq") or 0))

    def _on_binary(self, payload):
        """ComfyUI 每步预览走二进制帧。

        布局：4 字节事件类型 + 图片数据；PREVIEW_IMAGE 的图片数据前还有 4 字节格式号
        （1=JPEG / 2=PNG），PREVIEW_IMAGE_WITH_METADATA 则是「4 字节元数据长度 + JSON + 图片」。
        """
        if len(payload) < 8:
            return
        event = struct.unpack(">I", payload[:4])[0]
        body = payload[4:]
        image = b""
        if event == 1:  # PREVIEW_IMAGE
            if len(body) < 5:
                return
            kind = struct.unpack(">I", body[:4])[0]
            if kind not in (1, 2):
                return
            image = body[4:]
        elif event == 4:  # PREVIEW_IMAGE_WITH_METADATA
            if len(body) < 4:
                return
            meta_len = struct.unpack(">I", body[:4])[0]
            if len(body) < 4 + meta_len:
                return
            image = body[4 + meta_len:]
        else:
            return
        if image:
            seq = int(self._progress_state.get("preview_seq") or 0) + 1
            self._set(preview=base64.b64encode(image).decode("ascii"), preview_seq=seq)

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self._sock.recv(max(4096, n - len(self._buf)))
            if not chunk:
                return None
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _send_frame(self, opcode, payload):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", length)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._sock.sendall(header + mask + masked)

    def _on_message(self, msg):
        kind = msg.get("type")
        data = msg.get("data") or {}
        if kind == "progress":
            value = int(data.get("value") or 0)
            maximum = int(data.get("max") or 0)
            prev = self.snapshot()
            # hires 第二段会重置 value；把上一段步数累加，让进度单调递增。
            base = int(prev.get("base") or 0)
            if value <= int(prev.get("value") or 0) and int(prev.get("max") or 0) > 0:
                base += int(prev.get("max") or 0)
            self._set(value=value, max=maximum, base=base,
                      prompt_id=data.get("prompt_id"), executing=True,
                      node=data.get("node"))
        elif kind == "execution_start":
            self._set(executing=True, value=0, max=0, base=0,
                      prompt_id=data.get("prompt_id"), preview="")
        elif kind == "executing":
            if data.get("node") is None:
                self._set(executing=False)
        elif kind == "execution_error":
            self._set(executing=False)

    def _read_loop(self):
        while not self._stop_event.is_set():
            head = self._recv_exact(2)
            if not head:
                return
            opcode = head[0] & 0x0F
            masked = head[1] & 0x80
            length = head[1] & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else None
            payload = self._recv_exact(length) if length else b""
            if payload is None:
                return
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x1:
                try:
                    self._on_message(json.loads(payload.decode("utf-8", "replace")))
                except Exception:  # noqa: BLE001
                    pass
            elif opcode == 0x2:
                try:
                    self._on_binary(payload)
                except Exception:  # noqa: BLE001
                    pass
            elif opcode == 0x9:
                self._send_frame(0xA, payload)
            elif opcode == 0x8:
                return

    def run(self):
        while not self._stop_event.is_set():
            try:
                self._sock = socket.create_connection((HOST, PORT), timeout=5)
                key = base64.b64encode(os.urandom(16)).decode("ascii")
                request = (
                    "GET /ws?clientId=%s HTTP/1.1\r\nHost: %s:%d\r\n"
                    "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                    "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                    % (CLIENT_ID, HOST, PORT, key)
                )
                self._sock.sendall(request.encode("ascii"))
                head = b""
                while b"\r\n\r\n" not in head:
                    chunk = self._sock.recv(1024)
                    if not chunk:
                        break
                    head += chunk
                if b" 101 " not in head.split(b"\r\n")[0]:
                    raise RuntimeError("websocket handshake rejected")
                # 握手响应可能与首个 status 帧同包到达，残余字节必须保留。
                split = head.find(b"\r\n\r\n")
                self._buf = head[split + 4:] if split >= 0 else b""
                # 读循环必须阻塞等待；沿用 5s 连接超时会被误判为断线。
                self._sock.settimeout(None)
                self._set(connected=True)
                self._read_loop()
            except Exception:  # noqa: BLE001
                pass
            finally:
                self._set(connected=False)
                self._buf = b""
                try:
                    if self._sock:
                        self._sock.close()
                except Exception:  # noqa: BLE001
                    pass
                self._sock = None
            if not self._stop_event.is_set():
                self._stop_event.wait(3.0)


_WS = _ProgressWS()


def start_progress_ws():
    if not _WS.is_alive():
        _WS.start()


# ---------------------------------------------------------------- 模型
def _stem(name):
    base = os.path.basename(str(name or "").replace("\\", "/"))
    for ext in (".safetensors", ".ckpt", ".pt"):
        if base.lower().endswith(ext):
            return base[: -len(ext)]
    return base


def _checkpoint_path(name):
    stem = _stem(name)
    for folder in (DIFF_DIR, CKPT_DIR):
        candidate = os.path.join(folder, stem + ".safetensors")
        if os.path.isfile(candidate):
            return candidate
    return None


def _classify(path):
    key = (path, os.path.getsize(path))
    if key in _CLASSIFY_CACHE:
        return _CLASSIFY_CACHE[key]
    arch = "unknown"
    try:
        with open(path, "rb") as fh:
            size = struct.unpack("<Q", fh.read(8))[0]
            if 0 < size <= 64 * 1024 * 1024:
                header = json.loads(fh.read(size).decode("utf-8", "replace"))
        keys = [k for k in header if k != "__metadata__"]
        if any(k.endswith("shared_block_modulation.weight") for k in keys) and any(
                k.endswith("layers.0.proj.ffn_up_gate.weight") for k in keys):
            arch = "moss"
        elif any("llm_adapter.blocks.0.cross_attn.q_proj.weight" in k for k in keys):
            arch = "anima"
        elif any("txtfusion.projector.weight" in k for k in keys):
            # Krea 2 的 12.9B 单流 DiT 特征权重（ComfyUI model_detection 同款判据）。
            arch = "krea"
        elif any(k == "cap_embedder.0.weight" for k in keys) and any(
                k.startswith("noise_refiner.") for k in keys):
            # Z-Image 的 S3-DiT 特征：caption 投影 + 噪点细化分支（Lumina2 系但没有 llm_adapter）。
            arch = "zimage"
        elif any(k.startswith("conditioner.") or k.startswith("first_stage_model.")
                 or "input_blocks." in k for k in keys):
            arch = "sdxl"
    except Exception:  # noqa: BLE001
        pass
    _CLASSIFY_CACHE[key] = arch
    return arch


def _arch_for(name):
    path = _checkpoint_path(name)
    return _classify(path) if path else "unknown"


def _model_filenames():
    return sorted(set(
        [os.path.basename(p) for p in glob.glob(os.path.join(DIFF_DIR, "*.safetensors"))] +
        [os.path.basename(p) for p in glob.glob(os.path.join(CKPT_DIR, "*.safetensors"))]
    ))


def _modules_for(arch):
    if arch == "anima":
        return [ANIMA_TE, ANIMA_VAE]
    if arch == "moss":
        return [MOSS_TE, MOSS_VAE]
    if arch == "zimage":
        return [ZIMAGE_TE, ZIMAGE_VAE]
    return []


def _pick_default_model():
    """按实际存在的文件挑一个默认模型。

    顺序：Krea Turbo → 其它 Krea → Anima → MOSS → 第一个。
    特意让 "turbo" 排在前面：Noct 那类无审查微调整模型体积一样大（12.5GB），
    但它是"换口味"用的，不该在每次冷启动时悄悄成为默认底模。
    """
    files = _model_filenames()
    if not files:
        return ""
    lowered = [(name, name.lower()) for name in files]
    for want, want2 in (("krea", "turbo"), ("krea", None), ("anima", None), ("moss", None)):
        for name, low in lowered:
            if want in low and (want2 is None or want2 in low):
                return name
    return files[0]


def _ensure_current_model():
    """保证 _CURRENT_MODEL 一定指向磁盘上真实存在的文件。

    模型删掉后如果还留在状态里，前端会把它当"当前模型"顶在标题上，
    而列表里又找不到它——用户看到的就是"一个不存在的模型"。
    """
    global _CURRENT_MODEL, _CURRENT_ARCH
    with _STATE_LOCK:
        stored, stored_arch = _CURRENT_MODEL, _CURRENT_ARCH
    if stored and _checkpoint_path(stored):
        return stored
    picked = _pick_default_model()
    with _STATE_LOCK:
        if picked:
            if stored:
                log.warning("current model %s no longer exists, fallback to %s",
                            stored, picked)
            _CURRENT_MODEL = picked
            _CURRENT_ARCH = _arch_for(picked)
        else:
            _CURRENT_MODEL, _CURRENT_ARCH = "", ""
    return picked


def current_model():
    return _ensure_current_model()


def current_arch():
    _ensure_current_model()
    with _STATE_LOCK:
        return _CURRENT_ARCH


def resolve_model_file(name):
    """把「模型名」规整成 ComfyUI 认的文件名。

    调用方可能给不带扩展名的 stem（界面里的 activeModel 就是），
    也可能给带 .safetensors 的完整名。ComfyUI 的 UNETLoader 只认清单里的
    完整文件名，少个后缀就报 value_not_in_list。
    """
    raw = str(name or "").strip()
    if not raw:
        return raw
    if raw.lower().endswith(".safetensors") and raw in _model_filenames():
        return raw
    stem = _stem(raw)
    for filename in _model_filenames():
        if _stem(filename) == stem:
            return filename
    # 清单里没有就原样返回，让 ComfyUI 自己报错，别静默换成别的模型
    return raw


def set_model(name):
    global _CURRENT_MODEL, _CURRENT_ARCH
    name = resolve_model_file(name)
    path = _checkpoint_path(name)
    if not path:
        return None
    arch = _classify(path)
    with _STATE_LOCK:
        _CURRENT_MODEL = _stem(name) + ".safetensors"
        _CURRENT_ARCH = arch
    return arch


# ---------------------------------------------------------------- 参数解析
def _map_sampler(name):
    _object_info_names()
    raw = str(name or "Euler").strip()
    value = SAMPLER_MAP.get(raw.lower(), raw.lower().replace(" ", "_"))
    if value not in VALID_SAMPLERS:
        # 不静默：ComfyUI 里没有这个采样器就明说，日志和 info 都会带实际值。
        log.info("sampler unsupported by ComfyUI: %s -> euler", raw)
        return "euler"
    return value


# A1111 的 "Automatic" 表示交给采样器自己选调度器。
# ComfyUI 没有等价的自动机制，这里按采样器家族给一个确定答案，避免被静默吞成 sgm_uniform。
AUTO_SCHEDULER_BY_SAMPLER = {
    "dpmpp_2m": "karras",
    "dpmpp_2m_sde": "karras",
    "dpmpp_sde": "karras",
    "ddim": "ddim_uniform",
    "uni_pc": "beta",
    "er_sde": "simple",
    "res_multistep": "simple",
    "euler": "normal",
    "euler_ancestral": "normal",
}


def _map_scheduler(name, sampler=None):
    _object_info_names()
    raw = str(name or "SGM Uniform").strip()
    key = raw.lower()
    if key in ("automatic", "auto"):
        pick = AUTO_SCHEDULER_BY_SAMPLER.get(sampler or "", "normal")
        if pick not in VALID_SCHEDULERS:
            pick = "normal" if "normal" in VALID_SCHEDULERS else "sgm_uniform"
        return pick
    value = SCHEDULER_MAP.get(key, key.replace(" ", "_"))
    if value not in VALID_SCHEDULERS:
        log.info("scheduler unsupported by ComfyUI: %s -> sgm_uniform", raw)
        return "sgm_uniform"
    return value


LORA_RE = re.compile(r"<\s*lora\s*:\s*([^:>]+?)\s*:\s*([-+]?[\d.]+)\s*>", re.I)

# ComfyUI 0.45 原生 MOSSImageLayoutPrompt 节点输出的其实就是下面这个 JSON 字符串，
# 直接拼出来塞进 CLIPTextEncode 即可，不需要 CreateBoundingBoxes 画布节点。
# 语法：@box x0,y0,x1,y1 | 描述   （0-100 百分比，左上 -> 右下）
#       @text x0,y0,x1,y1 | 招牌文字
LAYOUT_BOX_RE = re.compile(
    r"^[ \t]*@(?P<kind>box|text)[ \t]+"
    r"(?P<x0>\d+(?:\.\d+)?)[ \t]*,[ \t]*"
    r"(?P<y0>\d+(?:\.\d+)?)[ \t]*,[ \t]*"
    r"(?P<x1>\d+(?:\.\d+)?)[ \t]*,[ \t]*"
    r"(?P<y1>\d+(?:\.\d+)?)[ \t]*\|[ \t]*(?P<caption>.+?)[ \t]*$",
    re.M,
)
LAYOUT_PERSON_RE = re.compile(
    r"女孩|少女|女子|女人|女性|男孩|少年|男子|男人|男性|人物|孩子|老人|小孩|"
    r"\b(girl|boy|woman|man|person|character|child|lady|guy)s?\b", re.I)


def _moss_layout_prompt(prompt, width, height):
    """把提示词里的 @box 行翻译成 MOSS 原生布局 JSON。

    坐标用 0-100 百分比写，转换成 MOSS 期望的 abs_centralized / yxyx 像素坐标
    （原点在画布中心，y 向下、x 向右）。没有 @box 时原样返回，零开销。
    """
    items = []
    captions = []

    def take(match):
        x0, y0 = float(match.group("x0")), float(match.group("y0"))
        x1, y1 = float(match.group("x1")), float(match.group("y1"))
        caption = match.group("caption").strip()
        if not caption:
            return ""
        # 百分比 -> 像素，再平移到以画布中心为原点的坐标系。
        bbox = [
            int(round(y0 * height / 100 - height / 2)),
            int(round(x0 * width / 100 - width / 2)),
            int(round(y1 * height / 100 - height / 2)),
            int(round(x1 * width / 100 - width / 2)),
        ]
        item = {"label": "text" if match.group("kind") == "text" else
                ("character" if LAYOUT_PERSON_RE.search(caption) else "object"),
                "caption": caption, "bbox": bbox}
        if item["label"] == "text":
            item["text"] = caption
        items.append(item)
        captions.append(caption)
        return ""

    summary = re.sub(r"\n[ \t]*\n+", "\n", LAYOUT_BOX_RE.sub(take, str(prompt or ""))).strip()
    if not items:
        return str(prompt or ""), 0
    if not summary:
        summary = "，".join(captions)
    layout = {
        "summary": {"caption": summary},
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(layout, ensure_ascii=False, separators=(",", ":")), len(items)


def _extract_loras(prompt):
    found = []
    for match in LORA_RE.finditer(prompt):
        name = match.group(1).strip()
        try:
            weight = float(match.group(2))
        except ValueError:
            continue
        path = os.path.join(LORA_DIR, name + ".safetensors")
        if not os.path.isfile(path):
            hits = [p for p in glob.glob(os.path.join(LORA_DIR, "*.safetensors"))
                    if name.lower() in _stem(p).lower()]
            if not hits:
                log.info("lora not found, skipped: %s", name)
                continue
            name = _stem(sorted(hits, key=lambda p: len(_stem(p)))[0])
        found.append((name + ".safetensors", max(-2.0, min(2.0, weight))))
    return LORA_RE.sub("", prompt).strip(), found


def _resolve_vae(payload):
    """解析要用的 VAE 文件名；返回 None 表示跟随当前架构的默认 VAE。

    优先读 A1111 原生的 payload["vae"]（"Automatic"/空 视为跟随底模），
    再退回 Forge 方言的 override_settings.forge_additional_modules。
    ComfyUI 里编码器与 VAE 是分开加载的，所以自定义 VAE 对任何架构都该生效。
    """
    name = os.path.basename(str(payload.get("vae") or "").replace("\\", "/")).strip()
    if name and name.lower().endswith(".safetensors"):
        if os.path.isfile(os.path.join(VAE_DIR, name)):
            return name
    modules = (payload.get("override_settings") or {}).get("forge_additional_modules") or []
    if not isinstance(modules, list):
        return None
    for item in modules:
        name = os.path.basename(str(item or "").replace("\\", "/"))
        if name.lower().endswith(".safetensors") and os.path.isfile(os.path.join(VAE_DIR, name)):
            return name
    return None


def _clip_skip(payload):
    try:
        value = int((payload.get("override_settings") or {}).get("CLIP_stop_at_last_layers") or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(12, value))


def _never_oom(payload):
    """A1111 的 Never OOM 扩展参数 -> ComfyUI 的显存释放。

    Forge 里它是分块推理开关；ComfyUI 的分块由 DynamicVRAM 自动做，等价物是
    本轮跑完调 /free 把显存缓存还给系统：牺牲一点下一轮的重载时间，换 OOM 保底。
    """
    scripts = payload.get("alwayson_scripts") or {}
    if not isinstance(scripts, dict):
        return False
    entry = scripts.get("Never OOM Integrated") or scripts.get("NeverOOM")
    if not isinstance(entry, dict):
        return False
    args = entry.get("args")
    if isinstance(args, list) and args:
        return bool(args[0])
    return False


def _hires_model_name(hr_upscaler):
    """hr_upscaler 是不是本地已装的 AI 超分模型；是就返回真实文件名。"""
    name = os.path.basename(str(hr_upscaler or "").replace("\\", "/"))
    if name and name in _upscale_model_names():
        return name
    return None


def _hr_mode(hr_upscaler):
    raw = str(hr_upscaler or "Lanczos").strip().lower()
    if raw.startswith("latent"):
        return "latent", "nearest-exact"
    # 超分模型以前走到最后那行，静默退化成 bicubic——选了 UltraSharp 却拿到
    # 模糊的插值，最坑。现在单独识别成 model 模式，真跑 UpscaleModelLoader。
    model = _hires_model_name(hr_upscaler)
    if model:
        return "model", model
    for key, method in PIXEL_UPSCALERS.items():
        if raw.startswith(key):
            return "pixel", method
    # ESRGAN 等未安装模型：退化为像素 bicubic，避免直接失败。
    return "pixel", "bicubic"


def _timeout_for(payload, arch):
    try:
        steps = int(payload.get("steps") or 20)
    except (TypeError, ValueError):
        steps = 20
    # Krea 2 是 12.9B，8GB 显存下会大量 offload，单步比 MOSS 慢得多，超时给足。
    per_step = 8.0 if arch == "krea" else (3.0 if arch in ("sdxl", "moss") else 2.2)
    total = steps * per_step + 150
    if payload.get("enable_hr"):
        total += max(8, steps // 2) * per_step
    return int(max(180, min(1800, total)))


def _format_errors(node_errors):
    parts = []
    for node_id, payload in (node_errors or {}).items():
        if not isinstance(payload, dict):
            continue
        cls = payload.get("class_type") or node_id
        for err in payload.get("errors") or []:
            parts.append("%s(%s): %s" % (cls, node_id, err.get("message") or err.get("type") or "error"))
    return "; ".join(parts)[:600]


# ---------------------------------------------------------------- 工作流
def _add_loras(graph, loras, model_link, clip_link, start_id=100, model_only=False):
    """串联 LoRA 节点。

    model_only=True 时改用 LoraLoaderModelOnly：Krea 2 的 LoRA 是 DiT-only
    （官方 9 个风格 LoRA 与 style_reference 都只打 diffusion_model.*），
    编码器分支没有任何 key。用双端 LoraLoader 会给 clip 应用一次空 patch，
    既多克隆一份 CLIP 权重，也会刷一屏 "lora key not loaded" 警告。
    """
    node_id = start_id
    for lora_name, strength in loras:
        if model_only:
            graph[str(node_id)] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"model": model_link, "lora_name": lora_name,
                           "strength_model": strength},
            }
            model_link = [str(node_id), 0]
        else:
            graph[str(node_id)] = {
                "class_type": "LoraLoader",
                "inputs": {"model": model_link, "clip": clip_link, "lora_name": lora_name,
                           "strength_model": strength, "strength_clip": strength},
            }
            model_link = [str(node_id), 0]
            clip_link = [str(node_id), 1]
        node_id += 1
    return model_link, clip_link


def _apply_step_cache(graph, threshold=0.2, node_type="EasyCache"):
    """在 KSampler 前插入 ComfyUI 原生跳步缓存节点（EasyCache / LazyCache）。

    实测 MOSS SFT 25 步 768²：基线 22.5–28.7s，EasyCache 0.2 约 13s，
    PSNR 33.6dB（肉眼几乎无差）。多个 KSampler（Hires 二采）共享同一个节点。
    只在 generate() 里做后处理，不动三个架构分支的构图逻辑。
    """
    if node_type not in ("EasyCache", "LazyCache"):
        node_type = "EasyCache"
    samplers = [(key, node) for key, node in graph.items()
                if node.get("class_type") == "KSampler"
                and isinstance(node.get("inputs", {}).get("model"), list)]
    if not samplers:
        return graph
    links = {tuple(node["inputs"]["model"]) for _, node in samplers}
    if len(links) != 1:
        return graph  # 模型链路不一致就不动，避免接错
    model_link = list(links.pop())
    node_id = str(max([int(k) for k in graph if str(k).isdigit()] + [0]) + 1)
    graph[node_id] = {"class_type": node_type, "inputs": {
        "model": model_link,
        "reuse_threshold": max(0.0, min(3.0, float(threshold))),
        "start_percent": 0.15,
        "end_percent": 0.95,
        "verbose": False,
    }}
    for _, node in samplers:
        node["inputs"]["model"] = [node_id, 0]
    return graph


def _mask_grow(payload):
    """蒙版外扩像素数：默认 8，宁可小不要大。

    实测教训：扩到 20px 时，如果蒙版上边界本来压在头发上，扩出去的这一圈
    会把头顶也卷进重绘区，模型在里面重新生成了一个头顶——直接出「双头」。
    8px 只够埋掉硬边，不会越界吃结构；剩下的靠用户把蒙版涂准。
    """
    try:
        return max(0, min(48, int(payload.get("klock_mask_grow") or 8)))
    except (TypeError, ValueError):
        return 8


def _apply_inpaint_mask(graph, latent_link, mask_file, grow=8, start_id=200):
    """局部重绘：只让蒙版区域参与去噪，蒙版外原样保留。

    链路（ComfyUI 社区主流做法，比 VAEEncodeForInpaint 更可控）：
        LoadImageMask(黑白蒙版, channel=red)  白色=重绘，黑色=保留
        -> GrowMask(expand)                   边缘外扩/羽化，避免接缝
        -> SetLatentNoiseMask(latent, mask)   关键节点：只在蒙版内加噪
    之后 KSampler 用 denoise 1.0 也不会动蒙版外的内容——
    因为噪声只铺在蒙版里，采样器没有可改的起点。

    VAEEncodeForInpaint 虽然更"融合"，但它会按蒙版周围的颜色统计重填，
    经常出现色块和糊，做修手/换衣服反而不如这条干净。
    """
    if not mask_file:
        return latent_link
    graph[str(start_id)] = {"class_type": "LoadImageMask", "inputs": {
        "image": mask_file, "channel": "red"}}
    graph[str(start_id + 1)] = {"class_type": "GrowMask", "inputs": {
        "mask": [str(start_id), 0], "expand": int(grow), "tapered_corners": True}}
    graph[str(start_id + 2)] = {"class_type": "SetLatentNoiseMask", "inputs": {
        "samples": latent_link, "mask": [str(start_id + 1), 0]}}
    return [str(start_id + 2), 0]


def _hires_pixel_chain(graph, src_latent, vae_link, hr_w, hr_h, method,
                       id_decode, id_scale, id_encode,
                       model_name=None, model_start=500):
    """二级采样的像素放大链（四个架构共用一份，避免四处复制粘贴写歪）。

    VAEDecode -> [UpscaleModelLoader + ImageUpscaleWithModel] -> ImageScale -> VAEEncode

    选了本地超分模型就先让模型真补一遍纹理，再用 lanczos 压到二采目标尺寸。
    这里压回去和"后处理缩回 1.5x"是两回事：二采的 hr_w×hr_h 本来就是用户定的
    最终尺寸，模型补出来的细节已经落在像素里；不压的话二采会跑在 4 倍尺寸上，
    8GB 显存直接爆。
    """
    graph[str(id_decode)] = {"class_type": "VAEDecode", "inputs": {
        "samples": src_latent, "vae": vae_link}}
    image_link = [str(id_decode), 0]
    if model_name:
        graph[str(model_start)] = {"class_type": "UpscaleModelLoader",
                                   "inputs": {"model_name": model_name}}
        graph[str(model_start + 1)] = {"class_type": "ImageUpscaleWithModel", "inputs": {
            "upscale_model": [str(model_start), 0], "image": image_link}}
        image_link = [str(model_start + 1), 0]
        # 模型已经补过细节，再叠双线性/最近邻只会把纹理揉烂。
        method = "lanczos"
    graph[str(id_scale)] = {"class_type": "ImageScale", "inputs": {
        "image": image_link, "upscale_method": method,
        "width": hr_w, "height": hr_h, "crop": "disabled"}}
    graph[str(id_encode)] = {"class_type": "VAEEncode", "inputs": {
        "pixels": [str(id_scale), 0], "vae": vae_link}}
    return [str(id_encode), 0]


def _build_krea_style_reference(graph, model_link, clip_link, vae_link, prompt, negative,
                                width, height, seed, steps, cfg, scheduler, denoise,
                                ref_files):
    """Krea 2「风格参考图」——参考图定画风，提示词只管画什么。

    照 ComfyUI 官方模板 image_krea2_turbo_int8_image_style_reference.json，
    与普通 t2i 有四处硬性差别，少一处就出不来效果：
      1. 必须挂 krea2_style_reference LoRA（官方模板固定 1.0）；
      2. 必须用 ModelSamplingFlux(max_shift 1.15 / base_shift 0.5)。
         普通 t2i 是 ComfyUI 在 Krea2.sampling_settings 里 baked 的固定 1.15，
         而风格参考模板显式给 base_shift 0.5——低分辨率时 shift 更小；
      3. conditioning 由 TextEncodeQwenImageEditPlus 吃参考图产生，再经
         FluxKontextMultiReferenceLatentMethod(index_timestep_zero) 转参考 latent；
      4. 采样器必须是 SamplerCustomAdvanced：只有 CFGGuider 能同时接
         positive 与独立 negative，普通 KSampler 接不了这条 conditioning。
    """
    # 1. 风格参考 LoRA 叠在用户已挂的 LoRA 之后（官方模板只挂它，强度 1.0）。
    graph["4"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
        "model": model_link, "lora_name": KREA_STYLE_LORA, "strength_model": 1.0}}
    styled_model = ["4", 0]

    # 2. 参考图（最多 3 张，官方模板就是 image1/2/3 三个槽）
    ref_links = []
    for idx, name in enumerate(ref_files[:3]):
        node_id = str(30 + idx)
        graph[node_id] = {"class_type": "LoadImage", "inputs": {"image": name}}
        ref_links.append([node_id, 0])

    # 3. 参考图 + 提示词 -> conditioning
    encode_inputs = {"clip": clip_link, "vae": vae_link, "prompt": prompt}
    for idx, link in enumerate(ref_links):
        encode_inputs["image%d" % (idx + 1)] = link
    graph["5"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": encode_inputs}
    graph["6"] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {
        "conditioning": ["5", 0], "reference_latents_method": "index_timestep_zero"}}

    # 4. 负面：Turbo 无 CFG 时直接清零（官方模板同款），cfg>1 才真的编码负面词。
    if cfg <= 1.0:
        graph["7"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["6", 0]}}
    else:
        graph["7"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_link}}

    # 5. shift 补丁 + guider
    graph["8"] = {"class_type": "ModelSamplingFlux", "inputs": {
        "model": styled_model, "max_shift": 1.15, "base_shift": 0.5,
        "width": width, "height": height}}
    graph["9"] = {"class_type": "CFGGuider", "inputs": {
        "model": ["8", 0], "positive": ["6", 0], "negative": ["7", 0], "cfg": cfg}}

    # 6. 采样四件套：noise / sampler / sigmas / latent -> SamplerCustomAdvanced
    graph["10"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    graph["11"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
    graph["12"] = {"class_type": "BasicScheduler", "inputs": {
        "model": ["8", 0], "scheduler": scheduler, "steps": steps, "denoise": denoise}}
    graph["13"] = {"class_type": "EmptyLatentImage", "inputs": {
        "width": width, "height": height, "batch_size": 1}}
    graph["14"] = {"class_type": "SamplerCustomAdvanced", "inputs": {
        "noise": ["10", 0], "guider": ["9", 0], "sampler": ["11", 0],
        "sigmas": ["12", 0], "latent_image": ["13", 0]}}

    graph["20"] = {"class_type": "VAEDecode", "inputs": {
        "samples": ["14", 0], "vae": vae_link}}
    graph["21"] = {"class_type": "SaveImage", "inputs": {
        "images": ["20", 0], "filename_prefix": "klock/krea-style"}}
    return graph


def build_graph(endpoint, payload, model=None, seed=0, uploaded=None, arch=None):
    """A1111 参数 -> ComfyUI API 工作流。"""
    model = model or current_model()
    arch = arch or _arch_for(model)
    # 白名单漏掉新架构时，arch 会被悄悄换成"当前架构"——zimage 之前就是这么
    # 被改写成 krea/anima，然后拿错的编码器去编码，报 2560 vs 1024。
    if arch not in ALLOWED_ARCHS:
        arch = current_arch() if current_arch() in ALLOWED_ARCHS else "anima"

    prompt, loras = _extract_loras(str(payload.get("prompt") or ""))
    negative = str(payload.get("negative_prompt") or "")
    if arch != "moss" and ("@box" in prompt or "@text" in prompt):
        # 布局语法只有 MOSS 认；别的架构要把这些行剥掉，别当乱码标签送进 TE。
        prompt = re.sub(r"^[ \t]*@(?:box|text)[ \t]+[^\n]*$", "", prompt, flags=re.M).strip()
    steps = max(1, min(150, int(payload.get("steps") or 20)))
    cfg = float(payload.get("cfg_scale") or 4.0)
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    sampler = _map_sampler(payload.get("sampler_name"))
    scheduler = _map_scheduler(payload.get("scheduler"), sampler)
    shift = float(payload.get("distilled_cfg_scale") or 3.5)
    clip_skip = _clip_skip(payload)
    enable_hr = bool(payload.get("enable_hr")) and endpoint == "txt2img"
    hr_scale = max(1.0, min(4.0, float(payload.get("hr_scale") or 1.25)))
    hr_denoise = max(0.0, min(1.0, float(payload.get("denoising_strength") or 0.4)))
    hr_steps = max(4, int(payload.get("hr_second_pass_steps") or max(8, steps // 2)))
    denoise = max(0.0, min(1.0, float(payload.get("denoising_strength") or 0.55))) \
        if endpoint == "img2img" else 1.0
    # 局部重绘：噪声只铺在蒙版里，所以 denoise 低于 0.75 时蒙版内也几乎不动，
    # 用户会以为「点了生成没反应」。这里抬个地板，上限仍然是用户说了算。
    if endpoint == "img2img" and payload.get("_mask_uploaded"):
        denoise = max(0.75, denoise)
    resize_mode = int(payload.get("resize_mode") or 0)

    # 16 的倍数（Anima/Qwen-Image VAE）；SDXL 用 8 的倍数。
    # 局部重绘例外：蒙版是按前端画布尺寸画的，这里一旦对齐宽度就会和蒙版错位，
    # 前端已经把画布对齐到 16 的倍数了，直接采信即可。
    multiple = 16 if arch in ("anima", "zimage") else 8
    if not (endpoint == "img2img" and payload.get("_mask_uploaded")):
        width = max(multiple, (width // multiple) * multiple)
        height = max(multiple, (height // multiple) * multiple)
    hr_w = int(round(width * hr_scale / multiple) * multiple)
    hr_h = int(round(height * hr_scale / multiple) * multiple)

    graph = {}
    if arch in ("anima", "zimage"):
        # Z-Image 与 Anima 的图结构一致（AuraFlow shift + SD3 latent），
        # 差异只有编码器文件、CLIPLoader 的 type，以及默认 VAE。
        is_zimage = arch == "zimage"
        graph["1"] = {"class_type": "UNETLoader", "inputs": {
            "unet_name": model, "weight_dtype": "default"}}
        graph["2"] = {"class_type": "CLIPLoader", "inputs": {
            "clip_name": (ZIMAGE_TE if is_zimage else ANIMA_TE),
            "type": ("lumina2" if is_zimage else "stable_diffusion")}}
        vae_name = _resolve_vae(payload) or (ZIMAGE_VAE if is_zimage else ANIMA_VAE)
        graph["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}}
        model_link, clip_link = _add_loras(graph, loras, ["1", 0], ["2", 0])
        # Anima shift baked 3.0；用 AuraFlow 覆盖（勿用 ModelSamplingSD3）。
        graph["4"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {
            "model": model_link, "shift": shift}}
        model_link = ["4", 0]
        vae_link = ["3", 0]

        graph["5"] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip_link}}
        graph["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_link}}
        if endpoint == "img2img" and uploaded:
            graph["7"] = {"class_type": "LoadImage", "inputs": {"image": uploaded}}
            graph["8"] = {"class_type": "ImageScale", "inputs": {
                "image": ["7", 0], "upscale_method": "lanczos",
                "width": width, "height": height,
                "crop": "center" if resize_mode == 1 else "disabled"}}
            graph["9"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["8", 0], "vae": vae_link}}
            # 有蒙版就改走局部重绘：噪声只铺在蒙版里，蒙版外原样不动。
            latent_link = _apply_inpaint_mask(graph, ["9", 0], payload.get("_mask_uploaded"),
                _mask_grow(payload))
        else:
            graph["7"] = {"class_type": "EmptySD3LatentImage", "inputs": {
                "width": width, "height": height, "batch_size": 1}}
            latent_link = ["7", 0]

        graph["10"] = {"class_type": "KSampler", "inputs": {
            "model": model_link, "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler,
            "positive": ["5", 0], "negative": ["6", 0],
            "latent_image": latent_link, "denoise": denoise}}
        final_latent = ["10", 0]

        if enable_hr:
            mode, method = _hr_mode(payload.get("hr_upscaler"))
            if mode == "latent":
                graph["11"] = {"class_type": "LatentUpscaleBy", "inputs": {
                    "samples": ["10", 0], "upscale_method": method, "scale_by": hr_scale}}
                hr_latent = ["11", 0]
            else:
                # 像素放大：解码 ->（可选 AI 超分）-> 缩到二采尺寸 -> 编码回 latent。
                hr_latent = _hires_pixel_chain(
                    graph, ["10", 0], vae_link, hr_w, hr_h, method, 11, 12, 13,
                    model_name=(method if mode == "model" else None))
            graph["14"] = {"class_type": "KSampler", "inputs": {
                "model": model_link, "seed": seed, "steps": hr_steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler,
                "positive": ["5", 0], "negative": ["6", 0],
                "latent_image": hr_latent, "denoise": hr_denoise}}
            final_latent = ["14", 0]

        graph["20"] = {"class_type": "VAEDecode", "inputs": {
            "samples": final_latent, "vae": vae_link}}
        graph["21"] = {"class_type": "SaveImage", "inputs": {
            "images": ["20", 0],
            "filename_prefix": ("klock/zimage" if is_zimage else "klock/anima")}}
        return graph

    # ---- MOSS-Image 5B（int8 DiT + Qwen3.5-9B w4a8 TE + FLUX.2 128ch VAE）
    if arch == "moss":
        graph["1"] = {"class_type": "UNETLoader", "inputs": {
            "unet_name": model, "weight_dtype": "default"}}
        graph["2"] = {"class_type": "CLIPLoader", "inputs": {
            "clip_name": MOSS_TE, "type": "moss_image"}}
        graph["3"] = {"class_type": "VAELoader",
                      "inputs": {"vae_name": _resolve_vae(payload) or MOSS_VAE}}
        # MOSS 的 LoRA 也是纯 DiT（本地几个都是 diffusion_model.* / layers.*），
        # 编码器分支一个 key 都没有，用 ModelOnly 免得白 clone 一份 9B 编码器。
        model_link, clip_link = _add_loras(
            graph, loras, ["1", 0], ["2", 0], model_only=True)
        vae_link = ["3", 0]
        # MOSS 原生布局提示词：有 @box 行就转成结构化 JSON，没有就原文照旧。
        # Hires 时框要按最终输出尺寸换算，不能按第一次采样的尺寸。
        layout_w, layout_h = (hr_w, hr_h) if enable_hr else (width, height)
        pos_text, _layout_count = _moss_layout_prompt(prompt, layout_w, layout_h)
        graph["5"] = {"class_type": "CLIPTextEncode", "inputs": {"text": pos_text, "clip": clip_link}}
        graph["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_link}}
        if endpoint == "img2img" and uploaded:
            graph["7"] = {"class_type": "LoadImage", "inputs": {"image": uploaded}}
            graph["8"] = {"class_type": "ImageScale", "inputs": {
                "image": ["7", 0], "upscale_method": "lanczos",
                "width": width, "height": height,
                "crop": "center" if resize_mode == 1 else "disabled"}}
            graph["9"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["8", 0], "vae": vae_link}}
            # 有蒙版就改走局部重绘：噪声只铺在蒙版里，蒙版外原样不动。
            latent_link = _apply_inpaint_mask(graph, ["9", 0], payload.get("_mask_uploaded"),
                _mask_grow(payload))
        else:
            graph["7"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {
                "width": width, "height": height, "batch_size": 1}}
            latent_link = ["7", 0]
        graph["10"] = {"class_type": "KSampler", "inputs": {
            "model": model_link, "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler,
            "positive": ["5", 0], "negative": ["6", 0],
            "latent_image": latent_link, "denoise": denoise}}
        final_latent = ["10", 0]
        if enable_hr:
            mode, method = _hr_mode(payload.get("hr_upscaler"))
            if mode == "latent":
                graph["11"] = {"class_type": "LatentUpscaleBy", "inputs": {
                    "samples": ["10", 0], "upscale_method": method, "scale_by": hr_scale}}
                hr_latent = ["11", 0]
            else:
                hr_latent = _hires_pixel_chain(
                    graph, ["10", 0], vae_link, hr_w, hr_h, method, 11, 12, 13,
                    model_name=(method if mode == "model" else None))
            graph["14"] = {"class_type": "KSampler", "inputs": {
                "model": model_link, "seed": seed, "steps": hr_steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler,
                "positive": ["5", 0], "negative": ["6", 0],
                "latent_image": hr_latent, "denoise": hr_denoise}}
            final_latent = ["14", 0]
        graph["20"] = {"class_type": "VAEDecode", "inputs": {
            "samples": final_latent, "vae": vae_link}}
        graph["21"] = {"class_type": "SaveImage", "inputs": {
            "images": ["20", 0], "filename_prefix": "klock/moss"}}
        return graph

    # ---- Krea 2：12.9B 单流 DiT + Qwen3-VL-4B 编码器 + Qwen-Image VAE
    # 完全照 ComfyUI 官方模板 image_krea2_turbo_t2i.json：
    #   EmptyLatentImage（普通 4 通道，不是 FLUX latent）、8 步、CFG 1、euler+simple、
    #   没有 shift 节点——ComfyUI 已在 Krea2.sampling_settings 里 baked
    #   {"multiplier": 1.0, "shift": 1.15}，普通 t2i 不需要 ModelSampling。
    # 负面条件：官方模板走 ConditioningZeroOut（Turbo 无 CFG，负面本就无效）。
    #   仅当用户手动把 CFG 抬到 >1 时，才真的编码负面提示词。
    if arch == "krea":
        graph["1"] = {"class_type": "UNETLoader", "inputs": {
            "unet_name": model, "weight_dtype": "default"}}
        # 编码器必须用 krea2 这个 type，否则 conditioning 维度对不上。
        graph["2"] = {"class_type": "CLIPLoader", "inputs": {
            "clip_name": KREA_TE, "type": "krea2"}}
        graph["3"] = {"class_type": "VAELoader",
                      "inputs": {"vae_name": _resolve_vae(payload) or KREA_VAE}}
        # Krea 2 的 LoRA 只打 DiT，编码器分支无 key，必须用 ModelOnly 节点。
        model_link, clip_link = _add_loras(
            graph, loras, ["1", 0], ["2", 0], model_only=True)
        vae_link = ["3", 0]
        # ---- 风格参考图分支（有参考图且 LoRA 就位才走）
        # 参考图不是「起始图」，不走 img2img 的 VAEEncode，而是喂进
        # TextEncodeQwenImageEditPlus 变成 conditioning，所以整条采样图都不同。
        style_files = [name for name in (payload.get("_style_ref_uploaded") or []) if name][:3]
        # 只在文生图生效：图生图/局部重绘走 VAEEncode 那条链路，
        # 风格参考会 return 掉整张图，把用户的参考图和蒙版一起吞了。
        if style_files and endpoint == "txt2img" \
                and os.path.isfile(os.path.join(LORA_DIR, KREA_STYLE_LORA)):
            return _build_krea_style_reference(
                graph, model_link=model_link, clip_link=clip_link, vae_link=vae_link,
                prompt=prompt, negative=negative, width=width, height=height,
                seed=seed, steps=steps, cfg=cfg, scheduler=scheduler,
                denoise=denoise, ref_files=style_files)
        graph["5"] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip_link}}
        if cfg <= 1.0:
            graph["6"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}}
        else:
            graph["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_link}}
        if endpoint == "img2img" and uploaded:
            graph["7"] = {"class_type": "LoadImage", "inputs": {"image": uploaded}}
            graph["8"] = {"class_type": "ImageScale", "inputs": {
                "image": ["7", 0], "upscale_method": "lanczos",
                "width": width, "height": height,
                "crop": "center" if resize_mode == 1 else "disabled"}}
            graph["9"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["8", 0], "vae": vae_link}}
            # 有蒙版就改走局部重绘：噪声只铺在蒙版里，蒙版外原样不动。
            latent_link = _apply_inpaint_mask(graph, ["9", 0], payload.get("_mask_uploaded"),
                _mask_grow(payload))
        else:
            graph["7"] = {"class_type": "EmptyLatentImage", "inputs": {
                "width": width, "height": height, "batch_size": 1}}
            latent_link = ["7", 0]
        graph["10"] = {"class_type": "KSampler", "inputs": {
            "model": model_link, "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler,
            "positive": ["5", 0], "negative": ["6", 0],
            "latent_image": latent_link, "denoise": denoise}}
        final_latent = ["10", 0]
        if enable_hr:
            # Krea 的两段式二采步数很少（官方配 4 步），不能沿用通用的
            # "base 步数的一半"——8 步 Turbo 会得到 8 步二采，白跑一倍时间。
            hr_steps = max(2, int(payload.get("hr_second_pass_steps") or 4))
            # 像素二采：4 通道 latent 走 LatentUpscaleBy 也行，但像素路径更可控。
            # Krea 默认 lanczos；只有用户明确选了本地超分模型才真跑模型补细节。
            hr_latent = _hires_pixel_chain(
                graph, ["10", 0], vae_link, hr_w, hr_h, "lanczos", 11, 12, 13,
                model_name=_hires_model_name(payload.get("hr_upscaler")))
            graph["14"] = {"class_type": "KSampler", "inputs": {
                "model": model_link, "seed": seed, "steps": hr_steps, "cfg": cfg,
                # 二采固定 euler + simple：这是 Krea 官方两段式（krea2-combo）
                # 的低噪重绘配方——4 步、denoise 0.3，只在已有结构上补细节。
                # 低步数 + 低 denoise 下换别的采样器 sigma 曲线容易把画面糊掉。
                # 注意这两个值必须是 ComfyUI API 的小写枚举，不是 A1111 的显示名。
                "sampler_name": "euler", "scheduler": "simple",
                "positive": ["5", 0], "negative": ["6", 0],
                "latent_image": ["13", 0], "denoise": hr_denoise}}
            final_latent = ["14", 0]
        graph["20"] = {"class_type": "VAEDecode", "inputs": {
            "samples": final_latent, "vae": vae_link}}
        graph["21"] = {"class_type": "SaveImage", "inputs": {
            "images": ["20", 0], "filename_prefix": "klock/krea"}}
        return graph

    # ---- SDXL / Illustrious 整模型
    graph["1"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": model}}
    model_link, clip_link = _add_loras(graph, loras, ["1", 0], ["1", 1])
    vae_link = ["1", 2]
    custom_vae = _resolve_vae(payload)
    if custom_vae:
        graph["30"] = {"class_type": "VAELoader", "inputs": {"vae_name": custom_vae}}
        vae_link = ["30", 0]
    if clip_skip > 1:
        graph["31"] = {"class_type": "CLIPSetLastLayer", "inputs": {
            "clip": clip_link, "stop_at_clip_layer": -clip_skip}}
        clip_link = ["31", 0]

    graph["2"] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip_link}}
    graph["3"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_link}}
    if endpoint == "img2img" and uploaded:
        graph["4"] = {"class_type": "LoadImage", "inputs": {"image": uploaded}}
        graph["5"] = {"class_type": "ImageScale", "inputs": {
            "image": ["4", 0], "upscale_method": "lanczos",
            "width": width, "height": height,
            "crop": "center" if resize_mode == 1 else "disabled"}}
        graph["6"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["5", 0], "vae": vae_link}}
        latent_link = _apply_inpaint_mask(graph, ["6", 0], payload.get("_mask_uploaded"),
            _mask_grow(payload))
    else:
        graph["4"] = {"class_type": "EmptyLatentImage", "inputs": {
            "width": width, "height": height, "batch_size": 1}}
        latent_link = ["4", 0]

    graph["7"] = {"class_type": "KSampler", "inputs": {
        "model": model_link, "seed": seed, "steps": steps, "cfg": cfg,
        "sampler_name": sampler, "scheduler": scheduler,
        "positive": ["2", 0], "negative": ["3", 0],
        "latent_image": latent_link, "denoise": denoise}}
    final_latent = ["7", 0]

    if enable_hr:
        mode, method = _hr_mode(payload.get("hr_upscaler"))
        if mode == "latent":
            graph["8"] = {"class_type": "LatentUpscaleBy", "inputs": {
                "samples": ["7", 0], "upscale_method": method, "scale_by": hr_scale}}
            hr_latent = ["8", 0]
        else:
            hr_latent = _hires_pixel_chain(
                graph, ["7", 0], vae_link, hr_w, hr_h, method, 8, 9, 10,
                model_name=(method if mode == "model" else None))
        graph["11"] = {"class_type": "KSampler", "inputs": {
            "model": model_link, "seed": seed, "steps": hr_steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler,
            "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": hr_latent, "denoise": hr_denoise}}
        final_latent = ["11", 0]

    graph["20"] = {"class_type": "VAEDecode", "inputs": {
        "samples": final_latent, "vae": vae_link}}
    graph["21"] = {"class_type": "SaveImage", "inputs": {
        "images": ["20", 0], "filename_prefix": "klock/sdxl"}}
    return graph


# ---------------------------------------------------------------- 执行
def _view_bytes(item):
    query = urllib.parse.urlencode({
        "filename": item.get("filename", ""),
        "subfolder": item.get("subfolder", ""),
        "type": item.get("type", "output"),
    })
    with _open(BASE + "/view?" + query, 120) as resp:
        return resp.read()


def _upload_image(data_b64, filename="klock_init.png"):
    """上传一张图到 ComfyUI，返回 LoadImage 能用的名字。

    不同用途必须用不同文件名：/upload/image 带 overwrite=true，同名会把
    先上传的图覆盖掉，导致前面的节点读到后面的图。
    """
    raw = base64.b64decode(re.sub(r"^data:[^,]*,", "", str(data_b64)))
    boundary = "----klock" + secrets.token_hex(8)
    body = b"".join([
        ("--%s\r\nContent-Disposition: form-data; name=\"image\"; "
         "filename=\"%s\"\r\nContent-Type: image/png\r\n\r\n" % (boundary, filename)).encode(),
        raw,
        ("\r\n--%s\r\nContent-Disposition: form-data; name=\"overwrite\""
         "\r\n\r\ntrue\r\n--%s--\r\n" % (boundary, boundary)).encode(),
    ])
    req = urllib.request.Request(
        BASE + "/upload/image", data=body, method="POST",
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary},
    )
    with _open(req, 120) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    name = result.get("name")
    if result.get("subfolder"):
        name = result["subfolder"] + "/" + name
    return name


def _submit_and_collect(graph, timeout=900, expected_steps=20):
    global _JOB_START, _JOB_STEPS
    with _STATE_LOCK:
        _JOB_STEPS = expected_steps
    try:
        result = _post_json("/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:800]
        except Exception:  # noqa: BLE001
            pass
        raise EngineError("ComfyUI 拒绝了工作流：%s" % (detail or exc.code))
    prompt_id = result.get("prompt_id")
    if not prompt_id:
        raise EngineError("ComfyUI 未返回 prompt_id：%s" % json.dumps(result, ensure_ascii=False)[:400])
    if result.get("node_errors"):
        raise EngineError("工作流节点错误：%s" % _format_errors(result["node_errors"]))
    with _STATE_LOCK:
        _JOB_START = time.time()

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            history = _get_json("/history/" + prompt_id, timeout=15)
        except Exception:  # noqa: BLE001
            history = {}
        if prompt_id in history:
            entry = history[prompt_id]
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                messages = status.get("messages") or []
                raise EngineError("ComfyUI 执行失败：%s" % json.dumps(messages, ensure_ascii=False)[:800])
            images = []
            for node_out in (entry.get("outputs") or {}).values():
                for item in node_out.get("images") or []:
                    data = _view_bytes(item)
                    if data:
                        images.append(data)
            return images
        time.sleep(0.6)
    raise EngineError("ComfyUI 生成超时（%ss），已提交的任务可能仍在队列中" % timeout)


def _infotext(prompt, negative, payload, model, seed, width, height, arch, hr_mode):
    return "\n".join([
        prompt,
        "Negative prompt: " + negative,
        "Steps: %s, Sampler: %s, Schedule type: %s, CFG scale: %s, Seed: %s, "
        "Size: %sx%s, Model: %s, Shift: %s, Hires upscaler: %s, Engine: ComfyUI/%s" % (
            payload.get("steps"), payload.get("sampler_name") or "",
            payload.get("scheduler") or "", payload.get("cfg_scale"),
            seed, width, height, _stem(model),
            payload.get("distilled_cfg_scale") if arch == "anima" else "-",
            hr_mode if payload.get("enable_hr") else "-", arch),
    ])


def _apply_controlnet(graph, model_name, image_name, strength=0.8, start=0.0, end=1.0):
    """给 Anima 挂 AnimaLLLite 控制（depth / lineart / pose / scribble）。

    关键：LLLite **不是**标准 ControlNet。它用 ModelPatchLoader + AnimaLLLiteApply，
    作用在 MODEL 上而不是 conditioning，所以改的是 KSampler 的 model 链路
    （标准 ControlNetApply 会报 "controlnet file is invalid"）。
    4 个 .safetensors 放在 models/controlnet/，已在 extra_model_paths.yaml 里
    同时注册为 model_patches。
    """
    samplers = [(key, node) for key, node in graph.items()
                if node.get("class_type") == "KSampler"]
    if not samplers or not model_name or not image_name:
        return graph
    counter = max([int(k) for k in graph if str(k).isdigit()] + [0]) + 1
    patch_id, image_id, apply_id = str(counter), str(counter + 1), str(counter + 2)
    graph[patch_id] = {"class_type": "ModelPatchLoader",
                       "inputs": {"name": model_name}}
    graph[image_id] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
    graph[apply_id] = {"class_type": "AnimaLLLiteApply", "inputs": {
        "model": samplers[0][1]["inputs"]["model"],
        "model_patch": [patch_id, 0],
        "image": [image_id, 0],
        "strength": max(-10.0, min(10.0, float(strength))),
        "start_percent": max(0.0, min(1.0, float(start))),
        "end_percent": max(0.0, min(1.0, float(end))),
    }}
    for _key, sampler in samplers:
        sampler["inputs"]["model"] = [apply_id, 0]
    return graph


def _fragmentation_score(data):
    """判断解码有没有把 latent 的 2×2 patch 拆错（条带废图）。

    Flux2 latent 是 128 通道 = 32 通道 × 2×2 空间 patch，通道/空间布局错位时
    画面会被拆成 3–4 条等宽竖带。关键特征是「接缝等间距」——正常照片里的
    竖直边（路灯杆、建筑）是随机的，凑不出三等分，所以用等距性而不是单纯看峰值。
    返回 0~10 的置信度，>=3 视为条带。
    """
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("L").resize((256, 256))
        px = img.load()
        cols = []
        for x in range(255):
            acc = 0
            for y in range(256):
                d = px[x + 1, y] - px[x, y]
                acc += d if d >= 0 else -d
            cols.append(acc / 256.0)
        mean = (sum(cols) / len(cols)) or 1e-6
        # 取明显高于平均的局部极大作为“候选接缝”。
        peaks = []
        for x in range(2, len(cols) - 2):
            if cols[x] < mean * 1.8:
                continue
            if cols[x] < max(cols[x - 2:x + 3]):
                continue
            # 条带接缝是贯穿整幅高度的直线；画面里的边框、物体边缘只在局部出现。
            strong = 0
            for y in range(256):
                if abs(px[x + 1, y] - px[x, y]) > 14:
                    strong += 1
            if strong < 154:  # 至少 60% 的行都有跳变才算接缝
                continue
            peaks.append(x)
        merged = []
        for x in peaks:
            if merged and x - merged[-1] <= 6:
                if cols[x] > cols[merged[-1]]:
                    merged[-1] = x
                continue
            merged.append(x)
        if len(merged) < 2:
            return 0.0
        gaps = [merged[i + 1] - merged[i] for i in range(len(merged) - 1)]
        gmean = sum(gaps) / len(gaps)
        if gmean <= 0:
            return 0.0
        gstd = (sum((g - gmean) ** 2 for g in gaps) / len(gaps)) ** 0.5
        uniform = 1.0 - min(1.0, gstd / gmean)          # 越等距越接近 1
        strength = max(cols[x] for x in merged) / mean   # 接缝有多“硬”
        return round(min(10.0, strength * uniform * min(1.0, len(merged) / 3.0) * 3.2), 2)
    except Exception:  # noqa: BLE001
        return 0.0


def generate(endpoint, payload, timeout=None):
    """A1111 兼容出图入口：返回 {images:[base64], info:json, parameters:{}}。"""
    if not _ping():
        raise EngineError("ComfyUI 引擎未启动（%s）" % BASE)
    start_progress_ws()

    model = (payload.get("override_settings") or {}).get("sd_model_checkpoint") or current_model()
    model = resolve_model_file(model)
    arch = _arch_for(model)
    if arch == "unknown":
        arch = current_arch()
    try:
        seed_raw = int(payload.get("seed") if payload.get("seed") is not None else -1)
    except (TypeError, ValueError):
        seed_raw = -1
    count = max(1, min(12, int(payload.get("n_iter") or 1)))
    with _STATE_LOCK:
        global _JOB_COUNT
        _JOB_COUNT = count
    base_seed = seed_raw if seed_raw >= 0 else random.randint(1, 2 ** 31 - 1)
    uploaded = None
    if endpoint == "img2img" and payload.get("init_images"):
        uploaded = _upload_image(payload["init_images"][0], "klock_init.png")
    # 局部重绘的蒙版：黑白 PNG，白色=重绘区域。必须先缩放到和图完全一致的尺寸，
    # 否则 SetLatentNoiseMask 会因为 mask 与 latent 尺寸不符直接报错。
    if endpoint == "img2img" and payload.get("klock_mask"):
        try:
            payload["_mask_uploaded"] = _upload_image(payload["klock_mask"], "klock_mask.png")
        except Exception as exc:  # noqa: BLE001
            log.warning("inpaint mask upload failed: %s", exc)
            payload["_mask_uploaded"] = None
    # 控制图（AnimaLLLite ControlNet）单独上传，避免和 init 图同名互相覆盖。
    control_cfg = payload.get("klock_controlnet") or {}
    control_image = None
    if arch == "anima" and isinstance(control_cfg, dict) and control_cfg.get("image"):
        try:
            control_image = _upload_image(control_cfg["image"], "klock_controlnet.png")
        except Exception as exc:  # noqa: BLE001
            log.warning("controlnet upload failed: %s", exc)
            control_image = None

    # Krea 风格参考图：最多 3 张（官方模板就是 image1/2/3）。
    # 上传后把 ComfyUI 侧的文件名放进 payload 的内部字段，build_graph 只认这个。
    style_ref = payload.get("klock_style_ref")
    if arch == "krea" and isinstance(style_ref, dict):
        raw_refs = style_ref.get("images") or []
        if isinstance(raw_refs, str):
            raw_refs = [raw_refs]
        uploaded_refs = []
        for idx, b64 in enumerate(raw_refs[:3]):
            if not b64:
                continue
            try:
                uploaded_refs.append(_upload_image(b64, "klock_style_ref_%d.png" % idx))
            except Exception as exc:  # noqa: BLE001
                log.warning("style reference upload failed (#%d): %s", idx, exc)
        payload["_style_ref_uploaded"] = uploaded_refs
        if not uploaded_refs:
            log.warning("style reference requested but nothing uploaded, falling back to t2i")

    # infotext 里要写用户真正选的放大算法名（模型名 / Lanczos），不是内部模式串。
    hr_mode, _method = _hr_mode(payload.get("hr_upscaler")) if payload.get("enable_hr") else ("-", "")
    hr_label = str(payload.get("hr_upscaler") or "Lanczos") if payload.get("enable_hr") else "-"
    limit = timeout or _timeout_for(payload, arch)
    images, seeds, infotexts, fragmented = [], [], [], []
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    if payload.get("enable_hr") and endpoint == "txt2img":
        scale = float(payload.get("hr_scale") or 1.25)
        width = int(width * scale)
        height = int(height * scale)

    def _compose(seed_value):
        """按 seed 组装工作流，并挂上可选的跳步缓存（主跑与重抽共用）。"""
        g = build_graph(endpoint, payload, model=model, seed=seed_value,
                        uploaded=uploaded, arch=arch)
        cache_cfg = payload.get("klock_easy_cache")
        if cache_cfg and int(payload.get("steps") or 20) >= 16:
            try:
                threshold = float((cache_cfg or {}).get("threshold") or 0.2) \
                    if isinstance(cache_cfg, dict) else 0.2
                node_type = str(cache_cfg.get("type") or "EasyCache") \
                    if isinstance(cache_cfg, dict) else "EasyCache"
            except (TypeError, ValueError):
                threshold, node_type = 0.2, "EasyCache"
            _apply_step_cache(g, threshold, node_type)
        if control_image and control_cfg.get("model"):
            _apply_controlnet(g, control_cfg["model"], control_image,
                              control_cfg.get("strength", 0.8),
                              control_cfg.get("start", 0.0),
                              control_cfg.get("end", 1.0))
        return g

    for index in range(count):
        with _STATE_LOCK:
            global _JOB_INDEX
            _JOB_INDEX = index
        seed = (base_seed + index) & 0x7FFFFFFF
        graph = _compose(seed)
        produced = _submit_and_collect(graph, timeout=limit,
                                       expected_steps=int(payload.get("steps") or 20))
        for data in produced:
            # 兜底：极少数情况下解码会把 Flux2 latent 的 2×2 patch 拆错，
            # 出一张被切成条带的废图。标记出来让前端提示重抽，别让它进图库。
            if _fragmentation_score(data) > 3.2:
                fragmented.append(len(images))
            images.append(base64.b64encode(data).decode("ascii"))
            seeds.append(seed)
            infotexts.append(_infotext(
                LORA_RE.sub("", str(payload.get("prompt") or "")).strip(),
                str(payload.get("negative_prompt") or ""),
                payload, model, seed, width, height, arch, hr_label))
    if not images:
        raise EngineError("ComfyUI 未返回图片")

    # 条带伪影是偶发的（同种子重跑通常就正常），直接原地换掉，用户无感。
    for bad in list(fragmented):
        try:
            retry = _submit_and_collect(_compose(seeds[bad]), timeout=limit,
                                        expected_steps=int(payload.get("steps") or 20))
        except Exception as exc:  # noqa: BLE001
            log.warning("fragmented retry failed: %s", exc)
            continue
        if retry and _fragmentation_score(retry[0]) <= 3.2:
            images[bad] = base64.b64encode(retry[0]).decode("ascii")
            infotexts[bad] = infotexts[bad] + ", re-rolled"
            fragmented.remove(bad)
            log.info("fragmented image %d re-rolled once", bad + 1)

    if _never_oom(payload):
        # 勾了 NeverOOM 就按「保底优先」处理：整批跑完把显存缓存还给系统。
        if unload():
            log.info("never-oom: ComfyUI VRAM released after batch")

    # 前端拿到这两个字段就能核对「选的」与「实际跑的」是否一致。
    sampler_actual = _map_sampler(payload.get("sampler_name"))
    scheduler_actual = _map_scheduler(payload.get("scheduler"), sampler_actual)
    # 回报用了几个布局框，便于确认 @box 有没有被解析到（只在 MOSS 生效）。
    layout_boxes = 0
    if arch == "moss":
        _, layout_boxes = _moss_layout_prompt(str(payload.get("prompt") or ""), width, height)
    cache_cfg = payload.get("klock_easy_cache") or {}
    cache_on = bool(cache_cfg) and int(payload.get("steps") or 20) >= 16
    cache_type = str(cache_cfg.get("type") or "EasyCache") if isinstance(cache_cfg, dict) else "EasyCache"
    # 回报实际用的 VAE，便于确认自定义 VAE 有没有真的生效。
    _custom_vae = _resolve_vae(payload)
    vae_used = _custom_vae or {"anima": ANIMA_VAE, "moss": MOSS_VAE, "krea": KREA_VAE}.get(arch, "")

    info = {
        "prompt": str(payload.get("prompt") or ""),
        "negative_prompt": str(payload.get("negative_prompt") or ""),
        "seed": seeds[0], "all_seeds": seeds,
        "infotexts": infotexts,
        "all_negative_prompts": [str(payload.get("negative_prompt") or "")] * len(images),
        "width": width, "height": height,
        "steps": payload.get("steps"), "cfg_scale": payload.get("cfg_scale"),
        "sampler_name": payload.get("sampler_name"), "scheduler": payload.get("scheduler"),
        "sampler_actual": sampler_actual, "scheduler_actual": scheduler_actual,
        "layout_boxes": layout_boxes,
        "step_cache": cache_type if cache_on else "",
        "fragmented": fragmented,
        "controlnet": str(control_cfg.get("model") or "") if control_image else "",
        # 风格参考图只记张数，图片本身绝不进元数据（几张 1024² 的 base64 会撑爆 PNG）。
        "style_reference": len(payload.get("_style_ref_uploaded") or []),
        "vae": vae_used,
        "sd_model_checkpoint": _stem(model), "arch": arch, "hires_upscaler": hr_mode,
    }
    return {"images": images, "info": json.dumps(info, ensure_ascii=False), "parameters": {}}


# ---------------------------------------------------------------- 引擎控制
def busy():
    try:
        queue = _get_json("/queue", timeout=3)
        return bool(queue.get("queue_running") or queue.get("queue_pending"))
    except Exception:  # noqa: BLE001
        return False


def interrupt():
    try:
        _post_json("/interrupt", {}, timeout=10)
        return True
    except Exception:  # noqa: BLE001
        return False


def unload():
    try:
        _post_json("/free", {"unload_models": True, "free_memory": True}, timeout=30)
        return True
    except Exception:  # noqa: BLE001
        return False


def _available_gb():
    try:
        import psutil
        return psutil.virtual_memory().available / (1024 ** 3)
    except Exception:  # noqa: BLE001
        return None


def progress(consume_preview=True):
    """A1111 progress 方言：优先用 WebSocket 真实步数，断线时回退时间估算。

    consume_preview=False 时预览不清空（SSE 用），并在返回体里带 preview_seq。
    """
    snap = _WS.snapshot()
    running = busy()
    # 每步预览：ComfyUI 通过 WebSocket 二进制帧推送，这里取一次即清空。
    preview = None
    preview_seq = 0
    if consume_preview:
        preview = _WS.take_preview()
    else:
        preview, preview_seq = _WS.peek_preview()
    with _STATE_LOCK:
        job_index, job_count = _JOB_INDEX, _JOB_COUNT
    if running and snap.get("max"):
        maximum = int(snap["max"]) or 1
        value = int(snap.get("value") or 0)
        base = int(snap.get("base") or 0)
        total = maximum + base
        ratio = min(0.99, (base + value) / total) if total else 0.0
        body = {"progress": round(ratio, 3), "eta_relative": 0.0,
                "state": {"job_count": job_count, "job_no": job_index,
                          "sampling_step": base + value, "sampling_steps": total,
                          "interrupted": False, "textinfo": "ComfyUI sampling"}}
    elif running:
        with _STATE_LOCK:
            started, steps = _JOB_START, _JOB_STEPS
        estimate = max(12.0, steps * 1.6)
        elapsed = max(0.0, time.time() - started) if started else 0.0
        ratio = min(0.95, elapsed / estimate)
        body = {"progress": round(ratio, 3), "eta_relative": round(max(0.0, estimate - elapsed), 1),
                "state": {"job_count": job_count, "job_no": job_index,
                          "sampling_step": int(ratio * steps), "sampling_steps": steps,
                          "interrupted": False, "textinfo": "ComfyUI sampling (estimated)"}}
    else:
        body = {"progress": 0.0, "eta_relative": 0.0,
                "state": {"job_count": 0, "job_no": 0, "sampling_step": 0,
                          "sampling_steps": 0, "interrupted": False, "textinfo": ""}}
    if preview:
        body["current_image"] = preview
        if not consume_preview:
            body["preview_seq"] = preview_seq
    return body


def _engine_stats():
    """ComfyUI 的真实资源状态：显存与队列深度。"""
    stats = {}
    try:
        info = _get_json("/system_stats", timeout=3)
        dev = (info.get("devices") or [{}])[0]
        total = int(dev.get("vram_total") or 0)
        free = int(dev.get("vram_free") or 0)
        if total:
            stats["vram_total_mb"] = total // (1024 * 1024)
            stats["vram_free_mb"] = free // (1024 * 1024)
    except Exception:  # noqa: BLE001
        pass
    try:
        queue = _get_json("/queue", timeout=3)
        stats["queue_running"] = len(queue.get("queue_running") or [])
        stats["queue_pending"] = len(queue.get("queue_pending") or [])
    except Exception:  # noqa: BLE001
        pass
    return stats


def status():
    online = _ping()
    model = current_model()
    arch = current_arch()
    body = {"online": online, "model": _stem(model) if online else "",
            "checked_at": int(time.time())}
    if online:
        body["preset"] = "anima" if arch == "anima" else ("moss" if arch == "moss" else "sd")
        body["modules"] = _modules_for(arch)
        body["arch"] = arch
        body["progress_ws"] = bool(_WS.snapshot().get("connected"))
        body.update(_engine_stats())
    else:
        body["detail"] = "引擎未启动（%s）" % BASE
    return body


def select_model(name, catalog=None):
    arch = set_model(name)
    if not arch:
        return {"ok": False, "detail": "模型不在目录中：%s" % name}, 400
    # 不再盲目 unload：ComfyUI 的 DynamicVRAM 会在加载新模型时自行卸载旧权重。
    # 只有物理内存确实紧张（< 3GB 可用）时才主动释放，避免不必要的重载。
    free = _available_gb()
    released = False
    if free is not None and free < 3.0 and not busy():
        released = unload()
    return {"ok": True, "model": _stem(name), "arch": arch,
            "preset": {"anima": "anima", "moss": "moss", "krea": "krea"}.get(arch, "sd"),
            "modules": _modules_for(arch),
            "released": released}, 200


def _upscale_model_names():
    """upscale_models 目录里的超分模型（.pth / .safetensors）。"""
    names = []
    for ext in ("*.safetensors", "*.pth", "*.pt"):
        names.extend(os.path.basename(p) for p in glob.glob(os.path.join(UPSCALE_DIR, ext)))
    return sorted(set(names))


# 超分模型原生倍数兜底：名字里没写倍数时按 4x 处理（ESRGAN 系绝大多数是 4x）。
UPSCALE_NATIVE_DEFAULT = 4
# 原生输出超过这个边长时才会兜底缩一次，纯粹为了不把显存/磁盘撑爆。
UPSCALE_MAX_EDGE = 8192


def _upscale_model_scale(model_name):
    """从文件名猜模型原生倍数：4x-UltraSharp -> 4，RealESRGAN_x4plus -> 4，2x_xxx -> 2。"""
    low = os.path.basename(str(model_name or "")).lower()
    # x4plus / x4 / x4_ 之类
    match = re.search(r"x(\d{1,2})(?=[^0-9]|$)", low)
    if match:
        value = int(match.group(1))
        if 1 <= value <= 16:
            return value
    # 4x- / 4x_ / 4x. 之类
    match = re.search(r"(?:^|[^0-9a-z])(\d{1,2})x(?=[^0-9a-z]|$)", low)
    if match:
        value = int(match.group(1))
        if 1 <= value <= 16:
            return value
    return UPSCALE_NATIVE_DEFAULT


def _upscale_with_model(blob, scale, model_name):
    """走 ComfyUI 的 UpscaleModelLoader：真正补细节，不是拉伸像素。

    超分模型是固定倍数的（本地三个都是 4x），没法按 1.5x/2x 出图。
    所以这里**按模型原生倍数直接出图，不再缩回用户选的倍数**——
    4x 结果缩成 1.5x 等于白扔 88% 的像素，还多一次重采样把细节揉掉。
    用户选的 scale 只当参考值：只有原生输出大到离谱（> UPSCALE_MAX_EDGE）
    时才用它做一次等比兜底缩小。
    """
    if Image is None:
        raise EngineError("Pillow 不可用，无法读取待放大的图")
    src = Image.open(io.BytesIO(blob))
    src.load()
    native = _upscale_model_scale(model_name)
    out_w, out_h = src.width * native, src.height * native
    uploaded = _upload_image(base64.b64encode(blob).decode("ascii"), "klock_upscale.png")
    graph = {
        "1": {"class_type": "LoadImage", "inputs": {"image": uploaded}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": model_name}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {
            "upscale_model": ["2", 0], "image": ["1", 0]}},
        "5": {"class_type": "SaveImage", "inputs": {
            "images": ["3", 0], "filename_prefix": "klock/upscale"}},
    }
    longest = max(out_w, out_h)
    if longest > UPSCALE_MAX_EDGE:
        # 极少数情况（原图本身就 >2048 又跑 4x）兜底：等比压到上限内。
        # 对齐到 8 的倍数，ImageScale 不会自己截掉半像素。
        ratio = UPSCALE_MAX_EDGE / float(longest)
        cap_w = max(64, int(round(out_w * ratio / 8)) * 8)
        cap_h = max(64, int(round(out_h * ratio / 8)) * 8)
        log.info("upscale %s native %dx%d exceeds %d, cap to %dx%d",
                 model_name, out_w, out_h, UPSCALE_MAX_EDGE, cap_w, cap_h)
        graph["4"] = {"class_type": "ImageScale", "inputs": {
            "image": ["3", 0], "upscale_method": "lanczos",
            "width": cap_w, "height": cap_h, "crop": "disabled"}}
        graph["5"]["inputs"]["images"] = ["4", 0]
    images = _submit_and_collect(graph, timeout=300, expected_steps=0)
    if not images:
        raise EngineError("放大没有产出图像")
    return images[0]


def upscale_image(blob, scale, upscaler):
    """放大：指定了本地超分模型就走 AI，否则退回 PIL 插值。

    Lanczos / Nearest 只是把像素摊开，放大后照样糊；
    接了 UpscaleModelLoader 才是真的补纹理。前端把模型名当 upscaler 传进来。
    """
    if Image is None:
        raise EngineError("Pillow 不可用，无法放大")
    name = str(upscaler or "")
    scale = max(1.0, min(8.0, float(scale or 2)))
    if name and os.path.isfile(os.path.join(UPSCALE_DIR, name)):
        return _upscale_with_model(blob, scale, name)
    image = Image.open(io.BytesIO(blob))
    image.load()
    low = name.lower()
    resample = (Image.NEAREST if low.startswith("nearest")
                else Image.BICUBIC if low.startswith("bicubic") else Image.LANCZOS)
    out = image.convert("RGB").resize(
        (int(image.width * scale), int(image.height * scale)), resample)
    buffer = io.BytesIO()
    out.save(buffer, format="PNG")
    return buffer.getvalue()


# ---------------------------------------------------------------- API 分发
def _reply(obj, status_code=200):
    return (status_code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8")


def options_payload():
    model = current_model()
    arch = current_arch()
    if arch == "anima":
        modules = [os.path.join(TE_DIR, ANIMA_TE), os.path.join(VAE_DIR, ANIMA_VAE)]
    elif arch == "moss":
        modules = [os.path.join(TE_DIR, MOSS_TE), os.path.join(VAE_DIR, MOSS_VAE)]
    else:
        modules = []
    return {
        "sd_model_checkpoint": model,
        "forge_preset": "anima" if arch == "anima" else "sd",
        "forge_checkpoint_anima": model if arch == "anima" else None,
        "forge_additional_modules_anima": modules,
        "forge_additional_modules": modules,
        "CLIP_stop_at_last_layers": 1,
    }


def dispatch(method, path, data=b""):
    """返回 (status, body, ctype)；None 表示不由本模块处理。"""
    clean = path.split("?", 1)[0]
    if not clean.startswith("/sdapi/v1/"):
        return None
    endpoint = clean[len("/sdapi/v1/"):]
    try:
        obj = json.loads(data.decode("utf-8")) if data else {}
    except (ValueError, UnicodeDecodeError):
        obj = {}

    if endpoint == "options":
        if method == "POST":
            name = obj.get("sd_model_checkpoint") or obj.get("forge_checkpoint_anima")
            if name:
                set_model(name)
        return _reply(options_payload())

    if endpoint == "sd-models":
        return _reply([
            {"title": _stem(f), "model_name": _stem(f), "hash": "", "sha256": "",
             "filename": os.path.join(CKPT_DIR, f), "config": None}
            for f in _model_filenames()
        ])

    if endpoint == "loras":
        return _reply([
            {"name": _stem(p), "alias": _stem(p), "path": p, "metadata": {}}
            for p in sorted(glob.glob(os.path.join(LORA_DIR, "*.safetensors")))
        ])

    if endpoint == "refresh-loras":
        return _reply({})

    if endpoint == "sd-modules":
        modules = []
        for folder, kind in ((TE_DIR, "text_encoder"), (VAE_DIR, "vae")):
            for p in sorted(glob.glob(os.path.join(folder, "*.safetensors"))):
                modules.append({"name": os.path.basename(p), "path": p, "kind": kind})
        return _reply(modules)

    if endpoint == "upscalers":
        # 本地 AI 超分模型排前面（真补纹理），插值算法兜底。
        # Latent 系由 latent-upscale-modes 单独提供。
        # scale 填模型**原生倍数**：前端拿它显示"原生 4x"，不再假装能出 1.5x。
        models = [{"name": m, "model_name": m, "scale": _upscale_model_scale(m),
                   "native": True}
                  for m in _upscale_model_names()]
        interp = [
            {"name": "Lanczos", "model_name": "Lanczos", "scale": 4, "native": False},
            {"name": "Bicubic", "model_name": "Bicubic", "scale": 4, "native": False},
            {"name": "Nearest", "model_name": "Nearest", "scale": 4, "native": False},
        ]
        return _reply(models + interp)

    if endpoint == "latent-upscale-modes":
        return _reply(["Latent", "Latent (antialiased)", "Latent (bicubic)", "Latent (nearest-exact)"])

    if endpoint == "progress":
        return _reply(progress())

    if endpoint == "interrupt":
        return _reply({"ok": interrupt()})

    if endpoint == "unload-checkpoint":
        return _reply({"ok": unload()})

    if endpoint in ("txt2img", "img2img"):
        try:
            return _reply(generate(endpoint, obj))
        except EngineError as exc:
            return _reply({"detail": str(exc)}, 502)

    return _reply({"detail": "ComfyUI 引擎不支持该端点：%s" % clean}, 404)


def _bootstrap():
    """模块导入即尝试建立进度通道；引擎未启动时静默重试，不影响 KlockUI。"""
    try:
        start_progress_ws()
    except Exception:  # noqa: BLE001
        pass


_bootstrap()

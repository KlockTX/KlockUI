"""把 KlockUI 打成一个可以直接发给 agent 的安装包。

用法：
    python scripts/make_release.py [版本号]

默认版本号读 latest-tag，没有 tag 就用 v1.0.0。

设计要点：
1. 只打 git ls-files 里的文件 —— 个人数据、缓存、备份、模型权重天然被排除。
2. 包里额外放 AGENT-INSTALL.md，告诉 agent「这是一个压缩包，按 install.md 执行」。
3. 开发期文档（docs/frontend.md、docs/swarmui-notes.md、scripts/smoke.py）不进包，
   它们留在仓库里；包里只放装机与排错会用到的。
3. 不改版本号到代码里：index.html 用 ?v= 参数做缓存失效，包本身用目录名带版本。
"""
import os
import re
import subprocess
import sys
import zipfile
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist")
PREFIX = "KlockUI"


def git(args):
    return subprocess.check_output(["git"] + args, cwd=ROOT).decode("utf-8", "replace").strip()


def version_arg():
    if len(sys.argv) > 1:
        return sys.argv[1]
    try:
        tags = git(["tag", "--sort=-v:refname"]).splitlines()
        if tags:
            return tags[0]
    except subprocess.CalledProcessError:
        pass
    return "v1.0.0"


# 开发期才用的东西，装机不需要 —— 不进发行包，仓库里仍保留。
# 判断标准：运行 KlockUI 时不会被读到，也不是用户排错要查的资料。
DEV_ONLY = {
    ".gitattributes",
    "docs/frontend.md",       # 前端改动记录，纯开发过程
    "docs/swarmui-notes.md",  # 竞品调研
    "docs/seedvr2-research.md",  # 低显存扩散超分调研
    "docs/community-lora-research-20261122.md",  # 社区 LoRA 调研
}
# 整个目录排除：scripts/ 里是打包工具和开发自检，运行时一个都用不到。
DEV_ONLY_DIRS = ("scripts/",)


def tracked_files():
    files = git(["ls-files"]).splitlines()
    return [
        f for f in files
        # 打包产物自己不能进包
        if not f.startswith("dist/")
        and f not in DEV_ONLY
        and not f.startswith(DEV_ONLY_DIRS)
    ]


def main():
    version = version_arg()
    if not re.fullmatch(r"v?\d+\.\d+\.\d+", version):
        raise SystemExit("版本号格式应为 v1.0.0 或 1.0.0")
    version = version if version.startswith("v") else "v" + version

    os.makedirs(OUT, exist_ok=True)
    zip_path = os.path.join(OUT, "%s-%s.zip" % (PREFIX, version.lstrip("v")))
    root_dir = "%s-%s" % (PREFIX, version.lstrip("v"))
    files = tracked_files()

    agent_install = """# 从压缩包安装 KlockUI

你收到的是一个 KlockUI 源码压缩包（不是 git 仓库）。

## 你要做的

1. 把压缩包解压到一个目录，目录名保持 `KlockUI-<版本>`。
2. 把本目录和 ComfyUI **放在同一父目录**（install.md 的路径探测依赖这个结构）：
   ```
   <父目录>/
   ├─ ComfyUI/     # 你自己 clone 或已装
   └─ KlockUI-<版本>/   # 本压缩包解压出来的目录
   ```
3. **先读同目录的 `skill.md`**（install.md 第 0.1 节要求），再按 `install.md` 逐步执行。
   **特别注意 P0**：先探测本机 8188 端口与已有 ComfyUI 目录，命中就复用，
   不要重复 clone、不要另起一个引擎抢端口。
4. 交付时必须包含 install.md 第 7 节的环境报告。

## 和仓库安装的区别

| 项 | 仓库安装 | 压缩包安装 |
|---|---|---|
| 代码来源 | `git clone` | 解压本包 |
| 更新方式 | `git pull` | 下载新版本包，重新解压 |
| 模型权重 | 都要你自己下载 | 都要你自己下载 |
| 安装步骤 | install.md | **完全一样** |

压缩包里没有 `.git` 目录，也没有任何模型权重、个人数据、缓存或历史记录。
如果 agent 需要查提交历史或做版本更新，请告诉用户改用仓库链接方式。

版本：%s
打包时间：%s
""" % (version, datetime.now().strftime("%Y-%m-%d %H:%M"))

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            full = os.path.join(ROOT, rel)
            if not os.path.isfile(full):
                continue
            zf.write(full, os.path.join(root_dir, rel))
        zf.writestr(os.path.join(root_dir, "AGENT-INSTALL.md"), agent_install)

    size = os.path.getsize(zip_path)
    print("生成 %s" % zip_path)
    print("版本 %s · %d 个文件 · %.1f KB" % (version, len(files) + 1, size / 1024))
    return zip_path


if __name__ == "__main__":
    main()

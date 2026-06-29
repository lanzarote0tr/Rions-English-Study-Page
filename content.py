import logging
import random
from functools import lru_cache
from pathlib import Path

from flask import abort, url_for

APP_ROOT = Path(__file__).resolve().parent
TEXTS_BASE_DIR = (APP_ROOT / "texts").resolve()
IMAGE_DIR = (APP_ROOT / "static" / "img").resolve()
HANGUL_RANGE = ("가", "힣")
LOCAL_TEXT_PREFIX = "__local__/"

logger = logging.getLogger(__name__)


def resolve_under(base_dir: Path, relative_path: str = "") -> Path:
    target_path = (base_dir / relative_path).resolve()
    try:
        target_path.relative_to(base_dir)
    except ValueError:
        abort(404, "Invalid path")
    return target_path


def normalize_relative(path: Path) -> str:
    if path == TEXTS_BASE_DIR:
        return ""
    return path.relative_to(TEXTS_BASE_DIR).as_posix()


def path_signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size


@lru_cache(maxsize=512)
def list_directory_entries(subdirectory: str, signature: tuple[int, int]) -> tuple[tuple[str, str, str], ...]:
    del signature
    directory = resolve_under(TEXTS_BASE_DIR, subdirectory)
    items = []
    children = sorted(directory.iterdir(), key=lambda child: (child.is_file(), child.name.lower()))
    for child in children:
        relative_path = normalize_relative(child)
        if child.is_dir():
            items.append((child.name, "folder", relative_path))
        elif child.suffix.lower() == ".txt":
            items.append((child.stem, "file", relative_path))
    return tuple(items)


def list_directory(subdirectory: str = "") -> list[dict[str, str]]:
    directory = resolve_under(TEXTS_BASE_DIR, subdirectory)
    if not directory.is_dir():
        abort(404, "Directory not found")

    return [
        {"name": name, "type": item_type, "path": path}
        for name, item_type, path in list_directory_entries(subdirectory, path_signature(directory))
    ]


def build_breadcrumbs(subdirectory: str = "") -> tuple[list[dict[str, str]], str | None]:
    if not subdirectory:
        return [], None

    breadcrumbs = []
    parts = Path(subdirectory).parts
    for index, part in enumerate(parts):
        breadcrumbs.append({"name": part, "path": Path(*parts[: index + 1]).as_posix()})

    parent_parts = parts[:-1]
    parent_path = Path(*parent_parts).as_posix() if parent_parts else ""
    return breadcrumbs, parent_path


def normalize_study_mode(mode: str | None) -> str:
    if mode in {"fill", "line"}:
        return mode
    return "practice"


def contains_hangul(text: str) -> bool:
    return any(HANGUL_RANGE[0] <= char <= HANGUL_RANGE[1] for char in text)


def parse_alternating_line_format(raw_text: str) -> dict[str, str | list[dict[str, str]]] | None:
    lines = [line.strip() for line in raw_text.replace("﻿", "").splitlines() if line.strip()]
    if len(lines) < 2 or len(lines) % 2 != 0:
        return None

    english_lines = lines[0::2]
    korean_lines = lines[1::2]
    if not english_lines or not korean_lines:
        return None

    english_like = sum(1 for line in english_lines if not contains_hangul(line))
    korean_like = sum(1 for line in korean_lines if contains_hangul(line))
    if english_like != len(english_lines) or korean_like != len(korean_lines):
        return None

    line_pairs = [
        {"english": english_lines[index], "korean": korean_lines[index]}
        for index in range(len(english_lines))
    ]
    return {
        "english_content": "\n".join(english_lines),
        "korean_content": "\n".join(korean_lines),
        "line_pairs": line_pairs,
    }


def parse_text_content(raw_text: str) -> dict[str, str | list[dict[str, str]]]:
    normalized = raw_text.replace("﻿", "").strip()
    alternating = parse_alternating_line_format(normalized)
    if alternating is not None:
        return alternating

    english_lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    return {
        "english_content": "\n".join(english_lines),
        "korean_content": "",
        "line_pairs": [],
    }


@lru_cache(maxsize=512)
def text_neighbors(parent_path: str, file_name: str, signature: tuple[int, int]) -> tuple[str | None, str | None]:
    del signature
    parent = Path(parent_path)
    siblings = sorted(
        [child for child in parent.iterdir() if child.is_file() and child.suffix.lower() == ".txt"],
        key=lambda child: child.name.lower(),
    )
    file_path = parent / file_name
    try:
        current_index = siblings.index(file_path)
    except ValueError:
        return None, None

    previous_path = siblings[current_index - 1] if current_index > 0 else None
    next_path = siblings[current_index + 1] if current_index < len(siblings) - 1 else None

    previous_relative = normalize_relative(previous_path) if previous_path else None
    next_relative = normalize_relative(next_path) if next_path else None
    return previous_relative, next_relative


def get_text_neighbors(file_path: Path) -> tuple[str | None, str | None]:
    return text_neighbors(file_path.parent.as_posix(), file_path.name, path_signature(file_path.parent))


@lru_cache(maxsize=512)
def load_text_payload_from_file(text_path: str, signature: tuple[int, int]) -> dict[str, object]:
    del signature
    file_path = resolve_under(TEXTS_BASE_DIR, text_path)
    raw_text = file_path.read_text(encoding="utf-8")

    parsed_content = parse_text_content(raw_text)
    previous_text_path, next_text_path = get_text_neighbors(file_path)
    parent_dir = file_path.parent

    return {
        "title": file_path.stem,
        "text_path": normalize_relative(file_path),
        "english_content": parsed_content["english_content"],
        "korean_content": parsed_content["korean_content"],
        "line_pairs": parsed_content["line_pairs"],
        "previous_text_path": previous_text_path,
        "next_text_path": next_text_path,
        "parent_dir_path": normalize_relative(parent_dir),
    }


def load_text_payload(text_path: str) -> dict[str, object]:
    file_path = resolve_under(TEXTS_BASE_DIR, text_path)
    if not file_path.is_file():
        abort(404, "File not found")

    try:
        return dict(load_text_payload_from_file(text_path, path_signature(file_path)))
    except OSError as exc:
        logger.error("failed to read file %r: %s", file_path, exc)
        abort(500, f"Error reading file: {exc}")


@lru_cache(maxsize=8)
def image_names(signature: tuple[int, int]) -> tuple[str, ...]:
    del signature
    return tuple(
        image.name
        for image in IMAGE_DIR.iterdir()
        if image.is_file() and image.stem.lower() != "rion"
    )


def get_random_image_url() -> str | None:
    if not IMAGE_DIR.exists():
        return None

    image_files = image_names(path_signature(IMAGE_DIR))
    if not image_files:
        return None

    return url_for("static", filename=f"img/{random.choice(image_files)}")


def build_browse_payload(subdirectory: str = "", allow_missing: bool = False) -> dict[str, object]:
    breadcrumbs, parent_path = build_breadcrumbs(subdirectory)
    items = []
    directory = resolve_under(TEXTS_BASE_DIR, subdirectory)
    if directory.is_dir():
        items = list_directory(subdirectory)
    elif not allow_missing:
        abort(404, "Directory not found")

    return {
        "current_path": subdirectory,
        "parent_path": parent_path,
        "breadcrumbs": breadcrumbs,
        "items": items,
        "random_image_url": get_random_image_url(),
    }


def build_text_payload(text_path: str) -> dict[str, object]:
    if text_path.startswith(LOCAL_TEXT_PREFIX):
        local_path = text_path[len(LOCAL_TEXT_PREFIX):]
        path = Path(local_path)
        return {
            "title": path.stem,
            "text_path": text_path,
            "english_content": "",
            "korean_content": "",
            "line_pairs": [],
            "previous_text_path": None,
            "next_text_path": None,
            "parent_dir_path": path.parent.as_posix() if path.parent.as_posix() != "." else "",
            "random_image_url": get_random_image_url(),
        }

    payload = load_text_payload(text_path)
    payload["random_image_url"] = get_random_image_url()
    return payload

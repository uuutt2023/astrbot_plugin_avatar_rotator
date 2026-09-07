"""Automatically rotate the QQ account avatar through NapCat."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import random
import time
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from PIL import ImageOps, UnidentifiedImageError

import astrbot.api.message_components as Comp
from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import filter
from astrbot.api.star import Context, Star

try:
    from astrbot.api.web import (
        PluginUploadFile,
        error_response,
        file_response,
        json_response,
        request,
    )
except ImportError:  # pragma: no cover - older AstrBot without page bridge
    PluginUploadFile = None  # type: ignore[assignment]
    error_response = None  # type: ignore[assignment]
    file_response = None  # type: ignore[assignment]
    json_response = None  # type: ignore[assignment]
    request = None  # type: ignore[assignment]

from astrbot.core.platform.sources.aiocqhttp.aiocqhttp_message_event import (
    AiocqhttpMessageEvent,
)
from astrbot.core.star.star_tools import StarTools


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MAX_IMAGES_PER_COMMAND = 30
PLUGIN_NAME = "astrbot_plugin_avatar_rotator"


def _ok(data: Any) -> Any:
    """Wrap a payload in the standard JSON response helper if available."""
    if json_response is not None:
        return json_response(data)
    return {"status": "ok", "data": data}


def _err(message: str, status_code: int = 400) -> Any:
    """Wrap an error message in the standard error response helper if available."""
    if error_response is not None:
        return error_response(message, status_code=status_code)
    return {"status": "error", "message": message}


def _wants_data_url() -> bool:
    """Return True if the current request asked for an inline data URL response.

    The dashboard iframe's bridge SDK uses postMessage to call plugin Web API
    endpoints; ``apiGet`` always resolves to a JSON value (never bytes), so
    binary ``file_response`` payloads cannot be displayed by an ``<img>`` tag
    inside the iframe. When the client passes ``?format=data_url``, return a
    ``{"image": "data:<mime>;base64,..."}`` envelope that the page can assign
    straight to ``img.src``. Any other (or absent) value keeps the default
    ``file_response`` behaviour for direct HTTP clients.
    """
    if request is None:
        return False
    try:
        value = request.query.get("format")
    except Exception:
        return False
    return isinstance(value, str) and value.strip().lower() in {
        "data_url",
        "data-url",
        "dataurl",
    }


def _image_data_url(path: Path, content_type: str = "image/jpeg") -> str:
    """Encode ``path`` as a ``data:<mime>;base64,...`` URI string."""
    raw = path.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def _maybe_image_response(
    path: Path,
    *,
    content_type: str = "image/jpeg",
    filename: str | None = None,
) -> Any:
    """Return either a data-URL JSON envelope or a Starlette FileResponse.

    ``_wants_data_url()`` decides which shape the caller asked for; the default
    shape is the binary ``file_response``, which is what direct HTTP clients
    (curl, the dashboard's own ``bridge.download`` flow, the browser's native
    fetch API) want.
    """
    if _wants_data_url():
        if filename is None:
            filename = path.name
        return _ok(
            {
                "image": _image_data_url(path, content_type=content_type),
                "filename": filename,
                "content_type": content_type,
                "size": path.stat().st_size if path.exists() else 0,
            }
        )
    return file_response(
        str(path),
        filename=filename if filename is not None else path.name,
        content_type=content_type,
    )


class AvatarRotatorPlugin(Star):
    """Maintain a persistent avatar library and rotate the QQ avatar."""

    def __init__(self, context: Context, config: AstrBotConfig) -> None:
        """Initialize persistent state and the background scheduler.

        Args:
            context: AstrBot plugin context.
            config: Plugin configuration object.
        """
        super().__init__(context)
        self.config = config
        self.data_dir = StarTools.get_data_dir("astrbot_plugin_avatar_rotator")
        self.avatar_dir = self.data_dir / "avatars"
        self.state_path = self.data_dir / "state.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.avatar_dir.mkdir(parents=True, exist_ok=True)

        self.state: dict[str, Any] = {
            "paused": False,
            "last_avatar": "",
            "last_changed_at": 0.0,
            "next_run_at": 0.0,
            "interval_seconds": 0.0,
            "last_error": "",
        }
        if self.state_path.exists():
            try:
                loaded = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self.state.update(loaded)
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("[AvatarRotator] Failed to load state: %s", exc)

        self.crops_path = self.data_dir / "crops.json"
        self.crops: dict[str, dict[str, float]] = {}
        if self.crops_path.exists():
            try:
                loaded = json.loads(self.crops_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    for key, value in loaded.items():
                        if isinstance(value, dict) and self._is_valid_crop(value):
                            self.crops[key] = value
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("[AvatarRotator] Failed to load crops: %s", exc)

        self._rotation_lock = asyncio.Lock()
        self._stopping = False
        self._worker_task: asyncio.Task | None = None
        self._ensure_worker()
        self._register_webui_routes()

    @staticmethod
    def _is_valid_crop(value: Any) -> bool:
        """Return True if ``value`` looks like a crop metadata entry."""
        if not isinstance(value, dict):
            return False
        try:
            x = float(value.get("x", 0))
            y = float(value.get("y", 0))
            w = float(value.get("w", 0))
            h = float(value.get("h", 0))
        except (TypeError, ValueError):
            return False
        return w > 0 and h > 0 and x >= 0 and y >= 0

    def _save_crops(self) -> None:
        """Atomically persist the crop metadata to disk."""
        temporary = self.crops_path.with_suffix(".json.tmp")
        try:
            temporary.write_text(
                json.dumps(self.crops, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.crops_path)
        except OSError as exc:
            logger.error("[AvatarRotator] Failed to save crops: %s", exc)

    def _register_webui_routes(self) -> None:
        """Register WebUI HTTP routes for the browser companion page."""
        if request is None:
            logger.debug(
                "[AvatarRotator] astrbot.api.web unavailable; WebUI page disabled"
            )
            return
        register_web_api = getattr(self.context, "register_web_api", None)
        if not callable(register_web_api):
            logger.debug(
                "[AvatarRotator] context.register_web_api missing; WebUI page disabled"
            )
            return

        routes = [
            (
                f"/{PLUGIN_NAME}/avatars",
                self._webui_list_avatars,
                ["GET"],
                "List avatars in the persistent library",
            ),
            (
                f"/{PLUGIN_NAME}/avatars/upload",
                self._webui_upload_avatar,
                ["POST"],
                "Upload a new avatar image",
            ),
            (
                f"/{PLUGIN_NAME}/avatars/<key:path>/image",
                self._webui_get_avatar_image,
                ["GET"],
                "Fetch the original bytes of an avatar",
            ),
            (
                f"/{PLUGIN_NAME}/avatars/<key:path>/crop",
                self._webui_set_or_clear_crop,
                ["POST"],
                "Set or clear crop metadata; payload {x,y,w,h} sets, empty clears",
            ),
            (
                f"/{PLUGIN_NAME}/avatars/<key:path>/delete",
                self._webui_delete_avatar,
                ["POST"],
                "Delete an avatar from the library",
            ),
            (
                f"/{PLUGIN_NAME}/avatars/<key:path>/stripped",
                self._webui_download_stripped,
                ["GET"],
                "Download the cropped preview of an avatar",
            ),
            (
                f"/{PLUGIN_NAME}/rotate",
                self._webui_rotate_now,
                ["POST"],
                "Trigger an immediate avatar rotation",
            ),
            (
                f"/{PLUGIN_NAME}/state",
                self._webui_state,
                ["GET"],
                "Get the current scheduler state",
            ),
        ]
        for route, view, methods, desc in routes:
            try:
                register_web_api(route, view, methods, desc)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning(
                    "[AvatarRotator] Failed to register WebUI route %s: %s",
                    route,
                    exc,
                )

    def _ensure_worker(self) -> None:
        """Start the scheduler once when an event loop is available."""
        if self._stopping:
            return
        if self._worker_task and not self._worker_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._worker_task = loop.create_task(
            self._worker_loop(), name="astrbot_avatar_rotator"
        )

    def _save_state(self) -> None:
        """Atomically persist scheduler state."""
        temporary_path = self.state_path.with_suffix(".json.tmp")
        try:
            temporary_path.write_text(
                json.dumps(self.state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary_path.replace(self.state_path)
        except OSError as exc:
            logger.error("[AvatarRotator] Failed to save state: %s", exc)

    def _interval_seconds(self) -> float:
        """Return the configured interval with a five-minute safety floor.

        Returns:
            Rotation interval in seconds.
        """
        try:
            hours = float(self.config.get("interval_hours", 24.0))
        except (TypeError, ValueError):
            hours = 24.0
        return max(300.0, min(hours * 3600.0, 30 * 24 * 3600.0))

    def _list_avatars(self) -> list[Path]:
        """List QQ-uploaded and WebUI-uploaded avatars in deterministic order.

        Returns:
            Sorted avatar paths.
        """
        avatars: list[Path] = []
        try:
            avatars.extend(
                path
                for path in self.avatar_dir.iterdir()
                if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
            )
        except OSError as exc:
            logger.error("[AvatarRotator] Failed to scan avatar library: %s", exc)

        configured_files = self.config.get("avatar_files", [])
        if isinstance(configured_files, list):
            data_root = self.data_dir.resolve(strict=False)
            for raw_path in configured_files:
                if not isinstance(raw_path, str) or not raw_path.strip():
                    continue
                candidate = (data_root / Path(raw_path)).resolve(strict=False)
                try:
                    candidate.relative_to(data_root)
                except ValueError:
                    logger.warning(
                        "[AvatarRotator] Ignoring WebUI avatar outside plugin data: %s",
                        raw_path,
                    )
                    continue
                if (
                    candidate.is_file()
                    and candidate.suffix.lower() in SUPPORTED_EXTENSIONS
                ):
                    avatars.append(candidate)

        unique: dict[str, Path] = {}
        for path in avatars:
            unique[str(path.resolve(strict=False)).casefold()] = path
        return sorted(unique.values(), key=self._avatar_key)

    def _avatar_key(self, avatar: Path) -> str:
        """Return a stable identity for one avatar inside plugin storage.

        Args:
            avatar: Avatar file path.

        Returns:
            Stable path key used by rotation state.
        """
        resolved = avatar.resolve(strict=False)
        try:
            return resolved.relative_to(self.data_dir.resolve(strict=False)).as_posix()
        except ValueError:
            return resolved.as_posix()

    def _is_webui_avatar(self, avatar: Path) -> bool:
        """Check whether an avatar belongs to the WebUI upload collection.

        Args:
            avatar: Avatar file path.

        Returns:
            Whether the path appears in the WebUI file configuration.
        """
        target_key = self._avatar_key(avatar)
        configured_files = self.config.get("avatar_files", [])
        if not isinstance(configured_files, list):
            return False
        for raw_path in configured_files:
            if not isinstance(raw_path, str):
                continue
            if self._avatar_key(self.data_dir / Path(raw_path)) == target_key:
                return True
        return False

    def _select_avatar(self, avatars: list[Path]) -> Path:
        """Select the next avatar without an immediate repeat.

        Args:
            avatars: Available avatar paths.

        Returns:
            Selected avatar path.
        """
        last_avatar = str(self.state.get("last_avatar", ""))
        if len(avatars) == 1:
            return avatars[0]

        mode = str(self.config.get("selection_mode", "random")).lower()
        if mode == "sequential":
            keys = [self._avatar_key(path) for path in avatars]
            names = [path.name for path in avatars]
            if last_avatar in keys:
                return avatars[(keys.index(last_avatar) + 1) % len(avatars)]
            if last_avatar in names:
                return avatars[(names.index(last_avatar) + 1) % len(avatars)]
            return avatars[0]

        candidates = [
            path
            for path in avatars
            if self._avatar_key(path) != last_avatar and path.name != last_avatar
        ]
        return random.SystemRandom().choice(candidates or avatars)

    def _get_background_bot(self) -> tuple[Any, str]:
        """Find the configured aiocqhttp client for scheduled changes.

        Returns:
            Bot client and platform ID.

        Raises:
            RuntimeError: If no matching aiocqhttp platform is available.
        """
        target_id = str(self.config.get("platform_id", "")).strip()
        matches: list[tuple[Any, str]] = []
        for platform in self.context.platform_manager.get_insts():
            try:
                metadata = platform.meta()
            except Exception:
                continue
            if getattr(metadata, "name", "") != "aiocqhttp":
                continue
            platform_id = str(
                getattr(metadata, "id", "")
                or getattr(platform, "config", {}).get("id", "")
            )
            if target_id and platform_id != target_id:
                continue
            get_client = getattr(platform, "get_client", None)
            client = (
                get_client() if callable(get_client) else getattr(platform, "bot", None)
            )
            if client is not None:
                matches.append((client, platform_id or "aiocqhttp"))

        if not matches:
            if target_id:
                raise RuntimeError(f"找不到平台ID为 {target_id} 的aiocqhttp连接")
            raise RuntimeError("找不到可用的aiocqhttp/NapCat连接")
        if len(matches) > 1 and not target_id:
            raise RuntimeError("检测到多个QQ平台，请在插件配置中填写platform_id")
        return matches[0]

    async def _rotate_avatar(self, bot: Any | None = None) -> Path:
        """Select and apply one avatar, then reschedule the next run.

        Args:
            bot: Optional aiocqhttp client supplied by a command event.

        Returns:
            Applied avatar path.

        Raises:
            RuntimeError: If the library is empty or the NapCat API fails.
        """
        async with self._rotation_lock:
            avatars = self._list_avatars()
            if not avatars:
                raise RuntimeError(
                    "头像库为空，请在插件配置页上传图片，或使用 /添加轮换头像"
                )
            selected = self._select_avatar(avatars)
            if bot is None:
                bot, _ = self._get_background_bot()

            try:
                retry_count = max(0, min(int(self.config.get("api_retry_count", 2)), 5))
            except (TypeError, ValueError):
                retry_count = 2
            try:
                retry_delay = max(
                    1, min(int(self.config.get("api_retry_delay_seconds", 10)), 120)
                )
            except (TypeError, ValueError):
                retry_delay = 10
            try:
                timeout = max(
                    10, min(int(self.config.get("api_timeout_seconds", 60)), 180)
                )
            except (TypeError, ValueError):
                timeout = 60

            payload_source = await self._prepare_payload_source(selected)

            last_error: Exception | None = None
            for attempt in range(retry_count + 1):
                try:
                    call_action = getattr(bot, "call_action", None)
                    if callable(call_action):
                        call = call_action(
                            action="set_qq_avatar", file=str(payload_source)
                        )
                    else:
                        set_avatar = getattr(bot, "set_qq_avatar", None)
                        if not callable(set_avatar):
                            raise RuntimeError("当前QQ客户端不提供set_qq_avatar接口")
                        call = set_avatar(file=str(payload_source))
                    await asyncio.wait_for(call, timeout=timeout)
                    last_error = None
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    last_error = exc
                    if attempt < retry_count:
                        logger.warning(
                            "[AvatarRotator] Avatar update attempt %s failed: %s",
                            attempt + 1,
                            exc,
                        )
                        await asyncio.sleep(retry_delay)

            if last_error is not None:
                self.state["last_error"] = str(last_error)
                self._save_state()
                raise RuntimeError(f"NapCat更换头像失败：{last_error}") from last_error

            now = time.time()
            interval = self._interval_seconds()
            self.state.update(
                {
                    "last_avatar": self._avatar_key(selected),
                    "last_changed_at": now,
                    "next_run_at": now + interval,
                    "interval_seconds": interval,
                    "last_error": "",
                }
            )
            self._save_state()
            logger.info("[AvatarRotator] QQ avatar changed to %s", selected.name)
            return selected

    async def _prepare_payload_source(self, selected: Path) -> Path:
        """Apply crop metadata to ``selected`` if any, producing a payload path.

        QQ avatar framing is a fixed square: the QT client re-centers the
        uploaded image and discards whatever does not fit. To control the
        framing precisely the plugin accepts a per-image crop rectangle in
        source coordinates; this routine materializes that crop into a
        temporary JPEG used for the upload, then schedules its cleanup.

        Args:
            selected: Original avatar file path.

        Returns:
            Either ``selected`` itself (if no crop is configured) or a path
            to a temporary cropped copy that the caller must NOT delete by
            reference (it is managed by :meth:`_finalize_payload_source`).
        """
        crop = self.crops.get(self._avatar_key(selected))
        if not crop:
            return selected
        digest = hashlib.sha256(
            f"{selected.resolve()}::{json.dumps(crop, sort_keys=True)}".encode("utf-8")
        ).hexdigest()[:12]
        target = self.data_dir / f".cropped_{digest}.jpg"
        try:
            target_exists = target.is_file()
        except OSError:
            target_exists = False
        if target_exists:
            return target
        try:
            await asyncio.to_thread(self._apply_crop, selected, target, crop)
        except Exception as exc:
            logger.warning(
                "[AvatarRotator] Failed to crop %s, sending original: %s",
                selected.name,
                exc,
            )
            return selected
        return target

    @staticmethod
    def _apply_crop(source: Path, target: Path, crop: dict[str, float]) -> None:
        """Materialise a cropped JPEG on disk (synchronous, runs in a thread)."""
        with PILImage.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.load()
            width, height = image.size
            x = max(0, min(int(round(float(crop["x"]))), max(0, width - 1)))
            y = max(0, min(int(round(float(crop["y"]))), max(0, height - 1)))
            w = max(1, min(int(round(float(crop["w"]))), width - x))
            h = max(1, min(int(round(float(crop["h"]))), height - y))
            box = (x, y, x + w, y + h)
            cropped = image.crop(box)
            if cropped.mode not in {"RGB"}:
                cropped = cropped.convert("RGB")
            target.parent.mkdir(parents=True, exist_ok=True)
            cropped.save(target, format="JPEG", quality=94, optimize=True)

    async def _webui_list_avatars(self) -> Any:
        """Return a JSON-friendly list of avatars + crop state."""
        items: list[dict[str, Any]] = []
        for path in self._list_avatars():
            key = self._avatar_key(path)
            try:
                size = path.stat().st_size
            except OSError:
                size = 0
            crop = self.crops.get(key)
            try:
                with PILImage.open(path) as img:
                    width, height = img.size
            except Exception:
                width, height = 0, 0
            items.append(
                {
                    "key": key,
                    "name": path.name,
                    "size": size,
                    "width": width,
                    "height": height,
                    "source": "qq" if not self._is_webui_avatar(path) else "webui",
                    "crop": crop,
                    "has_crop": crop is not None,
                }
            )
        return _ok(
            {
                "avatars": items,
                "selection_mode": self.config.get("selection_mode", "random"),
                "state": {
                    "last_avatar": self.state.get("last_avatar", ""),
                    "last_changed_at": self.state.get("last_changed_at", 0.0),
                    "next_run_at": self.state.get("next_run_at", 0.0),
                    "paused": bool(self.state.get("paused", False)),
                    "last_error": self.state.get("last_error", ""),
                },
            }
        )

    async def _webui_upload_avatar(self) -> Any:
        """Receive a multipart upload via the page bridge."""
        if request is None:
            return _err("page bridge unavailable", status_code=503)
        try:
            files = await request.files()
        except Exception as exc:
            return _err(f"failed to parse upload: {exc}", status_code=400)
        upload = files.get("file") if isinstance(files, dict) else None
        if not isinstance(upload, PluginUploadFile):
            return _err("missing 'file' field", status_code=400)
        raw_bytes = await upload.read()
        if not raw_bytes:
            return _err("empty upload", status_code=400)
        try:
            max_upload_mb = max(1, min(int(self.config.get("max_upload_mb", 15)), 50))
        except (TypeError, ValueError):
            max_upload_mb = 15
        if len(raw_bytes) > max_upload_mb * 1024 * 1024:
            return _err(f"file exceeds {max_upload_mb} MB", status_code=413)
        original_name = Path(upload.filename or "upload.jpg").name
        suffix = Path(original_name).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            suffix = ".jpg"
        # Reuse the existing normalise pipeline for consistency.
        try:
            normalized = await asyncio.to_thread(self._normalise_image_bytes, raw_bytes)
        except ValueError as exc:
            return _err(str(exc), status_code=400)
        digest = hashlib.sha256(normalized).hexdigest()[:12]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        destination = self.avatar_dir / f"{timestamp}_{digest}.jpg"
        temporary = destination.with_suffix(".jpg.tmp")
        try:
            await asyncio.to_thread(temporary.write_bytes, normalized)
            temporary.replace(destination)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            return _err(f"failed to save upload: {exc}", status_code=500)
        # Track the new upload in the WebUI file config so the existing
        # _list_avatars() pipeline picks it up without further changes.
        existing = self.config.get("avatar_files", [])
        if not isinstance(existing, list):
            existing = []
        relative_key = self._avatar_key(destination)
        if relative_key not in existing:
            new_list = list(existing) + [relative_key]
            self.config["avatar_files"] = new_list
            try:
                save_async = getattr(self.config, "save_config_async", None)
                if callable(save_async):
                    await save_async()
                else:
                    await asyncio.to_thread(self.config.save_config)
            except Exception as exc:
                logger.warning(
                    "[AvatarRotator] Failed to persist avatar_files: %s",
                    exc,
                )
        return _ok(
            {
                "key": self._avatar_key(destination),
                "name": destination.name,
                "size": len(normalized),
            }
        )

    @staticmethod
    def _normalise_image_bytes(raw_bytes: bytes) -> bytes:
        """Convert any supported image to a JPEG byte string (synchronous)."""
        with PILImage.open(BytesIO(raw_bytes)) as image:
            image.seek(0)
            image = ImageOps.exif_transpose(image)
            image.load()
            if image.width < 32 or image.height < 32:
                raise ValueError("图片尺寸不能小于32×32")
            image.thumbnail((2048, 2048), PILImage.Resampling.LANCZOS)
            if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                rgba = image.convert("RGBA")
                background = PILImage.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=94, optimize=True)
            return output.getvalue()

    def _resolve_avatar_by_key(self, key: str) -> Path | None:
        """Look up an avatar path by its stable key suffix."""
        for path in self._list_avatars():
            if self._avatar_key(path) == key:
                return path
        return None

    def _webui_get_avatar_image(self, key: str) -> Any:
        """Return the avatar bytes for the cropper preview.

        By default this returns a Starlette ``FileResponse`` (binary JPEG).
        Pass ``?format=data_url`` to receive a JSON envelope ``{"image":
        "data:image/jpeg;base64,..."}`` instead, which the WebUI page can
        assign directly to ``<img src>`` — the iframe's ``bridge.apiGet``
        postMessage proxy cannot return binary payloads to the page.

        Pass ``?size=N`` (32..1024) to downscale the image on the server
        (Pillow) before sending. The WebUI uses this for two-stage
        loading: a tiny blurred preview first, then a sharp version on
        top once the preview is in place. Saves both bandwidth and the
        "blank while loading" gap on slow connections.
        """
        path = self._resolve_avatar_by_key(key)
        if path is None:
            return _err("avatar not found", status_code=404)
        try:
            # read_bytes validates the file is readable before we hand it off.
            path.read_bytes()
        except OSError as exc:
            return _err(f"failed to read avatar: {exc}", status_code=500)

        size = self._requested_thumb_size()
        if size is not None:
            thumb_path = self._thumb_cache_path(path, size)
            if not thumb_path.is_file():
                try:
                    self._render_thumb(path, thumb_path, size)
                except Exception as exc:
                    logger.warning(
                        "[AvatarRotator] Failed to render thumb for %s: %s",
                        path.name, exc,
                    )
                    return _maybe_image_response(path, content_type="image/jpeg")
            return _maybe_image_response(thumb_path, content_type="image/jpeg")

        return _maybe_image_response(path, content_type="image/jpeg")

    @staticmethod
    def _requested_thumb_size() -> int | None:
        """Return the requested thumbnail size (px) or ``None`` for the original.

        Reads ``?size=`` from the current plugin request query. Clamps to
        a safe 32..1024 range. Returns ``None`` when the param is missing
        or invalid so the caller falls back to the full-resolution image.
        """
        if request is None:
            return None
        try:
            raw = request.query.get("size")
        except Exception:
            return None
        if raw is None:
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        if value < 32 or value > 1024:
            return None
        return value

    def _thumb_cache_path(self, source: Path, size: int) -> Path:
        """Return the on-disk cache path for a downscaled avatar."""
        digest = hashlib.sha256(
            f"{source.resolve()}::{size}".encode("utf-8")
        ).hexdigest()[:12]
        return self.data_dir / f".thumb_{size}_{digest}.jpg"

    @staticmethod
    def _render_thumb(source: Path, target: Path, size: int) -> None:
        """Render a downscaled JPEG copy of ``source`` into ``target``."""
        with PILImage.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.load()
            image.thumbnail((size, size), PILImage.Resampling.LANCZOS)
            if image.mode != "RGB":
                image = image.convert("RGB")
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, format="JPEG", quality=78, optimize=True)

    async def _webui_set_or_clear_crop(self, key: str) -> Any:
        """Persist the crop rectangle or clear it depending on the payload.

        A payload containing ``x``, ``y``, ``w`` and ``h`` (all positive
        numbers) sets the crop. Any other payload (missing keys, empty
        body, or non-positive dimensions) clears the crop.

        Args:
            key: Avatar key (relative path under the plugin data dir).

        Returns:
            JSON response with the new crop (or ``cleared: true``).
        """
        path = self._resolve_avatar_by_key(key)
        if path is None:
            return _err("avatar not found", status_code=404)
        if request is None:
            return _err("page bridge unavailable", status_code=503)
        try:
            payload = await request.json(default={})
        except Exception as exc:
            return _err(f"invalid JSON: {exc}", status_code=400)
        if not isinstance(payload, dict):
            payload = {}
        try:
            x = float(payload.get("x", 0))
            y = float(payload.get("y", 0))
            w = float(payload.get("w", 0))
            h = float(payload.get("h", 0))
        except (TypeError, ValueError):
            x = y = w = h = 0
        if w <= 0 or h <= 0:
            self.crops.pop(key, None)
            self._save_crops()
            self._cleanup_stale_crop_cache()
            return _ok({"cleared": True})
        try:
            with PILImage.open(path) as img:
                width, height = img.size
        except Exception as exc:
            return _err(f"failed to read avatar: {exc}", status_code=400)
        if x < 0 or y < 0 or x + w > width + 0.5 or y + h > height + 0.5:
            return _err(
                f"crop [{x},{y},{x + w},{y + h}] outside image {width}x{height}",
                status_code=400,
            )
        try:
            aspect_value = float(payload.get("aspect", 1.0))
        except (TypeError, ValueError):
            aspect_value = 1.0
        self.crops[key] = {
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "aspect": aspect_value,
            "src_w": width,
            "src_h": height,
        }
        self._save_crops()
        self._cleanup_stale_crop_cache()
        return _ok({"crop": self.crops[key]})

    async def _webui_delete_avatar(self, key: str) -> Any:
        """Delete an avatar from the library and clear its crop entry."""
        path = self._resolve_avatar_by_key(key)
        if path is None:
            return _err("avatar not found", status_code=404)
        webui_avatar = self._is_webui_avatar(path)
        try:
            path.unlink()
        except OSError as exc:
            return _err(f"delete failed: {exc}", status_code=500)
        if webui_avatar:
            existing = self.config.get("avatar_files", [])
            if isinstance(existing, list):
                retained = [
                    value
                    for value in existing
                    if not (
                        isinstance(value, str)
                        and self._avatar_key(self.data_dir / Path(value)) == key
                    )
                ]
                self.config["avatar_files"] = retained
                try:
                    save_async = getattr(self.config, "save_config_async", None)
                    if callable(save_async):
                        await save_async()
                    else:
                        await asyncio.to_thread(self.config.save_config)
                except Exception as exc:
                    logger.warning(
                        "[AvatarRotator] Failed to update avatar_files: %s",
                        exc,
                    )
        self.crops.pop(key, None)
        self._save_crops()
        self._cleanup_stale_crop_cache()
        if self.state.get("last_avatar") in {key, path.name}:
            self.state["last_avatar"] = ""
            self._save_state()
        return _ok({"deleted": True})

    async def _webui_rotate_now(self) -> Any:
        """Trigger an immediate rotation using the configured selection."""
        try:
            bot, _ = self._get_background_bot()
        except RuntimeError as exc:
            return _err(str(exc), status_code=400)
        try:
            selected = await self._rotate_avatar(bot)
        except Exception as exc:
            return _err(str(exc), status_code=500)
        return _ok({"rotated": self._avatar_key(selected)})

    def _webui_state(self) -> Any:
        """Return a snapshot of the scheduler + crop state."""
        return _ok(
            {
                "paused": bool(self.state.get("paused", False)),
                "enabled": bool(self.config.get("enabled", True)),
                "selection_mode": self.config.get("selection_mode", "random"),
                "interval_seconds": self._interval_seconds(),
                "last_avatar": self.state.get("last_avatar", ""),
                "last_changed_at": self.state.get("last_changed_at", 0.0),
                "next_run_at": self.state.get("next_run_at", 0.0),
                "last_error": self.state.get("last_error", ""),
                "avatar_count": len(self._list_avatars()),
                "crop_count": len(self.crops),
            }
        )

    def _webui_download_stripped(self, key: str) -> Any:
        """Return the cropped JPEG used for one avatar (or the original).

        Same response shape switch as ``_webui_get_avatar_image``: by default
        a binary ``FileResponse``; ``?format=data_url`` returns a
        ``{"image": "data:image/jpeg;base64,..."}`` envelope so the WebUI page
        can render the cropped preview through ``bridge.apiGet``.

        ``?size=N`` (32..1024) downscales the cropped JPEG before
        sending. The crop modal uses the full-resolution file; the
        ``/stripped`` endpoint in particular is only consumed by the
        modal so we keep the default behaviour for it.
        """
        path = self._resolve_avatar_by_key(key)
        if path is None:
            return _err("avatar not found", status_code=404)
        crop = self.crops.get(key)
        if not crop:
            return self._maybe_thumbed_image_response(
                path, content_type="image/jpeg"
            )
        digest = hashlib.sha256(
            f"{path.resolve()}::{json.dumps(crop, sort_keys=True)}".encode("utf-8")
        ).hexdigest()[:12]
        target = self.data_dir / f".cropped_{digest}.jpg"
        try:
            target_exists = target.is_file()
        except OSError:
            target_exists = False
        if not target_exists:
            try:
                self._apply_crop(path, target, crop)
            except Exception as exc:
                return _err(f"failed to crop: {exc}", status_code=500)

        return self._maybe_thumbed_image_response(
            target, content_type="image/jpeg", filename=f"cropped_{path.stem}.jpg",
        )

    def _maybe_thumbed_image_response(
        self,
        path: Path,
        *,
        content_type: str = "image/jpeg",
        filename: str | None = None,
    ) -> Any:
        """Return either a downscaled or full-resolution image response.

        Used by ``/image`` and ``/stripped`` so the WebUI can pull a
        tiny preview first (CSS-blurred) and a sharp version later.
        Honours the same ``?size=`` query parameter as
        ``_webui_get_avatar_image``; falls back to the full file when
        absent.
        """
        size = self._requested_thumb_size()
        if size is not None:
            thumb_path = self._thumb_cache_path(path, size)
            if not thumb_path.is_file():
                try:
                    self._render_thumb(path, thumb_path, size)
                except Exception as exc:
                    logger.warning(
                        "[AvatarRotator] Failed to render thumb for %s: %s",
                        path.name, exc,
                    )
                    return _maybe_image_response(
                        path, content_type=content_type, filename=filename
                    )
            return _maybe_image_response(
                thumb_path, content_type=content_type, filename=filename
            )
        return _maybe_image_response(path, content_type=content_type, filename=filename)

    def _cleanup_stale_crop_cache(self) -> None:
        """Remove cached cropped payload + thumbnail files older than 7 days."""
        cutoff = time.time_ns() - 7 * 24 * 3600 * 1_000_000_000
        for pattern in (".cropped_*.jpg", ".thumb_*.jpg"):
            try:
                entries = list(self.data_dir.glob(pattern))
            except OSError:
                continue
            for entry in entries:
                try:
                    if entry.is_file() and entry.stat().st_mtime_ns < cutoff:
                        entry.unlink(missing_ok=True)
                except OSError:
                    continue

    async def _worker_loop(self) -> None:
        """Run the persistent fixed-interval rotation scheduler."""
        try:
            try:
                startup_delay = max(
                    0,
                    min(int(self.config.get("startup_delay_seconds", 30)), 600),
                )
            except (TypeError, ValueError):
                startup_delay = 30
            if startup_delay:
                await asyncio.sleep(startup_delay)

            while not self._stopping:
                if not bool(self.config.get("enabled", True)) or bool(
                    self.state.get("paused", False)
                ):
                    await asyncio.sleep(30)
                    continue

                now = time.time()
                interval = self._interval_seconds()
                next_run = float(self.state.get("next_run_at", 0.0) or 0.0)
                stored_interval = float(self.state.get("interval_seconds", 0.0) or 0.0)
                if next_run <= 0:
                    next_run = (
                        now
                        if bool(self.config.get("change_on_start", False))
                        else now + interval
                    )
                    self.state["next_run_at"] = next_run
                    self.state["interval_seconds"] = interval
                    self._save_state()
                elif abs(stored_interval - interval) > 1:
                    next_run = now + interval
                    self.state["next_run_at"] = next_run
                    self.state["interval_seconds"] = interval
                    self._save_state()

                remaining = next_run - now
                if remaining > 0:
                    await asyncio.sleep(min(remaining, 30))
                    continue

                try:
                    await self._rotate_avatar()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    try:
                        retry_minutes = max(
                            1,
                            min(
                                int(self.config.get("failure_retry_minutes", 30)),
                                24 * 60,
                            ),
                        )
                    except (TypeError, ValueError):
                        retry_minutes = 30
                    self.state["last_error"] = str(exc)
                    self.state["next_run_at"] = time.time() + retry_minutes * 60
                    self._save_state()
                    logger.warning("[AvatarRotator] Scheduled rotation failed: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[AvatarRotator] Scheduler stopped unexpectedly")

    async def _store_uploaded_image(self, component: Comp.Image) -> tuple[Path, bool]:
        """Resolve, validate, normalize, and store one uploaded image.

        Args:
            component: AstrBot image message component.

        Returns:
            Stored path and whether it already existed.

        Raises:
            ValueError: If the image is invalid or exceeds configured limits.
        """
        source_path = Path(await component.convert_to_file_path())
        try:
            raw_bytes = await asyncio.to_thread(source_path.read_bytes)
        except OSError as exc:
            raise ValueError(f"读取图片失败：{exc}") from exc

        try:
            max_upload_mb = max(1, min(int(self.config.get("max_upload_mb", 15)), 50))
        except (TypeError, ValueError):
            max_upload_mb = 15
        if len(raw_bytes) > max_upload_mb * 1024 * 1024:
            raise ValueError(f"图片超过 {max_upload_mb} MB 上限")

        def normalize_image() -> bytes:
            """Convert the first frame to a broadly compatible JPEG.

            Returns:
                Normalized JPEG bytes.
            """
            try:
                with PILImage.open(BytesIO(raw_bytes)) as image:
                    image.seek(0)
                    image = ImageOps.exif_transpose(image)
                    image.load()
                    if image.width < 32 or image.height < 32:
                        raise ValueError("图片尺寸不能小于32×32")
                    image.thumbnail((2048, 2048), PILImage.Resampling.LANCZOS)
                    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                        rgba = image.convert("RGBA")
                        background = PILImage.new("RGB", rgba.size, "white")
                        background.paste(rgba, mask=rgba.getchannel("A"))
                        image = background
                    else:
                        image = image.convert("RGB")
                    output = BytesIO()
                    image.save(output, format="JPEG", quality=94, optimize=True)
                    return output.getvalue()
            except UnidentifiedImageError as exc:
                raise ValueError("文件不是有效图片") from exc

        normalized = await asyncio.to_thread(normalize_image)
        digest = hashlib.sha256(normalized).hexdigest()[:12]
        duplicate = next(self.avatar_dir.glob(f"*_{digest}.jpg"), None)
        if duplicate:
            return duplicate, True

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        destination = self.avatar_dir / f"{timestamp}_{digest}.jpg"
        temporary = destination.with_suffix(".jpg.tmp")
        try:
            await asyncio.to_thread(temporary.write_bytes, normalized)
            temporary.replace(destination)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise ValueError(f"保存图片失败：{exc}") from exc
        return destination, False

    @filter.on_astrbot_loaded()
    async def on_astrbot_loaded(self) -> None:
        """Ensure the scheduler is active after full startup."""
        self._ensure_worker()

    @filter.on_platform_loaded()
    async def on_platform_loaded(self) -> None:
        """Ensure the scheduler is active after platform reloads."""
        self._ensure_worker()

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.platform_adapter_type(filter.PlatformAdapterType.AIOCQHTTP)
    @filter.command("添加轮换头像")
    async def add_avatars(self, event: AiocqhttpMessageEvent):
        """Upload images from the current or quoted message to the library."""
        components: list[Comp.Image] = []
        for segment in event.get_messages():
            if isinstance(segment, Comp.Image):
                components.append(segment)
            elif isinstance(segment, Comp.Reply) and segment.chain:
                components.extend(
                    item for item in segment.chain if isinstance(item, Comp.Image)
                )

        unique_components: list[Comp.Image] = []
        seen_sources: set[str] = set()
        for component in components:
            source = str(component.url or component.file or component.path or "")
            if source and source not in seen_sources:
                seen_sources.add(source)
                unique_components.append(component)

        if not unique_components:
            yield event.plain_result(
                "请把图片与 /添加轮换头像 放在同一条消息中，或者引用一条图片消息再发送该指令。"
            )
            return
        if len(unique_components) > MAX_IMAGES_PER_COMMAND:
            yield event.plain_result(
                f"一次最多添加 {MAX_IMAGES_PER_COMMAND} 张图片，请分批上传。"
            )
            return

        added = 0
        duplicates = 0
        errors: list[str] = []
        for index, component in enumerate(unique_components, start=1):
            try:
                _, duplicate = await self._store_uploaded_image(component)
                if duplicate:
                    duplicates += 1
                else:
                    added += 1
            except Exception as exc:
                errors.append(f"第{index}张：{exc}")

        parts = [
            f"头像上传完成：新增 {added} 张，重复 {duplicates} 张。",
            f"当前图库共 {len(self._list_avatars())} 张。",
        ]
        if errors:
            parts.append("失败：" + "；".join(errors[:5]))
        yield event.plain_result("\n".join(parts))

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.command("轮换头像列表")
    async def list_avatars(self, event: AiocqhttpMessageEvent):
        """List uploaded avatars by deletion index."""
        avatars = self._list_avatars()
        if not avatars:
            yield event.plain_result(
                "头像库为空，请在插件配置页上传图片，或使用 /添加轮换头像。"
            )
            return
        lines = [f"头像库共有 {len(avatars)} 张："]
        lines.extend(
            f"{index}. [{'WebUI' if self._is_webui_avatar(path) else 'QQ'}] {path.name}"
            for index, path in enumerate(avatars, 1)
        )
        yield event.plain_result("\n".join(lines))

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.command("删除轮换头像")
    async def delete_avatar(self, event: AiocqhttpMessageEvent, avatar_number: int = 0):
        """Delete one uploaded avatar by its one-based list index.

        Args:
            event: QQ command event.
            avatar_number: One-based index shown by the list command.
        """
        avatars = self._list_avatars()
        if avatar_number < 1 or avatar_number > len(avatars):
            yield event.plain_result(
                "请先发送 /轮换头像列表，再使用 /删除轮换头像 序号。"
            )
            return
        target = avatars[avatar_number - 1]
        target_key = self._avatar_key(target)
        webui_avatar = self._is_webui_avatar(target)
        try:
            target.unlink()
        except OSError as exc:
            yield event.plain_result(f"删除失败：{exc}")
            return
        if webui_avatar:
            configured_files = self.config.get("avatar_files", [])
            if isinstance(configured_files, list):
                retained: list[str] = []
                for raw_path in configured_files:
                    if not isinstance(raw_path, str):
                        continue
                    candidate = self.data_dir / Path(raw_path)
                    if self._avatar_key(candidate) != target_key:
                        retained.append(raw_path)
                self.config["avatar_files"] = retained
                try:
                    save_async = getattr(self.config, "save_config_async", None)
                    if callable(save_async):
                        await save_async()
                    else:
                        await asyncio.to_thread(self.config.save_config)
                except Exception as exc:
                    logger.warning(
                        "[AvatarRotator] Failed to update WebUI file config: %s",
                        exc,
                    )
        if self.state.get("last_avatar") in {target_key, target.name}:
            self.state["last_avatar"] = ""
            self._save_state()
        yield event.plain_result(
            f"已删除第 {avatar_number} 张头像，图库还剩 {len(self._list_avatars())} 张。"
        )

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.platform_adapter_type(filter.PlatformAdapterType.AIOCQHTTP)
    @filter.command("立即换头像")
    async def rotate_now(self, event: AiocqhttpMessageEvent):
        """Immediately apply one avatar and reset the interval timer."""
        try:
            selected = await self._rotate_avatar(event.bot)
        except Exception as exc:
            yield event.plain_result(f"更换失败：{exc}")
            return
        yield event.plain_result(
            f"头像已经更换为 {selected.name}，下一次自动轮换将从现在重新计时。"
        )

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.command("暂停头像轮换")
    async def pause_rotation(self, event: AiocqhttpMessageEvent):
        """Persistently pause scheduled rotation."""
        self.state["paused"] = True
        self._save_state()
        yield event.plain_result("头像自动轮换已暂停；手动执行 /立即换头像 仍然有效。")

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.command("恢复头像轮换")
    async def resume_rotation(self, event: AiocqhttpMessageEvent):
        """Resume scheduled rotation from a fresh interval."""
        interval = self._interval_seconds()
        self.state["paused"] = False
        self.state["next_run_at"] = time.time() + interval
        self.state["interval_seconds"] = interval
        self._save_state()
        self._ensure_worker()
        yield event.plain_result(
            f"头像自动轮换已恢复，约 {interval / 3600:.2f} 小时后执行下一次。"
        )

    @filter.permission_type(filter.PermissionType.ADMIN)
    @filter.command("头像轮换状态")
    async def rotation_status(self, event: AiocqhttpMessageEvent):
        """Show scheduler, platform, and library status."""
        enabled = bool(self.config.get("enabled", True))
        paused = bool(self.state.get("paused", False))
        next_run_at = float(self.state.get("next_run_at", 0.0) or 0.0)
        last_changed_at = float(self.state.get("last_changed_at", 0.0) or 0.0)
        next_text = (
            datetime.fromtimestamp(next_run_at).strftime("%Y-%m-%d %H:%M:%S")
            if next_run_at
            else "尚未安排"
        )
        last_text = (
            datetime.fromtimestamp(last_changed_at).strftime("%Y-%m-%d %H:%M:%S")
            if last_changed_at
            else "尚未更换"
        )
        lines = [
            f"自动轮换：{'已启用' if enabled else '配置中已关闭'}",
            f"运行状态：{'已暂停' if paused else '正常'}",
            f"轮换方式：{self.config.get('selection_mode', 'random')}",
            f"间隔：{self._interval_seconds() / 3600:.2f} 小时",
            f"图库数量：{len(self._list_avatars())} 张",
            f"上次更换：{last_text}",
            f"下次计划：{next_text}",
            f"QQ上传图库目录：{self.avatar_dir}",
            "WebUI上传：插件配置 → WebUI头像图库",
        ]
        if self.state.get("last_error"):
            lines.append(f"最近错误：{self.state['last_error']}")
        yield event.plain_result("\n".join(lines))

    async def terminate(self) -> None:
        """Cancel the scheduler during unload or hot reload."""
        self._stopping = True
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            await asyncio.gather(self._worker_task, return_exceptions=True)
        logger.info("[AvatarRotator] Plugin stopped")

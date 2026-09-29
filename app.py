import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, url_for
from werkzeug.exceptions import HTTPException

from content import build_browse_payload, build_text_payload, normalize_study_mode

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

STATIC_ASSET_FILES = (
    "css/base.css",
    "css/select.css",
    "css/study.css",
    "js/theme-init.js",
    "js/core.js",
    "js/select.js",
    "js/annotations.js",
    "js/study.js",
    "js/navigation.js",
    "img/rion.png",
)


@app.context_processor
def _inject_static_assets():
    static_root = Path(app.static_folder)
    version = max((static_root / filename).stat().st_mtime_ns for filename in STATIC_ASSET_FILES)

    def static_asset(filename: str) -> str:
        return url_for("static", filename=filename, v=version)

    return {
        "static_asset": static_asset,
        "static_asset_version": version,
    }


@app.before_request
def _start_timer():
    request._start_time = time.monotonic()


@app.after_request
def _prepare_response(response):
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "base-uri 'self'; "
        "connect-src 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        "img-src 'self'; "
        "object-src 'none'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), geolocation=(), microphone=()",
    )
    if request.is_secure:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )

    duration_ms = int((time.monotonic() - request._start_time) * 1000)
    now = datetime.now(timezone.utc).strftime("%d/%b/%Y:%H:%M:%S +0000")
    logger.info(
        '%s - - [%s] "%s %s %s" %d %s "%s" "%s" %dms',
        request.remote_addr,
        now,
        request.method,
        request.full_path.rstrip("?"),
        request.environ.get("SERVER_PROTOCOL", "HTTP/1.1"),
        response.status_code,
        response.content_length if response.content_length is not None else "-",
        request.referrer or "-",
        request.user_agent,
        duration_ms,
    )
    return response


@app.errorhandler(HTTPException)
def _handle_http_exception(error: HTTPException):
    if request.path.startswith("/api/"):
        response = jsonify({"message": error.description})
        response.status_code = error.code or 500
        return response
    return error


def _render_select_page(subdirectory: str = "") -> str:
    return render_template("select.html", browse=build_browse_payload(subdirectory, allow_missing=True))


def _render_study_page(text_path: str, mode: str | None) -> str:
    study_mode = normalize_study_mode(mode)
    return render_template(
        "study.html",
        text=build_text_payload(text_path),
        mode=study_mode,
    )


@app.route("/")
def index() -> str:
    return _render_select_page("")


@app.route("/select/")
@app.route("/select/<path:subdirectory>")
def select_page(subdirectory: str = "") -> str:
    return _render_select_page(subdirectory)


@app.route("/study/<path:text_path>")
def study_page(text_path: str) -> str:
    return _render_study_page(text_path, request.args.get("mode"))


@app.route("/practice/<path:text_path>")
def legacy_practice_page(text_path: str):
    return redirect(url_for("study_page", text_path=text_path, mode="practice"), code=302)


@app.route("/fill/<path:text_path>")
def legacy_fill_page(text_path: str):
    return redirect(url_for("study_page", text_path=text_path, mode="fill"), code=302)


@app.route("/line/<path:text_path>")
def legacy_line_page(text_path: str):
    return redirect(url_for("study_page", text_path=text_path, mode="line"), code=302)


@app.get("/api/browse/")
@app.get("/api/browse/<path:subdirectory>")
def browse_api(subdirectory: str = ""):
    return jsonify(build_browse_payload(subdirectory))


@app.get("/api/text/<path:text_path>")
def text_api(text_path: str):
    return jsonify(build_text_payload(text_path))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

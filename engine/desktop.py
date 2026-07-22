"""Drug Design Studio — desktop entry point.

Starts the local engine (FastAPI, serving the API + bundled UI) in a background
thread, shows a "Starting…" splash in a NATIVE window (pywebview: WKWebView on
macOS, WebView2 on Windows), then navigates to the app the moment the engine is
ready. If the engine fails to start, its traceback is written to a log file and
shown in the window (instead of a bare "127.0.0.1 refused to connect").
"""
import os
import sys
import time
import base64
import threading
import traceback
import urllib.request


def _log_path():
    from ddsengine.paths import data_dir
    return os.path.join(data_dir(), "engine.log")


class _Bridge:
    """Exposed to the web UI as window.pywebview.api. Lets the browser-style
    exports (which don't work inside a native webview) save via a native dialog."""

    def save_file(self, filename, content_b64):
        import webview
        try:
            win = webview.windows[0]
            result = win.create_file_dialog(webview.SAVE_DIALOG, save_filename=filename)
            if not result:
                return False
            path = result[0] if isinstance(result, (list, tuple)) else result
            with open(path, "wb") as f:
                f.write(base64.b64decode(content_b64))
            return True
        except Exception:
            return False


def _run_engine(port):
    try:
        import uvicorn
        from app import app
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        server = uvicorn.Server(config)
        server.install_signal_handlers = lambda: None  # not the main thread
        server.run()
    except BaseException:
        try:
            with open(_log_path(), "w") as f:
                f.write("=== DDS engine failed to start ===\n")
                f.write(traceback.format_exc())
        except Exception:
            pass


def _wait_ready(port, timeout_s=180):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


_SPLASH = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0}body{font-family:-apple-system,Segoe UI,Arial,sans-serif;
background:#0b1220;color:#cbd5e1;display:flex;flex-direction:column;align-items:center;justify-content:center}
.s{width:38px;height:38px;border:3px solid #1c2842;border-top-color:#2dd4bf;border-radius:50%;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}h1{font-size:17px;color:#fff;margin:20px 0 6px}p{font-size:12.5px;color:#64748b;max-width:520px;text-align:center;line-height:1.6}
code{color:#93c5fd}</style></head><body><div class="s"></div>
<h1>Starting Drug Design Studio…</h1><p id="m">Preparing the local engine. The first launch can take up to a minute while Windows scans the app.</p>
</body></html>"""


def _error_html(log):
    safe = (log or "no log found").replace("&", "&amp;").replace("<", "&lt;")
    return ("<!doctype html><html><head><meta charset='utf-8'><style>"
            "body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:32px}"
            "h1{color:#f87171;font-size:18px}pre{background:#111c30;border:1px solid #24344c;border-radius:8px;"
            "padding:14px;font-size:11px;color:#fca5a5;white-space:pre-wrap;overflow:auto;max-height:60vh}"
            "code{color:#93c5fd}</style></head><body>"
            "<h1>The DDS engine did not start</h1>"
            "<p>Please close and reopen the app. If it keeps failing, send this log to the developer:</p>"
            "<pre>" + safe + "</pre></body></html>")


def main():
    os.environ.setdefault("DDS_PORT", "8765")
    port = int(os.environ["DDS_PORT"])

    threading.Thread(target=_run_engine, args=(port,), daemon=True).start()

    import webview
    from ddsengine.paths import data_dir
    store = os.path.join(data_dir(), "webview")
    os.makedirs(store, exist_ok=True)
    window = webview.create_window(
        "Drug Design Studio", html=_SPLASH, js_api=_Bridge(),
        width=1440, height=920, min_size=(1100, 720),
    )

    def _navigate():
        if _wait_ready(port):
            window.load_url("http://127.0.0.1:%d/" % port)
        else:
            log = ""
            try:
                log = open(_log_path()).read()[-4000:]
            except Exception:
                pass
            window.load_html(_error_html(log))

    threading.Thread(target=_navigate, daemon=True).start()
    # private_mode=False + storage_path => localStorage persists (licence gate shows once)
    webview.start(private_mode=False, storage_path=store)


if __name__ == "__main__":
    main()

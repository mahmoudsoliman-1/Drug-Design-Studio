"""Drug Design Studio — desktop entry point.

Starts the local engine (FastAPI, serving both the API and the bundled UI) in a
background thread, then opens the UI in a NATIVE application window (pywebview:
WKWebView on macOS, WebView2/Edge on Windows). This is the target packaged by
PyInstaller.
"""
import os
import time
import threading
import urllib.request


def _run_engine(port):
    import uvicorn
    from app import app
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info", access_log=True)
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None  # not running in the main thread
    server.run()


def _wait_ready(port, timeout_s=60):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1)
            return True
        except Exception:
            time.sleep(0.4)
    return False


def main():
    os.environ.setdefault("DDS_PORT", "8765")
    port = int(os.environ["DDS_PORT"])

    threading.Thread(target=_run_engine, args=(port,), daemon=True).start()
    _wait_ready(port)

    import webview
    webview.create_window(
        "Drug Design Studio",
        "http://127.0.0.1:%d/" % port,
        width=1440, height=920, min_size=(1100, 720),
    )
    webview.start()   # blocks on the native GUI loop; returns when the window closes


if __name__ == "__main__":
    main()

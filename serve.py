import argparse
import socket


def can_bind(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError as exc:
            return False, exc
    return True, None


def select_port(host, requested_port, max_attempts=20):
    available, error = can_bind(host, requested_port)
    if available:
        return requested_port

    print(f" * Port {requested_port} is unavailable on {host}: {error}")
    for candidate in range(requested_port + 1, requested_port + max_attempts + 1):
        available, _ = can_bind(host, candidate)
        if available:
            print(f" * Falling back to available port {candidate}")
            return candidate

    raise error

parser = argparse.ArgumentParser()
parser.add_argument("--port", help="Port for debug server to listen on", default=4000)
parser.add_argument(
    "--profile", help="Enable flask_profiler profiling", action="store_true"
)
parser.add_argument(
    "--disable-gevent",
    help="Disable importing gevent and monkey patching",
    action="store_false",
)
args = parser.parse_args()
if args.disable_gevent:
    print(" * Importing gevent and monkey patching. Use --disable-gevent to disable.")
    from gevent import monkey

    monkey.patch_all()

# Import not at top of file to allow gevent to monkey patch uninterrupted
from CTFd import create_app

app = create_app()
host = "127.0.0.1"
port = select_port(host=host, requested_port=int(args.port))

if args.profile:
    from flask_debugtoolbar import DebugToolbarExtension
    import flask_profiler

    app.config["flask_profiler"] = {
        "enabled": app.config["DEBUG"],
        "storage": {"engine": "sqlite"},
        "basicAuth": {"enabled": False},
        "ignore": ["^/themes/.*", "^/events"],
    }
    flask_profiler.init_app(app)
    app.config["DEBUG_TB_PROFILER_ENABLED"] = True
    app.config["DEBUG_TB_INTERCEPT_REDIRECTS"] = False

    toolbar = DebugToolbarExtension()
    toolbar.init_app(app)
    print(f" * Flask profiling running at http://{host}:{port}/flask-profiler/")

app.run(debug=True, threaded=True, host=host, port=port)

"""Build and run the whole Regis stack with one command:   python scripts/dev.py

Starts four processes: the Python core (port 8000), Rust payments (8101), Java analytics (8102) and the
C# mailer (8103). The last three listen on 127.0.0.1 only. Press Ctrl+C to stop everything.

  python scripts/dev.py --no-build     skip building (after the first run)
"""
import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIN = os.name == "nt"
procs: list = []


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    env.setdefault("INTERNAL_TOKEN", "dev-internal-token-change-me-0000000000")
    return env


def need(tool: str, hint: str) -> str:
    path = shutil.which(tool)
    if not path:
        sys.exit(f"Missing '{tool}'. {hint}")
    return path


def run(cmd: list, cwd: Path, env: dict, what: str) -> None:
    print(f"==> {what}")
    r = subprocess.run(cmd, cwd=cwd, env=env, shell=WIN)
    if r.returncode != 0:
        sys.exit(f"Build step failed: {what}")


def stream(name: str, p: subprocess.Popen) -> None:
    for line in iter(p.stdout.readline, b""):
        print(f"[{name}] {line.decode(errors='replace').rstrip()}")


def start(name: str, cmd: list, cwd: Path, env: dict) -> None:
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=False)
    procs.append(p)
    threading.Thread(target=stream, args=(name, p), daemon=True).start()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()
    env = load_env()
    py = sys.executable

    if not args.no_build:
        need("node", "Install Node.js 20 or newer from nodejs.org.")
        need("cargo", "Install Rust from rustup.rs.")
        need("dotnet", "Install the .NET 8 SDK from dotnet.microsoft.com.")
        need("java", "Install JDK 17 or newer (for example Temurin from adoptium.net).")
        web = ROOT / "web"
        if not (web / "node_modules").exists():
            run(["npm", "install"], web, env, "npm install")
        run(["npm", "run", "build"], web, env, "Building the web app (TypeScript)")
        run(["cargo", "build", "--release"], ROOT / "services" / "payments", env, "Building payments (Rust)")
        an = ROOT / "services" / "analytics"
        sources = [str(p) for p in (an / "src").rglob("*.java")]
        if shutil.which("javac"):
            run(["javac", "-d", "out", *sources], an, env, "Compiling analytics (Java)")
        else:
            run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-d", "out", *sources], an, env, "Compiling analytics (Java)")
        extra = env.get("DOTNET_BUILD_ARGS", "").split()
        run(["dotnet", "build", "-c", "Release", "-o", "bin/out", *extra], ROOT / "services" / "mailer", env, "Building mailer (C#)")

    pay = ROOT / "services" / "payments" / "target" / "release" / ("regis-payments.exe" if WIN else "regis-payments")
    start("payments", [str(pay)], ROOT, env)
    start("analytics", ["java", "-cp", str(ROOT / "services" / "analytics" / "out"), "ng.regis.analytics.Main"], ROOT, env)
    start("mailer", ["dotnet", str(ROOT / "services" / "mailer" / "bin" / "out" / "Regis.Mailer.dll")], ROOT, {**env, "OUTBOX_DIR": str(ROOT / "data" / "outbox")})
    time.sleep(2)
    start("core", [py, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], ROOT / "services" / "core", env)
    print("\nRegis is starting.  Shop: http://localhost:8000   Admin: http://localhost:8000/admin\nPress Ctrl+C to stop.\n")
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(1)
        print("A service stopped unexpectedly. See the log above.")
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()


if __name__ == "__main__":
    main()

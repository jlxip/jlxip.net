#!/usr/bin/env python3
"""Serve the built site over local HTTPS using a reusable self-signed certificate."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile


def local_addresses():
    addresses = {"127.0.0.1", "::1"}
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None):
            addresses.add(str(ipaddress.ip_address(result[4][0].split("%")[0])))
    except OSError:
        pass
    # Selecting a route discovers the local IPv4 address without sending packets.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))
            addresses.add(probe.getsockname()[0])
        except OSError:
            pass
    return sorted(addresses)


def certificate(directory, addresses):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    cert, key, metadata = (directory / name for name in ("cert.pem", "key.pem", "addresses.json"))
    if cert.exists() and key.exists() and metadata.exists():
        try:
            if json.loads(metadata.read_text()) == addresses:
                valid = subprocess.run(["openssl", "x509", "-in", str(cert), "-checkend", "86400", "-noout"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if valid.returncode == 0:
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(cert, key)
                    return cert, key
        except (OSError, ValueError, ssl.SSLError):
            pass
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        pending = Path(temporary)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "365",
            "-subj", "/CN=localhost", "-keyout", str(pending / "key.pem"), "-out", str(pending / "cert.pem"),
            "-addext", "subjectAltName=DNS:localhost," + ",".join("IP:" + address for address in addresses),
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
            "-addext", "extendedKeyUsage=serverAuth",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        (pending / "key.pem").chmod(0o600)
        os.replace(pending / "key.pem", key)
        os.replace(pending / "cert.pem", cert)
        metadata.write_text(json.dumps(addresses) + "\n")
    return cert, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--directory", type=Path, default=Path("build/site"))
    parser.add_argument("--cert-dir", type=Path, default=Path("build/lan"))
    args = parser.parse_args()
    if not args.directory.is_dir():
        parser.error(f"Site directory does not exist: {args.directory}")
    addresses = local_addresses()
    try:
        cert, key = certificate(args.cert_dir, addresses)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        handler = partial(SimpleHTTPRequestHandler, directory=str(args.directory.resolve()))
        with ThreadingHTTPServer((args.bind, args.port), handler) as server:
            server.socket = context.wrap_socket(server.socket, server_side=True)
            print(f"HTTPS listening on {args.bind}:{server.server_port}", flush=True)
            for address in addresses:
                if ipaddress.ip_address(address).version == 4:
                    print(f"https://{address}:{server.server_port}/", flush=True)
            print(f"Self-signed certificate: {cert.resolve()}", flush=True)
            print("For iPhone, install this certificate and enable full trust if Safari requires it.", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode(errors="replace") if isinstance(error, subprocess.CalledProcessError) else str(error)
        parser.exit(1, f"Local HTTPS server failed: {detail}\n")


if __name__ == "__main__":
    main()

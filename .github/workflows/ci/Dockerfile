FROM node:24.17.0-bookworm-slim AS node
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates clang curl git make openjdk-17-jre-headless python3 wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/ /usr/local/
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --default-toolchain 1.89.0 --target wasm32-unknown-unknown \
    && rm /tmp/rustup.sh
ENV RUSTUP_TOOLCHAIN=1.89.0
RUN cargo install wasm-bindgen-cli --version 0.2.100 --locked --root /opt/wasm-bindgen
ENV WASM_BINDGEN=/opt/wasm-bindgen/bin/wasm-bindgen
WORKDIR /work
CMD ["sh", ".github/workflows/ci/build.sh"]

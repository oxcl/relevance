FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget unzip zip \
    openjdk-17-jdk \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN pip3 install --no-cache-dir --break-system-packages fdroidserver justapk

RUN mkdir -p /opt/tools

ARG APKTOOL_VERSION=3.0.2
RUN curl -fsSL "https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar" \
    -o /opt/tools/apktool.jar

ARG UBER_APK_SIGNER_VERSION=1.3.0
RUN curl -fsSL "https://github.com/patrickfav/uber-apk-signer/releases/download/v${UBER_APK_SIGNER_VERSION}/uber-apk-signer-${UBER_APK_SIGNER_VERSION}.jar" \
    -o /opt/tools/uber-apk-signer.jar

ARG APK_EDITOR_VERSION=1.4.9
RUN curl -fsSL "https://github.com/REAndroid/APKEditor/releases/download/V${APK_EDITOR_VERSION}/APKEditor-${APK_EDITOR_VERSION}.jar" \
    -o /opt/tools/APKEditor.jar

ARG REVANCED_CLI_VERSION=5.0.0
RUN curl -fsSL "https://github.com/ReVanced/revanced-cli/releases/download/v${REVANCED_CLI_VERSION}/revanced-cli-${REVANCED_CLI_VERSION}.jar" \
    -o /opt/tools/revanced-cli.jar

RUN curl -fsSL "https://github.com/EFForg/apkeep/releases/latest/download/apkeep-x86_64-unknown-linux-gnu" \
    -o /usr/local/bin/apkeep \
    && chmod +x /usr/local/bin/apkeep

ENV RELEVANCE_TOOLS_DIR=/opt/tools

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -n "${JAVA_HOME:-}" && ! -x "${JAVA_HOME}/bin/java" ]]; then
  unset JAVA_HOME
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java is not available in Linux PATH."
  echo "Install a Linux JDK first, for example: sudo apt-get install -y openjdk-17-jdk"
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_BIN="$(readlink -f "$(command -v java)")"
  export JAVA_HOME="$(dirname "$(dirname "${JAVA_BIN}")")"
fi

if ! command -v mvn >/dev/null 2>&1; then
  if [[ -x "/mnt/e/tools/apache-maven-3.9.14/bin/mvn" ]]; then
    export PATH="/mnt/e/tools/apache-maven-3.9.14/bin:${PATH}"
  else
    echo "Maven is not available in PATH."
    exit 1
  fi
fi

export SPRING_PROFILES_ACTIVE="${SPRING_PROFILES_ACTIVE:-linux-dev}"

exec mvn spring-boot:run

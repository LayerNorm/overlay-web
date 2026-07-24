#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$PROJECT_ROOT/ax-helper/ax-helper.swift"
OUTPUT="$PROJECT_ROOT/resources/ax-helper"

swiftc \
  -O \
  -whole-module-optimization \
  -debug-prefix-map "$PROJECT_ROOT=/usr/src/overlay" \
  "$SOURCE" \
  -o "$OUTPUT"

chmod 0755 "$OUTPUT"
file "$OUTPUT"
shasum -a 256 "$OUTPUT"

---
license: cc-by-4.0
thumbnail: null
tags:
- automatic-speech-recognition
- speech
- audio
- Transducer
- TDT
- FastConformer
- Conformer
- pytorch
- NeMo
- hf-asr-leaderboard
- coreml
- apple
language:
- en
pipeline_tag: automatic-speech-recognition
base_model:
- nvidia/parakeet-tdt-0.6b-v2
---

# **<span style="color:#5DAF8D">🧃 Parakeet TDT 0.6B V2 - CoreML </span>**
[![Discord](https://img.shields.io/badge/Discord-Join%20Chat-7289da.svg)](https://discord.gg/WNsvaCtmDe)
[![GitHub Repo stars](https://img.shields.io/github/stars/FluidInference/FluidAudio?style=flat&logo=github)](https://github.com/FluidInference/FluidAudio)


This is a CoreML-optimized version of NVIDIA's Parakeet TDT 0.6B V2 model, designed for high-performance automatic speech recognition on Apple platforms.

## Model Description

Models will continue to evolve as we optimize performance and accuracy. This model has been converted to CoreML format for efficient on-device inference on Apple Silicon and iOS devices, enabling real-time speech recognition with
minimal memory footprint.

## Usage in Swift

See the [FluidAudio repository](https://github.com/FluidInference/FluidAudioSwift) for instructions.

## Performance

- Real-time factor: ~110x on M4 Pro
- Memory usage: ~800MB peak
- Supported platforms: macOS 14+, iOS 17+
- Optimized for: Apple Silicon

## Model Details

- Architecture: FastConformer-TDT
- Parameters: 0.6B
- Sample rate: 16kHz

## License

This model is released under the CC-BY-4.0 license. See the LICENSE file for details.

Acknowledgments

Based on NVIDIA's Parakeet TDT model. CoreML conversion and Swift integration by the FluidInference team.

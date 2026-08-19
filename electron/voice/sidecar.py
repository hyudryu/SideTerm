#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path


def configure_cache(root: Path) -> None:
    cache = root / "models"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache / "huggingface")
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache / "huggingface" / "hub")


def whisper_device() -> tuple[str, str]:
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def load_whisper(model: str, root: Path, download_only: bool = False):
    from faster_whisper import WhisperModel
    device, compute_type = ("cpu", "int8") if download_only else whisper_device()
    return WhisperModel(
        model,
        device=device,
        compute_type=compute_type,
        download_root=str(root / "models" / "whisper"),
        local_files_only=False,
    )


def download_stt(args) -> None:
    load_whisper(args.model, args.root, download_only=True)
    print(json.dumps({"ok": True, "model": args.model}))


def transcribe(args) -> None:
    model = load_whisper(args.model, args.root)
    segments, info = model.transcribe(
        args.input,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 450, "speech_pad_ms": 180},
        condition_on_previous_text=False,
    )
    materialized = list(segments)
    text = " ".join(segment.text.strip() for segment in materialized if segment.text.strip()).strip()
    probabilities = [float(segment.no_speech_prob) for segment in materialized]
    print(json.dumps({
        "text": text,
        "language": info.language,
        "duration": float(info.duration),
        "noSpeechProbability": sum(probabilities) / len(probabilities) if probabilities else 1.0,
    }))


def load_tts():
    from pocket_tts import TTSModel
    # Pocket TTS resolves its current English weights through the bundled
    # default language config. The Hugging Face repository ID is not a config
    # argument; passing it makes the library look for config/kyutai/pocket-tts.yaml.
    return TTSModel.load_model()


def download_tts(args) -> None:
    model = load_tts()
    model.get_state_for_audio_prompt("alba")
    print(json.dumps({"ok": True, "model": args.model}))


def normalize_speech_audio(samples, target_dbfs: float = -18.0, peak_ceiling: float = 0.95):
    """Normalize active speech loudness while retaining headroom and avoiding noise boosts."""
    import numpy as np

    materialized = np.asarray(samples, dtype=np.float32)
    if materialized.size == 0:
        return materialized, {"gain": 1.0, "activeRms": 0.0, "peak": 0.0}

    absolute = np.abs(materialized)
    peak = float(np.max(absolute))
    if peak < 1e-6:
        return materialized, {"gain": 1.0, "activeRms": 0.0, "peak": peak}

    # Ignore silence and very low background noise when measuring loudness.
    gate = max(peak * 0.02, 1e-4)
    active = materialized[absolute >= gate]
    active_rms = float(np.sqrt(np.mean(np.square(active)))) if active.size else 0.0
    if active_rms < 1e-6:
        return materialized, {"gain": 1.0, "activeRms": active_rms, "peak": peak}

    target_rms = 10.0 ** (target_dbfs / 20.0)
    gain = max(0.25, min(16.0, target_rms / active_rms))
    gain = min(gain, peak_ceiling / peak)
    normalized = np.clip(materialized * gain, -peak_ceiling, peak_ceiling).astype(np.float32)
    return normalized, {"gain": gain, "activeRms": active_rms, "peak": peak}


def synthesize(args) -> None:
    import scipy.io.wavfile
    model = load_tts()
    voice_state = model.get_state_for_audio_prompt(args.voice)
    audio = model.generate_audio(voice_state, args.text)
    samples = audio.detach().cpu().numpy() if hasattr(audio, "detach") else audio.numpy()
    normalized, loudness = normalize_speech_audio(samples)
    scipy.io.wavfile.write(args.output, model.sample_rate, normalized)
    print(json.dumps({"ok": True, "output": args.output, "normalization": loudness}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["download-stt", "download-tts", "transcribe", "synthesize"])
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--voice", default="alba")
    parser.add_argument("--text", default="")
    args = parser.parse_args()
    args.root = args.root.resolve()
    configure_cache(args.root)
    if args.command == "download-stt":
        download_stt(args)
    elif args.command == "download-tts":
        download_tts(args)
    elif args.command == "transcribe":
        transcribe(args)
    else:
        synthesize(args)


if __name__ == "__main__":
    main()

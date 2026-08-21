#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path


_whisper_models = {}
_tts_model = None
_tts_voices = {}


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
    key = (model, str(root), device, compute_type)
    if key in _whisper_models:
        return _whisper_models[key]
    loaded = WhisperModel(
        model,
        device=device,
        compute_type=compute_type,
        download_root=str(root / "models" / "whisper"),
        local_files_only=False,
    )
    _whisper_models[key] = loaded
    return loaded


def download_stt(args) -> None:
    load_whisper(args.model, args.root, download_only=True)
    print(json.dumps({"ok": True, "model": args.model}))


def transcribe_result(args):
    model = load_whisper(args.model, args.root)
    language = str(getattr(args, "language", "") or "").strip() or None
    initial_prompt = str(getattr(args, "initialPrompt", "") or "").strip() or None
    segments, info = model.transcribe(
        args.input,
        beam_size=5,
        language=language,
        initial_prompt=initial_prompt,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 450, "speech_pad_ms": 180},
        condition_on_previous_text=False,
    )
    materialized = list(segments)
    text = " ".join(segment.text.strip() for segment in materialized if segment.text.strip()).strip()
    probabilities = [float(segment.no_speech_prob) for segment in materialized]
    return {
        "text": text,
        "language": info.language,
        "duration": float(info.duration),
        "noSpeechProbability": sum(probabilities) / len(probabilities) if probabilities else 1.0,
    }


def transcribe(args) -> None:
    print(json.dumps(transcribe_result(args)))


def load_tts():
    global _tts_model
    if _tts_model is not None:
        return _tts_model
    from pocket_tts import TTSModel
    # Pocket TTS resolves its current English weights through the bundled
    # default language config. The Hugging Face repository ID is not a config
    # argument; passing it makes the library look for config/kyutai/pocket-tts.yaml.
    _tts_model = TTSModel.load_model()
    return _tts_model


def load_tts_voice(model, voice: str):
    if voice not in _tts_voices:
        _tts_voices[voice] = model.get_state_for_audio_prompt(voice)
    return _tts_voices[voice]


def download_tts(args) -> None:
    model = load_tts()
    load_tts_voice(model, "alba")
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


def synthesize_result(args):
    import scipy.io.wavfile
    model = load_tts()
    voice_state = load_tts_voice(model, args.voice)
    audio = model.generate_audio(voice_state, args.text)
    samples = audio.detach().cpu().numpy() if hasattr(audio, "detach") else audio.numpy()
    normalized, loudness = normalize_speech_audio(samples)
    scipy.io.wavfile.write(args.output, model.sample_rate, normalized)
    return {"ok": True, "output": args.output, "normalization": loudness}


def synthesize(args) -> None:
    print(json.dumps(synthesize_result(args)))


def serve(args) -> None:
    from types import SimpleNamespace

    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("requestId", ""))
            command = request.get("command")
            operation = SimpleNamespace(root=args.root, **request)
            if command == "transcribe":
                result = transcribe_result(operation)
            elif command == "synthesize":
                result = synthesize_result(operation)
            elif command == "warm-tts":
                model = load_tts()
                load_tts_voice(model, operation.voice)
                result = {"ready": True}
            else:
                raise ValueError(f"Unknown speech command: {command}")
            response = {"requestId": request_id, "ok": True, "result": result}
        except Exception as error:
            response = {"requestId": request_id, "ok": False, "error": str(error)}
        print(json.dumps(response), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["download-stt", "download-tts", "transcribe", "synthesize", "serve"])
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--model", default="")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--voice", default="alba")
    parser.add_argument("--text", default="")
    parser.add_argument("--language", default="")
    parser.add_argument("--initial-prompt", dest="initialPrompt", default="")
    args = parser.parse_args()
    args.root = args.root.resolve()
    configure_cache(args.root)
    if args.command == "serve":
        serve(args)
    elif args.command == "download-stt":
        download_stt(args)
    elif args.command == "download-tts":
        download_tts(args)
    elif args.command == "transcribe":
        transcribe(args)
    else:
        synthesize(args)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import array
import json
import math
import os
import sys
import wave
from pathlib import Path


_parakeet_models = {}
_tts_model = None
_tts_voices = {}


def configure_cache(root: Path) -> None:
    cache = root / "models"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache / "huggingface")
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache / "huggingface" / "hub")


def load_parakeet(model: str, root: Path):
    import torch
    import nemo.collections.asr as nemo_asr

    resolved = model or "nvidia/parakeet-tdt-0.6b-v2"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    key = (resolved, str(root), device)
    if key in _parakeet_models:
        return _parakeet_models[key]
    loaded = nemo_asr.models.ASRModel.from_pretrained(resolved)
    loaded.eval()
    loaded.to(device)
    _parakeet_models[key] = loaded
    return loaded


def download_stt(args) -> None:
    load_parakeet(args.model, args.root)
    print(json.dumps({"ok": True, "model": args.model}))


def wav_speech_metrics(input_path):
    """Estimate deliberate speech from canonical 16-bit PCM without a cloud VAD."""
    try:
        with wave.open(str(input_path), "rb") as recording:
            sample_rate = recording.getframerate()
            channels = recording.getnchannels()
            sample_width = recording.getsampwidth()
            frame_count = recording.getnframes()
            frames = recording.readframes(frame_count)
    except (OSError, EOFError, wave.Error):
        return 0.5, 0.0
    duration = frame_count / sample_rate if sample_rate else 0.0
    if sample_width != 2 or sample_rate <= 0 or not frames:
        return 1.0, duration
    samples = array.array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    mono = samples[::max(1, channels)]
    if not mono:
        return 1.0, duration
    rms = math.sqrt(sum(sample * sample for sample in mono) / len(mono)) / 32768.0
    zero_crossings = sum(1 for left, right in zip(mono, mono[1:]) if (left < 0) != (right < 0))
    zero_crossing_rate = zero_crossings / max(1, len(mono) - 1)
    window_size = max(1, round(sample_rate * 0.02))
    window_rms = []
    for offset in range(0, len(mono), window_size):
        window = mono[offset:offset + window_size]
        window_rms.append(math.sqrt(sum(sample * sample for sample in window) / len(window)) / 32768.0)
    mean_window = sum(window_rms) / len(window_rms)
    variation = math.sqrt(sum((value - mean_window) ** 2 for value in window_rms) / len(window_rms)) / max(mean_window, 1e-6)
    energy_score = max(0.0, min(1.0, (rms - 0.002) / 0.025))
    variation_score = max(0.25, min(1.0, (variation - 0.04) / 0.30))
    if zero_crossing_rate < 0.005:
        crossing_score = zero_crossing_rate / 0.005
    elif zero_crossing_rate <= 0.30:
        crossing_score = 1.0
    else:
        crossing_score = max(0.0, 1.0 - (zero_crossing_rate - 0.30) / 0.20)
    speech_probability = energy_score * variation_score * crossing_score
    return 1.0 - max(0.0, min(1.0, speech_probability)), duration


def transcribe_result(args):
    model = load_parakeet(args.model, args.root)
    outputs = model.transcribe([args.input], batch_size=1, return_hypotheses=True)
    first = outputs[0] if outputs else ""
    text = str(getattr(first, "text", first) or "").strip()
    confidence = None
    score = getattr(first, "score", None)
    if score is not None:
        try:
            sequence = getattr(first, "y_sequence", None)
            token_count = max(1, len(sequence) if sequence is not None else len(text.split()))
            average_log_probability = min(0.0, float(score) / token_count)
            confidence = max(0.0, min(1.0, math.exp(max(-20.0, average_log_probability))))
        except (TypeError, ValueError, OverflowError):
            confidence = None
    no_speech_probability, duration = wav_speech_metrics(args.input)
    return {
        "text": text,
        "language": "en",
        "duration": duration,
        "noSpeechProbability": 1.0 if not text else no_speech_probability,
        "provider": "parakeet",
        "confidence": confidence,
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

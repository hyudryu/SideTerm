const { audioFileExtension } = require('./audio-converter.cjs');

const STT_PROVIDERS = Object.freeze({
  parakeet: { id: 'parakeet', name: 'NVIDIA Parakeet', location: 'local', supportsStreaming: false, supportsPartialResults: false, supportsVocabularyHints: false },
  deepgram: { id: 'deepgram', name: 'Deepgram', location: 'cloud', supportsStreaming: true, supportsPartialResults: true, supportsVocabularyHints: true },
  google: { id: 'google', name: 'Google Cloud Speech-to-Text', location: 'cloud', supportsStreaming: true, supportsPartialResults: true, supportsVocabularyHints: true },
  azure: { id: 'azure', name: 'Azure Speech', location: 'cloud', supportsStreaming: true, supportsPartialResults: true, supportsVocabularyHints: true },
  aws: { id: 'aws', name: 'Amazon Transcribe', location: 'cloud', supportsStreaming: true, supportsPartialResults: true, supportsVocabularyHints: true },
  openai: { id: 'openai', name: 'OpenAI Transcription', location: 'cloud', supportsStreaming: true, supportsPartialResults: true, supportsVocabularyHints: true }
});

function providerDescriptor(id) {
  const provider = STT_PROVIDERS[String(id || '')];
  if (!provider) throw new Error(`Unknown speech-to-text provider: ${id}`);
  return provider;
}

function providerConfigurationError(id, options = {}) {
  const descriptor = providerDescriptor(id);
  if (descriptor.location === 'local') return '';
  if (!options.credential) return `${descriptor.name} credentials are not configured.`;
  if (id === 'azure' && !options.region && !options.endpoint) return 'Azure Speech requires a region or endpoint.';
  if (id === 'aws' && !options.region) return 'Amazon Transcribe requires a region.';
  return '';
}

async function checkedJson(response, provider) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${provider} transcription failed (${response.status}): ${body.message || body.error?.message || 'unknown error'}`);
  return body;
}

function vocabularyQuery(vocabulary) {
  return (vocabulary || []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

async function transcribeDeepgram(audio, options) {
  const url = new URL(options.endpoint || 'https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', options.model || 'nova-3');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('language', options.language || 'en-US');
  for (const term of vocabularyQuery(options.vocabulary)) url.searchParams.append('keyterm', term);
  const body = await checkedJson(await fetch(url, {
    method: 'POST', headers: { Authorization: `Token ${options.credential}`, 'Content-Type': options.mimeType }, body: audio,
    signal: options.signal
  }), 'Deepgram');
  const alternative = body.results?.channels?.[0]?.alternatives?.[0] || {};
  return { text: String(alternative.transcript || ''), confidence: Number(alternative.confidence), language: options.language || 'en-US', provider: 'deepgram' };
}

async function transcribeGoogle(audio, options) {
  const endpoint = options.endpoint || 'https://speech.googleapis.com/v1/speech:recognize';
  const url = new URL(endpoint);
  url.searchParams.set('key', options.credential);
  const encoding = /ogg/i.test(options.mimeType) ? 'OGG_OPUS' : /webm/i.test(options.mimeType) ? 'WEBM_OPUS' : 'LINEAR16';
  const body = await checkedJson(await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      config: {
        encoding, languageCode: options.language || 'en-US', enableAutomaticPunctuation: true,
        speechContexts: [{ phrases: vocabularyQuery(options.vocabulary) }]
      },
      audio: { content: Buffer.from(audio).toString('base64') }
    }), signal: options.signal
  }), 'Google');
  const alternatives = (body.results || []).map((result) => result.alternatives?.[0]).filter(Boolean);
  const confidences = alternatives.map((item) => Number(item.confidence)).filter(Number.isFinite);
  return {
    text: alternatives.map((item) => String(item.transcript || '').trim()).filter(Boolean).join(' '),
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : NaN,
    language: options.language || 'en-US', provider: 'google'
  };
}

async function transcribeAzure(audio, options) {
  const endpoint = options.endpoint || (options.region
    ? `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
    : '');
  if (!endpoint) throw new Error('Azure Speech requires a region or endpoint.');
  const url = new URL(endpoint);
  url.searchParams.set('language', options.language || 'en-US');
  url.searchParams.set('format', 'detailed');
  const body = await checkedJson(await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': options.credential, 'Content-Type': options.mimeType, Accept: 'application/json' },
    body: audio, signal: options.signal
  }), 'Azure');
  const candidate = body.NBest?.[0] || {};
  return { text: String(candidate.Display || body.DisplayText || ''), confidence: Number(candidate.Confidence), language: options.language || 'en-US', provider: 'azure' };
}

async function transcribeOpenAi(audio, options) {
  const endpoint = options.endpoint || 'https://api.openai.com/v1/audio/transcriptions';
  const form = new FormData();
  form.set('file', new Blob([audio], { type: options.mimeType }), `speech.${audioFileExtension(options.mimeType)}`);
  form.set('model', options.model || 'gpt-4o-mini-transcribe');
  form.set('language', String(options.language || 'en').split('-')[0]);
  const prompt = vocabularyQuery(options.vocabulary).join(', ');
  if (prompt) form.set('prompt', prompt);
  const body = await checkedJson(await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${options.credential}` }, body: form, signal: options.signal
  }), 'OpenAI');
  return { text: String(body.text || ''), confidence: Number(body.confidence), language: options.language || 'en-US', provider: 'openai' };
}

function awsCredentials(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed.accessKeyId && parsed.secretAccessKey) return parsed;
  } catch {}
  const [accessKeyId, secretAccessKey, sessionToken] = String(value || '').split(':');
  if (!accessKeyId || !secretAccessKey) throw new Error('Amazon Transcribe requires accessKeyId:secretAccessKey[:sessionToken] credentials.');
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

async function* awsAudioEvents(audio, maximumChunkBytes = 16 * 1024) {
  const source = Buffer.from(audio);
  const size = Math.max(1, Math.min(32 * 1024, Number(maximumChunkBytes) || 16 * 1024));
  for (let offset = 0; offset < source.length; offset += size) {
    yield { AudioEvent: { AudioChunk: source.subarray(offset, offset + size) } };
  }
}

async function transcribeAws(audio, options) {
  if (!/^(?:audio\/ogg|audio\/pcm)/i.test(options.mimeType)) throw new Error('Amazon Transcribe requires OGG Opus or canonical PCM audio; SideTerm will not send an incompatible recording or fall back to another provider.');
  const { StartStreamTranscriptionCommand, TranscribeStreamingClient } = require('@aws-sdk/client-transcribe-streaming');
  const encoding = /ogg/i.test(options.mimeType) ? 'ogg-opus' : 'pcm';
  const client = new TranscribeStreamingClient({ region: options.region, credentials: awsCredentials(options.credential) });
  try {
    const response = await client.send(new StartStreamTranscriptionCommand({
      LanguageCode: options.language || 'en-US', MediaEncoding: encoding, MediaSampleRateHertz: 16_000, AudioStream: awsAudioEvents(audio)
    }), { abortSignal: options.signal });
    let text = '';
    for await (const event of response.TranscriptResultStream || []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results || []) {
        if (!result.IsPartial) text = `${text} ${result.Alternatives?.[0]?.Transcript || ''}`.trim();
      }
    }
    return { text, language: options.language || 'en-US', provider: 'aws' };
  } finally {
    client.destroy();
  }
}

async function transcribeCloud(providerId, audio, options = {}) {
  const descriptor = providerDescriptor(providerId);
  if (descriptor.location !== 'cloud') throw new Error(`${providerId} is not a cloud speech provider.`);
  const configurationError = providerConfigurationError(providerId, options);
  if (configurationError) throw new Error(configurationError);
  const implementations = { deepgram: transcribeDeepgram, google: transcribeGoogle, azure: transcribeAzure, aws: transcribeAws, openai: transcribeOpenAi };
  const controller = new AbortController();
  const timeoutMs = Math.max(100, Math.min(120_000, Number(options.timeoutMs) || 30_000));
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`${descriptor.name} transcription timed out.`));
  }, timeoutMs);
  try {
    const result = await Promise.race([
      implementations[descriptor.id](Buffer.from(audio), { ...options, signal: controller.signal }),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
    ]);
    return result;
  } catch (error) {
    if (timedOut) throw new Error(`${descriptor.name} transcription timed out.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { awsAudioEvents, awsCredentials, providerConfigurationError, providerDescriptor, STT_PROVIDERS, transcribeCloud };

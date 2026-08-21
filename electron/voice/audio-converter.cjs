const { spawn } = require('node:child_process');

function packagedExecutablePath(value) {
  return String(value || '').replace(/([/\\])app\.asar([/\\])/i, '$1app.asar.unpacked$2');
}

function audioFileExtension(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('wav')) return 'wav';
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a';
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
  if (value.includes('flac')) return 'flac';
  return 'webm';
}

function convertSpeechAudio(inputPath, outputPath, codecArgs, options = {}) {
  const executable = packagedExecutablePath(options.ffmpegPath || require('ffmpeg-static'));
  const spawnProcess = options.spawnProcess || spawn;
  if (!executable) return Promise.reject(new Error('The bundled audio converter is unavailable.'));
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
      '-ac', '1', '-ar', '16000', ...codecArgs, outputPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Could not decode microphone audio${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
    });
  });
}

function convertToSpeechWav(inputPath, outputPath, options = {}) {
  return convertSpeechAudio(inputPath, outputPath, ['-c:a', 'pcm_s16le'], options);
}

function convertToSpeechPcm(inputPath, outputPath, options = {}) {
  return convertSpeechAudio(inputPath, outputPath, ['-f', 's16le'], options);
}

module.exports = { audioFileExtension, convertToSpeechPcm, convertToSpeechWav, packagedExecutablePath };

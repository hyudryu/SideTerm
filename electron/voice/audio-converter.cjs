const { spawn } = require('node:child_process');

function packagedExecutablePath(value) {
  return String(value || '').replace(/([/\\])app\.asar([/\\])/i, '$1app.asar.unpacked$2');
}

function convertToSpeechWav(inputPath, outputPath, options = {}) {
  const executable = packagedExecutablePath(options.ffmpegPath || require('ffmpeg-static'));
  const spawnProcess = options.spawnProcess || spawn;
  if (!executable) return Promise.reject(new Error('The bundled audio converter is unavailable.'));
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath
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

module.exports = { convertToSpeechWav, packagedExecutablePath };

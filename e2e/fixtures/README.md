# E2E Test Fixtures

This directory contains test media files for E2E testing with fake camera/microphone.

## Required Files

### `test-audio.wav`
Pre-recorded audio file used as fake microphone input.

**Requirements:**
- Format: WAV
- Sample rate: 48kHz
- Channels: Stereo (2 channels)
- Bit depth: 16-bit

**Creating the file:**
```bash
# From any audio source (MP3, M4A, etc.)
ffmpeg -i speech-sample.mp3 -ar 48000 -ac 2 -sample_fmt s16 test-audio.wav

# From text-to-speech (using say on macOS)
say -o speech.aiff "Hello, I am testing the voice assistant."
ffmpeg -i speech.aiff -ar 48000 -ac 2 -sample_fmt s16 test-audio.wav
```

**Tips for good test audio:**
- Use clear speech with minimal background noise
- Include natural pauses (VAD needs silence to detect speech end)
- Keep it short (5-15 seconds) for faster tests
- Use a phrase the LLM can respond to meaningfully

### `test-video.y4m`
Pre-recorded video file used as fake camera input.

**Requirements:**
- Format: Y4M (YUV4MPEG2)
- Pixel format: yuv420p

**Creating the file:**
```bash
# From any video source
ffmpeg -i input.mp4 -pix_fmt yuv420p -t 10 test-video.y4m

# Create a simple test pattern
ffmpeg -f lavfi -i testsrc=duration=10:size=640x480:rate=30 -pix_fmt yuv420p test-video.y4m

# From webcam capture (macOS)
ffmpeg -f avfoundation -framerate 30 -i "0" -t 10 -pix_fmt yuv420p test-video.y4m
```

### `test-image.jpg`
Test image for vision tests.

**Requirements:**
- Format: JPEG
- Resolution: Any reasonable size (e.g., 640x480)

**Creating the file:**
- Use any image that would make sense for vision-based conversations
- For example: a simple scene, document, or diagram

## Directory Structure

```
e2e/fixtures/
├── README.md              # This file
├── test-audio.wav         # Fake microphone audio
├── test-video.y4m         # Fake camera video
├── test-image.jpg         # Test image for vision
└── expected-responses/    # Expected outputs for validation
    └── .gitkeep
```

## Notes

- The fake media files are injected via Chrome flags:
  - `--use-file-for-fake-audio-capture=path/to/test-audio.wav`
  - `--use-file-for-fake-video-capture=path/to/test-video.y4m`

- Audio loops by default. To prevent looping, rename to `test-audio.wav%noloop`

- Only Chromium supports fake media injection (not Firefox/WebKit)

- For CI/CD, include small test files in the repository or generate them in the setup step

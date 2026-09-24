# Test fixtures

Small, real audio files used by tests/browser/decode.test.ts, generated with
ffmpeg (not hand-built byte literals, so they exercise the browser's actual
codecs). Regenerate with:

```sh
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=0.5:sample_rate=48000" -ac 2 tests/fixtures/tone-48k-stereo.wav
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=0.5:sample_rate=44100" -ac 1 tests/fixtures/tone-44k-mono.wav
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=0.5:sample_rate=44100" -ac 2 -b:a 128k tests/fixtures/tone.mp3
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=0.5:sample_rate=44100" -ac 2 tests/fixtures/tone.ogg
head -c 200 tests/fixtures/tone.mp3 > tests/fixtures/corrupt.mp3
echo "not audio at all, just text" > tests/fixtures/not-audio.txt
```

All are a 440 Hz sine tone, 0.5 s, to keep the repo small and tests fast.

"""Run with the web backend's Python to verify its actual TTS adapter."""
import asyncio
from unmute.tts.text_to_speech import TextToSpeech, TTSClientEosMessage, TTSAudioMessage


async def main():
    client = TextToSpeech(voice='alba')
    await client.start_up()
    await client.send('Hello. The shared speech service is ready.')
    await client.send(TTSClientEosMessage())
    samples = 0
    async for event in client:
        if isinstance(event, TTSAudioMessage):
            samples += len(event.pcm)
    assert samples > 24000, samples
    print(dict(adapter='web-TextToSpeech', samples=samples, status='passed'))


asyncio.run(main())

# Audio Transcriber

A browser-based audio transcription tool that uses OpenAI's Whisper API to transcribe uploaded audio files.

## Features

- Upload audio files through a web interface
- Transcribe audio using OpenAI's Whisper API
- Download transcription results

## Setup

1. Install dependencies:
```
npm install
```

2. Create a `.env` file in the root directory with your OpenAI API key:
```
OPENAI_API_KEY=your_api_key_here
```

3. Start the application:
```
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

## Technologies Used

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js with Express
- API: OpenAI Whisper API for audio transcription

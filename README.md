# Audio Transcriber

A sophisticated browser-based audio transcription tool that uses OpenAI's Whisper API with intelligent chunking for optimal performance and rate limit compliance.

## Features

### Core Functionality
- **Smart File Processing**: Upload audio files up to 300MB with automatic intelligent chunking
- **Multiple Format Support**: MP3, WAV, M4A, OGG, FLAC
- **Real-time Progress**: Live progress tracking with detailed status updates
- **Drag & Drop Interface**: Modern, intuitive file upload experience
- **PIN Authentication**: Secure access control with 4-digit PIN entry

### Advanced Processing
- **Intelligent Chunking**: Automatically analyzes audio files and creates optimal ~20MB chunks
- **Rate Limit Optimization**: Smart chunk sizing to maximize OpenAI API efficiency
- **Parallel Processing**: Concurrent transcription of multiple chunks (up to 3 simultaneous)
- **Adaptive Duration**: Chunk duration automatically calculated based on file bitrate

### File Management
- **Persistent Storage**: Transcriptions automatically saved and retrievable
- **Multiple Download Formats**: Copy to clipboard, download as TXT or Word (.docx) files
- **Professional Word Documents**: Formatted documents with headers, timestamps, and proper styling
- **Automatic Cleanup**: Temporary files cleaned up after processing
- **Saved Transcriptions**: View and manage previously transcribed files with format options

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

## Technical Details

### Intelligent Chunking Algorithm
The application implements a sophisticated chunking strategy that optimizes for OpenAI's rate limits:

- **Target Chunk Size**: ~20MB (80% of OpenAI's 25MB limit for safety margin)
- **Dynamic Duration Calculation**: Analyzes file bitrate to determine optimal chunk duration
- **Adaptive Bounds**: Chunk duration constrained between 2-20 minutes for quality
- **Concurrent Processing**: Up to 3 chunks processed simultaneously for faster results

### File Processing Pipeline
1. **Analysis Phase**: FFprobe extracts file metadata (duration, bitrate)
2. **Optimization Phase**: Calculates optimal chunk duration based on target size
3. **Conversion Phase**: Converts to standardized WAV format (PCM 16-bit, 44.1kHz)
4. **Segmentation Phase**: Splits into optimized chunks using FFmpeg
5. **Transcription Phase**: Parallel processing with OpenAI Whisper API
6. **Assembly Phase**: Combines results in correct order
7. **Cleanup Phase**: Removes temporary files automatically

### Rate Limit Optimization
- **Smart Sizing**: Chunks sized to maximize API efficiency
- **Parallel Processing**: Concurrent requests within API limits
- **Error Handling**: Robust retry logic for API failures
- **Progress Tracking**: Real-time updates throughout processing

## Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), Inter Font
- **Backend**: Node.js with Express.js
- **Audio Processing**: FFmpeg with fluent-ffmpeg wrapper
- **API Integration**: OpenAI Whisper API for transcription
- **Document Generation**: docx library for Word document creation
- **File Handling**: Multer for uploads, UUID for session management
- **UI Framework**: Modern dark theme with gradient accents
- **Updated Dependencies**: Latest versions to resolve deprecation warnings

## Download Formats

### Text Files (.txt)
- Plain text format for maximum compatibility
- Lightweight and universally readable
- Perfect for further text processing

### Word Documents (.docx)
- Professional formatting with headers and timestamps
- Proper paragraph spacing and typography
- Compatible with Microsoft Word and other office suites
- Includes document metadata and creation date

## Security & Authentication

### PIN Protection
The application is protected by a 4-digit PIN authentication system:

- **Access Control**: All routes require PIN authentication
- **Session Management**: Authentication persists during browser session
- **Secure Login**: Modern PIN entry interface with visual feedback
- **Automatic Logout**: Session expires when browser is closed

### Configuration
The PIN code is stored securely in the `.env` file:
```
PIN_CODE=0411
```

**Note**: The `.env` file is automatically excluded from version control via `.gitignore` for security.

## 🚀 Deployment

### Railway Deployment (Recommended)
The Audio Transcriber is optimized for Railway deployment:

1. **Connect Repository**: Link your GitHub repository to Railway
2. **Environment Variables**: Configure `OPENAI_API_KEY` and `PIN_CODE`
3. **Deploy**: Automatic deployment with Node.js detection
4. **Custom Domain**: Optional custom domain configuration

**Quick Deploy Button:**
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

### Environment Variables for Production:
```env
OPENAI_API_KEY=your_openai_api_key_here
PIN_CODE=0411
NODE_ENV=production
```

### Features in Production:
- ✅ Automatic HTTPS
- ✅ Custom domain support
- ✅ Environment variable security
- ✅ Automatic deployments from GitHub
- ✅ Built-in monitoring and logs

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

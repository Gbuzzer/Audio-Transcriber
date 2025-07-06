require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { OpenAI } = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up CORS
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create directories if they don't exist
const uploadDir = path.join(__dirname, 'uploads');
const chunksDir = path.join(__dirname, 'chunks');
const tempDir = path.join(__dirname, 'temp');

[uploadDir, chunksDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Constants for file size limits
const MB = 1024 * 1024;
const MAX_FILE_SIZE = 100 * MB; // 100MB for our server
const OPENAI_WHISPER_LIMIT = 25 * MB; // OpenAI's actual limit is 25MB

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE }, // Increased to 100MB
  fileFilter: function(req, file, cb) {
    // Accept audio files only
    if (!file.originalname.match(/\.(mp3|wav|m4a|ogg|flac)$/)) {
      return cb(new Error('Only audio files are allowed!'), false);
    }
    
    cb(null, true);
  }
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Check if API key is present
if (!process.env.OPENAI_API_KEY) {
  console.error('WARNING: OPENAI_API_KEY is not set in environment variables!');
}

// Log API key configuration (safe version)
console.log(`API key configured: ${process.env.OPENAI_API_KEY ? 'Yes (key exists)' : 'No (missing key)'}`);

// Upload and transcribe route
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // If file exceeds OpenAI's limit, process it in chunks
  if (req.file.size > OPENAI_WHISPER_LIMIT) {
    console.log(`File size (${Math.round(req.file.size/MB)}MB) exceeds OpenAI's 25MB limit. Processing in chunks...`);
    return handleLargeFile(req, res);
  }

  try {
    console.log('File received:', req.file);
    console.log('Starting transcription process...');
    const filePath = req.file.path;
    
    // Verify file exists and is readable
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist at path: ${filePath}`);
    }
    
    console.log(`File exists at ${filePath}, size: ${fs.statSync(filePath).size} bytes`);
    
    // Transcribe using OpenAI Whisper API
    console.log('Sending request to OpenAI Whisper API...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });

    console.log('Transcription successful!');
    
    // Clean up - delete the file after transcription
    fs.unlinkSync(filePath);

    res.json({ 
      success: true, 
      transcription: transcription.text 
    });
  } catch (error) {
    console.error('Transcription error details:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('OpenAI API error response:', error.response.data);
      console.error('OpenAI API error status:', error.response.status);
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to transcribe audio' 
    });
  }
});

// Helper function to split audio files into chunks
async function splitAudioFile(filePath, segmentDuration = 300) { // 5 minutes per chunk by default
  const sessionId = uuidv4();
  const outputPattern = path.join(chunksDir, `${sessionId}-chunk-%03d.mp3`);
  
  return new Promise((resolve, reject) => {
    console.log(`Splitting file ${filePath} into chunks...`);
    
    ffmpeg(filePath)
      .output(outputPattern)
      .outputOptions([
        `-f segment`,
        `-segment_time ${segmentDuration}`,
        `-c:a libmp3lame`,
        `-b:a 128k`
      ])
      .on('end', () => {
        console.log('File splitting completed');
        
        // Get the list of created chunks
        const chunks = fs.readdirSync(chunksDir)
          .filter(file => file.startsWith(`${sessionId}-chunk-`))
          .sort((a, b) => {
            const numA = parseInt(a.match(/chunk-(\d+)/)[1]);
            const numB = parseInt(b.match(/chunk-(\d+)/)[1]);
            return numA - numB;
          })
          .map(file => path.join(chunksDir, file));
          
        resolve({ sessionId, chunks });
      })
      .on('error', (err) => {
        console.error('Error splitting file:', err);
        reject(err);
      })
      .run();
  });
}

// Process each chunk sequentially
async function processChunks(chunks, res) {
  const results = [];
  const totalChunks = chunks.length;
  
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = chunks[i];
    
    try {
      // Send progress update
      res.write(JSON.stringify({
        status: 'processing',
        message: `Transcribing chunk ${i + 1} of ${totalChunks}...`,
        progress: Math.floor(20 + ((i) / totalChunks) * 70)
      }));
      
      console.log(`Processing chunk ${i + 1}/${totalChunks}: ${path.basename(chunkPath)}`);
      
      // Transcribe this chunk
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(chunkPath),
        model: "whisper-1",
      });
      
      results.push(transcription.text);
      
      // Send progress update after each chunk
      res.write(JSON.stringify({
        status: 'processing',
        message: `Completed ${i + 1} of ${totalChunks} chunks...`,
        progress: Math.floor(20 + ((i + 1) / totalChunks) * 70)
      }));
    } catch (error) {
      console.error(`Error transcribing chunk ${i + 1}:`, error);
      throw error;
    }
  }
  
  return results.join(' ');
}

// Clean up temporary files
function cleanupFiles(filePath, chunks) {
  console.log('Cleaning up temporary files...');
  
  // Delete original file
  try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting original file:', e); }
  
  // Delete chunks
  chunks.forEach(chunk => {
    try { fs.unlinkSync(chunk); } catch (e) { console.error(`Error deleting chunk ${chunk}:`, e); }
  });
}

// Handle large file processing
async function handleLargeFile(req, res) {
  const filePath = req.file.path;
  const fileSize = req.file.size;
  
  // Start processing
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  try {
    // Initial response
    res.write(JSON.stringify({
      status: 'processing',
      message: `Processing large file (${Math.round(fileSize/MB)}MB). Splitting into chunks...`,
      progress: 5
    }));
    
    // First split the file into chunks
    const { sessionId, chunks } = await splitAudioFile(filePath, 300);
    
    res.write(JSON.stringify({
      status: 'processing',
      message: `File split into ${chunks.length} chunks. Starting transcription...`,
      progress: 15
    }));
    
    // Process all chunks sequentially
    const combinedTranscription = await processChunks(chunks, res);
    
    res.write(JSON.stringify({
      status: 'processing',
      message: 'Transcription complete. Finalizing results...',
      progress: 95
    }));
    
    // Clean up all temporary files
    cleanupFiles(filePath, chunks);
    
    // Send final complete response
    res.end(JSON.stringify({
      status: 'complete',
      success: true,
      transcription: combinedTranscription,
      progress: 100
    }));
  } catch (error) {
    console.error('Error processing large file:', error);
    
    // Send error response
    res.end(JSON.stringify({
      status: 'error',
      success: false,
      error: error.message || 'Failed to process large file',
      progress: 0
    }));
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

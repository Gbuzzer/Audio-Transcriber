// Suppress specific punycode deprecation warning until dependencies are updated
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, type, code, ...args) {
  if (code === 'DEP0040') {
    return; // Suppress punycode deprecation warning
  }
  return originalEmitWarning.call(process, warning, type, code, ...args);
};

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
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

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
const transcriptionsDir = path.join(__dirname, 'transcriptions');

[uploadDir, chunksDir, tempDir, transcriptionsDir].forEach(dir => {
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

// Constants for file size limits and chunking optimization
const MB = 1024 * 1024;
const MAX_FILE_SIZE = 300 * MB; // 300MB for our server
const OPENAI_WHISPER_LIMIT = 25 * MB; // OpenAI's actual limit is 25MB

// Optimized chunking strategy for rate limits
const OPTIMAL_CHUNK_SIZE = 20 * MB; // Target 20MB chunks (80% of limit for safety)
const MIN_CHUNK_DURATION = 120; // Minimum 2 minutes per chunk
const MAX_CHUNK_DURATION = 1200; // Maximum 20 minutes per chunk
const MAX_CONCURRENT_CHUNKS = 3; // Increased concurrent processing

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE }, // Increased to 300MB
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

// Utility functions for cleanup and transcription storage
function saveTranscription(transcriptionText, originalFilename) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `${timestamp}_${originalFilename.replace(/\.[^/.]+$/, '')}`;
    
    // Save as TXT file
    const txtFilename = `${baseFilename}.txt`;
    const txtFilepath = path.join(transcriptionsDir, txtFilename);
    fs.writeFileSync(txtFilepath, transcriptionText, 'utf8');
    
    // Save as DOCX file
    const docxFilename = `${baseFilename}.docx`;
    const docxFilepath = path.join(transcriptionsDir, docxFilename);
    
    // Create Word document
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `Audio Transcription - ${originalFilename}`,
                bold: true,
                size: 32,
              }),
            ],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 400 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated on: ${new Date().toLocaleString()}`,
                italics: true,
                size: 20,
              }),
            ],
            spacing: { after: 600 },
          }),
          ...transcriptionText.split('\n').map(paragraph => 
            new Paragraph({
              children: [
                new TextRun({
                  text: paragraph || ' ', // Handle empty lines
                  size: 24,
                }),
              ],
              spacing: { after: 200 },
            })
          ),
        ],
      }],
    });
    
    // Generate and save the Word document
    Packer.toBuffer(doc).then((buffer) => {
      fs.writeFileSync(docxFilepath, buffer);
      console.log(`Word document saved: ${docxFilename}`);
    }).catch((error) => {
      console.error('Error creating Word document:', error);
    });
    
    console.log(`Transcription saved: ${txtFilename}`);
    return txtFilename; // Return TXT filename for backward compatibility
  } catch (error) {
    console.error('Error saving transcription:', error);
    return null;
  }
}

function cleanupOldFiles() {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const now = Date.now();
  
  [uploadDir, chunksDir, tempDir].forEach(dir => {
    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up old file: ${file}`);
        }
      });
    } catch (error) {
      console.error(`Error cleaning up ${dir}:`, error);
    }
  });
}

// Start periodic cleanup (every hour)
setInterval(cleanupOldFiles, 60 * 60 * 1000);
console.log('Periodic cleanup started (runs every hour)');

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
    
    // Save transcription to file
    const savedFilename = saveTranscription(transcription.text, req.file.originalname);
    
    // Clean up - delete the file after transcription
    fs.unlinkSync(filePath);

    res.json({ 
      success: true, 
      transcription: transcription.text,
      savedAs: savedFilename
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

// Calculate optimal chunk duration based on file size and estimated bitrate
function calculateOptimalChunkDuration(fileSize, fileDuration) {
  // Estimate bitrate (bytes per second)
  const estimatedBitrate = fileSize / fileDuration;
  
  // Calculate duration that would result in ~20MB chunks
  const optimalDuration = Math.floor(OPTIMAL_CHUNK_SIZE / estimatedBitrate);
  
  // Clamp to reasonable bounds
  const clampedDuration = Math.max(MIN_CHUNK_DURATION, Math.min(MAX_CHUNK_DURATION, optimalDuration));
  
  console.log(`File analysis: ${Math.round(fileSize/MB)}MB, estimated bitrate: ${Math.round(estimatedBitrate/1024)}KB/s`);
  console.log(`Calculated optimal chunk duration: ${clampedDuration}s (${Math.round(clampedDuration/60)}min)`);
  
  return clampedDuration;
}

// Helper function to split large audio files and process chunks in parallel with optimized chunking
async function splitAndProcessAudioFile(filePath, segmentDuration = null, res) {
  const sessionId = uuidv4();
  
  // First, convert the entire file to WAV format for better compatibility
  const wavFilePath = path.join(tempDir, `${sessionId}-converted.wav`);
  const chunkOutputPattern = path.join(chunksDir, `${sessionId}-chunk-%03d.wav`);
  
  return new Promise((resolve, reject) => {
    console.log(`Processing file ${filePath}...`);
    
    // Send initial progress update
    res.write(JSON.stringify({
      status: 'processing',
      message: 'Analyzing audio file for optimal chunking...',
      progress: 5
    }));
    
    // Step 1: Get file duration and calculate optimal chunk size
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error getting file metadata:', err);
        reject(err);
        return;
      }
      
      const duration = metadata.format.duration;
      const fileSize = fs.statSync(filePath).size;
      
      // Calculate optimal chunk duration if not provided
      const optimalSegmentDuration = segmentDuration || calculateOptimalChunkDuration(fileSize, duration);
      
      res.write(JSON.stringify({
        status: 'processing',
        message: `Converting audio to WAV format (${Math.round(duration/60)}min total, ${Math.round(optimalSegmentDuration/60)}min chunks)...`,
        progress: 10
      }));
      
      // Step 2: Convert to WAV format
      ffmpeg(filePath)
        .output(wavFilePath)
        .outputOptions([
          '-c:a pcm_s16le',   // Uncompressed PCM audio (standard WAV)
          '-ar 44100',        // 44.1kHz sampling (standard for audio)
          '-ac 2'             // Stereo
        ])
        .on('end', () => {
          console.log(`File converted to WAV format at ${wavFilePath}`);
          
          res.write(JSON.stringify({
            status: 'processing',
            message: `Splitting audio into optimized chunks (~${Math.round(optimalSegmentDuration/60)}min each)...`,
            progress: 20
          }));
          
          // Step 3: Now split the WAV file into optimized chunks
          processWavFile(optimalSegmentDuration);
        })
        .on('error', (err) => {
          console.error('Error converting file to WAV:', err);
          reject(err);
        })
        .run();
    });
    
    function processWavFile(segmentDuration) {
      // Object to store transcription results by chunk index
      const transcriptionResults = {};
      let totalChunks = 0;
      let processedChunks = 0;
      let chunksBeingProcessed = 0;
      let isSplittingComplete = false;
      
      // Use optimized concurrency control
      const CONCURRENT_CHUNKS = MAX_CONCURRENT_CHUNKS;
      
      // Function to check if we should resolve the promise
      const checkCompletion = () => {
        if (isSplittingComplete && processedChunks === totalChunks) {
          // All chunks are processed, combine results
          const combinedResults = [];
          for (let i = 0; i < totalChunks; i++) {
            if (transcriptionResults[i]) {
              combinedResults.push(transcriptionResults[i]);
            } else {
              console.error(`Missing transcription for chunk ${i}`);
            }
          }
          
          console.log(`Finished processing ${processedChunks}/${totalChunks} chunks.`);
          
          // Get all chunk file paths
          const chunks = Object.keys(transcriptionResults).map(idx => 
            path.join(chunksDir, `${sessionId}-chunk-${String(idx).padStart(3, '0')}.wav`)
          );
          
          // Combine results in proper order
          resolve({
            sessionId,
            chunks,
            wavFilePath,
            combinedTranscription: combinedResults.join(' ')
          });
        }
      };
      
      // Function to process an individual chunk
      const processChunk = async (chunkPath, chunkIndex) => {
        chunksBeingProcessed++;
        
        try {
          console.log(`Processing chunk ${chunkIndex+1}: ${path.basename(chunkPath)}`);
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'processing',
            message: `Transcribing chunk ${chunkIndex+1} of ${totalChunks}...`,
            progress: Math.floor(20 + (processedChunks / totalChunks) * 70)
          }));
          
          // Transcribe this chunk
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath),
            model: "whisper-1",
          });
          
          // Store result by index to maintain order
          transcriptionResults[chunkIndex] = transcription.text;
          processedChunks++;
          
          console.log(`Chunk ${chunkIndex+1} transcription complete (${processedChunks}/${totalChunks})`);
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'processing',
            message: `Completed ${processedChunks} of ${totalChunks} chunks...`,
            progress: Math.floor(20 + (processedChunks / totalChunks) * 70)
          }));
        } catch (error) {
          console.error(`Error transcribing chunk ${chunkIndex+1}:`, error.message);
          reject(error);
        } finally {
          chunksBeingProcessed--;
          checkForMoreChunks();
          checkCompletion();
        }
      };
      
      // Array to track which chunks have been detected but not yet processed
      const chunkQueue = [];
      
      // Function to check for new chunks to process
      const checkForMoreChunks = () => {
        while (chunkQueue.length > 0 && chunksBeingProcessed < CONCURRENT_CHUNKS) {
          const nextChunk = chunkQueue.shift();
          processChunk(nextChunk.path, nextChunk.index);
        }
      };
      
      // Listen for new chunk files as they're created
      const chunkWatcher = setInterval(() => {
        if (isSplittingComplete) {
          clearInterval(chunkWatcher);
          return;
        }
        
        // Check for new chunks
        const currentChunks = fs.readdirSync(chunksDir)
          .filter(file => file.startsWith(`${sessionId}-chunk-`) && file.endsWith('.wav'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/chunk-(\d+)/)[1]);
            const numB = parseInt(b.match(/chunk-(\d+)/)[1]);
            return numA - numB;
          });
        
        // Update total count if needed
        if (currentChunks.length > totalChunks) {
          // Process new chunks that haven't been queued yet
          for (let i = totalChunks; i < currentChunks.length; i++) {
            const chunkPath = path.join(chunksDir, currentChunks[i]);
            const chunkIndex = parseInt(currentChunks[i].match(/chunk-(\d+)/)[1]);
            
            // Add to processing queue
            chunkQueue.push({
              path: chunkPath,
              index: chunkIndex
            });
          }
          
          totalChunks = currentChunks.length;
          checkForMoreChunks();
        }
      }, 500); // Check every 500ms for new chunks
      
      // Start the FFmpeg process to split the file
      ffmpeg(wavFilePath)
        .output(chunkOutputPattern)
        .outputOptions([
          `-f segment`,
          `-segment_time ${segmentDuration}`,
          `-c:a pcm_s16le`,  // Keep as WAV (PCM)
          `-ar 44100`,       // Maintain sample rate
          `-ac 2`            // Maintain stereo
        ])
        .on('end', () => {
          console.log('File splitting completed');
          isSplittingComplete = true;
          clearInterval(chunkWatcher);
          
          // Final check for completion
          checkCompletion();
        })
        .on('error', (err) => {
          console.error('Error splitting file:', err);
          clearInterval(chunkWatcher);
          reject(err);
        })
        .run();
    }
  });
}

// Clean up temporary files
function cleanupFiles(filePath, chunks, wavFilePath) {
  console.log('Cleaning up temporary files...');
  
  // Delete original file
  try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting original file:', e); }
  
  // Delete converted WAV file if it exists
  if (wavFilePath && fs.existsSync(wavFilePath)) {
    try { fs.unlinkSync(wavFilePath); } catch (e) { console.error('Error deleting converted WAV file:', e); }
  }
  
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
      message: `Processing large file (${Math.round(fileSize/MB)}MB). Using intelligent chunking for optimal rate limits...`,
      progress: 5
    }));
    
    // Split the file into optimized chunks and begin processing them in parallel
    const { sessionId, chunks, wavFilePath, combinedTranscription } = await splitAndProcessAudioFile(filePath, null, res);
    
    res.write(JSON.stringify({
      status: 'processing',
      message: 'Transcription complete. Finalizing results...',
      progress: 95
    }));
    
    // Save transcription to file
    const savedFilename = saveTranscription(combinedTranscription, req.file.originalname);
    
    // Clean up all temporary files
    cleanupFiles(filePath, chunks, wavFilePath);
    
    // Send final complete response with properly formatted transcription
    res.end(JSON.stringify({
      status: 'complete',
      success: true,
      transcription: combinedTranscription,
      savedAs: savedFilename,
      progress: 100
    }));
    
  } catch (error) {
    console.error('Error processing large file:', error);
    res.end(JSON.stringify({
      status: 'error',
      success: false,
      error: error.message || 'Failed to process audio file',
      progress: 100
    }));
  }
}

// API endpoint to list saved transcriptions
app.get('/api/transcriptions', (req, res) => {
  try {
    const files = fs.readdirSync(transcriptionsDir)
      .filter(file => file.endsWith('.txt'))
      .map(file => {
        const filepath = path.join(transcriptionsDir, file);
        const stats = fs.statSync(filepath);
        const baseFilename = file.replace('.txt', '');
        const docxFilename = `${baseFilename}.docx`;
        const docxExists = fs.existsSync(path.join(transcriptionsDir, docxFilename));
        
        return {
          filename: file,
          baseFilename: baseFilename,
          created: stats.mtime,
          size: stats.size,
          hasDocx: docxExists
        };
      })
      .sort((a, b) => b.created - a.created); // Most recent first
    
    res.json({ success: true, transcriptions: files });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list transcriptions' });
  }
});

// API endpoint to download a specific transcription (TXT)
app.get('/api/transcriptions/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(transcriptionsDir, filename);
    
    if (!fs.existsSync(filepath) || !filename.endsWith('.txt')) {
      return res.status(404).json({ success: false, error: 'Transcription not found' });
    }
    
    const content = fs.readFileSync(filepath, 'utf8');
    res.json({ success: true, content, filename });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read transcription' });
  }
});

// API endpoint to download Word document
app.get('/api/transcriptions/:baseFilename/docx', (req, res) => {
  try {
    const baseFilename = req.params.baseFilename;
    const docxFilename = `${baseFilename}.docx`;
    const filepath = path.join(transcriptionsDir, docxFilename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'Word document not found' });
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${docxFilename}"`);
    
    // Send the file
    const fileBuffer = fs.readFileSync(filepath);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error downloading Word document:', error);
    res.status(500).json({ success: false, error: 'Failed to download Word document' });
  }
});

// API endpoint to generate Word document from current transcription
app.post('/api/generate-word', upload.none(), async (req, res) => {
  try {
    const { transcription, filename } = req.body;
    
    if (!transcription || !filename) {
      return res.status(400).json({ success: false, error: 'Missing transcription or filename' });
    }
    
    const baseFilename = filename.replace(/\.[^/.]+$/, '');
    const timestamp = new Date().toISOString().split('T')[0];
    const docxFilename = `${baseFilename}-${timestamp}.docx`;
    
    // Create Word document
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `Audio Transcription - ${filename}`,
                bold: true,
                size: 32,
              }),
            ],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 400 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated on: ${new Date().toLocaleString()}`,
                italics: true,
                size: 20,
              }),
            ],
            spacing: { after: 600 },
          }),
          ...transcription.split('\n').map(paragraph => 
            new Paragraph({
              children: [
                new TextRun({
                  text: paragraph || ' ', // Handle empty lines
                  size: 24,
                }),
              ],
              spacing: { after: 200 },
            })
          ),
        ],
      }],
    });
    
    // Generate the Word document buffer
    const buffer = await Packer.toBuffer(doc);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${docxFilename}"`);
    
    // Send the file
    res.send(buffer);
  } catch (error) {
    console.error('Error generating Word document:', error);
    res.status(500).json({ success: false, error: 'Failed to generate Word document' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

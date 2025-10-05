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
const session = require('express-session');
const { OpenAI } = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const { WebSocketServer } = require('ws');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);
// Set FFprobe path (required for metadata and duration detection)
ffmpeg.setFfprobePath(ffprobePath);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up CORS
app.use(cors());
app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.PIN_CODE || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware
function requireAuth(req, res, next) {
  // Allow access to login page and authentication endpoint
  if (req.path === '/login.html' || req.path === '/login.css' || req.path === '/login.js' || req.path === '/api/authenticate') {
    return next();
  }
  
  // Check if user is authenticated via session
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // For API calls, also check authorization header as fallback
  if (req.path.startsWith('/api/')) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader === `Bearer ${process.env.PIN_CODE}`) {
      return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // For page requests, redirect to login
  return res.redirect('/login.html');
}

// Apply authentication middleware to all routes except login
app.use(requireAuth);
app.use(express.static('public'));

// Authentication endpoint
app.post('/api/authenticate', (req, res) => {
  const { pin } = req.body;
  
  if (!pin) {
    return res.status(400).json({ success: false, error: 'PIN is required' });
  }
  
  if (pin === process.env.PIN_CODE) {
    // Set session as authenticated
    req.session.authenticated = true;
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid PIN' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Could not log out' });
      }
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } else {
    res.json({ success: true, message: 'Already logged out' });
  }
});

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
const OPTIMAL_CHUNK_SIZE = 24 * MB; // Target 24MB chunks (96% of limit for efficiency)
const MIN_CHUNK_DURATION = 120; // Minimum 2 minutes per chunk
const MAX_CHUNK_DURATION = 1800; // Maximum 30 minutes per chunk (allow large chunks close to 25MB)
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
      language: "en",  // Force English transcription to prevent language detection anomalies
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
  
  // Target 24MB chunks (close to 25MB limit)
  const targetChunkSize = 24 * MB;
  const optimalDuration = Math.floor(targetChunkSize / estimatedBitrate);
  
  // Clamp to reasonable bounds but allow large chunks
  const clampedDuration = Math.max(MIN_CHUNK_DURATION, Math.min(1800, optimalDuration)); // Max 30 minutes
  
  console.log(`File analysis: ${Math.round(fileSize/MB)}MB, estimated bitrate: ${Math.round(estimatedBitrate/1024)}KB/s`);
  console.log(`Calculated chunk duration: ${clampedDuration}s (${Math.round(clampedDuration/60)}min) targeting 24MB chunks`);
  
  return clampedDuration;
}

// Helper function to verify chunk sizes and re-split if necessary
async function verifyAndResplitChunks(options) {
  const { chunksDir, sessionId, outputExt, segmentDuration, reject } = options;

  const files = fs.readdirSync(chunksDir).filter(file => file.startsWith(`${sessionId}-chunk-`) && file.endsWith(outputExt));
  const oversizedFiles = files.filter(file => fs.statSync(path.join(chunksDir, file)).size > OPENAI_WHISPER_LIMIT);

  if (oversizedFiles.length === 0) {
    console.log('All chunks are within the size limit.');
    return Promise.resolve();
  }

  console.log(`Found ${oversizedFiles.length} oversized chunks. Re-splitting them...`);

  for (const file of oversizedFiles) {
    const oversizedPath = path.join(chunksDir, file);
    const newSegmentDuration = Math.max(1, Math.floor(segmentDuration / 2));
    const tempPattern = path.join(chunksDir, `${path.basename(file, outputExt)}-sub-%03d${outputExt}`);

    console.log(`Re-splitting ${file} into smaller chunks of ${newSegmentDuration}s...`);

    await new Promise((resolveSub, rejectSub) => {
      ffmpeg(oversizedPath)
        .output(tempPattern)
        .outputOptions(['-f', 'segment', `-segment_time`, `${newSegmentDuration}`, '-c', 'copy'])
        .on('end', () => {
          fs.unlinkSync(oversizedPath);
          resolveSub();
        })
        .on('error', (err) => {
          console.error(`Error re-splitting ${file}:`, err);
          rejectSub(err);
        })
        .run();
    });
  }

  // Rename sub-chunks to be processed and re-verify
  const subChunks = fs.readdirSync(chunksDir).filter(f => f.includes('-sub-'));
  for (const subChunk of subChunks) {
    const newName = `${sessionId}-chunk-${uuidv4().substring(0, 8)}${outputExt}`;
    fs.renameSync(path.join(chunksDir, subChunk), path.join(chunksDir, newName));
  }

  // Recursively verify until all chunks are compliant
  return verifyAndResplitChunks(options);
}

// Helper function to split large audio files and process chunks in parallel with optimized chunking
async function splitAndProcessAudioFile(filePath, segmentDuration = null, res) {
  const sessionId = uuidv4();
  
  // Determine output format based on input file extension
  const inputExt = path.extname(filePath).toLowerCase();
  const outputExt = inputExt === '.mp3' ? '.mp3' : '.m4a';
  const chunkOutputPattern = path.join(chunksDir, `${sessionId}-chunk-%03d${outputExt}`);
  
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
        message: `Splitting audio file (${Math.round(duration/60)}min total, ${Math.round(optimalSegmentDuration/60)}min chunks)...`,
        progress: 10
      }));
      
      // Split the original M4A file directly into chunks
      ffmpeg(filePath)
        .output(chunkOutputPattern)
        .outputOptions([
          '-f segment',
          `-segment_time ${optimalSegmentDuration}`,
          '-c copy'  // Copy codec without re-encoding to preserve quality and size
        ])
        .on('end', async () => {
          console.log('Initial file splitting completed. Verifying chunk sizes...');
          try {
            await verifyAndResplitChunks({ chunksDir, sessionId, outputExt, segmentDuration: optimalSegmentDuration, reject });
            res.write(JSON.stringify({
              status: 'processing',
              message: `Chunk size verification complete. Starting transcription...`,
              progress: 20
            }));
            processChunks(optimalSegmentDuration);
          } catch (verificationError) {
            console.error('Failed to verify and re-split chunks:', verificationError);
            reject(verificationError);
          }
        })
        .on('error', (err) => {
          console.error('Error splitting file:', filePath);
          console.error('FFmpeg Error:', err.message);
          console.error('FFmpeg Command Options:', ['-f segment', `-segment_time ${optimalSegmentDuration}`, '-c copy']);
          reject(err);
        })
        .run();
    });
    
    function processChunks(segmentDuration) {
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
            path.join(chunksDir, `${sessionId}-chunk-${String(idx).padStart(3, '0')}${outputExt}`)
          );
          
          // Combine results in proper order
          resolve({
            sessionId,
            chunks,
            originalFilePath: filePath,
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
          
          // Validate chunk file before transcription
          const chunkStats = fs.statSync(chunkPath);
          if (chunkStats.size === 0) {
            throw new Error('Chunk file is empty');
          }
          if (chunkStats.size > 25 * 1024 * 1024) {
            throw new Error('Chunk file exceeds 25MB limit');
          }
          
          // Add retry logic for API calls
          let transcription;
          let retryCount = 0;
          const maxRetries = 2;
          
          while (retryCount <= maxRetries) {
            try {
              transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-1",
                language: "en",  // Force English transcription for all chunks to maintain language consistency
              });
              break; // Success, exit retry loop
            } catch (apiError) {
              retryCount++;
              if (retryCount > maxRetries) {
                throw apiError; // Re-throw after max retries
              }
              console.log(`Chunk ${chunkIndex+1} failed, retrying (${retryCount}/${maxRetries})...`);
              // Wait before retry (exponential backoff)
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
          }
          
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
          
          // Mark this chunk as failed but continue processing others
          transcriptionResults[chunkIndex] = `[Error: Chunk ${chunkIndex+1} failed to transcribe - ${error.message}]`;
          processedChunks++;
          
          // Send progress update for failed chunk
          res.write(JSON.stringify({
            status: 'processing',
            message: `Chunk ${chunkIndex+1} failed, continuing with remaining chunks...`,
            progress: Math.floor(20 + (processedChunks / totalChunks) * 70)
          }));
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
          .filter(file => file.startsWith(`${sessionId}-chunk-`) && file.endsWith(outputExt))
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
      
      // Start the FFmpeg process to split the original file
      ffmpeg(filePath)
        .output(chunkOutputPattern)
        .outputOptions([
          '-f segment',
          `-segment_time ${segmentDuration}`,
          '-c copy'
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
      message: `Processing large file (${Math.round(fileSize/MB)}MB). Using intelligent chunking for optimal rate limits...`,
      progress: 5
    }));
    
    // Split the file into optimized chunks and begin processing them in parallel
    const { sessionId, chunks, originalFilePath, combinedTranscription } = await splitAndProcessAudioFile(filePath, null, res);
    
    res.write(JSON.stringify({
      status: 'processing',
      message: 'Transcription complete. Finalizing results...',
      progress: 95
    }));
    
    // Save transcription to file
    const savedFilename = saveTranscription(combinedTranscription, req.file.originalname);
    
    // Clean up all temporary files
    cleanupFiles(filePath, chunks);
    
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

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// WebSocket server for console logs
const wss = new WebSocketServer({ server });

// Store connected WebSocket clients
const wsClients = new Set();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'info',
    message: 'Connected to server console'
  }));
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Function to broadcast console logs to all connected clients
function broadcastLog(type, message) {
  const logData = JSON.stringify({
    type: type,
    message: message,
    timestamp: new Date().toISOString()
  });
  
  wsClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(logData);
      } catch (error) {
        console.error('Error sending to WebSocket client:', error);
      }
    }
  });
}

// Override console methods to broadcast logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

console.log = function(...args) {
  originalLog.apply(console, args);
  broadcastLog('info', args.join(' '));
};

console.error = function(...args) {
  originalError.apply(console, args);
  broadcastLog('error', args.join(' '));
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  broadcastLog('warning', args.join(' '));
};

console.info = function(...args) {
  originalInfo.apply(console, args);
  broadcastLog('info', args.join(' '));
};

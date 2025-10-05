// Helper function to get auth headers (for API calls that need Bearer token)
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
    };
}

// Logout function
async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Error during logout:', error);
    }
    window.location.href = '/login.html';
}

document.addEventListener('DOMContentLoaded', () => {
    // Fetch version information
    fetchVersionInfo();
    
    // Load saved transcriptions
    loadSavedTranscriptions();
    

    // Elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const uploadBtn = document.getElementById('upload-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const status = document.getElementById('status');
    const resultContainer = document.getElementById('result-container');
    const transcriptionText = document.getElementById('transcription-text');
    const copyBtn = document.getElementById('copy-btn');
    const downloadBtn = document.getElementById('download-btn');
    const downloadWordBtn = document.getElementById('download-word-btn');
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    const notificationClose = document.getElementById('notification-close');

    let selectedFile = null;
    let currentTranscription = null;
    let currentFilename = null;

    // Event listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadBtn.addEventListener('click', handleUpload);
    copyBtn.addEventListener('click', copyToClipboard);
    downloadBtn.addEventListener('click', downloadTranscription);
    downloadWordBtn.addEventListener('click', downloadWordTranscription);
    notificationClose.addEventListener('click', dismissNotification);

    // Handle file selection
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file && isAudioFile(file)) {
            setSelectedFile(file);
        } else if (file) {
            showNotification('Please select a valid audio file', true);
            clearSelectedFile();
        }
    }

    // Handle drag over
    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('dragging');
    }

    // Handle drag leave
    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragging');
    }

    // Handle drop
    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragging');
        
        const file = e.dataTransfer.files[0];
        if (file && isAudioFile(file)) {
            setSelectedFile(file);
        } else if (file) {
            showNotification('Please drop a valid audio file', true);
        }
    }

    // Set selected file
    function setSelectedFile(file) {
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        uploadBtn.disabled = false;
    }

    // Clear selected file
    function clearSelectedFile() {
        selectedFile = null;
        fileName.textContent = 'No file selected';
        fileSize.textContent = '';
        uploadBtn.disabled = true;
    }

    // Check if file is audio
    function isAudioFile(file) {
        const acceptedTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/flac'];
        return acceptedTypes.includes(file.type) || 
               file.name.match(/\.(mp3|wav|m4a|ogg|flac)$/i);
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Handle file upload and transcription
    async function handleUpload() {
        if (!selectedFile) return;

        // Show progress
        progressContainer.style.display = 'block';
        uploadBtn.disabled = true;
        resultContainer.style.display = 'none';

        const formData = new FormData();
        formData.append('audio', selectedFile);

        try {
            // Simulate upload progress
            let progress = 0;
            const progressInterval = setInterval(() => {
                progress += Math.random() * 10;
                if (progress > 90) {
                    progress = 90; // Max at 90% until actual completion
                    clearInterval(progressInterval);
                }
                progressBar.style.width = `${progress}%`;
            }, 500);

            status.textContent = 'Uploading and transcribing...';

            // Send to server
            const response = await fetch('/transcribe', {
                method: 'POST',
                body: formData
            });
            
            clearInterval(progressInterval);

            if (!response.ok) {
                let errorMessage = 'Failed to transcribe audio';
                try {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } else {
                        const errorText = await response.text();
                        console.error("Server response:", errorText);
                    }
                } catch (parseError) {
                    console.error("Error parsing response:", parseError);
                }
                throw new Error(errorMessage);
            }
            
            const contentType = response.headers.get("content-type");
            const transferEncoding = response.headers.get("transfer-encoding");
            
            // Check if this is a chunked response (large file being processed in chunks)
            if (contentType && contentType.includes("application/json") && transferEncoding && transferEncoding.includes("chunked")) {
                // Handle chunked processing for large files
                let transcription = await handleChunkedResponse(response);
                
                // Complete progress
                progressBar.style.width = '100%';
                status.textContent = 'Transcription complete!';
                
                // Show result
                transcriptionText.textContent = transcription;
                resultContainer.style.display = 'block';
                
                // Store current transcription data for Word download
                currentTranscription = transcription;
                currentFilename = selectedFile ? selectedFile.name : 'transcription';
                
                // Refresh saved transcriptions list
                loadSavedTranscriptions();
            } else {
                // Handle regular response for small files
                // Complete progress
                progressBar.style.width = '100%';
                status.textContent = 'Transcription complete!';
                
                // Show result
                let data;
                if (contentType && contentType.includes("application/json")) {
                    data = await response.json();
                } else {
                    const text = await response.text();
                    console.error("Unexpected response format:", text);
                    throw new Error("Server returned an invalid response format");
                }
                
                transcriptionText.textContent = data.transcription;
                resultContainer.style.display = 'block';
                
                // Store current transcription data for Word download
                currentTranscription = data.transcription;
                currentFilename = selectedFile ? selectedFile.name : 'transcription';
                
                // Refresh saved transcriptions list
                loadSavedTranscriptions();
            }

            // Reset after 2 seconds
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
                clearSelectedFile();
                uploadBtn.disabled = false;
            }, 2000);

        } catch (error) {
            console.error('Error:', error);
            status.textContent = `Error: ${error.message}`;
            progressBar.style.width = '0%';
            showNotification(error.message, true);
            
            setTimeout(() => {
                progressContainer.style.display = 'none';
                uploadBtn.disabled = false;
            }, 2000);
        }
    }

    // Process chunked response for large files
    async function handleChunkedResponse(response) {
        const reader = response.body.getReader();
        let partialData = "";
        let lastUpdate = null;
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }
                
                // Convert the chunk to text
                const chunk = new TextDecoder().decode(value);
                partialData += chunk;
                
                // Try to parse any complete JSON objects
                try {
                    // There might be multiple JSON objects in the chunk
                    // Find the last complete JSON object
                    const lastBrace = partialData.lastIndexOf('}');
                    if (lastBrace !== -1) {
                        const validPart = partialData.substring(0, lastBrace + 1);
                        const parts = validPart.split('}{');
                        
                        if (parts.length > 0) {
                            // Process each complete object
                            for (let i = 0; i < parts.length; i++) {
                                let jsonStr = parts[i];
                                if (i > 0) jsonStr = '{' + jsonStr; // Add opening brace if it was split
                                if (i < parts.length - 1) jsonStr = jsonStr + '}'; // Add closing brace if it was split
                                
                                try {
                                    const update = JSON.parse(jsonStr);
                                    lastUpdate = update;
                                    
                                    // Update the UI with progress
                                    if (update.status === 'processing') {
                                        status.textContent = update.message || 'Processing...';
                                        progressBar.style.width = `${update.progress}%`;
                                    }
                                } catch (e) {
                                    // Partial or invalid JSON, skip it
                                }
                            }
                            
                            // Keep any remaining partial data
                            partialData = partialData.substring(lastBrace + 1);
                        }
                    }
                } catch (e) {
                    console.error('Error processing chunk:', e);
                }
            }
            
            // Return the final transcription
            if (lastUpdate && lastUpdate.transcription) {
                return lastUpdate.transcription;
            } else if (lastUpdate && lastUpdate.status === 'complete' && lastUpdate.success) {
                return lastUpdate.transcription || '';
            } else {
                console.error('No valid transcription in the response:', lastUpdate);
                throw new Error('No transcription received from server');
            }
        } catch (error) {
            console.error('Error handling chunked response:', error);
            throw error;
        }
    }

    // Copy to clipboard
    function copyToClipboard() {
        const text = transcriptionText.textContent;
        navigator.clipboard.writeText(text)
            .then(() => showNotification('Copied to clipboard!'))
            .catch(() => showNotification('Failed to copy text', true));
    }

    // Download transcription
    function downloadTranscription() {
        const text = transcriptionText.textContent;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcription-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('Transcription downloaded!');
    }
    
    // Download Word transcription
    async function downloadWordTranscription() {
        if (!currentTranscription || !currentFilename) {
            showNotification('No transcription available for download', true);
            return;
        }
        
        try {
            // Create a temporary form data to send the transcription for Word conversion
            const formData = new FormData();
            formData.append('transcription', currentTranscription);
            formData.append('filename', currentFilename);
            
            const response = await fetch('/api/generate-word', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                const baseFilename = currentFilename.replace(/\.[^/.]+$/, '');
                a.download = `${baseFilename}-${new Date().toISOString().split('T')[0]}.docx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showNotification('Word document downloaded!');
            } else {
                showNotification('Error generating Word document', true);
            }
        } catch (error) {
            console.error('Error downloading Word document:', error);
            showNotification('Error downloading Word document', true);
        }
    }

    // Show notification
    function showNotification(message, isError = false) {
        notificationMessage.textContent = message;
        notification.classList.toggle('error', isError);
        notification.classList.add('show');
        
        // Only auto-hide success notifications, keep error notifications persistent
        if (!isError) {
            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }
    }

    // Dismiss notification when close button is clicked
    function dismissNotification() {
        notification.classList.remove('show');
    }
    
    // Function to fetch version information
    async function fetchVersionInfo() {
        try {
            const response = await fetch('/api/version', {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const versionData = await response.json();
                const versionDisplay = document.getElementById('version-display');
                if (versionDisplay) {
                    versionDisplay.textContent = `Version ${versionData.version} (Build ${versionData.build})`;
                }
            }
        } catch (error) {
            console.error('Error fetching version info:', error);
        }
    }
    
    // Function to load saved transcriptions
    async function loadSavedTranscriptions() {
        try {
            const response = await fetch('/api/transcriptions', {
                headers: getAuthHeaders()
            });
            const data = await response.json();
            
            const transcriptionsList = document.getElementById('transcriptions-list');
            
            if (data.success && data.transcriptions.length > 0) {
                transcriptionsList.innerHTML = data.transcriptions.map(transcription => {
                    const date = new Date(transcription.created).toLocaleDateString();
                    const time = new Date(transcription.created).toLocaleTimeString();
                    const size = formatFileSize(transcription.size);
                    
                    return `
                        <div class="transcription-item">
                            <div class="transcription-info">
                                <div class="transcription-filename">${transcription.filename}</div>
                                <div class="transcription-meta">${date} ${time} • ${size}</div>
                            </div>
                            <div class="transcription-actions">
                                <button class="transcription-btn view" onclick="viewTranscription('${transcription.filename}')">
                                    <i class="fas fa-eye"></i> View
                                </button>
                                <button class="transcription-btn download" onclick="downloadSavedTranscription('${transcription.filename}')">
                                    <i class="fas fa-download"></i> TXT
                                </button>
                                ${transcription.hasDocx ? `
                                    <button class="transcription-btn download-docx" onclick="downloadWordDocument('${transcription.baseFilename}')">
                                        <i class="fas fa-file-word"></i> Word
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                transcriptionsList.innerHTML = '<div class="no-transcriptions">No saved transcriptions found</div>';
            }
        } catch (error) {
            console.error('Error loading saved transcriptions:', error);
            document.getElementById('transcriptions-list').innerHTML = 
                '<div class="no-transcriptions">Error loading transcriptions</div>';
        }
    }
    
    // Function to view a saved transcription
    window.viewTranscription = async function(filename) {
        try {
            const response = await fetch(`/api/transcriptions/${filename}`);
            const data = await response.json();
            
            if (data.success) {
                // Display the transcription in the result container
                transcriptionText.textContent = data.content;
                resultContainer.style.display = 'block';
                resultContainer.scrollIntoView({ behavior: 'smooth' });
                showNotification(`Loaded transcription: ${filename}`);
            } else {
                showNotification('Error loading transcription', true);
            }
        } catch (error) {
            console.error('Error viewing transcription:', error);
            showNotification('Error loading transcription', true);
        }
    };
    
    // Function to download a saved transcription (TXT)
    window.downloadSavedTranscription = async function(filename) {
        try {
            const response = await fetch(`/api/transcriptions/${filename}`);
            const data = await response.json();
            
            if (data.success) {
                const blob = new Blob([data.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showNotification(`Downloaded: ${filename}`);
            } else {
                showNotification('Error downloading transcription', true);
            }
        } catch (error) {
            console.error('Error downloading transcription:', error);
            showNotification('Error downloading transcription', true);
        }
    };
    
    // Function to download Word document
    window.downloadWordDocument = async function(baseFilename) {
        try {
            const response = await fetch(`/api/transcriptions/${baseFilename}/docx`, {
                headers: getAuthHeaders()
            });
            
            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseFilename}.docx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showNotification(`Downloaded Word document: ${baseFilename}.docx`);
            } else {
                showNotification('Error downloading Word document', true);
            }
        } catch (error) {
            console.error('Error downloading Word document:', error);
            showNotification('Error downloading Word document', true);
        }
    };
    
    // Console functionality
    initializeConsole();
});

// Console WebSocket connection and functionality
function initializeConsole() {
    const consoleOutput = document.getElementById('console-output');
    const consoleToggleBtn = document.getElementById('console-toggle-btn');
    const consoleClearBtn = document.getElementById('console-clear-btn');
    let isMinimized = false;
    
    // WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws;
    let reconnectTimeout;
    
    function connectWebSocket() {
        try {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                addConsoleLog('success', 'Connected to server console');
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    addConsoleLog(data.type, data.message, data.timestamp);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            ws.onerror = (error) => {
                addConsoleLog('error', 'WebSocket connection error');
            };
            
            ws.onclose = () => {
                addConsoleLog('warning', 'Disconnected from server console. Reconnecting...');
                // Attempt to reconnect after 3 seconds
                reconnectTimeout = setTimeout(connectWebSocket, 3000);
            };
        } catch (error) {
            addConsoleLog('error', `Failed to connect: ${error.message}`);
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
    }
    
    function addConsoleLog(type, message, timestamp) {
        const line = document.createElement('div');
        line.className = `console-line console-${type}`;
        
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const typeLabel = type.toUpperCase().padEnd(7);
        line.textContent = `[${time}] [${typeLabel}] ${message}`;
        
        consoleOutput.appendChild(line);
        
        // Auto-scroll to bottom
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
        
        // Limit console lines to 500
        while (consoleOutput.children.length > 500) {
            consoleOutput.removeChild(consoleOutput.firstChild);
        }
    }
    
    // Toggle console minimize/maximize
    consoleToggleBtn.addEventListener('click', () => {
        isMinimized = !isMinimized;
        consoleOutput.classList.toggle('minimized', isMinimized);
        const icon = consoleToggleBtn.querySelector('i');
        icon.className = isMinimized ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    });
    
    // Clear console
    consoleClearBtn.addEventListener('click', () => {
        consoleOutput.innerHTML = '';
        addConsoleLog('info', 'Console cleared');
    });
    
    // Initialize WebSocket connection
    connectWebSocket();
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }
        if (ws) {
            ws.close();
        }
    });
}

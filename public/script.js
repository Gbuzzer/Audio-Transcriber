document.addEventListener('DOMContentLoaded', () => {
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
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    const notificationClose = document.getElementById('notification-close');

    let selectedFile = null;

    // Event listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadBtn.addEventListener('click', handleUpload);
    copyBtn.addEventListener('click', copyToClipboard);
    downloadBtn.addEventListener('click', downloadTranscription);
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
});

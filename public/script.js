class EESystemGenerator {
    constructor() {
        this.generatedHtml = '';
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.uploadArea = document.getElementById('uploadArea');
        this.csvFile = document.getElementById('csvFile');
        this.uploadProgress = document.getElementById('uploadProgress');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.errorMessage = document.getElementById('errorMessage');
        this.uploadSection = document.getElementById('uploadSection');
        this.resultsSection = document.getElementById('resultsSection');
        this.locationCount = document.getElementById('locationCount');
        this.previewList = document.getElementById('previewList');
        this.copyHtmlBtn = document.getElementById('copyHtmlBtn');
        this.downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
        this.processAnotherBtn = document.getElementById('processAnotherBtn');
        this.copyFeedback = document.getElementById('copyFeedback');
    }

    bindEvents() {
        // Upload area click
        this.uploadArea.addEventListener('click', () => {
            this.csvFile.click();
        });

        // File input change
        this.csvFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });

        // Drag and drop
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadArea.classList.add('dragover');
        });

        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFile(files[0]);
            }
        });

        // Result buttons
        this.copyHtmlBtn.addEventListener('click', () => this.copyToClipboard());
        this.downloadHtmlBtn.addEventListener('click', () => this.downloadHtml());
        this.processAnotherBtn.addEventListener('click', () => this.resetForm());
    }

    handleFile(file) {
        // Validate file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            this.showError('Please select a CSV file');
            return;
        }

        // Validate file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            this.showError('File size must be less than 5MB');
            return;
        }

        this.uploadFile(file);
    }

    async uploadFile(file) {
        const formData = new FormData();
        formData.append('csvFile', file);

        this.showProgress();
        this.hideError();

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Upload failed');
            }

            this.handleSuccess(result);
        } catch (error) {
            this.showError(error.message);
            this.hideProgress();
        }
    }

    showProgress() {
        this.uploadProgress.style.display = 'block';
        this.progressText.textContent = 'Processing your CSV file...';
        
        // Animate progress bar
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress > 90) {
                clearInterval(interval);
            }
            this.progressFill.style.width = Math.min(progress, 90) + '%';
        }, 200);
        
        this.progressInterval = interval;
    }

    hideProgress() {
        this.uploadProgress.style.display = 'none';
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
    }

    hideError() {
        this.errorMessage.style.display = 'none';
    }

    handleSuccess(result) {
        // Complete progress bar
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
        this.progressFill.style.width = '100%';
        this.progressText.textContent = 'Processing complete!';

        setTimeout(() => {
            this.hideProgress();
            this.showResults(result);
        }, 1000);
    }

    showResults(result) {
        // Store generated HTML
        this.generatedHtml = result.html;

        // Update location count
        this.locationCount.textContent = result.locationCount;

        // Show preview
        this.previewList.innerHTML = '';
        result.preview.forEach(location => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `
                <div class="preview-name">${this.escapeHtml(location.name)}</div>
                <div class="preview-address">${this.escapeHtml(location.address)}</div>
                <div class="preview-booking">📅 Booking: ${this.escapeHtml(location.bookingUrl)}</div>
                ${location.mapsLink ? `<div class="preview-maps">🗺️ Maps: ${this.escapeHtml(location.mapsLink)}</div>` : ''}
            `;
            this.previewList.appendChild(item);
        });

        // Show results section, hide upload section
        this.uploadSection.style.display = 'none';
        this.resultsSection.style.display = 'block';

        // Scroll to results
        this.resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.generatedHtml);
            this.showCopyFeedback();
        } catch (error) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = this.generatedHtml;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showCopyFeedback();
        }
    }

    showCopyFeedback() {
        this.copyFeedback.style.display = 'block';
        setTimeout(() => {
            this.copyFeedback.style.display = 'none';
        }, 3000);
    }

    downloadHtml() {
        const blob = new Blob([this.generatedHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'eesystem-location-finder.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    resetForm() {
        // Reset form
        this.csvFile.value = '';
        this.generatedHtml = '';
        
        // Reset progress
        this.hideProgress();
        this.hideError();
        this.progressFill.style.width = '0%';
        
        // Show upload section, hide results
        this.uploadSection.style.display = 'block';
        this.resultsSection.style.display = 'none';
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new EESystemGenerator();
});
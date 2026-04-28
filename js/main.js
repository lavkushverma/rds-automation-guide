// Main JavaScript for RDS Automation Guide

// Copy code to clipboard
function copyCode(elementId) {
    const codeElement = document.getElementById(elementId);
    const text = codeElement.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        // Show success message
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.background = '#28a745';
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy code. Please try manually.');
    });
}

// Show loading overlay
function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

// Format date for filenames
function getFormattedDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// Initialize Prism for syntax highlighting
document.addEventListener('DOMContentLoaded', function() {
    if (typeof Prism !== 'undefined') {
        Prism.highlightAll();
    }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

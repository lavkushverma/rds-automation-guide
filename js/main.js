// Main JavaScript for RDS Automation Guide

// Copy code to clipboard
function copyCode(elementId) {
    const codeElement = document.getElementById(elementId);
    if (!codeElement) {
        console.error('Code element not found:', elementId);
        return;
    }
    
    const text = codeElement.textContent;
    
    // Try modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showCopySuccess(event.target);
        }).catch(err => {
            console.error('Clipboard API failed:', err);
            fallbackCopyToClipboard(text, event.target);
        });
    } else {
        fallbackCopyToClipboard(text, event.target);
    }
}

// Fallback copy method
function fallbackCopyToClipboard(text, button) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showCopySuccess(button);
        } else {
            alert('Failed to copy code. Please copy manually.');
        }
    } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Failed to copy code. Please copy manually.');
    }
    
    document.body.removeChild(textArea);
}

// Show copy success message
function showCopySuccess(button) {
    if (!button) return;
    
    const originalText = button.textContent;
    const originalBg = button.style.background;
    
    button.textContent = '✓ Copied!';
    button.style.background = '#28a745';
    
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = originalBg;
    }, 2000);
}

// Format date for filenames
function getFormattedDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// Initialize Prism for syntax highlighting
document.addEventListener('DOMContentLoaded', function() {
    console.log('Page loaded - initializing...');
    
    // Syntax highlighting
    if (typeof Prism !== 'undefined') {
        Prism.highlightAll();
        console.log('Syntax highlighting initialized');
    }
    
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
});

// Add scroll to top button
window.addEventListener('scroll', function() {
    // You can add a scroll-to-top button here if needed
});

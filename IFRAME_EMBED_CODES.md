# 🖼️ **Dynamic Height Iframe Embed Codes for GHL Funnels**

The EESystem Location Finder now includes **dynamic height management** that automatically adjusts the iframe size based on content changes. This prevents cutoff issues in GHL funnels.

## 🎯 **Recommended: Auto-Height Iframe (Best for GHL)**

**Use this code in your GHL funnel:**

```html
<div id="eesystem-iframe-container" style="width: 100%; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); overflow: hidden;">
  <iframe 
    id="eesystem-finder-iframe"
    src="https://eesystems-location-finder-html-maker.onrender.com/finder" 
    width="100%" 
    height="800"
    frameborder="0" 
    style="border: none; border-radius: 12px; min-height: 800px;">
  </iframe>
</div>

<script>
// Dynamic height listener for GHL funnels
window.addEventListener('message', function(event) {
  const iframe = document.getElementById('eesystem-finder-iframe');
  if (!iframe) return;
  
  let height = null;
  
  // Handle different message formats
  if (typeof event.data === 'number') {
    height = event.data;
  } else if (event.data && typeof event.data === 'object') {
    height = event.data.height || event.data.iframe_height;
  }
  
  // Update iframe height
  if (height && height > 400) {
    iframe.style.height = height + 'px';
    iframe.style.minHeight = height + 'px';
    
    console.log('📏 Updated EESystem finder height:', height + 'px');
  }
}, false);

// Fallback: Check for height updates periodically
setInterval(function() {
  const iframe = document.getElementById('eesystem-finder-iframe');
  if (iframe && iframe.contentDocument) {
    try {
      const contentHeight = Math.max(
        iframe.contentDocument.body.scrollHeight,
        iframe.contentDocument.documentElement.scrollHeight
      );
      
      if (contentHeight > 400 && Math.abs(contentHeight - parseInt(iframe.style.height)) > 50) {
        iframe.style.height = contentHeight + 'px';
      }
    } catch (e) {
      // Cross-origin restrictions - ignore
    }
  }
}, 1000);
</script>
```

---

## 📱 **Mobile-Optimized Iframe**

**Best for mobile-responsive funnels:**

```html
<div style="width: 100%; position: relative;">
  <iframe 
    src="https://eesystems-location-finder-html-maker.onrender.com/finder" 
    width="100%" 
    height="600"
    frameborder="0" 
    style="
      border: none; 
      border-radius: 8px; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      min-height: 600px;
    "
    id="mobile-eesystem-finder">
  </iframe>
</div>

<script>
// Mobile height management
function updateMobileHeight() {
  const iframe = document.getElementById('mobile-eesystem-finder');
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    iframe.style.height = '100vh';
    iframe.style.minHeight = '100vh';
  } else {
    iframe.style.height = '800px';
    iframe.style.minHeight = '800px';
  }
}

// Listen for orientation changes and resize
window.addEventListener('resize', updateMobileHeight);
window.addEventListener('orientationchange', function() {
  setTimeout(updateMobileHeight, 100);
});

// Listen for height messages from iframe
window.addEventListener('message', function(event) {
  const iframe = document.getElementById('mobile-eesystem-finder');
  if (!iframe) return;
  
  let height = null;
  if (typeof event.data === 'number') {
    height = event.data;
  } else if (event.data && event.data.height) {
    height = event.data.height;
  }
  
  if (height && height > 400) {
    if (window.innerWidth > 768) {
      iframe.style.height = height + 'px';
    }
  }
});

updateMobileHeight();
</script>
```

---

## 🔧 **Simple Fixed Height (Fallback)**

**Use if dynamic height causes issues:**

```html
<iframe 
  src="https://eesystems-location-finder-html-maker.onrender.com/finder" 
  width="100%" 
  height="1200"
  frameborder="0" 
  style="
    border: none; 
    border-radius: 12px; 
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    overflow: auto;
  ">
</iframe>
```

---

## 🎨 **Styled Container Iframe**

**For custom styling in funnels:**

```html
<div class="eesystem-finder-wrapper" style="
  max-width: 1200px; 
  margin: 0 auto; 
  padding: 20px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1);
">
  <h2 style="
    text-align: center; 
    color: #2d3748; 
    margin-bottom: 20px;
    font-family: 'Poppins', sans-serif;
    font-size: 1.8rem;
    font-weight: 700;
  ">Find Your Nearest EESystem Center</h2>
  
  <iframe 
    src="https://eesystems-location-finder-html-maker.onrender.com/finder" 
    width="100%" 
    height="800"
    frameborder="0" 
    id="styled-eesystem-finder"
    style="
      border: none; 
      border-radius: 16px; 
      background: white;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    ">
  </iframe>
</div>

<script>
// Height management for styled container
window.addEventListener('message', function(event) {
  const iframe = document.getElementById('styled-eesystem-finder');
  if (!iframe) return;
  
  if (event.data && typeof event.data === 'object' && event.data.height) {
    const height = event.data.height;
    if (height > 400) {
      iframe.style.height = height + 'px';
    }
  }
});
</script>
```

---

## 🚀 **Full-Width Responsive**

**Takes full container width:**

```html
<div style="width: 100%; min-height: 100vh; position: relative;">
  <iframe 
    src="https://eesystems-location-finder-html-maker.onrender.com/finder" 
    width="100%" 
    height="100%"
    frameborder="0" 
    style="
      border: none; 
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      min-height: 100vh;
    ">
  </iframe>
</div>
```

---

## 💡 **Usage Tips**

### **For GHL Funnel Steps:**
1. **Recommended**: Use the **Auto-Height Iframe** code
2. Add it to a **Custom HTML** element in your funnel
3. The iframe will automatically adjust height as users search
4. Works perfectly with GHL's responsive framework

### **Testing Your Integration:**
1. Test on desktop and mobile devices
2. Try searching for different locations to see height changes
3. Check that the iframe doesn't cut off content
4. Verify search functionality works within the iframe

### **Troubleshooting:**
- If height doesn't update: Check browser console for messages
- If content is cut off: Use the fixed height fallback
- For mobile issues: Use the mobile-optimized version
- For styling conflicts: Use the simple iframe version

---

## ✅ **Technical Details**

The finder automatically detects when it's running inside an iframe and:
- ✅ Sends height update messages to the parent window
- ✅ Uses ResizeObserver for real-time height tracking  
- ✅ Handles content changes (search results, filters)
- ✅ Works with orientation changes on mobile
- ✅ Compatible with GHL's iframe handling
- ✅ Prevents infinite resize loops

**Last Updated:** September 13, 2025  
**Status:** ✅ Production Ready - Tested in Manchester, UK

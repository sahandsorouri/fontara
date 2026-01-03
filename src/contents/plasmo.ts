// import styleText from "data-text:../fonts.css"
import type { PlasmoCSConfig } from "plasmo"

import { Storage } from "@plasmohq/storage"

import { getFonts } from "~src/fonts"
import { CUSTOM_CSS, excludedTags, iconClasses } from "~src/lib/constants"
import { isUrlActive } from "~src/lib/utils"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true
}

const storage = new Storage({
  area: "local"
})
const storageLocal = new Storage({
  area: "local"
})

let observer: MutationObserver | null = null
let processingQueue: Set<HTMLElement> = new Set()
let processingTimer: number | null = null
let isProcessing = false
let isPageVisible = !document.hidden

// Track page visibility to pause processing when tab is not active
document.addEventListener("visibilitychange", () => {
  isPageVisible = !document.hidden
  if (isPageVisible && processingQueue.size > 0) {
    // Resume processing when page becomes visible
    processBatch()
  }
})

// Performance optimization: Debounce function
function debounce(func: Function, wait: number) {
  let timeout: number | null = null
  return function executedFunction(...args: any[]) {
    const later = () => {
      timeout = null
      func(...args)
    }
    if (timeout !== null) {
      clearTimeout(timeout)
    }
    timeout = window.setTimeout(later, wait)
  }
}

async function injectFontStyles(): Promise<boolean> {
  const currentUrl = window.location.href
  const websiteList = await storage.get("websiteList")
  const matchingWebsite = (websiteList as any).find((website) => {
    const regex = new RegExp(website.regex, "i")
    return regex.test(currentUrl.trim())
  })
  let hasCustomCss = false

  try {
    // Check if styles are already injected
    const existingStyles = document.getElementById("fontara-font-styles")
    if (existingStyles) return

    // Create style element for built-in fonts
    const style = document.createElement("style")
    style.id = "fontara-font-styles"
    style.textContent = getFonts()
    document.head.appendChild(style)

    // const styleElement = document.createElement("style")
    // // Set type and content
    // styleElement.id = "fontara-font-test-styles"
    // styleElement.textContent = `
    //   [data-fontara-processed] {
    //     font-family: '';
    //   }
    // `
    // // Append to head
    // document.head.appendChild(styleElement)

    if (matchingWebsite?.customCss) {
      hasCustomCss = true
      // Check if this custom CSS style is already injected
      const existingCustomCssStyle = document.getElementById(
        "fontara-custom-css-style"
      )
      if (!existingCustomCssStyle) {
        const style = document.createElement("style")
        style.id = "fontara-custom-css-style"
        style.textContent = CUSTOM_CSS[matchingWebsite.url]
        document.head.appendChild(style)
      }
    }

    // Create a separate style element for custom fonts
    const customStyle = document.createElement("style")
    customStyle.id = "fontara-custom-font-styles"

    const customFontList = await storageLocal.get("customFontList")

    if (
      customFontList &&
      Array.isArray(customFontList) &&
      customFontList.length > 0
    ) {
      let customFontFaces = ""
      customFontList.forEach((font) => {
        if (font.value && font.data) {
          const fontName = font.value
          const fontData = font.data

          // Create the font-face declaration. Determine format based on data
          // This assumes the data is base64 encoded font data
          let format = "truetype" // Default format

          if (fontData.includes("data:font/woff2")) {
            format = "woff2"
          } else if (fontData.includes("data:font/woff")) {
            format = "woff"
          } else if (fontData.includes("data:font/otf")) {
            format = "opentype"
          } else if (fontData.includes("data:font/ttf")) {
            format = "truetype"
          }

          customFontFaces += `
            @font-face {
              font-family: "${fontName}";
              src: url("${fontData}") format("${format}");
              font-weight: normal;
              font-style: normal;
              font-display: swap;
            }
          `
        }
      })

      // Set the style content with all the custom font faces
      customStyle.textContent = customFontFaces
      document.head.appendChild(customStyle)
    }
  } catch (err) {
    //console.error("Failed to inject font styles:", err)
  }
  return hasCustomCss
}

function removeFontStyles() {
  try {
    // Stop observing first
    stopObserving()

    // Clear processing queue
    processingQueue.clear()
    if (processingTimer !== null) {
      clearTimeout(processingTimer)
      processingTimer = null
    }

    // Remove the font styles
    const fontStyles = document.getElementById("fontara-font-styles")
    if (fontStyles) {
      fontStyles.remove()
    }

    // Remove the dynamic font variable
    const dynamicFont = document.getElementById("fontara-dynamic-font")
    if (dynamicFont) {
      dynamicFont.remove()
    }

    // Remove the custom font styles
    const customFont = document.getElementById("fontara-custom-font-styles")
    if (customFont) {
      customFont.remove()
    }

    // Remove the custom css
    const customCss = document.getElementById("fontara-custom-css-style")
    if (customCss) {
      customCss.remove()
    }

    // Remove the applied styles from all elements
    const allElements = document.querySelectorAll("[style*='fontara-font']")
    allElements.forEach((element) => {
      if (element instanceof HTMLElement) {
        element.style.fontFamily = ""
        if (element.style.length === 0) {
          element.removeAttribute("style")
        }
      }
    })
  } catch (err) {
    //console.error("Failed to remove font styles:", err)
  }
}

function processElement(node: HTMLElement): void {
  try {
    // Quick checks first (no DOM operations)
    const tagName = node.tagName.toLowerCase()
    if (excludedTags.includes(tagName)) {
      return
    }

    // Check for icon classes (fast check)
    const classList = node.classList
    if (classList.length > 0) {
      for (let i = 0; i < iconClasses.length; i++) {
        if (classList.contains(iconClasses[i])) {
          return
        }
      }
    }

    // Check for icon fonts
    const computedStyle = window.getComputedStyle(node)
    const fontFamily = computedStyle.fontFamily.toLowerCase()
    
    if (
      fontFamily.includes("fontawesome") ||
      fontFamily.includes("material") ||
      fontFamily.includes("icon") ||
      fontFamily.includes("glyphicon")
    ) {
      return
    }

    // Parse the font family correctly, handling quotes properly
    const fontFamilies = computedStyle.fontFamily
      .split(",")
      .map((f) => f.trim().replace(/^["']+|["']+$/g, ""))
      .filter((f) => !f.includes("-Fontara") && Boolean(f))

    const cleanFontFamily = fontFamilies.join(", ")

    // Apply font family with CSS variable
    node.setAttribute(
      "style",
      `font-family: var(--fontara-font)${cleanFontFamily ? `, ${cleanFontFamily}` : ""} !important; ${node.getAttribute("style") || ""}`
    )
  } catch (err) {
    // Silently fail for problematic elements
  }
}

// Batch processing with idle callback for better performance
function processBatch() {
  // Don't process if page is hidden or already processing
  if (!isPageVisible || isProcessing || processingQueue.size === 0) return

  isProcessing = true
  const batch = Array.from(processingQueue).slice(0, 50) // Process 50 at a time
  
  batch.forEach((element) => {
    try {
      // Double-check element is still in DOM
      if (element.isConnected) {
        processElement(element)
      }
    } catch (err) {
      // Skip problematic elements
    }
    processingQueue.delete(element)
  })

  isProcessing = false

  // Continue processing if there are more items and page is visible
  if (processingQueue.size > 0 && isPageVisible) {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => processBatch(), { timeout: 100 })
    } else {
      setTimeout(processBatch, 16) // ~60fps fallback
    }
  }
}

export async function getAllElementsWithFontFamily(
  rootNode: HTMLElement
): Promise<void> {
  if (!rootNode) return

  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  
  let count = 0
  const batchSize = 50 // Process in batches
  
  while (node) {
    if (node instanceof HTMLElement) {
      processingQueue.add(node)
      count++
      
      // Process batch every 50 elements to prevent blocking
      if (count % batchSize === 0) {
        await new Promise(resolve => setTimeout(resolve, 0)) // Yield to browser
      }
    }
    node = walker.nextNode()
  }

  // Start batch processing
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => processBatch(), { timeout: 100 })
  } else {
    setTimeout(processBatch, 16)
  }
}

async function applyFontsIfActive() {
  const currentUrl = window.location.href
  const isActive = await isUrlActive(currentUrl)

  if (isActive) {
    // Site is active, apply fonts
    const hasCustomCss = await injectFontStyles()
    await initializeFontVariable()

    if (hasCustomCss) {
      // Custom CSS is applied, so we don't need the generic observer logic.
      return
    }

    if (document.body) {
      await getAllElementsWithFontFamily(document.body)
      startObserving()
    }
  } else {
    // Site is not active, remove fonts
    stopObserving()
    removeFontStyles()
  }
}

// Debounced handler for mutations
const debouncedMutationHandler = debounce(() => {
  if (processingQueue.size > 0) {
    processBatch()
  }
}, 150) // Wait 150ms after last mutation before processing

function startObserving() {
  if (observer) {
    stopObserving()
  }

  observer = new MutationObserver((mutations: MutationRecord[]) => {
    // Collect all added nodes first
    const addedNodes: HTMLElement[] = []
    
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        // Convert NodeList to Array for iteration
        Array.from(mutation.addedNodes).forEach((node) => {
          if (node instanceof HTMLElement) {
            // Skip small text nodes and already processed elements
            if (!node.hasAttribute("data-fontara-processed")) {
              addedNodes.push(node)
            }
          }
        })
      }
    }

    // If we have many nodes, only process visible ones
    if (addedNodes.length > 100) {
      // Large batch - only add visible elements to queue
      addedNodes.forEach((node) => {
        if (node.offsetParent !== null || node.tagName.toLowerCase() === "body") {
          processingQueue.add(node)
        }
      })
    } else {
      // Small batch - process all
      addedNodes.forEach((node) => {
        processingQueue.add(node)
      })
    }

    // Debounce the processing
    debouncedMutationHandler()
  })

  if (document.body) {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      // Don't observe attributes or characterData for better performance
      attributes: false,
      characterData: false
    })
  }
}

function stopObserving() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  
  // Clear any pending processing
  processingQueue.clear()
  isProcessing = false
}

function updateFontVariable(fontName: string) {
  if (!fontName) return

  // Check if the style element already exists
  let styleElement = document.getElementById("fontara-dynamic-font")

  // If not, create it
  if (!styleElement) {
    styleElement = document.createElement("style")
    styleElement.id = "fontara-dynamic-font"
    document.head.appendChild(styleElement)
  }

  // Update the CSS variable definition
  styleElement.textContent = `
    :root {
      --fontara-font: "${fontName}";
    }
  `
}

async function initializeFontVariable() {
  const selectedFont = await storage.get("selectedFont")
  if (selectedFont) {
    updateFontVariable(selectedFont)
  }
}

// Initial setup when content script loads
if (document.body) {
  applyFontsIfActive()
}

// Watch for storage changes
storage.watch({
  selectedFont: (change) => {
    updateFontVariable(change.newValue)
  },
  isExtensionEnabled: async (change) => {
    applyFontsIfActive()
  },
  websiteList: async (change) => {
    applyFontsIfActive()
  }
  // customFontList: async (change) => {
  //   console.log("customFontList changed:", change.newValue)
  // }
})
